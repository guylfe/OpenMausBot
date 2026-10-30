import { LoaderCircle } from "lucide-react";
import { inputRequestKey, type BotInputRequest } from "../../shared/input-requests";
import { currentTaskBot, openThread, useStore, type Bot, type Message } from "@/state/store";
import { refreshInputRequests, useInputRequests } from "@/state/input-requests";
import { useShowThreads } from "@/lib/thread-preferences";
import { isQuestionCard } from "@/lib/question-card";
import { localizedTaskTitle } from "@/lib/task-title";
import { t } from "@/lib/i18n";
import { ELEVATED_CARD } from "./elevated";
import { PendingApprovalActions, PendingApprovalPanel, pendingApprovals } from "./PendingApproval";
import { QuestionCard } from "./QuestionCard";
import { OptionCard } from "./OptionCard";
import { SecretRequestCard } from "./SecretRequestCard";
import { SignInRequestCard } from "./SignInRequestCard";
import { ConnectorCard } from "./ConnectorCard";

function InputCard({ row, bot }: { row: BotInputRequest; bot: Bot }) {
  const { dispatch } = useStore();
  const message = row.message as Message;
  const pending = pendingApprovals([message])[0];
  const asking = currentTaskBot(bot, row.threadId);
  if (pending) return <div className={`overflow-hidden rounded-[20px] ${ELEVATED_CARD}`}>
    <PendingApprovalPanel pending={pending} botName={bot.name} asker={bot} count={1} index={0}
      actions={<PendingApprovalActions part="primary" tag="input-request" pending={pending} threadId={row.threadId} bot={asking} onCancelTurn={() => {}} />}
      more={<PendingApprovalActions part="more" pending={pending} threadId={row.threadId} bot={asking}
        onCancelTurn={() => dispatch({ type: "interrupt", botId: row.botId, threadId: row.threadId })} />} />
  </div>;
  if (isQuestionCard(message.card)) return <QuestionCard threadId={row.threadId} asker={bot} message={message} />;
  if (message.kind === "secret") return <SecretRequestCard botId={row.botId} color={bot.color} threadId={row.threadId} message={message} />;
  if (message.kind === "signin") return <SignInRequestCard botId={row.botId} botName={bot.name} color={bot.color} threadId={row.threadId} message={message} />;
  if (message.kind === "connector") return <ConnectorCard botId={row.botId} color={bot.color} threadId={row.threadId} message={message} />;
  return <OptionCard botId={row.botId} threadId={row.threadId} message={message} />;
}

export function BotInputRequestBadge({ botId }: { botId: string }) {
  const { requests, failed } = useInputRequests();
  const showThreads = useShowThreads();
  const count = requests.filter((row) => row.botId === botId).length;
  if (showThreads || failed || !count) return null;
  const label = t("inputRequests.count", { count });
  return <span data-bot-input-count={botId} role="status" aria-label={label} title={label}
    className="ms-1 inline-flex min-w-4 shrink-0 items-center justify-center rounded-full bg-warning px-1 text-[11px] font-semibold leading-4 text-panel">{count}</span>;
}

export function MainInputRequests({ bot, threadId }: { bot: Bot; threadId: string }) {
  const { state, dispatch } = useStore();
  const view = useInputRequests();
  const showThreads = useShowThreads();
  const rows = view.requests.filter((row) => row.botId === bot.id && row.threadId !== threadId);
  if (showThreads || (!rows.length && !(view.loading && !view.loaded) && !view.failed)) return null;
  return <section data-main-input-requests={bot.id} aria-label={t("inputRequests.title")} aria-busy={view.loading}
    className="w-full min-w-0 space-y-3">
    <h2 className="text-[13px] font-medium text-ink-secondary">{t("inputRequests.title")}{rows.length > 0 && ` · ${rows.length}`}</h2>
    {view.failed && <div role="alert" className="text-[13px] text-danger">{t("inputRequests.failed")} <button type="button" onClick={() => void refreshInputRequests()}
      className="cursor-pointer rounded px-1 underline hover:bg-danger/10 focus-visible:ring-2 focus-visible:ring-focus">{t("chat.retry")}</button></div>}
    {view.loading && !rows.length && <p role="status" className="flex items-center gap-2 text-[13px] text-ink-secondary"><LoaderCircle size={14} className="animate-spin" />{t("inputRequests.loading")}</p>}
    {rows.map((row) => <div key={inputRequestKey(row)} data-input-origin={row.threadId} className="space-y-1.5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[12px] text-ink-tertiary">
        <span dir="auto" className="min-w-0 break-words">{localizedTaskTitle(row.title)}</span>
        <button type="button" onClick={() => {
          openThread(dispatch, { botId: row.botId, threadId: row.threadId }, state, showThreads);
          dispatch({ type: "focusMessage", threadId: row.threadId, messageId: row.message.id });
        }} className="cursor-pointer rounded px-1 text-ink-secondary underline decoration-hairline hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-focus">{t("inputRequests.context")}</button>
      </div>
      <fieldset disabled={view.failed || !state.connected} className="min-w-0 border-0 p-0 disabled:opacity-60"><InputCard row={row} bot={bot} /></fieldset>
    </div>)}
  </section>;
}
