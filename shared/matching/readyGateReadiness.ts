export type ReadyGateParticipantPosition = "p1" | "p2";

export type ReadyGateReadinessState = {
  iAmReady: boolean;
  partnerReady: boolean;
  iAmReadyKnown: boolean;
  partnerReadyKnown: boolean;
  isBothReady: boolean;
  participantPosition: ReadyGateParticipantPosition | null;
};

export type ReadyGateReadinessTruth = {
  participant_1_id?: string | null;
  participant_2_id?: string | null;
  ready_gate_status?: string | null;
  status?: string | null;
  result_status?: string | null;
  result_ready_gate_status?: string | null;
  ready_participant_1_at?: string | null;
  ready_participant_2_at?: string | null;
};

export type ReadyGateReadinessCopyKey =
  | "both_ready_connecting"
  | "partner_ready_prompt"
  | "waiting_partner"
  | "syncing"
  | "waiting_both";

export type ReadyGateReadinessCopy = {
  key: ReadyGateReadinessCopyKey;
  text: string;
};

export type ReadyGateTruthClockFields = {
  server_now_ms?: string | number | null;
  serverNowMs?: string | number | null;
  server_now?: string | number | null;
  serverNow?: string | number | null;
};

export type ReadyGateTruthPrecedenceInput = {
  currentStatus?: string | null;
  incomingStatus?: string | null;
  currentSeq?: number | null;
  incomingSeq?: number | null;
};

export const READY_GATE_PERMISSION_PREWARM_RELEASE_GRACE_MS = 8_000;

export const initialReadyGateReadinessState: ReadyGateReadinessState = {
  iAmReady: false,
  partnerReady: false,
  iAmReadyKnown: false,
  partnerReadyKnown: false,
  isBothReady: false,
  participantPosition: null,
};

