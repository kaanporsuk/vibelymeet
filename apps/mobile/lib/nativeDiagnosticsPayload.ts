type NativeDiagnosticValue =
  | string
  | number
  | boolean
  | NativeDiagnosticValue[]
  | { [key: string]: NativeDiagnosticValue };

const SENSITIVE_KEY_PATTERN =
  /(authorization|bearer|cookie|href|idempotency|jwt|path|secret|signature|token|uri|url)/i;
const SENSITIVE_TEXT_PATTERN =
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|(?:access_token|refresh_token|token|signature|sig|jwt|apikey|api_key|secret)=([^&#\s]+)/gi;
const MEDIA_OR_PROVIDER_URL_PATTERN =
  /(?:https?:\/\/)?(?:[^/\s]+\.)?(?:bunnycdn\.com|b-cdn\.net|daily\.co|supabase\.(?:co|in)|posthog\.com|sentry\.io)(?:\/[^\s]*)?|\.(?:m3u8|mp4|mov|webm|jpg|jpeg|png|webp)(?:[?#][^\s]*)?/i;

function sanitizeString(value: string): string {
  const redacted = value
    .replace(SENSITIVE_TEXT_PATTERN, '[redacted]')
    .replace(MEDIA_OR_PROVIDER_URL_PATTERN, '[redacted-url]');
  return redacted.length > 500 ? `${redacted.slice(0, 500)}...` : redacted;
}

function sanitizeValue(key: string, value: unknown): NativeDiagnosticValue | undefined {
  if (value === null || value === undefined) return undefined;
  if (SENSITIVE_KEY_PATTERN.test(key)) return '[redacted]';

  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return sanitizeObject({
      name: value.name,
      message: value.message,
    });
  }

  if (Array.isArray(value)) {
    const items = value
      .map((item, index) => sanitizeValue(String(index), item))
      .filter((item): item is NativeDiagnosticValue => item !== undefined);
    return items.length > 0 ? items : undefined;
  }

  if (typeof value === 'object') {
    return sanitizeObject(value as Record<string, unknown>);
  }

  return undefined;
}

function sanitizeObject(value: Record<string, unknown>): { [key: string]: NativeDiagnosticValue } | undefined {
  const entries = Object.entries(value)
    .map(([key, entry]) => [key, sanitizeValue(key, entry)] as const)
    .filter((entry): entry is readonly [string, NativeDiagnosticValue] => entry[1] !== undefined);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

export function sanitizeNativeDiagnosticRecord(
  data?: Record<string, unknown>
): Record<string, NativeDiagnosticValue> | undefined {
  if (!data) return undefined;
  return sanitizeObject(data);
}
