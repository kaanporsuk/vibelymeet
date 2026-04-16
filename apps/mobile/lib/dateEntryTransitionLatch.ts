/**
 * Mobile-only, session-scoped latch to prevent `/date/:id` → `/ready/:id` bounce
 * during the narrow window after `both_ready` while registrations still show `in_ready_gate`.
 *
 * This is intentionally tiny (module-level Map + TTL), not a global state system.
 */
const DEFAULT_TTL_MS = 25_000;
const latch = new Map<string, number>(); // sessionId -> expiresAtMs

function nowMs(): number {
  return Date.now();
}

function pruneExpired(t: number) {
  for (const [sid, expiresAt] of latch) {
    if (expiresAt <= t) latch.delete(sid);
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
  const exp = latch.get(sessionId);
  if (!exp) return false;
  if (exp <= t) {
    latch.delete(sessionId);
    return false;
  }
  return true;
}

export function clearDateEntryTransition(sessionId: string) {
  if (!sessionId) return;
  latch.delete(sessionId);
}

