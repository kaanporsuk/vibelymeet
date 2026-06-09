export type VideoDateReadinessStatus = "ready" | "warning" | "blocked" | "unchecked";

export type VideoDateReadinessDiagnostic = {
  status: VideoDateReadinessStatus;
  diagnosticMessage: string | null;
};

export const VIDEO_DATE_READINESS_BLOCKED_COPY =
  "Camera and microphone access are needed before you can join a video date.";
export const VIDEO_DATE_READINESS_PENDING_COPY =
  "Camera and microphone access will be checked in Ready Gate.";

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
