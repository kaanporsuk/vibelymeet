export const VIDEO_DATE_ENTRY_TRUTH_SELECT =
  "id, participant_1_id, participant_2_id, session_seq, participant_1_joined_at, participant_2_joined_at, participant_1_remote_seen_at, participant_2_remote_seen_at, participant_1_liked, participant_2_liked, participant_1_decided_at, participant_2_decided_at, state, phase, ended_at, ended_reason, entry_started_at, entry_grace_expires_at, date_started_at, date_extra_seconds, daily_room_name, daily_room_url";

export type EntryDecisionAction = "vibe" | "pass";

export type VideoDateEntryTruth = {
  id?: string | null;
  participant_1_id?: string | null;
  participant_2_id?: string | null;
  session_seq?: number | null;
  participant_1_joined_at?: string | null;
  participant_2_joined_at?: string | null;
  participant_1_remote_seen_at?: string | null;
  participant_2_remote_seen_at?: string | null;
  participant_1_liked?: boolean | null;
  participant_2_liked?: boolean | null;
  participant_1_decided_at?: string | null;
  participant_2_decided_at?: string | null;
  state?: string | null;
  phase?: string | null;
  ended_at?: string | null;
  ended_reason?: string | null;
  entry_started_at?: string | null;
  entry_grace_expires_at?: string | null;
  date_started_at?: string | null;
  date_extra_seconds?: number | null;
  daily_room_name?: string | null;
  daily_room_url?: string | null;
};

export type VideoDateTransitionPayload = {
  success?: boolean;
  state?: string | null;
  code?: string | null;
  error?: string | null;
  reason?: string | null;
  retryable?: boolean;
  waiting_for_partner?: boolean;
  waiting_for_self?: boolean;
  local_decision_persisted?: boolean;
  partner_decision_persisted?: boolean;
  grace_expires_at?: string | null;
  seconds_remaining?: number | null;
};

export function entryTruthIndicatesEndedSession(
  truth: VideoDateEntryTruth | null | undefined,
): boolean {
  if (!truth) return false;
  return Boolean(truth.ended_at) || truth.state === "ended" || truth.phase === "ended";
}

/** `video_date_transition` returned `success:false` with a terminal code or ended state. */
export function entryRpcIndicatesTerminalDecisionRejection(
  payload: VideoDateTransitionPayload | null | undefined,
): boolean {
  if (!payload) return false;
  const code = payload.code ?? null;
  if (code === "GRACE_EXPIRED" || code === "SESSION_ENDED") return true;
  return payload.state === "ended";
}

export function entryDecisionFailureIndicatesSessionEnded(opts: {
  truth: VideoDateEntryTruth | null;
  rpcPayload: VideoDateTransitionPayload | null;
}): boolean {
  return (
    entryTruthIndicatesEndedSession(opts.truth) ||
    entryRpcIndicatesTerminalDecisionRejection(opts.rpcPayload)
  );
}

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
  truth: VideoDateEntryTruth | null;
  error?: VideoDateTransitionError | null;
};

export type PersistEntryDecisionInput = {
  sessionId: string;
  actorUserId: string;
  action: EntryDecisionAction;
  rpc: (args: { p_session_id: string; p_action: EntryDecisionAction }) => Promise<TransitionResult>;
  fetchTruth: () => Promise<TruthResult>;
  retryDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  log?: (event: string, payload: Record<string, unknown>) => void;
};

export type PersistEntryDecisionFailureReason =
  | "actor_not_participant"
  | "decision_not_persisted"
  | "rpc_error"
  | "rpc_rejected"
  | "truth_unavailable"
  | "exception";

export type PersistEntryDecisionResult =
  | {
      ok: true;
      action: EntryDecisionAction;
      attempts: number;
      actorDecisionPersisted: true;
      actorDecisionSlot: "participant_1_liked" | "participant_2_liked";
      actorDecisionTimestampSlot: "participant_1_decided_at" | "participant_2_decided_at";
      expectedDecision: boolean;
      persistedDecision: boolean;
      persistedDecisionAt: string;
      rpcPayload: VideoDateTransitionPayload | null;
      truth: VideoDateEntryTruth;
      state: string | null;
    }
  | {
      ok: false;
      action: EntryDecisionAction;
      attempts: number;
      reason: PersistEntryDecisionFailureReason;
      retryable: boolean;
      actorDecisionPersisted: false;
      actorDecisionSlot: "participant_1_liked" | "participant_2_liked" | null;
      actorDecisionTimestampSlot: "participant_1_decided_at" | "participant_2_decided_at" | null;
      expectedDecision: boolean;
      persistedDecision: boolean | null;
      persistedDecisionAt: string | null;
      rpcPayload: VideoDateTransitionPayload | null;
      truth: VideoDateEntryTruth | null;
      error?: VideoDateTransitionError | null;
      userMessage: string;
    };

