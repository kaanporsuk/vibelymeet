import {
  resolveVideoDateTimelineCountdown,
  type VideoDateTimelineState,
} from "./videoDateTimeline";

export const READY_GATE_DEFAULT_TIMEOUT_SECONDS = 30;

export type ReadyGateExpiry = string | number | null | undefined;

export type ReadyGateRemainingSecondsInput = {
  expiresAt: ReadyGateExpiry;
  fallbackDeadlineMs?: number | null;
  fallbackSeconds?: number;
  nowMs?: number;
  serverNowMs?: number | null;
  clientSyncedAtMs?: number | null;
};

export type ReadyGateServerClockCountdown = {
  remainingSeconds: number;
  remainingMs: number | null;
  deadlineMs: number | null;
  progress: number;
  clockSkewMs: number;
  hasServerClock: boolean;
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseReadyGateExpiryMs(rawExpiry: ReadyGateExpiry): number | null {
  if (rawExpiry == null || rawExpiry === "") return null;
  const expiresMs = typeof rawExpiry === "number" ? rawExpiry : Date.parse(String(rawExpiry));
  return Number.isFinite(expiresMs) ? expiresMs : null;
}

export function buildReadyGateCountdownTimeline({
  expiresAt,
  serverNowMs,
  clientSyncedAtMs,
  nowMs = Date.now(),
  timeoutSeconds = READY_GATE_DEFAULT_TIMEOUT_SECONDS,
}: {
  expiresAt: ReadyGateExpiry;
  serverNowMs?: number | null;
  clientSyncedAtMs?: number | null;
  nowMs?: number;
  timeoutSeconds?: number;
}): VideoDateTimelineState | null {
  const deadlineMs = parseReadyGateExpiryMs(expiresAt);
  if (deadlineMs == null) return null;

  const syncedAtMs = finiteNumber(clientSyncedAtMs) ?? nowMs;
  const authoritativeServerNowMs = finiteNumber(serverNowMs) ?? syncedAtMs;
  const durationSeconds = Math.max(
    0,
    finiteNumber(timeoutSeconds) ?? READY_GATE_DEFAULT_TIMEOUT_SECONDS,
  );

  return {
    sessionId: "ready-gate-countdown",
    eventId: null,
    seq: 0,
    phase: "ready_gate",
    phaseStartedAtMs: deadlineMs - durationSeconds * 1000,
    phaseDeadlineAtMs: deadlineMs,
    serverNowMs: authoritativeServerNowMs,
    clientSyncedAtMs: syncedAtMs,
    clockSkewMs: authoritativeServerNowMs - syncedAtMs,
    allowedActions: [],
    endedAtMs: null,
    endedReason: null,
  };
}

export function getReadyGateCountdownFromServerClock({
  expiresAt,
  fallbackSeconds = READY_GATE_DEFAULT_TIMEOUT_SECONDS,
  nowMs = Date.now(),
  serverNowMs,
  clientSyncedAtMs,
}: ReadyGateRemainingSecondsInput): ReadyGateServerClockCountdown {
  const timeline = buildReadyGateCountdownTimeline({
    expiresAt,
    serverNowMs,
    clientSyncedAtMs,
    nowMs,
    timeoutSeconds: fallbackSeconds,
  });

  if (!timeline) {
    return {
      remainingSeconds: Math.max(0, Math.ceil(fallbackSeconds)),
      remainingMs: null,
      deadlineMs: null,
      progress: getReadyGateCountdownProgress(fallbackSeconds, fallbackSeconds),
      clockSkewMs: 0,
      hasServerClock: false,
    };
  }

  const countdown = resolveVideoDateTimelineCountdown(timeline, { clientNowMs: nowMs });
  return {
    remainingSeconds: countdown.remainingSeconds ?? 0,
    remainingMs: countdown.remainingMs,
    deadlineMs: countdown.deadlineMs,
    progress: countdown.progress,
    clockSkewMs: timeline.clockSkewMs,
    hasServerClock: finiteNumber(serverNowMs) != null && finiteNumber(clientSyncedAtMs) != null,
  };
}

export function getReadyGateRemainingSeconds({
  expiresAt,
  fallbackDeadlineMs,
  fallbackSeconds = READY_GATE_DEFAULT_TIMEOUT_SECONDS,
  nowMs = Date.now(),
  serverNowMs,
  clientSyncedAtMs,
}: ReadyGateRemainingSecondsInput): number {
  if (serverNowMs != null || clientSyncedAtMs != null) {
    return getReadyGateCountdownFromServerClock({
      expiresAt,
      fallbackSeconds,
      nowMs,
      serverNowMs,
      clientSyncedAtMs,
    }).remainingSeconds;
  }

  const expiresMs = parseReadyGateExpiryMs(expiresAt);
  const fallbackMs = Number.isFinite(fallbackDeadlineMs) ? Number(fallbackDeadlineMs) : null;
  const deadlineMs = expiresMs ?? fallbackMs;

  if (deadlineMs == null) {
    return Math.max(0, Math.ceil(fallbackSeconds));
  }

  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

export function getReadyGateCountdownProgress(
  remainingSeconds: number,
  timeoutSeconds = READY_GATE_DEFAULT_TIMEOUT_SECONDS,
): number {
  if (!Number.isFinite(remainingSeconds) || !Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, remainingSeconds / timeoutSeconds));
}
