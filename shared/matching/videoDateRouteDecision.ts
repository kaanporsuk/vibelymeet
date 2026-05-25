export type CanonicalReadyGateStatus =
  | "queued"
  | "waiting"
  | "open"
  | "ready"
  | "ready_a"
  | "ready_b"
  | "both_ready"
  | "snoozed"
  | "forfeited"
  | "expired"
  | "cancelled"
  | "ended";

export type VideoDateCanonicalRouteTarget =
  | "home"
  | "lobby"
  | "ready_gate"
  | "date"
  | "survey"
  | "chat"
  | "ended";

export type VideoDateLegacyTruthRouteDecision =
  | "navigate_date"
  | "navigate_ready"
  | "stay_lobby"
  | "ended";

export type VideoDateCanonicalRouteDecision = {
  target: VideoDateCanonicalRouteTarget;
  reason: string;
  sessionId: string | null;
  eventId: string | null;
  matchId?: string | null;
  targetId?: string | null;
  queueStatus?: string | null;
  readyGateStatus?: CanonicalReadyGateStatus | null;
  canAttemptDaily: boolean;
  hasProviderRoom: boolean;
  legacyDecision: VideoDateLegacyTruthRouteDecision;
};

export type VideoDateRouteRegistrationTruth = {
  queue_status?: string | null;
  current_room_id?: string | null;
  event_id?: string | null;
};

export type VideoDateRouteSessionTruth = {
  id?: string | null;
  event_id?: string | null;
  participant_1_id?: string | null;
  participant_2_id?: string | null;
  daily_room_name?: string | null;
  daily_room_url?: string | null;
  date_started_at?: string | null;
  ended_at?: string | null;
  ended_reason?: string | null;
  handshake_started_at?: string | null;
  participant_1_joined_at?: string | null;
  participant_2_joined_at?: string | null;
  phase?: string | null;
  ready_gate_expires_at?: string | number | null;
  ready_gate_status?: string | null;
  state?: string | null;
};

export type VideoDateServerNextSurfaceLike = {
  action?: string | null;
  eventId?: string | null;
  event_id?: string | null;
  matchId?: string | null;
  match_id?: string | null;
  nextSessionId?: string | null;
  next_session_id?: string | null;
  sessionId?: string | null;
  session_id?: string | null;
  targetId?: string | null;
  target_id?: string | null;
};

export type DecideVideoDateCanonicalRouteInput = {
  sessionId?: string | null;
  eventId?: string | null;
  truth?: VideoDateRouteSessionTruth | null;
  registration?: VideoDateRouteRegistrationTruth | null;
  serverNextSurface?: VideoDateServerNextSurfaceLike | null;
  userFeedbackSubmitted?: boolean;
  nowMs?: number;
};

const ACTIVE_READY_GATE_STATUSES = new Set<CanonicalReadyGateStatus>([
  "ready",
  "ready_a",
  "ready_b",
  "both_ready",
  "snoozed",
]);

const TERMINAL_READY_GATE_STATUSES = new Set<CanonicalReadyGateStatus>([
  "forfeited",
  "expired",
  "cancelled",
  "ended",
]);

export const POST_DATE_SURVEY_INELIGIBLE_ENDED_REASONS = [
  "ready_gate_forfeit",
  "ready_gate_expired",
  "queued_ttl_expired",
  "handshake_grace_expired",
  "partial_join_peer_timeout",
  "blocked_pair",
  "blocked_or_reported_pair",
] as const;

const postDateSurveyIneligibleEndedReasons = new Set<string>(
  POST_DATE_SURVEY_INELIGIBLE_ENDED_REASONS,
);

function normalizeString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function expiryMs(rawExpiry: string | number | null | undefined): number | null {
  if (rawExpiry == null) return null;
  const expiresMs =
    typeof rawExpiry === "number"
      ? rawExpiry
      : Date.parse(String(rawExpiry));
  return Number.isFinite(expiresMs) ? expiresMs : null;
}

export function normalizeVideoDateReadyGateStatus(
  status: string | null | undefined,
): CanonicalReadyGateStatus | null {
  const normalized = normalizeString(status)?.toLowerCase();
  if (!normalized) return null;
  if (normalized === "one_ready") return "ready";
  if (
    normalized === "queued" ||
    normalized === "waiting" ||
    normalized === "open" ||
    normalized === "ready" ||
    normalized === "ready_a" ||
    normalized === "ready_b" ||
    normalized === "both_ready" ||
    normalized === "snoozed" ||
    normalized === "forfeited" ||
    normalized === "expired" ||
    normalized === "cancelled" ||
    normalized === "ended"
  ) {
    return normalized;
  }
  return null;
}

