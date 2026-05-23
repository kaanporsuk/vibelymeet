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
  refundStatus: EventTicketRefundStatus;
  supportNeeded: boolean;
  updatedAt: string | null;
  createdAt: string | null;
};

export type EventTicketPaymentCheckoutStatus = {
  checkoutSessionId: string | null;
  status: string | null;
  expectedAmount: number | null;
  expectedCurrency: string | null;
  tierAtCheckout: string | null;
  tierSnapshot: Record<string, unknown> | null;
  eventSnapshot: Record<string, unknown> | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type EventTicketRefundStatus =
  | "none"
  | "pending"
  | "processing"
  | "refunded"
  | "failed_retryable"
  | "failed_permanent"
  | "support_needed";

export type EventTicketPaymentRefundStatus = {
  id: string | null;
  checkoutSessionId: string | null;
  status: EventTicketRefundStatus;
  reasonCode: string | null;
  amount: number | null;
  currency: string | null;
  providerRefundId: string | null;
  providerStatus: string | null;
  supportNeeded: boolean;
  lastError: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  refundedAt: string | null;
};

export type EventTicketPaymentStatus = {
  ok: boolean;
  eventId: string | null;
  admissionStatus: string | null;
  paymentStatus: string | null;
  checkout: EventTicketPaymentCheckoutStatus | null;
  settlement: EventTicketPaymentSettlementStatus | null;
  refund: EventTicketPaymentRefundStatus;
  error?: string;
};

export type EventTicketPaymentViewState =
  | "confirmed"
  | "waitlisted"
  | "pending"
  | "rejected_refund_pending"
  | "refunded"
  | "refund_failed_support"
  | "support_needed";

export type EventTicketPaymentSuccessCopy = {
  state: EventTicketPaymentViewState;
  headline: string;
  subline: string;
  showSupportAction: boolean;
  showViewEventAction: boolean;
  celebrate: boolean;
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
  const checkoutRecord = record.checkout && typeof record.checkout === "object"
    ? record.checkout as Record<string, unknown>
    : null;
  const settlementRecord = record.settlement && typeof record.settlement === "object"
    ? record.settlement as Record<string, unknown>
    : null;
  const refundRecord = record.refund && typeof record.refund === "object"
    ? record.refund as Record<string, unknown>
    : null;

  return {
    ok: record.ok === true,
    eventId: nullableString(record.event_id) ?? nullableString(record.eventId),
    admissionStatus: nullableString(record.admission_status) ?? nullableString(record.admissionStatus),
    paymentStatus: nullableString(record.payment_status) ?? nullableString(record.paymentStatus),
    checkout: checkoutRecord
      ? {
          checkoutSessionId:
            nullableString(checkoutRecord.checkout_session_id) ?? nullableString(checkoutRecord.checkoutSessionId),
          status: nullableString(checkoutRecord.status),
          expectedAmount: nullableNumber(checkoutRecord.expected_amount) ?? nullableNumber(checkoutRecord.expectedAmount),
          expectedCurrency:
            nullableString(checkoutRecord.expected_currency) ?? nullableString(checkoutRecord.expectedCurrency),
          tierAtCheckout:
            nullableString(checkoutRecord.tier_at_checkout) ?? nullableString(checkoutRecord.tierAtCheckout),
          tierSnapshot:
            objectOrNull(checkoutRecord.tier_snapshot) ?? objectOrNull(checkoutRecord.tierSnapshot),
          eventSnapshot:
            objectOrNull(checkoutRecord.event_snapshot) ?? objectOrNull(checkoutRecord.eventSnapshot),
          createdAt: nullableString(checkoutRecord.created_at) ?? nullableString(checkoutRecord.createdAt),
          updatedAt: nullableString(checkoutRecord.updated_at) ?? nullableString(checkoutRecord.updatedAt),
        }
      : null,
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
          refundStatus: normalizeEventTicketRefundStatus(
            settlementRecord.refund_status ?? settlementRecord.refundStatus,
          ),
          supportNeeded: booleanOrDefault(
            settlementRecord.support_needed ?? settlementRecord.supportNeeded,
            false,
          ),
          updatedAt: nullableString(settlementRecord.updated_at) ?? nullableString(settlementRecord.updatedAt),
          createdAt: nullableString(settlementRecord.created_at) ?? nullableString(settlementRecord.createdAt),
        }
      : null,
    refund: {
      id: nullableString(refundRecord?.id),
      checkoutSessionId:
        nullableString(refundRecord?.checkout_session_id) ?? nullableString(refundRecord?.checkoutSessionId),
      status: normalizeEventTicketRefundStatus(refundRecord?.status),
      reasonCode: nullableString(refundRecord?.reason_code) ?? nullableString(refundRecord?.reasonCode),
      amount: nullableNumber(refundRecord?.amount),
      currency: nullableString(refundRecord?.currency),
      providerRefundId:
        nullableString(refundRecord?.provider_refund_id) ?? nullableString(refundRecord?.providerRefundId),
      providerStatus:
        nullableString(refundRecord?.provider_status) ?? nullableString(refundRecord?.providerStatus),
      supportNeeded: booleanOrDefault(refundRecord?.support_needed ?? refundRecord?.supportNeeded, false),
      lastError: nullableString(refundRecord?.last_error) ?? nullableString(refundRecord?.lastError),
      createdAt: nullableString(refundRecord?.created_at) ?? nullableString(refundRecord?.createdAt),
      updatedAt: nullableString(refundRecord?.updated_at) ?? nullableString(refundRecord?.updatedAt),
      refundedAt: nullableString(refundRecord?.refunded_at) ?? nullableString(refundRecord?.refundedAt),
    },
    error: nullableString(record.error) ?? undefined,
  };
}

