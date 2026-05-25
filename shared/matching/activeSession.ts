/**
 * Shared active-session resolution for web + native (Stage 1 / Stream 1).
 * Lives under repo-root `shared/` (client-neutral), not Edge function bundles.
 * Registration `queue_status` drives routing; `video_sessions` confirms the row is live and can
 * override stale `in_ready_gate` when the session already entered handshake/date.
 *
 * Lobby hydration normally uses `current_room_id`; post-date survey recovery also checks ended
 * date sessions with no verdict for the current participant so close/reopen can resume `/date/:id`.
 */

import {
  POST_DATE_SURVEY_INELIGIBLE_ENDED_REASONS,
  canAttemptDailyRoomFromCanonicalVideoDateTruth,
  decideCanonicalVideoDateRoute,
  isVideoDateReadyGateTerminalStatus,
  legacyVideoDateTruthRouteDecision,
  normalizeVideoDateReadyGateStatus,
  videoDateRouteTruthHasProviderRoom,
  videoDateRouteTruthIndicatesDate,
  videoDateRouteTruthIsEnded,
  videoDateRouteTruthReadyGateEligible,
} from "./videoDateRouteDecision";

export { POST_DATE_SURVEY_INELIGIBLE_ENDED_REASONS };

export type ActiveSessionKind = "video" | "ready_gate";

export type ActiveSessionBase = {
  kind: ActiveSessionKind;
  sessionId: string;
  eventId: string;
  partnerName?: string | null;
  queueStatus: "in_handshake" | "in_date" | "in_survey" | "in_ready_gate";
};

export type VideoSessionTruthRouteDecision = "navigate_date" | "navigate_ready" | "stay_lobby" | "ended";

export type ReadyGateTransitionActiveSessionTruth = {
  code?: string | null;
  date_capable?: boolean | null;
  error?: string | null;
  error_code?: string | null;
  inactive_reason?: string | null;
  ready_gate_expires_at?: string | number | null;
  ready_gate_status?: string | null;
  reason?: string | null;
  status?: string | null;
  success?: boolean | null;
  terminal?: boolean | null;
};

export function normalizeReadyGateTransitionActiveSessionTruth(
  data: unknown,
): ReadyGateTransitionActiveSessionTruth | null {
  return data && typeof data === "object" ? (data as ReadyGateTransitionActiveSessionTruth) : null;
}

type VideoSessionDailyRoomTruth = {
  daily_room_name?: string | null;
  daily_room_url?: string | null;
  date_extra_seconds?: number | null;
  date_started_at?: string | null;
  ended_at?: string | null;
  ended_reason?: string | null;
  handshake_started_at?: string | null;
  participant_1_joined_at?: string | null;
  participant_2_joined_at?: string | null;
  phase?: string | null;
  ready_gate_expires_at?: string | number | null;
  ready_gate_status?: string | null;
  reconnect_grace_ends_at?: string | null;
  state?: string | null;
  started_at?: string | null;
  state_updated_at?: string | null;
};

export const POST_DATE_SURVEY_RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const ACTIVE_SESSION_HANDSHAKE_FRESH_MS = 90 * 1000;
export const ACTIVE_SESSION_DATE_BASE_SECONDS = 300;
export const ACTIVE_SESSION_DATE_STALE_BUFFER_SECONDS = 60;
export const ACTIVE_SESSION_FALLBACK_MAX_AGE_MS = 10 * 60 * 1000;

const postDateSurveyIneligibleEndedReasons = new Set<string>(
  POST_DATE_SURVEY_INELIGIBLE_ENDED_REASONS,
);
// Static contract anchor: "partial_join_peer_timeout" remains survey-ineligible.

const ACTIVE_SESSION_READY_GATE_BLOCKING_CODES = new Set([
  "ACCESS_DENIED",
  "EVENT_NOT_ACTIVE",
  "READY_GATE_NOT_READY",
  "UNAUTHORIZED",
  "access_denied",
  "event_archived",
  "event_cancelled",
  "event_ended",
  "event_inactive",
  "event_not_active",
  "event_not_live",
  "event_outside_live_window",
  "expired",
  "forfeited",
  "guarded_update_zero_rows",
  "missing_participant_registration",
  "partner_forfeited",
  "participant_forfeited",
  "ready_gate_event_archived",
  "ready_gate_event_cancelled",
  "ready_gate_event_ended",
  "ready_gate_event_inactive",
  "ready_gate_expired",
  "ready_gate_forfeit",
  "ready_gate_registration_desync",
  "ready_gate_timeout",
  "registration_desync",
  "session_ended",
  "session_no_longer_ready_gate_mutable",
  "session_not_found",
  "stale_transition",
  "terminal_state",
]);

