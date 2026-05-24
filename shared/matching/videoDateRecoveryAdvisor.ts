import {
  POST_DATE_SURVEY_INELIGIBLE_ENDED_REASONS,
  canAttemptDailyRoomFromVideoSessionTruth,
  decideVideoSessionRouteFromTruth,
} from "./activeSession";
import {
  resolveReadyGateTerminalRecovery,
  type ReadyGateTerminalRecovery,
  type ReadyGateTerminalRecoveryInput,
} from "./readyGateTerminalRecovery";
import type { VideoDateSnapshot, VideoDateSnapshotOk } from "./videoDateSnapshot";
import {
  isVideoDateDailyTokenFault,
  shouldRefreshVideoDateTokenBeforeJoin,
  videoDateTokenRefreshDelayMs,
} from "./videoDatePublicApi";

export type VideoDateRecoveryPlatform = "web" | "native" | "shared";

export type VideoDateRecoverySurface =
  | "ready_gate"
  | "video_date"
  | "notification_deep_link"
  | "ready_redirect"
  | "active_session"
  | "unknown";

export type VideoDateRecoveryAdvisorDecision =
  | {
      action: "stay";
      reason: string;
      platform?: VideoDateRecoveryPlatform;
      surface?: VideoDateRecoverySurface;
      retryAfterMs?: number | null;
    }
  | {
      action: "retry_snapshot";
      reason: "snapshot_retryable" | string;
      retryable: true;
      sessionId: string | null;
      platform?: VideoDateRecoveryPlatform;
      surface?: VideoDateRecoverySurface;
    }
  | {
      action: "refresh_token";
      reason: string;
      retryAfterMs?: number | null;
      platform?: VideoDateRecoveryPlatform;
      surface?: VideoDateRecoverySurface;
    }
  | {
      action: "go_date";
      sessionId: string;
      eventId: string | null;
      reason: "handshake" | "date" | "already_joined" | "truth_date";
      platform?: VideoDateRecoveryPlatform;
      surface?: VideoDateRecoverySurface;
    }
  | {
      action: "go_ready_gate";
      sessionId: string;
      eventId: string;
      reason: "ready_gate" | "truth_ready_gate";
      platform?: VideoDateRecoveryPlatform;
      surface?: VideoDateRecoverySurface;
    }
  | {
      action: "go_lobby";
      sessionId: string | null;
      eventId: string;
      reason: "ended" | "queued" | "not_date_ready" | "truth_lobby";
      platform?: VideoDateRecoveryPlatform;
      surface?: VideoDateRecoverySurface;
    }
  | {
      action: "go_survey";
      sessionId: string;
      eventId: string | null;
      reason: "verdict" | "terminal_encounter";
      platform?: VideoDateRecoveryPlatform;
      surface?: VideoDateRecoverySurface;
    }
  | {
      action: "go_home";
      sessionId: string | null;
      reason: "missing_event";
      platform?: VideoDateRecoveryPlatform;
      surface?: VideoDateRecoverySurface;
    }
  | {
      action: "show_terminal";
      sessionId?: string | null;
      eventId?: string | null;
      reason: string;
      terminalRecovery?: ReadyGateTerminalRecovery;
      retryable?: boolean;
      platform?: VideoDateRecoveryPlatform;
      surface?: VideoDateRecoverySurface;
    }
  | {
      action: "invalid";
      sessionId: string | null;
      reason: string;
      platform?: VideoDateRecoveryPlatform;
      surface?: VideoDateRecoverySurface;
    };

type AdvisorContext = {
  platform?: VideoDateRecoveryPlatform;
  surface?: VideoDateRecoverySurface;
};

type VideoSessionTruthForRecovery = Parameters<typeof decideVideoSessionRouteFromTruth>[0] & {
  event_id?: string | null;
  id?: string | null;
};

const postDateSurveyIneligibleEndedReasons = new Set<string>(
  POST_DATE_SURVEY_INELIGIBLE_ENDED_REASONS,
);

const terminalSurveyRecoveryEndedReasons = new Set<string>([
  "date_timeout",
  "ended_from_client",
  "reconnect_grace_expired",
]);

