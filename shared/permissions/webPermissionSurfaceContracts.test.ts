import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

test("web onboarding notification denial stays on recoverable UI instead of auto-advancing", () => {
  const source = read("src/pages/onboarding/steps/NotificationStep.tsx");

  assert.match(source, /const \[recovery, setRecovery\]/);
  assert.match(source, /Notification\.permission === "denied"/);
  assert.match(source, /Use your browser site settings/);
  assert.match(source, /Continue without notifications/);
  assert.doesNotMatch(source, /else\s*\{\s*onNext\(\);\s*\}/);
});

test("web push soft prompt keeps denied notifications recoverable in the drawer", () => {
  const source = read("src/components/PushPermissionPrompt.tsx");

  assert.match(source, /const \[recovery, setRecovery\]/);
  assert.match(source, /data-testid="push-permission-recovery"/);
  assert.match(source, /Notification\.permission === "denied"/);
  assert.match(source, /Use your browser site settings/);
  assert.match(source, /I updated settings/);
  assert.match(source, /Continue without notifications/);
  assert.doesNotMatch(source, /finally\s*\{\s*setOpen\(false\);/);
  assert.match(source, /if \(shouldClose\) \{/);
  assert.match(source, /resetPromptState\(\);[\s\S]*setOpen\(false\);/);
});

test("web dashboard and schedule push setup denial is recoverable", () => {
  const source = read("src/components/notifications/PushSetupFlow.tsx");

  assert.match(source, /data-testid="push-setup-flow-recovery"/);
  assert.match(source, /Notification\.permission/);
  assert.match(source, /Notifications Unavailable/);
  assert.match(source, /notificationsUnsupported \? null/);
  assert.match(source, /Use your browser site settings/);
  assert.match(source, /I updated settings/);
  assert.match(source, /Continue without alerts/);
  assert.doesNotMatch(source, />\s*Got it\s*</);
});

test("web push request helper does not re-prompt when browser permission is already blocked", () => {
  const source = read("src/lib/requestWebPushPermission.ts");
  const requestBody =
    /export async function requestWebPushPermissionAndSync\(userId: string\): Promise<PushSyncResult> \{([\s\S]*)\n\}/.exec(source)?.[1] ?? "";
  const deniedGuardIndex = requestBody.indexOf('initialPermissionState === "unsupported" || initialPermissionState === "denied"');
  const grantedGuardIndex = requestBody.indexOf('initialPermissionState === "granted"');
  const promptIndex = requestBody.indexOf("promptForPush()");

  assert.ok(deniedGuardIndex >= 0, "blocked/unsupported browser permission should have a pre-prompt guard");
  assert.ok(grantedGuardIndex > deniedGuardIndex, "already-granted permission should sync directly");
  assert.ok(promptIndex > grantedGuardIndex, "OneSignal prompt should only run after passive permission guards");
  assert.match(requestBody, /const result = syncResult\("permission_denied"\)/);
  assert.match(requestBody, /const result = await syncWebPushRegistrationToBackend\(userId\)/);
});

test("web event location failures render persistent retry recovery", () => {
  const source = read("src/pages/Events.tsx");

  assert.match(source, /const \[locationRecovery, setLocationRecovery\]/);
  assert.match(source, /Location is blocked for this site/);
  assert.match(source, /handleLocationModeChange\("nearby"\)/);
  assert.match(source, /Choose city/);
  assert.match(source, /const \[error, setError\]/);
});

test("web profile location detection has inline recovery beyond toast feedback", () => {
  const source = read("src/pages/ProfileStudio.tsx");
  const service = read("src/services/profileService.ts");

  assert.match(source, /const \[locationDetectError, setLocationDetectError\]/);
  assert.match(source, /setLocationDetectError\(message\)/);
  assert.match(source, /couldn't name the city/);
  assert.match(source, /Try again/);
  assert.match(service, /reverse_geocode_unresolved/);
  assert.doesNotMatch(service, /formatted:\s*"Location detected"/);
});

test("web voice messages keep persistent microphone recovery beyond toast feedback", () => {
  const source = read("src/components/chat/VoiceRecorder.tsx");

  assert.match(source, /const \[permissionResult, setPermissionResult\]/);
  assert.match(source, /data-testid="voice-recorder-permission-recovery"/);
  assert.match(source, /mediaPermissionTitle\(permissionResult\)/);
  assert.match(source, /mediaPermissionMessage\(permissionResult\)/);
  assert.match(source, /I updated settings/);
});

test("web match call blocked media controls keep persistent in-call recovery", () => {
  const hook = read("src/hooks/useMatchCall.tsx");
  const overlay = read("src/components/chat/ActiveCallOverlay.tsx");

  assert.match(hook, /requestWebMatchCallMediaPermission/);
  assert.match(hook, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(hook, /start_call_media_preflight_blocked/);
  assert.match(hook, /answer_call_media_preflight_blocked/);
  assert.match(hook, /data-testid="match-call-preflight-permission-recovery"/);
  const startCallIndex = hook.indexOf("const startCall = useCallback");
  const preflightIndex = hook.indexOf("requestWebMatchCallMediaPermission(type)", startCallIndex);
  const createIndex = hook.indexOf('supabase.functions.invoke("daily-room"', startCallIndex);
  assert.ok(
    startCallIndex >= 0 && preflightIndex > startCallIndex && createIndex > preflightIndex,
    "start call should preflight browser media before creating a Daily room",
  );
  assert.match(hook, /audioState === "blocked"[\s\S]*setLocalAudio\(true\)/);
  assert.match(hook, /videoState === "blocked"[\s\S]*setLocalVideo\(true\)/);
  assert.match(overlay, /data-testid="match-call-media-permission-recovery"/);
  assert.match(overlay, /Retry microphone/);
  assert.match(overlay, /Retry camera/);
  assert.match(overlay, /audioStatus === "blocked"/);
  assert.match(overlay, /videoStatus === "blocked"/);
});

test("web media surfaces classify denials with browser permission state", () => {
  const surfaces = [
    "src/hooks/useMatchCall.tsx",
    "src/components/vibe-video/VibeStudioModal.tsx",
    "src/components/chat/VideoMessageRecorder.tsx",
    "src/components/chat/VoiceRecorder.tsx",
    "src/components/chat/PhotoCameraCaptureDialog.tsx",
    "src/components/lobby/ReadyGateOverlay.tsx",
    "src/hooks/useVideoCall.ts",
  ];

  for (const path of surfaces) {
    const source = read(path);
    assert.match(source, /classifyMediaPermissionErrorWithBrowserState/);
  }
});

test("web selfie verification closes instead of looping on non-retryable camera failures", () => {
  const source = read("src/components/verification/SimplePhotoVerification.tsx");

  assert.match(source, /classifyMediaPermissionErrorWithBrowserState/);
  assert.match(source, /recoveryAction === "retry"[\s\S]*recoveryAction === "open_settings"[\s\S]*\? "start_camera"[\s\S]*: "close"/);
});

test("web Scavenger uses real media selection and upload instead of mock remote photos", () => {
  const creator = read("src/components/arcade/creators/ScavengerCreator.tsx");
  const game = read("src/components/arcade/games/ScavengerGame.tsx");
  const helper = read("src/lib/scavengerPhotoUpload.ts");
  const gameTypes = read("src/types/games.ts");

  for (const source of [creator, game]) {
    assert.match(source, /type="file"/);
    assert.match(source, /capture="environment"/);
    assert.match(source, /uploadWebScavengerPhoto/);
    assert.doesNotMatch(source, /images\.unsplash\.com/);
    assert.doesNotMatch(source, /Mock photo upload/);
  }
  assert.match(game, /useMediaAsset/);
  assert.match(game, /senderPhotoMessageId/);
  assert.match(game, /receiverPhotoMessageId/);
  assert.match(helper, /uploadImageWithMediaSdk/);
  assert.match(helper, /context: "chat"/);
  assert.match(helper, /matchId: cleanMatchId/);
  assert.match(gameTypes, /type: 'scavenger'/);
  assert.doesNotMatch(gameTypes, /Disabled: stubbed photo\/media flow/);
});

test("web notification master switch cannot enable app prefs while browser permission is blocked", () => {
  const source = read("src/components/settings/NotificationsDrawer.tsx");

  assert.match(source, /const handleMasterToggle = async/);
  assert.match(source, /health\.status === "blocked"/);
  assert.match(source, /Notification\.permission !== "granted"/);
  assert.match(source, /onCheckedChange=\{\(checked\) => void handleMasterToggle\(checked\)\}/);
});