export type CompleteEntryTruthExpectation =
  | { kind: "already_ended"; reason: string | null }
  | { kind: "date" }
  | { kind: "ended_non_mutual" }
  | { kind: "ended_timeout"; waitingForParticipant1: boolean; waitingForParticipant2: boolean };

function asPayload(data: unknown): VideoDateTransitionPayload | null {
  if (!data || typeof data !== "object") return null;
  return data as VideoDateTransitionPayload;
}

export function expectedDecisionForEntryAction(action: EntryDecisionAction): boolean {
  return action === "vibe";
}

export function actorDecisionSlot(
  truth: VideoDateEntryTruth | null,
  actorUserId: string,
): "participant_1_liked" | "participant_2_liked" | null {
  if (!truth) return null;
  if (truth.participant_1_id === actorUserId) return "participant_1_liked";
  if (truth.participant_2_id === actorUserId) return "participant_2_liked";
  return null;
}

export function actorDecisionTimestampSlot(
  truth: VideoDateEntryTruth | null,
  actorUserId: string,
): "participant_1_decided_at" | "participant_2_decided_at" | null {
  if (!truth) return null;
  if (truth.participant_1_id === actorUserId) return "participant_1_decided_at";
  if (truth.participant_2_id === actorUserId) return "participant_2_decided_at";
  return null;
}

export function actorPersistedDecision(
  truth: VideoDateEntryTruth | null,
  actorUserId: string,
): boolean | null {
  const slot = actorDecisionSlot(truth, actorUserId);
  if (!slot || !truth) return null;
  return truth[slot] ?? null;
}

export function actorPersistedDecisionAt(
  truth: VideoDateEntryTruth | null,
  actorUserId: string,
): string | null {
  const slot = actorDecisionTimestampSlot(truth, actorUserId);
  if (!slot || !truth) return null;
  return truth[slot] ?? null;
}

export function actorDecisionPersisted(
  truth: VideoDateEntryTruth | null,
  actorUserId: string,
  action: EntryDecisionAction,
): boolean {
  return Boolean(actorPersistedDecisionAt(truth, actorUserId))
    && actorPersistedDecision(truth, actorUserId) === expectedDecisionForEntryAction(action);
}

/** Explicit Pass: decided_at set and liked is false (undecided keeps liked null or legacy false without decided_at). */
export function hasExplicitEntryPass(truth: VideoDateEntryTruth): boolean {
  const p1Pass = Boolean(truth.participant_1_decided_at) && truth.participant_1_liked === false;
  const p2Pass = Boolean(truth.participant_2_decided_at) && truth.participant_2_liked === false;
  return p1Pass || p2Pass;
}

export function completeEntryExpectation(
  truth: VideoDateEntryTruth,
): CompleteEntryTruthExpectation {
  if (truth.ended_at || truth.state === "ended" || truth.phase === "ended") {
    return { kind: "already_ended", reason: truth.ended_reason ?? null };
  }
  const participant1Decided = Boolean(truth.participant_1_decided_at);
  const participant2Decided = Boolean(truth.participant_2_decided_at);
  if (participant1Decided && participant2Decided && truth.participant_1_liked === true && truth.participant_2_liked === true) {
    return { kind: "date" };
  }
  if (hasExplicitEntryPass(truth)) {
    return { kind: "ended_non_mutual" };
  }
  if (participant1Decided && participant2Decided) {
    return { kind: "ended_non_mutual" };
  }
  return {
    kind: "ended_timeout",
    waitingForParticipant1: !participant1Decided,
    waitingForParticipant2: !participant2Decided,
  };
}

