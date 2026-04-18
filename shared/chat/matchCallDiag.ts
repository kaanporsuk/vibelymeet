/**
 * Dev-only structured breadcrumbs for match-call client debugging (Wave 4).
 * Safe to call from web (Vite) and React Native; no-ops in production builds unless __DEV__.
 */
function isDiagEnabled(): boolean {
  try {
    const g = globalThis as { __DEV__?: boolean };
    if (g.__DEV__ === true) return true;
  } catch {
    /* ignore */
  }
  try {
    return Boolean(
      typeof import.meta !== "undefined" &&
        (import.meta as { env?: { DEV?: boolean } }).env?.DEV,
    );
  } catch {
    return false;
  }
}

/** Single-line JSON for log filters: `[match_call_diag] {"event":"..."}` */
export function logMatchCallDiag(event: string, fields: Record<string, unknown> = {}): void {
  if (!isDiagEnabled()) return;
  const line = JSON.stringify({ event: `match_call_client_${event}`, ...fields });
  console.info(`[match_call_diag] ${line}`);
}
