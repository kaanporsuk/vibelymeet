/**
 * Bounded adaptive delay for convergence-style reconnect sync loops.
 *
 * Same timing curve used by web `useReconnection` and native video-date reconnect sync.
 * Do not change thresholds without explicit product parity review.
 */
export function nextConvergenceDelayMs(elapsedMs: number): number {
  if (elapsedMs < 5_000) return 1_000;
  if (elapsedMs < 20_000) return 3_000;
  return 7_000;
}
