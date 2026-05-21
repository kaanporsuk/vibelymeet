export type VideoDateReadinessStatus = "ready" | "warning" | "blocked" | "unchecked";

export type VideoDateReadinessGate = {
  status: VideoDateReadinessStatus;
  canAttemptPairing: boolean;
  reason: string | null;
};

export const VIDEO_DATE_READINESS_BLOCKED_COPY =
  "Camera and microphone access are needed before you can pair for a video date.";

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
