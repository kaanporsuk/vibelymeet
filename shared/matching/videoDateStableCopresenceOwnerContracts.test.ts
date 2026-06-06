import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  claimVideoDateEntryOwner,
  getVideoDateDailyOwner,
  getVideoDateEntryOwner,
  releaseVideoDateEntryOwner,
  subscribeVideoDateDailyOwner,
  updateVideoDateDailyOwnerState,
  updateVideoDateEntryOwnerState,
} from "./videoDateEntryOwner";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const webPrepare = read("src/lib/videoDatePrepareEntry.ts");
const nativePrepare = read("apps/mobile/lib/videoDatePrepareEntry.ts");
const webDate = read("src/hooks/useVideoCall.ts");
const nativeDate = read("apps/mobile/app/date/[id].tsx");
const webReadyGate = read("src/components/lobby/ReadyGateOverlay.tsx");
const nativeReadyGate = read("apps/mobile/components/lobby/ReadyGateOverlay.tsx");
const nativeReadyRoute = read("apps/mobile/app/ready/[id].tsx");
const migration = read(
  "supabase/migrations/20260606180000_video_date_stable_copresence_handshake_guard.sql",
);

test("entry owner is single-flight per session and user", () => {
  const sessionId = `session-${Date.now()}-${Math.random()}`;
  const userId = `user-${Date.now()}-${Math.random()}`;
  const first = claimVideoDateEntryOwner({
    sessionId,
    userId,
    source: "test_first",
    entryAttemptId: "attempt-1",
  });
  assert.equal(first.ok, true);
  assert.equal(first.owner.state, "preparing");

  const second = claimVideoDateEntryOwner({
    sessionId,
    userId,
    source: "test_second",
    entryAttemptId: "attempt-2",
  });
  assert.equal(second.ok, false);
  assert.equal(second.owner.ownerId, first.owner.ownerId);
  assert.equal(second.owner.entryAttemptId, "attempt-1");

  const prepared = updateVideoDateEntryOwnerState({
    sessionId,
    userId,
    ownerId: first.owner.ownerId,
    state: "prepared",
    roomName: "room_a",
    entryAttemptId: "attempt-1",
  });
  assert.equal(prepared?.state, "prepared");
  assert.equal(getVideoDateEntryOwner(sessionId, userId)?.roomName, "room_a");

  assert.equal(
    releaseVideoDateEntryOwner({
      sessionId,
      userId,
      ownerId: "wrong-owner",
    }),
    false,
  );
  assert.equal(
    releaseVideoDateEntryOwner({
      sessionId,
      userId,
      ownerId: first.owner.ownerId,
    }),
    true,
  );
  assert.equal(getVideoDateEntryOwner(sessionId, userId), null);
});

test("Daily owner subscribers observe joined and lost states", () => {
  const sessionId = `session-${Date.now()}-${Math.random()}`;
  const userId = `user-${Date.now()}-${Math.random()}`;
  const seen: Array<string | null> = [];
  const unsubscribe = subscribeVideoDateDailyOwner((owner) => {
    seen.push(owner?.state ?? null);
  });
  updateVideoDateDailyOwnerState({
    sessionId,
    userId,
    roomName: "room_b",
    state: "joined",
    ownerId: "owner-b",
  });
  updateVideoDateDailyOwnerState({
    sessionId,
    userId,
    roomName: "room_b",
    state: "lost",
    ownerId: "owner-b",
  });
  unsubscribe();

  assert.deepEqual(seen, ["joined", "lost"]);
  assert.equal(
    getVideoDateDailyOwner({ sessionId, userId, roomName: "room_b" })?.state,
    "lost",
  );
});

test("web and native prepare wrappers claim the shared owner and neutralize duplicate force retries", () => {
  for (const [name, source] of [
    ["web", webPrepare],
    ["native", nativePrepare],
  ] as const) {
    assert.match(source, /videoDateEntryOwnerV2Enabled/);
    assert.match(source, /claimVideoDateEntryOwner\(/);
    assert.match(source, /getCachedPreparedVideoDateEntry\(sessionId, userId\)/);
    assert.match(source, /effectiveForce = false/);
    assert.match(source, /updateVideoDateEntryOwnerState\(/);
    assert.match(
      source,
      /state:\s*['"]prepared['"][\s\S]{0,220}roomName:\s*result\.data\.room_name/,
      `${name} prepare should publish the prepared owner state`,
    );
  }
});

test("Ready Gate and ready-route handoffs mark a shared navigating owner", () => {
  for (const [name, source] of [
    ["web ReadyGate", webReadyGate],
    ["native ReadyGate", nativeReadyGate],
    ["native ready route", nativeReadyRoute],
  ] as const) {
    assert.match(
      source,
      /updateVideoDateEntryOwnerState\([\s\S]{0,260}state:\s*['"]navigating['"]/,
      `${name} should mark the owner navigating before date transfer`,
    );
  }
});

test("web and native date routes keep owner-alive heartbeats after Daily join", () => {
  for (const [name, source, heartbeatConst] of [
    ["web date", webDate, "VIDEO_DATE_DAILY_ALIVE_HEARTBEAT_MS"],
    [
      "native date",
      nativeDate,
      "NATIVE_VIDEO_DATE_DAILY_ALIVE_HEARTBEAT_MS",
    ],
  ] as const) {
    assert.match(source, new RegExp(heartbeatConst));
    assert.match(source, /mark_video_date_daily_alive/);
    assert.match(source, /startDailyAliveHeartbeat\(/);
    assert.match(source, /state:\s*["']joining["']/);
    assert.match(source, /state:\s*["']joined["']/);
    assert.match(source, /state:\s*["']remote_seen["']/);
    assert.match(source, /daily_owner_provider_left_unexpected/);
  }
});

test("stable copresence migration blocks handshake promotion from stale joined state", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.video_date_presence_events/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.video_date_stable_copresence_v1/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.mark_video_date_daily_alive/);
  assert.match(migration, /owner_heartbeat/);
  assert.match(migration, /client_daily_alive/);
  assert.match(migration, /missing_owner_heartbeat_after_latest_join/);
  assert.match(migration, /owner_heartbeat_stale/);
  assert.match(migration, /owner_heartbeat_stabilizing/);
  assert.match(migration, /min\(vpe\.occurred_at\), max\(vpe\.occurred_at\)/);
  assert.match(migration, /stable_copresence_since_at/);
  assert.match(migration, /v_copresence_since_at <= v_now - interval '2 seconds'/);
  assert.doesNotMatch(
    migration,
    /v_latest_heartbeat_at <= v_now - interval '2 seconds'/,
  );
  assert.match(migration, /remote_seen/);
  assert.match(migration, /handshake_started_after_stable_copresence/);
  assert.match(migration, /handshake_started_after_stable_daily_alive/);
  assert.doesNotMatch(
    migration,
    /handshake_started_after_active_daily_copresence/,
  );
  assert.match(
    migration,
    /AND v_stable_copresence THEN[\s\S]{0,220}handshake_started_at = v_now/,
  );
});
