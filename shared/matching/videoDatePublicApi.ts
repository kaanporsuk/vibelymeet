export const VIDEO_DATE_TOKEN_REFRESH_FUNCTION_NAME = "video-date-token-refresh";
export const VIDEO_DATE_TOKEN_JOIN_REFRESH_WINDOW_MS = 2 * 60 * 1000;

export type VideoDateTokenRefreshOk = {
  ok: true;
  sessionId: string;
  eventId: string | null;
  phase: "handshake" | "date" | string;
  roomName: string;
  roomUrl: string;
  token: string;
  tokenExpiresAt: number;
  tokenExpiresAtIso: string | null;
};

export type VideoDateTokenRefreshError = {
  ok: false;
  error: string;
  retryable?: boolean;
  phase?: string | null;
};

export type VideoDateTokenRefreshResult = VideoDateTokenRefreshOk | VideoDateTokenRefreshError;

export type VideoDateQueueHint = {
  ok: boolean;
  queued: boolean;
  reason: string | null;
  sessionId: string | null;
  eventQueuedCount: number;
  userQueuedCount: number;
  position: number | null;
  waitAgeSeconds: number;
  estimatedWaitSeconds: number | null;
  reliefActive: boolean;
};

export type EventTicketPaymentSettlementStatus = {
  checkoutSessionId: string | null;
  outcome: string | null;
  code: string | null;
  error: string | null;
  admissionStatus: string | null;
  success: boolean | null;
  createdAt: string | null;
};

export type EventTicketPaymentStatus = {
  ok: boolean;
  eventId: string | null;
  admissionStatus: string | null;
  paymentStatus: string | null;
  settlement: EventTicketPaymentSettlementStatus | null;
  error?: string;
};

export function shouldRefreshVideoDateTokenBeforeJoin(
  tokenExpiresAtIso: string | null | undefined,
  nowMs = Date.now(),
  refreshWindowMs = VIDEO_DATE_TOKEN_JOIN_REFRESH_WINDOW_MS,
): boolean {
  if (!tokenExpiresAtIso) return false;
  const expiresAtMs = Date.parse(tokenExpiresAtIso);
  if (!Number.isFinite(expiresAtMs)) return true;
  return expiresAtMs <= nowMs + refreshWindowMs;
}

export function isVideoDateDailyTokenJoinError(error: unknown): boolean {
  const text = errorText(error);
  if (!text) return false;
  const lower = text.toLowerCase();
  const mentionsToken = lower.includes("token") || lower.includes("auth") || lower.includes("authorization");
  if (!mentionsToken) return false;
  return (
    lower.includes("expired") ||
    lower.includes("invalid") ||
    lower.includes("unauthorized") ||
    lower.includes("not authorized") ||
    lower.includes("permission") ||
    lower.includes("eject")
  );
}

export function normalizeVideoDateTokenRefresh(payload: unknown): VideoDateTokenRefreshResult {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "invalid_token_refresh_payload", retryable: true };
  }

  const record = payload as Record<string, unknown>;
  if (record.ok !== true) {
    return {
      ok: false,
      error: stringOrDefault(record.error, "token_refresh_failed"),
      retryable: typeof record.retryable === "boolean" ? record.retryable : undefined,
      phase: nullableString(record.phase),
    };
  }

  const sessionId = nullableString(record.session_id) ?? nullableString(record.sessionId);
  const roomName = nullableString(record.room_name) ?? nullableString(record.roomName);
  const roomUrl = nullableString(record.room_url) ?? nullableString(record.roomUrl);
  const token = nullableString(record.token);
  const tokenExpiresAt = nullableNumber(record.tokenExpiresAt);
  if (!sessionId || !roomName || !roomUrl || !token || tokenExpiresAt == null) {
    return { ok: false, error: "invalid_token_refresh_payload", retryable: true };
  }

  return {
    ok: true,
    sessionId,
    eventId: nullableString(record.event_id) ?? nullableString(record.eventId),
    phase: stringOrDefault(record.phase, "handshake"),
    roomName,
    roomUrl,
    token,
    tokenExpiresAt,
    tokenExpiresAtIso: nullableString(record.token_expires_at) ?? nullableString(record.tokenExpiresAtIso),
  };
}

