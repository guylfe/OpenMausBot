import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";
import { openSse } from "./testing/sse.ts";

it("relays through the real isolated server routes, SSE, approval cards and inline attachment URLs", async () => {
  const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, undefined, ["codex"]);
  const { url, dataDir, logPath } = fixture.info;
  const events = await openSse(`${url}/api/events`);
  const api = async (method: string, path: string, body?: unknown, expected = 200) => {
    const response = await fetch(`${url}${path}`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60_000) });
    const result = await response.json() as any;
    expect(response.status, `${JSON.stringify(result)}; fixture log: ${logPath}`).toBe(expected);
    return result;
  };
  try {
    const wrapper = join(dataDir, "native-codex-fixture.mjs");
    writeFileSync(wrapper, [
      `#!${process.execPath}`,
      `process.env.FAKE_CODEX_NATIVE_DIR = ${JSON.stringify(dataDir)};`,
      `await import(${JSON.stringify(pathToFileURL(fileURLToPath(new URL("./testing/fake-codex-native.ts", import.meta.url))).href)});`,
    ].join("\n"), { mode: 0o700 });
    await api("PATCH", "/api/instances/codex", { cli: wrapper });
    const bot = (await api("POST", "/api/bots", { name: "Native Codex relay fixture" }, 201)).bot;
    const path = `/api/bots/${bot.id}/threads/${bot.threadId}/codex`;
    const list = await api("GET", "/api/codex/conversations?instanceId=codex");
    expect(list.conversations).toEqual([{ id: "fixture-native-existing", title: "Native fixture conversation", cwd: dataDir }]);
    const connected = await api("PUT", path, { instanceId: "codex", conversationId: "fixture-native-existing" });
    expect(connected).toMatchObject({ connected: true, state: "ready", settings: { model: "fixture-native-model", reasoningEffort: "high", approvalPolicy: "on-request", sandbox: { type: "readOnly" } } });
    const messages = (await api("GET", `/api/threads/${bot.threadId}/messages?limit=100`)).messages;
    const image = messages.find((message: any) => message.codex?.itemId === "existing-fixture-image");
    expect(image.attachments[0]).toMatchObject({ kind: "image", mime: "image/png", path: expect.stringMatching(/\.png$/) });
    const downloaded = await fetch(`${url}/api/attachments/${basename(image.attachments[0].path)}`);
    expect(downloaded.headers.get("content-type")).toContain("image/png");
    expect((await downloaded.arrayBuffer()).byteLength).toBeGreaterThan(0);
    const text = "  harmless exact text 😀\n  ";
    const receipt = await api("POST", `/api/bots/${bot.id}/messages`, { threadId: bot.threadId, text, sendId: "native-fixture-send-001" }, 202);
    expect(receipt.message.text).toBe(text);
    const reply = await events.until((event) => event.kind === "message" && event.threadId === bot.threadId && event.message?.text === `Native fixture reply: ${text}`);
    expect(reply.message.codex.conversationId).toBe("fixture-native-existing");
    const retried = await api("POST", `/api/bots/${bot.id}/messages`, { threadId: bot.threadId, text, sendId: "native-fixture-send-001" }, 202);
    expect(retried.message.id).toBe(receipt.message.id);
    await api("POST", `/api/bots/${bot.id}/messages`, { threadId: bot.threadId, text: "approval fixture", sendId: "native-fixture-send-002" }, 202);
    const ask = await events.until((event) => event.kind === "message" && event.threadId === bot.threadId && event.message?.card?.tool === "Codex");
    expect((await api("GET", path)).state).toBe("awaiting-approval");
    await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: ask.message.card.requestId, behavior: "allow", always: true }, 400);
    await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: ask.message.card.requestId, behavior: "allow" });
    await events.until((event) => event.kind === "message" && event.threadId === bot.threadId && event.message?.text === "Native fixture reply: approval fixture");
    await api("POST", `/api/bots/${bot.id}/compact`, { threadId: bot.threadId }, 409);
    await api("DELETE", path);
    expect((await api("GET", path)).configured).toBe(false);
    const calls = readFileSync(join(dataDir, "native-fixture-requests.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(calls.filter((call) => call.method === "turn/start")).toHaveLength(2);
    expect(calls.some((call) => call.method === "thread/start" || call.method === "thread/fork")).toBe(false);
    expect(calls.find((call) => call.reply)?.reply.result).toEqual({ decision: "accept" });
    await api("PATCH", "/api/instances/codex", { cli: fileURLToPath(new URL("./testing/fake-codex-app-server.ts", import.meta.url)) });
    const incompatible = await api("PUT", path, { instanceId: "codex", conversationId: "fixture-native-existing" }, 409);
    expect(incompatible).toMatchObject({ configured: true, connected: false, state: "failed" });
    await api("POST", `/api/bots/${bot.id}/messages`, { threadId: bot.threadId, text: "must not get a fallback answer", sendId: "native-fixture-send-003" }, 409);
    const failedMessages = (await api("GET", `/api/threads/${bot.threadId}/messages?limit=100`)).messages;
    expect(failedMessages.some((message: any) => message.text === "must not get a fallback answer")).toBe(false);
    await api("DELETE", path);
    console.log(`Native Codex fixture verification passed; log: ${logPath}`);
  } finally { events.close(); await fixture.close(); }
}, 120_000);