export function normalizeEventTicketRefundStatus(value: unknown): EventTicketRefundStatus {
  switch (value) {
    case "pending":
    case "processing":
    case "refunded":
    case "failed_retryable":
    case "failed_permanent":
    case "support_needed":
      return value;
    case "noop_already_refunded":
      return "refunded";
    default:
      return "none";
  }
}

export function resolveEventTicketPaymentViewState(
  status: EventTicketPaymentStatus | null,
  isEventCancelled = false,
): EventTicketPaymentViewState {
  const admissionStatus = status?.admissionStatus ?? status?.settlement?.admissionStatus ?? null;
  const settlement = status?.settlement ?? null;
  const currentCheckoutSessionId = status?.checkout?.checkoutSessionId ?? settlement?.checkoutSessionId ?? null;
  const refundCheckoutSessionId = status?.refund.checkoutSessionId ?? null;
  const refundBelongsToCurrentCheckout =
    !currentCheckoutSessionId || !refundCheckoutSessionId || refundCheckoutSessionId === currentCheckoutSessionId;
  const refundStatus = refundBelongsToCurrentCheckout
    ? status?.refund.status ?? settlement?.refundStatus ?? "none"
    : settlement?.refundStatus ?? "none";
  const supportNeeded =
    (refundBelongsToCurrentCheckout && status?.refund.supportNeeded === true) || settlement?.supportNeeded === true;
  const outcome = settlement?.outcome ?? null;
  const code = settlement?.code ?? null;
  const rejected =
    settlement?.success === false ||
    Boolean(outcome?.startsWith("rejected_")) ||
    [
      "TIER_MISMATCH",
      "EVENT_CLOSED",
      "MONTHLY_EVENT_JOIN_LIMIT_REACHED",
      "MONTHLY_LIMIT_REACHED",
      "CONFLICT",
      "DUPLICATE_PAID_CHECKOUT",
      "UNIQUE",
      "AMOUNT_MISMATCH",
      "INTENT_METADATA_MISMATCH",
      "INTENT_NOT_FOUND",
    ].includes(code ?? "");

  if (refundStatus === "refunded") return "refunded";
  if (refundStatus === "failed_permanent") return "refund_failed_support";
  if (refundStatus === "support_needed" || supportNeeded) return "support_needed";
  if (refundStatus === "pending" || refundStatus === "processing" || refundStatus === "failed_retryable") {
    return "rejected_refund_pending";
  }
  if (rejected) return "support_needed";
  if (isEventCancelled && admissionStatus !== "confirmed" && admissionStatus !== "waitlisted") {
    return "support_needed";
  }
  if (admissionStatus === "confirmed") return "confirmed";
  if (admissionStatus === "waitlisted") return "waitlisted";
  return "pending";
}

export function eventTicketPaymentSuccessCopy(
  state: EventTicketPaymentViewState,
): EventTicketPaymentSuccessCopy {
  switch (state) {
    case "confirmed":
      return {
        state,
        headline: "You're on the list!",
        subline: "Check your email for confirmation.",
        showSupportAction: false,
        showViewEventAction: true,
        celebrate: true,
      };
    case "waitlisted":
      return {
        state,
        headline: "You're on the waitlist",
        subline: "The event was full when your payment settled. We'll confirm you if a spot opens.",
        showSupportAction: false,
        showViewEventAction: true,
        celebrate: false,
      };
    case "rejected_refund_pending":
      return {
        state,
        headline: "Refund pending",
        subline: "Your payment was received, but we could not confirm this event ticket. Your refund is being processed automatically.",
        showSupportAction: false,
        showViewEventAction: true,
        celebrate: false,
      };
    case "refunded":
      return {
        state,
        headline: "Refund processed",
        subline: "Your payment was received, but we could not confirm this event ticket. The refund has been sent back through Stripe.",
        showSupportAction: false,
        showViewEventAction: true,
        celebrate: false,
      };
    case "refund_failed_support":
      return {
        state,
        headline: "Refund needs support",
        subline: "Your payment was received, but the automatic refund could not complete. Send us a support request and we'll reconcile it.",
        showSupportAction: true,
        showViewEventAction: true,
        celebrate: false,
      };
    case "support_needed":
      return {
        state,
        headline: "Payment needs support",
        subline: "Your payment was received, but we need to reconcile the ticket or refund before confirming next steps.",
        showSupportAction: true,
        showViewEventAction: true,
        celebrate: false,
      };
    case "pending":
    default:
      return {
        state: "pending",
        headline: "Payment received",
        subline: "Hang tight while we confirm your spot.",
        showSupportAction: false,
        showViewEventAction: true,
        celebrate: false,
      };
  }
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

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
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
