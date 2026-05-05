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
