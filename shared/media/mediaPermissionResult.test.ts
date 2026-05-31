import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyMediaPermissionError,
  mediaPermissionMessage,
  mediaPermissionResultForQueryState,
  mediaPermissionTitle,
  shouldRetryMediaPermissionWithFallback,
} from "./mediaPermissionResult";

test("media permission classifier maps browser denials to settings recovery", () => {
  const result = classifyMediaPermissionError(
    { name: "NotAllowedError", message: "Permission denied" },
    "camera_microphone",
  );

  assert.equal(result.status, "denied");
  assert.equal(result.permissionState, "denied");
  assert.equal(result.recoveryAction, "open_settings");
  assert.equal(result.rawErrorName, "NotAllowedError");
  assert.equal(shouldRetryMediaPermissionWithFallback({ name: "NotAllowedError" }), false);
});

test("media permission classifier retries only constraint failures", () => {
  const result = classifyMediaPermissionError(
    { name: "OverconstrainedError", message: "facingMode constraint failed" },
    "camera_microphone",
  );

  assert.equal(result.status, "constraint_failed");
  assert.equal(mediaPermissionTitle(result), "Camera or microphone setup needs another try");
  assert.equal(result.recoveryAction, "retry");
  assert.equal(shouldRetryMediaPermissionWithFallback({ name: "OverconstrainedError" }), true);
  assert.equal(shouldRetryMediaPermissionWithFallback({ name: "SecurityError" }), false);
});

test("media permission classifier distinguishes busy devices and missing devices", () => {
  assert.equal(
    classifyMediaPermissionError({ name: "NotReadableError", message: "Could not start video source" }, "camera")
      .status,
    "in_use_or_abort",
  );
  assert.equal(classifyMediaPermissionError({ name: "NotFoundError" }, "microphone").status, "missing_device");
});

test("media permission copy stays tied to recovery categories", () => {
  const denied = mediaPermissionResultForQueryState("camera_microphone", "denied");
  const promptable = mediaPermissionResultForQueryState("camera_microphone", "prompt");

  assert.equal(mediaPermissionTitle(denied), "Camera and microphone needed");
  assert.match(mediaPermissionMessage(denied), /browser settings/);
  assert.equal(promptable.status, "promptable");
  assert.equal(promptable.recoveryAction, "retry");
});

test("microphone-only failures do not mention camera recovery", () => {
  const busy = classifyMediaPermissionError({ name: "NotReadableError" }, "microphone");
  const constrained = classifyMediaPermissionError({ name: "OverconstrainedError" }, "microphone");

  assert.equal(mediaPermissionTitle(busy), "Microphone is busy");
  assert.match(mediaPermissionMessage(busy), /using the microphone/);
  assert.doesNotMatch(mediaPermissionMessage(busy), /camera/);
  assert.equal(mediaPermissionTitle(constrained), "Microphone setup needs another try");
  assert.match(mediaPermissionMessage(constrained), /start the microphone/);
  assert.doesNotMatch(mediaPermissionMessage(constrained), /saved video|saved photo|preferred camera/);
});