export async function normalizeVideoDateTokenRefreshInvokeError(
  error: unknown,
): Promise<VideoDateTokenRefreshError> {
  const payload = await readInvokeErrorPayload(error);
  if (payload && typeof payload === "object") {
    const normalized = normalizeVideoDateTokenRefresh(payload);
    if (normalized.ok === false) return normalized;
  }
  return { ok: false, error: "token_refresh_function_failed", retryable: true };
}

export function normalizeVideoDateQueueHint(payload: unknown): VideoDateQueueHint {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  return {
    ok: record.ok === true,
    queued: record.queued === true,
    reason: nullableString(record.reason),
    sessionId: nullableString(record.session_id) ?? nullableString(record.sessionId),
    eventQueuedCount: integerOrDefault(record.event_queued_count ?? record.eventQueuedCount, 0),
    userQueuedCount: integerOrDefault(record.user_queued_count ?? record.userQueuedCount, 0),
    position: nullableInteger(record.position),
    waitAgeSeconds: integerOrDefault(record.wait_age_seconds ?? record.waitAgeSeconds, 0),
    estimatedWaitSeconds: nullableInteger(record.estimated_wait_seconds ?? record.estimatedWaitSeconds),
    reliefActive: record.relief_active === true || record.reliefActive === true,
  };
}

export function normalizeEventTicketPaymentStatus(payload: unknown): EventTicketPaymentStatus {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const settlementRecord = record.settlement && typeof record.settlement === "object"
    ? record.settlement as Record<string, unknown>
    : null;

  return {
    ok: record.ok === true,
    eventId: nullableString(record.event_id) ?? nullableString(record.eventId),
    admissionStatus: nullableString(record.admission_status) ?? nullableString(record.admissionStatus),
    paymentStatus: nullableString(record.payment_status) ?? nullableString(record.paymentStatus),
    settlement: settlementRecord
      ? {
          checkoutSessionId:
            nullableString(settlementRecord.checkout_session_id) ?? nullableString(settlementRecord.checkoutSessionId),
          outcome: nullableString(settlementRecord.outcome),
          code: nullableString(settlementRecord.code),
          error: nullableString(settlementRecord.error),
          admissionStatus:
            nullableString(settlementRecord.admission_status) ?? nullableString(settlementRecord.admissionStatus),
          success: typeof settlementRecord.success === "boolean" ? settlementRecord.success : null,
          createdAt: nullableString(settlementRecord.created_at) ?? nullableString(settlementRecord.createdAt),
        }
      : null,
    error: nullableString(record.error) ?? undefined,
  };
}

type InvokeErrorResponseLike = {
  clone?: () => InvokeErrorResponseLike;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
};

async function readInvokeErrorPayload(error: unknown): Promise<unknown> {
  if (!error || typeof error !== "object") return null;
  const context = (error as { context?: unknown }).context;
  if (!context || typeof context !== "object") return null;
  const response = context as InvokeErrorResponseLike;

  if (typeof response.json === "function") {
    try {
      const readable = typeof response.clone === "function" ? response.clone() : response;
      return await readable.json?.();
    } catch {
      // Fall through to text parsing when available.
    }
  }

  if (typeof response.text === "function") {
    try {
      const readable = typeof response.clone === "function" ? response.clone() : response;
      const text = await readable.text?.();
      return text?.trim() ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }

  return null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringOrDefault(value: unknown, fallback: string): string {
  return nullableString(value) ?? fallback;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function integerOrDefault(value: unknown, fallback: number): number {
  return nullableInteger(value) ?? fallback;
}

function errorText(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (typeof error !== "object") return String(error);
  const record = error as Record<string, unknown>;
  return [
    record.name,
    record.code,
    record.message,
    record.error,
    record.errorMsg,
    record.reason,
    record.details,
  ]
    .flatMap((value) => {
      if (typeof value === "string") return [value];
      if (value && typeof value === "object") return [errorText(value)];
      return [];
    })
    .filter(Boolean)
    .join(" ");
}
