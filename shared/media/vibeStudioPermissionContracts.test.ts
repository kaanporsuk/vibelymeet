import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const vibeStudioModal = read("src/components/vibe-video/VibeStudioModal.tsx");

test("Vibe Studio uses shared camera and microphone permission classification", () => {
  assert.match(vibeStudioModal, /@clientShared\/media\/mediaPermissionResult/);
  assert.match(vibeStudioModal, /classifyMediaPermissionErrorWithBrowserState\(err, "camera_microphone"\)/);
  assert.match(vibeStudioModal, /mediaPermissionTitle\(permissionBlock\)/);
  assert.match(vibeStudioModal, /mediaPermissionMessage\(permissionBlock\)/);
  assert.match(vibeStudioModal, /vibe_video_media_permission_blocked/);
  assert.match(vibeStudioModal, /source_surface: "vibe_studio_modal"/);
  assert.match(vibeStudioModal, /permission_state: result\.permissionState/);
  assert.match(vibeStudioModal, /recovery_action: result\.recoveryAction/);
  assert.match(vibeStudioModal, /trackMediaPermissionBlocked\(result\)/);
  assert.match(vibeStudioModal, /audio analyzer unavailable/);
});

test("Vibe Studio does not retry default camera after browser denial", () => {
  const primaryCatchIndex = vibeStudioModal.indexOf("catch (primaryError)");
  const retryGuardIndex = vibeStudioModal.indexOf("shouldRetryMediaPermissionWithFallback(primaryError)", primaryCatchIndex);
  const fallbackIndex = vibeStudioModal.indexOf("video: true", retryGuardIndex);
  const finalCatchIndex = vibeStudioModal.indexOf("catch (err)", fallbackIndex);

  assert.ok(primaryCatchIndex >= 0, "primary getUserMedia catch should be present");
  assert.ok(retryGuardIndex > primaryCatchIndex, "fallback should be guarded by shared retry classification");
  assert.ok(fallbackIndex > retryGuardIndex, "generic camera fallback should happen only after the guard");
  assert.ok(finalCatchIndex > fallbackIndex, "final permission classification should happen after fallback branch");
});

test("Vibe Studio denied state keeps retry and upload recovery visible", () => {
  assert.match(vibeStudioModal, /showPermissionBlock =\s*hasPermission === false && stage !== "preview"/);
  assert.match(vibeStudioModal, /shouldShowCaptureSurface =\s*hasPermission !== false \|\| stage === "preview"/);
  assert.match(vibeStudioModal, /setCameraRequestNonce\(\(nonce\) => nonce \+ 1\)/);
  assert.match(vibeStudioModal, /permissionBlock\.recoveryAction === "open_settings" \? "I updated settings" : "Try again"/);
  assert.match(vibeStudioModal, />\s*Upload a video\s*<\/Button>/);
  assert.match(vibeStudioModal, /event\.target\.value = ""/);
  assert.match(vibeStudioModal, /setMediaPermissionResult\(null\);[\s\S]*stopCameraTracks\(\);[\s\S]*setStage\("preview"\)/);
});

test("Vibe Studio retake and close do not leave stale stopped recorder state", () => {
  assert.match(vibeStudioModal, /discardRecordingRef/);
  assert.match(vibeStudioModal, /mediaRecorder\.onstop = \(\) => \{[\s\S]*mediaRecorderRef\.current = null/);
  assert.match(vibeStudioModal, /if \(discardRecordingRef\.current\) \{[\s\S]*chunksRef\.current = \[\]/);
  assert.match(
    vibeStudioModal,
    /const handleRetake = useCallback\(\(\) => \{[\s\S]*setStage\("idle"\);[\s\S]*setHasPermission\(null\);[\s\S]*setMediaPermissionResult\(null\);[\s\S]*setCameraRequestNonce\(\(nonce\) => nonce \+ 1\);/,
  );
  assert.match(
    vibeStudioModal,
    /const handleClose = useCallback\(\(\) => \{[\s\S]*discardRecordingRef\.current = true;[\s\S]*stopCameraTracks\(\);/,
  );
});
