/**
 * Bounded adaptive delay for convergence-style loops (queue drain polling, reconnect sync polling).
 *
 * Same timing curve used by web `useReconnection` and native lobby queue-drain / video-date reconnect
 * sync — **do not change thresholds without explicit product parity review** (web is source of truth).
 */
export function nextConvergenceDelayMs(elapsedMs: number): number {
  if (elapsedMs < 5_000) return 1_000;
  if (elapsedMs < 20_000) return 3_000;
  return 7_000;
}
