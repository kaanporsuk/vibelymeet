export type EventLobbyPlatform = "web" | "native";
export type QueueDrainSourceSurface = "event_lobby" | "post_date_survey" | "notification_deep_link";

export const EventLobbyObservabilityEvents = {
  LOBBY_ENTERED: "lobby_entered",
  LOBBY_DECK_LOADED: "lobby_deck_loaded",
  LOBBY_DECK_EMPTY: "lobby_deck_empty",
  LOBBY_DECK_ERROR: "lobby_deck_error",
  LOBBY_SWIPE_SUBMITTED: "lobby_swipe_submitted",
  LOBBY_SWIPE_RESULT: "lobby_swipe_result",
  LOBBY_SWIPE_DUPLICATE_SUPPRESSED: "lobby_swipe_duplicate_suppressed",
  READY_GATE_SHOWN: "ready_gate_shown",
  READY_GATE_TRANSITION: "ready_gate_transition",
  QUEUE_DRAIN_ATTEMPTED: "queue_drain_attempted",
  QUEUE_DRAIN_RESULT: "queue_drain_result",
  DATE_ENTERED_FROM_LOBBY: "date_entered_from_lobby",
  NOTIFICATION_SUPPRESSED: "notification_suppressed",
  NOTIFICATION_SENT: "notification_sent",
} as const;

export type EventLobbyObservabilityEventName =
  (typeof EventLobbyObservabilityEvents)[keyof typeof EventLobbyObservabilityEvents];

export const DECK_EMPTY_REASONS = [
  "event_not_active",
  "user_not_eligible",
  "no_confirmed_candidates",
  "all_candidates_filtered",
  "all_candidates_seen_locally",
  "all_candidates_busy_or_unavailable",
  "rpc_error",
  "network_error",
  "unknown",
] as const;

export type DeckEmptyReason = (typeof DECK_EMPTY_REASONS)[number];

export const FORBIDDEN_EVENT_LOBBY_OBSERVABILITY_KEYS = [
  "profile_id",
  "target_id",
  "actor_id",
  "user_id",
  "email",
  "phone",
  "proof_selfie",
  "moderation",
  "report",
  "block",
  "suspension",
] as const;

const EVENT_INACTIVE_GATE_KINDS = new Set([
  "event_not_active",
  "missing_event",
  "not_found",
  "not_live",
  "scheduled",
  "not_started",
  "ended",
  "completed",
  "cancelled",
  "archived",
  "draft",
  "outside_live_window",
]);

const USER_INELIGIBLE_GATE_KINDS = new Set([
  "user_not_eligible",
  "missing_user",
  "auth",
  "not_authenticated",
  "not_registered",
  "not_confirmed",
  "registration_required",
  "registration_pending",
  "paused",
  "account_paused",
]);

const NOTIFICATION_ATTEMPT_OUTCOMES = new Set([
  "match",
  "match_queued",
  "vibe_recorded",
  "super_vibe_sent",
]);

const SUPPRESSED_OUTCOMES = new Set([
  "already_swiped",
  "swipe_already_recorded",
  "event_not_active",
  "blocked",
  "reported",
  "account_paused",
  "target_unavailable",
  "target_not_found",
  "not_registered",
  "pair_already_met_this_event",
  "participant_has_active_session_conflict",
]);

export type CountBucket = "zero" | "one" | "few" | "many";

export function bucketEventLobbyCount(count: number | null | undefined): CountBucket {
  const n = typeof count === "number" && Number.isFinite(count) ? Math.max(0, count) : 0;
  if (n === 0) return "zero";
  if (n === 1) return "one";
  if (n <= 5) return "few";
  return "many";
}

