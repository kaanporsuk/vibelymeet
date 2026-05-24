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

export type ServerPostDateNextSurfaceAction =
  | "survey"
  | "ready_gate"
  | "video_date"
  | "lobby"
  | "wrap_up"
  | "chat"
  | "home";

export type ServerPostDateNextSurface = {
  success: boolean;
  action: ServerPostDateNextSurfaceAction;
  route?: string | null;
  sessionId?: string | null;
  nextSessionId?: string | null;
  eventId?: string | null;
  targetId?: string | null;
  matchId?: string | null;
  reason?: string | null;
  secondsUntilEventEnd?: number | null;
};

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeServerPostDateNextSurface(value: unknown): ServerPostDateNextSurface | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.success !== true || typeof raw.action !== "string") return null;
  const action = raw.action as ServerPostDateNextSurfaceAction;
  if (!["survey", "ready_gate", "video_date", "lobby", "wrap_up", "chat", "home"].includes(action)) {
    return null;
  }

  return {
    success: true,
    action,
    route: stringOrNull(raw.route),
    sessionId: stringOrNull(raw.session_id ?? raw.sessionId),
    nextSessionId: stringOrNull(raw.next_session_id ?? raw.nextSessionId),
    eventId: stringOrNull(raw.event_id ?? raw.eventId),
    targetId: stringOrNull(raw.target_id ?? raw.targetId),
    matchId: stringOrNull(raw.match_id ?? raw.matchId),
    reason: stringOrNull(raw.reason),
    secondsUntilEventEnd: numberOrNull(raw.seconds_until_event_end ?? raw.secondsUntilEventEnd),
  };
}

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

export function shouldEnablePostDateSurveyQueueDrain(input: {
  hasEventId: boolean;
  eventLifecycleResolved: boolean;
  eventActive: boolean;
  secondsUntilEventEnd?: number | null;
}): boolean {
  return Boolean(
    input.hasEventId &&
      input.eventLifecycleResolved &&
      input.eventActive &&
      input.secondsUntilEventEnd != null &&
      input.secondsUntilEventEnd > 0,
  );
}

export function getPostDateSurveyContinuityDecision(input: {
  isDrainingQueue: boolean;
  queuedCount?: number | null;
  isSubmittingSurvey: boolean;
  eventActive: boolean;
  eventLifecycleResolved?: boolean;
  secondsUntilEventEnd?: number | null;
  hasEventId: boolean;
}): PostDateContinuityDecision {
  if (!input.hasEventId) {
    return {
      action: "home",
      title: "Saving your check-in",
      message: "We will route you as soon as your answer is secure.",
      tone: "checking",
    };
  }

  if (input.eventLifecycleResolved === false) {
    return {
      action: "refreshing_deck",
      title: "Checking room status",
      message: "We are confirming whether the room is still open before routing you.",
      tone: "checking",
    };
  }

  if (!input.eventActive || (input.secondsUntilEventEnd != null && input.secondsUntilEventEnd <= 0)) {
    return {
      action: "event_ended",
      title: "Event wrap-up",
      message: "We are saving this answer and checking whether the room is still open.",
      tone: "ended",
    };
  }

  if (input.isDrainingQueue || (input.queuedCount ?? 0) > 0) {
    return {
      action: "ready_gate",
      title: "Next date syncing",
      message: "If your queued match is still eligible, Ready Gate opens from the lobby.",
      tone: "checking",
    };
  }

  if (input.isSubmittingSurvey) {
    return {
      action: "refreshing_deck",
      title: "Live deck refresh",
      message: "We are lining up the freshest eligible card for your return.",
      tone: "checking",
    };
  }

  if (isPostDateEventNearlyOver(input.secondsUntilEventEnd)) {
    return {
      action: "last_chance",
      title: "Final live cards",
      message: "Finish this check-in to see anyone still available before the room closes.",
      tone: "last_chance",
    };
  }

  return {
    action: "empty_deck",
    title: "Live deck standing by",
    message: "Finish this check-in and the lobby will keep scanning for eligible people.",
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
      title: "Ready Gate warming up",
      message: "We are syncing the eligible match from the live queue.",
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
      title: "Live deck refreshing",
      message: "Checking the newest eligible cards in this room.",
      tone: "checking",
    };
  }

  if (input.deckHasCandidate) {
    return {
      action: isPostDateEventNearlyOver(input.secondsUntilEventEnd) ? "last_chance" : "fresh_deck",
      title: isPostDateEventNearlyOver(input.secondsUntilEventEnd) ? "Last chance card ready" : "Fresh card ready",
      message: isPostDateEventNearlyOver(input.secondsUntilEventEnd)
        ? "The event is almost over. This is one of the final eligible cards."
        : "Your live deck has someone new ready.",
      tone: isPostDateEventNearlyOver(input.secondsUntilEventEnd) ? "last_chance" : "ready",
    };
  }

  if (isPostDateEventNearlyOver(input.secondsUntilEventEnd)) {
    return {
      action: "last_chance",
      title: "Final room check",
      message: "No card is ready right now. We will keep checking while the lobby is open.",
      tone: "last_chance",
    };
  }

  if (input.deckError) {
    return {
      action: "refreshing_deck",
      title: "Deck retrying",
      message: "We could not confirm a fresh card yet. Retry keeps you in the live lobby.",
      tone: "checking",
    };
  }

  return {
    action: "empty_deck",
    title: "Deck is calm",
    message: "No fresh card is available right now. The lobby will keep refreshing calmly.",
    tone: "empty",
  };
}
