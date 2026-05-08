/**
 * Product-grade event timing taxonomy for dashboard rails and time filters (web + native).
 * Headings: Live Now -> About to Start -> Later Today -> Tomorrow -> This Weekend -> This Week -> Next Week -> Upcoming -> Recently Ended.
 */

export type EventTimingHeading =
  | "Live Now"
  | "About to Start"
  | "Later Today"
  | "Tomorrow"
  | "This Weekend"
  | "This Week"
  | "Next Week"
  | "Upcoming"
  | "Recently Ended";

export const EVENT_TIMING_TWO_HOURS_MS = 2 * 60 * 60 * 1000;

function startOfCalendarDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfLocalWeek(d: Date): Date {
  const start = startOfCalendarDay(d);
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  return start;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Event start is the next calendar day after `now` in local time. */
export function isEventTomorrow(eventStart: Date, now: Date): boolean {
  const tomorrow = startOfCalendarDay(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return isSameCalendarDay(eventStart, tomorrow);
}

/**
 * Current/upcoming Saturday 00:00 through Sunday 23:59:59.999 in local time,
 * without inheriting `now`'s clock time.
 */
export function isInUpcomingWeekendWindow(eventStart: Date, now: Date): boolean {
  const weekStart = startOfLocalWeek(now);
  const sat = addDays(weekStart, 5);
  sat.setHours(0, 0, 0, 0);
  const sun = addDays(sat, 1);
  sun.setHours(23, 59, 59, 999);
  return eventStart >= sat && eventStart <= sun;
}

export function isInCurrentLocalWeek(eventStart: Date, now: Date): boolean {
  const weekStart = startOfLocalWeek(now);
  const nextWeekStart = addDays(weekStart, 7);
  return eventStart >= weekStart && eventStart < nextWeekStart;
}

export function isInNextLocalWeek(eventStart: Date, now: Date): boolean {
  const nextWeekStart = addDays(startOfLocalWeek(now), 7);
  const followingWeekStart = addDays(nextWeekStart, 7);
  return eventStart >= nextWeekStart && eventStart < followingWeekStart;
}

export function isEventLiveAt(params: {
  eventStart: Date;
  durationMinutes?: number | null;
  now: Date;
  /** Server/client may mark live before/after the strict local window. */
  statusIsLive?: boolean;
}): boolean {
  if (params.statusIsLive === true) return true;
  const duration = params.durationMinutes ?? 60;
  const startMs = params.eventStart.getTime();
  const endMs = startMs + Math.max(1, duration) * 60 * 1000;
  const nowMs = params.now.getTime();
  return nowMs >= startMs && nowMs < endMs;
}

/**
 * Single-event classification for rails and copy. Buckets are mutually exclusive by priority.
 */
export function classifyEventTimingHeading(input: {
  eventStart: Date;
  durationMinutes?: number | null;
  now?: Date;
  statusIsLive?: boolean;
}): EventTimingHeading {
  const now = input.now ?? new Date();
  const durationMinutes = input.durationMinutes ?? 60;
  const startMs = input.eventStart.getTime();
  const endMs = startMs + Math.max(1, durationMinutes) * 60 * 1000;
  const nowMs = now.getTime();

  if (
    isEventLiveAt({
      eventStart: input.eventStart,
      durationMinutes,
      now,
      statusIsLive: input.statusIsLive,
    })
  ) {
    return "Live Now";
  }

  if (nowMs >= endMs) {
    return "Upcoming";
  }

  const msUntilStart = startMs - nowMs;
  if (msUntilStart > 0 && msUntilStart <= EVENT_TIMING_TWO_HOURS_MS) {
    return "About to Start";
  }

  if (isSameCalendarDay(input.eventStart, now) && msUntilStart > EVENT_TIMING_TWO_HOURS_MS) {
    return "Later Today";
  }

  const isThisWeekend = isInUpcomingWeekendWindow(input.eventStart, now);

  if (isEventTomorrow(input.eventStart, now) && !isThisWeekend) {
    return "Tomorrow";
  }

  if (isThisWeekend) {
    return "This Weekend";
  }

  if (isInCurrentLocalWeek(input.eventStart, now)) {
    return "This Week";
  }

  if (isInNextLocalWeek(input.eventStart, now)) {
    return "Next Week";
  }

  return "Upcoming";
}

export type DashboardTimingEvent = {
  eventDate: Date;
  duration_minutes?: number | null;
  status?: string | null;
};

function normalizeEventStatus(status: string | null | undefined): string {
  return (status ?? "").toLowerCase();
}

function hasValidDashboardEventStart(e: DashboardTimingEvent): boolean {
  return Number.isFinite(e.eventDate.getTime());
}

function dashboardEventEndMs(e: DashboardTimingEvent): number {
  const durationMinutes = e.duration_minutes ?? 60;
  return e.eventDate.getTime() + Math.max(1, durationMinutes) * 60 * 1000;
}

function isDashboardEventSuppressed(e: DashboardTimingEvent): boolean {
  if (!hasValidDashboardEventStart(e)) return true;
  const status = normalizeEventStatus(e.status);
  return status === "cancelled" || status === "draft" || status === "archived";
}

function hasDashboardEventEndedByTime(e: DashboardTimingEvent, now: Date): boolean {
  const endMs = dashboardEventEndMs(e);
  return Number.isFinite(endMs) && now.getTime() >= endMs;
}

function isDashboardEventEnded(e: DashboardTimingEvent, now: Date): boolean {
  const status = normalizeEventStatus(e.status);
  if (status === "ended" || status === "completed") return true;
  return hasDashboardEventEndedByTime(e, now);
}

function isDashboardEventLive(e: DashboardTimingEvent, now: Date): boolean {
  return isEventLiveAt({
    eventStart: e.eventDate,
    durationMinutes: e.duration_minutes,
    now,
    statusIsLive: false,
  });
}

function isDashboardEventActionable(e: DashboardTimingEvent, now: Date): boolean {
  if (isDashboardEventSuppressed(e)) return false;
  return isDashboardEventLive(e, now) || !isDashboardEventEnded(e, now);
}

/**
 * Dashboard events rail: earliest upcoming or live event, with cancelled and fully ended events excluded.
 */
export function getDashboardEventRailHeading(
  events: DashboardTimingEvent[],
  now?: Date,
): EventTimingHeading {
  const n = now ?? new Date();
  const first = [...events]
    .filter((e) => isDashboardEventActionable(e, n))
    .sort((a, b) => a.eventDate.getTime() - b.eventDate.getTime())[0];
  if (!first) {
    return events.some((e) => !isDashboardEventSuppressed(e) && isDashboardEventEnded(e, n))
      ? "Recently Ended"
      : "Upcoming";
  }
  return classifyEventTimingHeading({
    eventStart: first.eventDate,
    durationMinutes: first.duration_minutes,
    now: n,
    statusIsLive: isDashboardEventLive(first, n),
  });
}

/**
 * Bottom dashboard pulse copy. Counts only actionable live/future events, never ended grace rows.
 */
export function getDashboardAmbientEventLine(
  events: DashboardTimingEvent[],
  now?: Date,
): string | null {
  const n = now ?? new Date();
  const actionable = events.filter((e) => isDashboardEventActionable(e, n));
  const liveCount = actionable.filter((e) => isDashboardEventLive(e, n)).length;

  if (liveCount > 0) {
    return `${liveCount} event${liveCount === 1 ? "" : "s"} live now`;
  }

  const futureEvents = actionable.filter((e) => {
    const startMs = e.eventDate.getTime();
    return Number.isFinite(startMs) && startMs > n.getTime();
  });
  if (futureEvents.length === 0) return null;

  const currentWeekCount = futureEvents.filter((e) => isInCurrentLocalWeek(e.eventDate, n)).length;
  if (currentWeekCount > 0) {
    return `${currentWeekCount} event${currentWeekCount === 1 ? "" : "s"} coming up this week`;
  }

  return `${futureEvents.length} upcoming event${futureEvents.length === 1 ? "" : "s"}`;
}

/**
 * Events filter chip "Later Today" and legacy saved "Tonight":
 * same local calendar day, and the event has not ended yet.
 */
export function matchesLaterTodayFilter(
  eventStart: Date,
  now: Date,
  durationMinutes?: number | null,
  statusIsLive?: boolean,
): boolean {
  if (!isSameCalendarDay(eventStart, now)) return false;
  if (statusIsLive === true) return true;
  const duration = durationMinutes ?? 60;
  const endMs = eventStart.getTime() + Math.max(1, duration) * 60 * 1000;
  return now.getTime() < endMs;
}

export function matchesThisWeekendFilter(eventStart: Date, now: Date): boolean {
  return isInUpcomingWeekendWindow(eventStart, now);
}

export function matchesThisWeekTimeFilter(eventStart: Date, now: Date): boolean {
  if (eventStart.getTime() < now.getTime()) return false;
  return (
    isInCurrentLocalWeek(eventStart, now) &&
    !isSameCalendarDay(eventStart, now) &&
    !isEventTomorrow(eventStart, now) &&
    !isInUpcomingWeekendWindow(eventStart, now)
  );
}
