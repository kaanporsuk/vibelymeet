/**
 * Mobile-only, session-scoped latch to prevent `/date/:id` → `/ready/:id` bounce
 * during the window after `both_ready` while registrations still show `in_ready_gate`
 * and across app lifecycle changes (cold start, background → foreground).
 *
 * In-memory Map is the source of truth for the synchronous API; AsyncStorage
 * mirrors entries with their absolute expiry so a kill/relaunch during the
 * transition window still suppresses the bounce. Intentionally tiny — not a
 * global state system.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const DEFAULT_TTL_MS = 60_000;
const STORAGE_KEY = 'vibely_date_entry_transition_latch_v1';

const latch = new Map<string, number>(); // sessionId -> expiresAtMs
let hydrated = false;

function nowMs(): number {
  return Date.now();
}

function pruneExpired(t: number) {
  for (const [sid, expiresAt] of latch) {
    if (expiresAt <= t) latch.delete(sid);
  }
}

function persist(): void {
  try {
    const entries: Record<string, number> = {};
    for (const [sid, exp] of latch) entries[sid] = exp;
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries)).catch(() => {});
  } catch {
    /* best-effort */
  }
}

async function hydrateFromStorage(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return;
    const t = nowMs();
    for (const [sid, exp] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof sid !== 'string' || !sid) continue;
      if (typeof exp !== 'number' || !Number.isFinite(exp)) continue;
      if (exp <= t) continue;
      // Do not clobber a newer in-memory entry.
      const existing = latch.get(sid);
      if (existing && existing >= exp) continue;
      latch.set(sid, exp);
    }
  } catch {
    /* best-effort */
  }
}

// Fire-and-forget hydration on module load so cold-start reads can observe
// a still-live latch from before the relaunch.
void hydrateFromStorage();

export function markDateEntryTransition(sessionId: string, ttlMs: number = DEFAULT_TTL_MS) {
  if (!sessionId) return;
  const t = nowMs();
  pruneExpired(t);
  latch.set(sessionId, t + Math.max(1_000, ttlMs));
  persist();
}

export function isDateEntryTransitionActive(sessionId: string): boolean {
  if (!sessionId) return false;
  const t = nowMs();
  pruneExpired(t);
  const exp = latch.get(sessionId);
  if (!exp) return false;
  if (exp <= t) {
    latch.delete(sessionId);
    persist();
    return false;
  }
  return true;
}

export function clearDateEntryTransition(sessionId: string) {
  if (!sessionId) return;
  if (latch.delete(sessionId)) persist();
}
