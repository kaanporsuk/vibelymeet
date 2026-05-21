export type VideoDateReadinessStatus = "ready" | "warning" | "blocked" | "unchecked";

export type VideoDateReadinessGate = {
  status: VideoDateReadinessStatus;
  canAttemptPairing: boolean;
  reason: string | null;
};

export const VIDEO_DATE_READINESS_BLOCKED_COPY =
  "Camera and microphone access are needed before you can pair for a video date.";
export const VIDEO_DATE_DIAGNOSTIC_THROTTLE_MS = 5 * 60 * 1000;

export function resolveVideoDateReadinessGate(status: VideoDateReadinessStatus): VideoDateReadinessGate {
  if (status === "blocked") {
    return {
      status,
      canAttemptPairing: false,
      reason: VIDEO_DATE_READINESS_BLOCKED_COPY,
    };
  }
  return {
    status,
    canAttemptPairing: true,
    reason: null,
  };
}

export function shouldRunVideoDateDiagnostic(
  status: VideoDateReadinessStatus,
  lastRunAtMs: number | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (status === "blocked" || status === "unchecked") return false;
  return lastRunAtMs == null || nowMs - lastRunAtMs >= VIDEO_DATE_DIAGNOSTIC_THROTTLE_MS;
}
