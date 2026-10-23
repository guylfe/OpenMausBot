export type CodexConnectionState = "disconnected" | "connecting" | "ready" | "awaiting-approval" | "failed";
export type CodexDeliveryState = "queued" | "dispatching" | "delivered" | "completed" | "interrupted" | "failed" | "uncertain" | "cancelled";

export interface CodexProvenance {
  conversationId: string;
  turnId: string;
  itemId: string;
}

export interface CodexBindingView {
  configured: boolean;
  connected: boolean;
  state: CodexConnectionState;
  instanceId?: string;
  conversationId?: string;
  title?: string;
  error?: string;
  running?: boolean;
  settings?: {
    model: string;
    reasoningEffort: string | null;
    cwd: string;
    approvalPolicy: unknown;
    sandbox: unknown;
  };
  deliveries: Array<{ sendId: string; state: CodexDeliveryState; turnId?: string }>;
}