function hasOwn(object: ReadyGateReadinessTruth, key: keyof ReadyGateReadinessTruth): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function hasReadyTimestamp(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

function readyGateStatus(truth: ReadyGateReadinessTruth): string | null {
  return (
    truth.ready_gate_status ??
    truth.status ??
    truth.result_ready_gate_status ??
    truth.result_status ??
    null
  );
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function finiteSeq(value: unknown): number | null {
  const seq = finiteNumber(value);
  if (seq == null) return null;
  return Math.max(0, Math.floor(seq));
}

function normalizeStatusKey(status: string | null | undefined): string {
  return typeof status === "string" ? status.trim().toLowerCase() : "";
}

function parseServerNowMs(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value < 1_000_000_000_000 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    return numeric < 1_000_000_000_000 ? Math.round(numeric * 1000) : Math.round(numeric);
  }
  const parsedDate = Date.parse(trimmed);
  return Number.isFinite(parsedDate) ? parsedDate : null;
}

export function normalizeReadyGateServerNowMs(
  truth: ReadyGateTruthClockFields | null | undefined,
  clientSyncedAtMs = Date.now(),
): { serverNowMs: number | null; clientSyncedAtMs: number | null } {
  if (!truth) return { serverNowMs: null, clientSyncedAtMs: null };
  const serverNowMs = parseServerNowMs(
    truth.server_now_ms ?? truth.serverNowMs ?? truth.server_now ?? truth.serverNow,
  );
  if (serverNowMs == null) return { serverNowMs: null, clientSyncedAtMs: null };
  const syncedAt = finiteNumber(clientSyncedAtMs) ?? Date.now();
  return { serverNowMs, clientSyncedAtMs: syncedAt };
}

export function getReadyGateStatusOrdinal(status: string | null | undefined): number {
  switch (normalizeStatusKey(status)) {
    case "queued":
    case "waiting":
    case "open":
      return 0;
    case "snoozed":
      return 1;
    case "ready":
    case "ready_a":
    case "ready_b":
    case "one_ready":
      return 2;
    case "expired":
    case "forfeited":
    case "cancelled":
    case "ended":
      return 4;
    case "both_ready":
      return 5;
    default:
      return 0;
  }
}

export function isReadyGateTerminalStatus(status: string | null | undefined): boolean {
  return getReadyGateStatusOrdinal(status) >= 4;
}

export function shouldCommitReadyGateTruth({
  currentStatus,
  incomingStatus,
  currentSeq,
  incomingSeq,
}: ReadyGateTruthPrecedenceInput): boolean {
  if (isReadyGateTerminalStatus(currentStatus) && !isReadyGateTerminalStatus(incomingStatus)) {
    return false;
  }

  const currentOrdinal = getReadyGateStatusOrdinal(currentStatus);
  const incomingOrdinal = getReadyGateStatusOrdinal(incomingStatus);

  if (
    isReadyGateTerminalStatus(currentStatus) &&
    isReadyGateTerminalStatus(incomingStatus) &&
    incomingOrdinal < currentOrdinal
  ) {
    return false;
  }

  const currentSeqValue = finiteSeq(currentSeq);
  const incomingSeqValue = finiteSeq(incomingSeq);

  if (incomingSeqValue != null && currentSeqValue != null) {
    if (incomingSeqValue > currentSeqValue) return true;
    if (incomingSeqValue < currentSeqValue) return false;
  }

  if (currentOrdinal === incomingOrdinal) return true;
  return incomingOrdinal > currentOrdinal;
}

export function getReadyGatePermissionPrewarmReleaseDelayMs(input: {
  prewarmCompletedAtMs: number;
  nowMs?: number;
  graceMs?: number;
}): number {
  const completedAtMs = finiteNumber(input.prewarmCompletedAtMs);
  const nowMs = finiteNumber(input.nowMs) ?? Date.now();
  const graceMs = Math.max(0, finiteNumber(input.graceMs) ?? READY_GATE_PERMISSION_PREWARM_RELEASE_GRACE_MS);
  if (completedAtMs == null) return graceMs;
  return Math.max(0, Math.round(completedAtMs + graceMs - nowMs));
}

export function getReadyGateParticipantPosition(
  truth: ReadyGateReadinessTruth,
  userId: string | null | undefined,
  previousPosition: ReadyGateParticipantPosition | null = null,
): ReadyGateParticipantPosition | null {
  if (!userId) return previousPosition;

  if (truth.participant_1_id === userId) return "p1";
  if (truth.participant_2_id === userId) return "p2";

  return previousPosition;
}

export function deriveReadyGateReadinessState(input: {
  truth: ReadyGateReadinessTruth;
  userId?: string | null;
  previous?: Partial<ReadyGateReadinessState> | null;
}): ReadyGateReadinessState {
  const previous = {
    ...initialReadyGateReadinessState,
    ...(input.previous ?? {}),
  };
  const participantPosition = getReadyGateParticipantPosition(
    input.truth,
    input.userId,
    previous.participantPosition,
  );
  const status = readyGateStatus(input.truth);
  const terminalWithoutDate = status === "forfeited" || status === "expired";

  if (status === "both_ready") {
    return {
      iAmReady: true,
      partnerReady: true,
      iAmReadyKnown: true,
      partnerReadyKnown: true,
      isBothReady: true,
      participantPosition,
    };
  }

  const hasFullTimestampTruth =
    participantPosition != null &&
    hasOwn(input.truth, "ready_participant_1_at") &&
    hasOwn(input.truth, "ready_participant_2_at");

  if (!hasFullTimestampTruth) {
    return {
      ...previous,
      isBothReady:
        !terminalWithoutDate &&
        previous.iAmReadyKnown &&
        previous.partnerReadyKnown &&
        previous.iAmReady &&
        previous.partnerReady,
      participantPosition,
    };
  }

  const myReadyAt = participantPosition === "p1"
    ? input.truth.ready_participant_1_at
    : input.truth.ready_participant_2_at;
  const partnerReadyAt = participantPosition === "p1"
    ? input.truth.ready_participant_2_at
    : input.truth.ready_participant_1_at;
  const iAmReady = hasReadyTimestamp(myReadyAt);
  const partnerReady = hasReadyTimestamp(partnerReadyAt);

  return {
    iAmReady,
    partnerReady,
    iAmReadyKnown: true,
    partnerReadyKnown: true,
    isBothReady: !terminalWithoutDate && iAmReady && partnerReady,
    participantPosition,
  };
}

export function getReadyGateReadinessStatusCopy(input: {
  iAmReady: boolean;
  partnerReady: boolean;
  partnerReadyKnown: boolean;
  isBothReady?: boolean;
  markingReady?: boolean;
  partnerName?: string | null;
}): ReadyGateReadinessCopy {
  const partnerLabel = input.partnerName || "them";

  if (
    input.isBothReady === true ||
    (input.iAmReady && input.partnerReady) ||
    (input.markingReady === true && input.partnerReady)
  ) {
    return {
      key: "both_ready_connecting",
      text: "Both ready. Connecting you now...",
    };
  }

  if (input.iAmReady && input.partnerReadyKnown && !input.partnerReady) {
    return {
      key: "waiting_partner",
      text: `You're ready. Waiting for ${partnerLabel}...`,
    };
  }

  if (input.iAmReady && !input.partnerReadyKnown) {
    return {
      key: "syncing",
      text: "Getting your date ready...",
    };
  }

  if (!input.iAmReady && input.partnerReady) {
    return {
      key: "partner_ready_prompt",
      text: `${partnerLabel} is ready. Tap Ready when you're ready.`,
    };
  }

  return {
    key: "waiting_both",
    text: "Waiting for both of you to get ready.",
  };
}