export function isVideoDateReadyGateActiveStatus(
  status: string | null | undefined,
): boolean {
  const normalized = normalizeVideoDateReadyGateStatus(status);
  return normalized != null && ACTIVE_READY_GATE_STATUSES.has(normalized);
}

export function isVideoDateReadyGateTerminalStatus(
  status: string | null | undefined,
): boolean {
  const normalized = normalizeVideoDateReadyGateStatus(status);
  return normalized != null && TERMINAL_READY_GATE_STATUSES.has(normalized);
}

export function videoDateRouteTruthHasProviderRoom(
  row: Pick<VideoDateRouteSessionTruth, "daily_room_name" | "daily_room_url"> | null,
): boolean {
  return Boolean(row?.daily_room_name && row.daily_room_url);
}

export function videoDateRouteTruthIsEnded(
  row: Pick<VideoDateRouteSessionTruth, "ended_at" | "state" | "phase"> | null,
): boolean {
  return Boolean(row && (row.ended_at || row.state === "ended" || row.phase === "ended"));
}

export function videoDateRouteTruthIndicatesDate(
  row: Pick<
    VideoDateRouteSessionTruth,
    "daily_room_name" | "daily_room_url" | "date_started_at" | "handshake_started_at" | "state"
  > | null,
): boolean {
  return Boolean(
    row &&
      videoDateRouteTruthHasProviderRoom(row) &&
      (row.state === "handshake" ||
        row.state === "date" ||
        row.handshake_started_at ||
        row.date_started_at),
  );
}

export function canAttemptDailyRoomFromCanonicalVideoDateTruth(
  row: VideoDateRouteSessionTruth | null,
): boolean {
  if (!row || videoDateRouteTruthIsEnded(row)) return false;
  return videoDateRouteTruthIndicatesDate(row);
}

export function videoDateRouteTruthReadyGateEligible(
  row: Pick<VideoDateRouteSessionTruth, "ready_gate_status" | "ready_gate_expires_at"> | null,
  nowMs: number = Date.now(),
): boolean {
  if (!row || !isVideoDateReadyGateActiveStatus(row.ready_gate_status)) return false;
  const expiresMs = expiryMs(row.ready_gate_expires_at);
  return expiresMs != null && expiresMs > nowMs;
}

function videoDateRouteTruthHasEncounterExposure(
  row: Pick<
    VideoDateRouteSessionTruth,
    "date_started_at" | "participant_1_joined_at" | "participant_2_joined_at" | "phase" | "state"
  > | null,
): boolean {
  return Boolean(
    row &&
      (row.date_started_at ||
        row.state === "date" ||
        row.phase === "date" ||
        (row.participant_1_joined_at && row.participant_2_joined_at)),
  );
}

function videoDateRouteTruthHasPostDateSurvey(
  row: VideoDateRouteSessionTruth | null,
): boolean {
  if (!row?.ended_at) return false;
  const endedReason = row.ended_reason ?? "";
  if (postDateSurveyIneligibleEndedReasons.has(endedReason)) return false;
  return videoDateRouteTruthHasEncounterExposure(row);
}

function sessionIdFromServerNextSurface(
  surface: VideoDateServerNextSurfaceLike,
): string | null {
  return (
    surface.nextSessionId ??
    surface.next_session_id ??
    surface.sessionId ??
    surface.session_id ??
    null
  );
}

function eventIdFromServerNextSurface(
  surface: VideoDateServerNextSurfaceLike,
): string | null {
  return surface.eventId ?? surface.event_id ?? null;
}

function makeDecision(input: {
  target: VideoDateCanonicalRouteTarget;
  reason: string;
  sessionId: string | null;
  eventId: string | null;
  matchId?: string | null;
  targetId?: string | null;
  queueStatus?: string | null;
  readyGateStatus?: CanonicalReadyGateStatus | null;
  canAttemptDaily: boolean;
  hasProviderRoom: boolean;
  legacyDecision?: VideoDateLegacyTruthRouteDecision;
}): VideoDateCanonicalRouteDecision {
  return {
    target: input.target,
    reason: input.reason,
    sessionId: input.sessionId,
    eventId: input.eventId,
    matchId: input.matchId ?? null,
    targetId: input.targetId ?? null,
    queueStatus: input.queueStatus ?? null,
    readyGateStatus: input.readyGateStatus ?? null,
    canAttemptDaily: input.canAttemptDaily,
    hasProviderRoom: input.hasProviderRoom,
    legacyDecision:
      input.legacyDecision ??
      (input.target === "date"
        ? "navigate_date"
        : input.target === "ready_gate"
          ? "navigate_ready"
          : input.target === "ended" || input.target === "survey"
            ? "ended"
            : "stay_lobby"),
  };
}

