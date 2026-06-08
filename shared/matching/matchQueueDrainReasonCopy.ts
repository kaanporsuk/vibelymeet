export type MatchQueueDrainReasonCopy = {
  reason:
    | "participant_has_active_session_conflict"
    | "event_not_valid"
    | "no_queued_session"
    | "session_not_promotable"
    | "pair_already_met_this_event"
    | "registration_missing"
    | "admission_not_confirmed"
    | "lock_busy"
    | "self_runtime_not_ready"
    | "partner_runtime_not_ready"
    | "blocked_or_reported_pair"
    | "pending_post_date_feedback";
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
  no_queued_session: {
    reason: "no_queued_session",
    title: "Queue is syncing",
    message: "We are checking for a match. Keep the lobby open while the queue catches up.",
  },
  session_not_promotable: {
    reason: "session_not_promotable",
    title: "Match window changed",
    message: "This queued match can no longer open Ready Gate. Keep browsing while we look for the next one.",
  },
  pair_already_met_this_event: {
    reason: "pair_already_met_this_event",
    title: "Already matched here",
    message: "You have already met this person at this event. Keep browsing for someone new.",
  },
  registration_missing: {
    reason: "registration_missing",
    title: "Registration needs a refresh",
    message: "Your event registration changed. Refresh the lobby to continue.",
  },
  admission_not_confirmed: {
    reason: "admission_not_confirmed",
    title: "Event access pending",
    message: "We cannot open Ready Gate until your event access is confirmed.",
  },
  lock_busy: {
    reason: "lock_busy",
    title: "Queue is syncing",
    message: "Another queue check is running. Keep the lobby open and we will retry.",
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
  pending_post_date_feedback: {
    reason: "pending_post_date_feedback",
    title: "Feedback required",
    message: "Finish your post-date feedback before the next Ready Gate opens.",
  },
};

function readDrainReason(input: unknown): string | null {
  if (typeof input === "string") return input;
  if (!input || typeof input !== "object") return null;
  const reason =
    (input as { reason?: unknown }).reason ??
    (input as { reason_code?: unknown }).reason_code ??
    (input as { failure_reason?: unknown }).failure_reason;
  return typeof reason === "string" ? reason : null;
}

export function getMatchQueueDrainReasonCopy(input: unknown): MatchQueueDrainReasonCopy | null {
  const reason = readDrainReason(input);
  if (
    reason === "participant_has_active_session_conflict" ||
    reason === "event_not_valid" ||
    reason === "no_queued_session" ||
    reason === "session_not_promotable" ||
    reason === "pair_already_met_this_event" ||
    reason === "registration_missing" ||
    reason === "admission_not_confirmed" ||
    reason === "lock_busy" ||
    reason === "self_runtime_not_ready" ||
    reason === "partner_runtime_not_ready" ||
    reason === "blocked_or_reported_pair" ||
    reason === "pending_post_date_feedback"
  ) {
    return MATCH_QUEUE_DRAIN_REASON_COPY[reason];
  }
  return null;
}
