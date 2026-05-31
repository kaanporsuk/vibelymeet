import assert from "node:assert/strict";
import test from "node:test";
import {
  permissionUxStatusForRequiredGrants,
  permissionUxStatusFromBrowserMediaStatus,
  permissionUxStatusFromGrant,
  resolvePermissionUx,
} from "./permissionUx";

test("permission UX maps native denial states to retry vs Settings recovery", () => {
  assert.equal(permissionUxStatusFromGrant({ status: "denied", canAskAgain: true }), "denied_retryable");
  assert.equal(permissionUxStatusFromGrant({ status: "denied", canAskAgain: false }), "blocked_settings");
  assert.equal(permissionUxStatusFromGrant({ status: "never_ask_again" }), "blocked_settings");
  assert.equal(permissionUxStatusFromGrant({ status: "limited" }), "limited");
});

test("required multi-permission grants stay conservative for partial camera and microphone states", () => {
  assert.equal(
    permissionUxStatusForRequiredGrants([{ status: "granted", granted: true }, null]),
    "checking",
  );
  assert.equal(
    permissionUxStatusForRequiredGrants([
      { status: "granted", granted: true },
      { status: "denied", canAskAgain: true },
    ]),
    "denied_retryable",
  );
  assert.equal(
    permissionUxStatusForRequiredGrants([
      { status: "granted", granted: true },
      { status: "denied", canAskAgain: false },
    ]),
    "blocked_settings",
  );
});

test("chat vibe clip uses compact prompt copy with upload fallback", () => {
  const prompt = resolvePermissionUx({ capability: "chat_vibe_clip", status: "promptable", platform: "ios" });
  const blocked = resolvePermissionUx({ capability: "chat_vibe_clip", status: "blocked_settings", platform: "android" });

  assert.equal(prompt.primaryAction, "request");
  assert.equal(prompt.primaryLabel, "Allow camera & mic");
  assert.equal(prompt.fallbackAction, "upload_file");
  assert.equal(prompt.fallbackLabel, "Choose saved video");
  assert.equal(blocked.primaryAction, "open_settings");
  assert.equal(blocked.primaryLabel, "Open Settings");
});

test("optional permissions keep a non-blocking fallback", () => {
  const captions = resolvePermissionUx({ capability: "speech_captions", status: "blocked_settings", platform: "ios" });
  const location = resolvePermissionUx({ capability: "location_nearby", status: "blocked_settings", platform: "native" });

  assert.equal(captions.secondaryAction, "continue_without_optional");
  assert.equal(captions.fallbackAction, "continue_without_optional");
  assert.equal(location.fallbackAction, "manual_entry");
});

test("unsupported permissions never invent file fallbacks for capabilities without one", () => {
  const voice = resolvePermissionUx({ capability: "voice_message", status: "unsupported", platform: "mobile_web" });
  const verification = resolvePermissionUx({ capability: "photo_verification", status: "unsupported", platform: "web" });
  const clip = resolvePermissionUx({ capability: "chat_vibe_clip", status: "unsupported", platform: "web" });

  assert.equal(voice.primaryAction, "dismiss");
  assert.equal(voice.primaryLabel, "OK");
  assert.equal(voice.fallbackAction, undefined);
  assert.equal(verification.primaryAction, "dismiss");
  assert.equal(verification.primaryLabel, "OK");
  assert.equal(verification.fallbackAction, undefined);
  assert.equal(clip.primaryAction, "upload_file");
  assert.equal(clip.primaryLabel, "Choose saved video");
  assert.equal(clip.fallbackAction, undefined);
});

test("browser media statuses normalize into the shared UX model", () => {
  assert.equal(permissionUxStatusFromBrowserMediaStatus("denied"), "blocked_settings");
  assert.equal(permissionUxStatusFromBrowserMediaStatus("missing_device"), "hardware_missing");
  assert.equal(permissionUxStatusFromBrowserMediaStatus("in_use_or_abort"), "in_use");
  assert.equal(permissionUxStatusFromBrowserMediaStatus("constraint_failed"), "denied_retryable");
});
