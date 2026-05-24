import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isVideoDateDailyTokenFault,
  isVideoDateDailyTokenJoinError,
  videoDateTokenRefreshDelayMs,
} from "./videoDatePublicApi";
import {
  createVideoDateBroadcastGapRecovery,
  mergeVideoDateBroadcastGapRecovery,
  recordVideoDateBroadcastGapRecoveryFailure,
  recordVideoDateBroadcastGapRecoverySuccess,
  shouldAttemptVideoDateBroadcastGapRecovery,
  shouldRetainVideoDateBroadcastGapRecoveryForEvent,
  videoDateBroadcastGapRetryDelayMs,
} from "./videoDateBroadcastGapRecovery";

const root = process.cwd();
const webVideoCall = readFileSync(join(root, "src/hooks/useVideoCall.ts"), "utf8");
const nativeVideoDate = readFileSync(join(root, "apps/mobile/app/date/[id].tsx"), "utf8");
const webStatusHook = readFileSync(join(root, "src/hooks/useEventStatus.ts"), "utf8");
const nativeStatusHook = readFileSync(join(root, "apps/mobile/lib/eventStatus.ts"), "utf8");
const webVideoDate = readFileSync(join(root, "src/pages/VideoDate.tsx"), "utf8");
const webReadyGate = readFileSync(join(root, "src/hooks/useReadyGate.ts"), "utf8");
const webReadyGateOverlay = readFileSync(join(root, "src/components/lobby/ReadyGateOverlay.tsx"), "utf8");
const nativeVideoDateApi = readFileSync(join(root, "apps/mobile/lib/videoDateApi.ts"), "utf8");
const nativeReadyGateApi = readFileSync(join(root, "apps/mobile/lib/readyGateApi.ts"), "utf8");
const nativeReadyGateRoute = readFileSync(join(root, "apps/mobile/app/ready/[id].tsx"), "utf8");
const roomCleanup = readFileSync(join(root, "supabase/functions/video-date-room-cleanup/index.ts"), "utf8");
const orphanRoomCleanup = readFileSync(
  join(root, "supabase/functions/video-date-orphan-room-cleanup/index.ts"),
  "utf8",
);

