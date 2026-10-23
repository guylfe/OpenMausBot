import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DATA_DIR } from "./config.ts";
import { Store } from "./store.ts";
import { CodexBindings } from "./codex-bindings.ts";
import { CodexNativeRejection, type CodexNativeClient } from "./drivers/codex-native-client.ts";
import { saveFile, saveImage } from "./attachments.ts";
import { closeMessageDb } from "./message-db.ts";

const CONVERSATION = "fixture-existing-conversation";
const SEND = "fixture-send-0123456789";
const SECOND = "fixture-send-abcdefghij";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9xkAAAAASUVORK5CYII=", "base64");

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class Native implements CodexNativeClient {
  verifySavedPermissions = async () => {};
  home = "/fixture/codex-home";
  email = "owner@example.test";
  calls: Array<{ method: string; params: any }> = [];
  replies: unknown[] = [];
  rejected: unknown[] = [];
  turns: any[] = [];
  cwd = DATA_DIR;
  model = "fixture-saved-model";
  effort = "high";
  approvalPolicy = "on-request";
  sandbox = { type: "readOnly" };
  nativeId = CONVERSATION;
  readId = CONVERSATION;
  readStatus = "idle";
  historyError = false;
  startError: Error | undefined;
  startGate: ReturnType<typeof deferred> | undefined;
  connectGate: ReturnType<typeof deferred> | undefined;
  listener: (message: any) => void | Promise<void> = () => {};
  closers: Array<() => void> = [];
  waiters: Array<{ method: string; count: number; resolve(value: any): void }> = [];
  closed = false;
  request = async (method: string, params: any): Promise<any> => {
    const call = { method, params };
    this.calls.push(call);
    for (const waiter of this.waiters) if (waiter.method === method && this.calls.filter((call) => call.method === method).length >= waiter.count) waiter.resolve(call);
    if (method === "account/read") return { account: { type: "chatgpt", email: this.email } };
    if (method === "config/read") return { config: { model_provider: "openai" } };
    if (method === "thread/list") return { data: [{ id: CONVERSATION, name: "Existing fixture", cwd: this.cwd }], nextCursor: null };
    if (method === "thread/read") return { thread: { id: this.readId, name: "Existing fixture", model: this.model, reasoningEffort: this.effort, cwd: this.cwd, status: { type: this.readStatus } } };
    if (method === "thread/resume") {
      await this.connectGate?.promise;
      return { thread: { id: this.nativeId, name: "Existing fixture" }, model: this.model, modelProvider: "openai", reasoningEffort: this.effort, cwd: this.cwd, approvalPolicy: this.approvalPolicy, approvalsReviewer: "user", sandbox: this.sandbox, collaborationMode: null };
    }
    if (method === "thread/turns/list") {
      if (this.historyError) throw new Error("History unavailable");
      return { data: this.turns, nextCursor: null };
    }
    if (method === "turn/start") {
      if (this.startError) throw this.startError;
      const turn = { id: `native-turn-${this.calls.filter((call) => call.method === method).length}`, status: "inProgress", items: [{ id: `user-${params.clientUserMessageId}`, type: "userMessage", clientId: params.clientUserMessageId, content: params.input }] };
      this.turns.push(turn);
      await this.emit("turn/started", { threadId: CONVERSATION, turn });
      await this.startGate?.promise;
      return { turn: { ...turn, status: "inProgress" } };
    }
    if (method === "turn/interrupt") { await this.finish("interrupted"); return {}; }
    throw new Error(`Unexpected method ${method}`);
  };
  next(method: string, count = 1): Promise<any> {
    const calls = this.calls.filter((call) => call.method === method);
    if (calls.length >= count) return Promise.resolve(calls[count - 1]);
    return new Promise((resolve) => this.waiters.push({ method, count, resolve }));
  }
  reply(id: string | number, result: unknown) { this.replies.push({ id, result }); }
  reject(id: string | number) { this.rejected.push(id); }
  onMessage(listener: (message: any) => void | Promise<void>) { this.listener = listener; }
  onClose(listener: () => void) { this.closers.push(listener); }
  async close() { if (!this.closed) { this.closed = true; for (const listener of this.closers) listener(); } }
  async emit(method: string, params: any, id?: string | number) { await this.listener({ method, params, ...(id === undefined ? {} : { id }) }); }
  async finish(status = "completed", items: any[] = [{ id: "actual-reply", type: "agentMessage", text: "Actual native response" }]) {
    const turn = this.turns.at(-1)!;
    turn.status = status;
    turn.items.push(...items);
    await this.emit("turn/completed", { threadId: CONVERSATION, turn });
  }
}

