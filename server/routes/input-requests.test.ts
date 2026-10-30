import { rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DATA_DIR } from "../config.ts";
import { VisibleSet } from "../bot-visibility.ts";
import type { Audience } from "../audience.ts";
import { requiredScope, serviceAllowed, type RequestAuth } from "../request-auth.ts";
import { Store, type Message } from "../store.ts";
import { createInputRequestRoutes } from "./input-requests.ts";
import type { RouteContext } from "./table.ts";

const owner: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
const selection = () => ({ instanceId: "fixture", model: "fixture" });
beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));
const ask = (id: string, extra: Partial<NonNullable<Message["card"]>> = {}): Omit<Message, "id" | "at"> => ({
  role: "bot", kind: "options", card: { requestId: id, requestType: "question", title: "Which page?", subtitle: "Choose a page", options: ["Home", "Pricing"], ...extra },
});

function setup(store = new Store(selection), audiences = new Map<string, Audience>()) {
  const reads = vi.spyOn(store, "activePath");
  const route = createInputRequestRoutes({ store, shown: (auth, botId, threadId) => {
    const email = auth.kind === "session" ? auth.session.email : undefined;
    const visible = new VisibleSet(store.bots, store.groups, auth.kind === "loopback" ? { kind: "all" } : { kind: "member", email },
      (id) => { const bot = store.botByThread(id); return bot ? { bot: bot.id } : undefined; },
      audiences.size ? { of: (id) => audiences.get(id) ?? "team", person: email ?? null } : undefined);
    return visible.bot(botId) && visible.thread(threadId);
  } });
  const call = async (auth = owner, method = "GET") => {
    let response: { status: number; body: { requests: Array<{ botId: string; threadId: string; title: string; message: Message }> } } | undefined;
    await route({ auth, path: "/api/input-requests", method, req: {} as IncomingMessage, res: { setHeader() {} } as unknown as ServerResponse,
      json: ((_res, status, body) => { response = { status, body: body as NonNullable<typeof response>["body"] }; }) as RouteContext["json"] } as RouteContext);
    return response!;
  };
  return { store, call, reads };
}

describe("original bot input requests", () => {
  it("finds concurrent subthread cards independently of the selected conversation and deduplicates request ids only within their origin", async () => {
    const { store, call } = setup();
    const bot = store.createBot({ name: "Atlas" });
    const main = bot.threadId;
    const first = store.createTask(bot.id, "Site review")!.threadId;
    const second = store.createTask(bot.id, "Weekly report")!.threadId;
    store.appendMessage(first, ask("same-id"));
    const latest = store.appendMessage(first, ask("same-id", { subtitle: "Updated wording" }));
    store.appendMessage(second, ask("same-id", { tool: "Bash", requestType: "permission" }));
    const rows = (await call()).body.requests;
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ botId: bot.id, threadId: first, title: "Site review", message: expect.objectContaining({ id: latest.id }) }),
      expect.objectContaining({ botId: bot.id, threadId: second, title: "Weekly report" }),
    ]));
    expect(store.messagesFor(main).some((message) => message.card?.requestId === "same-id")).toBe(false);
  });

  it("revalidates resolution, expiry, branch changes and deletion after a cached read", async () => {
    const { store, call, reads } = setup();
    const bot = store.createBot({ name: "Atlas" });
    const thread = store.createTask(bot.id, "Review")!.threadId;
    const root = store.appendMessage(thread, { role: "user", kind: "text", text: "Review it" });
    const card = store.appendMessage(thread, ask("question"));
    expect((await call()).body.requests).toHaveLength(1);
    const count = reads.mock.calls.length;
    await call();
    expect(reads).toHaveBeenCalledTimes(count);
    store.patchMessage(thread, card.id, { card: { ...card.card!, expired: true } });
    expect((await call()).body.requests).toEqual([]);
    store.appendMessage(thread, ask("again"));
    expect((await call()).body.requests).toHaveLength(1);
    store.appendMessage(thread, { role: "bot", kind: "text", text: "A different branch", parentId: root.id });
    expect((await call()).body.requests).toEqual([]);
    store.appendMessage(thread, ask("third"));
    expect((await call()).body.requests).toHaveLength(1);
    store.deleteTask(bot.id, thread);
    expect((await call()).body.requests).toEqual([]);
  });

  it("restores open persisted questions after rebuilding the store and leaves other bot settings intact", async () => {
    const { store } = setup();
    const bot = store.createBot({ name: "Atlas" });
    const thread = store.createTask(bot.id, "Follow-up")!.threadId;
    store.appendMessage(thread, ask("persisted"));
    const restored = setup(new Store(selection));
    expect((await restored.call()).body.requests).toMatchObject([{ botId: bot.id, threadId: thread, message: { card: { requestId: "persisted" } } }]);
    expect(restored.store.projectBotForTask(bot.id, thread)?.modelSelection).toEqual(selection());
  });

  it("filters private conversations and restricted bots for every session even after an owner primed the cache", async () => {
    const audiences = new Map<string, Audience>();
    const { store, call, reads } = setup(undefined, audiences);
    const bot = store.createBot({ name: "Atlas" });
    const privateThread = store.createTask(bot.id, "Private plan")!.threadId;
    audiences.set(privateThread, "member:a@example.test");
    store.appendMessage(privateThread, ask("private"));
    const restricted = store.createBot({ name: "Restricted" });
    store.patchBot(restricted.id, { visibility: "admins" });
    store.appendMessage(restricted.threadId, ask("restricted"));
    expect((await call()).body.requests.map((row) => row.message.card?.requestId)).toEqual(["restricted"]);
    const session = (email: string): RequestAuth => ({ kind: "session", scopes: ["client"], via: "cookie",
      session: { id: email, email, tokenHash: "fixture", label: "Fixture", scopes: ["client"], createdAt: 1, lastSeenAt: 1, expiresAt: 9999999999999 } });
    expect((await call(session("a@example.test"))).body.requests.map((row) => row.message.card?.requestId)).toEqual(["private"]);
    reads.mockClear();
    expect((await call(session("b@example.test"))).body.requests).toEqual([]);
    expect(reads.mock.calls.some(([id]) => id === privateThread || id === restricted.threadId)).toBe(false);
  });

  it("includes archived open cards but skips inbox copies, resolved cards and unrelated payloads", async () => {
    const { store, call } = setup();
    const bot = store.createBot({ name: "Atlas" });
    const thread = store.createTask(bot.id, "Archived review")!.threadId;
    store.patchTask(bot.id, thread, { archivedAt: 1 });
    store.appendMessage(thread, { ...ask("open"), tool: { name: "Private tool output", input: "unrelated detail" }, attachments: [{ name: "unrelated.png", mime: "image/png" }] } as never);
    store.appendMessage(thread, { ...ask("copy"), inbox: { kind: "ask", from: { name: "Atlas" } } });
    store.appendMessage(thread, ask("answered", { answered: "answer" }));
    store.appendMessage(thread, ask("stopped", { stopped: true }));
    store.appendMessage(thread, ask("automatic", { autoApplied: true }));
    const rows = (await call()).body.requests;
    expect(rows).toHaveLength(1);
    expect(rows[0].message).not.toHaveProperty("tool");
    expect(rows[0].message).not.toHaveProperty("attachments");
    expect(requiredScope("GET", "/api/input-requests")).toBe("client");
    expect(serviceAllowed("GET", "/api/input-requests")).toBe(false);
    expect((await call(owner, "POST")).status).toBe(405);
  });
});
