import { useEffect, useSyncExternalStore } from "react";
import { inputRequestKey, inputRequestOpen, type BotInputRequest } from "../../shared/input-requests";
import type { ServerFrame } from "../../shared/wire";
import { listenLiveFrames } from "@/lib/live-events";
import { useSessionEnded } from "@/lib/session-ended";
import { api } from "./api";

export interface InputRequestView { requests: BotInputRequest[]; loading: boolean; failed: boolean; loaded: boolean }

export function createInputRequestStore(read: (signal: AbortSignal) => Promise<{ requests: BotInputRequest[] }>) {
  let view: InputRequestView = { requests: [], loading: false, failed: false, loaded: false };
  const listeners = new Set<() => void>();
  let revision = 0;
  let reading: Promise<void> | null = null;
  let controller: AbortController | null = null;
  const publish = (next: InputRequestView) => { view = next; for (const listener of listeners) listener(); };
  const clear = () => {
    revision++;
    controller?.abort();
    controller = null;
    reading = null;
    publish({ requests: [], loading: false, failed: false, loaded: false });
  };
  const refresh = (): Promise<void> => {
    revision++;
    if (reading) return reading;
    const task = (async () => {
      let seen: number;
      do {
        seen = revision;
        const own = new AbortController();
        controller = own;
        publish({ ...view, loading: true });
        try {
          const result = await read(own.signal);
          if (own.signal.aborted) break;
          if (seen !== revision) continue;
          const unique = new Map(result.requests.filter((row) => inputRequestOpen(row.message)).map((row) => [inputRequestKey(row), row]));
          publish({ requests: [...unique.values()], loading: false, failed: false, loaded: true });
        } catch {
          if (!own.signal.aborted && seen === revision) publish({ ...view, loading: false, failed: true });
        }
        if (own.signal.aborted && controller !== own) break;
      } while (seen !== revision);
    })();
    const pending = task.finally(() => { if (reading === pending) reading = null; });
    reading = pending;
    return reading;
  };
  const frame = (event: ServerFrame) => {
    if (event.kind === "message" || event.kind === "message.patch") {
      const matching = view.requests.some((row) => row.threadId === event.threadId && row.message.id === event.message.id);
      if (matching) publish({ ...view, requests: view.requests.flatMap((row) => row.threadId === event.threadId && row.message.id === event.message.id
        ? inputRequestOpen(event.message) ? [{ ...row, message: event.message }] : [] : [row]) });
      if (matching || ["options", "secret", "signin", "connector"].includes(event.message.kind)) void refresh();
    } else if (event.kind === "bot.deleted") {
      publish({ ...view, requests: view.requests.filter((row) => row.botId !== event.botId) });
      void refresh();
    } else if (event.kind === "bot" || event.kind === "thread") void refresh();
  };
  return { get: () => view, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, refresh, clear, frame };
}

const requests = createInputRequestStore((signal) => api("/api/input-requests", { background: true, signal }));
let enabled = false;
export const useInputRequests = (): InputRequestView => useSyncExternalStore(requests.subscribe, requests.get, requests.get);
export const refreshInputRequests = (): Promise<void> => enabled ? requests.refresh() : Promise.resolve();

export function useInputRequestsLoader(ready: boolean, connected: boolean): void {
  const ended = useSessionEnded();
  useEffect(() => {
    if (!ready || ended) { enabled = false; requests.clear(); return; }
    enabled = true;
    void requests.refresh();
    const stop = listenLiveFrames({ onFrame: requests.frame, onMissedFrames: () => { void requests.refresh(); } });
    const refresh = () => { void requests.refresh(); };
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      stop();
      window.clearInterval(timer);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
      enabled = false;
      requests.clear();
    };
  }, [ready, ended]);
  useEffect(() => { if (ready && connected && !ended) void refreshInputRequests(); }, [ready, connected, ended]);
}
