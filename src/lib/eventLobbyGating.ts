import { resolveEventLifecycle } from "@/lib/eventLifecycle";

export type EventLobbyGateKind =
  | "loading"
  | "missing_event_id"
  | "sign_in_required"
  | "not_found"
  | "cancelled"
  | "archived"
  | "draft"
  | "ended"
  | "not_started"
  | "not_live"
  | "waitlisted"
  | "not_registered"
  | "paused"
  | "live";

export type EventLobbyGateState = {
  kind: EventLobbyGateKind;
  canFetchDeck: boolean;
  canUseLobbyActions: boolean;
  canUseLobbySideEffects: boolean;
  title: string;
  message: string;
  actionLabel: string;
  redirectTo: "event" | "events" | "dashboard" | "matches" | "auth";
};

type EventLike = {
  status?: string | null;
  eventDate?: Date | string | number | null;
  durationMinutes?: number | null;
  archivedAt?: Date | string | number | null;
  endedAt?: Date | string | number | null;
} | null;

type RegistrationLike = {
  isConfirmed?: boolean;
  isWaitlisted?: boolean;
} | null;

const LIVE_STATE: EventLobbyGateState = {
  kind: "live",
  canFetchDeck: true,
  canUseLobbyActions: true,
  canUseLobbySideEffects: true,
  title: "",
  message: "",
  actionLabel: "",
  redirectTo: "event",
};

function blockedState(
  kind: Exclude<EventLobbyGateKind, "live">,
  title: string,
  message: string,
  actionLabel = "Back to event",
  redirectTo: EventLobbyGateState["redirectTo"] = "event",
): EventLobbyGateState {
  return {
    kind,
    canFetchDeck: false,
    canUseLobbyActions: false,
    canUseLobbySideEffects: false,
    title,
    message,
    actionLabel,
    redirectTo,
  };
}

export function getWebEventLobbyGateState(input: {
  eventId?: string | null;
  userId?: string | null;
  userPaused?: boolean;
  event: EventLike;
  eventLoading: boolean;
  registration: RegistrationLike;
  registrationLoading: boolean;
  nowMs?: number;
}): EventLobbyGateState {
  const nowMs = input.nowMs ?? Date.now();

  if (input.eventLoading || (Boolean(input.userId) && input.registrationLoading)) {
    return blockedState(
      "loading",
      "Loading lobby",
      "Getting the lobby ready.",
      "Back to events",
      "events",
    );
  }

  if (!input.eventId) {
    return blockedState(
      "missing_event_id",
      "Event not found",
      "This lobby link is missing an event. Head back to events and choose a live room.",
      "Browse events",
      "events",
    );
  }

  if (!input.userId) {
    return blockedState(
      "sign_in_required",
      "Sign in to view the lobby",
      "You need to be signed in before joining an event lobby.",
      "Sign in",
      "auth",
    );
  }

  if (!input.event) {
    return blockedState(
      "not_found",
      "Event not found",
      "This event may have been removed or the link may be out of date.",
      "Browse events",
      "events",
    );
  }

  const status = (input.event.status ?? "").toLowerCase();

  if (status === "cancelled") {
    return blockedState(
      "cancelled",
      "This event was cancelled",
      "The live lobby is closed. Head back to the event page for the latest details.",
    );
  }

  if (input.event.archivedAt != null || status === "archived") {
    return blockedState(
      "archived",
      "This event is archived",
      "This lobby is no longer available.",
    );
  }

  if (status === "draft") {
    return blockedState(
      "draft",
      "This event is not available yet",
      "The lobby opens only after the event is published and reaches its scheduled time.",
      "Browse events",
      "events",
    );
  }

  const lifecycle = resolveEventLifecycle({
    status: input.event.status,
    eventDate: input.event.eventDate,
    durationMinutes: input.event.durationMinutes,
    endedAt: input.event.endedAt,
    nowMs,
  });

  if (!lifecycle.startsAt || !lifecycle.endsAt) {
    return blockedState(
      "not_live",
      "Lobby is not available",
      "We could not confirm the event live window yet. Please return from the event page.",
    );
  }

  if (lifecycle.isEnded) {
    return blockedState(
      "ended",
      "This event has ended",
      "The live lobby is closed. Check your matches to keep the conversation going.",
      "View matches",
      "matches",
    );
  }

  if (lifecycle.lifecycle === "upcoming") {
    return blockedState(
      "not_started",
      "This event isn't live yet",
      "Join the lobby when your event starts. The event page has the countdown.",
    );
  }

  if (!lifecycle.isLive) {
    return blockedState(
      "not_live",
      "Lobby is not live",
      "This event is not currently accepting lobby swipes.",
    );
  }

  if (!input.registration?.isConfirmed) {
    if (input.registration?.isWaitlisted) {
      return blockedState(
        "waitlisted",
        "You're on the waitlist",
        "The lobby is for confirmed guests only. We'll let you in if a spot opens.",
      );
    }
    return blockedState(
      "not_registered",
      "Register first",
      "Register for this event before joining the lobby.",
    );
  }

  if (input.userPaused) {
    return blockedState(
      "paused",
      "You're on a break",
      "Discovery is paused. End your break to appear in the event deck.",
      "Back to event",
    );
  }

  return LIVE_STATE;
}
