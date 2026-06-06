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

export type EventLobbyServerInactiveReason =
  | "event_not_found"
  | "event_draft"
  | "event_cancelled"
  | "event_archived"
  | "event_ended"
  | "event_not_live"
  | "event_not_started"
  | "event_outside_live_window";

type EventLike = {
  status?: string | null;
  eventDate?: Date | string | number | null;
  event_date?: Date | string | number | null;
  durationMinutes?: number | null;
  duration_minutes?: number | null;
  archivedAt?: Date | string | number | null;
  archived_at?: Date | string | number | null;
  endedAt?: Date | string | number | null;
  ended_at?: Date | string | number | null;
} | null | undefined;

type RegistrationLike = {
  isConfirmed?: boolean;
  isWaitlisted?: boolean;
} | null | undefined;

export const EVENT_LOBBY_ACTIVE_STATUSES = ["upcoming", "scheduled", "live"] as const;

const ACTIVE_STATUS_SET = new Set<string>(EVENT_LOBBY_ACTIVE_STATUSES);
const DEFAULT_EVENT_DURATION_MINUTES = 60;

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

function normalizeServerStatus(status: string | null | undefined): string {
  const normalized = (status ?? "").trim().toLowerCase();
  return normalized || "upcoming";
}

function eventDate(event: NonNullable<EventLike>) {
  return event.eventDate ?? event.event_date;
}

function durationMinutes(event: NonNullable<EventLike>) {
  return event.durationMinutes ?? event.duration_minutes;
}

function archivedAt(event: NonNullable<EventLike>) {
  return event.archivedAt ?? event.archived_at;
}

function endedAt(event: NonNullable<EventLike>) {
  return event.endedAt ?? event.ended_at;
}

function toTimestampMs(value: Date | string | number | null | undefined): number {
  if (value == null) return Number.NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return new Date(value).getTime();
}

function normalizedDurationMinutes(event: NonNullable<EventLike>): number {
  const duration = durationMinutes(event) ?? DEFAULT_EVENT_DURATION_MINUTES;
  return Number.isFinite(duration) ? duration : DEFAULT_EVENT_DURATION_MINUTES;
}

export function getEventLobbyInactiveReasonForEvent(
  event: EventLike,
  nowMs = Date.now(),
): EventLobbyServerInactiveReason | null {
  if (!event) return "event_not_found";

  const status = normalizeServerStatus(event.status);

  if (status === "draft") return "event_draft";
  if (status === "cancelled") return "event_cancelled";
  if (archivedAt(event) != null || status === "archived") return "event_archived";
  if (endedAt(event) != null || status === "ended" || status === "completed") return "event_ended";
  if (!ACTIVE_STATUS_SET.has(status)) return "event_not_live";

  const startsAtMs = toTimestampMs(eventDate(event));
  if (!Number.isFinite(startsAtMs)) return "event_outside_live_window";
  if (nowMs < startsAtMs) return "event_not_started";

  const endsAtMs = startsAtMs + normalizedDurationMinutes(event) * 60_000;
  if (nowMs >= endsAtMs) return "event_outside_live_window";

  return null;
}

export function eventLobbyGateFromServerInactiveReason(
  reason?: string | null,
): EventLobbyGateState | null {
  switch ((reason ?? "").trim().toLowerCase()) {
    case "":
      return null;
    case "event_not_found":
      return blockedState(
        "not_found",
        "Event not found",
        "This event may have been removed or the link may be out of date.",
        "Browse events",
        "events",
      );
    case "event_cancelled":
      return blockedState(
        "cancelled",
        "This event was cancelled",
        "The live lobby is closed. Head back to the event page for the latest details.",
      );
    case "event_archived":
      return blockedState("archived", "This event is archived", "This lobby is no longer available.");
    case "event_draft":
      return blockedState(
        "draft",
        "This event is not available yet",
        "The lobby opens only after the event is published and reaches its scheduled time.",
        "Browse events",
        "events",
      );
    case "event_ended":
    case "event_outside_live_window":
      return blockedState(
        "ended",
        "This event has ended",
        "The live lobby is closed. Head to Matches to keep conversations going.",
        "View matches",
        "matches",
      );
    case "event_not_started":
      return blockedState(
        "not_started",
        "This event isn't live yet",
        "Join the lobby when your event starts. The event page has the countdown.",
      );
    case "event_not_live":
    case "event_not_active":
    default:
      return blockedState(
        "not_live",
        "Lobby is not live",
        "This event is not currently accepting lobby swipes.",
      );
  }
}

export function getEventLobbyGateState(input: {
  eventId?: string | null;
  userId?: string | null;
  userPaused?: boolean;
  event: EventLike;
  eventLoading: boolean;
  registration: RegistrationLike;
  registrationLoading: boolean;
  nowMs?: number;
  serverInactiveReason?: string | null;
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

  const serverGate = eventLobbyGateFromServerInactiveReason(input.serverInactiveReason);
  if (serverGate) return serverGate;

  const eventInactiveGate = eventLobbyGateFromServerInactiveReason(
    getEventLobbyInactiveReasonForEvent(input.event, nowMs),
  );
  if (eventInactiveGate) return eventInactiveGate;

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

export const getWebEventLobbyGateState = getEventLobbyGateState;
