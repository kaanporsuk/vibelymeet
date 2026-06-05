import { markVideoDateEntryPipelineStarted } from "@/lib/dateEntryTransitionLatch";

export type DateNavigationSuppressReason =
  | "already_on_same_date_route"
  | "recent_duplicate_navigation"
  | "recent_manual_exit";

export type DateNavigationClaimOptions = {
  force?: boolean;
};

const DUPLICATE_NAVIGATION_MS = 15_000;
const MANUAL_EXIT_SUPPRESSION_MS = 5 * 60_000;
const MANUAL_EXIT_STORAGE_KEY = "vibely:manual-video-date-exits:v1";

let lastDateNavigation: { sessionId: string; ts: number } | null = null;
let manualExitSuppressions = new Map<string, number>();

function activeDateSessionIdFromPath(pathname: string | null | undefined): string | null {
  const match = pathname?.match(/^\/date\/([^/]+)/);
  return match?.[1] ?? null;
}

function nowMs(): number {
  return Date.now();
}

function readStoredManualExitSuppressions(): Map<string, number> {
  if (typeof window === "undefined") return manualExitSuppressions;
  try {
    const raw = window.sessionStorage.getItem(MANUAL_EXIT_STORAGE_KEY);
    if (!raw) return manualExitSuppressions;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next = new Map<string, number>();
    const now = nowMs();
    for (const [sessionId, expiresAt] of Object.entries(parsed)) {
      if (typeof expiresAt === "number" && expiresAt > now) next.set(sessionId, expiresAt);
    }
    manualExitSuppressions = next;
  } catch {
    // A corrupt sessionStorage value should not break navigation.
  }
  return manualExitSuppressions;
}

function writeStoredManualExitSuppressions() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      MANUAL_EXIT_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(manualExitSuppressions)),
    );
  } catch {
    // Storage is best-effort; the in-memory map still protects this tab.
  }
}

function pruneManualExitSuppressions() {
  const now = nowMs();
  let changed = false;
  for (const [sessionId, expiresAt] of readStoredManualExitSuppressions()) {
    if (expiresAt <= now) {
      manualExitSuppressions.delete(sessionId);
      changed = true;
    }
  }
  if (changed) writeStoredManualExitSuppressions();
}

export function suppressDateNavigationAfterManualExit(
  sessionId: string,
  ttlMs: number = MANUAL_EXIT_SUPPRESSION_MS,
) {
  if (!sessionId) return;
  pruneManualExitSuppressions();
  manualExitSuppressions.set(sessionId, nowMs() + Math.max(5_000, ttlMs));
  writeStoredManualExitSuppressions();
}

export function isDateNavigationSuppressedAfterManualExit(sessionId: string): boolean {
  if (!sessionId) return false;
  pruneManualExitSuppressions();
  const expiresAt = manualExitSuppressions.get(sessionId);
  if (!expiresAt) return false;
  if (expiresAt <= nowMs()) {
    manualExitSuppressions.delete(sessionId);
    writeStoredManualExitSuppressions();
    return false;
  }
  return true;
}

export function claimDateNavigation(
  sessionId: string,
  pathname: string | null | undefined,
  options: DateNavigationClaimOptions = {},
): { ok: true } | { ok: false; reason: DateNavigationSuppressReason } {
  if (!sessionId) return { ok: false, reason: "recent_duplicate_navigation" };
  const force = options.force === true;

  if (activeDateSessionIdFromPath(pathname) === sessionId) {
    return { ok: false, reason: "already_on_same_date_route" };
  }

  if (!force && isDateNavigationSuppressedAfterManualExit(sessionId)) {
    return { ok: false, reason: "recent_manual_exit" };
  }

  const now = nowMs();
  if (
    !force &&
    lastDateNavigation?.sessionId === sessionId &&
    now - lastDateNavigation.ts < DUPLICATE_NAVIGATION_MS
  ) {
    return { ok: false, reason: "recent_duplicate_navigation" };
  }

  lastDateNavigation = { sessionId, ts: now };
  markVideoDateEntryPipelineStarted(sessionId);
  return { ok: true };
}
