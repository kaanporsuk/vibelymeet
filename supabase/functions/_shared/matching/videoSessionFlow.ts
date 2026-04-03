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

export function videoSessionIdFromDrainPayload(
  payload: Pick<DrainMatchQueueResult, "video_session_id" | "match_id"> | null | undefined,
): string | undefined {
  if (!payload) return undefined;
  const v = payload.video_session_id ?? payload.match_id;
  return typeof v === "string" && v.length > 0 ? v : undefined;
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
  /** Cancelled/archived event: `handle_swipe` — do not burn the current deck card. */
  "event_not_active",
]);

export function shouldAdvanceLobbyDeckAfterSwipe(result: string | null | undefined): boolean {
  if (result == null || result === "") return false;
  return !LOBBY_SWIPE_NO_ADVANCE_RESULTS.has(result);
}