test("Phase 3 token refresh detects Daily auth/ejection faults and schedules active refresh", () => {
  assert.equal(isVideoDateDailyTokenFault({ error: { type: "exp-token" } }), true);
  assert.equal(isVideoDateDailyTokenFault({ errorMsg: "Daily ejected because meeting token expired" }), true);
  assert.equal(isVideoDateDailyTokenJoinError({ message: "Camera permission denied" }), false);
  assert.equal(
    videoDateTokenRefreshDelayMs("2026-05-23T10:10:00.000Z", Date.parse("2026-05-23T10:00:00.000Z")),
    8.5 * 60 * 1000,
  );
  assert.equal(
    videoDateTokenRefreshDelayMs("2026-05-23T10:03:00.000Z", Date.parse("2026-05-23T10:00:00.000Z")),
    90 * 1000,
  );
  assert.equal(
    videoDateTokenRefreshDelayMs("2026-05-23T10:01:00.000Z", Date.parse("2026-05-23T10:00:00.000Z")),
    0,
  );

  for (const source of [webVideoCall, nativeVideoDate]) {
    assert.match(source, /adviseVideoDateTokenRecovery/);
    assert.match(source, /trigger: ["']before_join["']/);
    assert.match(source, /trigger: ["']active_refresh_timer["']/);
    assert.match(source, /trigger: ["']auth_error["']/);
    assert.match(source, /daily_token_refresh_before_expiry/);
    assert.match(source, /daily_token_refresh_after_auth_error/);
    assert.match(source, /daily_token_refresh_after_ejection/);
    assert.match(source, /refreshVideoDateToken/);
    assert.match(source, /\.join\(\{ url: .*?token:/s);
  }
  assert.match(webVideoCall, /dailyTokenRefreshTimerRef/);
  assert.match(nativeVideoDate, /recoverNativeDailyTokenRef/);
});

test("Phase 3 heartbeats send immediate foreground/background transitions", () => {
  assert.match(webStatusHook, /record_heartbeat_v2/);
  assert.match(webStatusHook, /visibilitychange/);
  assert.match(webStatusHook, /pagehide/);
  assert.match(webStatusHook, /beforeunload/);
  assert.match(webStatusHook, /p_foreground: foreground/);
  assert.match(webStatusHook, /keepalive: true/);

  assert.match(nativeStatusHook, /AppState\.addEventListener\('change'/);
  assert.match(nativeStatusHook, /foreground: state === 'active'/);
  assert.match(nativeStatusHook, /foreground: false/);
});

test("Phase 3 broadcast gap recovery retries snapshots without token leakage", () => {
  let state = createVideoDateBroadcastGapRecovery({
    sessionId: "11111111-1111-4111-8111-111111111111",
    targetSeq: 12,
    expectedSeq: 10,
  }, 1000);
  assert.equal(shouldAttemptVideoDateBroadcastGapRecovery(state, 1000), true);
  state = recordVideoDateBroadcastGapRecoveryFailure(state, "network", 1000);
  assert.equal(shouldAttemptVideoDateBroadcastGapRecovery(state, 1000), false);
  assert.equal(videoDateBroadcastGapRetryDelayMs(state, 1000), 1000);
  state = mergeVideoDateBroadcastGapRecovery(state, {
    sessionId: state.sessionId,
    targetSeq: 14,
    expectedSeq: 11,
  }, 1500);
  assert.equal(state.targetSeq, 14);
  assert.equal(createVideoDateBroadcastGapRecovery({
    sessionId: state.sessionId,
    targetSeq: Number.NaN,
  }).targetSeq, 0);
  assert.equal(shouldRetainVideoDateBroadcastGapRecoveryForEvent(state, 13), true);
  assert.equal(shouldRetainVideoDateBroadcastGapRecoveryForEvent(state, 14), false);
  assert.equal(recordVideoDateBroadcastGapRecoverySuccess(state, 13, 2000)?.exhausted, false);
  assert.equal(recordVideoDateBroadcastGapRecoverySuccess(state, 14), null);

  for (const source of [webVideoDate, webReadyGate, nativeVideoDateApi, nativeReadyGateApi]) {
    assert.match(source, /mergeVideoDateBroadcastGapRecovery/);
    assert.match(source, /recordVideoDateBroadcastGapRecoveryFailure/);
    assert.match(source, /shouldRetainVideoDateBroadcastGapRecoveryForEvent/);
    assert.match(source, /broadcast_event_progress/);
    assert.match(source, /videoDateBroadcastGapRetryDelayMs/);
    assert.match(source, /includeToken: false/);
    assert.doesNotMatch(source, /includeToken: true/);
  }
  assert.match(webVideoDate, /attemptBroadcastGapSnapshotRecoveryRef/);
  assert.match(nativeVideoDate, /retryBroadcastGapRecovery\('app_foreground'\)/);
  assert.match(webVideoCall, /setIsConnecting\(false\);\s+startReconnectGrace\("daily_token_refresh_failed"\)/);
  assert.match(webReadyGate, /retryBroadcastGapRecovery: attemptBroadcastGapSnapshotRecovery/);
  assert.match(webReadyGateOverlay, /retryBroadcastGapRecovery/);
  assert.match(webReadyGateOverlay, /visibility_resume/);
  assert.match(webReadyGateOverlay, /window_focus/);
  assert.match(nativeReadyGateApi, /retryBroadcastGapRecovery: attemptBroadcastGapSnapshotRecovery/);
  assert.match(nativeReadyGateRoute, /retryBroadcastGapRecovery\('app_foreground'\)/);
});

test("Phase 3 room cleanup checks provider presence immediately before delete", () => {
  assert.match(roomCleanup, /const finalPresence = await getDailyRoomPresence\(name\)/);
  assert.match(roomCleanup, /cleanup_delete_aborted_active_participants_second_check/);
  assert.match(roomCleanup, /cleanup_deferred_provider_second_check_failed/);
  assert.match(roomCleanup, /const ok = await deleteDailyRoom\(name\)/);

  assert.match(orphanRoomCleanup, /const finalPresence = await getDailyRoomPresence\(room\.name\)/);
  assert.match(orphanRoomCleanup, /provider_presence_second_check_failed/);
  assert.match(orphanRoomCleanup, /provider_presence_active_second_check/);
  assert.match(orphanRoomCleanup, /const removed = await deleteDailyRoom\(room\.name\)/);
});