export function adviseVideoDateSnapshotRecovery(
  snapshot: VideoDateSnapshot,
  options: AdvisorContext & { expectedSessionId?: string | null } = {},
): VideoDateRecoveryAdvisorDecision {
  if (snapshot.ok === false) {
    if (snapshot.retryable) {
      return {
        action: "retry_snapshot",
        sessionId: options.expectedSessionId ?? null,
        reason: snapshot.error || "snapshot_retryable",
        retryable: true,
        platform: options.platform,
        surface: options.surface,
      };
    }
    return {
      action: "invalid",
      sessionId: options.expectedSessionId ?? null,
      reason: snapshot.error,
      platform: options.platform,
      surface: options.surface,
    };
  }

  if (options.expectedSessionId && snapshot.sessionId !== options.expectedSessionId) {
    return {
      action: "invalid",
      sessionId: snapshot.sessionId,
      reason: "session_mismatch",
      platform: options.platform,
      surface: options.surface,
    };
  }

  if ((snapshot.phase === "handshake" || snapshot.phase === "date") && snapshot.room?.url) {
    return {
      action: "go_date",
      sessionId: snapshot.sessionId,
      eventId: snapshot.eventId,
      reason: snapshotSelfHasJoined(snapshot) ? "already_joined" : snapshot.phase,
      platform: options.platform,
      surface: options.surface,
    };
  }

  if (snapshot.phase === "ready_gate") {
    if (snapshot.eventId) {
      return {
        action: "go_ready_gate",
        sessionId: snapshot.sessionId,
        eventId: snapshot.eventId,
        reason: "ready_gate",
        platform: options.platform,
        surface: options.surface,
      };
    }
    return {
      action: "go_home",
      sessionId: snapshot.sessionId,
      reason: "missing_event",
      platform: options.platform,
      surface: options.surface,
    };
  }

  if (snapshot.phase === "queued") {
    if (snapshot.eventId) {
      return {
        action: "go_lobby",
        sessionId: snapshot.sessionId,
        eventId: snapshot.eventId,
        reason: "queued",
        platform: options.platform,
        surface: options.surface,
      };
    }
    return {
      action: "go_home",
      sessionId: snapshot.sessionId,
      reason: "missing_event",
      platform: options.platform,
      surface: options.surface,
    };
  }

  if (snapshot.phase === "verdict") {
    return {
      action: "go_survey",
      sessionId: snapshot.sessionId,
      eventId: snapshot.eventId,
      reason: "verdict",
      platform: options.platform,
      surface: options.surface,
    };
  }

  if (snapshot.phase === "ended") {
    if (snapshotHasTerminalSurveyEvidence(snapshot)) {
      return {
        action: "go_survey",
        sessionId: snapshot.sessionId,
        eventId: snapshot.eventId,
        reason: "terminal_encounter",
        platform: options.platform,
        surface: options.surface,
      };
    }
    if (snapshot.eventId) {
      return {
        action: "go_lobby",
        sessionId: snapshot.sessionId,
        eventId: snapshot.eventId,
        reason: "ended",
        platform: options.platform,
        surface: options.surface,
      };
    }
    return {
      action: "go_home",
      sessionId: snapshot.sessionId,
      reason: "missing_event",
      platform: options.platform,
      surface: options.surface,
    };
  }

  if (snapshot.eventId) {
    return {
      action: "go_lobby",
      sessionId: snapshot.sessionId,
      eventId: snapshot.eventId,
      reason: "not_date_ready",
      platform: options.platform,
      surface: options.surface,
    };
  }

  return {
    action: "go_home",
    sessionId: snapshot.sessionId,
    reason: "missing_event",
    platform: options.platform,
    surface: options.surface,
  };
}

export function adviseVideoSessionTruthRecovery(
  params: AdvisorContext & {
    sessionId?: string | null;
    eventId?: string | null;
    truth: VideoSessionTruthForRecovery | null;
    nowMs?: number;
  },
): VideoDateRecoveryAdvisorDecision & {
  routeDecision?: ReturnType<typeof decideVideoSessionRouteFromTruth>;
  canAttemptDaily?: boolean;
} {
  const nowMs = params.nowMs ?? Date.now();
  const routeDecision = decideVideoSessionRouteFromTruth(params.truth, nowMs);
  const canAttemptDaily = canAttemptDailyRoomFromVideoSessionTruth(params.truth, nowMs);
  const sessionId = params.sessionId ?? params.truth?.id ?? null;
  const eventId = params.truth?.event_id ?? params.eventId ?? null;

  if ((canAttemptDaily || routeDecision === "navigate_date") && sessionId) {
    return {
      action: "go_date",
      sessionId,
      eventId,
      reason: "truth_date",
      platform: params.platform,
      surface: params.surface,
      routeDecision,
      canAttemptDaily,
    };
  }

  if (routeDecision === "navigate_ready" && sessionId && eventId) {
    return {
      action: "go_ready_gate",
      sessionId,
      eventId,
      reason: "truth_ready_gate",
      platform: params.platform,
      surface: params.surface,
      routeDecision,
      canAttemptDaily,
    };
  }

  if (routeDecision === "ended") {
    return {
      action: "show_terminal",
      sessionId,
      eventId,
      reason: "session_ended",
      retryable: false,
      platform: params.platform,
      surface: params.surface,
      routeDecision,
      canAttemptDaily,
    };
  }

  if (eventId) {
    return {
      action: "go_lobby",
      sessionId,
      eventId,
      reason: "truth_lobby",
      platform: params.platform,
      surface: params.surface,
      routeDecision,
      canAttemptDaily,
    };
  }

  return {
    action: "go_home",
    sessionId,
    reason: "missing_event",
    platform: params.platform,
    surface: params.surface,
    routeDecision,
    canAttemptDaily,
  };
}

