import test from "node:test";
import assert from "node:assert/strict";
import {
  getSwipeFailureUserMessage,
  normalizedSwipeSessionStageResult,
  shouldAdvanceLobbyDeckAfterSwipe,
  shouldOpenReadyGateFromSwipePayload,
  shouldTrackQueuedSwipeSession,
  SWIPE_PAIR_ALREADY_MET_USER_MESSAGE,
  SWIPE_SESSION_CONFLICT_USER_MESSAGE,
  SWIPE_TARGET_UNAVAILABLE_USER_MESSAGE,
  videoSessionIdFromSwipePayload,
} from "./videoSessionFlow";

test("swipe payload helpers normalize legacy names and session id aliases", () => {
  assert.equal(normalizedSwipeSessionStageResult("swipe_recorded"), "vibe_recorded");
  assert.equal(videoSessionIdFromSwipePayload({ match_id: "session-1" }), "session-1");
  assert.equal(
    videoSessionIdFromSwipePayload({ video_session_id: "session-2", match_id: "session-1" }),
    "session-2",
  );
});

test("already_matched with a routable session opens Ready Gate", () => {
  assert.equal(
    shouldOpenReadyGateFromSwipePayload({
      result: "already_matched",
      video_session_id: "session-1",
      event_id: "event-1",
      immediate: true,
      ready_gate_status: "ready",
    }),
    true,
  );
});

test("queued and busy swipe outcomes do not open Ready Gate immediately", () => {
  assert.equal(
    shouldOpenReadyGateFromSwipePayload({
      result: "already_matched",
      video_session_id: "session-1",
      event_id: "event-1",
      immediate: false,
      ready_gate_status: "queued",
    }),
    false,
  );
  assert.equal(
    shouldOpenReadyGateFromSwipePayload({
      result: "participant_has_active_session_conflict",
      video_session_id: "session-1",
      event_id: "event-1",
    }),
    false,
  );
});

test("match_immediate and match_queued semantics remain distinct", () => {
  assert.equal(
    shouldOpenReadyGateFromSwipePayload({
      result: "match",
      video_session_id: "session-1",
      event_id: "event-1",
      immediate: true,
    }),
    true,
  );
  assert.equal(
    shouldOpenReadyGateFromSwipePayload({
      outcome: "match",
      video_session_id: "session-1b",
      event_id: "event-1",
      immediate: true,
    }),
    true,
  );
  assert.equal(
    shouldTrackQueuedSwipeSession({
      result: "match_queued",
      video_session_id: "session-2",
      event_id: "event-1",
    }),
    true,
  );
  assert.equal(
    shouldTrackQueuedSwipeSession({
      outcome: "match_queued",
      video_session_id: "session-2b",
      event_id: "event-1",
    }),
    true,
  );
  assert.equal(shouldOpenReadyGateFromSwipePayload({ result: "match_queued", video_session_id: "session-2" }), false);
});

test("already_matched remains a no-advance deck result even when routable", () => {
  assert.equal(shouldAdvanceLobbyDeckAfterSwipe("already_matched"), false);
  assert.equal(shouldAdvanceLobbyDeckAfterSwipe("already_swiped"), false);
  assert.equal(shouldAdvanceLobbyDeckAfterSwipe("account_paused"), false);
  assert.equal(shouldAdvanceLobbyDeckAfterSwipe("swipe_failed"), false);
  assert.equal(shouldAdvanceLobbyDeckAfterSwipe("swipe_recorded"), true);
  assert.equal(shouldAdvanceLobbyDeckAfterSwipe("target_unavailable"), true);
  assert.equal(shouldAdvanceLobbyDeckAfterSwipe("pair_already_met_this_event"), true);
});

test("known swipe failures map to explicit user copy", () => {
  assert.equal(
    getSwipeFailureUserMessage({ success: false, result: "participant_has_active_session_conflict" }),
    SWIPE_SESSION_CONFLICT_USER_MESSAGE,
  );
  assert.equal(
    getSwipeFailureUserMessage({ success: false, result: "pair_already_met_this_event" }),
    SWIPE_PAIR_ALREADY_MET_USER_MESSAGE,
  );
  assert.equal(
    getSwipeFailureUserMessage({ success: false, error: "target_unavailable" }),
    SWIPE_TARGET_UNAVAILABLE_USER_MESSAGE,
  );
});
