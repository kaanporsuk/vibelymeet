export const VIDEO_DATE_SIGNAL_RETRY_DELAYS_MS = [0, 700, 1_600] as const;

export type VideoDateSignalRetryResult<T> =
  | { ok: true; value: T; attempts: number; idempotencyKey: string }
  | { ok: false; attempts: number; idempotencyKey: string; error: unknown };

export function buildVideoDateSignalIdempotencyKey(sessionId: string, action: string): string {
  return `${sessionId}:${action}`;
}

export async function sendVideoDateSignalWithRetry<T>(params: {
  sessionId: string;
  action: string;
  operation: (attempt: number, idempotencyKey: string) => Promise<T>;
  isSuccess?: (value: T) => boolean;
  delaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}): Promise<VideoDateSignalRetryResult<T>> {
  const delays = params.delaysMs ?? VIDEO_DATE_SIGNAL_RETRY_DELAYS_MS;
  const sleep = params.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const idempotencyKey = buildVideoDateSignalIdempotencyKey(params.sessionId, params.action);
  let lastError: unknown = null;

  for (let i = 0; i < delays.length; i += 1) {
    const delay = delays[i];
    if (delay > 0) await sleep(delay);
    const attempt = i + 1;
    try {
      const value = await params.operation(attempt, idempotencyKey);
      if (!params.isSuccess || params.isSuccess(value)) {
        return { ok: true, value, attempts: attempt, idempotencyKey };
      }
      lastError = value;
    } catch (error) {
      lastError = error;
    }
  }

  return {
    ok: false,
    attempts: delays.length,
    idempotencyKey,
    error: lastError,
  };
}