export function adviseReadyGateTerminalRecovery(
  input: ReadyGateTerminalRecoveryInput,
  context: AdvisorContext = {},
): Extract<VideoDateRecoveryAdvisorDecision, { action: "show_terminal" }> & {
  terminalRecovery: ReadyGateTerminalRecovery;
} {
  const terminalRecovery = resolveReadyGateTerminalRecovery(input);
  return {
    action: "show_terminal",
    reason: terminalRecovery.category,
    terminalRecovery,
    retryable: terminalRecovery.retryable,
    platform: context.platform,
    surface: context.surface ?? "ready_gate",
  };
}

export function resolveReadyGateTerminalRecoveryViaAdvisor(
  input: ReadyGateTerminalRecoveryInput,
  context: AdvisorContext = {},
): ReadyGateTerminalRecovery {
  return adviseReadyGateTerminalRecovery(input, context).terminalRecovery;
}

export function adviseVideoDateTokenRecovery(
  params: AdvisorContext & {
    trigger: "before_join" | "active_refresh_timer" | "auth_error" | "ejection";
    tokenExpiresAtIso?: string | null;
    error?: unknown;
    phase?: string | null;
    nowMs?: number;
  },
): VideoDateRecoveryAdvisorDecision {
  if (params.phase === "ended") {
    return {
      action: "stay",
      reason: "session_ended",
      platform: params.platform,
      surface: params.surface ?? "video_date",
    };
  }

  if (params.trigger === "before_join") {
    if (shouldRefreshVideoDateTokenBeforeJoin(params.tokenExpiresAtIso, params.nowMs)) {
      return {
        action: "refresh_token",
        reason: "token_near_expiry_before_join",
        retryAfterMs: 0,
        platform: params.platform,
        surface: params.surface ?? "video_date",
      };
    }
    return {
      action: "stay",
      reason: "token_fresh_for_join",
      platform: params.platform,
      surface: params.surface ?? "video_date",
    };
  }

  if (params.trigger === "active_refresh_timer") {
    const delayMs = videoDateTokenRefreshDelayMs(params.tokenExpiresAtIso, params.nowMs);
    if (delayMs == null) {
      return {
        action: "stay",
        reason: "missing_token_expiry",
        retryAfterMs: null,
        platform: params.platform,
        surface: params.surface ?? "video_date",
      };
    }
    return {
      action: "refresh_token",
      reason: delayMs === 0 ? "token_refresh_due" : "token_refresh_scheduled",
      retryAfterMs: delayMs,
      platform: params.platform,
      surface: params.surface ?? "video_date",
    };
  }

  if (isVideoDateDailyTokenFault(params.error)) {
    return {
      action: "refresh_token",
      reason: params.trigger === "ejection" ? "daily_ejection_token_fault" : "daily_auth_token_fault",
      retryAfterMs: 0,
      platform: params.platform,
      surface: params.surface ?? "video_date",
    };
  }

  return {
    action: "stay",
    reason: "daily_error_not_token_fault",
    platform: params.platform,
    surface: params.surface ?? "video_date",
  };
}

function snapshotSelfHasJoined(snapshot: VideoDateSnapshotOk): boolean {
  return snapshot.participants.some(
    (participant) => participant.isSelf && nullableFiniteNumber(participant.mediaJoinedAt) !== null,
  );
}

function snapshotPartnerHasJoined(snapshot: VideoDateSnapshotOk): boolean {
  return snapshot.participants.some(
    (participant) => participant.isPartner && nullableFiniteNumber(participant.mediaJoinedAt) !== null,
  );
}

function snapshotHasTerminalSurveyEvidence(snapshot: VideoDateSnapshotOk): boolean {
  if (snapshot.phase !== "ended" || nullableFiniteNumber(snapshot.endedAt) === null) return false;
  if (snapshot.endedReason && postDateSurveyIneligibleEndedReasons.has(snapshot.endedReason)) return false;
  if (snapshot.endedReason && terminalSurveyRecoveryEndedReasons.has(snapshot.endedReason)) return true;
  return snapshotSelfHasJoined(snapshot) && snapshotPartnerHasJoined(snapshot);
}

function nullableFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
