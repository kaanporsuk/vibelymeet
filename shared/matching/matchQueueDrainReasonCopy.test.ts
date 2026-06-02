import test from "node:test";
import assert from "node:assert/strict";
import { getMatchQueueDrainReasonCopy } from "./matchQueueDrainReasonCopy";

test("maps active-session drain conflicts to user-facing copy", () => {
  assert.deepEqual(getMatchQueueDrainReasonCopy("participant_has_active_session_conflict"), {
    reason: "participant_has_active_session_conflict",
    title: "Active session found",
    message: "You already have an active session. Refresh if you don't see it shortly.",
  });

  assert.equal(
    getMatchQueueDrainReasonCopy({ found: false, reason: "participant_has_active_session_conflict" })?.title,
    "Active session found",
  );
});

test("maps invalid events to user-facing copy", () => {
  assert.deepEqual(getMatchQueueDrainReasonCopy({ found: false, reason: "event_not_valid" }), {
    reason: "event_not_valid",
    title: "Event unavailable",
    message: "This event is no longer available. Refresh or choose another event.",
  });
});

test("maps v2 runtime and safety drain blocks to calm lobby copy", () => {
  assert.equal(
    getMatchQueueDrainReasonCopy({ found: false, reason: "self_runtime_not_ready" })?.title,
    "Still checking your setup",
  );
  assert.equal(
    getMatchQueueDrainReasonCopy({ found: false, reason: "partner_runtime_not_ready" })?.title,
    "Waiting for your match",
  );
  assert.equal(
    getMatchQueueDrainReasonCopy({ found: false, reason: "blocked_or_reported_pair" })?.title,
    "Match unavailable",
  );
});

test("maps v2 queue, admission, and registration reasons to visible waiting copy", () => {
  assert.deepEqual(getMatchQueueDrainReasonCopy("no_queued_session"), {
    reason: "no_queued_session",
    title: "Queue is syncing",
    message: "We are checking for a match. Keep the lobby open while the queue catches up.",
  });
  assert.equal(
    getMatchQueueDrainReasonCopy({ found: false, reason_code: "session_not_promotable" })?.message,
    "This queued match can no longer open Ready Gate. Keep browsing while we look for the next one.",
  );
  assert.equal(
    getMatchQueueDrainReasonCopy({ found: false, failure_reason: "admission_not_confirmed" })?.title,
    "Event access pending",
  );
  assert.equal(
    getMatchQueueDrainReasonCopy({ found: false, reason: "registration_missing" })?.message,
    "Your event registration changed. Refresh the lobby to continue.",
  );
  assert.equal(
    getMatchQueueDrainReasonCopy({ found: false, reason: "pair_already_met_this_event" })?.title,
    "Already matched here",
  );
  assert.equal(
    getMatchQueueDrainReasonCopy({ found: false, reason: "lock_busy" })?.message,
    "Another queue check is running. Keep the lobby open and we will retry.",
  );
});

test("ignores unknown, null, and non-string reasons", () => {
  assert.equal(getMatchQueueDrainReasonCopy(null), null);
  assert.equal(getMatchQueueDrainReasonCopy(undefined), null);
  assert.equal(getMatchQueueDrainReasonCopy({ found: false, reason: "self_not_present" }), null);
  assert.equal(getMatchQueueDrainReasonCopy({ found: false, reason: 123 }), null);
  assert.equal(getMatchQueueDrainReasonCopy({ found: false }), null);
});
