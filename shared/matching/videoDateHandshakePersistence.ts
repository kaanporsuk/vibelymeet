export const VIDEO_DATE_HANDSHAKE_TRUTH_SELECT =
  "id, participant_1_id, participant_2_id, participant_1_joined_at, participant_2_joined_at, participant_1_liked, participant_2_liked, state, phase, ended_at, ended_reason, handshake_grace_expires_at";

export type HandshakeDecisionAction = "vibe" | "pass";

export type VideoDateHandshakeTruth = {
  id?: string | null;
  participant_1_id?: string | null;
  participant_2_id?: string | null;
  participant_1_joined_at?: string | null;
  participant_2_joined_at?: string | null;
  participant_1_liked?: boolean | null;
  participant_2_liked?: boolean | null;
  state?: string | null;
  phase?: string | null;
  ended_at?: string | null;
  ended_reason?: string | null;
  handshake_grace_expires_at?: string | null;
};

export type VideoDateTransitionPayload = {
  success?: boolean;
  state?: string | null;
  code?: string | null;
  error?: string | null;
  reason?: string | null;
  waiting_for_partner?: boolean;
  grace_expires_at?: string | null;
  seconds_remaining?: number | null;
};

export type VideoDateTransitionError = {
  code?: string | null;
  message?: string | null;
  name?: string | null;
};

type TransitionResult = {
  data: unknown;
  error: VideoDateTransitionError | null;
};

type TruthResult = {
  truth: VideoDateHandshakeTruth | null;
  error?: VideoDateTransitionError | null;
};

export type PersistHandshakeDecisionInput = {
  sessionId: string;
  actorUserId: string;
  action: HandshakeDecisionAction;
  rpc: (args: { p_session_id: string; p_action: HandshakeDecisionAction }) => Promise<TransitionResult>;
  fetchTruth: () => Promise<TruthResult>;
  retryDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  log?: (event: string, payload: Record<string, unknown>) => void;
};

export type PersistHandshakeDecisionFailureReason =
  | "actor_not_participant"
  | "decision_not_persisted"
  | "rpc_error"
  | "rpc_rejected"
  | "truth_unavailable"
  | "exception";

export type PersistHandshakeDecisionResult =
  | {
      ok: true;
      action: HandshakeDecisionAction;
      attempts: number;
      actorDecisionPersisted: true;
      actorDecisionSlot: "participant_1_liked" | "participant_2_liked";
      expectedDecision: boolean;
      persistedDecision: boolean;
      rpcPayload: VideoDateTransitionPayload | null;
      truth: VideoDateHandshakeTruth;
      state: string | null;
    }
  | {
      ok: false;
      action: HandshakeDecisionAction;
      attempts: number;
      reason: PersistHandshakeDecisionFailureReason;
      retryable: boolean;
      actorDecisionPersisted: false;
      actorDecisionSlot: "participant_1_liked" | "participant_2_liked" | null;
      expectedDecision: boolean;
      persistedDecision: boolean | null;
      rpcPayload: VideoDateTransitionPayload | null;
      truth: VideoDateHandshakeTruth | null;
      error?: VideoDateTransitionError | null;
      userMessage: string;
    };

export type CompleteHandshakeTruthExpectation =
  | { kind: "already_ended"; reason: string | null }
  | { kind: "date" }
  | { kind: "ended_non_mutual" }
  | { kind: "waiting_for_partner"; graceSecondsIfStartedNow: 15 | 60 };

function asPayload(data: unknown): VideoDateTransitionPayload | null {
  if (!data || typeof data !== "object") return null;
  return data as VideoDateTransitionPayload;
}

export function expectedDecisionForHandshakeAction(action: HandshakeDecisionAction): boolean {
  return action === "vibe";
}

export function actorDecisionSlot(
  truth: VideoDateHandshakeTruth | null,
  actorUserId: string,
): "participant_1_liked" | "participant_2_liked" | null {
  if (!truth) return null;
  if (truth.participant_1_id === actorUserId) return "participant_1_liked";
  if (truth.participant_2_id === actorUserId) return "participant_2_liked";
  return null;
}

export function actorPersistedDecision(
  truth: VideoDateHandshakeTruth | null,
  actorUserId: string,
): boolean | null {
  const slot = actorDecisionSlot(truth, actorUserId);
  if (!slot || !truth) return null;
  return truth[slot] ?? null;
}

export function actorDecisionPersisted(
  truth: VideoDateHandshakeTruth | null,
  actorUserId: string,
  action: HandshakeDecisionAction,
): boolean {
  return actorPersistedDecision(truth, actorUserId) === expectedDecisionForHandshakeAction(action);
}

