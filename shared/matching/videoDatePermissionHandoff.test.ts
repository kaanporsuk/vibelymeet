import test from "node:test";
import assert from "node:assert/strict";
import {
  VIDEO_DATE_PERMISSION_HANDOFF_TTL_MS,
  clearAllVideoDatePermissionHandoffs,
  clearVideoDatePermissionHandoff,
  getVideoDatePermissionHandoff,
  getVideoDatePermissionHandoffStatus,
  pruneExpiredVideoDatePermissionHandoffs,
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

test("video date permission handoff status exposes precise miss reasons", () => {
  clearAllVideoDatePermissionHandoffs();

  assert.deepEqual(
    getVideoDatePermissionHandoffStatus(SESSION_ID, USER_ID, 1000),
    { ok: false, reason: "missing" },
  );

  setVideoDatePermissionHandoff({
    sessionId: SESSION_ID,
    userId: USER_ID,
    platform: "web",
    source: "ready_gate",
    nowMs: 1000,
    ttlMs: 10,
  });

  assert.equal(
    getVideoDatePermissionHandoffStatus(SESSION_ID, USER_ID, 1009).ok,
    true,
  );
  assert.deepEqual(
    getVideoDatePermissionHandoffStatus(SESSION_ID, USER_ID, 1010),
    { ok: false, reason: "expired" },
  );
});

test("setting a permission handoff opportunistically prunes expired entries", () => {
  clearAllVideoDatePermissionHandoffs();
  setVideoDatePermissionHandoff({
    sessionId: SESSION_ID,
    userId: USER_ID,
    platform: "native",
    source: "ready_gate_existing_grants",
    nowMs: 1000,
    ttlMs: 10,
  });

  setVideoDatePermissionHandoff({
    sessionId: "33333333-3333-4333-8333-333333333333",
    userId: USER_ID,
    platform: "web",
    source: "preflight",
    nowMs: 1011,
  });

  assert.equal(pruneExpiredVideoDatePermissionHandoffs(1011), 0);
  assert.equal(
    getVideoDatePermissionHandoff("33333333-3333-4333-8333-333333333333", USER_ID, 1011)?.source,
    "preflight",
  );
});
