import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveMediaFallbackCopy, resolveMediaFallbackReason } from "./mediaFallbackCopy";

const root = process.cwd();
const source = readFileSync(join(root, "shared/media/mediaFallbackCopy.ts"), "utf8");

test("media fallback copy defines retry policy without raw provider details", () => {
  assert.deepEqual(resolveMediaFallbackCopy({ reason: "auth_expired" }), {
    title: "Media access expired",
    message: "We are refreshing this media. Try again if it does not load.",
    actionLabel: "Retry",
    retryPolicy: "auto_refresh_once",
    telemetryReason: "auth_expired",
  });
  assert.equal(resolveMediaFallbackCopy({ reason: "asset_deleted" }).retryPolicy, "no_retry");
  assert.equal(resolveMediaFallbackCopy({ reason: "provider_unreachable" }).actionLabel, "Retry");
});

test("media fallback reason classification is privacy-safe and deterministic", () => {
  assert.equal(resolveMediaFallbackReason({ errorCode: "auth_expired" }), "auth_expired");
  assert.equal(resolveMediaFallbackReason({ errorCode: "asset_deleted" }), "asset_deleted");
  assert.equal(resolveMediaFallbackReason({ errorCode: "media_asset_processing_failed" }), "asset_deleted");
  assert.equal(resolveMediaFallbackReason({ errorCode: "media_asset_unavailable" }), "asset_deleted");
  assert.equal(resolveMediaFallbackReason({ errorCode: "network_error" }), "provider_unreachable");
  assert.equal(resolveMediaFallbackReason({ httpStatus: 403 }), "auth_expired");
  assert.equal(resolveMediaFallbackReason({ httpStatus: 404 }), "asset_deleted");
  assert.equal(resolveMediaFallbackReason({ httpStatus: 503 }), "provider_unreachable");
  assert.equal(resolveMediaFallbackReason({ stage: "poster" }), "poster_unavailable");
  assert.equal(resolveMediaFallbackReason({ stage: "hls_auth" }), "hls_auth_failed");
  assert.equal(resolveMediaFallbackReason({ errorCode: "resolver_error" }), "unknown");
});

test("media fallback copy contract has no signed URL or provider path fields", () => {
  for (const forbidden of ["signed_url", "provider_path", "asset_id", "user_id", "profile_id", "raw_error"]) {
    assert.doesNotMatch(source, new RegExp(forbidden));
  }
});

test("web and native media hooks import the shared fallback contract", () => {
  const webHook = readFileSync(join(root, "src/hooks/useMediaAsset.ts"), "utf8");
  const nativeHook = readFileSync(join(root, "apps/mobile/hooks/useMediaAsset.ts"), "utf8");
  assert.match(webHook, /resolveMediaFallbackCopy/);
  assert.match(webHook, /resolveMediaFallbackReason/);
  assert.match(nativeHook, /resolveMediaFallbackCopy/);
  assert.match(nativeHook, /resolveMediaFallbackReason/);
});

test("profile and chat playback surfaces consume shared fallback copy", () => {
  const surfaces = [
    "src/components/vibe-video/VibePlayer.tsx",
    "src/components/vibe-video/VibeVideoFullscreenPlayer.tsx",
    "src/components/chat/VideoMessageBubble.tsx",
    "src/components/chat/VibeClipBubble.tsx",
    "src/components/chat/ChatVideoLightbox.tsx",
    "apps/mobile/components/video/FullscreenVibeVideoModal.tsx",
    "apps/mobile/components/chat/VibeClipCard.tsx",
    "apps/mobile/components/chat/ChatThreadMediaViewer.tsx",
    "apps/mobile/app/chat/[id].tsx",
    "src/components/profile/OtherUserFullProfileView.tsx",
    "apps/mobile/components/profile/UserProfileFullView.tsx",
  ];

  for (const relativePath of surfaces) {
    const contents = readFileSync(join(root, relativePath), "utf8");
    assert.match(contents, /resolveMediaFallbackCopy|fallbackCopy/, relativePath);
  }
});
