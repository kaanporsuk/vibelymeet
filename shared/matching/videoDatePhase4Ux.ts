import type { VideoDateQueueHint } from "./videoDatePublicApi";
import {
  resolveVideoDateLobbyStateCopy,
  type VideoDateLobbyFocusedReason,
} from "./videoDateLobbyStateCopy";

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

export type VideoDateQueueCopy = {
  compactLabel: string;
  title: string;
  message: string;
  positionLabel: string | null;
  etaLabel: string | null;
  reliefLabel: string | null;
  isNext: boolean;
  detailParts: string[];
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
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds <= 5) return "now";
  if (seconds < 60) return `~${Math.ceil(seconds / 5) * 5}s`;
  return `~${Math.ceil(seconds / 60)}m`;
}

function safeQueueCount(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function safeQueuePosition(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.max(1, Math.floor(value));
}

export function formatVideoDateQueueHintLabel(
  hint: VideoDateQueueHint | null | undefined,
  fallbackCount: number,
): string {
  if (hint?.queued) {
    const eta = formatVideoDateQueueEtaLabel(hint.estimatedWaitSeconds);
    const position = safeQueuePosition(hint.position);
    const count = Math.max(
      safeQueueCount(fallbackCount),
      safeQueueCount(hint.eventQueuedCount),
      safeQueueCount(hint.userQueuedCount),
    );
    const parts =
      position != null
        ? [`Position ${position}`]
        : [count === 1 ? "1 waiting in queue" : `${count} waiting in queue`];
    if (eta) parts.push(eta);
    if (hint.reliefActive) parts.push("priority boost");
    return parts.join(" · ");
  }
  const count = Math.max(safeQueueCount(fallbackCount), safeQueueCount(hint?.eventQueuedCount));
  return count === 1 ? "1 waiting in queue" : `${count} waiting in queue`;
}

export function resolveVideoDateQueueCopy(
  hint: VideoDateQueueHint | null | undefined,
  fallbackCount: number,
): VideoDateQueueCopy {
  const compactLabel = formatVideoDateQueueHintLabel(hint, fallbackCount);
  const etaLabel = hint?.queued ? formatVideoDateQueueEtaLabel(hint.estimatedWaitSeconds) : null;
  const position = hint?.queued ? safeQueuePosition(hint.position) : null;
  const isNext = position === 1;
  const positionLabel = position == null ? null : isNext ? "You're next" : `Position ${position}`;
  const reliefLabel = hint?.queued && hint.reliefActive ? "priority boost" : null;
  const detailParts = [positionLabel, etaLabel, reliefLabel].filter((part): part is string => Boolean(part));

  if (hint?.queued) {
    return {
      compactLabel,
      title: isNext ? "You're next" : "Holding your place",
      message: isNext
        ? "Keep this lobby open so we can confirm presence. Ready Gate opens when your match is ready."
        : "You are in the matching queue. Keep the lobby open while we hold your spot.",
      positionLabel,
      etaLabel,
      reliefLabel,
      isNext,
      detailParts,
    };
  }

  return {
    compactLabel,
    title: "Holding your place",
    message: "Keep browsing with the lobby open. Ready Gate opens automatically when a match is available.",
    positionLabel: null,
    etaLabel: null,
    reliefLabel: null,
    isNext: false,
    detailParts: [compactLabel],
  };
}

export function resolveQueueHintCopy(
  hint: VideoDateQueueHint | null | undefined,
  fallbackCount: number,
): VideoDateQueueCopy {
  return resolveVideoDateQueueCopy(hint, fallbackCount);
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
    showMysteryMatch: true,
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

function focusedLobbyState(input: {
  kind: EventDeckPhase4UiKind;
  focusedReason: VideoDateLobbyFocusedReason;
  reason?: string;
}): EventDeckPhase4UiState {
  const copy = resolveVideoDateLobbyStateCopy({ reason: input.focusedReason });
  const actionTarget: EventDeckPhase4ActionTarget =
    copy.actionTarget === "event" || copy.actionTarget === "matches" || copy.actionTarget === "refresh"
      ? copy.actionTarget
      : "refresh";

  return {
    kind: input.kind,
    reason: input.reason ?? copy.reason,
    badge: copy.badge,
    title: copy.title,
    message: copy.message,
    actionLabel: copy.actionLabel,
    actionTarget,
    showRefresh: copy.retryable && actionTarget === "refresh",
    showMysteryMatch: false,
    retryable: copy.retryable,
    terminal: copy.terminal,
  };
}

export function resolveEventDeckPhase4UiState(
  input: ResolveEventDeckPhase4UiStateInput,
): EventDeckPhase4UiState {
  const deckErrorReason = normalizeReason(input.deckErrorReason);
  if (deckErrorReason === "network_error" || deckErrorReason === "rpc_error") {
    return focusedLobbyState({
      kind: "retryable_error",
      focusedReason: "recoverable_fetch_error",
      reason: deckErrorReason,
    });
  }

  const observedReason = normalizeReason(input.observedReason);
  const deckStateReason = normalizeReason(input.deckStateReason) || observedReason || "unknown";
  const inactiveReason = normalizeReason(input.inactiveReason);

  if (deckStateReason === "event_not_active") {
    if (inactiveReason === "event_ended" || inactiveReason === "event_outside_live_window") {
      return focusedLobbyState({
        kind: "event_ended",
        focusedReason: "terminal_event_state",
        reason: inactiveReason,
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
      message: "This event is no longer accepting lobby swipes.",
      actionLabel: "Back to event",
      actionTarget: "event",
    });
  }

  if (
    deckStateReason === "queue_waiting" ||
    deckStateReason === "queued" ||
    deckStateReason === "match_queued" ||
    deckStateReason === "all_candidates_busy_or_unavailable"
  ) {
    return focusedLobbyState({
      kind: "empty",
      focusedReason: "queue_waiting",
      reason: deckStateReason,
    });
  }

  if (deckStateReason === "safety_limited" || deckStateReason === "blocked" || deckStateReason === "reported") {
    return focusedLobbyState({
      kind: "empty",
      focusedReason: "safety_limited",
      reason: deckStateReason,
    });
  }

  if (deckStateReason === "media_unavailable") {
    return focusedLobbyState({
      kind: "retryable_error",
      focusedReason: "media_unavailable",
      reason: deckStateReason,
    });
  }

  if (deckStateReason === "not_registered" || observedReason === "user_not_eligible") {
    return focusedLobbyState({
      kind: "not_registered",
      focusedReason: "geo_or_eligibility_mismatch",
      reason: deckStateReason,
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
      message: "Confirmed guests may still join. Your deck refreshes automatically, and you can refresh any time.",
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
