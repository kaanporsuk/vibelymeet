/**
 * Floor between mark_lobby_foreground RPC calls per user+event.
 *
 * The lobby foreground effects (web EventLobby, native lobby route) stamp once on
 * every effect re-run plus a 30s interval. Effect dependencies (route, queue
 * status, app state) can churn many times per second, which produced ~2 RPC
 * calls/second per open lobby client in the 2026-06-12 acceptance run (260
 * event_loop_observability_events rows from one short run). The stamp has no
 * server-side freshness-window reader (verified live 2026-06-12: writers only —
 * mark_lobby_foreground and the swipe browsing-stamp base), so suppressing
 * bursts is safe; the periodic interval remains the cadence owner.
 *
 * The map is module-scope so the floor survives effect re-runs AND component
 * remounts within the same JS runtime.
 */
export const LOBBY_FOREGROUND_STAMP_FLOOR_MS = 25_000;

const lastStampAtMs = new Map<string, number>();

export function lobbyForegroundStampKey(userId: string, eventId: string): string {
  return `${userId}:${eventId}`;
}

/**
 * Returns true (and records the attempt) when enough time has passed since the
 * last allowed stamp for this user+event; false to skip this burst.
 */
export function shouldStampLobbyForeground(key: string, nowMs: number = Date.now()): boolean {
  const last = lastStampAtMs.get(key);
  if (last != null && nowMs - last < LOBBY_FOREGROUND_STAMP_FLOOR_MS) {
    return false;
  }
  lastStampAtMs.set(key, nowMs);
  return true;
}

/** Test seam. */
export function resetLobbyForegroundStampThrottle(): void {
  lastStampAtMs.clear();
}
