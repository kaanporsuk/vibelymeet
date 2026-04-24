/**
 * Cross-route timestamps for native video date launch (Ready Gate → /date → Daily join).
 * No PII beyond patterns already used in RC_CATEGORY / video-date breadcrumbs.
 */

import * as Sentry from '@sentry/react-native';
import { isVdbgEnabled, vdbg } from '@/lib/vdbg';
import { sanitizeNativeDiagnosticRecord } from '@/lib/nativeDiagnosticsPayload';

let pendingLaunchT0Ms: number | null = null;
let pendingSource: string | null = null;

/** Call immediately before navigating to `/date/[id]` from Ready Gate (standalone or lobby overlay). */
export function markNativeVideoDateLaunchIntent(source: string) {
  pendingLaunchT0Ms = Date.now();
  pendingSource = source;
}

/** `/date/[id]` mount: returns [t0, source] once, then clears. */
export function consumeNativeVideoDateLaunchIntent(): { t0Ms: number; source: string } | null {
  if (pendingLaunchT0Ms == null) return null;
  const out = { t0Ms: pendingLaunchT0Ms, source: pendingSource ?? 'unknown' };
  pendingLaunchT0Ms = null;
  pendingSource = null;
  return out;
}

export function videoDateLaunchBreadcrumb(
  step: string,
  data?: Record<string, string | number | boolean | null | undefined>
) {
  const safe = data ? (sanitizeNativeDiagnosticRecord(data as Record<string, unknown>) as Record<string, unknown>) : undefined;
  Sentry.addBreadcrumb({
    category: 'video-date-launch',
    message: step,
    level: 'info',
    data: safe,
  });
  if (isVdbgEnabled()) {
    vdbg('video_date_launch', { step, ...(data ?? {}) });
  }
}

export function videoDateLaunchDurationMs(sinceT0Ms: number | null): number | null {
  if (sinceT0Ms == null) return null;
  return Math.max(0, Date.now() - sinceT0Ms);
}
