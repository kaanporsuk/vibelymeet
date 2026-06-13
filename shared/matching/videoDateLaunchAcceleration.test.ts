import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { readWebVideoCallFlowSource, readWebVideoDatePageFlowSource } from "../testUtils/webVideoDateFlowSources";
import { readNativeVideoDateScreenFlowSource } from "../testUtils/nativeVideoDateFlowSources";

const root = process.cwd();
const webReadyGate = readFileSync(join(root, "src/components/lobby/ReadyGateOverlay.tsx"), "utf8");
const webVideoCall = readWebVideoCallFlowSource(root);
const webVideoDate = readWebVideoDatePageFlowSource(root);
const webDailyPrewarm = readFileSync(join(root, "src/lib/videoDateDailyPrewarm.ts"), "utf8");
const webLobby = readFileSync(join(root, "src/pages/EventLobby.tsx"), "utf8");
const nativeReadyGate = readFileSync(join(root, "apps/mobile/components/lobby/ReadyGateOverlay.tsx"), "utf8");
const nativeDate = readNativeVideoDateScreenFlowSource(root);
const nativeDailyPrewarm = readFileSync(join(root, "apps/mobile/lib/videoDateDailyPrewarm.ts"), "utf8");
const nativeLobby = readFileSync(join(root, "apps/mobile/app/event/[eventId]/lobby.tsx"), "utf8");

