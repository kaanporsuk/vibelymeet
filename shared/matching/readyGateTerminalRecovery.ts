export type ReadyGateTerminalCategory =
  | "partner_forfeited"
  | "expired"
  | "event_ended"
  | "event_cancelled"
  | "event_archived"
  | "event_inactive"
  | "stale_handoff"
  | "unauthorized"
  | "conflict_or_stale"
  | "generic_error";

export type ReadyGateTerminalRecoveryInput = {
  status?: string | null;
  reason?: string | null;
  errorCode?: string | null;
  code?: string | null;
  inactiveReason?: string | null;
  terminal?: boolean | null;
  source?: string | null;
};

export type ReadyGateTerminalRecovery = {
  category: ReadyGateTerminalCategory;
  title: string;
  body: string;
  toast: string;
  retryable: boolean;
  terminal: boolean;
};

const READY_GATE_EVENT_INACTIVE_CODES = new Set([
  "EVENT_NOT_ACTIVE",
  "event_not_active",
  "event_not_live",
  "event_outside_live_window",
  "event_ended",
  "event_cancelled",
  "event_archived",
  "ready_gate_event_inactive",
  "ready_gate_event_ended",
  "ready_gate_event_cancelled",
  "ready_gate_event_archived",
]);

const READY_GATE_FORFEIT_CODES = new Set([
  "forfeited",
  "ready_gate_forfeit",
  "partner_forfeited",
  "participant_forfeited",
]);

const READY_GATE_EXPIRED_CODES = new Set([
  "expired",
  "ready_gate_expired",
  "ready_gate_timeout",
]);

const READY_GATE_STALE_CODES = new Set([
  "READY_GATE_NOT_READY",
  "stale",
  "conflict",
  "terminal",
  "stale_transition",
  "guarded_update_zero_rows",
  "session_no_longer_ready_gate_mutable",
  "session_missing",
  "session_ended",
  "session_not_ready_gate_eligible",
]);

const READY_GATE_UNAUTHORIZED_CODES = new Set([
  "UNAUTHORIZED",
  "ACCESS_DENIED",
  "not_session_participant",
  "unauthorized",
  "access_denied",
]);

function normalizeReadyGateReason(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function collectReadyGateReasons(input: ReadyGateTerminalRecoveryInput): string[] {
  return [
    normalizeReadyGateReason(input.status),
    normalizeReadyGateReason(input.reason),
    normalizeReadyGateReason(input.errorCode),
    normalizeReadyGateReason(input.code),
    normalizeReadyGateReason(input.inactiveReason),
  ].filter((value): value is string => Boolean(value));
}

export function isReadyGateEventInactiveReason(input: ReadyGateTerminalRecoveryInput): boolean {
  return collectReadyGateReasons(input).some((reason) => READY_GATE_EVENT_INACTIVE_CODES.has(reason));
}

export function isReadyGatePrepareEntryNonRetryable(input: ReadyGateTerminalRecoveryInput): boolean {
  if (isReadyGateEventInactiveReason(input)) return true;
  const reasons = collectReadyGateReasons(input);
  return reasons.includes("READY_GATE_NOT_READY") && reasons.some((reason) => reason.startsWith("event_"));
}

export function resolveReadyGateTerminalRecovery(
  input: ReadyGateTerminalRecoveryInput,
): ReadyGateTerminalRecovery {
  const reasons = collectReadyGateReasons(input);
  const hasReason = (set: Set<string>) => reasons.some((reason) => set.has(reason));

  if (hasReason(READY_GATE_UNAUTHORIZED_CODES)) {
    return {
      category: "unauthorized",
      title: "This Ready Gate is not available",
      body: "We could not verify access to this match. Return to the lobby to continue.",
      toast: "This Ready Gate is not available.",
      retryable: false,
      terminal: true,
    };
  }

  if (reasons.some((reason) => reason === "ready_gate_event_archived" || reason === "event_archived")) {
    return {
      category: "event_archived",
      title: "This event is closed",
      body: "This Ready Gate is no longer active. Return to the lobby to keep browsing.",
      toast: "This event is closed, so this Ready Gate ended.",
      retryable: false,
      terminal: true,
    };
  }

  if (reasons.some((reason) => reason === "ready_gate_event_cancelled" || reason === "event_cancelled")) {
    return {
      category: "event_cancelled",
      title: "This event was cancelled",
      body: "This Ready Gate is no longer active. Return to the lobby to keep browsing.",
      toast: "This event was cancelled, so this Ready Gate ended.",
      retryable: false,
      terminal: true,
    };
  }

  if (
    reasons.some((reason) =>
      ["ready_gate_event_ended", "event_ended", "event_outside_live_window"].includes(reason),
    )
  ) {
    return {
      category: "event_ended",
      title: "This event has ended",
      body: "The event is no longer accepting Ready Gate handoffs. Return to the lobby to continue.",
      toast: "This event has ended, so this Ready Gate closed.",
      retryable: false,
      terminal: true,
    };
  }

  if (hasReason(READY_GATE_EVENT_INACTIVE_CODES)) {
    return {
      category: "event_inactive",
      title: "This Ready Gate is closed",
      body: "The event is no longer accepting this handoff. Return to the lobby to continue.",
      toast: "This Ready Gate is closed.",
      retryable: false,
      terminal: true,
    };
  }

  if (hasReason(READY_GATE_FORFEIT_CODES)) {
    return {
      category: "partner_forfeited",
      title: "Your match stepped away",
      body: "No pressure. We will take you back to browsing.",
      toast: "Your match stepped away. Back to browsing.",
      retryable: false,
      terminal: true,
    };
  }

  if (hasReason(READY_GATE_EXPIRED_CODES)) {
    return {
      category: "expired",
      title: "Ready Gate timed out",
      body: "The ready window closed. We will take you back to browsing.",
      toast: "Ready Gate timed out. Back to browsing.",
      retryable: false,
      terminal: true,
    };
  }

  if (hasReason(READY_GATE_STALE_CODES)) {
    return {
      category: "stale_handoff",
      title: "This handoff is stale",
      body: "The Ready Gate changed before video could start. Return to the lobby to continue.",
      toast: "This Ready Gate changed. Back to browsing.",
      retryable: input.code === "READY_GATE_NOT_READY" && !isReadyGatePrepareEntryNonRetryable(input),
      terminal: input.terminal === true,
    };
  }

  return {
    category: "generic_error",
    title: "Ready Gate needs a retry",
    body: "Something interrupted this Ready Gate. Check your connection and try again.",
    toast: "Ready Gate could not finish. Please try again.",
    retryable: true,
    terminal: input.terminal === true,
  };
}
