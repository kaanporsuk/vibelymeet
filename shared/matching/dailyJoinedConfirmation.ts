export const DAILY_JOINED_CONFIRMATION_RETRY_DELAYS_MS = [1_500, 3_000, 5_000] as const;

export const DAILY_JOINED_CONFIRMATION_TERMINAL_ERROR_CODES = new Set([
  "unauthorized",
  "not_found",
  "session_ended",
  "forbidden",
]);

export type DailyJoinedConfirmationAttemptResult = {
  ok: boolean;
  code?: string | null;
  retryable?: boolean;
  error?: unknown;
  payload?: unknown;
};

export type DailyJoinedConfirmationAttemptReport = {
  attempt: number;
  ok: boolean;
  code: string | null;
  retryable: boolean;
  willRetry: boolean;
  delayMs: number | null;
  error?: unknown;
  payload?: unknown;
};

export type DailyJoinedConfirmationResult = {
  ok: boolean;
  attempts: number;
  code: string | null;
  retryable: boolean;
  exhausted: boolean;
  final: DailyJoinedConfirmationAttemptResult | null;
};

export type MarkDailyJoinedWithBackoffOptions = {
  confirm: (attempt: number) => Promise<DailyJoinedConfirmationAttemptResult>;
  retryDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  onAttemptResult?: (report: DailyJoinedConfirmationAttemptReport) => void;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeCode(code: string | null | undefined): string | null {
  return typeof code === "string" && code.trim().length > 0 ? code.trim().toLowerCase() : null;
}

export function isRetryableDailyJoinedConfirmationFailure(
  result: DailyJoinedConfirmationAttemptResult,
): boolean {
  if (result.ok) return false;
  if (typeof result.retryable === "boolean") return result.retryable;
  const code = normalizeCode(result.code);
  if (code && DAILY_JOINED_CONFIRMATION_TERMINAL_ERROR_CODES.has(code)) return false;
  return true;
}

export async function markDailyJoinedWithBackoff(
  options: MarkDailyJoinedWithBackoffOptions,
): Promise<DailyJoinedConfirmationResult> {
  const retryDelaysMs = options.retryDelaysMs ?? DAILY_JOINED_CONFIRMATION_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = retryDelaysMs.length + 1;
  let final: DailyJoinedConfirmationAttemptResult | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      final = await options.confirm(attempt);
    } catch (error) {
      final = {
        ok: false,
        code: "exception",
        retryable: true,
        error,
      };
    }

    if (final.ok) {
      options.onAttemptResult?.({
        attempt,
        ok: true,
        code: normalizeCode(final.code),
        retryable: false,
        willRetry: false,
        delayMs: null,
        error: final.error,
        payload: final.payload,
      });
      return {
        ok: true,
        attempts: attempt,
        code: normalizeCode(final.code),
        retryable: false,
        exhausted: false,
        final,
      };
    }

    const retryable = isRetryableDailyJoinedConfirmationFailure(final);
    const delayMs = retryDelaysMs[attempt - 1] ?? null;
    const willRetry = retryable && delayMs != null && attempt < maxAttempts;
    options.onAttemptResult?.({
      attempt,
      ok: false,
      code: normalizeCode(final.code),
      retryable,
      willRetry,
      delayMs,
      error: final.error,
      payload: final.payload,
    });

    if (!willRetry) {
      return {
        ok: false,
        attempts: attempt,
        code: normalizeCode(final.code),
        retryable,
        exhausted: retryable,
        final,
      };
    }

    await sleep(delayMs);
  }

  return {
    ok: false,
    attempts: maxAttempts,
    code: normalizeCode(final?.code),
    retryable: true,
    exhausted: true,
    final,
  };
}
