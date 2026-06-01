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
  assert.match(notificationStep, /syncBackendAfterPushGrant\(userId\)\.finally\(onNext\)/);
  assert.doesNotMatch(notificationStep, /openSettings\(\);\s*setShowDeniedRecovery\(false\)/);
  assert.deepEqual(directOpenSettingsHits, []);
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

  for (const source of [bubble, startSheet]) {
    assert.match(source, /isPermissionLikeMediaError/);
    assert.match(source, /capability: fromCamera \? 'photo_capture' : 'photo_picker'/);
    assert.match(source, /Choose from library/);
    assert.match(source, /Take photo/);
    assert.match(source, /Camera issue/);
  }
});
