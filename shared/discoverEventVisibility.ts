/**
 * Client mirror of `get_visible_events` visibility window for discover + home/dashboard.
 * Approved rule: include rows until effective scheduled end + 6 hours (use scheduled end when `ended_at` is absent).
 * Not used for invite pickers, next-registered, lobby, or other-city — those stay strict elsewhere.
 */

/** Must match server `interval '6 hours'` after effective end in get_visible_events. */
export const DISCOVER_POST_END_GRACE_HOURS = 6;

const DISCOVER_POST_END_GRACE_MS = DISCOVER_POST_END_GRACE_HOURS * 60 * 60 * 1000;

export function scheduledEventEndMs(
  eventDate: Date,
  durationMinutes: number | null | undefined
): number {
  const dm = durationMinutes ?? 60;
  return eventDate.getTime() + dm * 60 * 1000;
}

/**
 * True while the event is still in the discover/home visibility window (before effective end + 6h).
 * Excludes cancelled/draft only; `ended` computed status may still be true during the grace window.
 */
export function isWithinDiscoverHomeGraceWindow(
  args: {
    status: string | null | undefined;
    eventDate: Date;
    durationMinutes: number | null | undefined;
  },
  nowMs: number = Date.now()
): boolean {
  const st = args.status ?? "";
  if (st === "cancelled" || st === "draft") return false;
  const visibilityCapMs = scheduledEventEndMs(args.eventDate, args.durationMinutes) + DISCOVER_POST_END_GRACE_MS;
  return nowMs < visibilityCapMs;
}

/** @deprecated Prefer {@link isWithinDiscoverHomeGraceWindow} */
export const isDiscoverSurfaceEligible = isWithinDiscoverHomeGraceWindow;