test("ready gate warms camera + preauth after prepare success but never joins Daily", () => {
  // The ReadyGate must prewarm (camera + preauth) for a fast handoff but MUST
  // NOT perform a real Daily join. A lobby-side join starts the backend
  // handshake clock before the user is on a stable /date route, causing
  // handshake_timeout. The real join is owned solely by /date (useVideoCall).
  assert.match(webReadyGate, /startWebVideoDateDailyPrewarm\(\{[\s\S]*source: "ready_gate_prepare_success"/);
  assert.match(webReadyGate, /void preAuthWebVideoDateDailyPrewarm\(\{[\s\S]*source: "ready_gate_prepare_success"/);
  assert.doesNotMatch(webReadyGate, /joinWebVideoDateDailyPrewarm/);

  assert.match(nativeReadyGate, /startNativeVideoDateDailyPrewarm\(\{[\s\S]*source: 'ready_gate_prepare_success'/);
  assert.match(nativeReadyGate, /void preAuthNativeVideoDateDailyPrewarm\(\{[\s\S]*source: 'ready_gate_prepare_success'/);
  assert.doesNotMatch(nativeReadyGate, /joinNativeVideoDateDailyPrewarm/);
});

test("web date route consumes the Ready Gate media stream before reacquiring media", () => {
  const consumeIndex = webVideoCall.indexOf("consumeWebVideoDateMediaHandoff");
  const permissionMetadataIndex = webVideoCall.indexOf("getVideoDatePermissionHandoff");
  const getUserMediaIndex = webVideoCall.indexOf("navigator.mediaDevices.getUserMedia", permissionMetadataIndex);

  assert.ok(consumeIndex > -1, "web video call should import and consume media handoff");
  assert.ok(permissionMetadataIndex > -1, "web video call should retain permission metadata fallback");
  assert.ok(consumeIndex < permissionMetadataIndex, "media stream handoff should be attempted before metadata fallback");
  assert.ok(consumeIndex < getUserMediaIndex, "media stream handoff should be attempted before getUserMedia fallback");
  assert.match(webVideoCall, /media_handoff_used/);
  assert.match(webVideoCall, /media_handoff_miss_reason/);
});

test("web Video Date app-acquired media requires live camera and microphone tracks", () => {
  assert.match(webReadyGate, /assertLiveVideoDateCameraAndMicrophone\(stream, "Ready Gate permission prewarm"\)/);
  assert.match(webReadyGate, /returned no live audio track/);
  assert.match(webVideoCall, /type LiveVideoDateMediaTracks/);
  assert.match(webVideoCall, /function getLiveVideoDateMediaTracks/);
  assert.match(webVideoCall, /function requireLiveVideoDateMediaTracks/);
  assert.match(webVideoCall, /returned no live audio track/);
  assert.match(webVideoCall, /Video Date permission handoff media acquire/);
  assert.match(webVideoCall, /Video Date media permission preflight/);
  assert.match(webVideoCall, /Video Date handoff capture/);
  assert.match(webVideoCall, /app_acquired_media_missing_required_track/);
  assert.match(webVideoCall, /const hasAppAcquiredMediaTracks = Boolean\(appAcquiredMediaForCall\)/);
  assert.match(webVideoCall, /hasAppAcquiredMediaTracks && appAcquiredMediaForCall[\s\S]*dailyVideoDateCallObjectOptionsWithAppAcquiredMedia/);
  assert.doesNotMatch(webVideoCall, /hasAppAcquiredVideoTrack/);
});

test("web date route only prompts automatically with prior-grant evidence, Ready Gate handoff, or user retry", () => {
  const permissionHandoffIndex = webVideoCall.indexOf("const permissionHandoff");
  const readinessIndex = webVideoCall.indexOf("const captureReadiness");
  const getUserMediaIndex = webVideoCall.indexOf("navigator.mediaDevices.getUserMedia", permissionHandoffIndex);

  assert.match(webVideoCall, /export type VideoDateMediaPromptIntent = "auto" \| "user_retry"/);
  assert.match(webVideoCall, /resolveWebVideoDateMediaCaptureReadiness\([\s\S]*promptIntent,[\s\S]*Boolean\(permissionHandoff\),[\s\S]*\)/);
  assert.match(webVideoCall, /promptIntent === "user_retry"[\s\S]*canAcquire: true/);
  assert.match(webVideoCall, /cameraState === "granted" && microphoneState === "granted"/);
  assert.match(webVideoCall, /cameraState === "denied" \|\| microphoneState === "denied"[\s\S]*canAcquire: false/);
  assert.match(webVideoCall, /if \(hasPermissionHandoff\) \{[\s\S]*sourceAction: "media_permission_preflight_permission_handoff"/);
  assert.match(webVideoCall, /hasPriorGrantedVideoDateDeviceLabels/);
  assert.match(webVideoCall, /if \(!captureReadiness\.canAcquire\) \{[\s\S]*media_permission_preflight_prompt_required[\s\S]*return false;/);
  assert.ok(permissionHandoffIndex > -1, "preflight should read permission handoff metadata");
  assert.ok(readinessIndex > permissionHandoffIndex, "prompt readiness should include Ready Gate permission handoff evidence");
  assert.ok(getUserMediaIndex > readinessIndex, "fallback getUserMedia should happen only after prompt readiness");

  assert.match(webVideoDate, /const nextVideoDateMediaPromptIntentRef =[\s\S]*useRef<VideoDateMediaPromptIntent>\("auto"\)/);
  assert.match(webVideoDate, /const mediaPromptIntent = nextVideoDateMediaPromptIntentRef\.current;[\s\S]*nextVideoDateMediaPromptIntentRef\.current = "auto";[\s\S]*startCall\(id, \{ mediaPromptIntent \}\)/);
  assert.match(webVideoDate, /nextVideoDateMediaPromptIntentRef\.current = "user_retry";[\s\S]*clearMediaPermissionError\(\)/);
});

test("lobbies coalesce convergence refreshes and preload the date route on the hot path", () => {
  assert.match(webLobby, /scheduleLobbyConvergenceRefresh/);
  assert.match(webLobby, /preloadRouteOnIdle\("videoDate"\)/);
  assert.match(webLobby, /preloadRoute\("videoDate"\)/);

  assert.match(nativeLobby, /scheduleLobbyRefreshBurst/);
  assert.match(nativeLobby, /scheduleDeckRefresh/);
  assert.match(nativeLobby, /void \(async \(\) => \{[\s\S]*get_profile_for_viewer/);
});

test("join and first-frame telemetry expose prewarm and provider handoff context", () => {
  for (const source of [webVideoCall, nativeDate]) {
    assert.match(source, /daily_prewarm_consumed/);
    assert.match(source, /daily_prewarm_fallback_reason/);
    assert.match(source, /prewarmed_join_in_flight/);
    assert.match(source, /prewarmed_already_joined/);
    assert.match(source, /prepared_entry_used/);
    assert.match(source, /prepared_entry_miss_reason/);
    assert.match(source, /provider_verify_skipped/);
  }
  assert.match(webVideoCall, /media_handoff_used/);
  assert.match(webVideoCall, /media_handoff_miss_reason/);
  assert.match(nativeDate, /permission_handoff_used/);
  assert.match(nativeDate, /permission_handoff_miss_reason/);
});

test("web date route preflights before room unless Daily prewarm already owns live media", () => {
  const preRoomPeekIndex = webVideoCall.indexOf("const prewarmPeekBeforeRoom");
  const preflightGuardIndex = webVideoCall.indexOf("const runMediaPreflightBeforeRoom");
  const preflightIndex = webVideoCall.indexOf("await preflightMediaPermission");
  const acquireRoomIndex = webVideoCall.indexOf("const roomResult = await acquireDateRoom");
  const roomBoundPeekIndex = webVideoCall.indexOf(
    "roomName: roomData.room_name",
    acquireRoomIndex,
  );
  const consumePrewarmIndex = webVideoCall.indexOf(
    "consumeWebVideoDateDailyPrewarmWhenReady({",
    acquireRoomIndex,
  );
  const fallbackGetUserMediaIndex = webVideoCall.indexOf(
    "navigator.mediaDevices.getUserMedia",
    consumePrewarmIndex,
  );

  assert.ok(preRoomPeekIndex > -1, "web date route should peek reusable Daily media before room acquisition");
  assert.ok(preflightGuardIndex > preRoomPeekIndex, "pre-room preflight should be guarded by reusable media proof");
  assert.ok(preflightIndex > preflightGuardIndex, "browser media preflight should remain before room acquisition by default");
  assert.ok(acquireRoomIndex > preflightIndex, "room preparation should happen after default media preflight");
  assert.ok(roomBoundPeekIndex > acquireRoomIndex, "Daily prewarm must be revalidated against the prepared room");
  assert.ok(consumePrewarmIndex > roomBoundPeekIndex, "Daily prewarm consume should stay room-bound");
  assert.ok(fallbackGetUserMediaIndex > consumePrewarmIndex, "fallback capture should stay behind room-bound prewarm consume");
  assert.match(webVideoCall, /const reusableDailyPrewarmBeforeRoom =[\s\S]{0,120}prewarmPendingBeforeRoom/);
  assert.match(webVideoCall, /const runMediaPreflightBeforeRoom =[\s\S]{0,120}!reusableDailyPrewarmBeforeRoom/);
  assert.match(webVideoCall, /hasPendingWebVideoDateDailyPrewarm\(\{ sessionId, userId \}\)/);
  assert.match(webVideoCall, /daily_media_permission_preflight_skipped_before_room/);
  assert.match(webVideoCall, /daily_media_permission_preflight_skipped_for_reused_daily_media/);
  assert.match(webVideoCall, /source:[\s\S]{0,180}"daily_prewarm_pending"/);
});

test("web and native date routes wait briefly for matching Ready Gate Daily prewarm before fallback", () => {
  assert.match(webDailyPrewarm, /pendingPrewarmStarts/);
  assert.match(webDailyPrewarm, /WEB_DAILY_PREWARM_PENDING_CONSUME_WAIT_MS = 900/);
  assert.match(webDailyPrewarm, /consumeWebVideoDateDailyPrewarmWhenReady/);
  assert.match(webDailyPrewarm, /reason: "pending_timeout"/);
  assert.match(webVideoCall, /await consumeWebVideoDateDailyPrewarmWhenReady\(\{/);
  assert.match(webVideoCall, /daily_prewarm_fallback[\s\S]{0,160}reason: prewarmedCall\.reason/);

  assert.match(nativeDailyPrewarm, /pendingPrewarmStarts/);
  assert.match(nativeDailyPrewarm, /NATIVE_DAILY_PREWARM_PENDING_CONSUME_WAIT_MS = 900/);
  assert.match(nativeDailyPrewarm, /consumeNativeVideoDateDailyPrewarmWhenReady/);
  assert.match(nativeDailyPrewarm, /reason: "pending_timeout"/);
  assert.match(nativeDate, /await consumeNativeVideoDateDailyPrewarmWhenReady\(\{/);
  assert.match(nativeDate, /daily_prewarm_fallback[\s\S]{0,160}reason: prewarmedCall\.reason/);
});
