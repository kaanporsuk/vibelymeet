import test from "node:test";
import assert from "node:assert/strict";
import { resolveEventCardLifecycle } from "./eventCardLifecycle";

const start = "2026-05-08T18:00:00.000Z";
const startMs = Date.parse(start);
const durationMinutes = 30;
const insideWindowMs = startMs + 5 * 60_000;
const afterEndMs = startMs + durationMinutes * 60_000 + 60_000;

test("card lifecycle marks scheduled active rows live inside the scheduled window", () => {
  for (const status of ["scheduled", "upcoming"]) {
    const lifecycle = resolveEventCardLifecycle({
      status,
      event_date: start,
      duration_minutes: durationMinutes,
      nowMs: insideWindowMs,
    });

    assert.equal(lifecycle.isLive, true, status);
    assert.equal(lifecycle.showEnded, false, status);
  }
});

test("card lifecycle ends live rows after their scheduled end", () => {
  const lifecycle = resolveEventCardLifecycle({
    status: "live",
    event_date: start,
    duration_minutes: durationMinutes,
    nowMs: afterEndMs,
  });

  assert.equal(lifecycle.isLive, false);
  assert.equal(lifecycle.showEnded, true);
});

test("cancelled rows do not become live from time alone", () => {
  const lifecycle = resolveEventCardLifecycle({
    status: "cancelled",
    event_date: start,
    duration_minutes: durationMinutes,
    nowMs: insideWindowMs,
  });

  assert.equal(lifecycle.isLive, false);
  assert.equal(lifecycle.showEnded, false);
});

test("ended_at and archived_at make card badges terminal inside the live window", () => {
  const ended = resolveEventCardLifecycle({
    status: "live",
    event_date: start,
    duration_minutes: durationMinutes,
    ended_at: "2026-05-08T18:05:00.000Z",
    nowMs: insideWindowMs,
  });
  const archived = resolveEventCardLifecycle({
    status: "live",
    event_date: start,
    duration_minutes: durationMinutes,
    archived_at: "2026-05-08T18:05:00.000Z",
    nowMs: insideWindowMs,
  });

  assert.equal(ended.isLive, false);
  assert.equal(ended.showEnded, true);
  assert.equal(archived.isLive, false);
  assert.equal(archived.showEnded, true);
});

test("raw archived status is terminal even inside the scheduled live window", () => {
  const lifecycle = resolveEventCardLifecycle({
    status: "archived",
    event_date: start,
    duration_minutes: durationMinutes,
    nowMs: insideWindowMs,
  });

  assert.equal(lifecycle.isLive, false);
  assert.equal(lifecycle.showEnded, true);
});

test("invalid event date does not show live or ended badges", () => {
  const lifecycle = resolveEventCardLifecycle({
    status: "live",
    event_date: "not-a-date",
    duration_minutes: durationMinutes,
    nowMs: insideWindowMs,
  });

  assert.equal(lifecycle.isLive, false);
  assert.equal(lifecycle.showEnded, false);
  assert.equal(lifecycle.timeRemainingMs, null);
});
