#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relPath) {
  return readFileSync(path.join(root, relPath), "utf8");
}

const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function extractStringConst(source, name, relPath) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*"([^"]*)"`));
  assert(Boolean(match), `${relPath}: missing ${name} string constant`);
  return match?.[1] ?? "";
}

function sliceBetween(source, start, end, relPath) {
  const startIndex = source.indexOf(start);
  assert(startIndex >= 0, `${relPath}: missing marker ${start}`);
  if (startIndex < 0) return "";
  const endIndex = source.indexOf(end, startIndex);
  assert(endIndex >= 0, `${relPath}: missing marker ${end}`);
  return source.slice(startIndex, endIndex >= 0 ? endIndex : undefined);
}

function assertNoCropTokens(label, value) {
  assert(!/\bobject-cover\b/.test(value), `${label}: must not use object-cover`);
  assert(!/\bscale-[^\s"'`]+/.test(value), `${label}: must not use Tailwind scale-*`);
  assert(!/\b(?:transform|translate|rotate|skew)(?:-[^\s"'`]+)?\b/.test(value), `${label}: must not use transform utilities`);
  assert(!/\boverflow-hidden\b/.test(value), `${label}: must not hide overflow around the remote video`);
}

const webDatePath = "src/pages/VideoDate.tsx";
const webDate = read(webDatePath);
const webVideoCallPath = "src/hooks/useVideoCall.ts";
const webVideoCall = read(webVideoCallPath);
const webDailyConfigPath = "src/lib/dailyCallObjectConfig.ts";
const webDailyConfig = read(webDailyConfigPath);
const webDailyPrewarmPath = "src/lib/videoDateDailyPrewarm.ts";
const webDailyPrewarm = read(webDailyPrewarmPath);
const readyGateOverlayPath = "src/components/lobby/ReadyGateOverlay.tsx";
const readyGateOverlay = read(readyGateOverlayPath);
const mediaContractPath = "shared/matching/videoDateMediaContract.ts";
const mediaContract = read(mediaContractPath);
const cameraSwitchHintPath = "shared/matching/videoDateCameraSwitchRenderHint.ts";
const cameraSwitchHint = read(cameraSwitchHintPath);
const webRemoteContainerClass = extractStringConst(webDate, "REMOTE_DATE_VIDEO_CONTAINER_CLASS", webDatePath);
const webRemoteVideoClass = extractStringConst(webDate, "REMOTE_DATE_VIDEO_CLASS", webDatePath);
const webRemoteRender = sliceBetween(
  webDate,
  "Remote Video with Progressive Blur",
  "<SelfViewPIP",
  webDatePath
);

assert(
  webRemoteContainerClass === "flex-1 relative bg-black",
  `${webDatePath}: remote date container must stay exactly "flex-1 relative bg-black"`
);
assert(
  webDate.includes("data-video-date-stage") &&
    webDate.includes("md:w-[min(calc(100vw_-_2rem),500px)]") &&
    webDate.includes("md:h-[min(calc(100dvh_-_2rem),920px)]"),
  `${webDatePath}: desktop Video Date must render inside the centered date stage contract`
);
assert(
  webRemoteVideoClass === "w-full h-full object-contain object-center",
  `${webDatePath}: remote date video must stay exactly "w-full h-full object-contain object-center"`
);
assertNoCropTokens(`${webDatePath}: REMOTE_DATE_VIDEO_CONTAINER_CLASS`, webRemoteContainerClass);
assertNoCropTokens(`${webDatePath}: REMOTE_DATE_VIDEO_CLASS`, webRemoteVideoClass);
assert(
  webRemoteRender.includes("className={REMOTE_DATE_VIDEO_CONTAINER_CLASS}"),
  `${webDatePath}: remote date render must use REMOTE_DATE_VIDEO_CONTAINER_CLASS`
);
assert(
  webRemoteRender.includes("className={REMOTE_DATE_VIDEO_CLASS}"),
  `${webDatePath}: remote date render must use REMOTE_DATE_VIDEO_CLASS`
);
assert(
  webRemoteRender.includes("objectFit: VIDEO_DATE_REMOTE_OBJECT_FIT"),
  `${webDatePath}: remote date video must keep inline objectFit from the shared contract`
);
assert(
  webRemoteRender.includes("objectPosition: VIDEO_DATE_REMOTE_OBJECT_POSITION"),
  `${webDatePath}: remote date video must keep inline objectPosition from the shared contract`
);
assert(
  webRemoteRender.includes('backgroundColor: "#000"'),
  `${webDatePath}: remote date video must keep an inline black letterbox background`
);
assert(!/style=\{\{[^}]*\btransform\s*:/.test(webRemoteRender), `${webDatePath}: remote date video style must not set transform`);
assert(!/style=\{\{[^}]*\bscale\s*:/.test(webRemoteRender), `${webDatePath}: remote date video style must not set scale`);
assert(
  mediaContract.includes('VIDEO_DATE_REMOTE_OBJECT_FIT = "contain"'),
  `${mediaContractPath}: remote Video Date fit must remain contain`
);
assert(
  mediaContract.includes('VIDEO_DATE_SELF_VIEW_OBJECT_FIT = "contain"'),
  `${mediaContractPath}: self-view Video Date fit must preserve the full local frame`
);
assert(
  mediaContract.includes("VIDEO_DATE_WEB_IDEAL_VIDEO_CONSTRAINTS") &&
    mediaContract.includes("VIDEO_DATE_WEB_PORTRAIT_MEDIUM_VIDEO_CONSTRAINTS") &&
    mediaContract.includes("VIDEO_DATE_WEB_PORTRAIT_COMPATIBLE_VIDEO_CONSTRAINTS") &&
    mediaContract.includes("VIDEO_DATE_WEB_CAPTURE_PROFILE_ORDER") &&
    mediaContract.includes("VIDEO_DATE_NATIVE_IDEAL_VIDEO_CONSTRAINTS") &&
    mediaContract.includes("VIDEO_DATE_CAPTURE_ASPECT_RATIO = 9 / 16"),
  `${mediaContractPath}: shared capture contract must keep progressive web portrait profiles and native defaults explicit`
);
assert(
  cameraSwitchHint.includes('VIDEO_DATE_CAMERA_SWITCH_RENDER_HINT_TYPE = "video_date_camera_switch_render_hint"') &&
    /VIDEO_DATE_CAMERA_SWITCH_RENDER_HINT_VERSION\s*=\s*1/.test(cameraSwitchHint) &&
    cameraSwitchHint.includes("createVideoDateCameraSwitchRenderHint") &&
    cameraSwitchHint.includes("parseVideoDateCameraSwitchRenderHint") &&
    cameraSwitchHint.includes('VideoDateCameraSwitchRenderHintPlatform = "web" | "native"') &&
    cameraSwitchHint.includes("sourcePlatform: VideoDateCameraSwitchRenderHintPlatform") &&
    cameraSwitchHint.includes("commitConfirmed?: boolean") &&
    cameraSwitchHint.includes("commitMethod?: string | null") &&
    cameraSwitchHint.includes("localVideoTrackId?: string | null") &&
    cameraSwitchHint.includes("commitLatencyMs?: number | null"),
  `${cameraSwitchHintPath}: camera-switch render hint contract must remain shared, versioned, parseable, and backward-compatible with optional commit fields`
);
assert(
  !/^[^/]*\bpublishSequence\??:\s*number/m.test(cameraSwitchHint) &&
    !/^[^/]*\bpublishRefreshApplied\??:\s*boolean/m.test(cameraSwitchHint) &&
    !/^[^/]*\bhintSequence\??:\s*number/m.test(cameraSwitchHint),
  `${cameraSwitchHintPath}: deprecated publishSequence/publishRefreshApplied/hintSequence fields must not reappear on the hint type`
);
assert(
  webDailyConfig.includes("dailyVideoDateCallObjectOptions") &&
    webDailyConfig.includes("dailyVideoDateCallObjectOptionsWithAppAcquiredMedia") &&
    webDailyConfig.includes("videoDateWebMediaStreamConstraints") &&
    webDailyConfig.includes("appAcquiredMedia?.videoTrack") &&
    webDailyConfig.includes("inputSettings") &&
    webDailyConfig.includes("settings: videoConstraints") &&
    webDailyConfig.includes("avoidEval: true") &&
    webDailyConfig.includes("experimentalChromeVideoMuteLightOff: true") &&
    webDailyConfig.includes("DailyAdvancedConfigWithVideoDateKnobs"),
  `${webDailyConfigPath}: web Video Date Daily options must use the shared CSP-safe media helper`
);
assert(
  !webDailyConfig.includes("userMediaVideoConstraints"),
  `${webDailyConfigPath}: web Video Date Daily options must not use deprecated userMediaVideoConstraints`
);
assert(
  webVideoCall.includes("dailyVideoDateCallObjectOptions(captureProfileForCall)") &&
    webVideoCall.includes("dailyVideoDateCallObjectOptionsWithAppAcquiredMedia") &&
    webVideoCall.includes("appAcquiredMediaRef") &&
    webVideoCall.includes("consumedByDaily = true") &&
    webVideoCall.includes("permission_handoff_media_acquired") &&
    webVideoCall.includes("prewarmAppAcquiredMedia") &&
    webVideoCall.includes('releaseAppAcquiredMedia("daily_room_failed_after_media_preflight")'),
  `${webVideoCallPath}: Video Date must create its Daily call object through helpers, prefer app-acquired capture, and release preflight media on room failure`
);
assert(
  webDailyPrewarm.includes("dailyVideoDateCallObjectOptionsWithAppAcquiredMedia") &&
    webDailyPrewarm.includes("appAcquiredMedia: WebDailyPrewarmAppAcquiredMedia | null") &&
    readyGateOverlay.includes("permissionPrewarmMediaRef") &&
    readyGateOverlay.includes("appAcquiredMedia: prewarmMedia") &&
    readyGateOverlay.includes("captureProfile: permissionPrewarmMediaRef.current?.captureProfile") &&
    webVideoCall.includes('permissionHandoff.captureProfile ?? "ideal"'),
  `${webDailyPrewarmPath}/${readyGateOverlayPath}: Ready Gate Daily prewarm must transfer app-acquired media instead of reopening capture through Daily`
);
assert(
  webVideoCall.includes("REMOTE_RENDER_RECOVERY_MAX_ATTEMPTS_PER_TRACK") &&
    webVideoCall.includes("scheduleRemoteRenderValidation") &&
    webVideoCall.includes("requestVideoFrameCallback") &&
    webVideoCall.includes("forceRemoteMediaReattach") &&
    webVideoCall.includes("daily_remote_same_track_render_validated") &&
    webVideoCall.includes("daily_remote_render_validation_timed_out"),
  `${webVideoCallPath}: web receiver must validate same-track remote frame rendering and recover blank camera-switch renders`
);
assert(
  webVideoCall.includes("createVideoDateCameraSwitchRenderHint") &&
    webVideoCall.includes("parseVideoDateCameraSwitchRenderHint") &&
    webVideoCall.includes("sendAppMessage") &&
    webVideoCall.includes("waitForLocalCameraSwitchCommit") &&
    webVideoCall.includes("setInputDevicesAsync") &&
    webVideoCall.includes("videoSource: false") &&
    webVideoCall.includes("REMOTE_CAMERA_SWITCH_FRESH_FRAME_TIMEOUT_MS") &&
    webVideoCall.includes("requireFreshFrame") &&
    webVideoCall.includes("freshFrameBaseline") &&
    webVideoCall.includes("freshFrameTimeoutMs") &&
    webVideoCall.includes("daily_camera_switch_video_source_restore_failed") &&
    webVideoCall.includes("dailyVideoTrackAdopted") &&
    webVideoCall.includes("video_date_camera_switch_committed") &&
    webVideoCall.includes("commitConfirmed: true") &&
    webVideoCall.includes("opts.expectedFacing !== before.facingMode") &&
    webVideoCall.includes("inferCameraFacingModeFromLabel") &&
    webVideoCall.includes("return currentDeviceId ? candidates[0] ?? null : null") &&
    webVideoCall.includes("daily_camera_switch_render_hint_received") &&
    webVideoCall.includes("daily_camera_switch_render_watch_started") &&
    webVideoCall.includes("daily_camera_switch_no_reattach_needed") &&
    webVideoCall.includes("sameTrackCameraSwitchCandidate") &&
    webVideoCall.includes("useFreshFrameGuard") &&
    webVideoCall.includes("fresh_frame_not_observed") &&
    webVideoCall.includes("app_message_camera_switch_hint") &&
    webVideoCall.includes('"camera_switch_hint"') &&
    !webVideoCall.includes("camera_switch_hint:${hint.switchId}"),
  `${webVideoCallPath}: web Video Date must commit a live camera switch before sending shared render hints`
);
// Guard against reintroducing the destructive srcObject teardown directly
// in the camera-switch hint receiver. The hint must arm the freshness
// watcher (scheduleRemoteRenderValidation) and let the validator escalate
// to forceRemoteMediaReattach only as a last resort, not unconditionally.
assert(
  !/isNewCameraSwitchHint\)\s*\{\s*forceRemoteMediaReattach\(/.test(webVideoCall),
  `${webVideoCallPath}: camera-switch hint receiver must not call forceRemoteMediaReattach unconditionally; that destroys the WebRTC decoder pipeline and was the recurring "remote sees black" regression`
);
assert(
  !webVideoCall.includes("CAMERA_SWITCH_HINT_RESEND_DELAY_MS") &&
    !webVideoCall.includes("cameraSwitchPublishSequenceRef") &&
    !webVideoCall.includes("cameraSwitchHintResendTimeoutRef"),
  `${webVideoCallPath}: deprecated camera-switch hint resend / publishSequence plumbing must stay removed`
);
const deterministicCameraSwitchIndex = webVideoCall.indexOf(
  "switchToDeterministicWebCamera(co, before, desiredFacing"
);
const cycleCameraFallbackIndex = webVideoCall.indexOf("co.cycleCamera", deterministicCameraSwitchIndex);
assert(
  deterministicCameraSwitchIndex >= 0 && cycleCameraFallbackIndex > deterministicCameraSwitchIndex,
  `${webVideoCallPath}: web camera switching must prefer deterministic publish refresh before cycleCamera fallback`
);
assert(
  webVideoCall.includes("remoteRenderRecoveryTrackAttemptsRef") &&
    webVideoCall.includes("remoteRenderRecoveryScopedAttemptsRef") &&
    webVideoCall.includes("REMOTE_RENDER_RECOVERY_MAX_ATTEMPTS_PER_TRACK") &&
    webVideoCall.includes("REMOTE_RENDER_RECOVERY_MAX_ATTEMPTS_PER_SCOPE") &&
    webVideoCall.includes("REMOTE_RENDER_RECOVERY_ATTEMPT_TTL_MS") &&
    webVideoCall.includes("REMOTE_RENDER_RECOVERY_MAX_ATTEMPT_KEYS") &&
    webVideoCall.includes("normalizeRemoteRenderRecoveryScope") &&
    webVideoCall.includes("pruneRemoteRenderRecoveryAttempts") &&
    webVideoCall.includes('reason: "recovery_already_in_flight"') &&
    /trackAttempts\s*>=\s*REMOTE_RENDER_RECOVERY_MAX_ATTEMPTS_PER_TRACK/.test(webVideoCall) &&
    /scopeAttempts\s*>=\s*(?:REMOTE_RENDER_RECOVERY_MAX_ATTEMPTS_PER_SCOPE|maxScopeAttemptsForScope)/.test(webVideoCall) &&
    webVideoCall.includes("daily_remote_render_recovery_skipped"),
  `${webVideoCallPath}: web receiver remote render recovery must be bounded by per-track and stable-scope guards`
);
assert(
  webVideoCall.includes("daily_remote_render_recovery_play_resolved") &&
    webVideoCall.includes("remote_render_recovery_followup") &&
    webVideoCall.includes("daily_remote_render_recovery_succeeded") &&
    webVideoCall.indexOf("daily_remote_render_recovery_play_resolved") <
      webVideoCall.indexOf("daily_remote_render_recovery_succeeded"),
  `${webVideoCallPath}: web forced reattach must validate a fresh frame before recording render recovery success`
);
assert(
  webVideoCall.includes("clearRemoteRenderValidation({ cancelReattach: true });") &&
    webVideoCall.includes('reason: "reconnect_grace_active"') &&
    webVideoCall.includes("daily_remote_render_validation_deferred"),
  `${webVideoCallPath}: web render validation must clear stale validators and defer forced reattach during reconnect grace`
);
assert(
  webVideoCall.includes("remote_render_recovery_exhausted") &&
    webVideoCall.includes("playRejected: true") &&
    webVideoCall.includes("Remote video paused. Tap to resume."),
  `${webVideoCallPath}: exhausted web render recovery must surface the existing user-visible retry path`
);
assert(
  /remoteRenderRecoveryInFlightRef\.current\?\.trackKey\s*===\s*remoteKey[\s\S]*?remoteRenderRecoveryInFlightRef\.current\s*=\s*null[\s\S]*?remoteRenderRecoveryReattachTimeoutRef\.current[\s\S]*?clearTimeout\(remoteRenderRecoveryReattachTimeoutRef\.current\)[\s\S]*?max_attempts_exhausted/.test(
    webVideoCall
  ),
  `${webVideoCallPath}: exhausted web render recovery must clear stale in-flight recovery and pending reattach timeout`
);
assert(
  webVideoCall.includes("scheduleRemoteRenderValidationRef.current = scheduleRemoteRenderValidation;") &&
    !/useEffect\(\(\)\s*=>\s*\{\s*scheduleRemoteRenderValidationRef\.current\s*=\s*scheduleRemoteRenderValidation;/.test(
      webVideoCall
    ),
  `${webVideoCallPath}: web recovery follow-up validation ref must be assigned synchronously to avoid early recovery races`
);
assert(
  !/createCallObject\(\s*\{[\s\S]*?videoSource:\s*true[\s\S]*?\}\s*\)/.test(webVideoCall),
  `${webVideoCallPath}: Video Date must not use raw Daily call-object media options`
);
assert(
  webVideoCall.includes("VIDEO_DATE_WEB_CAPTURE_PROFILE_ORDER") &&
    webVideoCall.includes("for (const profile of VIDEO_DATE_WEB_CAPTURE_PROFILE_ORDER)") &&
    webVideoCall.includes("getUserMedia(videoDateWebMediaStreamConstraints(profile))") &&
    webVideoCall.includes("VIDEO_DATE_SENDER_CAPTURE_DIAGNOSTIC"),
  `${webVideoCallPath}: permission preflight must walk progressive portrait capture profiles and emit sender diagnostics`
);
assert(
  !/getUserMedia\(\{\s*audio:\s*true,\s*video:\s*true\s*\}\)/.test(webVideoCall),
  `${webVideoCallPath}: permission preflight must not fall back to unconstrained { video: true }`
);

const nativeDatePath = "apps/mobile/app/date/[id].tsx";
const nativeDate = read(nativeDatePath);
const nativeVideoDateDailyConfigPath = "apps/mobile/lib/videoDateDailyMediaConfig.ts";
const nativeVideoDateDailyConfig = read(nativeVideoDateDailyConfigPath);
const nativeEventLobbyPath = "apps/mobile/app/event/[eventId]/lobby.tsx";
const nativeEventLobby = read(nativeEventLobbyPath);
const nativeDateNavigationGuardPath = "apps/mobile/lib/dateNavigationGuard.ts";
const nativeDateNavigationGuard = read(nativeDateNavigationGuardPath);
const nativeRemoteBlock = sliceBetween(
  nativeDate,
  "<View style={styles.remoteContainer}>",
  "<View style={[styles.localPip",
  nativeDatePath
);
const nativeIdealConstraints = sliceBetween(
  mediaContract,
  "export const VIDEO_DATE_NATIVE_IDEAL_VIDEO_CONSTRAINTS",
  "};",
  mediaContractPath
);
const nativeFallbackConstraints = sliceBetween(
  mediaContract,
  "export const VIDEO_DATE_NATIVE_FALLBACK_VIDEO_CONSTRAINTS",
  "};",
  mediaContractPath
);

assert(
  /remoteContainer:\s*\{[^}]*backgroundColor:\s*'#000'/.test(nativeDate),
  `${nativeDatePath}: remoteContainer must provide a black letterbox background`
);
assert(
  /<DailyMediaView[\s\S]*?mirror=\{false\}[\s\S]*?objectFit="contain"[\s\S]*?zOrder=\{0\}/.test(nativeRemoteBlock),
  `${nativeDatePath}: remote DailyMediaView must explicitly use mirror={false}, objectFit="contain", and zOrder={0}`
);
assert(
  !/<DailyMediaView[\s\S]*?objectFit="cover"[\s\S]*?zOrder=\{0\}/.test(nativeRemoteBlock),
  `${nativeDatePath}: remote DailyMediaView must not use objectFit="cover"`
);
assert(
  nativeRemoteBlock.includes("DailyMediaView defaults to cover"),
  `${nativeDatePath}: remote DailyMediaView must keep the invariant comment explaining contain`
);
assert(
  nativeDate.includes("createVideoDateCameraSwitchRenderHint") &&
    nativeDate.includes("parseVideoDateCameraSwitchRenderHint") &&
    nativeDate.includes("sendAppMessage") &&
    nativeDate.includes("waitForNativeCameraSwitchCommit") &&
    nativeDate.includes("setCamera") &&
    nativeDate.includes("enumerateDevices") &&
    nativeDate.includes("video_date_camera_switch_committed") &&
    nativeDate.includes("commitConfirmed: true") &&
    nativeDate.includes("expectedFacing !== before.facingMode") &&
    nativeDate.includes("nativeCameraDeviceFacingMode(targetDevice)") &&
    nativeDate.includes("nativeCameraDeviceKey") &&
    nativeDate.includes("nativeCameraFacingModeFromLabel(videoTrack?.label)") &&
    nativeDate.includes("native_camera_switch_render_hint_received") &&
    nativeDate.includes("native_camera_switch_render_hint_sent") &&
    nativeDate.includes("NATIVE_CAMERA_SWITCH_RENDER_WATCH_TTL_MS") &&
    nativeDate.includes("NATIVE_CAMERA_SWITCH_FRESH_FRAME_POLL_MS") &&
    nativeDate.includes("NATIVE_CAMERA_SWITCH_FRESH_FRAME_TIMEOUT_MS") &&
    nativeDate.includes("NATIVE_CAMERA_SWITCH_SAME_TRACK_REMOUNT_GRACE_MS") &&
    nativeDate.includes("activeNativeRemoteCameraSwitchRenderWatchRef") &&
    nativeDate.includes("scheduleNativeCameraSwitchFreshnessWatch") &&
    nativeDate.includes("readNativeCameraSwitchFreshness") &&
    nativeDate.includes("native_camera_switch_no_remount_needed") &&
    nativeDate.includes("native_camera_switch_render_watch_timed_out") &&
    nativeDate.includes("camera_switch_hint_received") &&
    nativeDate.includes("camera_switch_watch_active") &&
    nativeDate.includes("'camera_switch_hint'") &&
    !nativeDate.includes("camera_switch_hint:${hint.switchId}"),
  `${nativeDatePath}: native Video Date must commit a live camera switch before sending shared render hints`
);
const nativeFreshnessWatchStart = nativeDate.indexOf("const scheduleNativeCameraSwitchFreshnessWatch");
const nativeFreshnessWatchEnd = nativeDate.indexOf("useEffect(() => {", nativeFreshnessWatchStart);
const nativeFreshnessWatch =
  nativeFreshnessWatchStart > 0 && nativeFreshnessWatchEnd > nativeFreshnessWatchStart
    ? nativeDate.slice(nativeFreshnessWatchStart, nativeFreshnessWatchEnd)
    : "";
const unsupportedFreshnessBlock =
  nativeFreshnessWatch.match(/if \(!freshness\.supported\) \{[\s\S]*?\n[^\S\r\n]{8}\}/)?.[0] ??
  "";
assert(
  unsupportedFreshnessBlock.includes("native_camera_switch_render_watch_unverified") &&
    !/\breturn;/.test(unsupportedFreshnessBlock) &&
    /if \(elapsedMs >= NATIVE_CAMERA_SWITCH_FRESH_FRAME_TIMEOUT_MS\)[\s\S]*scheduleNativeRemoteRenderRemount/.test(
      nativeFreshnessWatch
    ) &&
    nativeFreshnessWatch.indexOf("nativeCameraSwitchFreshnessTimerRef.current = setTimeout") >
      nativeFreshnessWatch.indexOf("native_camera_switch_render_watch_unverified"),
  `${nativeDatePath}: native camera-switch freshness watch must keep polling unverified stats until timeout recovery`
);
// Guard against reintroducing the destructive remount-on-hint pattern. The
// native receiver must NOT remount <DailyMediaView /> in direct response to
// a camera-switch hint; that tears down the decoder pipeline and forces
// the receiver to wait for the next periodic keyframe.
assert(
  !/scheduleNativeRemoteRenderRemount\([^)]*'app_message_camera_switch_hint'/.test(nativeDate),
  `${nativeDatePath}: native camera-switch hint receiver must not call scheduleNativeRemoteRenderRemount; that was the recurring "remote sees black" regression`
);
assert(
  nativeDate.includes("NATIVE_REMOTE_RENDER_REMOUNT_MAX_ATTEMPTS_PER_SCOPE") &&
    nativeDate.includes("remoteMediaRenderNonce") &&
    nativeDate.includes("native_remote_render_remount_scheduled") &&
    nativeDate.includes("native_remote_render_remounted") &&
    nativeDate.includes("participant_updated_same_track") &&
    nativeRemoteBlock.includes("key={remoteMediaViewKey}"),
  `${nativeDatePath}: native receiver must use bounded keyed DailyMediaView remount recovery`
);
assert(
  nativeDate.includes("dailyParticipantSessionId(call.participants()?.local") &&
    nativeDate.includes("localParticipantSessionId") &&
    !nativeDate.includes("localParticipantId = dailyParticipantId(call.participants()?.local"),
  `${nativeDatePath}: native camera-switch self-origin guard must compare Daily app-message fromId to local session_id`
);
assert(
  nativeDate.includes("nativeRemoteRenderTrackAttemptsRef") &&
    nativeDate.includes("nativeRemoteRenderScopedAttemptsRef") &&
    nativeDate.includes("NATIVE_REMOTE_RENDER_REMOUNT_MAX_ATTEMPTS_PER_TRACK") &&
    nativeDate.includes("NATIVE_REMOTE_RENDER_REMOUNT_MAX_ATTEMPTS_PER_SCOPE") &&
    nativeDate.includes("NATIVE_REMOTE_RENDER_REMOUNT_ATTEMPT_TTL_MS") &&
    nativeDate.includes("NATIVE_REMOTE_RENDER_REMOUNT_MAX_ATTEMPT_KEYS") &&
    nativeDate.includes("normalizeNativeRemoteRenderRecoveryScope") &&
    nativeDate.includes("pruneNativeRemoteRenderAttemptMap") &&
    /trackAttempts\s*>=\s*NATIVE_REMOTE_RENDER_REMOUNT_MAX_ATTEMPTS_PER_TRACK/.test(nativeDate) &&
    /scopeAttempts\s*>=\s*(?:NATIVE_REMOTE_RENDER_REMOUNT_MAX_ATTEMPTS_PER_SCOPE|maxScopeAttemptsForScope)/.test(nativeDate) &&
    nativeDate.includes("max_attempts_reached"),
  `${nativeDatePath}: native receiver remount recovery must be bounded by per-track and stable-scope guards`
);
assert(
  !/\bwidth\s*:/.test(nativeIdealConstraints) &&
    !/\bheight\s*:/.test(nativeIdealConstraints) &&
    !/\bwidth\s*:/.test(nativeFallbackConstraints) &&
    !/\bheight\s*:/.test(nativeFallbackConstraints),
  `${mediaContractPath}: native capture constraints must not pin strict portrait width/height`
);
assert(
  nativeVideoDateDailyConfig.includes("createVideoDateDailyCallObject") &&
    nativeVideoDateDailyConfig.includes("videoDateNativeDailyCallOptions") &&
    nativeVideoDateDailyConfig.includes("videoSource: true") &&
    nativeVideoDateDailyConfig.includes("audioSource: true") &&
    nativeVideoDateDailyConfig.includes("sendSettings") &&
    nativeVideoDateDailyConfig.includes("quality-optimized"),
  `${nativeVideoDateDailyConfigPath}: native Video Date Daily options must use safe native defaults`
);
assert(
  !nativeVideoDateDailyConfig.includes("userMediaVideoConstraints") &&
    !nativeVideoDateDailyConfig.includes("dailyConfig") &&
    !nativeVideoDateDailyConfig.includes("videoDateNativeVideoConstraintsForProfile"),
  `${nativeVideoDateDailyConfigPath}: native Video Date Daily options must not use deprecated/strict capture constraints`
);
assert(
  nativeDate.includes("createVideoDateDailyCallObject(profile)") &&
    nativeDate.includes("daily_call_join_constraint_fallback"),
  `${nativeDatePath}: native Video Date must create Daily through the helper and retry with fallback constraints`
);
assert(
  !/Daily\.createCallObject\(/.test(nativeDate),
  `${nativeDatePath}: native Video Date route must not use raw Daily.createCallObject`
);
assert(
  nativeDate.includes("type SharedDailyCallEntryState") &&
    nativeDate.includes("joinPromise: Promise<void> | null") &&
    nativeDate.includes("daily_call_singleton_reuse_join_in_flight") &&
    nativeDate.includes("await sharedCall.joinPromise") &&
    nativeDate.includes("hydrateJoinedSharedCall"),
  `${nativeDatePath}: native Video Date must reuse/await same-session Daily join entries`
);
assert(
  !nativeDate.includes("reuse_probe_not_joined") && !nativeDate.includes("allowMultipleCallInstances"),
  `${nativeDatePath}: native Video Date must not release joining calls or allow multiple Daily instances`
);
assert(
  nativeDate.includes("showJoiningOverlay = (joining || isConnecting) && !localInDailyRoom") &&
    nativeDate.includes("showPeerWaitOverlay =") &&
    nativeDate.includes("diagnostic_scope: 'sender_capture'") &&
    nativeDate.includes("diagnostic_scope: 'receiver_layout'") &&
    nativeDate.includes("receiver_object_fit: VIDEO_DATE_REMOTE_OBJECT_FIT") &&
    nativeDate.includes("ensureNativeFrontCameraIntent") &&
    nativeDate.includes("getCameraFacingMode") &&
    nativeDate.includes("cycleCamera"),
  `${nativeDatePath}: native Video Date must hydrate active call UI and emit capture/layout diagnostics`
);
assert(
  nativeEventLobby.includes("dateLaunchIntentSessionRef") &&
    nativeEventLobby.includes("isDateEntryTransitionActive(rescueSid)") &&
    nativeEventLobby.includes("launch_already_in_progress") &&
    !nativeEventLobby.includes("bypassDuplicateBurstForRescue") &&
    !nativeDateNavigationGuard.includes("bypassDuplicateBurstForRescue"),
  `${nativeEventLobbyPath}: ready-gate rescue must be idempotent and must not bypass date navigation dedupe`
);

const selfViewPath = "src/components/video-date/SelfViewPIP.tsx";
const selfView = read(selfViewPath);
assert(
  selfView.includes("VIDEO_DATE_SELF_VIEW_OBJECT_FIT") &&
    selfView.includes("object-contain") &&
    selfView.includes("aspect-[9/16]") &&
    selfView.includes("Self-view must preserve"),
  `${selfViewPath}: self-view PIP must remain a 9:16 full-frame local preview`
);
assert(
  webRemoteRender.includes("remoteBackdropVideoRef") &&
    webRemoteRender.includes('aria-hidden="true"') &&
    webRemoteRender.includes("object-cover") &&
    webRemoteRender.includes("className={REMOTE_DATE_VIDEO_CLASS}") &&
    webDate.includes("VIDEO_DATE_RECEIVER_LAYOUT_DIAGNOSTIC"),
  `${webDatePath}: remote video must keep a full-frame primary video with a decorative blurred cover backdrop and receiver diagnostics`
);

const webMatchCallPath = "src/components/chat/ActiveCallOverlay.tsx";
const webMatchCall = read(webMatchCallPath);
assert(
  webMatchCall.includes("Match/chat calls are intentionally full-bleed today"),
  `${webMatchCallPath}: match/chat full-bleed crop behavior must stay documented`
);

const nativeMatchCallPath = "apps/mobile/components/chat/ActiveCallOverlay.tsx";
const nativeMatchCall = read(nativeMatchCallPath);
assert(
  nativeMatchCall.includes("Match/chat calls are intentionally full-bleed today"),
  `${nativeMatchCallPath}: native match/chat full-bleed crop behavior must stay documented`
);
assert(
  /<DailyMediaView[\s\S]*?mirror=\{false\}[\s\S]*?objectFit="cover"[\s\S]*?zOrder=\{0\}/.test(nativeMatchCall),
  `${nativeMatchCallPath}: native match/chat remote full-bleed crop must be explicit if it remains intentional`
);

if (failures.length > 0) {
  console.error("Video date remote frame audit failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Video date remote frame audit passed.");
