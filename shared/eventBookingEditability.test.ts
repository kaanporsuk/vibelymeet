import test from "node:test";
import assert from "node:assert/strict";
import { resolveEventBookingEditability } from "./eventBookingEditability";

const start = "2026-05-08T18:00:00.000Z";
const oneMinuteBefore = Date.parse("2026-05-08T17:59:00.000Z");
const exactStart = Date.parse(start);

test("self-cancel is allowed only before the scheduled start", () => {
  assert.equal(
    resolveEventBookingEditability({
      status: "upcoming",
      event_date: start,
      duration_minutes: 30,
      nowMs: oneMinuteBefore,
    }).canSelfCancel,
    true,
  );

  const atStart = resolveEventBookingEditability({
    status: "upcoming",
    event_date: start,
    duration_minutes: 30,
    nowMs: exactStart,
  });
  assert.equal(atStart.canSelfCancel, false);
  assert.equal(atStart.closedReason, "started");
});

test("live and computed-ended events are closed for self-cancel", () => {
  const live = resolveEventBookingEditability({
    status: "live",
    event_date: start,
    duration_minutes: 30,
    nowMs: Date.parse("2026-05-08T18:05:00.000Z"),
  });
  assert.equal(live.canSelfCancel, false);
  assert.equal(live.closedReason, "started");

  const ended = resolveEventBookingEditability({
    status: "live",
    event_date: start,
    duration_minutes: 30,
    nowMs: Date.parse("2026-05-08T18:31:00.000Z"),
  });
  assert.equal(ended.canSelfCancel, false);
  assert.equal(ended.closedReason, "ended");
});

test("terminal and archived event truth closes self-cancel", () => {
  for (const [status, reason] of [
    ["draft", "draft"],
    ["cancelled", "cancelled"],
    ["completed", "completed"],
    ["ended", "ended"],
  ] as const) {
    const result = resolveEventBookingEditability({
      status,
      event_date: start,
      duration_minutes: 30,
      nowMs: oneMinuteBefore,
    });
    assert.equal(result.canSelfCancel, false, status);
    assert.equal(result.closedReason, reason, status);
  }

  assert.equal(
    resolveEventBookingEditability({
      status: "upcoming",
      event_date: start,
      duration_minutes: 30,
      ended_at: "2026-05-08T17:30:00.000Z",
      nowMs: oneMinuteBefore,
    }).closedReason,
    "ended",
  );

  assert.equal(
    resolveEventBookingEditability({
      status: " Upcoming ",
      event_date: start,
      duration_minutes: 30,
      archived_at: "2026-05-08T17:30:00.000Z",
      nowMs: oneMinuteBefore,
    }).closedReason,
    "archived",
  );
});

test("missing event start closes self-cancel", () => {
  const result = resolveEventBookingEditability({
    status: "upcoming",
    event_date: null,
    nowMs: oneMinuteBefore,
  });

  assert.equal(result.canSelfCancel, false);
  assert.equal(result.closedReason, "missing_start");
});
