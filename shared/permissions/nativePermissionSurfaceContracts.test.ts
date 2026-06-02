import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readRepo(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function findRepoFilesContaining(pattern: RegExp, relativeDir: string): string[] {
  const hits: string[] = [];
  const visit = (relativePath: string) => {
    const absolutePath = join(repoRoot, relativePath);
    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(absolutePath)) {
        if (entry === "node_modules" || entry === ".expo" || entry === "ios") continue;
        visit(join(relativePath, entry));
      }
      return;
    }
    if (!/\.(ts|tsx|json)$/.test(relativePath)) return;
    if (pattern.test(readFileSync(absolutePath, "utf8"))) hits.push(relativePath);
  };
  visit(relativeDir);
  return hits;
}

test("native Vibe Clip permission surface cannot reuse flex-filled preview buttons", () => {
  const source = readRepo("apps/mobile/app/chat/[id].tsx");
  const primaryStyle = /nativeClipPrimaryButton:\s*\{([\s\S]*?)\n\s*\},/.exec(source)?.[1] ?? "";
  const secondaryStyle = /nativeClipSecondaryButton:\s*\{([\s\S]*?)\n\s*\},/.exec(source)?.[1] ?? "";

  assert.doesNotMatch(primaryStyle, /\bflex:\s*1\b/);
  assert.doesNotMatch(secondaryStyle, /\bflex:\s*1\b/);
  assert.match(source, /native-vibe-clip-permission-card/);
  assert.match(source, /nativeClipPreviewActionButton:\s*\{[\s\S]*?\bflex:\s*1\b/);
});

test("native media pickers do not preflight broad photo-library permission", () => {
  const chat = readRepo("apps/mobile/app/chat/[id].tsx");
  const vibeVideo = readRepo("apps/mobile/app/vibe-video-record.tsx");
  const photoBatch = readRepo("apps/mobile/lib/photoBatchController.ts");
  const appConfig = JSON.parse(readRepo("apps/mobile/app.base.json")) as {
    expo?: {
      android?: {
        permissions?: string[];
        blockedPermissions?: string[];
      };
    };
  };
  const androidPermissions = appConfig.expo?.android?.permissions ?? [];
  const androidBlockedPermissions = appConfig.expo?.android?.blockedPermissions ?? [];
  const repoHits = findRepoFilesContaining(/requestMediaLibraryPermissionsAsync/, "apps/mobile");

  assert.doesNotMatch(chat, /requestMediaLibraryPermissionsAsync/);
  assert.doesNotMatch(vibeVideo, /requestMediaLibraryPermissionsAsync/);
  assert.doesNotMatch(photoBatch, /requestMediaLibraryPermissionsAsync/);
  assert.ok(!androidPermissions.includes("android.permission.READ_MEDIA_IMAGES"));
  assert.ok(!androidPermissions.includes("android.permission.READ_MEDIA_VIDEO"));
  assert.ok(!androidPermissions.includes("android.permission.READ_EXTERNAL_STORAGE"));
  assert.ok(!androidPermissions.includes("android.permission.READ_MEDIA_VISUAL_USER_SELECTED"));
  assert.ok(androidBlockedPermissions.includes("android.permission.READ_MEDIA_IMAGES"));
  assert.ok(androidBlockedPermissions.includes("android.permission.READ_MEDIA_VIDEO"));
  assert.ok(androidBlockedPermissions.includes("android.permission.READ_EXTERNAL_STORAGE"));
  assert.ok(androidBlockedPermissions.includes("android.permission.READ_MEDIA_VISUAL_USER_SELECTED"));
  assert.deepEqual(repoHits, []);
});

test("native iOS permission purpose strings stay scoped to shipped permission requests", () => {
  const appConfig = JSON.parse(readRepo("apps/mobile/app.base.json")) as {
    expo?: { ios?: { infoPlist?: Record<string, unknown> } };
  };
  const infoPlist = appConfig.expo?.ios?.infoPlist ?? {};

  assert.equal(typeof infoPlist.NSCameraUsageDescription, "string");
  assert.equal(typeof infoPlist.NSMicrophoneUsageDescription, "string");
  assert.equal(typeof infoPlist.NSSpeechRecognitionUsageDescription, "string");
  assert.equal(typeof infoPlist.NSLocationWhenInUseUsageDescription, "string");
  assert.equal(infoPlist.NSLocationAlwaysAndWhenInUseUsageDescription, undefined);
});

test("native reusable permission card uses fixed-height actions", () => {
  const source = readRepo("apps/mobile/components/permissions/PermissionRecoveryCard.tsx");
  assert.match(source, /minHeight:\s*48/);
  assert.doesNotMatch(source, /\bflex:\s*1\b/);
  assert.match(source, /availableWidth = Math\.max\(0, width - 32\)/);
  assert.match(source, /adjustsFontSizeToFit/);
  assert.match(source, /minimumFontScale=\{0\.82\}/);
  assert.match(source, /Open Settings|primaryLabel/);
});

test("native Ready Gate checks existing media permission before showing an OS prompt", () => {
  const standalone = readRepo("apps/mobile/app/ready/[id].tsx");
  const overlay = readRepo("apps/mobile/components/lobby/ReadyGateOverlay.tsx");

  for (const source of [standalone, overlay]) {
    assert.match(source, /checkNativeCameraMicrophonePermissions/);
    assert.match(source, /const checkMediaPermissions = useCallback/);
    assert.match(source, /refresh: checkMediaPermissions/);
    assert.match(source, /const mediaPermissionNeedsSettings/);
    assert.match(source, /const mediaPermissionPrimaryLabel = mediaPermissionNeedsSettings \? 'Open Settings' : 'Allow camera & mic'/);
    assert.match(source, /current\.cameraPermissionStatus === 'blocked'/);
    assert.match(source, /current\.microphonePermissionStatus === 'blocked'/);
  }

  const standaloneAutoCheck = /void \(async \(\) => \{[\s\S]*?const ok = await checkMediaPermissions\(\);[\s\S]*?\}\)\(\);/.exec(standalone)?.[0] ?? "";
  const overlayAutoCheck = /void \(async \(\) => \{[\s\S]*?const ok = await checkMediaPermissions\(\);[\s\S]*?\}\)\(\);/.exec(overlay)?.[0] ?? "";

  assert.ok(standaloneAutoCheck);
  assert.ok(overlayAutoCheck);
  assert.doesNotMatch(standaloneAutoCheck, /requestMediaPermissions\(\)/);
  assert.doesNotMatch(overlayAutoCheck, /requestMediaPermissions\(\)/);
});

test("native Android media denial remembers don't-ask-again across passive checks", () => {
  const helper = readRepo("apps/mobile/lib/nativeMediaPermissions.ts");

  assert.match(helper, /@react-native-async-storage\/async-storage/);
  assert.match(helper, /ANDROID_MEDIA_PERMISSION_BLOCKED_STORAGE_KEY/);
  assert.match(helper, /readAndroidBlockedMediaPermissions/);
  assert.match(helper, /writeAndroidBlockedMediaPermissions/);
  assert.match(helper, /rememberAndroidMediaPermissionResult/);
  assert.match(helper, /PermissionsAndroid\.RESULTS\.NEVER_ASK_AGAIN/);
  assert.match(helper, /rememberedBlocked\.camera[\s\S]*PermissionsAndroid\.RESULTS\.NEVER_ASK_AGAIN/);
  assert.match(helper, /rememberedBlocked\.microphone[\s\S]*PermissionsAndroid\.RESULTS\.NEVER_ASK_AGAIN/);
  assert.match(helper, /cameraStatus === PermissionsAndroid\.RESULTS\.GRANTED[\s\S]*\?\s*false/);
  assert.match(helper, /microphoneStatus === PermissionsAndroid\.RESULTS\.GRANTED[\s\S]*\?\s*false/);
});

test("native profile Vibe Video library intent is not camera-gated and has file fallback", () => {
  const source = readRepo("apps/mobile/app/vibe-video-record.tsx");

  assert.match(source, /sourceIntent !== 'library' && !libraryParam/);
  assert.match(source, /native-profile-vibe-video-library-card/);
  assert.match(source, /getDocumentAsyncSafe/);
  assert.match(source, /type: \['video\/mp4', 'video\/quicktime', 'video\/\*'\]/);
  assert.match(source, /chooseFileSupported[\s\S]*Choose file/);
  assert.match(source, /secondaryLabel="Record instead"/);
});

test("native Vibe Clip captions are optional and speech permission is user-initiated", () => {
  const hook = readRepo("apps/mobile/hooks/useNativeCaptionCapture.ts");
  const chat = readRepo("apps/mobile/app/chat/[id].tsx");
  const startBody = /const start = useCallback\(async \(\): Promise<boolean> => \{([\s\S]*?)\n\s*\}, \[markUnavailable/.exec(hook)?.[1] ?? "";

  assert.match(hook, /getPermissionsAsync/);
  assert.match(hook, /const requestPermission = useCallback/);
  assert.doesNotMatch(startBody, /requestPermissionsAsync/);
  assert.match(chat, /Enable captions/);
  assert.match(chat, /Continue without captions/);
  assert.match(chat, /Recording without captions/);
});

test("native saved-video Vibe Clip picker has a real file fallback", () => {
  const chat = readRepo("apps/mobile/app/chat/[id].tsx");

  assert.match(chat, /const pickVideoFromDocument = async/);
  assert.match(chat, /getDocumentAsyncSafe\(\{[\s\S]*type: \['video\/mp4', 'video\/quicktime', 'video\/webm', 'video\/\*'\]/);
  assert.match(chat, /const enqueuePickedVibeClipVideo = async/);
  assert.match(chat, /durationSecondsForVideoAsset/);
  assert.match(chat, /createVideoPlayer/);
  assert.match(chat, /Choose file/);
  assert.match(chat, /native_chat_video_library/);
});

test("native permission settings recovery is centralized and refreshes on app return", () => {
  const helper = readRepo("apps/mobile/lib/permissionSettings.ts");
  const matchCall = readRepo("apps/mobile/lib/useMatchCall.tsx");
  const notificationStep = readRepo("apps/mobile/components/onboarding/steps/NotificationStep.tsx");
  const directOpenSettingsHits = findRepoFilesContaining(/Linking\.openSettings\(/, "apps/mobile")
    .filter((path) => path !== "apps/mobile/lib/permissionSettings.ts");

  assert.match(helper, /export async function openPermissionSettings/);
  assert.match(helper, /Linking\.openSettings\(\)/);
  assert.match(helper, /Linking\.openURL\('app-settings:'\)/);
  assert.match(helper, /export function useSettingsReturnRefresh/);
  assert.match(helper, /AppState\.addEventListener\('change'/);
  assert.match(matchCall, /matchCallPermissionSettingsTargetRef/);
  assert.match(matchCall, /retryMatchCallMediaAfterSettingsReturn/);
  assert.match(matchCall, /next === 'active'[\s\S]*retryMatchCallMediaAfterSettingsReturn/);
  assert.match(matchCall, /setLocalAudio\(true\)/);
  assert.match(matchCall, /setLocalVideo\(true\)/);
  assert.match(notificationStep, /settingsRecoveryActiveRef/);
  assert.match(notificationStep, /syncBackendAfterPushGrant\(promptUserId\)\.finally\(\(\) => \{/);
  assert.match(notificationStep, /activeUserIdRef\.current === promptUserId/);
  assert.doesNotMatch(notificationStep, /openSettings\(\);\s*setShowDeniedRecovery\(false\)/);
  assert.deepEqual(directOpenSettingsHits, []);
});

test("native match calls preflight local media before Daily room work", () => {
  const source = readRepo("apps/mobile/lib/useMatchCall.tsx");
  const answer = /const acceptCall = useCallback\(async \(\) => \{([\s\S]*?)let answeredRoomName/.exec(source)?.[1] ?? "";
  const start = /const startCall = useCallback\(\s*async \(\{ matchId, type, partnerUserId, partnerName, partnerAvatarUri \}: StartCallParams\) => \{([\s\S]*?)logMatchCallDiag\('start_call_invoked'/.exec(source)?.[1] ?? "";

  assert.match(source, /requestNativeMatchCallMediaPermission/);
  assert.match(source, /match_call_voice/);
  assert.match(source, /match_call_video/);
  assert.match(source, /requestNativeCameraMicrophonePermissions/);
  assert.match(answer, /requestNativeMatchCallMediaPermission\(pendingIncoming\.callType\)/);
  assert.match(answer, /answer_call_media_preflight_blocked/);
  assert.match(start, /requestNativeMatchCallMediaPermission\(type\)/);
  assert.match(start, /start_call_media_preflight_blocked/);
  const startCallIndex = source.indexOf("const startCall = useCallback");
  const preflightIndex = source.indexOf("requestNativeMatchCallMediaPermission(type)", startCallIndex);
  const createIndex = source.indexOf("createMatchCall(matchId, type)", startCallIndex);
  assert.ok(
    startCallIndex >= 0 && preflightIndex > startCallIndex && createIndex > preflightIndex,
    "start call should preflight before creating or joining a Daily room",
  );
});

test("native photo verification refreshes permission state after Settings without auto-launching camera", () => {
  const source = readRepo("apps/mobile/components/verification/PhotoVerificationFlow.tsx");
  const settingsRefresh = /useSettingsReturnRefresh\(\{([\s\S]*?)\}\);/.exec(source)?.[1] ?? "";

  assert.match(source, /const refreshCameraPermissionState = useCallback/);
  assert.match(source, /ImagePicker\.getCameraPermissionsAsync\(\)/);
  assert.match(settingsRefresh, /refresh: refreshCameraPermissionState/);
  assert.doesNotMatch(settingsRefresh, /refresh: startCapture/);
});

test("native Vibe Clip recordAsync failures keep persistent recovery UI", () => {
  const source = readRepo("apps/mobile/app/chat/[id].tsx");

  assert.match(source, /recordingRecoveryStatus/);
  assert.match(source, /classifyNativeMediaCaptureError\(recordingError\)/);
  assert.match(source, /nativeClipRecordingRecoveryPanel/);
  assert.match(source, /native_chat_vibe_clip_recording_error/);
  assert.match(source, /primaryAction === 'upload_file'[\s\S]*onChooseSavedVideo\(\)/);
  assert.match(source, /onPress=\{onChooseSavedVideo\}/);
});

test("native profile Vibe Video recordAsync failures use persistent permission recovery", () => {
  const source = readRepo("apps/mobile/app/vibe-video-record.tsx");
  const startRecording = /const startRecording = async \(\) => \{([\s\S]*?)\n\s*\};/.exec(source)?.[1] ?? "";

  assert.match(source, /recordingRecoveryStatus/);
  assert.match(source, /native-profile-vibe-video-recording-recovery-card/);
  assert.match(source, /classifyNativeMediaCaptureError\(e\)/);
  assert.match(source, /primaryAction === 'upload_file'[\s\S]*pickFromLibrary\(\)/);
  assert.doesNotMatch(startRecording, /title:\s*'Recording failed'/);
});

test("native onboarding location fallback cannot bypass confirmed-location contract", () => {
  const step = readRepo("apps/mobile/components/onboarding/steps/LocationStep.tsx");
  const parent = readRepo("apps/mobile/app/(onboarding)/index.tsx");

  assert.match(step, /hasConfirmedOnboardingLocation/);
  assert.match(step, /disabled=\{!confirmedLocation\}/);
  assert.doesNotMatch(step, /Use typed city without coordinates/);
  assert.doesNotMatch(step, /applyTypedCityOnly/);
  assert.match(parent, /country=\{data\.country\}/);
  assert.match(parent, /locationData=\{data\.locationData\}/);
});

test("native photo verification honors non-retryable permission actions", () => {
  const source = readRepo("apps/mobile/components/verification/PhotoVerificationFlow.tsx");
  const handler = /const handlePermissionRecoveryPress = useCallback\(\(\) => \{([\s\S]*?)\n\s*\},/.exec(source)?.[1] ?? "";

  assert.match(handler, /primaryAction === 'open_settings'/);
  assert.match(handler, /primaryAction === 'request'[\s\S]*primaryAction === 'retry'/);
  assert.match(handler, /setPermissionRecovery\(null\)/);
  assert.doesNotMatch(handler, /void startCapture\(\);\s*return;\s*\}\s*void startCapture\(\)/);
});

test("native chat photo camera runtime failures expose retry and library recovery", () => {
  const modal = readRepo("apps/mobile/components/chat/ChatPhotoCameraModal.tsx");
  const chat = readRepo("apps/mobile/app/chat/[id].tsx");

  assert.match(modal, /showCameraRecovery/);
  assert.match(modal, /classifyNativeMediaCaptureError/);
  assert.match(modal, /native_chat_photo_camera_runtime/);
  assert.match(modal, /primaryAction === 'use_picker'[\s\S]*chooseFromLibrary\(\)/);
  assert.match(chat, /onChooseFromLibrary=\{\(\) => \{/);
});

test("native profile photo picker and camera launch failures stay recoverable", () => {
  const photoBatch = readRepo("apps/mobile/lib/photoBatchController.ts");

  assert.match(photoBatch, /showPhotoPickerFailureDialog/);
  assert.match(photoBatch, /showCameraLaunchFailureDialog/);
  assert.match(photoBatch, /openPermissionSettings\('photo_batch_camera_permission'\)/);
  assert.match(photoBatch, /openPermissionSettings\(source\)/);
  assert.match(photoBatch, /catch \(error\)[\s\S]*showPhotoPickerFailureDialog/);
  assert.match(photoBatch, /catch \(error\)[\s\S]*showCameraLaunchFailureDialog/);
});

test("native chat game photo pickers recover camera and library permission failures", () => {
  const bubble = readRepo("apps/mobile/components/chat/games/ScavengerBubble.tsx");
  const startSheet = readRepo("apps/mobile/components/chat/games/ScavengerStartSheet.tsx");
  const helper = readRepo("apps/mobile/lib/nativeMediaPickerErrors.ts");

  for (const source of [bubble, startSheet]) {
    assert.match(source, /isNativeMediaPermissionError/);
    assert.match(source, /capability: fromCamera \? 'photo_capture' : 'photo_picker'/);
    assert.match(source, /Choose from library/);
    assert.match(source, /Take photo/);
    assert.match(source, /Camera issue/);
  }
  assert.match(bubble, /useMediaAsset/);
  assert.match(bubble, /senderPhotoMessageId/);
  assert.match(bubble, /receiverPhotoMessageId/);
  assert.match(startSheet, /senderPhotoPreviewUri/);
  assert.match(helper, /isNativeMediaPermissionError/);
  assert.match(helper, /classifyNativeMediaCaptureError/);
});
