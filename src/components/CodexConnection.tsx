import { useEffect, useId, useRef, useState } from "react";
import type { CodexBindingView, CodexConnectionState, CodexDeliveryState } from "../../shared/codex-binding";
import { api, ApiError } from "@/state/api";
import { t } from "@/lib/i18n";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { Select } from "./Select";
import { ConfirmDialog } from "./ConfirmDialog";

const actionClass = "cursor-pointer rounded-lg border border-hairline/40 px-3 py-1.5 text-[13px] hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-50";
const fieldClass = "min-w-0 rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink focus-visible:outline-2 focus-visible:outline-accent";
const CONNECTION_LABELS = { disconnected: "codex.disconnected", connecting: "codex.connecting", ready: "codex.ready", "awaiting-approval": "codex.awaitingApproval", failed: "codex.failed" } as const;
const stateLabel = (state: CodexConnectionState) => t(CONNECTION_LABELS[state]);
const DELIVERY_LABELS = { queued: "codex.queued", dispatching: "codex.dispatching", delivered: "codex.delivered", completed: "codex.completed", interrupted: "codex.interrupted", failed: "codex.failed", uncertain: "codex.uncertain", cancelled: "codex.cancelled" } as const;
const deliveryLabel = (state: CodexDeliveryState) => t(DELIVERY_LABELS[state]);

export function CodexSource({ conversationId, turnId, itemId }: { conversationId: string; turnId: string; itemId: string }) {
  return <details className="mb-2 text-[11px] text-ink-secondary">
    <summary className="cursor-pointer hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">{t("codex.replySource")}</summary>
    <dl className="mt-1 break-all font-mono"><dt>{t("codex.conversation")}</dt><dd>{conversationId}</dd><dt>{t("codex.turn")}</dt><dd>{turnId}</dd><dt>{t("codex.item")}</dt><dd>{itemId}</dd></dl>
  </details>;
}

