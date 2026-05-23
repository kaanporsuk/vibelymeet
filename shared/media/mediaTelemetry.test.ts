import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  MEDIA_PLAYBACK_QOE_EVENTS,
  MEDIA_TELEMETRY_EVENTS,
  MEDIA_VIBE_CLIP_EVENTS,
  MEDIA_VIBE_VIDEO_EVENTS,
  sanitizeMediaEventProperties,
  sanitizeMediaSdkTelemetryProperties,
} from "./mediaTelemetry";

const repoRoot = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

test("media telemetry event names stay stable", () => {
  assert.equal(MEDIA_VIBE_VIDEO_EVENTS.profileTtffMeasured, "vibe_video_profile_ttff_ms");
  assert.equal(MEDIA_VIBE_VIDEO_EVENTS.tokenRefreshOnAuthError, "media_token_refresh_on_hls_error");
  assert.equal(MEDIA_PLAYBACK_QOE_EVENTS.summary, "media_playback_qoe");
  assert.equal(MEDIA_PLAYBACK_QOE_EVENTS.rebuffer, "media_playback_qoe_rebuffer");
  assert.equal(MEDIA_TELEMETRY_EVENTS.mediaUploadStarted, "media_upload_started");
  assert.equal(MEDIA_TELEMETRY_EVENTS.mediaUploadPathTaken, "media_upload_path_taken");
  assert.equal(MEDIA_TELEMETRY_EVENTS.mediaUploadSdkFlagEvaluated, "media_upload_sdk_flag_evaluated");
  assert.equal(MEDIA_TELEMETRY_EVENTS.receiptTransition, "media_upload_receipt_transition");
  assert.equal(MEDIA_TELEMETRY_EVENTS.providerUnreachable, "media_provider_unreachable");
  assert.equal(MEDIA_VIBE_CLIP_EVENTS.clip_send_succeeded, "clip_send_succeeded");
  assert.equal(MEDIA_TELEMETRY_EVENTS.clip_send_succeeded, "clip_send_succeeded");
});

test("media telemetry strips raw identifiers, hashes, urls, paths, hosts, and auth metadata", () => {
  const sanitized = sanitizeMediaEventProperties({
    platform: "web",
    surface: "profile",
    provider: "bunny_stream",
    media_family: "profile_vibe_video",
    client_request_id: "client-request-1",
    source_ref: "https://cdn.example.com/raw/playlist.m3u8?token=secret",
    message_id: "message-1",
    matchId: "match-1",
    requesterId: "requester-1",
    senderId: "sender-1",
    profile_id: "profile-1",
    user_id: "user-1",
    asset_id: "asset-1",
    receipt_id: "receipt-1",
    job_id: "job-1",
    provider_object_id: "provider-object-1",
    provider_path: "events/private/file.jpg",
    content_sha256: "abcdef",
    viewer_id_hash: "not-approved",
    hostname: "cdn.example.com",
    stream_hostname: "cdn.example.com",
    stream_hostname_source: "env",
    signed_url: "https://cdn.example.com/signed",
    authorization: "Bearer secret",
    headers: "secret",
    asset_present: true,
    provider_path_present: true,
    content_sha256_present: true,
  });

  assert.deepEqual(sanitized, {
    platform: "web",
    surface: "profile",
    provider: "bunny_stream",
    media_family: "profile_vibe_video",
    client_request_id: "client-request-1",
    source_ref: "remote_url",
    stream_hostname_source: "env",
    asset_present: true,
    provider_path_present: true,
    content_sha256_present: true,
  });
  assert.deepEqual(sanitizeMediaEventProperties({
    stream_hostname_source: "https://cdn.example.com/private",
  }), {});
});

test("SDK path enum telemetry is the only path exception", () => {
  const base = {
    path: "v2",
    path_selected: "media_sdk",
    provider_path: "raw/private/path.jpg",
  };

  assert.deepEqual(sanitizeMediaEventProperties(base), {});
  assert.deepEqual(sanitizeMediaSdkTelemetryProperties(base), {
    path: "v2",
    path_selected: "media_sdk",
  });
  assert.deepEqual(sanitizeMediaSdkTelemetryProperties({
    path: "events/private/raw.jpg",
    path_selected: "https://example.test/private",
  }), {});
});

