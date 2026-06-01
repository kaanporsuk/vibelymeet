import test from "node:test";
import assert from "node:assert/strict";

type NativeMediaPickerErrorsModule = typeof import("../../apps/mobile/lib/nativeMediaPickerErrors");
const nativeMediaPickerErrorsModule = await import("../../apps/mobile/lib/nativeMediaPickerErrors.ts") as
  NativeMediaPickerErrorsModule & { default?: NativeMediaPickerErrorsModule };
const nativeMediaPickerErrors = nativeMediaPickerErrorsModule.default ?? nativeMediaPickerErrorsModule;
const { classifyNativeMediaCaptureError, isNativeMediaPermissionError } = nativeMediaPickerErrors;

test("native media permission classifier requires denial context", () => {
  assert.equal(isNativeMediaPermissionError(new Error("not authorized to use camera")), true);
  assert.equal(isNativeMediaPermissionError(new Error("Camera access has been denied")), true);
  assert.equal(isNativeMediaPermissionError(new Error("user authorization completed successfully")), false);
  assert.equal(isNativeMediaPermissionError(new Error("authorized session expired")), false);
});

test("native media capture classifier distinguishes retryable, hardware, and in-use failures", () => {
  assert.equal(classifyNativeMediaCaptureError(new Error("camera is running in another app")), "in_use");
  assert.equal(classifyNativeMediaCaptureError(new Error("No camera found")), "hardware_missing");
  assert.equal(classifyNativeMediaCaptureError(new Error("recording failed unexpectedly")), "denied_retryable");
});
