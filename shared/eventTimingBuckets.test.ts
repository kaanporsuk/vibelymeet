import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyEventTimingHeading,
  getDashboardEventRailHeading,
  matchesLaterTodayFilter,
  matchesThisWeekendFilter,
  matchesThisWeekTimeFilter,
} from "./eventTimingBuckets";

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
        {
          eventDate: new Date("2026-05-03T19:00:00"),
          duration_minutes: 60,
          status: "upcoming",
        },
        {
          eventDate: new Date("2026-04-30T11:45:00"),
          duration_minutes: 60,
          status: "live",
        },
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
      [
        {
          eventDate: new Date("2026-04-30T10:00:00"),
          duration_minutes: 60,
          status: "ended",
        },
      ],
      now,
    ),
    "Recently Ended",
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
