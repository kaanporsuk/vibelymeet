import type { VideoDateQueueHint } from "./videoDatePublicApi";

export type VideoDateHandshakeUiTruth = {
  participant_1_id?: string | null;
  participant_2_id?: string | null;
  participant_1_liked?: boolean | null;
  participant_2_liked?: boolean | null;
  participant_1_decided_at?: string | null;
  participant_2_decided_at?: string | null;
} | null | undefined;

export type VideoDateHandshakeUiState = {
  localDecision: boolean | null;
  localHasDecided: boolean;
  partnerHasDecided: boolean;
};

export type EventDeckPhase4Platform = "web" | "native";
export type EventDeckPhase4ActionTarget = "event" | "matches" | "refresh" | "end_break";
export type EventDeckPhase4UiKind =
  | "empty"
  | "retryable_error"
  | "event_ended"
  | "event_not_started"
  | "not_registered"
  | "viewer_paused"
  | "inactive";

export type EventDeckPhase4UiState = {
  kind: EventDeckPhase4UiKind;
  reason: string;
  badge: string;
  title: string;
  message: string;
  actionLabel: string | null;
  actionTarget: EventDeckPhase4ActionTarget;
  showRefresh: boolean;
  showMysteryMatch: boolean;
  retryable: boolean;
  terminal: boolean;
};

type ResolveEventDeckPhase4UiStateInput = {
  platform: EventDeckPhase4Platform;
  deckStateReason?: string | null;
  inactiveReason?: string | null;
  observedReason?: string | null;
  deckErrorReason?: string | null;
  retryable?: boolean | null;
};

