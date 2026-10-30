import { inputRequestKey, inputRequestOpen, type BotInputRequest } from "../../shared/input-requests.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { Message, Store } from "../store.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface InputRequestRouteDeps {
  store: Pick<Store, "bots" | "tasks" | "activePath" | "onChange">;
  /** Security: evaluate both bot and conversation visibility, and the addressed person on a Team Cloud, for this session. */
  shown(auth: RequestAuth, botId: string, threadId: string): boolean;
}

/** GET /api/input-requests returns only this session's original, still-open bot cards. Answers use the original routes. */
export function createInputRequestRoutes({ store, shown }: InputRequestRouteDeps): RouteHandler {
  const cached = new Map<string, Message[]>();
  store.onChange((change) => {
    if (change.type === "thread" || change.type === "thread.deleted" || change.type === "message" || change.type === "message.patch") {
      cached.delete(change.threadId);
    }
    if (change.type === "bot.deleted") cached.clear();
  });
  return async ({ path, method, auth, res, json }) => {
    if (path !== "/api/input-requests") return PASS;
    if (method !== "GET") return json(res, 405, { error: "method not allowed" });
    const requests = new Map<string, BotInputRequest>();
    const existing = new Set<string>();
    for (const bot of store.bots) for (const task of store.tasks(bot.id)) {
      existing.add(task.threadId);
      if (!shown(auth, bot.id, task.threadId)) continue;
      let messages = cached.get(task.threadId);
      if (!messages) {
        messages = store.activePath(task.threadId).filter((message) => inputRequestOpen(message) && !message.inbox && !message.automation?.copyOf);
        cached.set(task.threadId, messages);
      }
      for (const message of messages) {
        const { id, at, role, kind, text, card, secret, signIn, connector } = message;
        const row: BotInputRequest = { botId: bot.id, threadId: task.threadId, title: task.title,
          message: { id, at, role, kind, text, card, secret, signIn, connector } };
        requests.set(inputRequestKey(row), row);
      }
    }
    for (const threadId of cached.keys()) if (!existing.has(threadId)) cached.delete(threadId);
    res.setHeader("cache-control", "private, no-store");
    return json(res, 200, { requests: [...requests.values()].sort((a, b) => a.message.at - b.message.at || inputRequestKey(a).localeCompare(inputRequestKey(b))) });
  };
}
