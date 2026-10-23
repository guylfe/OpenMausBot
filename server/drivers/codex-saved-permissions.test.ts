import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { verifyCodexSavedPermissions } from "./codex-saved-permissions.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "omb-saved-codex-")); dirs.push(home);
  mkdirSync(join(home, "sessions"));
  const path = join(home, "sessions", "fixture.jsonl");
  const meta = { type: "session_meta", payload: { id: "selected-thread" } };
  const snapshot = { type: "event_msg", payload: { type: "thread_settings_applied", thread_id: "selected-thread", thread_settings: { cwd: home, approval_policy: "on-request", permission_profile: { fixture: "read-only" } } } };
  const write = (items: unknown[]) => writeFileSync(path, items.map((item) => JSON.stringify(item)).join("\n"));
  return { home, path, meta, snapshot, write };
}

it("requires a thread-owned saved permission snapshot before resuming", async () => {
  const h = fixture(); h.write([h.meta, h.snapshot]);
  await expect(verifyCodexSavedPermissions(h.home, { id: "selected-thread", path: h.path })).resolves.toBeUndefined();
});

it("refuses old histories and copied snapshots from another thread", async () => {
  const h = fixture();
  for (const items of [[h.meta], [h.meta, { ...h.snapshot, payload: { ...h.snapshot.payload, thread_id: "foreign-thread" } }], [{ ...h.meta, payload: { id: "foreign-thread" } }, h.snapshot]]) {
    h.write(items);
    await expect(verifyCodexSavedPermissions(h.home, { id: "selected-thread", path: h.path })).rejects.toThrow(/could not be verified/);
  }
});

it("refuses missing, remote-only, corrupt and outside-store histories", async () => {
  const h = fixture(); h.write([h.meta, h.snapshot]);
  await expect(verifyCodexSavedPermissions(h.home, { id: "selected-thread" })).rejects.toThrow();
  await expect(verifyCodexSavedPermissions(join(h.home, "another-account"), { id: "selected-thread", path: h.path })).rejects.toThrow();
  writeFileSync(h.path, "{corrupt");
  await expect(verifyCodexSavedPermissions(h.home, { id: "selected-thread", path: h.path })).rejects.toThrow();
});
