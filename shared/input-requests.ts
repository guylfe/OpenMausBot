import { liveCardKind } from "./live-approval.ts";
import { signInWaits } from "./sign-in-request.ts";
import type { WireMessage } from "./wire.ts";

/** A live card in its original conversation, projected into the bot's main chat without copying a message or granting access. */
export interface BotInputRequest {
  botId: string;
  threadId: string;
  title: string;
  message: Pick<WireMessage, "id" | "at" | "role" | "kind" | "text" | "card" | "secret" | "signIn" | "connector">;
}

/** The existing card's unsettled state, including a failed resume the person can retry. */
export function inputRequestOpen(message: Partial<BotInputRequest["message"]>): boolean {
  if (message.kind === "options") return Boolean(liveCardKind(message.card) && !message.card?.autoApplied && !message.card?.routineRequest && !message.card?.stopped);
  if (message.kind === "secret" && message.secret) {
    const card = message.secret;
    return !card.superseded && !card.stopped && ((!card.provided && !card.dismissed) || Boolean(!card.resumed && card.error));
  }
  if (message.kind === "signin" && message.signIn) {
    const card = message.signIn;
    return !card.superseded && !card.stopped && !card.answeredInChat && (signInWaits(card) || Boolean(!card.resumed && card.error));
  }
  if (message.kind === "connector" && message.connector) {
    const card = message.connector;
    return !card.dismissed && !card.stopped && (card.status !== "connected" || Boolean(!card.resumed && card.error));
  }
  return false;
}

/** Request ids are conversation-scoped; credential/sign-in cards use their own message id. */
export function inputRequestKey(row: Pick<BotInputRequest, "threadId" | "message">): string {
  return `${row.threadId}:${row.message.card?.requestId ?? row.message.id}`;
}
