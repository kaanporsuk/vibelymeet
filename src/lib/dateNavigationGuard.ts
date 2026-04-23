import { markVideoDateEntryPipelineStarted } from "@/lib/dateEntryTransitionLatch";

export type DateNavigationSuppressReason = "already_on_same_date_route" | "recent_duplicate_navigation";

const DUPLICATE_NAVIGATION_MS = 15_000;

let lastDateNavigation: { sessionId: string; ts: number } | null = null;

function activeDateSessionIdFromPath(pathname: string | null | undefined): string | null {
  const match = pathname?.match(/^\/date\/([^/]+)/);
  return match?.[1] ?? null;
}

export function claimDateNavigation(
  sessionId: string,
  pathname: string | null | undefined
): { ok: true } | { ok: false; reason: DateNavigationSuppressReason } {
  if (!sessionId) return { ok: false, reason: "recent_duplicate_navigation" };
  if (activeDateSessionIdFromPath(pathname) === sessionId) {
    return { ok: false, reason: "already_on_same_date_route" };
  }

  const now = Date.now();
  if (lastDateNavigation?.sessionId === sessionId && now - lastDateNavigation.ts < DUPLICATE_NAVIGATION_MS) {
    return { ok: false, reason: "recent_duplicate_navigation" };
  }

  lastDateNavigation = { sessionId, ts: now };
  markVideoDateEntryPipelineStarted(sessionId);
  return { ok: true };
}
