import test from "node:test";
import assert from "node:assert/strict";
import {
  getSwipeFailureUserMessage,
  normalizedSwipeSessionStageResult,
  shouldAdvanceLobbyDeckAfterSwipe,
  shouldOpenReadyGateFromSwipePayload,
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

test("match and already_matched with routable sessions open Ready Gate", () => {
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
      result: "already_matched",
      video_session_id: "session-2",
      event_id: "event-1",
      immediate: true,
      ready_gate_status: "ready",
    }),
    true,
  );
});

test("busy or non-immediate swipe outcomes do not open Ready Gate", () => {
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
  assert.equal(shouldOpenReadyGateFromSwipePayload({ result: "match_queued", video_session_id: "session-2" }), false);
});

test("deck advancement keeps duplicate and active-session failures pinned", () => {
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
