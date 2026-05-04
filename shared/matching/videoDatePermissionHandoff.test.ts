import test from "node:test";
import assert from "node:assert/strict";
import {
  VIDEO_DATE_PERMISSION_HANDOFF_TTL_MS,
  clearAllVideoDatePermissionHandoffs,
  clearVideoDatePermissionHandoff,
  getVideoDatePermissionHandoff,
  setVideoDatePermissionHandoff,
} from "./videoDatePermissionHandoff";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

test("video date permission handoff is in-memory, scoped, and short-lived", () => {
  clearAllVideoDatePermissionHandoffs();

  setVideoDatePermissionHandoff({
    sessionId: SESSION_ID,
    userId: USER_ID,
    platform: "native",
    source: "ready_gate_existing_grants",
    nowMs: 1000,
  });

  const fresh = getVideoDatePermissionHandoff(SESSION_ID, USER_ID, 1000 + VIDEO_DATE_PERMISSION_HANDOFF_TTL_MS - 1);
  assert.equal(fresh?.sessionId, SESSION_ID);
  assert.equal(fresh?.userId, USER_ID);
  assert.equal(fresh?.cameraGranted, true);
  assert.equal(fresh?.microphoneGranted, true);

  assert.equal(getVideoDatePermissionHandoff(SESSION_ID, "wrong-user", 1000), null);
  assert.equal(getVideoDatePermissionHandoff(SESSION_ID, USER_ID, 1000 + VIDEO_DATE_PERMISSION_HANDOFF_TTL_MS + 1), null);
});

test("video date permission handoff can be explicitly invalidated", () => {
  clearAllVideoDatePermissionHandoffs();
  setVideoDatePermissionHandoff({
    sessionId: SESSION_ID,
    userId: USER_ID,
    platform: "web",
    source: "preflight",
    nowMs: 1000,
  });

  assert.equal(clearVideoDatePermissionHandoff(SESSION_ID, USER_ID), true);
  assert.equal(getVideoDatePermissionHandoff(SESSION_ID, USER_ID, 1001), null);
});