export function CodexConnection({ botId, threadId, onChange }: { botId: string; threadId: string; onChange?: (view: CodexBindingView) => void }) {
  const owner = useOwnerOrAdmin();
  const id = useId();
  const [view, setView] = useState<CodexBindingView>();
  const [instances, setInstances] = useState<Array<{ id: string; name: string }>>([]);
  const [instanceId, setInstanceId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Array<{ id: string; title: string }>>();
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const alive = useRef(true);
  const composing = useRef(false);
  const epoch = useRef(0);
  const endpoint = `/api/bots/${botId}/threads/${threadId}/codex`;
  useEffect(() => { if (view) onChange?.(view); }, [view, onChange]);
  useEffect(() => {
    if (!owner) return;
    alive.current = true;
    const abort = new AbortController();
    const load = async () => {
      const generation = epoch.current;
      try {
        const next = await api<CodexBindingView>(endpoint, { signal: abort.signal, background: true });
        if (alive.current && generation === epoch.current) { setView(next); setUnavailable(false); }
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) setUnavailable(true);
        else if (!abort.signal.aborted && alive.current) setError(t("codex.statusUnavailable"));
      }
    };
    void load();
    void api<{ instances: Array<{ id: string; name: string }> }>("/api/codex/conversations", { signal: abort.signal, background: true }).then((next) => {
      if (!alive.current) return;
      setInstances(next.instances);
      setInstanceId(next.instances[0]?.id ?? "");
    }).catch(() => {});
    const timer = setInterval(() => void load(), 2_000);
    return () => { alive.current = false; abort.abort(); clearInterval(timer); };
  }, [endpoint, owner]);

  if (!owner || unavailable || !view || !view.configured && !instances.length) return null;
  const perform = async (work: () => Promise<void>) => {
    if (pending) return;
    epoch.current++; setPending(true); setError("");
    try { await work(); }
    catch (error) { if (alive.current) setError(error instanceof Error ? error.message : t("codex.failed")); }
    finally { if (alive.current) setPending(false); }
  };
  const mutate = (method: string, action = "", body?: unknown) => perform(async () => {
    try {
      const next = await api<CodexBindingView>(`${endpoint}${action}`, { method, body: body === undefined ? undefined : JSON.stringify(body), timeoutMs: 120_000 });
      if (alive.current) { setView(next); setConfirm(false); }
    } catch (error) {
      if (error instanceof ApiError && typeof error.body?.state === "string" && alive.current) setView(error.body as unknown as CodexBindingView);
      throw error;
    }
  });
  const find = (more = false) => perform(async () => {
    const query = new URLSearchParams({ instanceId, search, ...(more && cursor ? { cursor } : {}) });
    const found = await api<{ conversations: Array<{ id: string; title: string }>; nextCursor: string | null }>(`/api/codex/conversations?${query}`, { timeoutMs: 60_000 });
    if (alive.current) { setResults((previous) => more ? [...previous ?? [], ...found.conversations] : found.conversations); setCursor(found.nextCursor); }
  });
  return <details className="mx-5 mb-2 rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-ink" data-testid="codex-connection">
    <summary className="cursor-pointer text-[13px] text-ink-secondary hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">
      {t("codex.connection")} · <span role="status">{stateLabel(view.state)}{view.running ? ` · ${t("codex.running")}` : ""}</span>
    </summary>
    <div className="mt-3 space-y-3">
      <p className="text-[12px] text-ink-secondary">{t("codex.connectionHint")}</p>
      {view.configured ? <>
        <p className="break-all text-[13px]"><strong>{view.title}</strong><br /><code>{view.conversationId}</code></p>
        {view.settings && <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-[12px] text-ink-secondary">
          <dt>{t("codex.model")}</dt><dd className="break-all">{view.settings.model} · {view.settings.reasoningEffort ?? t("codex.defaultEffort")}</dd>
          <dt>{t("codex.folder")}</dt><dd className="break-all">{view.settings.cwd}</dd>
          <dt>{t("codex.permissions")}</dt><dd className="break-all font-mono">{JSON.stringify(view.settings.approvalPolicy)} · {JSON.stringify(view.settings.sandbox)}</dd>
        </dl>}
        <div className="flex flex-wrap gap-2">
          {!view.connected && <button type="button" className={actionClass} disabled={pending || view.state === "connecting"} onClick={() => void mutate("POST", "/reconnect", {})}>{t("codex.reconnect")}</button>}
          {view.running && <button type="button" className={actionClass} disabled={pending} onClick={() => void mutate("POST", "/cancel", {})}>{t("codex.stop")}</button>}
          <button type="button" className={actionClass} disabled={pending || view.running || view.state === "connecting"} onClick={() => setConfirm(true)}>{t("codex.disconnect")}</button>
        </div>
        {view.deliveries.length > 0 && <ul className="max-h-48 space-y-2 overflow-auto text-[12px]">
          {view.deliveries.slice(-20).map((delivery) => <li key={delivery.sendId} className="flex flex-wrap items-center gap-2">
            <code>{delivery.sendId.slice(0, 12)}</code><span>{deliveryLabel(delivery.state)}</span>
            {delivery.state === "queued" && <button type="button" className={actionClass} disabled={pending} onClick={() => void mutate("POST", "/cancel", { sendId: delivery.sendId })}>{t("codex.cancelQueued")}</button>}
            {delivery.state === "uncertain" && <><span>{t("codex.reviewHint")}</span><button type="button" className={actionClass} disabled={pending} onClick={() => void mutate("POST", "/acknowledge", { sendId: delivery.sendId })}>{t("codex.markReviewed")}</button></>}
          </li>)}
        </ul>}
      </> : <form noValidate onSubmit={(event) => { event.preventDefault(); if (!composing.current) void find(); }} className="space-y-2">
        <label htmlFor={`${id}-engine`} className="block text-[12px]">{t("codex.engine")}</label>
        <Select id={`${id}-engine`} value={instanceId} disabled={pending} onChange={(event) => { setInstanceId(event.target.value); setResults(undefined); setConversationId(""); }}>
          {instances.map((instance) => <option key={instance.id} value={instance.id}>{instance.name}</option>)}
        </Select>
        <label htmlFor={`${id}-search`} className="block text-[12px]">{t("codex.find")}</label>
        <div className="flex flex-wrap gap-2"><input id={`${id}-search`} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} className={`${fieldClass} flex-1`} value={search} onChange={(event) => setSearch(event.target.value)} disabled={pending} />
          {search && <button type="button" className={actionClass} disabled={pending} onClick={() => { setSearch(""); setResults(undefined); }}>{t("codex.clear")}</button>}
          <button type="submit" className={actionClass} disabled={pending || !instanceId}>{t("codex.find")}</button></div>
        {results && <ul className="max-h-48 space-y-1 overflow-auto">{results.map((result) => <li key={result.id}><button type="button" className={`${actionClass} w-full text-left`} aria-pressed={conversationId === result.id} disabled={pending} onClick={() => setConversationId(result.id)}>{result.title}<br /><code className="break-all text-[11px] text-ink-secondary">{result.id}</code></button></li>)}{!results.length && <li className="text-[12px] text-ink-secondary">{t("codex.noResults")}</li>}</ul>}
        {cursor && results && <button type="button" className={actionClass} disabled={pending} onClick={() => void find(true)}>{t("codex.loadMore")}</button>}
        <label htmlFor={`${id}-conversation`} className="block text-[12px]">{t("codex.conversation")}</label>
        <input id={`${id}-conversation`} className={`${fieldClass} w-full font-mono`} value={conversationId} onChange={(event) => setConversationId(event.target.value)} disabled={pending} />
        <button type="button" className={actionClass} disabled={pending || !instanceId || !conversationId.trim()} onClick={() => void mutate("PUT", "", { instanceId, conversationId: conversationId.trim() })}>{t("codex.connect")}</button>
      </form>}
      {pending && <p role="status" className="text-[12px] text-ink-secondary">{t("codex.working")}</p>}
      {(error || view.error) && <p role="alert" className="break-words text-[12px] text-danger">{error || view.error}</p>}
    </div>
    <ConfirmDialog open={confirm} title={t("codex.disconnect")} body={t("codex.disconnectHint")} confirmLabel={t("codex.disconnect")} tone="neutral" pending={pending} onCancel={() => setConfirm(false)} onConfirm={() => void mutate("DELETE")} />
  </details>;
}