export function entryTruthLogPayload(truth: VideoDateEntryTruth | null): Record<string, unknown> {
  return {
    participant_1_joined_at: truth?.participant_1_joined_at ?? null,
    participant_2_joined_at: truth?.participant_2_joined_at ?? null,
    participant_1_liked: truth?.participant_1_liked ?? null,
    participant_2_liked: truth?.participant_2_liked ?? null,
    participant_1_decided_at: truth?.participant_1_decided_at ?? null,
    participant_2_decided_at: truth?.participant_2_decided_at ?? null,
    state: truth?.state ?? null,
    phase: truth?.phase ?? null,
    ended_at: truth?.ended_at ?? null,
    ended_reason: truth?.ended_reason ?? null,
    entry_grace_expires_at: truth?.entry_grace_expires_at ?? null,
  };
}

function isRetryableError(error: VideoDateTransitionError | null | undefined): boolean {
  const text = `${error?.name ?? ""} ${error?.code ?? ""} ${error?.message ?? ""}`.toLowerCase();
  return /fetch|network|timeout|timed out|temporar|aborted|relay|unavailable|connection|503|504|502/.test(text);
}

function userMessageForFailure(reason: PersistEntryDecisionFailureReason): string {
  if (reason === "rpc_rejected") return "We could not save your choice. Try again.";
  if (reason === "decision_not_persisted") return "Your choice did not save yet. Tap again.";
  if (reason === "actor_not_participant") return "This date is no longer available.";
  if (reason === "truth_unavailable") return "We could not confirm your choice. Try again.";
  return "Connection hiccup. Try again.";
}

function userMessageForRpcRejectedPayload(payload: VideoDateTransitionPayload | null): string {
  const code = payload?.code ?? null;
  if (code === "GRACE_EXPIRED") return "The warm-up already ended.";
  if (code === "SESSION_ENDED") return "This date has already ended.";
  return userMessageForFailure("rpc_rejected");
}