function routeFromServerNextSurface(input: {
  surface: VideoDateServerNextSurfaceLike;
  fallbackSessionId: string | null;
  fallbackEventId: string | null;
  canAttemptDaily: boolean;
  hasProviderRoom: boolean;
  readyGateEligible: boolean;
  truthKnown: boolean;
}): VideoDateCanonicalRouteDecision | null {
  const action = input.surface.action ?? null;
  const sessionId = sessionIdFromServerNextSurface(input.surface) ?? input.fallbackSessionId;
  const eventId = eventIdFromServerNextSurface(input.surface) ?? input.fallbackEventId;
  const matchId = input.surface.matchId ?? input.surface.match_id ?? null;
  const targetId = input.surface.targetId ?? input.surface.target_id ?? null;
  switch (action) {
    case "ready_gate":
      if (input.truthKnown && !input.readyGateEligible) return null;
      return makeDecision({
        target: "ready_gate",
        reason: "server_next_ready_gate",
        sessionId,
        eventId,
        canAttemptDaily: input.canAttemptDaily,
        hasProviderRoom: input.hasProviderRoom,
      });
    case "video_date":
      if (input.truthKnown && !input.canAttemptDaily) return null;
      return makeDecision({
        target: "date",
        reason: "server_next_video_date",
        sessionId,
        eventId,
        canAttemptDaily: input.canAttemptDaily,
        hasProviderRoom: input.hasProviderRoom,
      });
    case "survey":
      return makeDecision({
        target: "survey",
        reason: "server_next_survey",
        sessionId,
        eventId,
        canAttemptDaily: input.canAttemptDaily,
        hasProviderRoom: input.hasProviderRoom,
        legacyDecision: "stay_lobby",
      });
    case "chat":
      return makeDecision({
        target: "chat",
        reason: "server_next_chat",
        sessionId,
        eventId,
        matchId,
        targetId,
        canAttemptDaily: input.canAttemptDaily,
        hasProviderRoom: input.hasProviderRoom,
        legacyDecision: "stay_lobby",
      });
    case "lobby":
      return makeDecision({
        target: eventId ? "lobby" : "home",
        reason: eventId ? "server_next_lobby" : "server_next_lobby_missing_event",
        sessionId,
        eventId,
        canAttemptDaily: input.canAttemptDaily,
        hasProviderRoom: input.hasProviderRoom,
      });
    case "wrap_up":
      return makeDecision({
        target: "ended",
        reason: "server_next_wrap_up",
        sessionId,
        eventId,
        canAttemptDaily: input.canAttemptDaily,
        hasProviderRoom: input.hasProviderRoom,
        legacyDecision: "ended",
      });
    case "home":
      return makeDecision({
        target: "home",
        reason: "server_next_home",
        sessionId,
        eventId,
        canAttemptDaily: input.canAttemptDaily,
        hasProviderRoom: input.hasProviderRoom,
      });
    default:
      return null;
  }
}

