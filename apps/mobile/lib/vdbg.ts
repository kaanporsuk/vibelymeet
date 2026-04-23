import * as Sentry from '@sentry/react-native';

/**
 * Native video-date / lobby diagnostics: console + Sentry breadcrumb (`category: vdbg`).
 * Same contract as the previous per-file helpers — single place to keep keys and payload shape stable.
 */
export function vdbg(message: string, data?: Record<string, unknown>): void {
  const payload = { ...(data ?? {}), ts: new Date().toISOString() };
  console.log(`[VDBG] ${message}`, payload);
  Sentry.addBreadcrumb({
    category: 'vdbg',
    message,
    level: 'info',
    data: payload,
  });
}

export function vdbgRedirect(target: unknown, reason: string, data?: Record<string, unknown>): void {
  vdbg('date_redirect', { target, reason, ...(data ?? {}) });
}
