/**
 * Event-lobby mutual vibe → video date flow uses `video_sessions.id`.
 * Persistent chat uses `matches.id`. Legacy APIs still expose `match_id` for the session id — treat as deprecated.
 */

/** RPC + swipe-actions body for mutual vibe outcomes (session stage only). */
export type SwipeSessionStageResult = {
  result?: string;
  /** Additive canonical outcome, when present. Mirrors `result` for new SQL/Edge paths. */
  outcome?: string;
  /** @deprecated Same as `video_session_id` when result is `match` — not `matches.id`. */
  match_id?: string;
  /** Canonical: `video_sessions.id` for ready gate / video date. */
  video_session_id?: string;
  /** Event this session belongs to. */
  event_id?: string;
  immediate?: boolean;
  ready_gate_status?: string;
  /** True only when this swipe recorded a new Super Vibe row. */
  super_vibe_consumed?: boolean;
  success?: boolean;
  error?: string;
  reason?: string;
  message?: string;
  retry_after_seconds?: number;
  retry_after_ms?: number;
  retry_at?: string;
  duplicate?: boolean;
  idempotent?: boolean;
  replay?: boolean;
  notification_suppressed?: boolean;
  dedupe_reason?: string;
  existing_swipe_type?: string;
  requested_swipe_type?: string;
};

/** Prefer canonical `video_session_id`, fall back to legacy `match_id` (still a session id in swipe flows). */
export function videoSessionIdFromSwipePayload(
  payload: Pick<SwipeSessionStageResult, "video_session_id" | "match_id"> | null | undefined,
): string | undefined {
  if (!payload) return undefined;
  const v = payload.video_session_id ?? payload.match_id;
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export function normalizedSwipeSessionStageResult(
  result: string | null | undefined,
): string | undefined {
  if (result == null || result === "") return undefined;
  return result === "swipe_recorded" ? "vibe_recorded" : result;
}

export function shouldOpenReadyGateFromSwipePayload(
  payload: SwipeSessionStageResult | null | undefined,
): boolean {
  const result = normalizedSwipeSessionStageResult(payload?.result ?? payload?.outcome);
  return (
    (result === "match" || result === "already_matched") &&
    Boolean(videoSessionIdFromSwipePayload(payload)) &&
    payload?.immediate !== false
  );
}

/**
 * When `handle_swipe` returns `participant_has_active_session_conflict`, the server refused a new
 * mutual session because a user is already in a non-queued Ready Gate / video date stage for this event.
 * Surfacing this copy improves trust vs a silent no-op.
 */
export const SWIPE_SESSION_CONFLICT_USER_MESSAGE =
  "You are already in a live Ready Gate or video date. Finish it before matching again.";

export const SWIPE_PAIR_ALREADY_MET_USER_MESSAGE =
  "You already met this person in this event. Keep browsing for new people.";

export const SWIPE_TARGET_UNAVAILABLE_USER_MESSAGE =
  "This person is no longer available in the lobby.";

export const SWIPE_ACCOUNT_PAUSED_USER_MESSAGE =
  "Resume your account before swiping in this event.";

export const SWIPE_ALREADY_RECORDED_USER_MESSAGE =
  "You already swiped on this person.";

export const SWIPE_GENERIC_FAILURE_USER_MESSAGE =
  "Unable to complete swipe. Try again in a moment.";

export const SWIPE_RATE_LIMITED_USER_MESSAGE =
  "Catch your breath before swiping again.";

/** Web `/ready/:id` + native `/ready/[id]` when the session row ended or registration left Ready Gate. */
export const READY_GATE_STALE_OR_ENDED_USER_MESSAGE =
  "This Ready Gate is no longer active. We're taking you back to the event.";

/** Deep link invalid: missing session, wrong account, or broken id — safe fallback to events home. */
export const READY_GATE_DEEP_LINK_INVALID_USER_MESSAGE =
  "This Ready Gate link isn't valid. We're taking you to your events.";

export function getSwipeFailureUserMessage(
  payload: SwipeSessionStageResult | null | undefined,
): string {
  const code = normalizedSwipeSessionStageResult(payload?.result ?? payload?.outcome ?? payload?.error);
  switch (code) {
    case "participant_has_active_session_conflict":
      return SWIPE_SESSION_CONFLICT_USER_MESSAGE;
    case "pair_already_met_this_event":
      return SWIPE_PAIR_ALREADY_MET_USER_MESSAGE;
    case "target_unavailable":
    case "target_not_found":
      return SWIPE_TARGET_UNAVAILABLE_USER_MESSAGE;
    case "account_paused":
      return SWIPE_ACCOUNT_PAUSED_USER_MESSAGE;
    case "blocked":
    case "reported":
      return "This person is not available for matching.";
    case "event_not_active":
      return "This event is no longer active.";
    case "not_registered":
      return "Only confirmed guests can swipe in this lobby.";
    case "swipe_already_recorded":
      return SWIPE_ALREADY_RECORDED_USER_MESSAGE;
    case "already_super_vibed_recently":
      return "You recently Super Vibed this person.";
    case "limit_reached":
      return "You've used all 3 Super Vibes for this event.";
    case "unauthorized":
      return "Sign in again to keep swiping.";
    case "rate_limited":
    case "too_many_requests":
    case "swipe_rate_limited":
      return SWIPE_RATE_LIMITED_USER_MESSAGE;
    default: {
      const message = payload?.message?.trim();
      return message || SWIPE_GENERIC_FAILURE_USER_MESSAGE;
    }
  }
}

/** `handle_swipe` results where the lobby deck should not advance the current card. */
export const LOBBY_SWIPE_NO_ADVANCE_RESULTS: ReadonlySet<string> = new Set([
  "blocked",
  "reported",
  "account_paused",
  "unauthorized",
  "invalid_request",
  "swipe_failed",
  "internal_error",
  "unknown",
  "not_registered",
  "target_not_found",
  "rate_limited",
  "too_many_requests",
  "swipe_rate_limited",
  "limit_reached",
  "already_super_vibed_recently",
  "already_matched",
  /** Another non-ended session for this event already involves one participant (aligned with promotion helper). */
  "participant_has_active_session_conflict",
  /** Cancelled/archived event: `handle_swipe` — do not burn the current deck card. */
  "event_not_active",
  /** Retry conflict: the natural event/actor/target swipe key already has a different recorded type. */
  "swipe_already_recorded",
  /** Retry/no-op: the same natural swipe key and same swipe type were already recorded. */
  "already_swiped",
]);

export function shouldAdvanceLobbyDeckAfterSwipe(result: string | null | undefined): boolean {
  const normalized = normalizedSwipeSessionStageResult(result);
  if (!normalized) return false;
  return !LOBBY_SWIPE_NO_ADVANCE_RESULTS.has(normalized);
}