test("media telemetry wrappers and edge helpers use the shared sanitizer", () => {
  const webVibeVideo = read("src/lib/vibeVideo/vibeVideoTelemetry.ts");
  const nativeVibeVideo = read("apps/mobile/lib/vibeVideoTelemetry.ts");
  const webVibeClip = read("src/lib/vibeClipAnalytics.ts");
  const nativeVibeClip = read("apps/mobile/lib/vibeClipAnalytics.ts");
  const webQoe = read("src/hooks/useMediaPlaybackQoE.ts");
  const nativeQoe = read("apps/mobile/hooks/useNativeMediaPlaybackQoE.ts");
  const webSdkSink = read("src/lib/mediaSdk/sinks/posthogSink.ts");
  const nativeSdkSink = read("apps/mobile/lib/mediaSdk/sinks/posthogSink.ts");
  const edgeReceipt = read("supabase/functions/_shared/media-upload-telemetry.ts");
  const edgeProviderComplete = read("supabase/functions/complete-chat-vibe-clip-upload/index.ts");
  const edgeProviderSync = read("supabase/functions/sync-chat-vibe-clip-status/index.ts");

  assert.match(webVibeVideo, /MEDIA_VIBE_VIDEO_EVENTS/);
  assert.doesNotMatch(read("shared/media/mediaTelemetry.ts"), /from "\.\.\/chat\/vibeClipAnalytics"/);
  assert.match(read("shared/chat/vibeClipAnalytics.ts"), /VIBE_CLIP_EVENTS = MEDIA_VIBE_CLIP_EVENTS/);
  assert.match(nativeVibeVideo, /MEDIA_VIBE_VIDEO_EVENTS/);
  assert.match(webVibeClip, /trackMediaTelemetryEvent/);
  assert.match(nativeVibeClip, /trackMediaTelemetryEvent/);
  assert.match(webQoe, /MEDIA_PLAYBACK_QOE_EVENTS\.summary/);
  assert.match(webQoe, /MEDIA_PLAYBACK_QOE_EVENTS\.rebuffer/);
  assert.match(nativeQoe, /MEDIA_PLAYBACK_QOE_EVENTS\.summary/);
  assert.match(nativeQoe, /MEDIA_PLAYBACK_QOE_EVENTS\.rebuffer/);
  assert.match(webSdkSink, /sanitizeMediaSdkTelemetryProperties/);
  assert.match(nativeSdkSink, /sanitizeMediaSdkTelemetryProperties/);
  assert.match(read("src/lib/mediaSdk/sinks/sentrySink.ts"), /const extra = sanitizeMediaSdkTelemetryProperties\(fields \?\? \{\}\)/);
  assert.match(read("apps/mobile/lib/mediaSdk/sinks/sentrySink.ts"), /const extra = sanitizeMediaSdkTelemetryProperties\(fields \?\? \{\}\)/);
  assert.match(edgeReceipt, /receipt_present/);
  assert.match(edgeReceipt, /asset_present/);
  assert.match(edgeReceipt, /provider_path_present/);
  assert.match(edgeReceipt, /content_sha256_present/);
  assert.doesNotMatch(edgeReceipt, /receipt_id:\s*params\.receiptId/);
  assert.doesNotMatch(edgeReceipt, /asset_id:\s*params\.assetId/);
  assert.doesNotMatch(edgeReceipt, /provider_path:\s*params\.providerPath/);
  assert.doesNotMatch(edgeReceipt, /content_sha256:\s*params\.contentSha256/);
  assert.match(edgeProviderComplete, /captureMediaTelemetry/);
  assert.match(edgeProviderComplete, /sanitizeMediaTelemetryProperties\(fields\)/);
  assert.match(edgeProviderSync, /captureMediaTelemetry/);
  assert.match(edgeProviderSync, /sanitizeMediaTelemetryProperties\(fields\)/);
});
