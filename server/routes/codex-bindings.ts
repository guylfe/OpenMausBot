import type { CodexBindings } from "../codex-bindings.ts";
import { ownerOrAdmin } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createCodexBindingRoutes(deps: { bridge: Pick<CodexBindings, "view" | "list" | "bind" | "reconnect" | "cancel" | "acknowledge" | "disconnect">; enabled: boolean; instances(): Array<{ id: string; name: string }> }): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    const match = path.match(/^\/api\/bots\/([\w-]+)\/threads\/([\w-]+)\/codex(?:\/(reconnect|cancel|acknowledge))?$/);
    if (path !== "/api/codex/conversations" && !match) return PASS;
    if (!ownerOrAdmin(auth) || !deps.enabled) return json(res, 403, { error: "Existing Codex conversations are available only to the owner of a local OpenMausBot workspace." });
    if (path === "/api/codex/conversations" && method === "GET") {
      const instances = deps.instances();
      const instanceId = url.searchParams.get("instanceId");
      if (!instanceId) return json(res, 200, { instances });
      if (!instances.some((instance) => instance.id === instanceId)) return json(res, 404, { error: "No supported native Codex instance." });
      return json(res, 200, await deps.bridge.list(instanceId, (url.searchParams.get("search") ?? "").slice(0, 200), url.searchParams.get("cursor") ?? undefined));
    }
    if (!match) return json(res, 405, { error: "Method not supported." });
    const [, botId, threadId, action] = match as [string, string, string, string?];
    deps.bridge.view(botId, threadId);
    if (method === "GET" && !action) return json(res, 200, deps.bridge.view(botId, threadId));
    if (method === "DELETE" && !action) { await deps.bridge.disconnect(botId, threadId); return json(res, 200, deps.bridge.view(botId, threadId)); }
    if (method !== "POST" && method !== "PUT") return json(res, 405, { error: "Method not supported." });
    const body = await readBody(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, 400, { error: "Send a JSON object." });
    const keys = action === "cancel" || action === "acknowledge" ? ["sendId"] : action === "reconnect" ? [] : ["instanceId", "conversationId"];
    if (Object.keys(body).some((key) => !keys.includes(key))) return json(res, 400, { error: "Unsupported connection setting. Codex's saved settings cannot be overridden here." });
    if (action === "reconnect" && method === "POST") return json(res, 200, await deps.bridge.reconnect(botId, threadId));
    if (action === "cancel" && method === "POST") {
      if (body.sendId !== undefined && typeof body.sendId !== "string") return json(res, 400, { error: "sendId must be a string." });
      await deps.bridge.cancel(botId, threadId, body.sendId);
      return json(res, 200, deps.bridge.view(botId, threadId));
    }
    if (action === "acknowledge" && method === "POST" && typeof body.sendId === "string") {
      deps.bridge.acknowledge(botId, threadId, body.sendId);
      return json(res, 200, deps.bridge.view(botId, threadId));
    }
    if (!action && method === "PUT" && typeof body.instanceId === "string" && typeof body.conversationId === "string") {
      if (!deps.instances().some((instance) => instance.id === body.instanceId)) return json(res, 404, { error: "No supported native Codex instance." });
      const result = await deps.bridge.bind(botId, threadId, body.instanceId, body.conversationId);
      return json(res, result.connected ? 200 : 409, result);
    }
    return json(res, 400, { error: "Select a Codex instance and an exact existing conversation." });
  };
}
