/**
 * Web session-scoped latch to prevent `/date/:id` -> lobby bounce during the
 * narrow window after Ready Gate succeeds while registration rows still read
 * `in_ready_gate`.
 *
 * This is intentionally small routing state, not business-state ownership.
 */
const DEFAULT_TTL_MS = 25_000;
export const VIDEO_DATE_ENTRY_PIPELINE_TTL_MS = 180_000;

const latch = new Map<string, number>();

function nowMs(): number {
  return Date.now();
}

function pruneExpired(t: number) {
  for (const [sessionId, expiresAt] of latch) {
    if (expiresAt <= t) latch.delete(sessionId);
  }
}

export function markDateEntryTransition(sessionId: string, ttlMs: number = DEFAULT_TTL_MS) {
  if (!sessionId) return;
  const t = nowMs();
  pruneExpired(t);
  latch.set(sessionId, t + Math.max(1_000, ttlMs));
}

export function isDateEntryTransitionActive(sessionId: string): boolean {
  if (!sessionId) return false;
  const t = nowMs();
  pruneExpired(t);
  const expiresAt = latch.get(sessionId);
  if (!expiresAt) return false;
  if (expiresAt <= t) {
    latch.delete(sessionId);
    return false;
  }
  return true;
}

export function clearDateEntryTransition(sessionId: string) {
  if (!sessionId) return;
  latch.delete(sessionId);
}

export function markVideoDateEntryPipelineStarted(sessionId: string) {
  markDateEntryTransition(sessionId, VIDEO_DATE_ENTRY_PIPELINE_TTL_MS);
}
