import type { DeckEmptyReason } from "../observability/eventLobbyObservability";

export type VideoDateLobbyFocusedReason =
  | "ready_gate_diagnostic_failure"
  | "safety_limited"
  | "geo_or_eligibility_mismatch"
  | "media_unavailable"
  | "recoverable_fetch_error"
  | "terminal_event_state";

export type VideoDateLobbyStateActionTarget = "refresh" | "event" | "matches" | "lobby" | "settings" | "none";

export type VideoDateLobbyStateCopy = {
  reason: VideoDateLobbyFocusedReason;
  badge: string;
  title: string;
  message: string;
  actionLabel: string | null;
  actionTarget: VideoDateLobbyStateActionTarget;
  retryable: boolean;
  terminal: boolean;
  observabilityReason: DeckEmptyReason;
};

export function resolveVideoDateLobbyStateCopy(input: {
  reason: VideoDateLobbyFocusedReason;
}): VideoDateLobbyStateCopy {
  switch (input.reason) {
    case "ready_gate_diagnostic_failure":
      return {
        reason: input.reason,
        badge: "Setup check",
        title: "Your setup needs a check",
        message: "Confirm your camera, microphone, and connection before joining Ready Gate.",
        actionLabel: "Check again",
        actionTarget: "refresh",
        retryable: true,
        terminal: false,
        observabilityReason: "all_candidates_busy_or_unavailable",
      };
    case "safety_limited":
      return {
        reason: input.reason,
        badge: "Unavailable",
        title: "This match is unavailable",
        message: "For safety, this match cannot continue. You can keep browsing.",
        actionLabel: "Refresh",
        actionTarget: "refresh",
        retryable: true,
        terminal: false,
        observabilityReason: "user_not_eligible",
      };
    case "geo_or_eligibility_mismatch":
      return {
        reason: input.reason,
        badge: "Eligibility",
        title: "This room is not available for you",
        message: "Check the event page for your registration and eligibility details.",
        actionLabel: "Back to event",
        actionTarget: "event",
        retryable: false,
        terminal: true,
        observabilityReason: "user_not_eligible",
      };
    case "media_unavailable":
      return {
        reason: input.reason,
        badge: "Media",
        title: "Media is unavailable",
        message: "This profile media could not load. Try refreshing the deck.",
        actionLabel: "Retry",
        actionTarget: "refresh",
        retryable: true,
        terminal: false,
        observabilityReason: "rpc_error",
      };
    case "recoverable_fetch_error":
      return {
        reason: input.reason,
        badge: "Connection",
        title: "Could not load this room",
        message: "Check your connection, then try again.",
        actionLabel: "Retry",
        actionTarget: "refresh",
        retryable: true,
        terminal: false,
        observabilityReason: "network_error",
      };
    case "terminal_event_state":
      return {
        reason: input.reason,
        badge: "Event ended",
        title: "This event has ended",
        message: "The live lobby is closed. Head to Matches to keep conversations going.",
        actionLabel: "View matches",
        actionTarget: "matches",
        retryable: false,
        terminal: true,
        observabilityReason: "event_not_active",
      };
  }
}

export function resolveLobbyEmptyStateCopy(input: {
  reason: VideoDateLobbyFocusedReason;
}): VideoDateLobbyStateCopy {
  return resolveVideoDateLobbyStateCopy(input);
}
