import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyMediaPermissionError,
  classifyMediaPermissionErrorWithBrowserState,
  mediaPermissionMessage,
  mediaPermissionResultForQueryState,
  mediaPermissionTitle,
  shouldRetryMediaPermissionWithFallback,
} from "./mediaPermissionResult";

const originalNavigator = globalThis.navigator;
const originalWindow = globalThis.window;

function installBrowserPermissionState(state: "granted" | "prompt" | "denied") {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      permissions: {
        query: async () => ({ state }),
      },
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { isSecureContext: true },
  });
}

function restoreBrowserGlobals() {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: originalNavigator,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
}

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

test("browser-state classifier keeps promptable NotAllowedError retryable", async () => {
  installBrowserPermissionState("prompt");
  try {
    const result = await classifyMediaPermissionErrorWithBrowserState(
      { name: "NotAllowedError", message: "Permission prompt dismissed" },
      "camera",
    );

    assert.equal(result.status, "denied_retryable");
    assert.equal(result.permissionState, "prompt");
    assert.equal(result.recoveryAction, "retry");
  } finally {
    restoreBrowserGlobals();
  }
});

test("browser-state classifier reserves settings recovery for blocked browser permission", async () => {
  installBrowserPermissionState("denied");
  try {
    const result = await classifyMediaPermissionErrorWithBrowserState(
      { name: "NotAllowedError", message: "Permission denied" },
      "microphone",
    );

    assert.equal(result.status, "denied");
    assert.equal(result.permissionState, "denied");
    assert.equal(result.recoveryAction, "open_settings");
  } finally {
    restoreBrowserGlobals();
  }
});

test("browser-state classifier preserves settings recovery when permission query is unavailable", async () => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {},
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { isSecureContext: true },
  });
  try {
    const result = await classifyMediaPermissionErrorWithBrowserState(
      { name: "NotAllowedError", message: "Permission denied" },
      "camera_microphone",
    );

    assert.equal(result.status, "denied");
    assert.equal(result.permissionState, "unknown");
    assert.equal(result.recoveryAction, "open_settings");
  } finally {
    restoreBrowserGlobals();
  }
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
