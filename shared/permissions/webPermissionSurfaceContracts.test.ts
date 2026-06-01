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

  assert.match(hook, /audioState === "blocked"[\s\S]*setLocalAudio\(true\)/);
  assert.match(hook, /videoState === "blocked"[\s\S]*setLocalVideo\(true\)/);
  assert.match(overlay, /data-testid="match-call-media-permission-recovery"/);
  assert.match(overlay, /Retry microphone/);
  assert.match(overlay, /Retry camera/);
  assert.match(overlay, /audioStatus === "blocked"/);
  assert.match(overlay, /videoStatus === "blocked"/);
});
