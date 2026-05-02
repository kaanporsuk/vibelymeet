import test from "node:test";
import assert from "node:assert/strict";
import { resolveEventLifecycle } from "./eventLifecycle";

const nowMs = Date.parse("2026-05-02T08:59:30.000Z");
const startsAt = "2026-05-02T08:58:00.000Z";

test("scheduled event inside scheduled window resolves live", () => {
  const result = resolveEventLifecycle({
    status: "scheduled",
    event_date: startsAt,
    duration_minutes: 15,
    nowMs,
  });

  assert.equal(result.lifecycle, "live");
  assert.equal(result.isLive, true);
  assert.equal(result.isEnded, false);
  assert.equal(result.startsAt?.toISOString(), startsAt);
  assert.equal(result.endsAt?.toISOString(), "2026-05-02T09:13:00.000Z");
  assert.equal(result.timeRemainingMs, 13.5 * 60_000);
});

test("raw live inside scheduled window resolves live", () => {
  assert.equal(
    resolveEventLifecycle({
      status: "live",
      event_date: startsAt,
      duration_minutes: 15,
      nowMs,
    }).lifecycle,
    "live",
  );
});

test("stale raw ended without ended_at inside scheduled window resolves live", () => {
  const result = resolveEventLifecycle({
    status: "ended",
    event_date: startsAt,
    duration_minutes: 15,
    ended_at: null,
    nowMs,
  });

  assert.equal(result.lifecycle, "live");
  assert.equal(result.isLive, true);
});

test("ended_at is terminal even inside scheduled window", () => {
  const result = resolveEventLifecycle({
    status: "ended",
    event_date: startsAt,
    duration_minutes: 15,
    ended_at: "2026-05-02T08:59:00.000Z",
    nowMs,
  });

  assert.equal(result.lifecycle, "ended");
  assert.equal(result.isLive, false);
  assert.equal(result.isEnded, true);
});

test("after computed end resolves ended", () => {
  assert.equal(
    resolveEventLifecycle({
      status: "live",
      event_date: startsAt,
      duration_minutes: 1,
      ended_at: null,
      nowMs,
    }).lifecycle,
    "ended",
  );
});

test("before event_date resolves upcoming", () => {
  const result = resolveEventLifecycle({
    status: "ended",
    event_date: "2026-05-02T09:30:00.000Z",
    duration_minutes: 15,
    ended_at: null,
    nowMs,
  });

  assert.equal(result.lifecycle, "upcoming");
  assert.equal(result.isLive, false);
});

test("timezone-safe ISO/timestamptz parsing resolves the same instant", () => {
  const result = resolveEventLifecycle({
    status: "scheduled",
    event_date: "2026-05-02T11:58:00+03:00",
    duration_minutes: 15,
    ended_at: null,
    nowMs,
  });

  assert.equal(result.lifecycle, "live");
  assert.equal(result.startsAt?.toISOString(), "2026-05-02T08:58:00.000Z");
});

test("draft and cancelled remain terminal product states", () => {
  assert.equal(
    resolveEventLifecycle({
      status: "draft",
      event_date: startsAt,
      duration_minutes: 15,
      nowMs,
    }).lifecycle,
    "draft",
  );
  assert.equal(
    resolveEventLifecycle({
      status: "cancelled",
      event_date: startsAt,
      duration_minutes: 15,
      nowMs,
    }).lifecycle,
    "cancelled",
  );
});

