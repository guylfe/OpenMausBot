import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CodexBindingView, CodexConnectionState, CodexDeliveryState } from "../shared/codex-binding.ts";
import { parseProtocolAskQuestions } from "../shared/ask-question.ts";
import { writeFileAtomic } from "./atomic.ts";
import { codexItemAttachments, codexUserInput } from "./codex-binding-attachments.ts";
import { codexQuestionReply } from "./drivers/codex-questions.ts";
import { CodexNativeRejection, type CodexNativeClient } from "./drivers/codex-native-client.ts";
import type { Message, Store } from "./store.ts";

interface Delivery {
  sendId: string;
  text: string;
  state: CodexDeliveryState;
  turnId?: string;
}

interface Binding {
  botId: string;
  threadId: string;
  instanceId: string;
  conversationId: string;
  title?: string;
  identity?: string;
  settings?: NonNullable<CodexBindingView["settings"]> & { modelProvider: string; approvalsReviewer: unknown; collaborationMode: unknown };
  deliveries: Delivery[];
}

interface Connection {
  state: CodexConnectionState;
  client?: CodexNativeClient;
  error?: string;
  running?: string;
  work: Promise<void>;
  asks: Map<string, { id: string | number; method: string; params: any; messageId: string }>;
  pumping: boolean;
  terminalTurns: Set<string>;
}

export interface CodexBindingsDeps {
  dataDir: string;
  store: Pick<Store, "bot" | "taskByThread" | "messagesFor" | "appendMessage" | "patchMessage">;
  connect(instanceId: string): Promise<CodexNativeClient>;
  busy(botId: string, threadId: string): boolean;
}

