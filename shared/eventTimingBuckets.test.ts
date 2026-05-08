import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyEventTimingHeading,
  getDashboardAmbientEventLine,
  getDashboardEventRailHeading,
  matchesLaterTodayFilter,
  matchesThisWeekendFilter,
  matchesThisWeekTimeFilter,
  type DashboardTimingEvent,
} from "./eventTimingBuckets";

function dashboardEvent(
  eventDate: string,
  status: string | null = "upcoming",
  durationMinutes = 60,
): DashboardTimingEvent {
  return {
    eventDate: new Date(eventDate),
    duration_minutes: durationMinutes,
    status,
  };
}

test("classifies in-progress and soon events before same-day later events", () => {
  const now = new Date("2026-04-30T12:00:00");

  assert.equal(
    classifyEventTimingHeading({
      eventStart: new Date("2026-04-30T11:30:00"),
      durationMinutes: 90,
      now,
    }),
    "Live Now",
  );

  assert.equal(
    classifyEventTimingHeading({
      eventStart: new Date("2026-04-30T13:30:00"),
      durationMinutes: 60,
      now,
    }),
    "About to Start",
  );

  assert.equal(
    classifyEventTimingHeading({
      eventStart: new Date("2026-04-30T19:00:00"),
      durationMinutes: 60,
      now,
    }),
    "Later Today",
  );
});

test("uses explicit this-week and next-week calendar buckets", () => {
  const mondayNoon = new Date("2026-05-04T12:00:00");

  assert.equal(
    classifyEventTimingHeading({
      eventStart: new Date("2026-05-06T19:00:00"),
      durationMinutes: 60,
      now: mondayNoon,
    }),
    "This Week",
  );

  assert.equal(
    classifyEventTimingHeading({
      eventStart: new Date("2026-05-11T19:00:00"),
      durationMinutes: 60,
      now: mondayNoon,
    }),
    "Next Week",
  );
});

test("keeps later-today filter true while the event is still active", () => {
  const now = new Date("2026-04-30T12:00:00");

  assert.equal(matchesLaterTodayFilter(new Date("2026-04-30T11:30:00"), now, 90), true);
  assert.equal(matchesLaterTodayFilter(new Date("2026-04-30T10:00:00"), now, 60), false);
  assert.equal(matchesLaterTodayFilter(new Date("2026-05-01T10:00:00"), now, 60), false);
});

test("uses full local Saturday-Sunday bounds for weekend filtering", () => {
  const fridayAfternoon = new Date("2026-05-01T15:00:00");

  assert.equal(
    classifyEventTimingHeading({
      eventStart: new Date("2026-05-02T09:00:00"),
      durationMinutes: 60,
      now: fridayAfternoon,
    }),
    "This Weekend",
  );
  assert.equal(matchesThisWeekendFilter(new Date("2026-05-02T09:00:00"), fridayAfternoon), true);
  assert.equal(matchesThisWeekendFilter(new Date("2026-05-03T22:00:00"), fridayAfternoon), true);
  assert.equal(matchesThisWeekendFilter(new Date("2026-05-04T09:00:00"), fridayAfternoon), false);
});

test("dashboard heading uses earliest eligible live or upcoming event", () => {
  const now = new Date("2026-04-30T12:00:00");

  assert.equal(
    getDashboardEventRailHeading(
      [
        dashboardEvent("2026-05-03T19:00:00"),
        dashboardEvent("2026-04-30T11:45:00", "live"),
      ],
      now,
    ),
    "Live Now",
  );
});

test("dashboard heading does not call ended grace-window rows upcoming", () => {
  const now = new Date("2026-04-30T12:00:00");

  assert.equal(
    getDashboardEventRailHeading(
      [dashboardEvent("2026-04-30T10:00:00", "ended")],
      now,
    ),
    "Recently Ended",
  );

  assert.equal(
    getDashboardAmbientEventLine(
      [dashboardEvent("2026-04-30T10:00:00", "ended")],
      now,
    ),
    null,
  );
});

test("dashboard timing treats stale upcoming rows past scheduled end as ended", () => {
  const now = new Date("2026-04-30T12:00:00");
  const events = [dashboardEvent("2026-04-30T10:00:00")];

  assert.equal(getDashboardEventRailHeading(events, now), "Recently Ended");
  assert.equal(getDashboardAmbientEventLine(events, now), null);
});

test("dashboard ambient line counts current-week future events", () => {
  const mondayNoon = new Date("2026-05-04T12:00:00");

  assert.equal(
    getDashboardAmbientEventLine(
      [dashboardEvent("2026-05-06T19:00:00")],
      mondayNoon,
    ),
    "1 event coming up this week",
  );
});

