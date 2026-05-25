export const VIDEO_DATE_BROADCAST_GAP_RETRY_DELAYS_MS = [1_000, 3_000, 7_000, 15_000, 30_000] as const;
export const VIDEO_DATE_BROADCAST_GAP_MAX_ATTEMPTS = VIDEO_DATE_BROADCAST_GAP_RETRY_DELAYS_MS.length;

export type VideoDateBroadcastGapRecoveryState = {
  sessionId: string;
  targetSeq: number;
  expectedSeq: number | null;
  attempts: number;
  maxAttempts: number;
  nextRetryAtMs: number;
  lastError: string | null;
  exhausted: boolean;
};

export type VideoDateBroadcastGapRecoveryInput = {
  sessionId: string;
  targetSeq: number;
  expectedSeq?: number | null;
  maxAttempts?: number;
};

export function createVideoDateBroadcastGapRecovery(
  input: VideoDateBroadcastGapRecoveryInput,
  nowMs = Date.now(),
): VideoDateBroadcastGapRecoveryState {
  return {
    sessionId: input.sessionId,
    targetSeq: normalizeTargetSequence(input.targetSeq),
    expectedSeq: normalizeSequence(input.expectedSeq),
    attempts: 0,
    maxAttempts: normalizeMaxAttempts(input.maxAttempts),
    nextRetryAtMs: nowMs,
    lastError: null,
    exhausted: false,
  };
}

export function mergeVideoDateBroadcastGapRecovery(
  existing: VideoDateBroadcastGapRecoveryState | null,
  input: VideoDateBroadcastGapRecoveryInput,
  nowMs = Date.now(),
): VideoDateBroadcastGapRecoveryState {
  if (!existing || existing.sessionId !== input.sessionId) {
    return createVideoDateBroadcastGapRecovery(input, nowMs);
  }

  const targetSeq = Math.max(existing.targetSeq, normalizeTargetSequence(input.targetSeq));
  const expectedSeq = normalizeSequence(input.expectedSeq);
  const reopensExhaustedGap = existing.exhausted && targetSeq > existing.targetSeq;
  return {
    ...existing,
    targetSeq,
    attempts: reopensExhaustedGap ? 0 : existing.attempts,
    expectedSeq:
      expectedSeq == null
        ? existing.expectedSeq
        : existing.expectedSeq == null
          ? expectedSeq
          : Math.min(existing.expectedSeq, expectedSeq),
    maxAttempts: normalizeMaxAttempts(input.maxAttempts ?? existing.maxAttempts),
    lastError: reopensExhaustedGap ? null : existing.lastError,
    exhausted: reopensExhaustedGap ? false : existing.exhausted && targetSeq === existing.targetSeq,
    nextRetryAtMs: reopensExhaustedGap ? nowMs : existing.nextRetryAtMs,
  };
}

export function shouldAttemptVideoDateBroadcastGapRecovery(
  state: VideoDateBroadcastGapRecoveryState | null,
  nowMs = Date.now(),
): state is VideoDateBroadcastGapRecoveryState {
  return Boolean(
    state &&
      !state.exhausted &&
      state.attempts < state.maxAttempts &&
      state.nextRetryAtMs <= nowMs,
  );
}

export function recordVideoDateBroadcastGapRecoveryFailure(
  state: VideoDateBroadcastGapRecoveryState,
  error: unknown,
  nowMs = Date.now(),
): VideoDateBroadcastGapRecoveryState {
  const attempts = state.attempts + 1;
  const exhausted = attempts >= state.maxAttempts;
  const retryDelayMs =
    VIDEO_DATE_BROADCAST_GAP_RETRY_DELAYS_MS[
      Math.min(attempts - 1, VIDEO_DATE_BROADCAST_GAP_RETRY_DELAYS_MS.length - 1)
    ] ?? VIDEO_DATE_BROADCAST_GAP_RETRY_DELAYS_MS[VIDEO_DATE_BROADCAST_GAP_RETRY_DELAYS_MS.length - 1];

  return {
    ...state,
    attempts,
    exhausted,
    nextRetryAtMs: exhausted ? Number.POSITIVE_INFINITY : nowMs + retryDelayMs,
    lastError: describeRecoveryError(error),
  };
}

export function recordVideoDateBroadcastGapRecoverySuccess(
  state: VideoDateBroadcastGapRecoveryState,
  observedSeq: number | null | undefined,
  nowMs = Date.now(),
): VideoDateBroadcastGapRecoveryState | null {
  const seq = normalizeSequence(observedSeq);
  if (seq != null && seq >= state.targetSeq) {
    return null;
  }
  return recordVideoDateBroadcastGapRecoveryFailure(state, "snapshot_seq_behind_target", nowMs);
}

export function shouldRetainVideoDateBroadcastGapRecoveryForEvent(
  state: VideoDateBroadcastGapRecoveryState | null,
  observedSeq: number | null | undefined,
): state is VideoDateBroadcastGapRecoveryState {
  if (!state || state.exhausted) return false;
  const seq = normalizeSequence(observedSeq);
  return seq != null && seq < state.targetSeq;
}

export function videoDateBroadcastGapRetryDelayMs(
  state: VideoDateBroadcastGapRecoveryState | null,
  nowMs = Date.now(),
): number | null {
  if (!state || state.exhausted) return null;
  return Math.max(0, state.nextRetryAtMs - nowMs);
}

function normalizeSequence(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;
}

function normalizeTargetSequence(value: number | null | undefined): number {
  return normalizeSequence(value) ?? 0;
}

function normalizeMaxAttempts(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : VIDEO_DATE_BROADCAST_GAP_MAX_ATTEMPTS;
}

function describeRecoveryError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  if (!error) return "unknown";
  try {
    return JSON.stringify(error).slice(0, 180);
  } catch {
    return "unknown";
  }
}
