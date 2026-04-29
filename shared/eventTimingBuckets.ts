/**
 * Product-grade event timing taxonomy for dashboard rails and time filters (web + native).
 * Headings: Live Now -> About to Start -> Later Today -> Tomorrow -> This Weekend -> Next Week -> Upcoming.
 */

export type EventTimingHeading =
  | "Live Now"
  | "About to Start"
  | "Later Today"
  | "Tomorrow"
  | "This Weekend"
  | "Next Week"
  | "Upcoming";

export const EVENT_TIMING_TWO_HOURS_MS = 2 * 60 * 60 * 1000;

function startOfCalendarDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
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
 * Upcoming Saturday 00:00 through Sunday 23:59:59.999 in local time,
 * matching existing Events screen weekend logic without inheriting `now`'s clock time.
 */
export function isInUpcomingWeekendWindow(eventStart: Date, now: Date): boolean {
  const dow = now.getDay();
  const sat = new Date(now);
  sat.setDate(now.getDate() + (6 - dow));
  sat.setHours(0, 0, 0, 0);
  const sun = new Date(sat);
  sun.setDate(sat.getDate() + 1);
  sun.setHours(23, 59, 59, 999);
  return eventStart >= sat && eventStart <= sun;
}

export function isWithinRollingSevenDays(eventStart: Date, now: Date): boolean {
  const ms = eventStart.getTime() - now.getTime();
  return ms > 0 && ms <= 7 * 24 * 60 * 60 * 1000;
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

  if (nowMs >= endMs) {
    return "Upcoming";
  }

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

  const msUntilStart = startMs - nowMs;
  if (msUntilStart > 0 && msUntilStart <= EVENT_TIMING_TWO_HOURS_MS) {
    return "About to Start";
  }

  if (isSameCalendarDay(input.eventStart, now) && msUntilStart > EVENT_TIMING_TWO_HOURS_MS) {
    return "Later Today";
  }

  if (isEventTomorrow(input.eventStart, now)) {
    return "Tomorrow";
  }

  if (isInUpcomingWeekendWindow(input.eventStart, now)) {
    return "This Weekend";
  }

  if (isWithinRollingSevenDays(input.eventStart, now)) {
    return "Next Week";
  }

  return "Upcoming";
}

export type DashboardTimingEvent = {
  eventDate: Date;
  duration_minutes?: number | null;
  status?: string | null;
};

function isNotEndedOrIsLive(e: DashboardTimingEvent, now: Date): boolean {
  if (e.status === "live") return true;
  const durationMinutes = e.duration_minutes ?? 60;
  const endMs = e.eventDate.getTime() + Math.max(1, durationMinutes) * 60 * 1000;
  return endMs > now.getTime();
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
    .filter((e) => e.status !== "cancelled")
    .filter((e) => isNotEndedOrIsLive(e, n))
    .sort((a, b) => a.eventDate.getTime() - b.eventDate.getTime())[0];
  if (!first) return "Upcoming";
  return classifyEventTimingHeading({
    eventStart: first.eventDate,
    durationMinutes: first.duration_minutes,
    now: n,
    statusIsLive: first.status === "live",
  });
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
  const end = new Date(now);
  end.setDate(now.getDate() + (7 - now.getDay()));
  return eventStart.getTime() <= end.getTime();
}