export async function persistEntryDecisionWithVerification(
  input: PersistEntryDecisionInput,
): Promise<PersistEntryDecisionResult> {
  const delays = input.retryDelaysMs ?? [700, 1_600];
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const expectedDecision = expectedDecisionForEntryAction(input.action);
  let lastPayload: VideoDateTransitionPayload | null = null;
  let lastTruth: VideoDateEntryTruth | null = null;
  let lastError: VideoDateTransitionError | null = null;
  let lastReason: PersistEntryDecisionFailureReason = "exception";

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

    input.log?.("entry_decision_rpc_before", baseLog);

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
        input.log?.("entry_decision_rpc_after", {
          ...baseLog,
          ok: false,
          retryable,
          error: rpcResult.error,
          rpcPayload: lastPayload,
        });
        if (retryable) continue;
        let truthForReturn: VideoDateEntryTruth | null = lastTruth;
        if (!truthForReturn) {
          const tr = await input.fetchTruth();
          const fetched = tr.truth ?? null;
          truthForReturn = fetched;
          lastTruth = fetched;
        }
        return {
          ok: false,
          action: input.action,
          attempts: attempt,
          reason: "rpc_error",
          retryable: isRetryableError(rpcResult.error),
          actorDecisionPersisted: false,
          actorDecisionSlot: null,
          actorDecisionTimestampSlot: null,
          expectedDecision,
          persistedDecision: null,
          persistedDecisionAt: null,
          rpcPayload: lastPayload,
          truth: truthForReturn,
          error: rpcResult.error,
          userMessage: userMessageForFailure("rpc_error"),
        };
      }

      const truthResult = await input.fetchTruth();
      lastTruth = truthResult.truth;
      if (truthResult.error) lastError = truthResult.error;
      const slot = actorDecisionSlot(lastTruth, input.actorUserId);
      const timestampSlot = actorDecisionTimestampSlot(lastTruth, input.actorUserId);
      const persistedDecision = actorPersistedDecision(lastTruth, input.actorUserId);
      const persistedDecisionAt = actorPersistedDecisionAt(lastTruth, input.actorUserId);
      const persisted = Boolean(persistedDecisionAt) && persistedDecision === expectedDecision;
      const rpcRejected = lastPayload?.success === false;
      const rpcRejectedRetryable = rpcRejected && lastPayload?.retryable === true;
      const truthUnavailable = !lastTruth || Boolean(truthResult.error);
      const actorMissing = Boolean(lastTruth) && slot === null;
      const retryableConsistencyMiss =
        !rpcRejected
        && !actorMissing
        && !lastTruth?.ended_at
        && lastTruth?.state !== "ended"
        && persistedDecision !== expectedDecision
        && attempt <= delays.length;

      input.log?.("entry_decision_rpc_after", {
        ...baseLog,
        ok: !rpcRejected && persisted,
        retryable: rpcRejectedRetryable || truthUnavailable || retryableConsistencyMiss,
        rpcPayload: lastPayload,
        error: truthResult.error ?? null,
        actorDecisionSlot: slot,
        actorDecisionTimestampSlot: timestampSlot,
        expectedDecision,
        persistedDecision,
        persistedDecisionAt,
        actorDecisionPersisted: persisted,
        ...entryTruthLogPayload(lastTruth),
      });

      const confirmedTruth = lastTruth;
      if (persisted && slot && timestampSlot && persistedDecisionAt && confirmedTruth) {
        return {
          ok: true,
          action: input.action,
          attempts: attempt,
          actorDecisionPersisted: true,
          actorDecisionSlot: slot,
          actorDecisionTimestampSlot: timestampSlot,
          expectedDecision,
          persistedDecision,
          persistedDecisionAt: persistedDecisionAt as string,
          rpcPayload: lastPayload,
          truth: confirmedTruth,
          state: lastPayload?.state ?? confirmedTruth.state ?? null,
        };
      }

      if (rpcRejected) {
        if (rpcRejectedRetryable && attempt <= delays.length) continue;
        return {
          ok: false,
          action: input.action,
          attempts: attempt,
          reason: "rpc_rejected",
          retryable: rpcRejectedRetryable,
          actorDecisionPersisted: false,
          actorDecisionSlot: slot,
          actorDecisionTimestampSlot: timestampSlot,
          expectedDecision,
          persistedDecision,
          persistedDecisionAt,
          rpcPayload: lastPayload,
          truth: lastTruth,
          error: null,
          userMessage: userMessageForRpcRejectedPayload(lastPayload),
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
          actorDecisionTimestampSlot: timestampSlot,
          expectedDecision,
          persistedDecision,
          persistedDecisionAt,
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
          actorDecisionTimestampSlot: null,
          expectedDecision,
          persistedDecision: null,
          persistedDecisionAt: null,
          rpcPayload: lastPayload,
          truth: lastTruth,
          error: null,
          userMessage: userMessageForFailure("actor_not_participant"),
        };
      }

      lastReason = "decision_not_persisted";
      if (retryableConsistencyMiss) continue;
      const failureTruth = lastTruth as VideoDateEntryTruth;

      return {
        ok: false,
        action: input.action,
        attempts: attempt,
        reason: "decision_not_persisted",
        retryable: !failureTruth.ended_at && failureTruth.state !== "ended",
        actorDecisionPersisted: false,
        actorDecisionSlot: slot,
        actorDecisionTimestampSlot: timestampSlot,
        expectedDecision,
        persistedDecision,
        persistedDecisionAt,
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
      input.log?.("entry_decision_rpc_after", {
        ...baseLog,
        ok: false,
        retryable,
        error: normalizedError,
        rpcPayload: lastPayload,
      });
      if (retryable) continue;
      let truthForException: VideoDateEntryTruth | null = lastTruth;
      if (!truthForException) {
        const tr = await input.fetchTruth();
        const fetched = tr.truth ?? null;
        truthForException = fetched;
        lastTruth = fetched;
      }
      return {
        ok: false,
        action: input.action,
        attempts: attempt,
        reason: "exception",
        retryable: isRetryableError(normalizedError),
        actorDecisionPersisted: false,
        actorDecisionSlot: null,
        actorDecisionTimestampSlot: null,
        expectedDecision,
        persistedDecision: null,
        persistedDecisionAt: null,
        rpcPayload: lastPayload,
        truth: truthForException,
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
    actorDecisionTimestampSlot: actorDecisionTimestampSlot(lastTruth, input.actorUserId),
    expectedDecision,
    persistedDecision: actorPersistedDecision(lastTruth, input.actorUserId),
    persistedDecisionAt: actorPersistedDecisionAt(lastTruth, input.actorUserId),
    rpcPayload: lastPayload,
    truth: lastTruth,
    error: lastError,
    userMessage: userMessageForFailure(lastReason),
  };
}
