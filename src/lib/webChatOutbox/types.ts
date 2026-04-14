import type { ThreadInvalidateScope } from "../../../shared/chat/queryKeys";

export type WebChatOutboxQueueState =
  | "queued"
  | "waiting_for_network"
  | "sending"
  | "awaiting_hydration"
  | "failed"
  | "sent"
  | "canceled";

export type WebChatOutboxPayload =
  | { kind: "text"; text: string }
  | { kind: "image"; mimeType: string; blobKey: string }
  | { kind: "voice"; blobKey: string; durationSeconds: number }
  | {
      kind: "video";
      blobKey: string;
      durationSeconds: number;
      mimeType: string;
      aspectRatio?: number | null;
    };

export type WebChatOutboxItem = {
  /** UUID — `structured_payload.client_request_id` + idempotency key */
  id: string;
  matchId: string;
  otherUserId: string;
  userId: string;
  payload: WebChatOutboxPayload;
  state: WebChatOutboxQueueState;
  createdAtMs: number;
  updatedAtMs: number;
  attemptCount: number;
  lastError?: string;
  nextRetryAtMs?: number;
  serverMessageId?: string;
  uploadedPublicUrl?: string;
  uploadedMediaUrl?: string;
  hydrationLastCheckedAtMs?: number;
  hydrationDeadlineAtMs?: number;
  invalidateScope?: ThreadInvalidateScope;
};