export function sanitizeReasonCode(value: unknown, fallback = "unknown"): string {
  if (typeof value !== "string") return fallback;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

export function classifyDeckFetchError(error: unknown): DeckEmptyReason {
  if (!error) return "unknown";
  const source =
    typeof error === "object" && error !== null
      ? [
          "code" in error ? String((error as { code?: unknown }).code ?? "") : "",
          "message" in error ? String((error as { message?: unknown }).message ?? "") : "",
          "details" in error ? String((error as { details?: unknown }).details ?? "") : "",
          "hint" in error ? String((error as { hint?: unknown }).hint ?? "") : "",
        ].join(" ")
      : String(error);
  const normalized = source.toLowerCase();
  if (normalized.includes("event_not_active")) return "event_not_active";
  if (
    normalized.includes("network") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("timeout") ||
    normalized.includes("offline")
  ) {
    return "network_error";
  }
  return "rpc_error";
}

export function resolveDeckEmptyReason(input: {
  deckEnabled: boolean;
  gateKind?: string | null;
  deckError?: boolean;
  deckErrorValue?: unknown;
  totalProfiles?: number | null;
  visibleProfiles?: number | null;
  deckEverLoaded?: boolean;
  queuedCount?: number | null;
  yieldingToReadyGate?: boolean;
  yieldingToVideoDate?: boolean;
  userPaused?: boolean;
}): DeckEmptyReason {
  const gateKind = sanitizeReasonCode(input.gateKind, "");
  if (input.deckError) return classifyDeckFetchError(input.deckErrorValue);
  if (input.userPaused || USER_INELIGIBLE_GATE_KINDS.has(gateKind)) return "user_not_eligible";
  if (!input.deckEnabled || EVENT_INACTIVE_GATE_KINDS.has(gateKind)) {
    return EVENT_INACTIVE_GATE_KINDS.has(gateKind) ? "event_not_active" : "user_not_eligible";
  }
  if (input.yieldingToReadyGate || input.yieldingToVideoDate || (input.queuedCount ?? 0) > 0) {
    return "all_candidates_busy_or_unavailable";
  }
  if ((input.totalProfiles ?? 0) > 0 && (input.visibleProfiles ?? 0) === 0) {
    return "all_candidates_seen_locally";
  }
  if (input.deckEverLoaded) return "all_candidates_seen_locally";
  return "no_confirmed_candidates";
}

export type SwipeResultLike = {
  result?: string | null;
  outcome?: string | null;
  error?: string | null;
  reason?: string | null;
  video_session_id?: string | null;
  match_id?: string | null;
  duplicate?: boolean | null;
  idempotent?: boolean | null;
  replay?: boolean | null;
  notification_suppressed?: boolean | null;
  dedupe_reason?: string | null;
};

export function getSwipeOutcome(result: SwipeResultLike | null | undefined): string {
  const raw = result?.outcome ?? result?.result ?? result?.error ?? "unknown";
  return raw === "swipe_recorded" ? "vibe_recorded" : sanitizeReasonCode(raw);
}

export function isDuplicateSwipeResult(result: SwipeResultLike | null | undefined): boolean {
  const outcome = getSwipeOutcome(result);
  return result?.duplicate === true ||
    result?.idempotent === true ||
    result?.replay === true ||
    outcome === "already_swiped" ||
    outcome === "swipe_already_recorded";
}

export function getSwipeNotificationSuppressionReason(
  result: SwipeResultLike | null | undefined,
): string | null {
  const outcome = getSwipeOutcome(result);
  if (result?.notification_suppressed === true) {
    return sanitizeReasonCode(result.dedupe_reason ?? result.reason ?? outcome, "suppressed");
  }
  if (isDuplicateSwipeResult(result)) return sanitizeReasonCode(result?.dedupe_reason ?? outcome, "duplicate");
  if (SUPPRESSED_OUTCOMES.has(outcome)) return outcome;
  return null;
}

export function wasSwipeNotificationAttempted(result: SwipeResultLike | null | undefined): boolean {
  const outcome = getSwipeOutcome(result);
  return NOTIFICATION_ATTEMPT_OUTCOMES.has(outcome) && getSwipeNotificationSuppressionReason(result) == null;
}

export function buildLobbySwipeResultPayload(input: {
  eventId: string;
  platform: EventLobbyPlatform;
  swipeType: string;
  result: SwipeResultLike | null | undefined;
}) {
  const outcome = getSwipeOutcome(input.result);
  const reason = sanitizeReasonCode(input.result?.reason ?? input.result?.dedupe_reason ?? outcome);
  const notificationSuppressedReason = getSwipeNotificationSuppressionReason(input.result);
  return {
    event_id: input.eventId,
    platform: input.platform,
    swipe_type: sanitizeReasonCode(input.swipeType),
    outcome,
    reason,
    session_id_present: Boolean(input.result?.video_session_id || input.result?.match_id),
    notification_attempted: wasSwipeNotificationAttempted(input.result),
    notification_suppressed_reason: notificationSuppressedReason,
    duplicate: isDuplicateSwipeResult(input.result),
  };
}

export function buildQueueDrainResultPayload(input: {
  eventId: string;
  platform: EventLobbyPlatform;
  sourceSurface?: QueueDrainSourceSurface;
  result?: {
    found?: boolean | null;
    queued?: boolean | null;
    reason?: unknown;
    video_session_id?: unknown;
    match_id?: unknown;
  } | null;
  error?: unknown;
  sourceAction?: string;
}) {
  const reason = input.error
    ? classifyDeckFetchError(input.error)
    : sanitizeReasonCode(input.result?.reason ?? (input.result?.found ? "promoted" : input.result?.queued ? "queued" : "no_queued_session"));
  return {
    event_id: input.eventId,
    platform: input.platform,
    source_surface: input.sourceSurface ?? "event_lobby",
    source_action: input.sourceAction ?? "drain_match_queue",
    outcome: input.error ? "error" : input.result?.found ? "promoted" : input.result?.queued ? "queued" : "no_match",
    reason,
    session_id_present: Boolean((input.result as { video_session_id?: unknown; match_id?: unknown } | null | undefined)?.video_session_id ||
      (input.result as { match_id?: unknown } | null | undefined)?.match_id),
  };
}
