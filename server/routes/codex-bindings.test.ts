import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it, vi } from "vitest";
import { json, readBody } from "../harness/http.ts";
import { requiredScope, type RequestAuth } from "../request-auth.ts";
import { createCodexBindingRoutes } from "./codex-bindings.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))); });
async function fixture(auth: RequestAuth = { kind: "loopback", scopes: ["admin"] }, enabled = true) {
  const disconnected = { configured: false, connected: false, state: "disconnected" as const, deliveries: [] };
  const bridge = {
    view: vi.fn(() => disconnected), list: vi.fn(async () => ({ conversations: [] })),
    bind: vi.fn(async () => ({ ...disconnected, configured: true, state: "failed" as const })),
    reconnect: vi.fn(async () => disconnected), cancel: vi.fn(async () => {}), acknowledge: vi.fn(), disconnect: vi.fn(async () => {}),
  };
  const route = createCodexBindingRoutes({ bridge, enabled, instances: () => [{ id: "codex", name: "Native Codex" }] });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    try {
      if (!await dispatchRoutes([route], { req, res, url, path: url.pathname, method: req.method!, auth, json, readBody })) json(res, 404, {});
    } catch (error) { json(res, (error as { status?: number }).status ?? 500, { error: "refused" }); }
  });
  servers.push(server); await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  return { bridge, request };
}
const path = "/api/bots/owner-bot/threads/owner-thread/codex";

it("keeps conversation discovery, inspection and mutation admin scoped", () => {
  for (const [method, url] of [["GET", "/api/codex/conversations"], ["GET", path], ["PUT", path], ["DELETE", path], ["POST", `${path}/cancel`]]) expect(requiredScope(method!, url!)).toBe("admin");
});

it("refuses service loopback and hosted environments before reading native history", async () => {
  for (const [auth, enabled] of [[{ kind: "loopback", trust: "service", scopes: ["client"] }, true], [{ kind: "loopback", scopes: ["admin"] }, false]] as const) {
    const h = await fixture(auth as RequestAuth, enabled);
    expect((await h.request("GET", "/api/codex/conversations?instanceId=codex")).status).toBe(403);
    expect((await h.request("GET", path)).status).toBe(403);
    expect(h.bridge.list).not.toHaveBeenCalled(); expect(h.bridge.view).not.toHaveBeenCalled();
  }
});

it("validates instance ownership and forbids configuration overrides", async () => {
  const h = await fixture();
  expect((await h.request("GET", "/api/codex/conversations?instanceId=foreign")).status).toBe(404);
  expect((await h.request("PUT", path, { instanceId: "codex", conversationId: "existing", approvalPolicy: "never" })).status).toBe(400);
  expect((await h.request("PUT", path, { instanceId: "foreign", conversationId: "existing" })).status).toBe(404);
  expect(h.bridge.bind).not.toHaveBeenCalled();
});

it("returns a failed connection as configured but inactive, and exposes reconnect and disconnect", async () => {
  const h = await fixture();
  expect(await h.request("PUT", path, { instanceId: "codex", conversationId: "existing" })).toMatchObject({ status: 409, body: { configured: true, connected: false, state: "failed" } });
  expect(h.bridge.bind).toHaveBeenCalledWith("owner-bot", "owner-thread", "codex", "existing");
  expect((await h.request("POST", `${path}/reconnect`, {})).status).toBe(200);
  expect((await h.request("DELETE", path)).status).toBe(200);
  expect(h.bridge.disconnect).toHaveBeenCalledWith("owner-bot", "owner-thread");
});

it("scopes cancellation and uncertain-delivery review to the exact bot and thread", async () => {
  const h = await fixture();
  expect((await h.request("POST", `${path}/cancel`, { sendId: "stable-send-identifier" })).status).toBe(200);
  expect(h.bridge.cancel).toHaveBeenCalledWith("owner-bot", "owner-thread", "stable-send-identifier");
  expect((await h.request("POST", `${path}/acknowledge`, { sendId: "stable-send-identifier" })).status).toBe(200);
  expect(h.bridge.acknowledge).toHaveBeenCalledWith("owner-bot", "owner-thread", "stable-send-identifier");
});
