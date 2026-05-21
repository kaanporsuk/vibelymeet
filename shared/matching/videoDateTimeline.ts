import {
  formatVideoDateCountdown,
  type VideoDatePhaseCountdown,
} from "./videoDateCountdown";
import type {
  VideoDateSnapshot,
  VideoDateSnapshotOk,
  VideoDateSnapshotPhase,
} from "./videoDateSnapshot";

export type VideoDateTimelineState = {
  sessionId: string;
  eventId: string | null;
  seq: number;
  phase: VideoDateSnapshotPhase;
  phaseStartedAtMs: number | null;
  phaseDeadlineAtMs: number | null;
  serverNowMs: number;
  clientSyncedAtMs: number;
  clockSkewMs: number;
  allowedActions: string[];
  endedAtMs: number | null;
  endedReason: string | null;
};

export type VideoDateTimelineSnapshotDecision =
  | { action: "accepted"; timeline: VideoDateTimelineState }
  | { action: "stale"; timeline: VideoDateTimelineState | null; reason?: string }
  | { action: "invalid"; timeline: VideoDateTimelineState | null; reason: string };

export type VideoDateDeepLinkRecovery =
  | { action: "date"; sessionId: string; eventId: string | null; reason: "handshake" | "date" }
  | { action: "ready_gate"; sessionId: string; eventId: string; reason: "ready_gate" | "queued" }
  | { action: "lobby"; sessionId: string; eventId: string; reason: "ended" | "verdict" | "not_date_ready" }
  | { action: "home"; sessionId: string | null; reason: "missing_event" | "snapshot_retryable" }
  | { action: "invalid"; sessionId: string | null; reason: string };

export function applyVideoDateTimelineSnapshot(
  snapshot: VideoDateSnapshot,
  previous: VideoDateTimelineState | null | undefined,
  options: { clientNowMs?: number; expectedSessionId?: string | null } = {},
): VideoDateTimelineSnapshotDecision {
  if (snapshot.ok === false) {
    if (snapshot.retryable) {
      return { action: "stale", timeline: previous ?? null, reason: snapshot.error };
    }
    return { action: "invalid", timeline: previous ?? null, reason: snapshot.error };
  }

  if (options.expectedSessionId && snapshot.sessionId !== options.expectedSessionId) {
    return { action: "invalid", timeline: previous ?? null, reason: "session_mismatch" };
  }

  if (previous && previous.sessionId === snapshot.sessionId && snapshot.seq < previous.seq) {
    return { action: "stale", timeline: previous };
  }

  return {
    action: "accepted",
    timeline: videoDateTimelineFromSnapshot(snapshot, options),
  };
}

export function videoDateTimelineFromSnapshot(
  snapshot: VideoDateSnapshotOk,
  options: { clientNowMs?: number } = {},
): VideoDateTimelineState {
  const clientNowMs = finiteNumber(options.clientNowMs) ?? Date.now();
  const serverNowMs = finiteNumber(snapshot.serverNow) ?? clientNowMs;
  return {
    sessionId: snapshot.sessionId,
    eventId: snapshot.eventId,
    seq: Math.max(0, Math.floor(finiteNumber(snapshot.seq) ?? 0)),
    phase: snapshot.phase,
    phaseStartedAtMs: nullableFiniteNumber(snapshot.phaseStartedAt),
    phaseDeadlineAtMs: nullableFiniteNumber(snapshot.phaseDeadlineAt),
    serverNowMs,
    clientSyncedAtMs: clientNowMs,
    clockSkewMs: serverNowMs - clientNowMs,
    allowedActions: snapshot.allowedActions.slice(),
    endedAtMs: nullableFiniteNumber(snapshot.endedAt),
    endedReason: snapshot.endedReason,
  };
}

