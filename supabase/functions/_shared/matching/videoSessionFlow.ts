/**
 * Event-lobby mutual vibe → video date flow uses `video_sessions.id`.
 * Persistent chat uses `matches.id`. Legacy APIs still expose `match_id` for the session id — treat as deprecated.
 */

/** RPC + swipe-actions body for mutual vibe / queue outcomes (session stage only). */
export type SwipeSessionStageResult = {
  result?: string;
  /** @deprecated Same as `video_session_id` when result is `match` or `match_queued` — not `matches.id`. */
  match_id?: string;
  /** Canonical: `video_sessions.id` for ready gate / video date. */
  video_session_id?: string;
  /** Event this session belongs to. */
  event_id?: string;
  immediate?: boolean;
  ready_gate_status?: string;
  success?: boolean;
  error?: string;
  message?: string;
};

/** `drain_match_queue` RPC JSON (session activation, not persistent match). */
export type DrainMatchQueueResult = {
  found: boolean;
  /** @deprecated Same as `video_session_id` when found — not `matches.id`. */
  match_id?: string;
  video_session_id?: string;
  event_id?: string;
  partner_id?: string;
  queued?: boolean;
};

/**
 * Prefer canonical `video_session_id`, fall back to legacy `match_id` (still a session id in swipe/drain flows).
 */
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
  const result = normalizedSwipeSessionStageResult(payload?.result);
  return (
    (result === "match" || result === "already_matched") &&
    Boolean(videoSessionIdFromSwipePayload(payload)) &&
    payload?.immediate !== false
  );
}

export function shouldTrackQueuedSwipeSession(
  payload: SwipeSessionStageResult | null | undefined,
): boolean {
  return (
    normalizedSwipeSessionStageResult(payload?.result) === "match_queued" &&
    Boolean(videoSessionIdFromSwipePayload(payload))
  );
}

export function videoSessionIdFromDrainPayload(
  payload: Pick<DrainMatchQueueResult, "video_session_id" | "match_id"> | null | undefined,
): string | undefined {
  if (!payload) return undefined;
  const v = payload.video_session_id ?? payload.match_id;
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * When `handle_swipe` returns `participant_has_active_session_conflict`, the server refused a new
 * mutual session because either user already has another non-ended `video_sessions` row in this event
 * (see `promote_ready_gate_if_eligible` / mutual insert guard). Surfacing this copy improves trust vs a silent no-op.
 */
export const SWIPE_SESSION_CONFLICT_USER_MESSAGE =
  "You already have a pending match in this event. Finish Ready Gate or wait for that session to end before matching with someone else.";

/** Shown when a queued mutual session hits server TTL (`expire_stale_video_sessions` → `queued_ttl_expired`). */
export const QUEUED_MATCH_TIMED_OUT_USER_MESSAGE =
  "A queued match ran out of time before Ready Gate opened. You can keep browsing and matching in this event.";

/** Web `/ready/:id` + native `/ready/[id]` when the session row ended or registration left Ready Gate. */
export const READY_GATE_STALE_OR_ENDED_USER_MESSAGE =
  "This Ready Gate is no longer active. We're taking you back to the event.";

/** Deep link invalid: missing session, wrong account, or broken id — safe fallback to events home. */
export const READY_GATE_DEEP_LINK_INVALID_USER_MESSAGE =
  "This Ready Gate link isn't valid. We're taking you to your events.";

/**
 * True when Realtime `video_sessions` UPDATE reflects queued → expired TTL cleanup for this user.
 * `ended_reason` may be omitted from payloads; we still trust queued→expired as the lobby-visible TTL path.
 */
export function isVideoSessionQueuedTtlExpiryTransition(
  oldRow: Record<string, unknown> | null | undefined,
  newRow: Record<string, unknown>,
  userId: string,
): boolean {
  const p1 = newRow.participant_1_id;
  const p2 = newRow.participant_2_id;
  if (p1 !== userId && p2 !== userId) return false;
  if ((oldRow?.ready_gate_status as string | undefined) !== "queued") return false;
  if ((newRow.ready_gate_status as string | undefined) !== "expired") return false;
  const er = newRow.ended_reason as string | undefined;
  if (er != null && er !== "" && er !== "queued_ttl_expired") return false;
  return true;
}

/** Lobby deep link: opens ready gate overlay when user lands with a pending session. */
export function buildEventLobbyPendingSessionUrl(eventId: string, videoSessionId: string): string {
  const enc = encodeURIComponent(videoSessionId);
  return `/event/${eventId}/lobby?pendingVideoSession=${enc}&pendingMatch=${enc}`;
}

/** `handle_swipe` results where the lobby deck should not advance the current card. */
export const LOBBY_SWIPE_NO_ADVANCE_RESULTS: ReadonlySet<string> = new Set([
  "blocked",
  "reported",
  "not_registered",
  "target_not_found",
  "limit_reached",
  "already_super_vibed_recently",
  "already_matched",
  /** Another non-ended session for this event already involves one participant (aligned with promotion helper). */
  "participant_has_active_session_conflict",
  /** Cancelled/archived event: `handle_swipe` — do not burn the current deck card. */
  "event_not_active",
]);

export function shouldAdvanceLobbyDeckAfterSwipe(result: string | null | undefined): boolean {
  const normalized = normalizedSwipeSessionStageResult(result);
  if (!normalized) return false;
  return !LOBBY_SWIPE_NO_ADVANCE_RESULTS.has(normalized);
}
