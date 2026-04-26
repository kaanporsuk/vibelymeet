import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizedSwipeSessionStageResult,
  shouldAdvanceLobbyDeckAfterSwipe,
  shouldOpenReadyGateFromSwipePayload,
  shouldTrackQueuedSwipeSession,
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
    shouldTrackQueuedSwipeSession({
      result: "match_queued",
      video_session_id: "session-2",
      event_id: "event-1",
    }),
    true,
  );
  assert.equal(shouldOpenReadyGateFromSwipePayload({ result: "match_queued", video_session_id: "session-2" }), false);
});

test("already_matched remains a no-advance deck result even when routable", () => {
  assert.equal(shouldAdvanceLobbyDeckAfterSwipe("already_matched"), false);
  assert.equal(shouldAdvanceLobbyDeckAfterSwipe("swipe_recorded"), true);
});
