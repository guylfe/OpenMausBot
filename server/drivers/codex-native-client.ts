import { homedir } from "node:os";
import { realpath } from "node:fs/promises";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { execCli, killCliTree, spawnCli } from "../procs.ts";
import { codexLaunch } from "./codex-process.ts";
import { verifyCodexSavedPermissions } from "./codex-saved-permissions.ts";

export interface CodexNativeClient {
  readonly home: string;
  verifySavedPermissions(thread: { id: string; path?: unknown }): Promise<void>;
  request(method: string, params: unknown): Promise<any>;
  reply(id: string | number, result: unknown): void;
  reject(id: string | number): void;
  onMessage(listener: (message: any) => void | Promise<void>): void;
  onClose(listener: () => void): void;
  close(): Promise<void>;
}

export class CodexNativeRejection extends Error {}

/** Codex 0.163.x app-server, generated locally with `app-server generate-ts`; no configuration overrides. */
export async function connectCodexNative(cli: string, env: Record<string, string | undefined>): Promise<CodexNativeClient> {
  const version = await new Promise<string>((resolve, reject) => {
    execCli(cli, ["--version"], { env, timeout: 8_000 }, (error, stdout) => error ? reject(new Error("Codex CLI is unavailable.")) : resolve(stdout.trim()));
  });
  if (!/^codex-cli 0\.163\.\d+$/.test(version)) throw new Error("Existing conversation connections require Codex 0.163.x. This CLI version has not been verified.");
  if (/(?:^|\s)(?:-c|--config|--profile|-p|--model|-m|--sandbox|--ask-for-approval)(?:\s|=|$)/.test(cli)) {
    throw new Error("Use a Codex CLI without configuration overrides for an existing conversation.");
  }
  const child = spawnCli(...codexLaunch(cli, ["app-server"]), {
    env, cwd: env.HOME || env.USERPROFILE || homedir(), stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;
  let sequence = 0;
  let closed = false;
  let stopping: Promise<void> | undefined;
  let buffer = "";
  let messageListener: (message: any) => void = () => {};
  const closeListeners = new Set<() => void>();
  let home = "";
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  const fail = () => {
    if (closed) return;
    closed = true;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("Codex connection closed; delivery may be uncertain."));
    }
    pending.clear();
    for (const listener of closeListeners) listener();
  };
  const send = (message: unknown) => {
    if (closed || !child.stdin.writable) throw new Error("Codex is disconnected.");
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  const close = () => stopping ??= (async () => {
    fail();
    if (!await killCliTree(child, 3_000)) throw new Error("The Codex process could not be confirmed stopped.");
  })();
  child.stderr.resume();
  child.on("error", fail);
  child.on("close", fail);
  child.stdin.on("error", fail);
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > 64 * 1024 * 1024) { void close().catch(() => {}); return; }
    let newline: number;
    while (!closed && (newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message: any;
      try { message = JSON.parse(line); } catch { void close().catch(() => {}); return; }
      if (message && typeof message.id === "number" && !message.method) {
        const request = pending.get(message.id);
        if (!request) continue;
        pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.error) request.reject(new CodexNativeRejection("Codex rejected the request. Check the conversation and account in Codex."));
        else request.resolve(message.result);
      } else if (message?.method) messageListener(message);
    }
  });
  const client: CodexNativeClient = {
    get home() { return home; },
    verifySavedPermissions: (thread) => verifyCodexSavedPermissions(home, thread),
    request: (method, params) => new Promise((resolve, reject) => {
      if (closed) { reject(new Error("Codex is disconnected.")); return; }
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Codex request timed out; delivery may be uncertain."));
        void close().catch(() => {});
      }, 30_000);
      timer.unref();
      pending.set(id, { resolve, reject, timer });
      try { send({ id, method, params }); } catch { void close().catch(() => {}); }
    }),
    reply: (id, result) => send({ id, result }),
    reject: (id) => send({ id, error: { code: -32601, message: "Unsupported OpenMausBot approval interface; no action was approved." } }),
    onMessage: (listener) => { messageListener = listener; },
    onClose: (listener) => { closeListeners.add(listener); if (closed) listener(); },
    close,
  };
  try {
    const initialized = await client.request("initialize", { clientInfo: { name: "openmausbot_native_bridge", version: "1" } });
    if (typeof initialized?.codexHome !== "string" || !initialized.codexHome) throw new Error("Codex did not identify its local conversation store.");
    home = await realpath(initialized.codexHome);
    send({ method: "initialized", params: {} });
    return client;
  } catch (error) { await close(); throw error; }
}

export function codexNativeAccess(cli: string, env: () => Record<string, string | undefined>, disposed: () => boolean) {
  const clients = new Set<CodexNativeClient>();
  return {
    connect: async () => {
      if (disposed()) throw new Error("This Codex instance was removed.");
      const client = await connectCodexNative(cli, env());
      if (disposed()) { await client.close(); throw new Error("This Codex instance was removed."); }
      clients.add(client);
      client.onClose(() => clients.delete(client));
      return client;
    },
    close: async () => { await Promise.all([...clients].map((client) => client.close())); },
  };
}