let dir: string;
const bridges: CodexBindings[] = [];
beforeEach(() => { rmSync(DATA_DIR, { recursive: true, force: true }); dir = mkdtempSync(join(tmpdir(), "omb-codex-binding-")); });
afterEach(async () => { await Promise.all(bridges.splice(0).map((bridge) => bridge.close())); rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const store = new Store(() => ({ instanceId: "unrelated-model", model: "must-not-answer" }));
  const bot = store.createBot({ name: "Relay fixture" });
  const thread = bot.threadId;
  const native = new Native();
  let current = native;
  const make = () => {
    const bridge = new CodexBindings({ dataDir: dir, store, connect: async () => current, busy: () => false });
    bridges.push(bridge);
    return bridge;
  };
  const bridge = make();
  const bind = () => bridge.bind(bot.id, thread, "native-codex", CONVERSATION);
  return { store, bot, thread, native, bridge, bind, make, use: (client: Native) => { current = client; }, view: () => bridge.view(bot.id, thread), messages: () => store.messagesFor(thread) };
}

describe("existing native Codex bindings", () => {
  it("resumes only the exact selected conversation, without configuration or prompt injection", async () => {
    const h = fixture();
    const view = await h.bind();
    expect(view).toMatchObject({ configured: true, connected: true, state: "ready", settings: { model: h.native.model, reasoningEffort: "high", cwd: DATA_DIR, approvalPolicy: "on-request", sandbox: { type: "readOnly" } } });
    expect(h.native.calls.find((call) => call.method === "thread/resume")?.params).toEqual({ threadId: CONVERSATION, excludeTurns: true });
    const text = "  Exact text\n日本語 😀\n  ";
    await h.bridge.send(h.bot.id, h.thread, text, SEND);
    const { params } = await h.native.next("turn/start");
    expect(params).toEqual({ threadId: CONVERSATION, clientUserMessageId: SEND, input: [{ type: "text", text, text_elements: [] }] });
    expect(h.native.calls.some((call) => ["thread/start", "thread/fork"].includes(call.method))).toBe(false);
    expect(() => h.bridge.assertUnbound(h.thread)).toThrow(/reserved/);
    expect(() => h.bridge.assertUnbound("another-thread")).not.toThrow();
    await h.native.finish();
    expect(h.messages().find((message) => message.text === "Actual native response")?.codex).toEqual({ conversationId: CONVERSATION, turnId: "native-turn-1", itemId: "actual-reply" });
  });

  it("never claims ready while connecting, or after a different native thread was returned", async () => {
    const h = fixture(); h.native.connectGate = deferred();
    const pending = h.bind();
    await h.native.next("thread/resume");
    expect(h.view()).toMatchObject({ configured: true, connected: false, state: "connecting" });
    h.native.nativeId = "different-conversation"; h.native.connectGate.resolve(undefined);
    expect(await pending).toMatchObject({ connected: false, state: "failed" });
    await expect(h.bridge.send(h.bot.id, h.thread, "hello", SEND)).rejects.toThrow(/Reconnect/);
    expect(h.native.calls.some((call) => call.method === "turn/start")).toBe(false);
    expect(() => h.bridge.assertUnbound(h.thread)).toThrow();
  });

  it("rejects missing, active and foreign conversations and prevents cross-thread reservations", async () => {
    const h = fixture(); h.native.readId = "missing";
    expect(await h.bind()).toMatchObject({ state: "failed", connected: false });
    await h.bridge.disconnect(h.bot.id, h.thread);
    h.use(new Native());
    const second = h.store.createTask(h.bot.id, "Second")!.threadId;
    await h.bridge.bind(h.bot.id, second, "native-codex", CONVERSATION);
    await expect(h.bind()).rejects.toThrow(/already reserved/);
    await expect(h.bridge.send("another-bot", second, "hello", SEND)).rejects.toThrow(/No such/);
  });

  it("deduplicates concurrent sends and native replies, preserving FIFO delivery", async () => {
    const h = fixture(); await h.bind();
    const [a, b] = await Promise.all([h.bridge.send(h.bot.id, h.thread, "first", SEND), h.bridge.send(h.bot.id, h.thread, "first", SEND)]);
    expect(a.id).toBe(b.id);
    await h.native.next("turn/start");
    await h.bridge.send(h.bot.id, h.thread, "second", SECOND);
    expect(h.native.calls.filter((call) => call.method === "turn/start")).toHaveLength(1);
    await h.native.finish();
    await h.native.next("turn/start", 2);
    await h.native.finish("completed", [{ id: "actual-reply", type: "agentMessage", text: "Second response" }]);
    await h.native.emit("item/completed", { threadId: CONVERSATION, turnId: "native-turn-2", item: { id: "actual-reply", type: "agentMessage", text: "Second response" } });
    expect(h.messages().filter((message) => message.text === "Second response")).toHaveLength(1);
    expect(h.view().deliveries.map((delivery) => delivery.state)).toEqual(["completed", "completed"]);
    await expect(h.bridge.send(h.bot.id, h.thread, "different", SEND)).rejects.toThrow(/sendId/);
  });

  it("handles completion before the turn/start acknowledgement", async () => {
    const h = fixture(); await h.bind(); h.native.startGate = deferred();
    await h.bridge.send(h.bot.id, h.thread, "first", SEND);
    await h.native.next("turn/start");
    await h.native.finish(); h.native.startGate.resolve(undefined);
    await h.bridge.send(h.bot.id, h.thread, "second", SECOND);
    await h.native.next("turn/start", 2);
    expect(h.view().deliveries[0]?.state).toBe("completed");
    await h.native.finish();
    expect(h.view().running).toBe(false);
  });

  it("persists binding and receipts across restarts, then reconciles native IDs without replay", async () => {
    const h = fixture(); await h.bind();
    await h.bridge.send(h.bot.id, h.thread, "first", SEND); await h.native.next("turn/start");
    await h.bridge.close();
    const replacement = new Native(); replacement.turns = structuredClone(h.native.turns); replacement.turns[0].status = "completed";
    replacement.turns[0].items.push({ id: "after-crash", type: "agentMessage", text: "Recovered native response" });
    h.use(replacement); const restarted = h.make();
    expect(restarted.view(h.bot.id, h.thread)).toMatchObject({ configured: true, connected: false, state: "disconnected" });
    expect(await restarted.reconnect(h.bot.id, h.thread)).toMatchObject({ connected: true, deliveries: [{ sendId: SEND, state: "completed" }] });
    const receipt = await restarted.send(h.bot.id, h.thread, "first", SEND);
    expect(receipt.id).toBe(h.messages().find((message) => message.sendId === SEND)?.id);
    expect(replacement.calls.filter((call) => call.method === "turn/start")).toHaveLength(0);
    expect(h.messages().filter((message) => message.text === "Recovered native response")).toHaveLength(1);
    const saved = JSON.parse(readFileSync(join(dir, "codex-bindings.json"), "utf8"));
    expect(saved.bindings[0].identity).not.toContain("owner@example.test");
    if (process.platform !== "win32") expect(statSync(join(dir, "codex-bindings.json")).mode & 0o777).toBe(0o600);
  });

  it("holds uncertain dispatch and queued successors through recovery until explicit review", async () => {
    const h = fixture(); await h.bind(); h.native.startError = new Error("transport lost");
    await h.bridge.send(h.bot.id, h.thread, "may have arrived", SEND);
    await h.native.next("turn/start"); await h.native.close();
    const next = new Native(); h.use(next);
    await h.bridge.reconnect(h.bot.id, h.thread);
    expect(h.view().deliveries[0]?.state).toBe("uncertain");
    await h.bridge.send(h.bot.id, h.thread, "follow-up", SECOND);
    expect(next.calls.filter((call) => call.method === "turn/start")).toHaveLength(0);
    h.bridge.acknowledge(h.bot.id, h.thread, SEND);
    const { params } = await next.next("turn/start");
    expect(params.clientUserMessageId).toBe(SECOND);
    expect(h.messages().filter((message) => message.sendId === SEND)).toHaveLength(1);
  });

  it("deduplicates from a newly opened durable message store after a reply/outbox crash window", async () => {
    const h = fixture(); await h.bind();
    await h.bridge.send(h.bot.id, h.thread, "durable", SEND); await h.native.next("turn/start");
    const beforeCompletion = readFileSync(join(dir, "codex-bindings.json"), "utf8");
    await h.native.finish(); await h.bridge.close(); closeMessageDb();
    writeFileSync(join(dir, "codex-bindings.json"), beforeCompletion);
    const reopened = new Store(() => ({ instanceId: "unrelated", model: "unrelated" }));
    const next = new Native(); next.turns = structuredClone(h.native.turns);
    const restarted = new CodexBindings({ dataDir: dir, store: reopened, connect: async () => next, busy: () => false }); bridges.push(restarted);
    await restarted.reconnect(h.bot.id, h.thread);
    const receipt = await restarted.send(h.bot.id, h.thread, "durable", SEND);
    expect(receipt.sendId).toBe(SEND);
    expect(reopened.messagesFor(h.thread).filter((message) => message.text === "Actual native response")).toHaveLength(1);
    expect(next.calls.some((call) => call.method === "turn/start")).toBe(false);
    expect(restarted.view(h.bot.id, h.thread).deliveries[0]?.state).toBe("completed");
  });

  it("prevents alias instances for the same account/store from binding the same native conversation", async () => {
    const h = fixture(); await h.bind();
    const other = h.store.createTask(h.bot.id, "Alias")!.threadId;
    const next = new Native(); h.use(next);
    expect(await h.bridge.bind(h.bot.id, other, "alias-codex", CONVERSATION)).toMatchObject({ connected: false, state: "failed" });
    expect(next.calls.some((call) => call.method === "thread/resume")).toBe(false);
  });

  it("does not repeat a rejected native request, and exposes history failures truthfully", async () => {
    const h = fixture(); await h.bind(); h.native.startError = new CodexNativeRejection("Native rejected");
    await h.bridge.send(h.bot.id, h.thread, "rejected", SEND); await h.native.next("turn/start");
    await h.native.close();
    const next = new Native(); next.historyError = true; h.use(next);
    expect(await h.bridge.reconnect(h.bot.id, h.thread)).toMatchObject({ connected: false, state: "failed" });
    expect(next.calls.some((call) => call.method === "turn/start")).toBe(false);
  });

  it("refuses changed account, conversation store and saved settings on reconnect", async () => {
    const h = fixture(); await h.bind(); await h.native.close();
    for (const change of ["email", "home", "model"] as const) {
      const next = new Native(); next[change] = "changed"; h.use(next);
      expect(await h.bridge.reconnect(h.bot.id, h.thread)).toMatchObject({ connected: false, state: "failed" });
      expect(next.calls.some((call) => call.method === "turn/start")).toBe(false);
    }
  });

  it("requires explicit scoped approvals and expires stale requests", async () => {
    const h = fixture(); await h.bind(); await h.bridge.send(h.bot.id, h.thread, "approval", SEND); await h.native.next("turn/start");
    await h.native.emit("item/commandExecution/requestApproval", { threadId: CONVERSATION, turnId: "native-turn-1", itemId: "command-1", command: "pwd", cwd: DATA_DIR, reason: "Read the current folder" }, 45);
    expect(h.view().state).toBe("awaiting-approval"); expect(h.native.replies).toHaveLength(0);
    const card = h.messages().find((message) => message.card)?.card;
    expect(card).toMatchObject({ tool: "Codex", requestType: "permission" });
    expect(card?.allowSession).toBeUndefined();
    await expect(h.bridge.answer("foreign-bot", h.thread, card!.requestId!, "allow")).rejects.toThrow();
    expect(await h.bridge.answer(h.bot.id, h.thread, card!.requestId!, "allow")).toBe("allowed-once");
    expect(h.native.replies).toEqual([{ id: 45, result: { decision: "accept" } }]);
    expect(await h.bridge.answer(h.bot.id, h.thread, card!.requestId!, "allow")).toBe("unavailable");
    await h.native.emit("item/fileChange/requestApproval", { threadId: CONVERSATION, turnId: "native-turn-1", itemId: "file-1", reason: "Change one fixture file" }, 46);
    await h.native.close();
    expect(h.messages().find((message) => message.card?.requestId !== card!.requestId && message.card)?.card).toMatchObject({ expired: true, answered: "unavailable" });
    expect(h.native.replies).toHaveLength(1);
  });

  it("fails closed on foreign or unsupported approval methods", async () => {
    const h = fixture(); await h.bind();
    await h.bridge.send(h.bot.id, h.thread, "approval scope", SEND); await h.native.next("turn/start");
    await h.native.emit("item/commandExecution/requestApproval", { threadId: "foreign", turnId: "turn", itemId: "item" }, 1);
    await h.native.emit("item/permissions/requestApproval", { threadId: CONVERSATION, turnId: "native-turn-1", permissions: { fileSystem: { write: ["/"] } } }, 2);
    await h.native.emit("item/fileChange/requestApproval", { threadId: CONVERSATION, turnId: "native-turn-1", grantRoot: "/" }, 3);
    await h.native.emit("item/commandExecution/requestApproval", { threadId: CONVERSATION, turnId: "native-turn-1", additionalPermissions: { network: true } }, 4);
    await h.native.emit("item/commandExecution/requestApproval", { threadId: CONVERSATION, turnId: "native-turn-1", availableDecisions: ["acceptForSession", "decline"] }, 5);
    expect(h.native.rejected).toEqual([1, 2, 3, 4, 5]); expect(h.native.replies).toHaveLength(0);
    expect(h.messages().some((message) => message.tool?.name.includes("No permission was granted"))).toBe(true);
  });

  it("routes native questions through structured answer cards", async () => {
    const h = fixture(); await h.bind(); await h.bridge.send(h.bot.id, h.thread, "question", SEND); await h.native.next("turn/start");
    await h.native.emit("item/tool/requestUserInput", { threadId: CONVERSATION, turnId: "native-turn-1", questions: [{ id: "choice", header: "Pick", question: "Which option?", options: [{ label: "A", description: "First" }, { label: "B", description: "Second" }] }] }, "question-id");
    const card = h.messages().find((message) => message.card)?.card;
    expect(card?.questionRequest?.questions[0]?.question).toBe("Which option?");
    await h.bridge.answer(h.bot.id, h.thread, card!.requestId!, "answer", "A");
    expect(h.native.replies).toEqual([{ id: "question-id", result: { answers: { choice: { answers: ["A"] } } } }]);
  });

  it("forwards admitted images and imports actual generated and existing images inline once", async () => {
    const h = fixture(); const image = saveImage(PNG, "image/png");
    h.native.turns = [{ id: "old-native-turn", status: "completed", items: [{ id: "existing-image", type: "imageView", path: image.path }] }];
    await h.bind();
    expect(h.messages().find((message) => message.codex?.itemId === "existing-image")?.attachments?.[0]).toMatchObject({ kind: "image", mime: "image/png" });
    await h.bridge.send(h.bot.id, h.thread, `Look\n\n<attached-image path="${image.path}" />`, SEND);
    const { params } = await h.native.next("turn/start");
    expect(params.input).toEqual([{ type: "text", text: "Look\n\n", text_elements: [] }, { type: "localImage", path: image.path }]);
    await h.native.finish("completed", [{ id: "generated", type: "imageGeneration", result: PNG.toString("base64") }]);
    const generated = h.messages().find((message) => message.codex?.itemId === "generated")!;
    expect(generated.attachments?.[0]).toMatchObject({ kind: "image", mime: "image/png" });
    expect(readFileSync(generated.attachments![0]!.path)).toEqual(PNG);
    await h.native.close(); h.use(new Native()); await h.bridge.reconnect(h.bot.id, h.thread);
    expect(h.messages().filter((message) => message.codex?.itemId === "existing-image")).toHaveLength(1);
  });

  it("reports inaccessible files and rejects an unavailable user attachment before dispatch", async () => {
    const h = fixture(); h.native.turns = [{ id: "old", status: "completed", items: [{ id: "missing-image", type: "imageView", path: join(dir, "missing.png") }] }];
    await h.bind();
    expect(h.messages().some((message) => message.tool?.name.includes("could not be accessed"))).toBe(true);
    await expect(h.bridge.send(h.bot.id, h.thread, '<attached-image path="/outside/missing.png" />', SEND)).rejects.toThrow(/unavailable/);
    expect(h.native.calls.some((call) => call.method === "turn/start")).toBe(false);
  });

  it("preserves attachment syntax examples and forwards admitted document references without changing permissions", async () => {
    const h = fixture(); await h.bind();
    const document = await saveFile((async function* () { yield Buffer.from("Harmless document"); })(), "fixture.txt", "text/plain");
    const text = `Read this if your native permissions allow it.\n\n<attached-file path="${document.path}" name="fixture.txt" />\n\nExample: \`<attached-image path="/not-an-attachment.png" />\``;
    await h.bridge.send(h.bot.id, h.thread, text, SEND);
    expect((await h.native.next("turn/start")).params.input).toEqual([{ type: "text", text, text_elements: [] }]);
    await h.native.finish("completed", [{ id: "document-reply", type: "agentMessage", text: `[Existing document](${document.path})` }]);
    expect(h.messages().find((message) => message.codex?.itemId === "document-reply")?.attachments?.[0]).toMatchObject({ kind: "file", mime: "text/plain", name: expect.stringMatching(/\.txt$/) });
  });

  it("cancels queued and running turns without discarding receipts", async () => {
    const h = fixture(); await h.bind(); await h.bridge.send(h.bot.id, h.thread, "first", SEND); await h.native.next("turn/start");
    await h.bridge.send(h.bot.id, h.thread, "second", SECOND);
    await h.bridge.cancel(h.bot.id, h.thread, SECOND);
    await h.bridge.cancel(h.bot.id, h.thread);
    expect(h.view().deliveries.map((delivery) => delivery.state)).toEqual(["interrupted", "cancelled"]);
    await h.bridge.disconnect(h.bot.id, h.thread);
    expect(h.view()).toMatchObject({ configured: false, state: "disconnected" });
    const next = new Native(); h.use(next); await h.bind();
    await h.bridge.send(h.bot.id, h.thread, "first", SEND);
    expect(next.calls.some((call) => call.method === "turn/start")).toBe(false);
  });

  it("fails startup closed if the durable binding ledger is corrupted", () => {
    writeFileSync(join(dir, "codex-bindings.json"), "{broken");
    expect(() => fixture()).toThrow(/could not be read safely/);
  });
});