function hasTimestamp(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function decisionFrom(decidedAt: unknown, liked: unknown): boolean | null {
  if (!hasTimestamp(decidedAt)) return null;
  if (liked === true) return true;
  if (liked === false) return false;
  return null;
}

export function resolveVideoDateHandshakeUiState(
  truth: VideoDateHandshakeUiTruth,
  userId: string | null | undefined,
): VideoDateHandshakeUiState {
  if (!truth || !userId) {
    return { localDecision: null, localHasDecided: false, partnerHasDecided: false };
  }

  if (truth.participant_1_id === userId) {
    return {
      localDecision: decisionFrom(truth.participant_1_decided_at, truth.participant_1_liked),
      localHasDecided: hasTimestamp(truth.participant_1_decided_at),
      partnerHasDecided: hasTimestamp(truth.participant_2_decided_at),
    };
  }

  if (truth.participant_2_id === userId) {
    return {
      localDecision: decisionFrom(truth.participant_2_decided_at, truth.participant_2_liked),
      localHasDecided: hasTimestamp(truth.participant_2_decided_at),
      partnerHasDecided: hasTimestamp(truth.participant_1_decided_at),
    };
  }

  return { localDecision: null, localHasDecided: false, partnerHasDecided: false };
}

export function shouldShowVideoDateIceBreaker(input: {
  baseVisible: boolean;
  phase: string | null | undefined;
  localHasDecided: boolean;
}): boolean {
  return input.baseVisible && !(input.phase === "handshake" && input.localHasDecided);
}

export function formatVideoDateQueueEtaLabel(seconds: number | null | undefined): string | null {
  if (seconds == null || seconds < 0) return null;
  if (seconds <= 5) return "now";
  if (seconds < 60) return `~${Math.ceil(seconds / 5) * 5}s`;
  return `~${Math.ceil(seconds / 60)}m`;
}

export function formatVideoDateQueueHintLabel(
  hint: VideoDateQueueHint | null | undefined,
  fallbackCount: number,
): string {
  if (hint?.queued) {
    const eta = formatVideoDateQueueEtaLabel(hint.estimatedWaitSeconds);
    const count = Math.max(fallbackCount, hint.eventQueuedCount ?? 0, hint.userQueuedCount ?? 0);
    const parts =
      hint.position != null && hint.position > 0
        ? [`Position ${hint.position}`]
        : [count === 1 ? "1 waiting in queue" : `${count} waiting in queue`];
    if (eta) parts.push(eta);
    if (hint.reliefActive) parts.push("priority boost");
    return parts.join(" · ");
  }
  const count = Math.max(fallbackCount, hint?.eventQueuedCount ?? 0);
  return count === 1 ? "1 waiting in queue" : `${count} waiting in queue`;
}

function normalizeReason(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function emptyState(input: {
  platform: EventDeckPhase4Platform;
  reason: string;
  badge: string;
  title: string;
  message: string;
  retryable?: boolean;
}): EventDeckPhase4UiState {
  return {
    kind: "empty",
    reason: input.reason,
    badge: input.badge,
    title: input.title,
    message: input.message,
    actionLabel: "Refresh now",
    actionTarget: "refresh",
    showRefresh: true,
    showMysteryMatch: input.platform === "native",
    retryable: input.retryable ?? true,
    terminal: false,
  };
}

function blockedState(input: {
  kind: Exclude<EventDeckPhase4UiKind, "empty" | "retryable_error">;
  reason: string;
  badge: string;
  title: string;
  message: string;
  actionLabel: string | null;
  actionTarget: EventDeckPhase4ActionTarget;
  terminal?: boolean;
}): EventDeckPhase4UiState {
  return {
    ...input,
    showRefresh: false,
    showMysteryMatch: false,
    retryable: false,
    terminal: input.terminal ?? true,
  };
}

export function resolveEventDeckPhase4UiState(
  input: ResolveEventDeckPhase4UiStateInput,
): EventDeckPhase4UiState {
  const deckErrorReason = normalizeReason(input.deckErrorReason);
  if (deckErrorReason === "network_error" || deckErrorReason === "rpc_error") {
    return {
      kind: "retryable_error",
      reason: deckErrorReason,
      badge: "Connection",
      title: "Couldn't load deck",
      message: "We couldn't load people in this room. Check your connection and tap Retry.",
      actionLabel: "Retry",
      actionTarget: "refresh",
      showRefresh: true,
      showMysteryMatch: false,
      retryable: true,
      terminal: false,
    };
  }

  const observedReason = normalizeReason(input.observedReason);
  const deckStateReason = normalizeReason(input.deckStateReason) || observedReason || "unknown";
  const inactiveReason = normalizeReason(input.inactiveReason);

  if (deckStateReason === "event_not_active") {
    if (inactiveReason === "event_ended" || inactiveReason === "event_outside_live_window") {
      return blockedState({
        kind: "event_ended",
        reason: inactiveReason,
        badge: "Event ended",
        title: "This event has ended",
        message: "The live lobby is closed. Check your matches to keep the conversation going.",
        actionLabel: "View matches",
        actionTarget: "matches",
      });
    }
    if (inactiveReason === "event_not_started") {
      return blockedState({
        kind: "event_not_started",
        reason: inactiveReason,
        badge: "Not live yet",
        title: "This event isn't live yet",
        message: "The server has not opened this lobby yet. Check the event page countdown.",
        actionLabel: "Back to event",
        actionTarget: "event",
      });
    }
    return blockedState({
      kind: "inactive",
      reason: inactiveReason || "event_not_active",
      badge: "Lobby closed",
      title: "This lobby is closed",
      message: "The server says this event is no longer accepting lobby swipes.",
      actionLabel: "Back to event",
      actionTarget: "event",
    });
  }

  if (deckStateReason === "not_registered" || observedReason === "user_not_eligible") {
    return blockedState({
      kind: "not_registered",
      reason: deckStateReason,
      badge: "Registration needed",
      title: "Only confirmed guests can swipe here",
      message: "Head back to the event page to check your registration status.",
      actionLabel: "Back to event",
      actionTarget: "event",
    });
  }

  if (deckStateReason === "viewer_paused") {
    return blockedState({
      kind: "viewer_paused",
      reason: deckStateReason,
      badge: "Paused",
      title: "You're on a break",
      message: "End your break to become visible in the event deck again.",
      actionLabel: "End break",
      actionTarget: "end_break",
      terminal: false,
    });
  }

  if (deckStateReason === "no_confirmed_candidates") {
    return emptyState({
      platform: input.platform,
      reason: deckStateReason,
      badge: "Room warming up",
      title: "No confirmed guests are available yet",
      message: "Confirmed guests may still join the live room. Your deck refreshes automatically, and you can refresh any time.",
    });
  }

  if (deckStateReason === "scan_window_exhausted" || observedReason === "all_candidates_filtered") {
    return emptyState({
      platform: input.platform,
      reason: deckStateReason,
      badge: "Still checking",
      title: "We're checking a bigger room",
      message: "This event has a lot of candidates. Refresh again in a moment while we keep the deck moving.",
      retryable: input.retryable ?? true,
    });
  }

  return emptyState({
    platform: input.platform,
    reason: deckStateReason === "all_candidates_seen_locally" ? "no_remaining_profiles" : deckStateReason,
    badge: "Deck clear",
    title: "You've seen everyone for now",
    message: "More people may join the room. Your deck refreshes every few seconds, and you can refresh any time.",
  });
}
