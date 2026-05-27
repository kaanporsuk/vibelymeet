export const AUTH_OTP_COOLDOWN_SECONDS = {
  firstRetry: 60,
  secondRetry: 180,
  laterRetry: 900,
} as const;

const MAX_PROVIDER_RETRY_AFTER_SECONDS = 60 * 60;

function positiveWholeSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.min(Math.ceil(value), MAX_PROVIDER_RETRY_AFTER_SECONDS);
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const numeric = Number(value.trim());
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.min(Math.ceil(numeric), MAX_PROVIDER_RETRY_AFTER_SECONDS);
}

function headerRetryAfterSeconds(headers: unknown): number | null {
  if (!headers || typeof headers !== "object") return null;
  const maybeHeaders = headers as {
    get?: (name: string) => unknown;
    retryAfter?: unknown;
    "retry-after"?: unknown;
  };
  if (typeof maybeHeaders.get === "function") {
    return (
      positiveWholeSeconds(maybeHeaders.get("retry-after"))
      ?? positiveWholeSeconds(maybeHeaders.get("Retry-After"))
    );
  }
  return (
    positiveWholeSeconds(maybeHeaders["retry-after"])
    ?? positiveWholeSeconds(maybeHeaders.retryAfter)
  );
}

export function authProviderRetryAfterSeconds(source: unknown): number | null {
  if (!source || typeof source !== "object") {
    if (typeof source === "string") {
      const messageMatch = source.match(/\b(?:after|in)\s+(\d{1,5})\s*(?:s|sec|second|seconds)\b/i);
      return positiveWholeSeconds(messageMatch?.[1]);
    }
    return null;
  }

  const record = source as {
    retryAfter?: unknown;
    retry_after?: unknown;
    retry_after_seconds?: unknown;
    retryAfterSeconds?: unknown;
    headers?: unknown;
    response?: { headers?: unknown };
    context?: Record<string, unknown>;
    message?: unknown;
  };

  const direct =
    positiveWholeSeconds(record.retryAfter)
    ?? positiveWholeSeconds(record.retry_after)
    ?? positiveWholeSeconds(record.retry_after_seconds)
    ?? positiveWholeSeconds(record.retryAfterSeconds)
    ?? headerRetryAfterSeconds(record.headers)
    ?? headerRetryAfterSeconds(record.response?.headers)
    ?? positiveWholeSeconds(record.context?.retryAfter)
    ?? positiveWholeSeconds(record.context?.retry_after);
  if (direct !== null) return direct;

  if (typeof record.message === "string") {
    const messageMatch = record.message.match(/\b(?:after|in)\s+(\d{1,5})\s*(?:s|sec|second|seconds)\b/i);
    return positiveWholeSeconds(messageMatch?.[1]);
  }

  return null;
}

export function authOtpCooldownForAttempt(attempt: number): number {
  if (attempt <= 1) return AUTH_OTP_COOLDOWN_SECONDS.firstRetry;
  if (attempt === 2) return AUTH_OTP_COOLDOWN_SECONDS.secondRetry;
  return AUTH_OTP_COOLDOWN_SECONDS.laterRetry;
}

export function nextAuthOtpCooldownSeconds(attempt: number, providerHintSource?: unknown): number {
  return authProviderRetryAfterSeconds(providerHintSource) ?? authOtpCooldownForAttempt(attempt);
}

export function formatAuthCooldown(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.ceil(seconds));
  if (wholeSeconds < 60) return `${wholeSeconds}s`;
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}
