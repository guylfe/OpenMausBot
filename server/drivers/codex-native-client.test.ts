import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { connectCodexNative, type CodexNativeClient } from "./codex-native-client.ts";

const clients: CodexNativeClient[] = [];
const dirs: string[] = [];
afterEach(async () => { await Promise.all(clients.splice(0).map((client) => client.close())); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const cli = fileURLToPath(new URL("../testing/fake-codex-native.ts", import.meta.url));

it("uses the native stdio protocol without model, sandbox, approval or MCP overrides", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omb-native-cli-")); dirs.push(dir);
  const client = await connectCodexNative(cli, { ...process.env, HOME: dir, USERPROFILE: dir, FAKE_CODEX_NATIVE_DIR: dir }); clients.push(client);
  expect(client.home).toBe(dir);
  const result = await client.request("thread/resume", { threadId: "fixture-native-existing", excludeTurns: true });
  expect(result.thread.id).toBe("fixture-native-existing");
  const calls = readFileSync(join(dir, "native-fixture-requests.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  expect(calls.map((call) => call.method)).toEqual(["initialize", "initialized", "thread/resume"]);
  expect(calls.every((call) => call.argv.includes("app-server") && !call.argv.includes("-c"))).toBe(true);
});

it("refuses installed versions without verified settings preservation before any app-server runs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omb-native-version-")); dirs.push(dir);
  await expect(connectCodexNative(cli, { ...process.env, HOME: dir, USERPROFILE: dir, FAKE_CODEX_NATIVE_DIR: dir, FAKE_CODEX_NATIVE_VERSION: "codex-cli 0.159.2" })).rejects.toThrow(/0.163/);
  expect(() => readFileSync(join(dir, "native-fixture-requests.jsonl"))).toThrow();
});
