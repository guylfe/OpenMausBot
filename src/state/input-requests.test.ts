import { describe, expect, it } from "vitest";
import type { BotInputRequest } from "../../shared/input-requests";
import { createInputRequestStore } from "./input-requests";

const row = (threadId = "subthread", id = "request"): BotInputRequest => ({
  botId: "atlas", threadId, title: "Site review", message: { id, at: 1, role: "bot", kind: "options",
    card: { title: "Which page?", subtitle: "Choose", requestType: "question", requestId: id, options: ["Home", "Pricing"] } },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("live input request projections", () => {
  it("deduplicates reconnect snapshots while retaining requests from separate conversations", async () => {
    const first = row(), second = row("other");
    const store = createInputRequestStore(async () => ({ requests: [first, first, second] }));
    await store.refresh();
    await store.refresh();
    expect(store.get().requests).toEqual([first, second]);
  });

  it("ignores a stale snapshot after another window answers, then reads the newest state", async () => {
    const stale = deferred<{ requests: BotInputRequest[] }>();
    let calls = 0;
    const store = createInputRequestStore(() => ++calls === 1 ? stale.promise : Promise.resolve({ requests: [] }));
    const reading = store.refresh();
    store.frame({ kind: "message.patch", threadId: "subthread", message: { ...row().message, card: { ...row().message.card!, answered: "answer" } } });
    stale.resolve({ requests: [row()] });
    await reading;
    expect(calls).toBe(2);
    expect(store.get().requests).toEqual([]);
  });

  it("removes an answered card immediately, before refresh completes", async () => {
    const pending = deferred<{ requests: BotInputRequest[] }>();
    let calls = 0;
    const store = createInputRequestStore(() => ++calls === 1 ? Promise.resolve({ requests: [row()] }) : pending.promise);
    await store.refresh();
    store.frame({ kind: "message.patch", threadId: "subthread", message: { ...row().message, card: { ...row().message.card!, dismissed: true } } });
    expect(store.get().requests).toEqual([]);
    pending.resolve({ requests: [] });
    await store.refresh();
    expect(store.get().requests).toEqual([]);
  });

  it("clears on a session change and rejects late responses even when a transport ignores abort", async () => {
    const old = deferred<{ requests: BotInputRequest[] }>();
    let calls = 0;
    const store = createInputRequestStore(() => ++calls === 1 ? old.promise : Promise.resolve({ requests: [] }));
    const reading = store.refresh();
    store.clear();
    await store.refresh();
    old.resolve({ requests: [row()] });
    await reading;
    expect(store.get().requests).toEqual([]);
    expect(calls).toBe(2);
  });

  it("reports read failure and recovers without inventing a resolved request", async () => {
    let fails = true;
    const store = createInputRequestStore(async () => { if (fails) throw new Error("offline"); return { requests: [row()] }; });
    await store.refresh();
    expect(store.get()).toMatchObject({ failed: true, loading: false });
    fails = false;
    await store.refresh();
    expect(store.get()).toMatchObject({ failed: false, loaded: true, requests: [row()] });
  });
});
