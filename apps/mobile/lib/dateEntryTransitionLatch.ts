/**
 * Mobile-only, session-scoped latch to prevent `/date/:id` → `/ready/:id` bounce
 * during the narrow window after `both_ready` while registrations still show `in_ready_gate`.
 *
 * This is intentionally tiny (module-level Map + TTL), not a global state system.
 */
import { RC_CATEGORY, rcBreadcrumb } from '@/lib/nativeRcDiagnostics';

const DEFAULT_TTL_MS = 25_000;

/** Covers full native prejoin: enter_handshake → token → Daily join (lobby closure pack used 25s; too short). */
export const VIDEO_DATE_ENTRY_PIPELINE_TTL_MS = 180_000;

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
  const ttl = Math.max(1_000, ttlMs);
  latch.set(sessionId, t + ttl);
  rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'date_entry_latch_marked', {
    session_id: sessionId,
    ttl_ms: ttl,
  });
}

export function isDateEntryTransitionActive(sessionId: string): boolean {
  if (!sessionId) return false;
  const t = nowMs();
  pruneExpired(t);
  const exp = latch.get(sessionId);
  if (!exp) return false;
  if (exp <= t) {
    latch.delete(sessionId);
    rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'date_entry_latch_expired', { session_id: sessionId });
    return false;
  }
  return true;
}

export function clearDateEntryTransition(sessionId: string) {
  if (!sessionId) return;
  if (latch.has(sessionId)) {
    rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'date_entry_latch_cleared', { session_id: sessionId });
  }
  latch.delete(sessionId);
}

/** Call when `/date/[id]` mounts so hydration cannot bounce to `/ready` during stale `in_ready_gate` ER rows. */
export function markVideoDateEntryPipelineStarted(sessionId: string) {
  markDateEntryTransition(sessionId, VIDEO_DATE_ENTRY_PIPELINE_TTL_MS);
}

