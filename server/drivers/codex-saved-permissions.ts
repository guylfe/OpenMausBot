import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

function contained(root: string, file: string): boolean {
  const suffix = relative(root, file);
  return suffix !== "" && suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix);
}

/** Codex 0.163.0 restores permissions from a thread-owned ThreadSettingsApplied rollout snapshot. */
export async function verifyCodexSavedPermissions(home: string, thread: { id: string; path?: unknown }): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    if (typeof thread.path !== "string" || !isAbsolute(thread.path)) throw new Error();
    const canonicalFile = await realpath(thread.path);
    const roots = await Promise.all(["sessions", "archived_sessions"].map((directory) => realpath(join(home, directory)).catch(() => null)));
    if (!roots.some((root) => root && contained(root, canonicalFile))) throw new Error();
    handle = await open(canonicalFile, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = await handle.stat();
    if (!before.isFile() || before.size <= 0 || before.size > 64 * 1024 * 1024) throw new Error();
    let sessionId: string | undefined;
    let snapshot = false;
    for (const line of (await handle.readFile("utf8")).split("\n")) {
      if (!line.trim()) continue;
      const item = JSON.parse(line);
      if (item.type === "session_meta") sessionId = item.payload?.id;
      if (item.type === "event_msg" && item.payload?.type === "thread_settings_applied" && item.payload.thread_id === thread.id) {
        const settings = item.payload.thread_settings;
        snapshot = Boolean(settings && typeof settings.cwd === "string" && settings.approval_policy !== undefined && settings.permission_profile && typeof settings.permission_profile === "object");
      }
    }
    const after = await handle.stat();
    if (sessionId !== thread.id || !snapshot || before.size !== after.size || before.mtimeMs !== after.mtimeMs || await realpath(thread.path) !== canonicalFile) throw new Error();
  } catch {
    throw new Error("Codex's saved permission snapshot could not be verified. No conversation was resumed or message sent. Review and save the original conversation's settings in Codex 0.163.x before connecting; remote-only or unsupported history stores cannot be bound.");
  } finally { await handle?.close(); }
}
