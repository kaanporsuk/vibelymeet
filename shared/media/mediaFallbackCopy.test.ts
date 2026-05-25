import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractNativeMediaPlaybackHttpStatus,
  resolveMediaFallbackCopy,
  resolveMediaFallbackReason,
  resolveNativeMediaPlaybackFallbackReason,
} from "./mediaFallbackCopy";

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
  assert.equal(resolveMediaFallbackReason({ httpStatus: 429 }), "provider_unreachable");
  assert.equal(resolveMediaFallbackReason({ httpStatus: 500 }), "provider_unreachable");
  assert.equal(resolveMediaFallbackReason({ httpStatus: 503 }), "provider_unreachable");
  assert.equal(resolveMediaFallbackReason({ stage: "poster" }), "poster_unavailable");
  assert.equal(resolveMediaFallbackReason({ stage: "hls_auth" }), "hls_auth_failed");
  assert.equal(resolveMediaFallbackReason({ stage: "hls_auth", httpStatus: 403 }), "hls_auth_failed");
  assert.equal(resolveMediaFallbackReason({ stage: "hls_auth", httpStatus: 404 }), "asset_deleted");
  assert.equal(resolveMediaFallbackReason({ stage: "hls_auth", httpStatus: 503 }), "provider_unreachable");
  assert.equal(resolveMediaFallbackReason({ errorCode: "resolver_error" }), "unknown");
});

test("native playback fallback classification preserves useful HTTP status without raw errors", () => {
  assert.equal(extractNativeMediaPlaybackHttpStatus("Expo player failed with HTTP 403"), 403);
  assert.equal(extractNativeMediaPlaybackHttpStatus({ error: { networkDetails: { statusCode: 503 } } }), 503);
  assert.equal(extractNativeMediaPlaybackHttpStatus({ statusCode: "HTTP 410" }), 410);
  assert.equal(extractNativeMediaPlaybackHttpStatus(new Error("request failed with status 404")), 404);
  assert.equal(extractNativeMediaPlaybackHttpStatus("asset id 4040 is not a status"), null);
  const cyclicPayload: Record<string, unknown> = {};
  cyclicPayload.error = cyclicPayload;
  assert.equal(extractNativeMediaPlaybackHttpStatus(cyclicPayload), null);

  assert.equal(
    resolveNativeMediaPlaybackFallbackReason({
      uri: "https://stream.example/video/PLAYLIST.M3U8?token=fake",
      error: "HTTP 403",
    }),
    "hls_auth_failed",
  );
  assert.equal(
    resolveNativeMediaPlaybackFallbackReason({
      uri: "https://stream.example/video/playlist.m3u8",
      error: { statusCode: 404 },
    }),
    "asset_deleted",
  );
  assert.equal(
    resolveNativeMediaPlaybackFallbackReason({
      uri: "https://stream.example/video/playlist.m3u8",
      error: { networkDetails: { status: 503 } },
    }),
    "provider_unreachable",
  );
  assert.equal(
    resolveNativeMediaPlaybackFallbackReason({
      uri: "https://stream.example/video/playlist.m3u8",
      error: "HTTP 429 Too Many Requests",
    }),
    "provider_unreachable",
  );
  assert.equal(
    resolveNativeMediaPlaybackFallbackReason({
      uri: "https://stream.example/video/playlist.m3u8",
      error: "HTTP 403",
      httpStatus: Number.NaN,
    }),
    "hls_auth_failed",
  );
  assert.equal(resolveNativeMediaPlaybackFallbackReason({ uri: "file:///clip.mov", error: "decoder failed" }), "unknown");
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

test("web and native media hooks attach fallback reasons to realtime failed assets", () => {
  const hooks = [
    readFileSync(join(root, "src/hooks/useMediaAsset.ts"), "utf8"),
    readFileSync(join(root, "apps/mobile/hooks/useMediaAsset.ts"), "utf8"),
  ];

  for (const hook of hooks) {
    assert.match(hook, /nextStatus === ['"]failed['"]/);
    assert.match(hook, /setError\(['"]media_asset_processing_failed['"]\)/);
    assert.match(
      hook,
      /setFallbackReason\(resolveMediaFallbackReason\(\{ errorCode: ['"]media_asset_processing_failed['"] \}\)\)/,
    );
  }
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

test("web HLS playback fallbacks preserve HTTP-status-specific reasons", () => {
  const surfaces = [
    "src/components/vibe-video/VibePlayer.tsx",
    "src/components/vibe-video/VibeVideoFullscreenPlayer.tsx",
    "src/components/chat/VideoMessageBubble.tsx",
    "src/components/chat/VibeClipBubble.tsx",
    "src/components/chat/ChatVideoLightbox.tsx",
  ];

  for (const relativePath of surfaces) {
    const contents = readFileSync(join(root, relativePath), "utf8");
    assert.match(contents, /hlsPlaybackErrorStatusCode/, relativePath);
    assert.match(contents, /httpStatus:/, relativePath);
  }
});

test("native playback fallbacks preserve HTTP-status-specific reasons when Expo exposes them", () => {
  const surfaces = [
    "apps/mobile/components/video/VibeVideoPlayer.tsx",
    "apps/mobile/components/video/FullscreenVibeVideoModal.tsx",
    "apps/mobile/components/chat/VibeClipCard.tsx",
    "apps/mobile/components/chat/ChatThreadMediaViewer.tsx",
    "apps/mobile/app/chat/[id].tsx",
  ];

  for (const relativePath of surfaces) {
    const contents = readFileSync(join(root, relativePath), "utf8");
    assert.match(contents, /resolveNativeMediaPlaybackFallbackReason/, relativePath);
    assert.doesNotMatch(contents, /nativeError:/, relativePath);
  }
});

test("native canonical player forwards resolver fallback reasons before playback starts", () => {
  const player = readFileSync(join(root, "apps/mobile/components/video/VibeVideoPlayer.tsx"), "utf8");
  assert.match(player, /fallbackReason: mediaAssetFallbackReason/);
  assert.match(player, /mediaAssetStatus === 'error'/);
  assert.match(player, /onPlayerFatalError\?\.\(\s*mediaAssetFallbackReason \?\?/);
});