function refuse(message: string, status = 409): never { throw Object.assign(new Error(message), { status }); }
function same(a: unknown, b: unknown): boolean {
  const stable = (value: any): any => Array.isArray(value) ? value.map(stable)
    : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

/** Private, single-server outbox. A dispatch with no native acknowledgement is never automatically replayed. */
export class CodexBindings {
  private readonly deps: CodexBindingsDeps;
  private readonly bindings = new Map<string, Binding>();
  private readonly connections = new Map<string, Connection>();
  private readonly file: string;
  private stopped = false;

  constructor(deps: CodexBindingsDeps) {
    this.deps = deps;
    this.file = join(deps.dataDir, "codex-bindings.json");
    try {
      const data = JSON.parse(readFileSync(this.file, "utf8"));
      if (data.version !== 1 || !Array.isArray(data.bindings)) throw new Error("Unsupported Codex binding data");
      for (const binding of data.bindings as Binding[]) {
        if (!binding.threadId || !binding.botId || !binding.instanceId || !binding.conversationId || !Array.isArray(binding.deliveries) || this.bindings.has(binding.threadId)) throw new Error("Invalid Codex binding data");
        for (const delivery of binding.deliveries) {
          if (delivery.state === "dispatching" || delivery.state === "delivered") delivery.state = "uncertain";
        }
        this.bindings.set(binding.threadId, binding);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Codex binding data could not be read safely. Restore it before starting OpenMausBot.");
    }
  }

  private persist(): void {
    mkdirSync(this.deps.dataDir, { recursive: true, mode: 0o700 });
    writeFileAtomic(this.file, JSON.stringify({ version: 1, bindings: [...this.bindings.values()] }), { mode: 0o600 });
  }

  configured(threadId: string): boolean { return this.bindings.has(threadId); }

  assertUnbound(threadId: string): void {
    if (this.configured(threadId)) refuse("This thread is reserved for its existing Codex conversation. Use its connection controls or disconnect it first.");
  }

  private owned(botId: string, threadId: string): Binding {
    const binding = this.bindings.get(threadId);
    if (!binding || binding.botId !== botId || !this.deps.store.taskByThread(botId, threadId)) refuse("No such Codex connection.", 404);
    return binding;
  }

  view(botId: string, threadId: string): CodexBindingView {
    if (!this.deps.store.taskByThread(botId, threadId)) refuse("No such thread.", 404);
    const binding = this.bindings.get(threadId);
    if (!binding) return { configured: false, connected: false, state: "disconnected", deliveries: [] };
    this.owned(botId, threadId);
    const connection = this.connections.get(threadId);
    const state = connection?.state ?? "disconnected";
    return {
      configured: true, connected: state === "ready" || state === "awaiting-approval", state,
      instanceId: binding.instanceId, conversationId: binding.conversationId, title: binding.title,
      settings: binding.settings && { model: binding.settings.model, reasoningEffort: binding.settings.reasoningEffort, cwd: binding.settings.cwd, approvalPolicy: binding.settings.approvalPolicy, sandbox: binding.settings.sandbox }, error: connection?.error, running: Boolean(connection?.running),
      deliveries: binding.deliveries.map(({ sendId, state, turnId }) => ({ sendId, state, turnId })),
    };
  }

  async list(instanceId: string, searchTerm = "", cursor?: string): Promise<unknown> {
    const client = await this.deps.connect(instanceId);
    try {
      await this.identity(client);
      const result = await client.request("thread/list", { limit: 30, searchTerm, ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(result?.data)) throw new Error("Codex returned an unsupported conversation list.");
      return { conversations: result.data.map((thread: any) => ({ id: thread.id, title: thread.name ?? thread.preview ?? thread.id, cwd: thread.cwd })), nextCursor: result.nextCursor ?? null };
    } finally { await client.close(); }
  }

  private async identity(client: CodexNativeClient): Promise<string> {
    const result = await client.request("account/read", { refreshToken: false });
    if (result?.account?.type !== "chatgpt" || typeof result.account.email !== "string") throw new Error("Sign in to Codex with the ChatGPT account that owns the conversation. API-key accounts are not supported by this connection.");
    const initialized = await client.request("config/read", { includeLayers: false });
    if (typeof initialized?.config?.model_provider === "string" && initialized.config.model_provider !== "openai") throw new Error("An existing conversation connection requires Codex's native OpenAI provider.");
    return createHash("sha256").update(JSON.stringify([client.home, result.account.email.toLowerCase()])).digest("hex");
  }

  async bind(botId: string, threadId: string, instanceId: string, conversationId: string): Promise<CodexBindingView> {
    if (this.stopped) refuse("OpenMausBot is stopping.");
    if (!this.deps.store.taskByThread(botId, threadId)) refuse("No such thread.", 404);
    if (!/^[\w-]{1,128}$/.test(conversationId)) refuse("Select an exact Codex conversation ID.", 400);
    if (this.bindings.has(threadId)) refuse("Disconnect the current Codex conversation before selecting another.");
    if (this.deps.busy(botId, threadId)) refuse("Stop this thread's current turn before connecting Codex.");
    if ([...this.bindings.values()].some((binding) => binding.instanceId === instanceId && binding.conversationId === conversationId)) refuse("That Codex conversation is already reserved by another thread.");
    const binding: Binding = { botId, threadId, instanceId, conversationId, deliveries: [] };
    this.bindings.set(threadId, binding);
    try { this.persist(); } catch (error) { this.bindings.delete(threadId); throw error; }
    return this.reconnect(botId, threadId);
  }

  async reconnect(botId: string, threadId: string): Promise<CodexBindingView> {
    const binding = this.owned(botId, threadId);
    const previous = this.connections.get(threadId);
    if (previous?.state === "connecting" || previous?.client) refuse("The Codex connection is already open or connecting.");
    const connection: Connection = { state: "connecting", work: Promise.resolve(), asks: new Map(), pumping: false, terminalTurns: new Set() };
    this.connections.set(threadId, connection);
    try {
      const client = await this.deps.connect(binding.instanceId);
      connection.client = client;
      client.onClose(() => this.closed(binding, connection));
      const identity = await this.identity(client);
      if (binding.identity && binding.identity !== identity) throw new Error("The signed-in Codex account changed. Restore the original account before reconnecting.");
      if ([...this.bindings.values()].some((other) => other !== binding && other.identity === identity && other.conversationId === binding.conversationId)) throw new Error("This Codex conversation is already reserved through another instance.");
      binding.identity = identity;
      this.persist();
      const read = await client.request("thread/read", { threadId: binding.conversationId });
      if (read?.thread?.id !== binding.conversationId) throw new Error("Codex did not return the selected existing conversation.");
      if (read.thread.status?.type === "active") throw new Error("This Codex conversation is already running. Finish or stop it in Codex before reconnecting.");
      await client.verifySavedPermissions(read.thread);
      const resumed = await client.request("thread/resume", { threadId: binding.conversationId, excludeTurns: true });
      if (resumed?.thread?.id !== binding.conversationId) throw new Error("Codex resumed a different conversation. No message was sent.");
      const settings = this.settings(resumed);
      if (typeof read.thread.model !== "string" || read.thread.model !== settings.model || read.thread.cwd !== settings.cwd || read.thread.reasoningEffort !== settings.reasoningEffort) throw new Error("Codex could not preserve the selected conversation's saved model, effort, or working folder. No message was sent.");
      if (binding.settings && !same(binding.settings, settings)) throw new Error("Codex's saved settings changed. No message was sent. Review them in Codex, then disconnect and select the conversation again to accept its current settings.");
      binding.identity = identity;
      binding.title = resumed.thread.name ?? read.thread.name ?? binding.conversationId;
      binding.settings = settings;
      this.persist();
      client.onMessage((message) => {
        connection.work = connection.work.then(() => this.receive(binding, connection, message)).catch(() => {
          connection.state = "failed";
          connection.error = "A Codex response could not be saved. Reconnect to recover it from native history.";
          void client.close().catch(() => {});
        });
        return connection.work;
      });
      await this.reconcile(binding, connection);
      if (this.stopped || this.bindings.get(threadId) !== binding || connection.state !== "connecting") throw new Error("The Codex connection closed before it was ready.");
      connection.state = "ready";
      void this.pump(binding, connection);
    } catch (error) {
      connection.state = "failed";
      connection.error = error instanceof Error ? error.message : "Codex could not connect.";
      const client = connection.client;
      connection.client = undefined;
      await client?.close().catch(() => {});
    }
    return this.view(botId, threadId);
  }

  private settings(result: any): NonNullable<Binding["settings"]> {
    if (typeof result.model !== "string" || typeof result.cwd !== "string" || !result.sandbox || result.approvalPolicy === undefined || !(result.reasoningEffort === null || typeof result.reasoningEffort === "string")) throw new Error("Codex did not report its effective saved settings. No message was sent.");
    return { model: result.model, modelProvider: result.modelProvider, reasoningEffort: result.reasoningEffort, cwd: result.cwd, sandbox: result.sandbox, approvalPolicy: result.approvalPolicy, approvalsReviewer: result.approvalsReviewer, collaborationMode: result.collaborationMode };
  }

  private notice(binding: Binding, itemId: string, text: string, turnId = "connection"): void {
    const existing = this.deps.store.messagesFor(binding.threadId).some((message) => message.codex?.conversationId === binding.conversationId && message.codex.itemId === itemId && message.codex.turnId === turnId);
    if (!existing) this.deps.store.appendMessage(binding.threadId, { role: "bot", kind: "activity", tool: { name: text, ok: false }, codex: { conversationId: binding.conversationId, turnId, itemId } });
  }

  private closed(binding: Binding, connection: Connection): void {
    connection.client = undefined;
    if (connection.state !== "failed") connection.state = "disconnected";
    for (const delivery of binding.deliveries) if (delivery.state === "dispatching" || delivery.state === "delivered") delivery.state = "uncertain";
    for (const ask of connection.asks.values()) this.expire(binding, ask.messageId);
    connection.asks.clear();
    connection.running = undefined;
    this.persist();
  }

  private expire(binding: Binding, messageId: string): void {
    const message = this.deps.store.messagesFor(binding.threadId).find((message) => message.id === messageId);
    if (message?.card && !message.card.answered) this.deps.store.patchMessage(binding.threadId, message.id, { card: { ...message.card, answered: "unavailable", expired: true } });
  }

  private async reconcile(binding: Binding, connection: Connection): Promise<void> {
    const client = connection.client!;
    let cursor: string | undefined;
    const cursors = new Set<string>();
    const turns: any[] = [];
    do {
      const page = await client.request("thread/turns/list", { threadId: binding.conversationId, limit: 100, sortDirection: "asc", itemsView: "full", ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(page?.data)) throw new Error("Codex history is unavailable. No message was sent.");
      turns.push(...page.data);
      cursor = page.nextCursor ?? undefined;
      if (cursor && cursors.has(cursor) || turns.length > 10_000) throw new Error("Codex history could not be reconciled safely.");
      if (cursor) cursors.add(cursor);
    } while (cursor);
    for (const turn of turns) {
      if (!Array.isArray(turn.items) || typeof turn.id !== "string") throw new Error("Codex returned unsupported history.");
      for (const item of turn.items) {
        if (item.type === "userMessage" && item.clientId) {
          const delivery = binding.deliveries.find((delivery) => delivery.sendId === item.clientId);
          if (delivery) { delivery.turnId = turn.id; delivery.state = this.terminal(turn.status) ?? "uncertain"; }
        }
        await this.item(binding, turn.id, item);
      }
      if (turn.status === "inProgress") connection.running = turn.id;
    }
    for (const message of this.deps.store.messagesFor(binding.threadId)) if (message.codex?.conversationId === binding.conversationId && message.card && !message.card.answered) this.expire(binding, message.id);
    this.persist();
  }

  private terminal(status: string): CodexDeliveryState | undefined {
    return status === "completed" ? "completed" : status === "interrupted" ? "interrupted" : status === "failed" ? "failed" : undefined;
  }

  private async item(binding: Binding, turnId: string, item: any): Promise<void> {
    if (typeof item?.id !== "string" || !["agentMessage", "imageGeneration", "imageView"].includes(item.type)) return;
    if (this.deps.store.messagesFor(binding.threadId).some((message) => message.codex?.conversationId === binding.conversationId && message.codex.turnId === turnId && message.codex.itemId === item.id)) return;
    const { attachments, unavailable } = await codexItemAttachments(item, binding.settings!.cwd);
    const text = item.type === "agentMessage" && typeof item.text === "string" ? item.text : undefined;
    if (text || attachments.length) this.deps.store.appendMessage(binding.threadId, {
      role: "bot", kind: "text", text, ...(attachments.length ? { attachments } : {}),
      codex: { conversationId: binding.conversationId, turnId, itemId: item.id },
    });
    if (unavailable) this.notice(binding, `${item.id}:unavailable`, "A Codex attachment could not be accessed or is unsupported. Upload it here from its original location.", turnId);
  }

  async send(botId: string, threadId: string, text: string, sendId: string): Promise<Message> {
    const binding = this.owned(botId, threadId);
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(sendId)) refuse("A stable sendId is required for Codex delivery.", 400);
    if (!text.trim() || text.length > 1_000_000) refuse("Enter a message of at most 1,000,000 characters.", 400);
    const previous = binding.deliveries.find((delivery) => delivery.sendId === sendId);
    if (previous && previous.text !== text) refuse("sendId already belongs to another message.");
    const accepted = this.deps.store.messagesFor(threadId).find((message) => message.role === "user" && message.sendId === sendId);
    if (accepted && !previous) {
      if (accepted.text !== text || accepted.codex?.conversationId !== binding.conversationId) refuse("sendId already belongs to another message.");
      return accepted;
    }
    if (!previous) {
      const connection = this.connections.get(threadId);
      if (!connection?.client || !["ready", "awaiting-approval"].includes(connection.state)) refuse("Reconnect Codex before sending. This message has not been delivered.");
      codexUserInput(text);
      if (binding.deliveries.filter((delivery) => delivery.state === "queued").length >= 20) refuse("The Codex message queue is full.", 429);
      binding.deliveries.push({ sendId, text, state: "queued" });
      this.persist();
    }
    let message = this.deps.store.messagesFor(threadId).find((message) => message.role === "user" && message.sendId === sendId);
    if (!message) message = this.deps.store.appendMessage(threadId, { role: "user", kind: "text", text, sendId, codex: { conversationId: binding.conversationId, turnId: previous?.turnId ?? "pending", itemId: sendId } });
    const connection = this.connections.get(threadId);
    if (connection) void this.pump(binding, connection);
    return message;
  }

  private async pump(binding: Binding, connection: Connection): Promise<void> {
    if (connection.pumping || connection.running || connection.state !== "ready" || !connection.client || this.stopped) return;
    if (binding.deliveries.some((delivery) => delivery.state === "uncertain")) return;
    const delivery = binding.deliveries.find((delivery) => delivery.state === "queued");
    if (!delivery) return;
    connection.pumping = true;
    try {
      const client = connection.client;
      if (await this.identity(client) !== binding.identity) throw new Error("The signed-in Codex account changed. Restore the original account before reconnecting.");
      const input = codexUserInput(delivery.text);
      if (connection.client !== client || connection.state !== "ready" || this.stopped) return;
      delivery.state = "dispatching";
      this.persist();
      const result = await client.request("turn/start", { threadId: binding.conversationId, clientUserMessageId: delivery.sendId, input });
      if (typeof result?.turn?.id !== "string") throw new Error("Codex did not acknowledge a native turn.");
      delivery.turnId = result.turn.id;
      if (delivery.state === "dispatching") delivery.state = this.terminal(result.turn.status) ?? "delivered";
      if (!this.terminal(result.turn.status) && !connection.terminalTurns.has(result.turn.id)) connection.running = result.turn.id;
      this.persist();
    } catch (error) {
      if (delivery.state === "dispatching") delivery.state = error instanceof CodexNativeRejection ? "failed" : "uncertain";
      connection.state = "failed";
      connection.error = error instanceof Error ? error.message : "Codex delivery failed.";
      this.persist();
      this.notice(binding, `delivery:${delivery.sendId}`, delivery.state === "uncertain" ? "Codex delivery is uncertain. Reconnect and review the native conversation before sending it again." : "Codex did not accept this message. Reconnect before trying again.");
      const client = connection.client;
      connection.client = undefined;
      await client?.close().catch(() => {});
    } finally {
      connection.pumping = false;
      if (!connection.running) void this.pump(binding, connection);
    }
  }

  private async receive(binding: Binding, connection: Connection, message: any): Promise<void> {
    if (this.bindings.get(binding.threadId) !== binding) return;
    const params = message.params;
    if (params?.threadId !== binding.conversationId) {
      if (message.id !== undefined) connection.client?.reject(message.id);
      return;
    }
    if (message.id !== undefined) { this.ask(binding, connection, message); return; }
    if (message.method === "item/completed" && typeof params.turnId === "string") await this.item(binding, params.turnId, params.item);
    if (message.method === "turn/started" && typeof params.turn?.id === "string") connection.running = params.turn.id;
    if (message.method === "serverRequest/resolved") {
      for (const [id, ask] of connection.asks) if (ask.id === params.requestId) { this.expire(binding, ask.messageId); connection.asks.delete(id); }
      if (!connection.asks.size && connection.state === "awaiting-approval") connection.state = "ready";
    }
    if (message.method === "turn/completed" && typeof params.turn?.id === "string") {
      connection.terminalTurns.add(params.turn.id);
      for (const item of params.turn.items ?? []) await this.item(binding, params.turn.id, item);
      for (const delivery of binding.deliveries) if (delivery.turnId === params.turn.id || delivery.state === "dispatching" && !delivery.turnId) {
        delivery.turnId = params.turn.id;
        delivery.state = this.terminal(params.turn.status) ?? "uncertain";
      }
      if (connection.running === params.turn.id) connection.running = undefined;
      for (const [id, ask] of connection.asks) if (ask.params.turnId === params.turn.id) { this.expire(binding, ask.messageId); connection.asks.delete(id); }
      if (!connection.asks.size && connection.state === "awaiting-approval") connection.state = "ready";
      this.persist();
      void this.pump(binding, connection);
    }
    if (message.method === "thread/settings/updated") {
      connection.state = "failed";
      connection.error = "Codex settings changed while connected. Reconnect and review the conversation before sending again.";
      await connection.client?.close();
    }
    if (message.method === "thread/closed" || message.method === "error" && !params.willRetry) {
      connection.state = "failed";
      connection.error = "Codex reported a connection or turn failure. Reconnect to recover native history.";
      await connection.client?.close();
    }
  }

  private ask(binding: Binding, connection: Connection, message: any): void {
    const { method, params, id } = message;
    const question = method === "item/tool/requestUserInput" ? parseProtocolAskQuestions(params.questions) : null;
    const permission = method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval";
    if ((!permission && !question) || typeof params.turnId !== "string" || params.turnId !== connection.running) {
      connection.client?.reject(id);
      this.notice(binding, `unsupported:${String(id)}`, "Codex requested an unsupported approval or input interface. No permission was granted. Continue in Codex or cancel this turn.");
      return;
    }
    if ([...connection.asks.values()].some((ask) => ask.id === id)) return;
    const requestId = `codex-${randomUUID()}`;
    const subtitle = [params.reason, params.command, params.cwd, params.grantRoot && `Write access: ${params.grantRoot}`, params.networkApprovalContext && JSON.stringify(params.networkApprovalContext)].filter((value) => typeof value === "string").join("\n");
    const saved = this.deps.store.appendMessage(binding.threadId, {
      role: "bot", kind: "options", codex: { conversationId: binding.conversationId, turnId: params.turnId, itemId: `request:${requestId}` },
      card: {
        title: question ? "Codex needs your answer" : "Codex needs your approval", subtitle, requestId,
        requestType: question ? "question" : "permission", tool: "Codex", options: question ? [] : ["Allow", "Deny"],
        ...(question ? { questionRequest: { version: 1, questions: question.map(({ question }) => question) } } : {}),
      },
    });
    connection.asks.set(requestId, { id, method, params, messageId: saved.id });
    connection.state = "awaiting-approval";
  }

  async answer(botId: string, threadId: string, requestId: string, behavior: string, message?: string): Promise<string> {
    const binding = this.owned(botId, threadId);
    const connection = this.connections.get(threadId);
    const ask = connection?.asks.get(requestId);
    if (!connection?.client || !ask) return "unavailable";
    if (await this.identity(connection.client) !== binding.identity) refuse("The Codex account changed. No approval was sent.", 403);
    if (!connection.asks.has(requestId)) return "unavailable";
    const question = ask.method === "item/tool/requestUserInput" ? parseProtocolAskQuestions(ask.params.questions) : null;
    if (question ? !["answer", "deny"].includes(behavior) : !["allow", "deny"].includes(behavior)) refuse("This answer does not match the native request.", 400);
    connection.client.reply(ask.id, question ? codexQuestionReply(behavior as "answer" | "deny", message, "user", question) : { decision: behavior === "allow" ? "accept" : "decline" });
    connection.asks.delete(requestId);
    const saved = this.deps.store.messagesFor(threadId).find((item) => item.id === ask.messageId);
    if (saved?.card) this.deps.store.patchMessage(threadId, saved.id, { card: { ...saved.card, answered: behavior, ...(question && message ? { answeredText: message } : {}) } });
    if (!connection.asks.size) connection.state = "ready";
    return behavior === "allow" ? "allowed-once" : behavior === "answer" ? "answered" : "rejected";
  }

  async cancel(botId: string, threadId: string, sendId?: string): Promise<void> {
    const binding = this.owned(botId, threadId);
    const connection = this.connections.get(threadId);
    if (sendId) {
      const delivery = binding.deliveries.find((delivery) => delivery.sendId === sendId);
      if (!delivery) refuse("No such Codex delivery.", 404);
      if (delivery.state === "queued") { delivery.state = "cancelled"; this.persist(); return; }
      if (delivery.turnId !== connection?.running) refuse("Only a queued or currently running delivery can be cancelled.");
    }
    if (!connection?.client || !connection.running) refuse("No connected native turn is running. Reconnect and inspect Codex before retrying.");
    await connection.client.request("turn/interrupt", { threadId: binding.conversationId, turnId: connection.running });
  }

  acknowledge(botId: string, threadId: string, sendId: string): void {
    const binding = this.owned(botId, threadId);
    const delivery = binding.deliveries.find((delivery) => delivery.sendId === sendId);
    if (delivery?.state !== "uncertain") refuse("Only an uncertain delivery can be acknowledged.");
    delivery.state = "cancelled";
    this.persist();
    const connection = this.connections.get(threadId);
    if (connection) void this.pump(binding, connection);
  }

  async disconnect(botId: string, threadId: string): Promise<void> {
    const binding = this.owned(botId, threadId);
    const connection = this.connections.get(threadId);
    if (connection?.state === "connecting" || connection?.running || binding.deliveries.some((delivery) => ["queued", "dispatching", "delivered", "uncertain"].includes(delivery.state))) refuse("Cancel queued work and finish or review the native turn before disconnecting.");
    await connection?.client?.close();
    await connection?.work;
    this.bindings.delete(threadId);
    this.connections.delete(threadId);
    this.persist();
  }

  async close(): Promise<void> {
    this.stopped = true;
    await Promise.all([...this.connections.values()].map((connection) => connection.client?.close()));
    await Promise.all([...this.connections.values()].map((connection) => connection.work));
  }
}
