export type MatchQueueDrainReasonCopy = {
  reason:
    | "participant_has_active_session_conflict"
    | "event_not_valid"
    | "self_runtime_not_ready"
    | "partner_runtime_not_ready"
    | "blocked_or_reported_pair";
  title: string;
  message: string;
};

const MATCH_QUEUE_DRAIN_REASON_COPY: Record<MatchQueueDrainReasonCopy["reason"], MatchQueueDrainReasonCopy> = {
  participant_has_active_session_conflict: {
    reason: "participant_has_active_session_conflict",
    title: "Active session found",
    message: "You already have an active session. Refresh if you don't see it shortly.",
  },
  event_not_valid: {
    reason: "event_not_valid",
    title: "Event unavailable",
    message: "This event is no longer available. Refresh or choose another event.",
  },
  self_runtime_not_ready: {
    reason: "self_runtime_not_ready",
    title: "Still checking your setup",
    message: "Keep the lobby open while we confirm your camera, microphone, and connection.",
  },
  partner_runtime_not_ready: {
    reason: "partner_runtime_not_ready",
    title: "Waiting for your match",
    message: "Your match is not quite ready yet. Keep browsing and we will open Ready Gate when they return.",
  },
  blocked_or_reported_pair: {
    reason: "blocked_or_reported_pair",
    title: "Match unavailable",
    message: "This match is no longer available. You can keep browsing.",
  },
};

function readDrainReason(input: unknown): string | null {
  if (typeof input === "string") return input;
  if (!input || typeof input !== "object" || !("reason" in input)) return null;
  const reason = (input as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : null;
}

export function getMatchQueueDrainReasonCopy(input: unknown): MatchQueueDrainReasonCopy | null {
  const reason = readDrainReason(input);
  if (
    reason === "participant_has_active_session_conflict" ||
    reason === "event_not_valid" ||
    reason === "self_runtime_not_ready" ||
    reason === "partner_runtime_not_ready" ||
    reason === "blocked_or_reported_pair"
  ) {
    return MATCH_QUEUE_DRAIN_REASON_COPY[reason];
  }
  return null;
}
