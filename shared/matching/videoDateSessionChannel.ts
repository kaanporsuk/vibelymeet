export const VIDEO_DATE_SESSION_CHANNEL_EVENT = "video_session_event";
export const VIDEO_DATE_SESSION_TOPIC_PREFIX = "session:";

export type VideoDateSessionBroadcastEvent = {
  schemaVersion: 1;
  id: number;
  sessionId: string;
  sessionSeq: number;
  kind: string;
  at: string | null;
  actor: string | null;
  payload: Record<string, unknown>;
  correlationId: string | null;
};

export type VideoDateSessionSeqDecision =
  | { action: "accept"; sessionSeq: number }
  | { action: "duplicate"; sessionSeq: number }
  | { action: "gap"; sessionSeq: number; expectedSeq: number | null }
  | { action: "invalid"; sessionSeq: number | null };

export type VideoDateSessionChannelStatus =
  | "SUBSCRIBED"
  | "CHANNEL_ERROR"
  | "TIMED_OUT"
  | "CLOSED"
  | string;

export type VideoDateRealtimeChannel = {
  on(
    type: "broadcast",
    filter: { event: typeof VIDEO_DATE_SESSION_CHANNEL_EVENT },
    callback: (message: { payload?: unknown } | unknown) => void,
  ): VideoDateRealtimeChannel;
  subscribe(callback?: (status: VideoDateSessionChannelStatus, error?: unknown) => void): VideoDateRealtimeChannel;
};

export type VideoDateRealtimeClient = {
  channel(topic: string, options?: { config?: { private?: boolean } }): VideoDateRealtimeChannel;
  removeChannel(channel: VideoDateRealtimeChannel): unknown;
};

export type VideoDateSessionChannelSubscription = {
  topic: string;
  channel: VideoDateRealtimeChannel;
  unsubscribe: () => void;
};

export type CreateVideoDateSessionChannelOptions = {
  sessionId: string;
  onEvent: (event: VideoDateSessionBroadcastEvent) => void;
  onInvalidPayload?: (payload: unknown) => void;
  onStatusChange?: (status: VideoDateSessionChannelStatus, error?: unknown) => void;
};

export function videoDateSessionTopic(sessionId: string): string {
  return `${VIDEO_DATE_SESSION_TOPIC_PREFIX}${sessionId}`;
}

export function createVideoDateSessionChannel(
  client: VideoDateRealtimeClient,
  options: CreateVideoDateSessionChannelOptions,
): VideoDateSessionChannelSubscription {
  const topic = videoDateSessionTopic(options.sessionId);
  const channel = client.channel(topic, { config: { private: true } });
  channel
    .on("broadcast", { event: VIDEO_DATE_SESSION_CHANNEL_EVENT }, (message) => {
      const event = normalizeVideoDateSessionBroadcastEvent(message);
      if (!event) {
        options.onInvalidPayload?.(message);
        return;
      }
      if (event.sessionId !== options.sessionId) {
        options.onInvalidPayload?.(message);
        return;
      }
      options.onEvent(event);
    })
    .subscribe((status, error) => {
      options.onStatusChange?.(status, error);
    });

  return {
    topic,
    channel,
    unsubscribe: () => {
      void client.removeChannel(channel);
    },
  };
}

export function normalizeVideoDateSessionBroadcastEvent(
  message: unknown,
): VideoDateSessionBroadcastEvent | null {
  const eventRecord = unwrapBroadcastPayload(message);
  if (!eventRecord) return null;

  const schemaVersion = numericValue(eventRecord.schemaVersion ?? eventRecord.schema_version);
  if (schemaVersion !== 1) return null;

  const id = numericValue(eventRecord.id);
  const sessionId = stringValue(eventRecord.sessionId ?? eventRecord.session_id);
  const sessionSeq = normalizeSeq(eventRecord.sessionSeq ?? eventRecord.session_seq);
  const kind = stringValue(eventRecord.kind);
  if (id === null || !sessionId || sessionSeq === null || !kind) return null;

  return {
    schemaVersion: 1,
    id,
    sessionId,
    sessionSeq,
    kind,
    at: stringValue(eventRecord.at),
    actor: stringValue(eventRecord.actor),
    payload: objectValue(eventRecord.payload) ?? {},
    correlationId: stringValue(eventRecord.correlationId ?? eventRecord.correlation_id),
  };
}

export function resolveVideoDateSessionSeqDecision(
  currentSeq: number | null | undefined,
  incomingSeq: number | null | undefined,
): VideoDateSessionSeqDecision {
  const normalizedIncoming = normalizeSeq(incomingSeq);
  if (normalizedIncoming === null) {
    return { action: "invalid", sessionSeq: null };
  }

  const normalizedCurrent = normalizeSeq(currentSeq);
  if (normalizedCurrent === null) {
    return { action: "gap", sessionSeq: normalizedIncoming, expectedSeq: null };
  }

  if (normalizedIncoming <= normalizedCurrent) {
    return { action: "duplicate", sessionSeq: normalizedIncoming };
  }

  const expectedSeq = normalizedCurrent + 1;
  if (normalizedIncoming !== expectedSeq) {
    return { action: "gap", sessionSeq: normalizedIncoming, expectedSeq };
  }

  return { action: "accept", sessionSeq: normalizedIncoming };
}

function unwrapBroadcastPayload(message: unknown): Record<string, unknown> | null {
  const outer = objectValue(message);
  if (!outer) return null;

  const nested = objectValue(outer.payload);
  if (nested && (nested.sessionId !== undefined || nested.session_id !== undefined)) {
    return nested;
  }

  return outer;
}

function normalizeSeq(value: unknown): number | null {
  const numeric = numericValue(value);
  if (numeric === null || numeric < 0 || !Number.isInteger(numeric)) return null;
  return numeric;
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
