export type MatchQueueDrainReasonCopy = {
  reason: "participant_has_active_session_conflict" | "event_not_valid";
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
};

function readDrainReason(input: unknown): string | null {
  if (typeof input === "string") return input;
  if (!input || typeof input !== "object" || !("reason" in input)) return null;
  const reason = (input as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : null;
}

export function getMatchQueueDrainReasonCopy(input: unknown): MatchQueueDrainReasonCopy | null {
  const reason = readDrainReason(input);
  if (reason === "participant_has_active_session_conflict" || reason === "event_not_valid") {
    return MATCH_QUEUE_DRAIN_REASON_COPY[reason];
  }
  return null;
}
