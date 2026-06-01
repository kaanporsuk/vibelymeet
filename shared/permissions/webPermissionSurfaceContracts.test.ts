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

  assert.match(source, /const \[locationDetectError, setLocationDetectError\]/);
  assert.match(source, /setLocationDetectError\(message\)/);
  assert.match(source, /Try again/);
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
