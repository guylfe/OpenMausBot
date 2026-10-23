#!/usr/bin/env -S node --experimental-strip-types
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";

const root = process.env.FAKE_CODEX_NATIVE_DIR ?? process.env.HOME!;
const stateFile = join(root, "native-fixture-history.json");
const logFile = join(root, "native-fixture-requests.jsonl");
const nativeId = "fixture-native-existing";
const rollout = join(root, "sessions", "native-fixture.jsonl");
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9xkAAAAASUVORK5CYII=";
if (process.argv.includes("--version")) { process.stdout.write(`${process.env.FAKE_CODEX_NATIVE_VERSION ?? "codex-cli 0.163.0"}\n`); process.exit(0); }
if (process.argv.includes("login")) { process.stderr.write("Logged in using ChatGPT\n"); process.exit(0); }
mkdirSync(join(root, "sessions"), { recursive: true });
writeFileSync(rollout, [
  { type: "session_meta", payload: { id: nativeId } },
  { type: "event_msg", payload: { type: "thread_settings_applied", thread_id: nativeId, thread_settings: { cwd: root, approval_policy: "on-request", permission_profile: { fixture: "read-only" } } } },
].map((item) => JSON.stringify(item)).join("\n"));
const send = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);
const turns: any[] = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : [{ id: "existing-fixture-turn", status: "completed", items: [{ id: "existing-fixture-image", type: "imageGeneration", result: png, status: "completed" }] }];
const persist = () => writeFileSync(stateFile, JSON.stringify(turns));
const thread = () => ({ id: nativeId, path: rollout, name: "Native fixture conversation", model: "fixture-native-model", modelProvider: "openai", reasoningEffort: "high", cwd: root, status: { type: "idle" }, turns: [] });
const notify = (method: string, params: any) => send({ method, params: { threadId: nativeId, ...params } });
const finish = (status = "completed") => {
  const turn = turns.at(-1)!;
  turn.status = status;
  if (status === "completed") turn.items.push({ id: `reply-${turn.id}`, type: "agentMessage", text: `Native fixture reply: ${turn.items[0].content.filter((input: any) => input.type === "text").map((input: any) => input.text).join("")}` });
  persist();
  for (const item of turn.items.slice(1)) notify("item/completed", { turnId: turn.id, item });
  notify("turn/completed", { turn });
};
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (!message.method) {
    appendFileSync(logFile, `${JSON.stringify({ reply: message })}\n`);
    if (message.id === "native-approval") finish(message.result?.decision === "accept" ? "completed" : "interrupted");
    return;
  }
  appendFileSync(logFile, `${JSON.stringify({ method: message.method, params: message.params, argv: process.argv.slice(2) })}\n`);
  if (message.id === undefined) return;
  const reply = (result: unknown) => send({ id: message.id, result });
  const params = message.params ?? {};
  switch (message.method) {
    case "initialize": reply({ userAgent: "codex/0.163.0", codexHome: root, platformFamily: "unix", platformOs: "linux" }); break;
    case "account/read": reply({ account: { type: "chatgpt", email: "fixture@example.test", planType: "pro" }, requiresOpenaiAuth: true }); break;
    case "config/read": reply({ config: { model_provider: "openai" } }); break;
    case "model/list": reply({ data: [{ id: "fixture-native-model", model: "fixture-native-model", displayName: "Fixture native", defaultReasoningEffort: "high", supportedReasoningEfforts: [{ reasoningEffort: "high", description: "High" }] }], nextCursor: null }); break;
    case "thread/list": reply({ data: [thread()], nextCursor: null }); break;
    case "thread/read": reply({ thread: thread() }); break;
    case "thread/resume": reply({ thread: thread(), model: "fixture-native-model", modelProvider: "openai", cwd: root, approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: { type: "readOnly" }, reasoningEffort: "high", collaborationMode: null }); break;
    case "thread/turns/list": reply({ data: turns, nextCursor: null }); break;
    case "turn/start": {
      if (params.threadId !== nativeId || Object.keys(params).some((key) => !["threadId", "input", "clientUserMessageId"].includes(key))) { send({ id: message.id, error: { code: -32600, message: "Unexpected native target or overrides" } }); break; }
      const turn = { id: `native-fixture-turn-${turns.length}`, status: "inProgress", items: [{ id: `user-${params.clientUserMessageId}`, type: "userMessage", clientId: params.clientUserMessageId, content: params.input }] };
      turns.push(turn); persist();
      reply({ turn }); notify("turn/started", { turn });
      const text = JSON.stringify(params.input);
      if (text.includes("approval fixture")) send({ id: "native-approval", method: "item/commandExecution/requestApproval", params: { threadId: nativeId, turnId: turn.id, itemId: "fixture-command", command: "pwd", cwd: root, reason: "Harmless fixture approval" } });
      else if (!text.includes("hold fixture")) finish();
      break;
    }
    case "turn/interrupt": finish("interrupted"); reply({}); break;
    default: send({ id: message.id, error: { code: -32601, message: "Unsupported fixture operation" } });
  }
});