export function completeHandshakeExpectation(
  truth: VideoDateHandshakeTruth,
): CompleteHandshakeTruthExpectation {
  if (truth.ended_at || truth.state === "ended" || truth.phase === "ended") {
    return { kind: "already_ended", reason: truth.ended_reason ?? null };
  }
  if (truth.participant_1_liked === true && truth.participant_2_liked === true) {
    return { kind: "date" };
  }
  if (truth.participant_1_liked !== null && truth.participant_1_liked !== undefined
    && truth.participant_2_liked !== null && truth.participant_2_liked !== undefined) {
    return { kind: "ended_non_mutual" };
  }
  return {
    kind: "waiting_for_partner",
    graceSecondsIfStartedNow:
      truth.participant_1_joined_at && truth.participant_2_joined_at ? 60 : 15,
  };
}

export function handshakeTruthLogPayload(truth: VideoDateHandshakeTruth | null): Record<string, unknown> {
  return {
    participant_1_joined_at: truth?.participant_1_joined_at ?? null,
    participant_2_joined_at: truth?.participant_2_joined_at ?? null,
    participant_1_liked: truth?.participant_1_liked ?? null,
    participant_2_liked: truth?.participant_2_liked ?? null,
    state: truth?.state ?? null,
    phase: truth?.phase ?? null,
    ended_at: truth?.ended_at ?? null,
    ended_reason: truth?.ended_reason ?? null,
    handshake_grace_expires_at: truth?.handshake_grace_expires_at ?? null,
  };
}

function isRetryableError(error: VideoDateTransitionError | null | undefined): boolean {
  const text = `${error?.name ?? ""} ${error?.code ?? ""} ${error?.message ?? ""}`.toLowerCase();
  return /fetch|network|timeout|timed out|temporar|aborted|relay|unavailable|connection|503|504|502/.test(text);
}

function userMessageForFailure(reason: PersistHandshakeDecisionFailureReason): string {
  if (reason === "rpc_rejected") return "We could not save your Vibe. Try again.";
  if (reason === "decision_not_persisted") return "Your Vibe did not save yet. Tap again.";
  if (reason === "actor_not_participant") return "This date is no longer available.";
  if (reason === "truth_unavailable") return "We could not confirm your Vibe. Try again.";
  return "Connection hiccup. Try Vibe again.";
}