test("dashboard ambient line counts future events outside the current week", () => {
  const mondayNoon = new Date("2026-05-04T12:00:00");

  assert.equal(
    getDashboardAmbientEventLine(
      [
        dashboardEvent("2026-05-18T19:00:00"),
        dashboardEvent("2026-05-19T19:00:00"),
      ],
      mondayNoon,
    ),
    "2 upcoming events",
  );
});

test("dashboard ambient line prioritizes live events", () => {
  const now = new Date("2026-04-30T12:00:00");

  assert.equal(
    getDashboardAmbientEventLine(
      [
        dashboardEvent("2026-04-30T11:45:00", "live"),
        dashboardEvent("2026-05-01T19:00:00"),
      ],
      now,
    ),
    "1 event live now",
  );
});

test("dashboard ambient line recognizes computed live windows without live status", () => {
  const now = new Date("2026-04-30T12:00:00");

  assert.equal(
    getDashboardEventRailHeading(
      [dashboardEvent("2026-04-30T11:45:00")],
      now,
    ),
    "Live Now",
  );
  assert.equal(
    getDashboardAmbientEventLine(
      [
        dashboardEvent("2026-04-30T11:45:00"),
        dashboardEvent("2026-04-30T11:30:00", "upcoming", 90),
      ],
      now,
    ),
    "2 events live now",
  );
});

test("dashboard timing does not keep stale live rows alive after scheduled end", () => {
  const now = new Date("2026-04-30T12:00:00");
  const events = [dashboardEvent("2026-04-30T10:00:00", "live")];

  assert.equal(getDashboardEventRailHeading(events, now), "Recently Ended");
  assert.equal(getDashboardAmbientEventLine(events, now), null);
});

test("dashboard timing does not call premature live status live before scheduled start", () => {
  const now = new Date("2026-05-04T12:00:00");
  const events = [dashboardEvent("2026-05-04T15:00:00", "live")];

  assert.equal(getDashboardEventRailHeading(events, now), "Later Today");
  assert.equal(getDashboardAmbientEventLine(events, now), "1 event coming up this week");
});

test("dashboard timing treats completed rows like ended rows", () => {
  const now = new Date("2026-04-30T12:00:00");
  const events = [dashboardEvent("2026-04-30T10:00:00", "completed")];

  assert.equal(getDashboardEventRailHeading(events, now), "Recently Ended");
  assert.equal(getDashboardAmbientEventLine(events, now), null);
});

test("dashboard ambient line excludes invalid and suppressed rows", () => {
  const now = new Date("2026-05-04T12:00:00");
  const events = [
    dashboardEvent("not-a-date"),
    dashboardEvent("2026-05-05T19:00:00", "cancelled"),
    dashboardEvent("2026-05-06T19:00:00", "draft"),
  ];

  assert.equal(getDashboardEventRailHeading(events, now), "Upcoming");
  assert.equal(getDashboardAmbientEventLine(events, now), null);
});

test("dashboard ambient line counts only current-week events when mixed with later future rows", () => {
  const mondayNoon = new Date("2026-05-04T12:00:00");

  assert.equal(
    getDashboardAmbientEventLine(
      [
        dashboardEvent("2026-05-06T19:00:00"),
        dashboardEvent("2026-05-18T19:00:00"),
      ],
      mondayNoon,
    ),
    "1 event coming up this week",
  );
});

test("this-week filter keeps only future starts later in the current local week", () => {
  const mondayNoon = new Date("2026-05-04T12:00:00");

  assert.equal(matchesThisWeekTimeFilter(new Date("2026-05-06T19:00:00"), mondayNoon), true);
  assert.equal(matchesThisWeekTimeFilter(new Date("2026-05-04T19:00:00"), mondayNoon), false);
  assert.equal(matchesThisWeekTimeFilter(new Date("2026-05-05T19:00:00"), mondayNoon), false);
  assert.equal(matchesThisWeekTimeFilter(new Date("2026-05-09T19:00:00"), mondayNoon), false);
  assert.equal(matchesThisWeekTimeFilter(new Date("2026-05-11T19:00:00"), mondayNoon), false);
});

test("classifies events beyond next week as upcoming", () => {
  const mondayNoon = new Date("2026-05-04T12:00:00");

  assert.equal(
    classifyEventTimingHeading({
      eventStart: new Date("2026-05-18T19:00:00"),
      durationMinutes: 60,
      now: mondayNoon,
    }),
    "Upcoming",
  );
});
