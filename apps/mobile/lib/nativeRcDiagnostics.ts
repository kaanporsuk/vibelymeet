/**
 * Narrow release-candidate diagnostics for native: Sentry breadcrumbs with stable
 * category names so RC issues can be filtered without broad PII.
 *
 * Do not log raw emails, tokens, or deep-link query strings here.
 */

import * as Sentry from '@sentry/react-native';
import { sanitizeNativeDiagnosticRecord } from '@/lib/nativeDiagnosticsPayload';

/** Stable category namespaces — match `apps/mobile/docs/native-release-validation.md`. */
export const RC_CATEGORY = {
  authBoot: 'rc.auth.boot',
  authEntryState: 'rc.auth.entry_state',
  authRedirectUrl: 'rc.auth.redirect_url',
  notifDeepLink: 'rc.notif.deep_link',
  onboardingFinalize: 'rc.onboarding.finalize',
  readyGate: 'rc.ready_gate',
  lobbyDateEntry: 'rc.lobby.date_entry',
  /** `/date` mount → Daily join — single-flight pipeline (control plane). */
  videoDateEntry: 'rc.video_date.entry',
} as const;

export function rcBreadcrumb(
  category: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  try {
    const safeData = sanitizeNativeDiagnosticRecord(data);
    Sentry.addBreadcrumb({
      category,
      message,
      level: 'info',
      data: safeData as Record<string, unknown> | undefined,
    });
  } catch {
    /* noop: diagnostic helper must never throw */
  }
}