export function decideCanonicalVideoDateRoute(
  params: DecideVideoDateCanonicalRouteInput,
): VideoDateCanonicalRouteDecision {
  const nowMs = params.nowMs ?? Date.now();
  const truth = params.truth ?? null;
  const registration = params.registration ?? null;
  const sessionId = params.sessionId ?? truth?.id ?? registration?.current_room_id ?? null;
  const eventId = truth?.event_id ?? registration?.event_id ?? params.eventId ?? null;
  const queueStatus = registration?.queue_status ?? null;
  const readyGateStatus = normalizeVideoDateReadyGateStatus(truth?.ready_gate_status);
  const canAttemptDaily = canAttemptDailyRoomFromCanonicalVideoDateTruth(truth);
  const hasProviderRoom = videoDateRouteTruthHasProviderRoom(truth);

  if (params.serverNextSurface) {
    const serverDecision = routeFromServerNextSurface({
      surface: params.serverNextSurface,
      fallbackSessionId: sessionId,
      fallbackEventId: eventId,
      canAttemptDaily,
      hasProviderRoom,
      readyGateEligible: truth ? videoDateRouteTruthReadyGateEligible(truth, nowMs) : false,
      truthKnown: Boolean(truth),
    });
    if (serverDecision) return serverDecision;
  }

  if (!truth) {
    return makeDecision({
      target: eventId ? "lobby" : "home",
      reason: eventId ? "missing_session_truth_lobby" : "missing_session_truth_home",
      sessionId,
      eventId,
      queueStatus,
      canAttemptDaily,
      hasProviderRoom,
      legacyDecision: "stay_lobby",
    });
  }

  if (videoDateRouteTruthIsEnded(truth)) {
    if (!params.userFeedbackSubmitted && videoDateRouteTruthHasPostDateSurvey(truth)) {
      return makeDecision({
        target: "survey",
        reason: "ended_pending_survey",
        sessionId,
        eventId,
        queueStatus,
        readyGateStatus,
        canAttemptDaily,
        hasProviderRoom,
        legacyDecision: "ended",
      });
    }
    return makeDecision({
      target: "ended",
      reason: "session_ended",
      sessionId,
      eventId,
      queueStatus,
      readyGateStatus,
      canAttemptDaily,
      hasProviderRoom,
      legacyDecision: "ended",
    });
  }

  if (canAttemptDaily) {
    return makeDecision({
      target: "date",
      reason: "provider_room_date_ready",
      sessionId,
      eventId,
      queueStatus,
      readyGateStatus,
      canAttemptDaily,
      hasProviderRoom,
    });
  }

  if (videoDateRouteTruthReadyGateEligible(truth, nowMs)) {
    return makeDecision({
      target: "ready_gate",
      reason: "ready_gate_active",
      sessionId,
      eventId,
      queueStatus,
      readyGateStatus,
      canAttemptDaily,
      hasProviderRoom,
    });
  }

  if (queueStatus === "in_survey" && videoDateRouteTruthHasPostDateSurvey(truth)) {
    return makeDecision({
      target: "survey",
      reason: "registration_pending_survey",
      sessionId,
      eventId,
      queueStatus,
      readyGateStatus,
      canAttemptDaily,
      hasProviderRoom,
      legacyDecision: "stay_lobby",
    });
  }

  if (
    !hasProviderRoom &&
    (queueStatus === "in_handshake" || queueStatus === "in_date") &&
    sessionId &&
    registration?.current_room_id === sessionId
  ) {
    return makeDecision({
      target: eventId ? "lobby" : "home",
      reason: eventId ? "registration_video_without_provider_room_lobby" : "registration_video_without_provider_room_home",
      sessionId,
      eventId,
      queueStatus,
      readyGateStatus,
      canAttemptDaily,
      hasProviderRoom,
      legacyDecision: "stay_lobby",
    });
  }

  return makeDecision({
    target: eventId ? "lobby" : "home",
    reason: eventId ? "not_routeable_lobby" : "not_routeable_home",
    sessionId,
    eventId,
    queueStatus,
    readyGateStatus,
    canAttemptDaily,
    hasProviderRoom,
    legacyDecision: "stay_lobby",
  });
}

export function legacyVideoDateTruthRouteDecision(
  decision: VideoDateCanonicalRouteDecision,
): VideoDateLegacyTruthRouteDecision {
  return decision.legacyDecision;
}

export function canonicalVideoDateRouteLogDetail(
  decision: VideoDateCanonicalRouteDecision,
  params: {
    sourceSurface?: string | null;
    sourceAction?: string | null;
  } = {},
): Record<string, string | boolean | null> {
  return {
    source_surface: params.sourceSurface ?? null,
    source_action: params.sourceAction ?? null,
    canonical_target: decision.target,
    canonical_reason: decision.reason,
    canonical_session_id: decision.sessionId,
    canonical_event_id: decision.eventId,
    canonical_match_id: decision.matchId ?? null,
    canonical_target_id: decision.targetId ?? null,
    canonical_queue_status: decision.queueStatus ?? null,
    canonical_ready_gate_status: decision.readyGateStatus ?? null,
    canonical_can_attempt_daily: decision.canAttemptDaily,
    canonical_has_provider_room: decision.hasProviderRoom,
    canonical_legacy_decision: decision.legacyDecision,
  };
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

export function webPathForCanonicalVideoDateRoute(
  decision: VideoDateCanonicalRouteDecision,
): string {
  switch (decision.target) {
    case "ready_gate":
      return decision.sessionId ? `/ready/${encodeSegment(decision.sessionId)}` : "/home";
    case "date":
    case "survey":
      return decision.sessionId ? `/date/${encodeSegment(decision.sessionId)}` : "/home";
    case "chat":
      return decision.targetId ? `/chat/${encodeSegment(decision.targetId)}` : "/home";
    case "lobby":
    case "ended":
      return decision.eventId ? `/event/${encodeSegment(decision.eventId)}/lobby` : "/home";
    case "home":
      return "/home";
  }
}

export function nativePathForCanonicalVideoDateRoute(
  decision: VideoDateCanonicalRouteDecision,
): string {
  switch (decision.target) {
    case "ready_gate":
      return decision.sessionId ? `/ready/${decision.sessionId}` : "/(tabs)";
    case "date":
    case "survey":
      return decision.sessionId ? `/date/${decision.sessionId}` : "/(tabs)";
    case "chat":
      return decision.targetId ? `/chat/${decision.targetId}` : "/(tabs)";
    case "lobby":
    case "ended":
      return decision.eventId ? `/event/${decision.eventId}/lobby` : "/(tabs)";
    case "home":
      return "/(tabs)";
  }
}
