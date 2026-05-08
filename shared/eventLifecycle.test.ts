import test from "node:test";
import assert from "node:assert/strict";
import {
  EVENT_FINALIZATION_GRACE_MINUTES,
  resolveEventLifecycle,
} from "./eventLifecycle";

const start = "2026-05-08T18:00:00.000Z";
const startMs = Date.parse(start);
const durationMinutes = 30;
const endMs = startMs + durationMinutes * 60_000;

test("event lifecycle exposes upcoming, live, ended, and finalization metadata", () => {
  const upcoming = resolveEventLifecycle({
    status: "upcoming",
    event_date: start,
    duration_minutes: durationMinutes,
    nowMs: startMs - 60_000,
  });

  assert.equal(upcoming.lifecycle, "upcoming");
  assert.equal(upcoming.isFinalized, false);
  assert.equal(upcoming.isInFinalizationGrace, false);
  assert.equal(upcoming.needsFinalizationRepair, false);
  assert.equal(upcoming.scheduledEndAt?.toISOString(), new Date(endMs).toISOString());
  assert.equal(
    upcoming.autoFinalizeAt?.toISOString(),
    new Date(endMs + EVENT_FINALIZATION_GRACE_MINUTES * 60_000).toISOString(),
  );

  const live = resolveEventLifecycle({
    status: "live",
    event_date: start,
    duration_minutes: durationMinutes,
    nowMs: startMs + 5 * 60_000,
  });

  assert.equal(live.lifecycle, "live");
  assert.equal(live.isLive, true);
  assert.equal(live.isInFinalizationGrace, false);
  assert.equal(live.needsFinalizationRepair, false);
});

test("stale raw ended without ended_at still follows scheduled window", () => {
  const live = resolveEventLifecycle({
    status: "ended",
    event_date: start,
    duration_minutes: durationMinutes,
    ended_at: null,
    nowMs: startMs + 5 * 60_000,
  });

  assert.equal(live.lifecycle, "live");
  assert.equal(live.isLive, true);

  const upcoming = resolveEventLifecycle({
    status: "ended",
    event_date: start,
    duration_minutes: durationMinutes,
    ended_at: null,
    nowMs: startMs - 60_000,
  });

  assert.equal(upcoming.lifecycle, "upcoming");
  assert.equal(upcoming.isLive, false);
});

test("timezone-safe ISO/timestamptz parsing resolves the same instant", () => {
  const lifecycle = resolveEventLifecycle({
    status: "scheduled",
    event_date: "2026-05-08T21:00:00+03:00",
    duration_minutes: durationMinutes,
    nowMs: startMs + 5 * 60_000,
  });

  assert.equal(lifecycle.lifecycle, "live");
  assert.equal(lifecycle.startsAt?.toISOString(), start);
});

test("scheduled end enters admin grace before repair state", () => {
  const inGrace = resolveEventLifecycle({
    status: "live",
    event_date: start,
    duration_minutes: durationMinutes,
    nowMs: endMs + 5 * 60_000,
  });

  assert.equal(inGrace.lifecycle, "ended");
  assert.equal(inGrace.isEnded, true);
  assert.equal(inGrace.isFinalized, false);
  assert.equal(inGrace.isInFinalizationGrace, true);
  assert.equal(inGrace.needsFinalizationRepair, false);

  const needsRepair = resolveEventLifecycle({
    status: "live",
    event_date: start,
    duration_minutes: durationMinutes,
    nowMs: endMs + 10 * 60_000,
  });

  assert.equal(needsRepair.lifecycle, "ended");
  assert.equal(needsRepair.isFinalized, false);
  assert.equal(needsRepair.isInFinalizationGrace, false);
  assert.equal(needsRepair.needsFinalizationRepair, true);
});

test("ended_at is terminal finalized truth", () => {
  const finalized = resolveEventLifecycle({
    status: "live",
    event_date: start,
    duration_minutes: durationMinutes,
    ended_at: "2026-05-08T18:20:00.000Z",
    nowMs: startMs + 25 * 60_000,
  });

  assert.equal(finalized.lifecycle, "ended");
  assert.equal(finalized.isFinalized, true);
  assert.equal(finalized.isInFinalizationGrace, false);
  assert.equal(finalized.needsFinalizationRepair, false);
});

test("draft and cancelled rows do not request finalization repair", () => {
  for (const status of ["draft", "cancelled"]) {
    const lifecycle = resolveEventLifecycle({
      status,
      event_date: start,
      duration_minutes: durationMinutes,
      nowMs: endMs + 30 * 60_000,
    });

    assert.equal(lifecycle.lifecycle, status);
    assert.equal(lifecycle.needsFinalizationRepair, false);
  }
});

test("archived rows expose archive metadata without requesting repair", () => {
  const archivedAtLifecycle = resolveEventLifecycle({
    status: "upcoming",
    event_date: start,
    duration_minutes: durationMinutes,
    archived_at: "2026-05-08T18:40:00.000Z",
    nowMs: endMs + 30 * 60_000,
  });

  assert.equal(archivedAtLifecycle.isArchived, true);
  assert.equal(archivedAtLifecycle.isFinalized, false);
  assert.equal(archivedAtLifecycle.isInFinalizationGrace, false);
  assert.equal(archivedAtLifecycle.needsFinalizationRepair, false);

  const rawArchivedLifecycle = resolveEventLifecycle({
    status: "archived",
    event_date: start,
    duration_minutes: durationMinutes,
    nowMs: endMs + 30 * 60_000,
  });

  assert.equal(rawArchivedLifecycle.isArchived, true);
  assert.equal(rawArchivedLifecycle.isInFinalizationGrace, false);
  assert.equal(rawArchivedLifecycle.needsFinalizationRepair, false);
});
