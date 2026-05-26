import { mapIdentityLinkingError } from '@shared/authConflictMessages';

type ErrorRecord = Record<string, unknown>;

const TEMPORARY_AUTH_STATUSES = new Set([500, 502, 503, 504]);
export type AuthIdentityLinkingMethod = 'google' | 'apple' | 'email' | 'phone';

function asRecord(value: unknown): ErrorRecord | null {
  return typeof value === 'object' && value !== null ? (value as ErrorRecord) : null;
}

function stringProp(record: ErrorRecord | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function numberProp(record: ErrorRecord | null, key: string): number | null {
  const value = record?.[key];
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function rawMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;

  const record = asRecord(error);
  return stringProp(record, 'message')
    ?? stringProp(record, 'error_description')
    ?? stringProp(record, 'msg')
    ?? stringProp(record, 'error')
    ?? '';
}

function trimmedRawMessage(error: unknown): string {
  return rawMessage(error).trim();
}

function statusFromMessage(message: string): number | null {
  const match = message.match(/["']?status["']?\s*[:=]\s*([1-5]\d{2})/i);
  if (!match) return null;
  const status = Number(match[1]);
  return Number.isFinite(status) ? status : null;
}

export function authErrorStatus(error: unknown): number | null {
  const record = asRecord(error);
  return numberProp(record, 'status')
    ?? numberProp(record, 'statusCode')
    ?? numberProp(record, 'errorCode')
    ?? statusFromMessage(rawMessage(error));
}

export function isRawAuthResponseMessage(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  const lower = message.toLowerCase();
  return (
    (/"type"\s*:\s*"default"/i.test(trimmed) && /"headers"\s*:/i.test(trimmed)) ||
    (/"bodyinit"\s*:/i.test(trimmed) && /"url"\s*:/i.test(trimmed)) ||
    lower.includes('/auth/v1/otp') ||
    lower.includes('sb-gateway-version') ||
    lower.includes('cf-cache-status') ||
    lower.includes('set-cookie')
  );
}

function isJsonLikeAuthMessage(message: string): boolean {
  const trimmed = message.trim();
  const startsLikeJson = trimmed.startsWith('{') || trimmed.startsWith('[');
  if (!startsLikeJson) return false;
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === 'object' && parsed !== null;
  } catch {
    return (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    );
  }
}

function isMachineAuthCodeMessage(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 80) return false;
  return /^[a-z0-9_.:-]+$/.test(trimmed) && /[_:-]/.test(trimmed);
}

function isLikelyNetworkFailureMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('network request failed') ||
    lower.includes('failed to fetch') ||
    lower.includes('load failed') ||
    lower.includes('networkerror') ||
    lower.includes('internet connection appears to be offline') ||
    lower.includes('connection appears to be offline') ||
    lower.includes('not connected to the internet') ||
    lower.includes('timed out') ||
    lower.includes('timeout')
  );
}

export function safeAuthErrorMessage(error: unknown, fallback: string): string {
  const message = trimmedRawMessage(error);
  const status = authErrorStatus(error);

  if (status === 429) {
    return 'Too many attempts. Wait a few minutes, then try again.';
  }
  if (status === 0 || isLikelyNetworkFailureMessage(message)) {
    return "Couldn't reach Vibely. Check your connection and try again.";
  }
  if (status !== null && TEMPORARY_AUTH_STATUSES.has(status)) {
    return 'The authentication service is temporarily unavailable. Try again in a moment.';
  }
  if (isRawAuthResponseMessage(message) || isJsonLikeAuthMessage(message) || isMachineAuthCodeMessage(message)) {
    return fallback;
  }
  if (message && message.length <= 180) {
    return message;
  }
  return fallback;
}

export function mapPhoneOtpSendError(error: unknown): string {
  const message = trimmedRawMessage(error);
  const lower = message.toLowerCase();
  const status = authErrorStatus(error);

  if (status === 429 || /rate|too many|flood|429/i.test(lower)) {
    return 'Too many attempts. Wait a few minutes, then try again.';
  }
  if (status === 0 || isLikelyNetworkFailureMessage(message)) {
    return "Couldn't reach Vibely. Check your connection and try again.";
  }
  if ((status !== null && TEMPORARY_AUTH_STATUSES.has(status)) || isRawAuthResponseMessage(message)) {
    return 'SMS sign-in is temporarily unavailable. Try again in a moment, or use email instead.';
  }
  if (/phone.*not.*enabled|sms.*not|provider|not supported/i.test(message)) {
    return "Phone sign-in isn't available on this app build. Try email or another method, or contact support.";
  }
  if (/invalid.*phone|malformed|format|e\.164/i.test(message)) {
    return "That number doesn't look valid for the selected country. Use digits only and skip the leading 0.";
  }
  if ((/otp|sms|send|text/i.test(lower) && /fail|error|unable/i.test(lower)) || /confirmation/i.test(lower)) {
    return "We couldn't send a code to this number. Check the number and your connection, then try again.";
  }
  return safeAuthErrorMessage(error, "Couldn't send the code. Try again.");
}

export function authErrorDebugInfo(error: unknown): {
  name: string | null;
  code: string | null;
  status: number | null;
  messagePreview: string | null;
} {
  const record = asRecord(error);
  const message = trimmedRawMessage(error);
  const status = authErrorStatus(error);
  const messagePreview = isRawAuthResponseMessage(message)
    ? status === null
      ? '<raw auth response>'
      : `<raw auth response ${status}>`
    : isJsonLikeAuthMessage(message)
      ? status === null
        ? '<auth error payload>'
        : `<auth error payload ${status}>`
    : message
      ? message.slice(0, 140)
      : null;

  return {
    name: stringProp(record, 'name'),
    code: stringProp(record, 'code'),
    status,
    messagePreview,
  };
}

export function authIdentityMethodLabel(method: AuthIdentityLinkingMethod): string {
  if (method === 'google') return 'Google';
  if (method === 'apple') return 'Apple';
  return method;
}

export function safeIdentityLinkingErrorMessage(
  error: unknown,
  method: AuthIdentityLinkingMethod,
  fallback: string,
): string {
  const mapped = mapIdentityLinkingError(error, method);
  if (mapped === `Failed to link ${method}. Please try again.`) {
    return safeAuthErrorMessage(error, fallback);
  }

  const safeMapped = safeAuthErrorMessage({ message: mapped }, fallback);
  return safeMapped === fallback ? safeAuthErrorMessage(error, fallback) : safeMapped;
}
