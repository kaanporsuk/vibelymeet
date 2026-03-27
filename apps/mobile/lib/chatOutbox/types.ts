export type ChatOutboxQueueState =
  | 'queued'
  | 'waiting_for_network'
  | 'sending'
  | 'awaiting_hydration'
  | 'failed'
  | 'sent'
  | 'canceled';

export type ChatOutboxPayload =
  | { kind: 'text'; text: string }
  | { kind: 'image'; uri: string; mimeType: string }
  | { kind: 'voice'; uri: string; durationSeconds: number }
  | { kind: 'video'; uri: string; durationSeconds: number; mimeType?: string };

export type ChatOutboxItem = {
  /** UUID — `structured_payload.client_request_id` + durable idempotency key */
  id: string;
  matchId: string;
  otherUserId: string;
  userId: string;
  payload: ChatOutboxPayload;
  state: ChatOutboxQueueState;
  createdAtMs: number;
  updatedAtMs: number;
  attemptCount: number;
  lastError?: string;
  nextRetryAtMs?: number;
  /** Set after server accepts the send */
  serverMessageId?: string;
  /** After image upload succeeds (retry skips re-upload) */
  uploadedPublicUrl?: string;
};
