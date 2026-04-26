export const POST_DATE_EVENT_NEARLY_OVER_SECONDS = 5 * 60;

export type PostDateContinuityAction =
  | "ready_gate"
  | "video_date"
  | "refreshing_deck"
  | "fresh_deck"
  | "last_chance"
  | "empty_deck"
  | "event_ended"
  | "home";

export type PostDateContinuityTone = "checking" | "ready" | "last_chance" | "empty" | "ended";

export type PostDateContinuityDecision = {
  action: PostDateContinuityAction;
  title: string;
  message: string;
  tone: PostDateContinuityTone;
};

export function secondsUntilPostDateEventEnd(
  eventEndsAt: Date | string | number | null | undefined,
  nowMs = Date.now(),
): number | null {
  if (!eventEndsAt) return null;
  const endMs = eventEndsAt instanceof Date ? eventEndsAt.getTime() : new Date(eventEndsAt).getTime();
  if (!Number.isFinite(endMs)) return null;
  return Math.floor((endMs - nowMs) / 1000);
}

export function isPostDateEventNearlyOver(secondsRemaining: number | null | undefined): boolean {
  return secondsRemaining != null && secondsRemaining > 0 && secondsRemaining <= POST_DATE_EVENT_NEARLY_OVER_SECONDS;
}

export function getPostDateSurveyContinuityDecision(input: {
  isDrainingQueue: boolean;
  queuedCount?: number | null;
  isSubmittingSurvey: boolean;
  eventActive: boolean;
  secondsUntilEventEnd?: number | null;
  hasEventId: boolean;
}): PostDateContinuityDecision {
  if (!input.hasEventId) {
    return {
      action: "home",
      title: "Saving your feedback",
      message: "Your date feedback is being saved before you leave the room.",
      tone: "checking",
    };
  }

  if (!input.eventActive || (input.secondsUntilEventEnd != null && input.secondsUntilEventEnd <= 0)) {
    return {
      action: "event_ended",
      title: "Event nearly finished",
      message: "We are saving your feedback and checking whether the lobby is still open.",
      tone: "ended",
    };
  }

  if (input.isDrainingQueue || (input.queuedCount ?? 0) > 0) {
    return {
      action: "ready_gate",
      title: "Checking next eligible match",
      message: "If your queued match is eligible, Ready Gate will open automatically.",
      tone: "checking",
    };
  }

  if (input.isSubmittingSurvey) {
    return {
      action: "refreshing_deck",
      title: "Refreshing event deck",
      message: "We are looking for a fresh card before returning you to the lobby.",
      tone: "checking",
    };
  }

  if (isPostDateEventNearlyOver(input.secondsUntilEventEnd)) {
    return {
      action: "last_chance",
      title: "Event nearly over",
      message: "Finish the check-in and we will show any last eligible people still available.",
      tone: "last_chance",
    };
  }

  return {
    action: "empty_deck",
    title: "No eligible match yet",
    message: "The lobby will refresh from the live event deck when you finish.",
    tone: "empty",
  };
}

export function getPostDateLobbyContinuityDecision(input: {
  yieldingToVideoDate: boolean;
  yieldingToReadyGate: boolean;
  hasQueuedSession: boolean;
  deckLoading: boolean;
  deckHasCandidate: boolean;
  deckError: boolean;
  eventLive: boolean;
  secondsUntilEventEnd?: number | null;
}): PostDateContinuityDecision {
  if (input.yieldingToVideoDate) {
    return {
      action: "video_date",
      title: "Joining your date",
      message: "Taking you to the same video session as your match.",
      tone: "ready",
    };
  }

  if (input.yieldingToReadyGate || input.hasQueuedSession) {
    return {
      action: "ready_gate",
      title: "Preparing Ready Gate",
      message: "We are syncing the eligible match from the event queue.",
      tone: "checking",
    };
  }

  if (!input.eventLive || (input.secondsUntilEventEnd != null && input.secondsUntilEventEnd <= 0)) {
    return {
      action: "event_ended",
      title: "Event closed",
      message: "The live lobby has ended, so there are no more event cards to show.",
      tone: "ended",
    };
  }

  if (input.deckLoading) {
    return {
      action: "refreshing_deck",
      title: "Refreshing event deck",
      message: "Checking the latest eligible cards in this live room.",
      tone: "checking",
    };
  }

  if (input.deckHasCandidate) {
    return {
      action: isPostDateEventNearlyOver(input.secondsUntilEventEnd) ? "last_chance" : "fresh_deck",
      title: isPostDateEventNearlyOver(input.secondsUntilEventEnd) ? "Last chance card ready" : "Fresh card ready",
      message: isPostDateEventNearlyOver(input.secondsUntilEventEnd)
        ? "The event is almost over. This is one of the last eligible cards available."
        : "Your live deck has a fresh eligible person ready.",
      tone: isPostDateEventNearlyOver(input.secondsUntilEventEnd) ? "last_chance" : "ready",
    };
  }

  if (isPostDateEventNearlyOver(input.secondsUntilEventEnd)) {
    return {
      action: "last_chance",
      title: "Event nearly over",
      message: "No eligible card is available right now. We will keep checking while the lobby is open.",
      tone: "last_chance",
    };
  }

  if (input.deckError) {
    return {
      action: "refreshing_deck",
      title: "Refreshing event deck",
      message: "We could not confirm a fresh card yet. Retry keeps you in the live lobby.",
      tone: "checking",
    };
  }

  return {
    action: "empty_deck",
    title: "No eligible match yet",
    message: "No fresh card is available right now. The lobby will keep refreshing calmly.",
    tone: "empty",
  };
}
