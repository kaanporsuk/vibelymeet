export type VideoDateReadinessStatus = "ready" | "warning" | "blocked" | "unchecked";

export type VideoDateReadinessDiagnostic = {
  status: VideoDateReadinessStatus;
  diagnosticMessage: string | null;
};

export const VIDEO_DATE_READINESS_BLOCKED_COPY =
  "Camera and microphone access are needed before you can join a video date.";
export const VIDEO_DATE_READINESS_PENDING_COPY =
  "Camera and microphone access will be checked in Ready Gate.";
export const VIDEO_DATE_DIAGNOSTIC_THROTTLE_MS = 5 * 60 * 1000;

export function resolveVideoDateReadinessDiagnostic(status: VideoDateReadinessStatus): VideoDateReadinessDiagnostic {
  if (status === "blocked" || status === "warning") {
    return {
      status,
      diagnosticMessage: status === "blocked" ? VIDEO_DATE_READINESS_BLOCKED_COPY : VIDEO_DATE_READINESS_PENDING_COPY,
    };
  }
  return {
    status,
    diagnosticMessage: null,
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
