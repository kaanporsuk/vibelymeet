import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  permissionUxMediaKindForRequiredGrants,
  permissionUxStatusForRequiredGrants,
  permissionUxStatusFromBrowserMediaStatus,
  permissionUxStatusFromGrant,
  permissionUxStatusFromMediaPermissionStatus,
  resolvePermissionUx,
} from "./permissionUx";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

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

test("match-call permission capabilities are not part of the active permission UX contract", () => {
  const source = read("shared/permissions/permissionUx.ts");

  assert.doesNotMatch(source, /match_call_voice/);
  assert.doesNotMatch(source, /match_call_video/);
  assert.doesNotMatch(source, /voice call/i);
  assert.doesNotMatch(source, /video call/i);
});

test("required media copy names the missing half after partial camera or microphone grants", () => {
  assert.equal(
    permissionUxMediaKindForRequiredGrants(
      { status: "granted", granted: true },
      { status: "denied", canAskAgain: false },
    ),
    "microphone",
  );
  assert.equal(
    permissionUxMediaKindForRequiredGrants(
      { status: "denied", canAskAgain: true },
      { status: "granted", granted: true },
    ),
    "camera",
  );

  const microphone = resolvePermissionUx({
    capability: "chat_vibe_clip",
    status: "blocked_settings",
    platform: "android",
    mediaKind: "microphone",
  });
  const camera = resolvePermissionUx({
    capability: "profile_vibe_video",
    status: "promptable",
    platform: "ios",
    mediaKind: "camera",
  });

  assert.equal(microphone.title, "Microphone needed");
  assert.match(microphone.message, /Microphone access is off/);
  assert.equal(camera.title, "Camera needed");
  assert.equal(camera.primaryLabel, "Allow camera");
});

test("optional permissions keep a non-blocking fallback", () => {
  const captions = resolvePermissionUx({ capability: "speech_captions", status: "blocked_settings", platform: "ios" });
  const location = resolvePermissionUx({ capability: "location_nearby", status: "blocked_settings", platform: "native" });

  assert.equal(captions.secondaryAction, "continue_without_optional");
  assert.equal(captions.fallbackAction, "continue_without_optional");
  assert.equal(location.fallbackAction, "manual_entry");
});

test("photo picker file recovery uses upload-file semantics", () => {
  const picker = resolvePermissionUx({ capability: "photo_picker", status: "blocked_settings", platform: "native" });

  assert.equal(picker.primaryAction, "open_settings");
  assert.equal(picker.fallbackAction, "upload_file");
  assert.equal(picker.fallbackLabel, "Choose file");
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
  assert.equal(permissionUxStatusFromBrowserMediaStatus("unknown_error"), "denied_retryable");
  assert.equal(permissionUxStatusFromMediaPermissionStatus("blocked_settings"), "blocked_settings");
  assert.equal(permissionUxStatusFromMediaPermissionStatus("hardware_missing"), "hardware_missing");
  assert.equal(permissionUxStatusFromMediaPermissionStatus("denied_retryable"), "denied_retryable");
});
