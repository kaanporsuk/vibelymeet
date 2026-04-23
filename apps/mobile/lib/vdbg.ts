import * as Sentry from '@sentry/react-native';
import { sanitizeNativeDiagnosticRecord } from '@/lib/nativeDiagnosticsPayload';

/**
 * Native video-date / lobby diagnostics: debug-only console + Sentry breadcrumb (`category: vdbg`).
 * Production can opt in with EXPO_PUBLIC_VDBG_ENABLED=true for incident investigation.
 */
const VDBG_ENABLED = __DEV__ || process.env.EXPO_PUBLIC_VDBG_ENABLED === 'true';

export function isVdbgEnabled(): boolean {
  return VDBG_ENABLED;
}

export function vdbg(message: string, data?: Record<string, unknown>): void {
  if (!VDBG_ENABLED) return;
  const payload = sanitizeNativeDiagnosticRecord({ ...(data ?? {}), ts: new Date().toISOString() });
  console.log(`[VDBG] ${message}`, payload);
  Sentry.addBreadcrumb({
    category: 'vdbg',
    message,
    level: 'info',
    data: payload as Record<string, unknown> | undefined,
  });
}

export function vdbgRedirect(target: unknown, reason: string, data?: Record<string, unknown>): void {
  vdbg('date_redirect', { target, reason, ...(data ?? {}) });
}
