export type ChatOutboxKind = 'text' | 'image' | 'voice' | 'video';

export type ChatOutboxState =
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
  | { kind: 'video'; uri: string; durationSeconds: number; mimeType: string };

export type ChatOutboxItem = {
  /** Durable id for the queue item (UUID string). */
  id: string;
  matchId: string;
  senderId: string;
  kind: ChatOutboxKind;
  /** Client idempotency token (UUID string). */
  clientRequestId: string;
  createdAtMs: number;
  updatedAtMs: number;
  state: ChatOutboxState;
  attemptCount: number;
  nextRetryAtMs: number | null;
  lastError: string | null;
  /** Set after successful insert (or idempotent resolve). */
  serverMessageId: string | null;
  payload: ChatOutboxPayload;
};

export type ChatOutboxSnapshot = {
  userId: string | null;
  items: ChatOutboxItem[];
  initialized: boolean;
};