export async function persistHandshakeDecisionWithVerification(
  input: PersistHandshakeDecisionInput,
): Promise<PersistHandshakeDecisionResult> {
  const delays = input.retryDelaysMs ?? [700, 1_600];
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const expectedDecision = expectedDecisionForHandshakeAction(input.action);
  let lastPayload: VideoDateTransitionPayload | null = null;
  let lastTruth: VideoDateHandshakeTruth | null = null;
  let lastError: VideoDateTransitionError | null = null;
  let lastReason: PersistHandshakeDecisionFailureReason = "exception";

  for (let attempt = 1; attempt <= delays.length + 1; attempt += 1) {
    if (attempt > 1) {
      await sleep(delays[attempt - 2] ?? 0);
    }

    const baseLog = {
      sessionId: input.sessionId,
      actorUserId: input.actorUserId,
      action: input.action,
      attempt,
      maxAttempts: delays.length + 1,
    };

    input.log?.("handshake_decision_rpc_before", baseLog);

    try {
      const rpcResult = await input.rpc({
        p_session_id: input.sessionId,
        p_action: input.action,
      });
      lastPayload = asPayload(rpcResult.data);
      lastError = rpcResult.error;

      if (rpcResult.error) {
        lastReason = "rpc_error";
        const retryable = isRetryableError(rpcResult.error) && attempt <= delays.length;
        input.log?.("handshake_decision_rpc_after", {
          ...baseLog,
          ok: false,
          retryable,
          error: rpcResult.error,
          rpcPayload: lastPayload,
        });
        if (retryable) continue;
        return {
          ok: false,
          action: input.action,
          attempts: attempt,
          reason: "rpc_error",
          retryable: isRetryableError(rpcResult.error),
          actorDecisionPersisted: false,
          actorDecisionSlot: null,
          expectedDecision,
          persistedDecision: null,
          rpcPayload: lastPayload,
          truth: lastTruth,
          error: rpcResult.error,
          userMessage: userMessageForFailure("rpc_error"),
        };
      }

      const truthResult = await input.fetchTruth();
      lastTruth = truthResult.truth;
      if (truthResult.error) lastError = truthResult.error;
      const slot = actorDecisionSlot(lastTruth, input.actorUserId);
      const persistedDecision = actorPersistedDecision(lastTruth, input.actorUserId);
      const persisted = persistedDecision === expectedDecision;
      const rpcRejected = lastPayload?.success === false;
      const truthUnavailable = !lastTruth || Boolean(truthResult.error);
      const actorMissing = Boolean(lastTruth) && slot === null;
      const retryableConsistencyMiss =
        !rpcRejected
        && !actorMissing
        && !lastTruth?.ended_at
        && lastTruth?.state !== "ended"
        && persistedDecision !== expectedDecision
        && attempt <= delays.length;

      input.log?.("handshake_decision_rpc_after", {
        ...baseLog,
        ok: !rpcRejected && persisted,
        retryable: truthUnavailable || retryableConsistencyMiss,
        rpcPayload: lastPayload,
        error: truthResult.error ?? null,
        actorDecisionSlot: slot,
        expectedDecision,
        persistedDecision,
        actorDecisionPersisted: persisted,
        ...handshakeTruthLogPayload(lastTruth),
      });

      if (rpcRejected) {
        return {
          ok: false,
          action: input.action,
          attempts: attempt,
          reason: "rpc_rejected",
          retryable: false,
          actorDecisionPersisted: false,
          actorDecisionSlot: slot,
          expectedDecision,
          persistedDecision,
          rpcPayload: lastPayload,
          truth: lastTruth,
          error: null,
          userMessage: userMessageForFailure("rpc_rejected"),
        };
      }

      if (truthUnavailable) {
        lastReason = "truth_unavailable";
        if (attempt <= delays.length && isRetryableError(truthResult.error)) continue;
        return {
          ok: false,
          action: input.action,
          attempts: attempt,
          reason: "truth_unavailable",
          retryable: Boolean(truthResult.error && isRetryableError(truthResult.error)),
          actorDecisionPersisted: false,
          actorDecisionSlot: slot,
          expectedDecision,
          persistedDecision,
          rpcPayload: lastPayload,
          truth: lastTruth,
          error: truthResult.error ?? null,
          userMessage: userMessageForFailure("truth_unavailable"),
        };
      }

      if (actorMissing) {
        return {
          ok: false,
          action: input.action,
          attempts: attempt,
          reason: "actor_not_participant",
          retryable: false,
          actorDecisionPersisted: false,
          actorDecisionSlot: null,
          expectedDecision,
          persistedDecision: null,
          rpcPayload: lastPayload,
          truth: lastTruth,
          error: null,
          userMessage: userMessageForFailure("actor_not_participant"),
        };
      }

      const confirmedTruth = lastTruth;
      if (persisted && slot && confirmedTruth) {
        return {
          ok: true,
          action: input.action,
          attempts: attempt,
          actorDecisionPersisted: true,
          actorDecisionSlot: slot,
          expectedDecision,
          persistedDecision,
          rpcPayload: lastPayload,
          truth: confirmedTruth,
          state: lastPayload?.state ?? confirmedTruth.state ?? null,
        };
      }

      lastReason = "decision_not_persisted";
      if (retryableConsistencyMiss) continue;
      const failureTruth = lastTruth as VideoDateHandshakeTruth;

      return {
        ok: false,
        action: input.action,
        attempts: attempt,
        reason: "decision_not_persisted",
        retryable: !failureTruth.ended_at && failureTruth.state !== "ended",
        actorDecisionPersisted: false,
        actorDecisionSlot: slot,
        expectedDecision,
        persistedDecision,
        rpcPayload: lastPayload,
        truth: failureTruth,
        error: null,
        userMessage: userMessageForFailure("decision_not_persisted"),
      };
    } catch (error) {
      const normalizedError: VideoDateTransitionError = error instanceof Error
        ? { name: error.name, message: error.message }
        : { message: String(error) };
      lastError = normalizedError;
      lastReason = "exception";
      const retryable = isRetryableError(normalizedError) && attempt <= delays.length;
      input.log?.("handshake_decision_rpc_after", {
        ...baseLog,
        ok: false,
        retryable,
        error: normalizedError,
        rpcPayload: lastPayload,
      });
      if (retryable) continue;
      return {
        ok: false,
        action: input.action,
        attempts: attempt,
        reason: "exception",
        retryable: isRetryableError(normalizedError),
        actorDecisionPersisted: false,
        actorDecisionSlot: null,
        expectedDecision,
        persistedDecision: null,
        rpcPayload: lastPayload,
        truth: lastTruth,
        error: normalizedError,
        userMessage: userMessageForFailure("exception"),
      };
    }
  }

  return {
    ok: false,
    action: input.action,
    attempts: delays.length + 1,
    reason: lastReason,
    retryable: false,
    actorDecisionPersisted: false,
    actorDecisionSlot: actorDecisionSlot(lastTruth, input.actorUserId),
    expectedDecision,
    persistedDecision: actorPersistedDecision(lastTruth, input.actorUserId),
    rpcPayload: lastPayload,
    truth: lastTruth,
    error: lastError,
    userMessage: userMessageForFailure(lastReason),
  };
}