export function resolveVideoDateTimelineCountdown(
  timeline: VideoDateTimelineState | null | undefined,
  options: { clientNowMs?: number } = {},
): VideoDatePhaseCountdown {
  if (!timeline || timeline.phase === "ended") {
    return emptyTimelineCountdown(0, 0);
  }

  const deadlineMs = nullableFiniteNumber(timeline.phaseDeadlineAtMs);
  if (deadlineMs === null) {
    return emptyTimelineCountdown(null, 0);
  }

  const clientNowMs = finiteNumber(options.clientNowMs) ?? Date.now();
  const serverNowEstimateMs = clientNowMs + timeline.clockSkewMs;
  const remainingMs = Math.max(0, deadlineMs - serverNowEstimateMs);
  const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const durationMs = timelineDurationMs(timeline);
  const progress = durationMs > 0 ? Math.max(0, Math.min(1, remainingMs / durationMs)) : 0;

  return {
    remainingMs,
    remainingSeconds,
    durationMs,
    progress,
    isFinalTenSeconds: remainingSeconds <= 10,
    formattedTime: formatVideoDateCountdown(remainingSeconds),
    deadlineMs,
    hasAuthoritativeStart: true,
  };
}

export function resolveVideoDateSnapshotRecovery(
  snapshot: VideoDateSnapshot,
  options: { expectedSessionId?: string | null } = {},
): VideoDateDeepLinkRecovery {
  if (snapshot.ok === false) {
    if (snapshot.retryable) {
      return { action: "home", sessionId: null, reason: "snapshot_retryable" };
    }
    return { action: "invalid", sessionId: null, reason: snapshot.error };
  }

  if (options.expectedSessionId && snapshot.sessionId !== options.expectedSessionId) {
    return { action: "invalid", sessionId: snapshot.sessionId, reason: "session_mismatch" };
  }

  if ((snapshot.phase === "handshake" || snapshot.phase === "date") && snapshot.room?.url) {
    return {
      action: "date",
      sessionId: snapshot.sessionId,
      eventId: snapshot.eventId,
      reason: snapshot.phase,
    };
  }

  if (snapshot.phase === "ready_gate" || snapshot.phase === "queued") {
    if (snapshot.eventId) {
      return {
        action: "ready_gate",
        sessionId: snapshot.sessionId,
        eventId: snapshot.eventId,
        reason: snapshot.phase === "queued" ? "queued" : "ready_gate",
      };
    }
    return { action: "home", sessionId: snapshot.sessionId, reason: "missing_event" };
  }

  if (snapshot.phase === "ended" || snapshot.phase === "verdict") {
    if (snapshot.eventId) {
      return {
        action: "lobby",
        sessionId: snapshot.sessionId,
        eventId: snapshot.eventId,
        reason: snapshot.phase === "verdict" ? "verdict" : "ended",
      };
    }
    return { action: "home", sessionId: snapshot.sessionId, reason: "missing_event" };
  }

  if (snapshot.eventId) {
    return {
      action: "lobby",
      sessionId: snapshot.sessionId,
      eventId: snapshot.eventId,
      reason: "not_date_ready",
    };
  }

  return { action: "home", sessionId: snapshot.sessionId, reason: "missing_event" };
}

function timelineDurationMs(timeline: VideoDateTimelineState): number {
  const startedAtMs = nullableFiniteNumber(timeline.phaseStartedAtMs);
  const deadlineMs = nullableFiniteNumber(timeline.phaseDeadlineAtMs);
  if (startedAtMs === null || deadlineMs === null || deadlineMs <= startedAtMs) return 0;
  return deadlineMs - startedAtMs;
}

function emptyTimelineCountdown(remainingSeconds: number | null, durationMs: number): VideoDatePhaseCountdown {
  return {
    remainingMs: remainingSeconds === null ? null : remainingSeconds * 1000,
    remainingSeconds,
    durationMs,
    progress: remainingSeconds === 0 ? 0 : 1,
    isFinalTenSeconds: remainingSeconds !== null && remainingSeconds <= 10,
    formattedTime: formatVideoDateCountdown(remainingSeconds),
    deadlineMs: null,
    hasAuthoritativeStart: false,
  };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableFiniteNumber(value: unknown): number | null {
  return value == null ? null : finiteNumber(value);
}