export type VideoSessionPendingSurveyTruth = {
  id?: string | null;
  event_id?: string | null;
  participant_1_id?: string | null;
  participant_2_id?: string | null;
  ended_at?: string | null;
  ended_reason?: string | null;
  date_started_at?: string | null;
  participant_1_joined_at?: string | null;
  participant_2_joined_at?: string | null;
  phase?: string | null;
  state?: string | null;
};

function readyGateExpiryMs(
  rawExpiry: string | number | null | undefined,
): number | null {
  if (rawExpiry == null) return null;
  const expiresMs =
    typeof rawExpiry === "number"
      ? rawExpiry
      : Date.parse(String(rawExpiry));
  return Number.isFinite(expiresMs) ? expiresMs : null;
}

function timestampMs(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  const ms = typeof raw === "number" ? raw : Date.parse(String(raw));
  return Number.isFinite(ms) ? ms : null;
}

function normalizeReason(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readyGateTransitionStatus(
  truth: ReadyGateTransitionActiveSessionTruth | null | undefined,
): string | null {
  return normalizeReason(truth?.ready_gate_status) ?? normalizeReason(truth?.status);
}

function readyGateTransitionReasons(
  truth: ReadyGateTransitionActiveSessionTruth | null | undefined,
): string[] {
  return [
    readyGateTransitionStatus(truth),
    normalizeReason(truth?.reason),
    normalizeReason(truth?.error),
    normalizeReason(truth?.error_code),
    normalizeReason(truth?.code),
    normalizeReason(truth?.inactive_reason),
  ].filter((value): value is string => Boolean(value));
}

function isTimestampFresh(
  raw: string | number | null | undefined,
  nowMs: number,
  maxAgeMs: number,
): boolean {
  const ms = timestampMs(raw);
  if (ms == null) return false;
  return nowMs - ms < maxAgeMs;
}

function activeReconnectGraceIsOpen(
  row: Pick<VideoSessionDailyRoomTruth, "reconnect_grace_ends_at"> | null,
  nowMs: number,
): boolean {
  const graceEndsMs = timestampMs(row?.reconnect_grace_ends_at);
  return graceEndsMs != null && graceEndsMs > nowMs;
}

/**
 * True only when local DB truth proves Daily room metadata is persisted.
 * A routeable video date must have this proof before `/date/:id` may try to join.
 */
export function videoSessionHasProviderRoom(
  row: Pick<VideoSessionDailyRoomTruth, "daily_room_name" | "daily_room_url"> | null,
): boolean {
  return videoDateRouteTruthHasProviderRoom(row);
}

/**
 * True when Ready Gate may call the provider preparation path. This is not a
 * route-to-date signal; it only means the session is eligible to attempt
 * provider preparation from Ready Gate.
 */
export function canPrepareDailyRoomFromReadyGateTruth(
  row: VideoSessionDailyRoomTruth | null,
  nowMs: number = Date.now(),
): boolean {
  if (!row || videoSessionRowIsEnded(row)) return false;
  if (canAttemptDailyRoomFromVideoSessionTruth(row, nowMs)) return true;
  if (normalizeVideoDateReadyGateStatus(row.ready_gate_status) !== "both_ready") return false;
  const expiresMs = readyGateExpiryMs(row.ready_gate_expires_at);
  return expiresMs != null && expiresMs > nowMs;
}

/**
 * Canonical client mirror of the Daily room server gate for date-route entry.
 * Legacy `phase` is intentionally ignored: mixed rows can still carry
 * `phase = "handshake"` while the canonical state remains `ready_gate`.
 */
export function canAttemptDailyRoomFromVideoSessionTruth(
  row: VideoSessionDailyRoomTruth | null,
  _nowMs: number = Date.now(),
): boolean {
  if (!row || videoSessionRowIsEnded(row)) return false;
  if (!videoSessionHasProviderRoom(row)) return false;
  return canAttemptDailyRoomFromCanonicalVideoDateTruth(row);
}

/** Prefer in-date / handshake / survey over ready gate when multiple rows exist (stale data guard). */
export function pickRegistrationForActiveSession<
  T extends { queue_status: string | null; current_room_id: string | null; event_id: string },
>(regs: T[]): T | null {
  const list = regs ?? [];
  const withRoom = list.filter((r) => r.current_room_id);
  const video =
    withRoom.find(
      (r) => r.queue_status === "in_handshake" || r.queue_status === "in_date" || r.queue_status === "in_survey"
    ) ?? null;
  if (video) return video;
  return withRoom.find((r) => r.queue_status === "in_ready_gate") ?? null;
}

/**
 * True when `video_sessions` already reflects an authoritative handshake/date transition.
 * Do not trust legacy `phase` alone here.
 */
export function videoSessionRowIndicatesHandshakeOrDate(
  row: {
    daily_room_name?: string | null;
    daily_room_url?: string | null;
    date_started_at?: string | null;
    state?: string | null;
    handshake_started_at?: string | null;
  } | null
): boolean {
  return Boolean(row && videoSessionHasProviderRoom(row) && videoDateRouteTruthIndicatesDate(row));
}

export function videoSessionRowIsEnded(
  row: {
    daily_room_name?: string | null;
    daily_room_url?: string | null;
    ended_at?: string | null;
    state?: string | null;
    phase?: string | null;
  } | null
): boolean {
  return videoDateRouteTruthIsEnded(row);
}

export function videoSessionHasRecoverablePostDateSurveyTruth(
  row: VideoSessionPendingSurveyTruth | null,
  nowMs: number = Date.now(),
): boolean {
  if (!videoSessionHasPostDateSurveyTruth(row)) return false;
  const endedMs = timestampMs(row?.ended_at);
  return endedMs != null && nowMs - endedMs <= POST_DATE_SURVEY_RECOVERY_WINDOW_MS;
}

export function videoSessionHasEncounterExposureTruth(
  row: Pick<
    VideoSessionPendingSurveyTruth,
    "date_started_at" | "participant_1_joined_at" | "participant_2_joined_at" | "phase" | "state"
  > | null,
): boolean {
  return Boolean(
    row &&
      (row.date_started_at ||
        row.state === "date" ||
        row.phase === "date" ||
        (row.participant_1_joined_at && row.participant_2_joined_at))
  );
}

export function videoSessionHasTerminalEncounterExposureTruth(
  row: VideoSessionPendingSurveyTruth | null,
): boolean {
  if (!row?.ended_at) return false;
  const endedReason = row.ended_reason ?? "";
  if (postDateSurveyIneligibleEndedReasons.has(endedReason)) return false;
  return videoSessionHasEncounterExposureTruth(row);
}

export function videoSessionHasPostDateSurveyTruth(
  row: VideoSessionPendingSurveyTruth | null,
): boolean {
  return videoSessionHasTerminalEncounterExposureTruth(row);
}

export function getVideoSessionPartnerIdForUser(
  row: Pick<VideoSessionPendingSurveyTruth, "participant_1_id" | "participant_2_id"> | null,
  userId: string | null | undefined,
): string | null {
  if (!row || !userId) return null;
  if (row.participant_1_id === userId) return row.participant_2_id ?? null;
  if (row.participant_2_id === userId) return row.participant_1_id ?? null;
  return null;
}

export function pickRecoverablePendingPostDateSurveySession<
  T extends VideoSessionPendingSurveyTruth,
>(
  rows: readonly T[] | null | undefined,
  feedbackSessionIdsForUser: ReadonlySet<string>,
  userId: string,
  nowMs: number = Date.now(),
): T | null {
  for (const row of rows ?? []) {
    if (!row.id || !row.event_id) continue;
    if (!getVideoSessionPartnerIdForUser(row, userId)) continue;
    if (!videoSessionHasRecoverablePostDateSurveyTruth(row, nowMs)) continue;
    if (feedbackSessionIdsForUser.has(row.id)) continue;
    return row;
  }
  return null;
}

export function videoSessionRowReadyGateEligible(
  row: {
    ready_gate_status?: string | null;
    ready_gate_expires_at?: string | number | null;
  } | null,
  nowMs: number = Date.now()
): boolean {
  if (!row) return false;
  return videoDateRouteTruthReadyGateEligible(row, nowMs);
}

export function readyGateTransitionResultHasDateCapableTruth(
  truth: ReadyGateTransitionActiveSessionTruth | null | undefined,
): boolean {
  return truth?.date_capable === true;
}

export function readyGateTransitionResultBlocksActiveSession(
  truth: ReadyGateTransitionActiveSessionTruth | null | undefined,
): boolean {
  if (!truth || typeof truth !== "object") return true;
  if (truth.success === false) return true;

  const status = readyGateTransitionStatus(truth);
  if (isVideoDateReadyGateTerminalStatus(status)) return true;
  if (truth.terminal === true && status !== "both_ready") return true;

  return readyGateTransitionReasons(truth).some((reason) =>
    ACTIVE_SESSION_READY_GATE_BLOCKING_CODES.has(reason),
  );
}

export function readyGateTransitionResultReadyGateEligible(
  truth: ReadyGateTransitionActiveSessionTruth | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (readyGateTransitionResultBlocksActiveSession(truth)) return false;
  return videoSessionRowReadyGateEligible(
    {
      ready_gate_status: readyGateTransitionStatus(truth),
      ready_gate_expires_at: truth?.ready_gate_expires_at,
    },
    nowMs,
  );
}

export function decideVideoSessionRouteFromTruth(
  row: VideoSessionDailyRoomTruth | null,
  nowMs: number = Date.now()
): VideoSessionTruthRouteDecision {
  return legacyVideoDateTruthRouteDecision(
    decideCanonicalVideoDateRoute({
      truth: row,
      nowMs,
    }),
  );
}

export function isActiveSessionDirectFallbackFresh(
  row: VideoSessionDailyRoomTruth | null,
  nowMs: number = Date.now(),
): boolean {
  if (!row || row.ended_at) return false;
  if (activeReconnectGraceIsOpen(row, nowMs)) return true;

  const decision = decideVideoSessionRouteFromTruth(row, nowMs);
  if (decision === "navigate_ready") return videoSessionRowReadyGateEligible(row, nowMs);
  if (!canAttemptDailyRoomFromVideoSessionTruth(row, nowMs) && decision !== "navigate_date") {
    return false;
  }

  const dateStartedMs = timestampMs(row.date_started_at);
  if (dateStartedMs != null) {
    const extraSeconds =
      typeof row.date_extra_seconds === "number" && Number.isFinite(row.date_extra_seconds)
        ? Math.max(0, row.date_extra_seconds)
        : 0;
    const maxDateAgeMs =
      (ACTIVE_SESSION_DATE_BASE_SECONDS + extraSeconds + ACTIVE_SESSION_DATE_STALE_BUFFER_SECONDS) * 1000;
    return nowMs - dateStartedMs < maxDateAgeMs;
  }

  if (row.state === "date" || row.phase === "date") {
    return (
      isTimestampFresh(row.state_updated_at, nowMs, ACTIVE_SESSION_FALLBACK_MAX_AGE_MS) ||
      isTimestampFresh(row.started_at, nowMs, ACTIVE_SESSION_FALLBACK_MAX_AGE_MS)
    );
  }

  if (row.handshake_started_at) {
    return isTimestampFresh(row.handshake_started_at, nowMs, ACTIVE_SESSION_HANDSHAKE_FRESH_MS);
  }

  if (row.state === "handshake") {
    return (
      isTimestampFresh(row.state_updated_at, nowMs, ACTIVE_SESSION_HANDSHAKE_FRESH_MS) ||
      isTimestampFresh(row.started_at, nowMs, ACTIVE_SESSION_HANDSHAKE_FRESH_MS)
    );
  }

  return false;
}

export function activeSessionDirectFallbackStaleReason(
  row: VideoSessionDailyRoomTruth | null,
  nowMs: number = Date.now(),
): "direct_video_session_fallback_stale" | null {
  if (!row || row.ended_at) return null;
  const decision = decideVideoSessionRouteFromTruth(row, nowMs);
  const routeable =
    canAttemptDailyRoomFromVideoSessionTruth(row, nowMs) ||
    decision === "navigate_date" ||
    decision === "navigate_ready";
  if (!routeable) return null;
  return isActiveSessionDirectFallbackFresh(row, nowMs)
    ? null
    : "direct_video_session_fallback_stale";
}

/** Best-effort queue_status aligned with session row when registration still says `in_ready_gate`. */
export function inferVideoQueueStatusFromSessionTruth(
  row: {
    daily_room_name?: string | null;
    daily_room_url?: string | null;
    state?: string | null;
    phase?: string | null;
    date_started_at?: string | null;
  } | null
): "in_date" | "in_handshake" {
  if (!row) return "in_handshake";
  if (videoSessionHasProviderRoom(row) && (row.state === "date" || row.phase === "date" || row.date_started_at)) return "in_date";
  return "in_handshake";
}
