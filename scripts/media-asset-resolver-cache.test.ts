import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __chatMediaUrlCacheSizeForTests,
  __clearChatMediaUrlCacheForTests,
  __setChatMediaUrlIssuerForTests,
  getCachedMediaAsset,
  getCachedMediaAssetUrl,
  prewarmMediaAssets,
  refreshMediaAssetUrl,
  resolveMessageMediaForDisplay,
} from "../src/lib/mediaAssetResolver";
import {
  bunnyStreamThumbnailRefFor,
  bunnyStreamVideoIdFromRef,
  deriveChatVideoThumbnailRef,
  extractChatImageIdentityRef,
  extractRenderableChatImageUrl,
  extractVibeClipMeta,
  formatChatImageMessageContent,
} from "../shared/chat/messageRouting";
import { resolvePreservedMediaSelectionId } from "../shared/chat/mediaSelection";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

__clearChatMediaUrlCacheForTests();

assert.equal(
  await getCachedMediaAssetUrl("local-preview", "image", "blob:https://vibely.test/photo"),
  "blob:https://vibely.test/photo",
);
assert.equal(__chatMediaUrlCacheSizeForTests(), 0);

assert.equal(
  await getCachedMediaAssetUrl(
    "550e8400-e29b-41d4-a716-446655440010",
    "video",
    "https://cdn.example.com/already-signed.mp4",
  ),
  "https://cdn.example.com/already-signed.mp4",
);
assert.equal(__chatMediaUrlCacheSizeForTests(), 0);

{
  const videoId = "44444444-4444-4444-8444-444444444444";
  const otherVideoId = "55555555-5555-4555-8555-555555555555";
  assert.equal(
    bunnyStreamThumbnailRefFor(`bunny_stream:${videoId}`),
    `bunny_stream:${videoId}:thumbnail`,
  );
  assert.equal(
    bunnyStreamThumbnailRefFor(`bunny_stream:${videoId}:thumbnail`),
    `bunny_stream:${videoId}:thumbnail`,
  );
  assert.equal(bunnyStreamVideoIdFromRef(`bunny_stream:${videoId}:thumbnail`), videoId);
  assert.equal(bunnyStreamThumbnailRefFor("bunny_stream:--------------------------------"), null);
  assert.equal(bunnyStreamVideoIdFromRef("bunny_stream:--------------------------------"), null);
  assert.equal(bunnyStreamThumbnailRefFor("https://cdn.example.com/video.mp4"), null);
  assert.equal(
    deriveChatVideoThumbnailRef({
      video_url: `bunny_stream:${videoId}`,
      structured_payload: {
        thumbnail_url: null,
        poster_ref: null,
      },
    }),
    `bunny_stream:${videoId}:thumbnail`,
  );
  assert.equal(
    deriveChatVideoThumbnailRef({
      video_url: `bunny_stream:${otherVideoId}`,
      structured_payload: {
        thumbnail_url: "",
        poster_ref: null,
        provider: "bunny_stream",
        provider_object_id: videoId,
      },
    }),
    `bunny_stream:${otherVideoId}:thumbnail`,
  );
  assert.equal(
    deriveChatVideoThumbnailRef({
      video_url: null,
      structured_payload: {
        thumbnail_url: "",
        poster_ref: null,
        provider: "bunny_stream",
        provider_object_id: videoId,
      },
    }),
    `bunny_stream:${videoId}:thumbnail`,
  );
  assert.equal(
    deriveChatVideoThumbnailRef({
      video_url: null,
      structured_payload: {
        thumbnail_url: null,
        poster_ref: null,
        provider: "bunny_storage",
        provider_object_id: videoId,
      },
    }),
    null,
  );
  assert.equal(
    deriveChatVideoThumbnailRef({
      video_url: `bunny_stream:${otherVideoId}`,
      structured_payload: {
        thumbnail_url: "photos/explicit-thumb.jpg",
        poster_ref: `bunny_stream:${videoId}:thumbnail`,
      },
    }),
    "photos/explicit-thumb.jpg",
  );
  assert.equal(
    deriveChatVideoThumbnailRef({
      video_url: `bunny_stream:${videoId}`,
      structured_payload: {
        thumbnail_url: "https://signed.example.com/expired-thumbnail.jpg",
        poster_ref: null,
      },
    }),
    `bunny_stream:${videoId}:thumbnail`,
  );
  assert.equal(
    deriveChatVideoThumbnailRef({
      video_url: `bunny_stream:${otherVideoId}`,
      structured_payload: {
        thumbnail_url: "https://signed.example.com/expired-uploaded-thumbnail.jpg",
        poster_ref: "chat-videos/match-1/sender_thumb.jpg",
      },
    }),
    "chat-videos/match-1/sender_thumb.jpg",
  );
  assert.equal(
    extractVibeClipMeta({
      video_url: `bunny_stream:${videoId}`,
      video_duration_seconds: 4,
      message_kind: "vibe_clip",
      structured_payload: {
        v: 3,
        kind: "vibe_clip",
        thumbnail_url: "https://signed.example.com/display-thumbnail.jpg",
        provider: "bunny_stream",
        provider_object_id: videoId,
      },
    })?.thumbnailUrl,
    "https://signed.example.com/display-thumbnail.jpg",
  );
}

let invokeCount = 0;
__setChatMediaUrlIssuerForTests(async () => {
  invokeCount += 1;
  return {
    success: true,
    url: `https://signed.example.com/media-${invokeCount}`,
    expiresInSeconds: 300,
  };
});

try {
  const messageId = "550e8400-e29b-41d4-a716-446655440000";
  const first = await getCachedMediaAssetUrl(messageId, "voice", "voice/test.webm");
  const second = await getCachedMediaAssetUrl(messageId, "voice", "voice/test.webm");
  const refreshed = await refreshMediaAssetUrl(messageId, "voice", "voice/test.webm");

  assert.equal(first, "https://signed.example.com/media-1");
  assert.equal(second, first);
  assert.equal(refreshed, "https://signed.example.com/media-2");
  assert.equal(invokeCount, 2);
  assert.equal(__chatMediaUrlCacheSizeForTests(), 1);
} finally {
  __setChatMediaUrlIssuerForTests(null);
  __clearChatMediaUrlCacheForTests();
}

let preserveInvokeCount = 0;
__setChatMediaUrlIssuerForTests(async () => {
  preserveInvokeCount += 1;
  if (preserveInvokeCount === 1) {
    return {
      success: true,
      url: "https://signed.example.com/preserved",
      expiresInSeconds: 300,
    };
  }
  return null;
});
try {
  const messageId = "550e8400-e29b-41d4-a716-446655440004";
  const first = await getCachedMediaAssetUrl(messageId, "video", "videos/preserved.mp4");
  const failedRefresh = await refreshMediaAssetUrl(messageId, "video", "videos/preserved.mp4");
  const stillCached = await getCachedMediaAssetUrl(messageId, "video", "videos/preserved.mp4");

  assert.equal(first, "https://signed.example.com/preserved");
  assert.equal(failedRefresh, null);
  assert.equal(stillCached, first);
  assert.equal(preserveInvokeCount, 2);
  assert.equal(__chatMediaUrlCacheSizeForTests(), 1);
} finally {
  __setChatMediaUrlIssuerForTests(null);
  __clearChatMediaUrlCacheForTests();
}

let streamInvokeCount = 0;
__setChatMediaUrlIssuerForTests(async (_messageId, mediaKind) => {
  streamInvokeCount += 1;
  assert.equal(mediaKind, "vibe_clip");
  return {
    success: true,
    url: "https://vz-chat.example/bcdn_token=HS256-play/stream-id/playlist.m3u8",
    posterUrl: "https://vz-chat.example/bcdn_token=HS256-poster/stream-id/thumbnail.jpg",
    posterFallbackUrls: ["https://vz-chat.example/bcdn_token=HS256-poster-fallback/stream-id/preview.webp"],
    provider: "bunny_stream",
    playbackKind: "hls",
    expiresInSeconds: 300,
  };
});
try {
  const messageId = "550e8400-e29b-41d4-a716-446655440001";
  const videoId = "11111111-1111-4111-8111-111111111111";
  const playbackRef = `bunny_stream:${videoId}`;
  const thumbnailRef = `bunny_stream:${videoId}:thumbnail`;
  const playback = await refreshMediaAssetUrl(messageId, "vibe_clip", playbackRef);
  const playbackAsset = await getCachedMediaAsset(messageId, "vibe_clip", playbackRef);
  const posterAsset = await getCachedMediaAsset(messageId, "thumbnail", thumbnailRef);

  assert.equal(playback, "https://vz-chat.example/bcdn_token=HS256-play/stream-id/playlist.m3u8");
  assert.equal(posterAsset?.url, "https://vz-chat.example/bcdn_token=HS256-poster/stream-id/thumbnail.jpg");
  assert.deepEqual(playbackAsset?.posterFallbackUrls, [
    "https://vz-chat.example/bcdn_token=HS256-poster-fallback/stream-id/preview.webp",
  ]);
  assert.deepEqual(posterAsset?.fallbackUrls, [
    "https://vz-chat.example/bcdn_token=HS256-poster-fallback/stream-id/preview.webp",
  ]);
  assert.equal(streamInvokeCount, 1);
  assert.equal(__chatMediaUrlCacheSizeForTests(), 2);
} finally {
  __setChatMediaUrlIssuerForTests(null);
  __clearChatMediaUrlCacheForTests();
}

let cachedStreamInvokeCount = 0;
__setChatMediaUrlIssuerForTests(async (_messageId, mediaKind) => {
  cachedStreamInvokeCount += 1;
  assert.equal(mediaKind, "vibe_clip");
  return {
    success: true,
    url: "https://vz-chat.example/bcdn_token=HS256-cached/stream-id/playlist.m3u8",
    posterUrl: "https://vz-chat.example/bcdn_token=HS256-cached-poster/stream-id/thumbnail.jpg",
    provider: "bunny_stream",
    playbackKind: "hls",
    expiresInSeconds: 300,
  };
});
try {
  const messageId = "550e8400-e29b-41d4-a716-446655440011";
  const videoId = "22222222-2222-4222-8222-222222222222";
  const first = await getCachedMediaAssetUrl(messageId, "vibe_clip", `bunny_stream:${videoId}`);
  const second = await getCachedMediaAssetUrl(messageId, "vibe_clip", `bunny_stream:${videoId}`);
  const poster = await getCachedMediaAssetUrl(messageId, "thumbnail", `bunny_stream:${videoId}:thumbnail`);

  assert.equal(first, "https://vz-chat.example/bcdn_token=HS256-cached/stream-id/playlist.m3u8");
  assert.equal(second, first);
  assert.equal(poster, "https://vz-chat.example/bcdn_token=HS256-cached-poster/stream-id/thumbnail.jpg");
  assert.equal(cachedStreamInvokeCount, 1);
  assert.equal(__chatMediaUrlCacheSizeForTests(), 2);
} finally {
  __setChatMediaUrlIssuerForTests(null);
  __clearChatMediaUrlCacheForTests();
}

let derivedThumbnailPrewarmInvokeCount = 0;
__setChatMediaUrlIssuerForTests(async (_messageId, mediaKind) => {
  derivedThumbnailPrewarmInvokeCount += 1;
  if (mediaKind === "vibe_clip") {
    return {
      success: true,
      url: "https://vz-chat.example/bcdn_token=HS256-derived-play/stream-id/playlist.m3u8",
      posterUrl: "https://vz-chat.example/bcdn_token=HS256-derived/stream-id/thumbnail.jpg",
      posterFallbackUrls: ["https://vz-chat.example/bcdn_token=HS256-derived-fallback/stream-id/preview.webp"],
      provider: "bunny_stream",
      playbackKind: "hls",
      expiresInSeconds: 300,
    };
  }
  assert.equal(mediaKind, "thumbnail");
  return {
    success: true,
    url: "https://vz-chat.example/bcdn_token=HS256-derived/stream-id/thumbnail.jpg",
    fallbackUrls: ["https://vz-chat.example/bcdn_token=HS256-derived-fallback/stream-id/preview.webp"],
    provider: "bunny_stream",
    playbackKind: "progressive",
    expiresInSeconds: 300,
  };
});
try {
  const messageId = "550e8400-e29b-41d4-a716-446655440021";
  const videoId = "66666666-6666-4666-8666-666666666666";
  const resolved = await resolveMessageMediaForDisplay({
    id: messageId,
    content: "Vibe Clip",
    video_url: `bunny_stream:${videoId}`,
    video_duration_seconds: 4,
    message_kind: "vibe_clip",
    structured_payload: {
      v: 2,
      kind: "vibe_clip",
      client_request_id: "derived-thumbnail-request",
      duration_ms: 4000,
      thumbnail_url: null,
      poster_ref: null,
      poster_source: "bunny_stream_thumbnail",
      aspect_ratio: 9 / 16,
      processing_status: "ready",
      upload_provider: "bunny_stream",
      provider: "bunny_stream",
      provider_object_id: videoId,
      playback_ref: `bunny_stream:${videoId}`,
    },
  });

  assert.equal(
    (resolved.structured_payload as { thumbnail_url?: string } | null)?.thumbnail_url,
    "https://vz-chat.example/bcdn_token=HS256-derived/stream-id/thumbnail.jpg",
  );
  assert.equal(resolved.video_url, `bunny_stream:${videoId}`);
  assert.equal(derivedThumbnailPrewarmInvokeCount, 1);
  const prewarmed = await prewarmMediaAssets([
    { messageId, kind: "thumbnail", sourceRef: `bunny_stream:${videoId}:thumbnail` },
  ]);
  assert.equal(prewarmed[0]?.url, "https://vz-chat.example/bcdn_token=HS256-derived/stream-id/thumbnail.jpg");
  assert.deepEqual(
    (await getCachedMediaAsset(messageId, "thumbnail", `bunny_stream:${videoId}:thumbnail`))?.fallbackUrls,
    ["https://vz-chat.example/bcdn_token=HS256-derived-fallback/stream-id/preview.webp"],
  );
  assert.equal(derivedThumbnailPrewarmInvokeCount, 1);
} finally {
  __setChatMediaUrlIssuerForTests(null);
  __clearChatMediaUrlCacheForTests();
}

let staleExplicitThumbnailResolveInvokeCount = 0;
__setChatMediaUrlIssuerForTests(async (_messageId, mediaKind) => {
  staleExplicitThumbnailResolveInvokeCount += 1;
  if (mediaKind === "vibe_clip") {
    return {
      success: true,
      url: "https://vz-chat.example/bcdn_token=HS256-recovered-play/stream-id/playlist.m3u8",
      posterUrl: "https://vz-chat.example/bcdn_token=HS256-recovered/stream-id/thumbnail.jpg",
      provider: "bunny_stream",
      playbackKind: "hls",
      expiresInSeconds: 300,
    };
  }
  assert.equal(mediaKind, "thumbnail");
  return {
    success: true,
    url: "https://vz-chat.example/bcdn_token=HS256-recovered/stream-id/thumbnail.jpg",
    provider: "bunny_stream",
    playbackKind: "progressive",
    expiresInSeconds: 300,
  };
});
try {
  const messageId = "550e8400-e29b-41d4-a716-446655440022";
  const videoId = "77777777-7777-4777-8777-777777777777";
  const resolved = await resolveMessageMediaForDisplay({
    id: messageId,
    content: "Vibe Clip",
    video_url: `bunny_stream:${videoId}`,
    video_duration_seconds: 4,
    message_kind: "vibe_clip",
    structured_payload: {
      v: 3,
      kind: "vibe_clip",
      client_request_id: "stale-explicit-thumbnail-request",
      duration_ms: 4000,
      thumbnail_url: "https://signed.example.com/expired-thumbnail.jpg",
      poster_ref: null,
      poster_source: "bunny_stream_thumbnail",
      aspect_ratio: 9 / 16,
      processing_status: "ready",
      upload_provider: "bunny_stream",
      provider: "bunny_stream",
      provider_object_id: videoId,
      playback_ref: `bunny_stream:${videoId}`,
    },
  });

  assert.equal(
    (resolved.structured_payload as { thumbnail_url?: string } | null)?.thumbnail_url,
    "https://vz-chat.example/bcdn_token=HS256-recovered/stream-id/thumbnail.jpg",
  );
  assert.equal(staleExplicitThumbnailResolveInvokeCount, 1);
} finally {
  __setChatMediaUrlIssuerForTests(null);
  __clearChatMediaUrlCacheForTests();
}

let genericVideoThumbnailResolveInvokeCount = 0;
__setChatMediaUrlIssuerForTests(async (_messageId, mediaKind) => {
  genericVideoThumbnailResolveInvokeCount += 1;
  if (mediaKind === "video") {
    return {
      success: true,
      url: "https://vz-chat.example/bcdn_token=HS256-generic-play/stream-id/playlist.m3u8",
      posterUrl: "https://vz-chat.example/bcdn_token=HS256-generic/stream-id/thumbnail.jpg",
      provider: "bunny_stream",
      playbackKind: "hls",
      expiresInSeconds: 300,
    };
  }
  assert.equal(mediaKind, "thumbnail");
  return {
    success: true,
    url: "https://vz-chat.example/bcdn_token=HS256-generic/stream-id/thumbnail.jpg",
    provider: "bunny_stream",
    playbackKind: "progressive",
    expiresInSeconds: 300,
  };
});
try {
  const messageId = "550e8400-e29b-41d4-a716-446655440023";
  const videoId = "88888888-8888-4888-8888-888888888888";
  const resolved = await resolveMessageMediaForDisplay({
    id: messageId,
    content: "Video",
    video_url: `bunny_stream:${videoId}`,
    video_duration_seconds: 7,
    message_kind: "video",
    structured_payload: null,
  });

  assert.equal(
    (resolved.structured_payload as { thumbnail_url?: string } | null)?.thumbnail_url,
    "https://vz-chat.example/bcdn_token=HS256-generic/stream-id/thumbnail.jpg",
  );
  assert.equal(resolved.video_url, `bunny_stream:${videoId}`);
  assert.equal(genericVideoThumbnailResolveInvokeCount, 1);
} finally {
  __setChatMediaUrlIssuerForTests(null);
  __clearChatMediaUrlCacheForTests();
}

let syntheticMessageThumbnailResolveInvokeCount = 0;
__setChatMediaUrlIssuerForTests(async () => {
  syntheticMessageThumbnailResolveInvokeCount += 1;
  throw new Error("synthetic message IDs must not invoke the chat media resolver");
});
try {
  const videoId = "99999999-9999-4999-8999-999999999999";
  const resolved = await resolveMessageMediaForDisplay({
    id: "recovery-local-video",
    content: "Video",
    video_url: `bunny_stream:${videoId}`,
    video_duration_seconds: 7,
    message_kind: "video",
    structured_payload: null,
  });

  assert.equal(resolved.structured_payload, null);
  assert.equal(syntheticMessageThumbnailResolveInvokeCount, 0);
} finally {
  __setChatMediaUrlIssuerForTests(null);
  __clearChatMediaUrlCacheForTests();
}

let profileStreamInvokeCount = 0;
__setChatMediaUrlIssuerForTests(async (profileId, mediaKind) => {
  profileStreamInvokeCount += 1;
  assert.equal(profileId, "550e8400-e29b-41d4-a716-446655440099");
  assert.equal(mediaKind, "profile_vibe_video");
  return {
    success: true,
    url: "https://vz-profile.example/bcdn_token=HS256-profile/profile-video/playlist.m3u8",
    posterUrl: "https://vz-profile.example/bcdn_token=HS256-profile/profile-video/thumbnail.jpg",
    provider: "bunny_stream",
    playbackKind: "hls",
    expiresInSeconds: 300,
  };
});
try {
  const profileRef =
    "profile_vibe_video:550e8400-e29b-41d4-a716-446655440099:33333333-3333-4333-8333-333333333333";
  const first = await getCachedMediaAsset("", "profile_vibe_video", profileRef);
  const second = await getCachedMediaAssetUrl("", "profile_vibe_video", profileRef);

  assert.equal(first?.url, "https://vz-profile.example/bcdn_token=HS256-profile/profile-video/playlist.m3u8");
  assert.equal(first?.posterUrl, "https://vz-profile.example/bcdn_token=HS256-profile/profile-video/thumbnail.jpg");
  assert.equal(second, first?.url);
  assert.equal(profileStreamInvokeCount, 1);
  assert.equal(__chatMediaUrlCacheSizeForTests(), 1);
} finally {
  __setChatMediaUrlIssuerForTests(null);
  __clearChatMediaUrlCacheForTests();
}

let concurrentInvokeCount = 0;
__setChatMediaUrlIssuerForTests(async () => {
  concurrentInvokeCount += 1;
  await new Promise((resolve) => setTimeout(resolve, 5));
  return {
    success: true,
    url: `https://signed.example.com/concurrent-${concurrentInvokeCount}`,
    expiresInSeconds: 300,
  };
});
try {
  const messageId = "550e8400-e29b-41d4-a716-446655440002";
  const [first, second, third] = await Promise.all([
    refreshMediaAssetUrl(messageId, "image", "photos/concurrent.jpg"),
    refreshMediaAssetUrl(messageId, "image", "photos/concurrent.jpg"),
    getCachedMediaAssetUrl(messageId, "image", "photos/concurrent.jpg"),
  ]);

  assert.equal(first, "https://signed.example.com/concurrent-1");
  assert.equal(second, first);
  assert.equal(third, first);
  assert.equal(concurrentInvokeCount, 1);
  assert.equal(__chatMediaUrlCacheSizeForTests(), 1);
} finally {
  __setChatMediaUrlIssuerForTests(null);
  __clearChatMediaUrlCacheForTests();
}

let transientInvokeCount = 0;
const originalTransientDateNow = Date.now;
const transientBaseNow = originalTransientDateNow();
Date.now = () => transientBaseNow;
__setChatMediaUrlIssuerForTests(async () => {
  transientInvokeCount += 1;
  if (transientInvokeCount === 1) throw new Error("network_down");
  return {
    success: true,
    url: "https://signed.example.com/recovered-after-transient",
    expiresInSeconds: 300,
  };
});
try {
  const messageId = "550e8400-e29b-41d4-a716-446655440000";
  const failedRefresh = await refreshMediaAssetUrl(messageId, "voice", "voice/test.webm");
  const cooledDownRefresh = await refreshMediaAssetUrl(messageId, "voice", "voice/test.webm");
  Date.now = () => transientBaseNow + 8_500;
  const recoveredRefresh = await refreshMediaAssetUrl(messageId, "voice", "voice/test.webm");

  assert.equal(failedRefresh, null);
  assert.equal(cooledDownRefresh, null);
  assert.equal(recoveredRefresh, "https://signed.example.com/recovered-after-transient");
  assert.equal(transientInvokeCount, 2);
} finally {
  Date.now = originalTransientDateNow;
  __setChatMediaUrlIssuerForTests(null);
  __clearChatMediaUrlCacheForTests();
}

__setChatMediaUrlIssuerForTests(async () => ({
  success: true,
  url: "https://signed.example.com/legacy-image",
  expiresInSeconds: 300,
}));
try {
  const malformedPayload = {
    v: 3,
    kind: "chat_image",
    provider: "bunny_storage",
    media_ref: "photos/malformed/should-not-be-mutated.jpg",
  };
  const resolved = await resolveMessageMediaForDisplay({
    id: "550e8400-e29b-41d4-a716-446655440012",
    content: "__IMAGE__|photos/legacy/fallback.jpg",
    structured_payload: malformedPayload,
  });

  assert.equal(resolved.content, "__IMAGE__|https://signed.example.com/legacy-image");
  assert.deepEqual(resolved.structured_payload, malformedPayload);
} finally {
  __setChatMediaUrlIssuerForTests(null);
  __clearChatMediaUrlCacheForTests();
}

let failureInvokeCount = 0;
const originalFailureDateNow = Date.now;
const failureBaseNow = originalFailureDateNow();
Date.now = () => failureBaseNow;
__setChatMediaUrlIssuerForTests(async () => {
  failureInvokeCount += 1;
  return null;
});
try {
  const messageId = "550e8400-e29b-41d4-a716-446655440003";
  const first = await refreshMediaAssetUrl(messageId, "image", "photos/missing.jpg");
  const second = await refreshMediaAssetUrl(messageId, "image", "photos/missing.jpg");
  const bypassed = await refreshMediaAssetUrl(messageId, "image", "photos/missing.jpg", {
    bypassFailureCooldown: true,
  });
  Date.now = () => failureBaseNow + 16_500;
  const third = await refreshMediaAssetUrl(messageId, "image", "photos/missing.jpg");

  assert.equal(first, null);
  assert.equal(second, null);
  assert.equal(bypassed, null);
  assert.equal(third, null);
  assert.equal(failureInvokeCount, 3);
} finally {
  Date.now = originalFailureDateNow;
  __setChatMediaUrlIssuerForTests(null);
  __clearChatMediaUrlCacheForTests();
}

let prewarmFailureInvokeCount = 0;
__setChatMediaUrlIssuerForTests(async () => {
  prewarmFailureInvokeCount += 1;
  if (prewarmFailureInvokeCount === 1) return null;
  return {
    success: true,
    url: "https://signed.example.com/after-prewarm-failure",
    expiresInSeconds: 300,
  };
});
try {
  const messageId = "550e8400-e29b-41d4-a716-446655440014";
  const sourceRef = "photos/prewarm-miss.jpg";
  const prewarmed = await prewarmMediaAssets([{ messageId, kind: "image", sourceRef }]);
  const resolvedAfterPrewarmMiss = await getCachedMediaAssetUrl(messageId, "image", sourceRef);

  assert.deepEqual(prewarmed, []);
  assert.equal(resolvedAfterPrewarmMiss, "https://signed.example.com/after-prewarm-failure");
  assert.equal(prewarmFailureInvokeCount, 2);
} finally {
  __setChatMediaUrlIssuerForTests(null);
  __clearChatMediaUrlCacheForTests();
}

let missingImageResolveInvokeCount = 0;
__setChatMediaUrlIssuerForTests(async () => {
  missingImageResolveInvokeCount += 1;
  return null;
});
try {
  const payload = {
    v: 2,
    kind: "chat_image",
    provider: "bunny_storage",
    media_ref: "photos/delayed/photo.jpg",
    client_request_id: "delayed-photo-request",
  } as const;
  const resolved = await resolveMessageMediaForDisplay({
    id: "550e8400-e29b-41d4-a716-446655440013",
    content: formatChatImageMessageContent(payload.media_ref),
    structured_payload: payload,
  });

  assert.equal(resolved.content, formatChatImageMessageContent(payload.media_ref));
  assert.deepEqual(resolved.structured_payload, payload);
  assert.equal(extractChatImageIdentityRef(resolved), payload.media_ref);
  assert.equal(extractRenderableChatImageUrl(resolved), null);
  assert.equal(missingImageResolveInvokeCount, 1);
} finally {
  __setChatMediaUrlIssuerForTests(null);
  __clearChatMediaUrlCacheForTests();
}

__setChatMediaUrlIssuerForTests(async () => ({
  success: true,
  url: "https://signed.example.com/structured-image",
  expiresInSeconds: 300,
}));
try {
  const payload = {
    v: 2,
    kind: "chat_image",
    provider: "bunny_storage",
    media_ref: "photos/ready/photo.jpg",
    client_request_id: "ready-photo-request",
  } as const;
  const resolved = await resolveMessageMediaForDisplay({
    id: "550e8400-e29b-41d4-a716-446655440014",
    content: formatChatImageMessageContent(payload.media_ref),
    structured_payload: payload,
  });

  assert.equal(resolved.content, formatChatImageMessageContent("https://signed.example.com/structured-image"));
  assert.equal(
    (resolved.structured_payload as { media_ref?: string } | null)?.media_ref,
    "https://signed.example.com/structured-image",
  );
  assert.equal(extractRenderableChatImageUrl(resolved), "https://signed.example.com/structured-image");
} finally {
  __setChatMediaUrlIssuerForTests(null);
  __clearChatMediaUrlCacheForTests();
}

__setChatMediaUrlIssuerForTests(async () => ({
  success: true,
  url: "https://signed.example.com/dominant-only-image",
  expiresInSeconds: 300,
  dominantColor: "#ABCDEF",
}));
try {
  const payload = {
    v: 2,
    kind: "chat_image",
    provider: "bunny_storage",
    media_ref: "photos/ready/dominant-only.jpg",
    client_request_id: "dominant-only-request",
  } as const;
  const resolved = await resolveMessageMediaForDisplay({
    id: "550e8400-e29b-41d4-a716-446655440015",
    content: formatChatImageMessageContent(payload.media_ref),
    structured_payload: payload,
  });

  assert.deepEqual(
    (resolved.structured_payload as { media_placeholder?: unknown } | null)?.media_placeholder,
    {
      kind: "dominant_color",
      hash: "#abcdef",
      dominant_color: "#abcdef",
    },
  );
} finally {
  __setChatMediaUrlIssuerForTests(null);
  __clearChatMediaUrlCacheForTests();
}

__setChatMediaUrlIssuerForTests(async () => ({
  success: true,
  url: "https://signed.example.com/dominant-hash-only-image",
  expiresInSeconds: 300,
  placeholderKind: "dominant_color",
  placeholderHash: "#FEDCBA",
}));
try {
  const payload = {
    v: 2,
    kind: "chat_image",
    provider: "bunny_storage",
    media_ref: "photos/ready/dominant-hash-only.jpg",
    client_request_id: "dominant-hash-only-request",
  } as const;
  const resolved = await resolveMessageMediaForDisplay({
    id: "550e8400-e29b-41d4-a716-446655440016",
    content: formatChatImageMessageContent(payload.media_ref),
    structured_payload: payload,
  });

  assert.deepEqual(
    (resolved.structured_payload as { media_placeholder?: unknown } | null)?.media_placeholder,
    {
      kind: "dominant_color",
      hash: "#fedcba",
      dominant_color: "#fedcba",
    },
  );
} finally {
  __setChatMediaUrlIssuerForTests(null);
  __clearChatMediaUrlCacheForTests();
}

let shortTtlInvokeCount = 0;
const originalDateNow = Date.now;
__setChatMediaUrlIssuerForTests(async () => {
  shortTtlInvokeCount += 1;
  return {
    success: true,
    url: `https://signed.example.com/short-${shortTtlInvokeCount}`,
    expiresInSeconds: 10,
  };
});

try {
  const messageId = "650e8400-e29b-41d4-a716-446655440000";
  const first = await getCachedMediaAssetUrl(messageId, "image", "image/short.jpg");
  Date.now = () => originalDateNow() + 2_000;
  const second = await getCachedMediaAssetUrl(messageId, "image", "image/short.jpg");

  assert.equal(first, "https://signed.example.com/short-1");
  assert.equal(second, "https://signed.example.com/short-2");
  assert.equal(shortTtlInvokeCount, 2);
} finally {
  Date.now = originalDateNow;
  __setChatMediaUrlIssuerForTests(null);
  __clearChatMediaUrlCacheForTests();
}

const resolver = read("supabase/functions/get-chat-media-url/index.ts");
const webBubble = read("src/components/chat/VoiceMessageBubble.tsx");
const nativeBubble = read("apps/mobile/components/chat/VoiceMessagePlayer.tsx");
const webVideoBubble = read("src/components/chat/VideoMessageBubble.tsx");
const webClipBubble = read("src/components/chat/VibeClipBubble.tsx");
const webPhotoLightbox = read("src/components/chat/ChatPhotoLightbox.tsx");
const webVideoLightbox = read("src/components/chat/ChatVideoLightbox.tsx");
const webMediaAssetHook = read("src/hooks/useMediaAsset.ts");
const webMediaResolver = read("src/lib/mediaAssetResolver.ts");
const webMessagesHook = read("src/hooks/useMessages.ts");
const webChatPage = read("src/pages/Chat.tsx");
const nativeChat = read("apps/mobile/lib/chatApi.ts");
const nativeChatScreen = read("apps/mobile/app/chat/[id].tsx");
const nativeClipCard = read("apps/mobile/components/chat/VibeClipCard.tsx");
const nativeMediaViewer = read("apps/mobile/components/chat/ChatThreadMediaViewer.tsx");
const nativeMediaAssetHook = read("apps/mobile/hooks/useMediaAsset.ts");
const nativeMediaResolver = read("apps/mobile/lib/mediaAssetResolver.ts");
const threadPage = read("supabase/functions/chat-thread-page/index.ts");
const wholeHookResultDependencyPattern = /\[[^\]]*\b(?:mediaAsset|videoAsset|posterAsset|thumbnailAsset)\b[^\]]*\]/;

assert.match(resolver, /syncChatMessageMedia/);
assert.match(
  resolver,
  /let asset = await resolveMessageAsset[\s\S]*syncChatMessageMedia[\s\S]*asset = await resolveMessageAsset/,
);
assert.match(resolver, /if \(kind === "thumbnail"\) \{/);
assert.match(resolver, /asset\.media_family === "chat_video_thumbnail"/);
assert.match(resolver, /asset\.provider === "bunny_stream" && asset\.media_family === "chat_video"/);
assert.match(resolver, /fileName: "preview\.webp"/);
assert.match(resolver, /const previewUrl = await signBunnyStreamDirectoryUrl/);
assert.match(resolver, /const fallbackUrls = mediaKind === "thumbnail" \? \[previewUrl\] : \[\]/);
assert.match(resolver, /const posterFallbackUrls = mediaKind === "thumbnail" \? \[\] : \[previewUrl\]/);
assert.match(resolver, /function assetMatchesSourceRef\(asset: MediaAssetRow, sourceRef: unknown\): boolean/);
assert.match(resolver, /const sourceMatchedStorageThumbnail = assets\.find/);
assert.match(resolver, /const explicitThumbnailAsset = assets\.find\(\(asset\) => asset\.media_family === "chat_video_thumbnail"\)/);
assert.match(resolver, /const loadExactSourceAssets = async \(\): Promise<MediaAssetRow\[\]> =>/);
assert.match(resolver, /const fallbackExplicitThumbnailAsset = await loadLatestExplicitThumbnailAsset\(\)/);
assert.match(resolver, /const sourceRefTargetsStorageThumbnail =/);
assert.match(resolver, /const exactSourceStreamAsset = exactStreamSourceAssets\.find\(\(asset\) => assetMatchesSourceRef\(asset, sourceRef\)\)/);
assert.match(resolver, /const sourceMatchedStreamAsset = assets\.find\(\(asset\) => assetMatchesSourceRef\(asset, sourceRef\)\)/);
assert.match(resolver, /resolveMessageAsset\(serviceClient, scopedMessageId, mediaKind, body\?\.sourceRef\)/);
assert.match(resolver, /\.order\("created_at", \{ ascending: false \}\)[\s\S]{0,80}\.limit\(100\)/);
assert.match(webMediaResolver, /bunnyStreamVideoIdFromRef/);
assert.match(webMediaResolver, /if \(row\.video_url && !bunnyStreamVideoIdFromRef\(row\.video_url\)\)/);
assert.match(nativeMediaResolver, /bunnyStreamVideoIdFromRef/);
assert.match(nativeMediaResolver, /if \(row\.video_url && !bunnyStreamVideoIdFromRef\(row\.video_url\)\)/);
assert.match(webBubble, /useMediaAsset/);
assert.doesNotMatch(webBubble, wholeHookResultDependencyPattern);
assert.match(webBubble, /kind: "voice"/);
assert.match(webBubble, /refreshMediaAsset\("playback"\)/);
assert.match(webBubble, /isPlayableMediaAssetUrl/);
assert.match(webBubble, /proactiveResolveDoneRef/);
assert.match(webBubble, /void refreshAudioUrl\(\)/);
assert.match(webBubble, /const playSync = useCallback\(\(\) => \{/);
assert.match(webBubble, /void audio[\s\S]{0,80}\.play\(\)/);
assert.match(webBubble, /\.catch\(\(\) => \{[\s\S]*refreshAudioUrl\(\)/);
assert.match(webBubble, /refreshAttemptedForUrlRef\.current = playableUrl \?\? null/);
assert.doesNotMatch(webBubble, /pendingAutoplayRef|refreshAndPlay|await audioRef\.current\.play/);
assert.match(
  webBubble,
  /if \(!freshUrl \|\| freshUrl === playableUrl\) \{[\s\S]{0,120}setHasError\(true\);[\s\S]{0,80}return;[\s\S]{0,80}\}[\s\S]{0,80}refreshAttemptedForUrlRef\.current = playableUrl \?\? null;/,
);
assert.doesNotMatch(webBubble, /console\.error\("Audio failed to load:/);
assert.match(webVideoBubble, /useMediaAsset/);
assert.doesNotMatch(webVideoBubble, wholeHookResultDependencyPattern);
assert.match(webVideoBubble, /refreshMediaAsset/);
assert.match(webVideoBubble, /videoSourceRef/);
assert.match(webVideoBubble, /mediaKind\s*=\s*"video"/);
assert.match(webVideoBubble, /onError=\{\(\) => \{[\s\S]{0,240}tryRefreshAfterFailure/);
assert.match(webVideoBubble, /MAX_VIDEO_PLAYBACK_REFRESH_ATTEMPTS = 2/);
assert.match(webVideoBubble, /PLAYBACK_REFRESH_RETRY_DELAY_MS = 650/);
assert.match(webVideoBubble, /getCachedMediaAssetFailureCode/);
assert.match(webVideoBubble, /isTransientMediaAssetFailureCode/);
assert.match(webVideoBubble, /VIDEO_PLAYBACK_LOAD_TIMEOUT_MS/);
assert.match(webVideoBubble, /const isAwaitingPlaybackIntent = !canMountPlayer/);
assert.match(webVideoBubble, /const showResolvingPlaybackOverlay = isAwaitingPlaybackIntent && playRequested && !loadError/);
assert.match(webVideoBubble, /void refreshVideoUrlWithRetry\("initial", \{ bypassFailureCooldown: true \}\)/);
assert.match(webVideoBubble, /initialPlaybackResolveInFlightRef/);
assert.match(webVideoBubble, /if \(playRequested \|\| initialPlaybackResolveInFlightRef\.current\) return;[\s\S]{0,320}void refreshVideoUrlWithRetry\("initial", \{ bypassFailureCooldown: true \}\)/);
assert.match(webVideoBubble, /\{canMountPlayer \? \([\s\S]{0,120}<video/);
assert.match(webVideoBubble, /aria-label=\{videoAriaLabel\}/);
assert.match(webVideoBubble, /Preparing playback…/);
assert.match(webVideoBubble, /!isPlaying && !showPreparingOverlay && !showResolvingPlaybackOverlay && \(canMountPlayer \|\| isAwaitingPlaybackIntent\)/);
assert.match(webVideoBubble, /bypassFailureCooldown: true/);
assert.match(
  webVideoBubble,
  /const freshUrl = await refreshVideoUrlWithRetry\("playback", undefined, true\);[\s\S]{0,80}if \(!freshUrl\) return false;[\s\S]{0,160}if \(freshUrl === playableVideoUrl\) \{[\s\S]{0,140}reloadPreservesPlayIntentRef\.current[\s\S]{0,80}videoRef\.current\?\.load\(\);[\s\S]{0,80}return true;[\s\S]{0,80}return true;/,
);
assert.match(
  webVideoBubble,
  /const refreshPlaybackOnAuthError = useCallback\(async \(\) => \{[\s\S]*for \(let attempt = 0; attempt < MAX_VIDEO_PLAYBACK_REFRESH_ATTEMPTS; attempt \+= 1\) \{[\s\S]*refreshResolvedMediaAsset\(messageId, mediaKind, videoSourceRef,[\s\S]*getCachedMediaAssetFailureCode\(messageId, mediaKind, videoSourceRef\);[\s\S]*isTransientMediaAssetFailureCode\(failureCode\)/,
);
assert.match(webVideoBubble, /const commitResolvedPlaybackAsset = useCallback/);
assert.match(webVideoBubble, /if \(commitResolvedPlaybackAsset\(fresh\)\) return fresh/);
assert.match(webVideoBubble, /const refreshPlaybackProactively = useCallback[\s\S]*commitResolvedPlaybackAsset\(fresh\)/);
assert.match(webVideoBubble, /const showIdlePosterOverlay =/);
assert.match(webVideoBubble, /const \[hasStartedPlayback, setHasStartedPlayback\] = useState\(false\)/);
assert.match(webVideoBubble, /fallbackUrls: thumbnailFallbackUrls/);
assert.match(webVideoBubble, /const handlePosterImageError = useCallback/);
assert.match(webVideoBubble, /failedPosterUrlsRef\.current\.add\(failedUrl\)/);
assert.match(webVideoBubble, /!failedPosterUrlsRef\.current\.has\(candidate\)/);
assert.match(webVideoBubble, /if \(!posterImageBroken \|\| posterCandidateUrls\.length === 0\) return;[\s\S]{0,80}handlePosterImageError\(\);/);
assert.match(webVideoBubble, /showPosterVisual && canMountPlayer && !showPreparingOverlay && !hasStartedPlayback/);
assert.match(webVideoBubble, /const playRequestedRef = useRef\(false\)/);
assert.match(webVideoBubble, /const hasStartedPlaybackRef = useRef\(false\)/);
assert.match(webVideoBubble, /const reloadPreservesPlayIntentRef = useRef\(false\)/);
assert.match(webVideoBubble, /const preservePlayIntent = playRequestedRef\.current \|\| initialPlaybackResolveInFlightRef\.current/);
assert.match(webVideoBubble, /if \(reloadPreservesPlayIntentRef\.current\) \{[\s\S]{0,120}return;/);
assert.match(webVideoBubble, /if \(playRequestedRef\.current && !hasStartedPlaybackRef\.current\) \{[\s\S]{0,80}return;/);
assert.match(webVideoBubble, /const handlePause = useCallback\(\(\) => \{[\s\S]{0,420}setPlayRequested\(false\);[\s\S]{0,40}\}, \[\]\);/);
assert.match(webVideoBubble, /onPlaying=\{handlePlaying\}/);
assert.match(webVideoBubble, /onPause=\{handlePause\}/);
assert.doesNotMatch(webVideoBubble, /const posterNotReady =\s*!isReady/);
assert.match(webClipBubble, /useMediaAsset/);
assert.doesNotMatch(webClipBubble, wholeHookResultDependencyPattern);
assert.match(webClipBubble, /useMediaAssetPlayback/);
assert.match(webClipBubble, /videoSourceRef/);
assert.match(webClipBubble, /thumbnailSourceRef/);
assert.match(webClipBubble, /MAX_CLIP_PLAYBACK_REFRESH_ATTEMPTS = 2/);
assert.match(webClipBubble, /PLAYBACK_REFRESH_RETRY_DELAY_MS = 650/);
assert.match(webClipBubble, /getCachedMediaAssetFailureCode/);
assert.match(webClipBubble, /isTransientMediaAssetFailureCode/);
assert.match(webClipBubble, /type VibeClipMediaRefreshReason = "preview" \| "initial" \| "playback" \| "manual"/);
assert.match(webClipBubble, /initialPlaybackResolveInFlightRef/);
assert.match(webClipBubble, /if \(initialPlaybackResolveInFlightRef\.current\) return;[\s\S]{0,260}void refreshClipMedia\("initial"\)/);
assert.match(
  webClipBubble,
  /reason === "manual" \|\| reason === "initial"[\s\S]{0,50}\? \{ bypassFailureCooldown: true \}[\s\S]{0,40}: reason === "preview"[\s\S]{0,60}\? \{ bypassFailureCooldown: true, suppressFailureCache: true \}[\s\S]{0,30}: undefined/,
);
// First-go poster reliability: bounded, capped backoff retry that re-signs the thumbnail.
assert.match(webClipBubble, /POSTER_PREVIEW_RETRY_DELAYS_MS = \[1000, 3000, 8000\]/);
assert.match(webClipBubble, /posterRetryStateRef/);
assert.match(webClipBubble, /state\.attempts >= POSTER_PREVIEW_RETRY_DELAYS_MS\.length/);
assert.match(webClipBubble, /void refreshClipMedia\("preview"\)\.finally\(/);
assert.match(webClipBubble, /setPosterImageBroken\(true\)/);
assert.match(webClipBubble, /poster=\{showPosterVisual \? displayableThumbnailUrl \?\? undefined : undefined\}/);
assert.match(webClipBubble, /const showIdlePosterOverlay =/);
assert.match(webClipBubble, /const \[hasStartedPlayback, setHasStartedPlayback\] = useState\(false\)/);
assert.match(webClipBubble, /metaThumbnailUrlRef/);
assert.doesNotMatch(webClipBubble, /\[meta\.processingStatus, meta\.thumbnailUrl, meta\.videoUrl, sparkMessageId\]/);
assert.match(webClipBubble, /fallbackUrls: thumbnailFallbackUrls/);
assert.match(webClipBubble, /const handlePosterImageError = useCallback/);
assert.match(webClipBubble, /failedPosterUrlsRef\.current\.add\(failedUrl\)/);
assert.match(webClipBubble, /!failedPosterUrlsRef\.current\.has\(candidate\)/);
assert.match(
  webClipBubble,
  /failedPosterUrlsRef\.current\.clear\(\);[\s\S]{0,120}posterRetryStateRef\.current = \{ key: "", attempts: 0 \};[\s\S]{0,120}setPosterImageBroken\(false\);[\s\S]{0,80}\}, \[thumbnailSourceRef\]\);/,
);
assert.match(webClipBubble, /if \(!posterImageBroken \|\| posterCandidateUrls\.length === 0\) return;[\s\S]{0,80}handlePosterImageError\(\);/);
assert.match(webClipBubble, /!showPreparingOverlay[\s\S]{0,80}!hasStartedPlayback/);
assert.match(webClipBubble, /const hasStartedPlaybackRef = useRef\(false\)/);
assert.match(webClipBubble, /const reloadPreservesPlayIntentRef = useRef\(false\)/);
assert.match(webClipBubble, /reloadPreservesPlayIntentRef\.current = playRequestedRef\.current \|\| initialPlaybackResolveInFlightRef\.current/);
assert.match(webClipBubble, /if \(reloadPreservesPlayIntentRef\.current\) \{[\s\S]{0,120}return;/);
assert.match(webClipBubble, /if \(playRequestedRef\.current && !hasStartedPlaybackRef\.current\) \{[\s\S]{0,80}return;/);
assert.match(webClipBubble, /const handlePause = useCallback\(\(\) => \{[\s\S]{0,420}setPlayRequested\(false\);[\s\S]{0,40}\}, \[\]\);/);
assert.match(webClipBubble, /onPause=\{handlePause\}/);
assert.doesNotMatch(webClipBubble, /const posterNotReady =\s*!isReady/);
assert.match(webClipBubble, /refreshVideoAsset\(reason, attemptOptions\)/);
assert.match(webClipBubble, /refreshThumbnailAsset\(reason === "manual" \? "manual" : "preview", refreshOptions\)/);
assert.doesNotMatch(webClipBubble, /if \(didRefresh\) posterRefreshAttemptedForRef\.current = null/);
assert.match(
  webClipBubble,
  /for \(let attempt = 0; attempt < MAX_CLIP_PLAYBACK_REFRESH_ATTEMPTS; attempt \+= 1\) \{[\s\S]*if \(reason === "playback"\) \{[\s\S]*playbackRefreshAttemptCountRef\.current \+= 1;/,
);
assert.match(
  webClipBubble,
  /if \(reason === "preview"\) return refreshPoster\(\);[\s\S]*const videoRefresh = refreshVideoAsset\(reason, attemptOptions\);[\s\S]*startPosterRefresh\(\);[\s\S]*freshVideoUrl = await videoRefresh;[\s\S]*if \(!freshVideoUrl\) return false;[\s\S]*if \(freshVideoUrl === playableVideoUrl\) \{[\s\S]*videoRef\.current\?\.load\(\);[\s\S]*return true;[\s\S]*return true;/,
);
assert.match(
  webClipBubble,
  /const refreshPlaybackOnAuthError = useCallback\(async \(\) => \{[\s\S]*for \(let attempt = 0; attempt < MAX_CLIP_PLAYBACK_REFRESH_ATTEMPTS; attempt \+= 1\) \{[\s\S]*refreshResolvedMediaAsset\(sparkMessageId, "vibe_clip", videoSourceRef,[\s\S]*getCachedMediaAssetFailureCode\(sparkMessageId, "vibe_clip", videoSourceRef\);[\s\S]*isTransientMediaAssetFailureCode\(failureCode\)/,
);
assert.match(webClipBubble, /const commitResolvedPlaybackAsset = useCallback/);
assert.match(webClipBubble, /if \(commitResolvedPlaybackAsset\(fresh\)\) return fresh/);
assert.match(webClipBubble, /const refreshPlaybackProactively = useCallback[\s\S]*commitResolvedPlaybackAsset\(fresh\)/);
assert.match(
  webPhotoLightbox,
  /if \(!freshUrl \|\| freshUrl === currentUrl\) return;[\s\S]{0,80}refreshAttemptedForUrlRef\.current = currentUrl;/,
);
assert.match(webPhotoLightbox, /refreshAttemptedForUrlRef\.current = null;[\s\S]{0,80}\}, \[current\?\.id\]\);/);
assert.match(webPhotoLightbox, /lastInitialIdRef/);
assert.match(webPhotoLightbox, /previousItemsRef/);
assert.match(webPhotoLightbox, /const \[selectedId, setSelectedId\] = useState/);
assert.match(webPhotoLightbox, /resolvePreservedMediaSelectionId/);
assert.match(webPhotoLightbox, /const selectedIndex = items\.findIndex\(\(it\) => it\.id === selectedId\);/);
assert.doesNotMatch(webPhotoLightbox, /const currentId = items\[prevIndex\]\?\.id/);
assert.doesNotMatch(webPhotoLightbox, /setIndex\(i >= 0 \? i : 0\);[\s\S]{0,120}\}, \[initialId, items\]\);/);
assert.match(
  webVideoLightbox,
  /for \(let attempt = 0; attempt < MAX_LIGHTBOX_PLAYBACK_REFRESH_ATTEMPTS; attempt \+= 1\) \{[\s\S]*playbackRefreshAttemptCountRef\.current \+= 1;[\s\S]*freshVideoUrl = await refreshVideoAsset\(reason, attemptOptions\);[\s\S]*if \(!freshVideoUrl\) return false;[\s\S]*if \(freshVideoUrl === currentUrl\) \{[\s\S]*videoRef\.current\?\.load\(\);[\s\S]*\} else \{[\s\S]*setPlayableVideoUrl\(freshVideoUrl\);/,
);
assert.match(
  webVideoLightbox,
  /const refreshPlaybackOnAuthError = useCallback\(async \(\) => \{[\s\S]*for \(let attempt = 0; attempt < MAX_LIGHTBOX_PLAYBACK_REFRESH_ATTEMPTS; attempt \+= 1\) \{[\s\S]*refreshResolvedMediaAsset\(messageId, mediaKind, videoSourceRef,[\s\S]*getCachedMediaAssetFailureCode\(messageId, mediaKind, videoSourceRef\);[\s\S]*isTransientMediaAssetFailureCode\(failureCode\)/,
);
assert.match(webVideoLightbox, /const commitResolvedPlaybackAsset = useCallback/);
assert.match(webVideoLightbox, /if \(commitResolvedPlaybackAsset\(fresh\)\) return fresh/);
assert.match(webVideoLightbox, /const refreshPlaybackProactively = useCallback[\s\S]*commitResolvedPlaybackAsset\(fresh\)/);
assert.match(webVideoLightbox, /useMediaAsset/);
assert.doesNotMatch(webVideoLightbox, wholeHookResultDependencyPattern);
assert.match(webVideoLightbox, /useMediaAssetPlayback/);
assert.match(webVideoLightbox, /type LightboxMediaRefreshReason = "initial" \| "playback" \| "manual"/);
assert.match(webVideoLightbox, /reason === "manual" \? \{ bypassFailureCooldown: true \} : undefined/);
assert.match(webVideoLightbox, /refreshPosterAsset\("cache"\)/);
assert.match(webVideoLightbox, /posterFallbackResolveInFlightRef/);
assert.match(webVideoLightbox, /posterFallbackResolveAttemptedForRef/);
assert.match(webVideoLightbox, /const thumbnailSource = thumbnailSourceRef/);
assert.match(webVideoLightbox, /const stableMessageId = messageId/);
assert.match(webVideoLightbox, /const stableThumbnailSource = thumbnailSource/);
assert.match(webVideoLightbox, /refreshResolvedMediaAsset\(stableMessageId, "thumbnail", stableThumbnailSource/);
assert.match(webVideoLightbox, /asset\?\.fallbackUrls \?\? \[\]/);
assert.match(webVideoLightbox, /setExtraPosterFallbackUrls/);
assert.match(webVideoLightbox, /refreshedCurrentIndex === -1/);
assert.match(webVideoLightbox, /if \(displayablePosterUrl\(playablePosterUrl\) \|\| !thumbnailSourceRef\) return;/);
assert.match(webVideoLightbox, /onResolvedThumbnailUrlRef\.current\?\.\(displayableUrl\)/);
assert.match(webVideoLightbox, /failedPosterUrlsRef\.current\.add\(failedUrl\)/);
assert.match(webVideoLightbox, /!failedPosterUrlsRef\.current\.has\(candidate\)/);
assert.match(
  webVideoLightbox,
  /failedPosterUrlsRef\.current\.clear\(\);[\s\S]{0,120}posterFallbackResolveAttemptedForRef\.current = null;[\s\S]{0,120}setPosterImageBroken\(false\);[\s\S]{0,80}\}, \[thumbnailSourceRef\]\);/,
);
assert.match(
  webVideoLightbox,
  /displayableFreshPosterUrl[\s\S]{0,120}failedPosterUrlsRef\.current\.clear\(\);[\s\S]{0,120}setPlayablePosterUrl\(displayableFreshPosterUrl\)/,
);
assert.match(webVideoLightbox, /poster=\{visiblePosterUrl \?\? undefined\}/);
assert.match(webVideoLightbox, /const \[hasStartedPlayback, setHasStartedPlayback\] = useState\(false\)/);
assert.match(webVideoLightbox, /const showPosterProbe = !!visiblePosterUrl && !hasStartedPlayback && phase !== "error"/);
assert.match(webVideoLightbox, /const showLoadingPosterOverlay = !!visiblePosterUrl && phase === "loading"/);
assert.match(webVideoLightbox, /onPlaying=\{handlePlaying\}/);
assert.match(webVideoLightbox, /onEnded=\{handleEnded\}/);
assert.match(webVideoLightbox, /showPosterProbe \? \([\s\S]{0,260}onError=\{handlePosterImageError\}/);
assert.match(webVideoLightbox, /onAutoplayBlocked: revealPlayer/);
assert.doesNotMatch(webVideoLightbox, /onWaiting=\{\(\) => setPhase\("loading"\)\}/);
assert.match(webVideoLightbox, /CLIP_PLAYBACK_LOAD_TIMEOUT_MS/);
assert.match(webVideoLightbox, /phase !== "loading" \|\| !canMountPlayer/);
assert.match(
  webVideoLightbox,
  /const timeoutId = window\.setTimeout\(\(\) => \{[\s\S]{0,80}revealPlayer\(\);[\s\S]{0,80}\}, CLIP_PLAYBACK_LOAD_TIMEOUT_MS\);/,
);
assert.doesNotMatch(
  webVideoLightbox,
  /const timeoutId = window\.setTimeout\(\(\) => \{[\s\S]{0,180}refreshMedia\(\)/,
);
assert.match(webMediaAssetHook, /function proactiveRefreshDelayMs/);
assert.match(webMediaAssetHook, /remainingMs <= IMMEDIATE_PROACTIVE_REFRESH_THRESHOLD_MS\) return 0/);
assert.match(webMediaAssetHook, /Math\.min\(MIN_PROACTIVE_REFRESH_DELAY_MS, Math\.floor\(remainingMs \/ 2\)\)/);
assert.doesNotMatch(webMediaAssetHook, /Math\.max\(MIN_PROACTIVE_REFRESH_DELAY_MS, Math\.floor\(remainingMs \/ 2\)\)/);
assert.match(webClipBubble, /playbackRefreshAttemptCountRef\.current = 0;[\s\S]{0,160}setLoadError\(false\)/);
assert.match(webMediaResolver, /type MediaUrlIssueResult/);
assert.match(webMediaResolver, /isNetworkInvokeError/);
assert.match(webMediaResolver, /invokeError\.name === "FunctionsHttpError"/);
assert.match(webMediaResolver, /return \{[\s\S]{0,80}kind: "response",[\s\S]{0,120}payload: await resolverPayloadForHttpFailure/);
assert.match(webMediaResolver, /if \(error\) return issueResultForFunctionInvokeError\(error, response\);/);
assert.doesNotMatch(webMediaResolver, /if \(error\) return \{ kind: "transient_failure" \};/);
assert.match(webMediaResolver, /catch \{[\s\S]{0,100}return \{ kind: "transient_failure", errorCode: "network_error" \};[\s\S]{0,80}\}/);
assert.match(webMediaResolver, /if \(result\.kind === "transient_failure"\) \{[\s\S]{0,150}!options\.suppressFailureCache[\s\S]{0,120}recordMediaUrlFailure\(cacheKey, result\.errorCode\);[\s\S]{0,80}return null;/);
assert.match(webMediaResolver, /bunnyStreamThumbnailRefFor,[\s\S]{0,80}bunnyStreamVideoIdFromRef,[\s\S]{0,80}deriveChatVideoThumbnailRef/);
assert.match(webMediaResolver, /const thumbnailRef = deriveChatVideoThumbnailRef/);
assert.match(webMediaResolver, /\{ messageId, mediaKind, sourceRef: rawRef/);
assert.match(webMediaResolver, /payload\.posterUrl/);
assert.match(webMediaResolver, /fallbackUrls: normalizePlayableUrlList\(payload\.fallbackUrls/);
assert.match(webMediaResolver, /posterFallbackUrls: normalizePlayableUrlList\(payload\.posterFallbackUrls/);
assert.match(webMediaResolver, /fallbackUrls: resolvedAsset\.posterFallbackUrls/);
assert.match(webMediaResolver, /mediaUrlInFlightRequests/);
assert.match(webMediaResolver, /mediaUrlFailureCache/);
assert.match(webMediaResolver, /export function isTransientMediaAssetFailureCode/);
assert.match(webMediaResolver, /export function isFatalMediaAssetFailureCode/);
assert.match(webMediaResolver, /bypassFailureCooldown/);
assert.match(webMediaResolver, /payload\?\.kind === "chat_image" && payload\.v === 2 && payload\.provider === "bunny_storage"/);
assert.match(webMediaResolver, /await getCachedMediaAsset\(row\.id, "thumbnail", thumbnailRef/);
assert.match(webMediaResolver, /displayPayload\.thumbnail_url = thumbnailUrl/);
assert.match(nativeBubble, /useMediaAsset/);
assert.doesNotMatch(nativeBubble, wholeHookResultDependencyPattern);
assert.match(nativeBubble, /refreshMediaAsset\('playback'\)/);
assert.match(nativeBubble, /player\.play\(\)[\s\S]{0,600}refreshAndQueuePlay/);
assert.match(
  nativeBubble,
  /if \(fresh === playableUri\) \{[\s\S]{0,140}return playCurrent\(\);[\s\S]{0,80}\}[\s\S]{0,80}refreshAttemptedForUriRef\.current = playableUri;[\s\S]{0,80}return true;/,
);
assert.match(
  nativeBubble,
  /if \(!fresh \|\| fresh === playableUri\) \{[\s\S]{0,120}setHasError\(true\);[\s\S]{0,80}return;[\s\S]{0,80}\}[\s\S]{0,80}refreshAttemptedForUriRef\.current = playableUri;/,
);
assert.match(nativeClipCard, /useMediaAsset/);
assert.doesNotMatch(nativeClipCard, wholeHookResultDependencyPattern);
assert.match(nativeClipCard, /videoSourceRef/);
assert.match(nativeClipCard, /thumbnailSourceRef/);
assert.match(nativeClipCard, /kind: 'thumbnail'[\s\S]{0,160}autoResolve: true/);
assert.match(nativeClipCard, /MAX_CLIP_PLAYBACK_REFRESH_ATTEMPTS = 2/);
assert.match(nativeClipCard, /PLAYBACK_REFRESH_RETRY_DELAY_MS = 650/);
assert.match(nativeClipCard, /getCachedMediaAssetFailureCode/);
assert.match(nativeClipCard, /isTransientMediaAssetFailureCode/);
assert.match(nativeClipCard, /type VibeClipMediaRefreshReason = 'preview' \| 'initial' \| 'playback' \| 'manual'/);
assert.match(
  nativeClipCard,
  /reason === 'manual' \|\| reason === 'initial'[\s\S]{0,50}\? \{ bypassFailureCooldown: true \}[\s\S]{0,40}: reason === 'preview'[\s\S]{0,60}\? \{ bypassFailureCooldown: true, suppressFailureCache: true \}[\s\S]{0,30}: undefined/,
);
// First-go poster reliability mirrors web: bounded, capped backoff retry.
assert.match(nativeClipCard, /POSTER_PREVIEW_RETRY_DELAYS_MS = \[1000, 3000, 8000\]/);
assert.match(nativeClipCard, /posterRetryStateRef/);
assert.match(nativeClipCard, /state\.attempts >= POSTER_PREVIEW_RETRY_DELAYS_MS\.length/);
assert.match(nativeClipCard, /void refreshClipMedia\('preview'\)\.finally\(/);
assert.match(nativeClipCard, /isResolvableMediaRef\(playableThumbnailUrl\)/);
assert.match(nativeClipCard, /source=\{\{ uri: displayableUri \}\}/);
assert.match(nativeClipCard, /isReady && !hasPlayed && hasPosterVisual/);
assert.match(nativeClipCard, /CLIP_PLAYBACK_LOAD_TIMEOUT_MS/);
assert.match(nativeClipCard, /onResetPlaybackRefreshAttempt/);
assert.match(nativeClipCard, /setHasError\(false\)/);
assert.match(nativeClipCard, /refreshVideoAsset\(reason, attemptOptions\)/);
assert.match(nativeClipCard, /refreshThumbnailAsset\(reason === 'manual' \? 'manual' : 'preview', refreshOptions\)/);
assert.match(nativeClipCard, /onResolvedVideoUrl\?\.\(freshVideoUri\)/);
assert.match(nativeClipCard, /onResolvedThumbnailUrlRef\.current\?\.\(displayableFreshThumbnailUri\)/);
assert.match(nativeClipCard, /\(!videoSourceRef && !thumbnailSourceRef\)/);
assert.match(nativeClipCard, /setPosterPreviewState\('unknown', displayableFreshThumbnailUri\)/);
assert.match(nativeClipCard, /initialPlaybackResolveInFlightRef/);
assert.match(nativeClipCard, /if \(initialPlaybackResolveInFlightRef\.current\) return;[\s\S]{0,260}void refreshClipMedia\('initial'\)/);
assert.doesNotMatch(nativeClipCard, /if \(didRefresh\) posterRefreshAttemptedForRef\.current = null/);
assert.match(
  nativeChatScreen,
  /for \(let attempt = 0; attempt < CHAT_VIDEO_PLAYBACK_REFRESH_ATTEMPTS; attempt \+= 1\) \{[\s\S]*freshUri = await refreshMediaAsset\(reason, attemptOptions\);[\s\S]*getCachedMediaAssetFailureCode\(messageId, mediaAssetKind, sourceRef\);[\s\S]*isTransientMediaAssetFailureCode\(failureCode\)[\s\S]*if \(!freshUri\) return false;[\s\S]*if \(freshUri === playableUri\) \{[\s\S]*setRetryNonce\(\(n\) => n \+ 1\);/,
);
assert.match(nativeChatScreen, /type ChatVideoMediaRefreshReason = 'initial' \| 'playback' \| 'manual'/);
assert.match(nativeChatScreen, /CHAT_VIDEO_PLAYBACK_LOAD_TIMEOUT_MS = 12_000/);
assert.match(nativeChatScreen, /shouldMountPlayer && isChatVideoPlaybackUri\(uri\) \? chatVideoSourceForUri\(uri\) : null/);
assert.match(nativeChatScreen, /const \[isResolvingInitialPlayback, setIsResolvingInitialPlayback\] = useState\(false\)/);
assert.match(nativeChatScreen, /const \[initialPlaybackResolveFailed, setInitialPlaybackResolveFailed\] = useState\(false\)/);
assert.match(nativeChatScreen, /initialPlaybackResolveInFlightRef/);
assert.match(nativeChatScreen, /if \(initialPlaybackResolveInFlightRef\.current\) return;[\s\S]{0,260}void refreshMediaUri\('initial', \{ bypassFailureCooldown: true \}\)/);
assert.match(nativeChatScreen, /void refreshMediaUri\('initial', \{ bypassFailureCooldown: true \}\)/);
assert.match(nativeChatScreen, /onRequestInlinePlay=\{requestInlinePlay\}/);
assert.match(nativeChatScreen, /shouldMountPlayer=\{canMountPlayer && forceMountPlayer\}/);
assert.match(nativeChatScreen, /playRequestToken=\{inlinePlayRequestToken\}/);
assert.match(nativeChatScreen, /isResolvingPlayback=\{isResolvingInitialPlayback\}/);
assert.match(nativeChatScreen, /!hasPlaybackError && \(\(shouldMountPlayer && !isReady\) \|\| \(!shouldMountPlayer && isResolvingPlayback\)\)/);
assert.match(
  nativeChatScreen,
  /const timeoutId = setTimeout\(\(\) => \{[\s\S]{0,120}onRefreshMediaUri\('playback'\)[\s\S]{0,180}showPlaybackError\(\);[\s\S]{0,80}\}, CHAT_VIDEO_PLAYBACK_LOAD_TIMEOUT_MS\);/,
);
assert.match(
  nativeClipCard,
  /if \(reason === 'preview'\) return refreshPoster\(\);/,
);
assert.match(
  nativeClipCard,
  /for \(let attempt = 0; attempt < MAX_CLIP_PLAYBACK_REFRESH_ATTEMPTS; attempt \+= 1\) \{[\s\S]*if \(reason === 'playback'\) \{[\s\S]*playbackRefreshAttemptCountRef\.current \+= 1;/,
);
assert.match(
  nativeClipCard,
  /if \(reason === 'preview'\) return refreshPoster\(\);[\s\S]*const videoRefresh = refreshVideoAsset\(reason, attemptOptions\);[\s\S]*startPosterRefresh\(\);[\s\S]*freshVideoUri = await videoRefresh;[\s\S]*if \(!freshVideoUri\) return false;[\s\S]*if \(freshVideoUri === playableVideoUrl\) \{[\s\S]*setRetryNonce\(\(n\) => n \+ 1\);[\s\S]*return true;/,
);
assert.match(
  nativeMediaViewer,
  /if \(!freshUri \|\| freshUri === currentUri\) return;[\s\S]{0,80}refreshAttemptedForUriRef\.current = currentUri;/,
);
assert.match(nativeMediaViewer, /refreshAttemptedForUriRef\.current = null;[\s\S]{0,80}\}, \[current\?\.id\]\);/);
assert.match(nativeMediaViewer, /lastInitialIdRef/);
assert.match(nativeMediaViewer, /previousItemsRef/);
assert.match(nativeMediaViewer, /const \[selectedId, setSelectedId\] = useState/);
assert.match(nativeMediaViewer, /resolvePreservedMediaSelectionId/);
assert.match(nativeMediaViewer, /const index = Math\.max\(0, items\.findIndex\(\(i\) => i\.id === selectedId\)\);/);
assert.doesNotMatch(nativeMediaViewer, /const currentId = items\[prevIndex\]\?\.id/);
assert.doesNotMatch(nativeMediaViewer, /setIndex\(Math\.max\(0, items\.findIndex\(\(i\) => i\.id === initialId\)\)\);[\s\S]{0,120}\}, \[initialId, items\]\);/);
assert.match(
  nativeMediaViewer,
  /const refreshMedia = useCallback\(async \(reason: 'playback' \| 'poster' \| 'manual' = 'playback'\)[\s\S]*if \(reason === 'poster' && advancePosterCandidate\(\)\) return true;[\s\S]*fresh = await onRefreshMedia\(reason\);[\s\S]*const freshPosterFallbackUris = uniqueDisplayablePosterUris\(fresh\?\.posterFallbackUris \?\? \[\]\);[\s\S]*if \(!fresh\?\.uri\) return !!freshPosterUri;[\s\S]*if \(fresh\.uri === playableUri\) \{[\s\S]*if \(reason === 'poster'\) return !!freshPosterUri;[\s\S]*setRetryKey\(\(k\) => k \+ 1\);/,
);
assert.match(nativeMediaViewer, /void refreshMedia\('poster'\)/);
assert.match(nativeMediaViewer, /posterResolveAttemptedForUriRef/);
assert.match(nativeMediaViewer, /posterRefreshAttemptedForUriRef/);
assert.match(nativeMediaViewer, /posterFallbackUris\?: string\[\] \| null/);
assert.match(nativeMediaViewer, /const \[posterFallbackUris, setPosterFallbackUris\] = useState<string\[\]>\(\[\]\)/);
assert.match(nativeMediaViewer, /function uniqueDisplayablePosterUris/);
assert.match(nativeMediaViewer, /const advancePosterCandidate = useCallback/);
assert.match(nativeMediaViewer, /failedPosterUrisRef\.current\.add\(currentPosterUri\)/);
assert.match(nativeMediaViewer, /!failedPosterUrisRef\.current\.has\(candidate\)/);
assert.match(nativeMediaViewer, /posterUri=\{displayablePosterUri\(playablePosterUri\)\}/);
assert.match(nativeMediaViewer, /posterUri && phase === 'loading'/);
assert.match(nativeMediaViewer, /posterUri && phase !== 'error'/);
assert.match(nativeMediaViewer, /style=\{styles\.videoPosterProbe\}/);
assert.match(nativeMediaViewer, /pointerEvents="none"/);
assert.match(nativeMediaViewer, /CLIP_PLAYBACK_LOAD_TIMEOUT_MS/);
assert.match(nativeMediaViewer, /phase !== 'loading'/);
assert.match(
  nativeMediaViewer,
  /const timeoutId = setTimeout\(\(\) => \{[\s\S]{0,80}revealPlayer\(\);[\s\S]{0,80}\}, CLIP_PLAYBACK_LOAD_TIMEOUT_MS\);/,
);
assert.doesNotMatch(
  nativeMediaViewer,
  /const timeoutId = setTimeout\(\(\) => \{[\s\S]{0,180}onRefreshMedia\(\)/,
);
assert.match(nativeMediaAssetHook, /function proactiveRefreshDelayMs/);
assert.match(nativeMediaAssetHook, /remainingMs <= IMMEDIATE_PROACTIVE_REFRESH_THRESHOLD_MS\) return 0/);
assert.match(nativeMediaAssetHook, /Math\.min\(MIN_PROACTIVE_REFRESH_DELAY_MS, Math\.floor\(remainingMs \/ 2\)\)/);
assert.doesNotMatch(nativeMediaAssetHook, /Math\.max\(MIN_PROACTIVE_REFRESH_DELAY_MS, Math\.floor\(remainingMs \/ 2\)\)/);
assert.match(nativeMediaViewer, /onResetPlaybackRefreshAttempt/);
assert.match(nativeMediaResolver, /type MediaUrlIssueResult/);
assert.match(nativeMediaResolver, /if \(!accessToken\) return \{ kind: 'transient_failure', errorCode: 'auth_expired' \};/);
assert.match(nativeMediaResolver, /isNetworkInvokeError/);
assert.match(nativeMediaResolver, /invokeError\.name === 'FunctionsHttpError'/);
assert.match(nativeMediaResolver, /return \{[\s\S]{0,80}kind: 'response',[\s\S]{0,120}payload: await resolverPayloadForHttpFailure/);
assert.match(nativeMediaResolver, /if \(error\) return issueResultForFunctionInvokeError\(error, response\);/);
assert.doesNotMatch(nativeMediaResolver, /if \(error\) return \{ kind: 'transient_failure' \};/);
assert.match(nativeMediaResolver, /catch \{[\s\S]{0,100}return \{ kind: 'transient_failure', errorCode: 'network_error' \};[\s\S]{0,80}\}/);
assert.match(nativeMediaResolver, /if \(result\.kind === 'transient_failure'\) \{[\s\S]{0,150}!options\.suppressFailureCache[\s\S]{0,120}recordMediaUrlFailure\(cacheKey, result\.errorCode\);[\s\S]{0,80}return null;/);
assert.match(nativeMediaResolver, /mediaUrlInFlightRequests/);
assert.match(nativeMediaResolver, /mediaUrlFailureCache/);
assert.match(nativeMediaResolver, /export function isTransientMediaAssetFailureCode/);
assert.match(nativeMediaResolver, /export function isFatalMediaAssetFailureCode/);
assert.match(nativeMediaResolver, /bypassFailureCooldown/);
assert.match(nativeMediaResolver, /payload\?\.kind === 'chat_image' && payload\.v === 2 && payload\.provider === 'bunny_storage'/);
assert.match(nativeMediaResolver, /getFreshCachedAccessToken/);
assert.match(nativeMediaResolver, /headers: \{ Authorization: `Bearer \$\{accessToken\}` \}/);
assert.match(nativeMediaResolver, /await getCachedMediaAsset\(row\.id, 'thumbnail', thumbnailRef/);
assert.match(nativeMediaResolver, /displayPayload\.thumbnail_url = thumbnailUrl/);
assert.match(nativeMediaResolver, /bunnyStreamThumbnailRefFor,[\s\S]{0,80}bunnyStreamVideoIdFromRef,[\s\S]{0,80}deriveChatVideoThumbnailRef/);
assert.match(nativeMediaResolver, /const thumbnailRef = deriveChatVideoThumbnailRef/);
assert.match(nativeMediaResolver, /\{ messageId, mediaKind, sourceRef: rawRef/);
assert.match(nativeMediaResolver, /payload\.posterUrl/);
assert.match(nativeMediaResolver, /fallbackUrls: normalizePlayableUrlList\(payload\.fallbackUrls/);
assert.match(nativeMediaResolver, /posterFallbackUrls: normalizePlayableUrlList\(payload\.posterFallbackUrls/);
assert.match(nativeMediaResolver, /fallbackUrls: resolvedAsset\.posterFallbackUrls/);
assert.match(nativeMediaResolver, /const urls = \[primaryUrl, \.\.\.fallbackUrls\]/);
assert.match(nativeMediaAssetHook, /fallbackUrls: string\[\]/);
assert.match(nativeMediaAssetHook, /posterFallbackUrls: string\[\]/);
assert.match(nativeMediaAssetHook, /setFallbackUrls\(result\.fallbackUrls\)/);
assert.match(nativeMediaAssetHook, /setPosterFallbackUrls\(result\.posterFallbackUrls\)/);
assert.match(nativeChat, /extras:\s*\{\s*httpSend:\s*true\s*\}/);
assert.match(threadPage, /\.from\("media_assets"\)/);
assert.match(threadPage, /date_suggestions/);
assert.doesNotMatch(threadPage, /syncChatMessageMedia/);
assert.doesNotMatch(threadPage, /createToken|signedProxyUrl|TOKEN_TTL_SECONDS/);
assert.match(threadPage, /const durableAssetRef = \(messageId: string, kind: MediaKind\): string \| null =>/);
assert.match(threadPage, /next\.audio_url = durableAssetRef\(next\.id, "voice"\) \?\? next\.audio_url/);
assert.match(threadPage, /function assetPriorityForKind\(asset: MediaAssetRow, kind: MediaKind\): number/);
assert.match(threadPage, /asset\.media_family === "chat_video_thumbnail"[\s\S]{0,120}return 2/);
assert.match(threadPage, /asset\.provider === "bunny_stream" && asset\.media_family === "chat_video"[\s\S]{0,120}return 1/);
assert.match(threadPage, /const shouldHydrateVideo =/);
assert.match(threadPage, /const durableThumbnailRef = \(shouldHydrateVideo \|\| !!next\.video_url\) \? durableAssetRef\(next\.id, "thumbnail"\) : null/);
assert.match(threadPage, /const effectiveThumbnailRef = durableThumbnailRef \?\? thumbnailRef/);
assert.match(threadPage, /kind === "thumbnail" && asset\.provider === "bunny_stream" && asset\.media_family === "chat_video"/);
assert.match(threadPage, /payload\.thumbnail_url = effectiveThumbnailRef/);
assert.match(threadPage, /payload\.poster_ref = effectiveThumbnailRef/);
assert.match(threadPage, /payload\?\.kind === "chat_image" && payload\.v === 2 && payload\.provider === "bunny_storage"/);
assert.match(threadPage, /formatChatImageMessageContent\(durableImageRef\)/);
assert.match(threadPage, /function parseThreadPageCursor/);
assert.match(threadPage, /\.order\("created_at", \{ ascending: false \}\)[\s\S]{0,120}\.order\("id", \{ ascending: false \}\)/);
assert.match(threadPage, /created_at\.lt\.\$\{beforeCursor\.createdAt\},and\(created_at\.eq\.\$\{beforeCursor\.createdAt\},id\.lt\.\$\{beforeCursor\.id\}\)/);
assert.match(threadPage, /next_cursor: rowsDesc\.length >= limit \? encodeThreadPageCursor/);
assert.match(webMessagesHook, /function parseThreadPageCursor/);
assert.match(webMessagesHook, /\[89ab\]\[0-9a-f\]\{3\}-\[0-9a-f\]\{12\}/);
assert.doesNotMatch(webMessagesHook, /\[89ab\]\[0-9a-f\]\{12\}/);
assert.match(webMessagesHook, /collectChatMediaSourceRefs/);
assert.match(webMessagesHook, /deriveChatVideoThumbnailRef\(row\)/);
assert.match(webMessagesHook, /Keep video playback lazy on chat open; thumbnails are the eager visual contract/);
assert.doesNotMatch(webMessagesHook, /kind: row\.message_kind === "vibe_clip" \? "vibe_clip" : "video"/);
assert.match(webMessagesHook, /imageSourceRef: sourceRefs\?\.image/);
assert.match(webMessagesHook, /videoSourceRef: sourceRefs\?\.video/);
assert.match(webMessagesHook, /thumbnailSourceRef: sourceRefs\?\.thumbnail/);
assert.match(webMessagesHook, /\.order\("created_at", \{ ascending: false \}\)[\s\S]{0,120}\.order\("id", \{ ascending: false \}\)/);
assert.match(webMessagesHook, /for \(const page of chronologicalPages\) \{[\s\S]*page\.dateSuggestions/);
assert.match(webChatPage, /photoUrlOverridesById/);
assert.match(webChatPage, /videoUrlOverridesById/);
assert.match(webChatPage, /thumbnailUrlOverridesById/);
assert.match(webChatPage, /refreshMediaAssetUrl\(message\.id, "image", message\.imageSourceRef\)/);
assert.match(webChatPage, /onError=\{\(\) => \{[\s\S]{0,180}refreshPhotoUrlForMessage/);
assert.match(webChatPage, /videoSourceRef=\{groupedMessage\.videoSourceRef\}/);
assert.match(webChatPage, /const effectiveThumbnailSourceRef = useMemo/);
assert.match(webChatPage, /const posterUrl = displayChatVideoPosterUrlForMessage/);
assert.match(webChatPage, /const displayableUrl = displayableChatVideoPosterUrl\(url\)/);
assert.match(webChatPage, /thumbnailUrl=\{posterUrl\}/);
assert.match(webChatPage, /thumbnailSourceRef=\{effectiveThumbnailSourceRef\}/);
assert.match(webChatPage, /thumbnailSourceRef: effectiveThumbnailSourceRef/);
assert.match(webChatPage, /onResolvedVideoUrl=\{rememberResolvedVideoUrl\}/);
assert.match(webChatPage, /onResolvedThumbnailUrl=\{rememberResolvedThumbnailUrl\}/);
assert.match(nativeChat, /collectChatMediaSourceRefs/);
assert.match(nativeChat, /deriveChatVideoThumbnailRef\(row\)/);
assert.match(nativeChat, /Keep video playback lazy on chat open; thumbnails are the eager visual contract/);
assert.doesNotMatch(nativeChat, /kind: row\.message_kind === 'vibe_clip' \? 'vibe_clip' : 'video'/);
assert.match(nativeChat, /image_source_ref: m\.image_source_ref/);
assert.match(nativeChat, /video_source_ref: m\.video_source_ref/);
assert.match(nativeChat, /thumbnail_source_ref: m\.thumbnail_source_ref/);
assert.match(nativeChat, /for \(const page of chronologicalPages\) \{[\s\S]*page\.dateSuggestions/);
assert.match(nativeChatScreen, /photoUriOverridesById/);
assert.match(nativeChatScreen, /videoUriOverridesById/);
assert.match(nativeChatScreen, /thumbnailUriOverridesById/);
assert.match(nativeChatScreen, /refreshMediaAssetUrl\(message\.id, 'image', message\.image_source_ref\)/);
assert.match(nativeChatScreen, /onLoadError=\{\(\) => \{[\s\S]{0,180}refreshPhotoUriForMessage/);
assert.match(nativeChatScreen, /sourceRef=\{item\.video_source_ref\}/);
assert.match(nativeChatScreen, /const effectiveThumbnailSourceRef =/);
assert.match(nativeChatScreen, /const posterUri = displayChatVideoPosterUriForMessage/);
assert.match(nativeChatScreen, /const displayableUri = displayableChatVideoPosterUri\(uri\)/);
assert.match(nativeChatScreen, /thumbnailUri=\{posterUri\}/);
assert.match(nativeChatScreen, /thumbnailSourceRef=\{effectiveThumbnailSourceRef\}/);
assert.match(nativeChatScreen, /thumbnailSourceRef: effectiveThumbnailSourceRef/);
assert.match(nativeChatScreen, /kind: 'thumbnail'[\s\S]{0,160}autoResolve: true/);
assert.match(nativeChatScreen, /fallbackUrls: thumbnailFallbackUris/);
assert.match(nativeChatScreen, /uniqueDisplayableChatVideoPosterUris\(playablePosterUri, thumbnailFallbackUris\)/);
assert.match(nativeChatScreen, /failedPosterUrisRef\.current\.add\(currentPosterUri\)/);
assert.match(nativeChatScreen, /!failedPosterUrisRef\.current\.has\(candidate\)/);
assert.match(nativeChatScreen, /if \(\(!posterImageBroken && posterImageState !== 'failed'\) \|\| posterCandidateUris\.length === 0\) return;[\s\S]{0,80}handlePosterLoadError\(\);/);
assert.match(nativeChatScreen, /CHAT_VIDEO_POSTER_PREVIEW_TIMEOUT_MS = 3500/);
assert.match(nativeChatScreen, /posterUri=\{displayableChatVideoPosterUri\(playablePosterUri\)\}/);
assert.match(nativeChatScreen, /onLoad=\{onPosterLoad\}/);
assert.match(nativeChatScreen, /CHAT_VIDEO_POSTER_PREVIEW_RETRY_DELAYS_MS = \[1000, 3000, 8000\]/);
assert.match(nativeChatScreen, /onResolvedVideoUrl=\{\(uri\) => rememberResolvedVideoUri\(item\.id, uri\)\}/);
assert.match(nativeChatScreen, /onResolvedThumbnailUrl=\{\(uri\) => rememberResolvedThumbnailUri\(item\.id, uri\)\}/);
assert.match(nativeChatScreen, /const freshPosterAsset = await refreshMediaAsset\(/);
assert.match(nativeChatScreen, /freshPosterAsset\?\.fallbackUrls \?\? \[\]/);
assert.match(nativeMediaViewer, /void onRefreshMedia\('poster'\)/);
assert.match(nativeClipCard, /fallbackUrls: thumbnailFallbackUrls/);
assert.match(nativeClipCard, /uniqueDisplayablePosterUris\(playableThumbnailUrl, thumbnailFallbackUrls\)/);
assert.match(nativeClipCard, /metaThumbnailUrlRef/);
assert.doesNotMatch(nativeClipCard, /\[meta\.processingStatus, meta\.thumbnailUrl, meta\.videoUrl, sparkMessageId\]/);
assert.match(nativeClipCard, /if \(effectivePosterPreviewState !== 'failed' \|\| posterCandidateUrls\.length === 0\) return;[\s\S]{0,80}setPosterPreviewState\('failed', playableThumbnailUrl\);/);
assert.match(nativeClipCard, /if \(state === 'failed'\)/);
assert.match(nativeClipCard, /failedPosterUrlsRef\.current\.add\(failedUrl\)/);
assert.match(nativeClipCard, /!failedPosterUrlsRef\.current\.has\(candidate\)/);
assert.match(
  nativeClipCard,
  /failedPosterUrlsRef\.current\.clear\(\);[\s\S]{0,120}posterRetryStateRef\.current = \{ key: '', attempts: 0 \};[\s\S]{0,120}setFallbackPosterPreviewState\('unknown'\);[\s\S]{0,80}\}, \[thumbnailSourceRef\]\);/,
);
assert.match(nativeClipCard, /onPosterPreviewStateChangeRef\.current\?\.\('unknown', nextUrl\)/);
assert.match(nativeClipCard, /onResolvedThumbnailUrlRef\.current\?\.\(nextUrl\)/);
assert.match(webMessagesHook, /query\.data\.dateSuggestions[\s\S]*byId\.set\(suggestion\.id, suggestion\)/);
assert.match(nativeChat, /query\.data\.dateSuggestions[\s\S]*byId\.set\(suggestion\.id, suggestion\)/);

assert.equal(
  resolvePreservedMediaSelectionId({
    items: [
      { id: "new-before" },
      { id: "current" },
      { id: "after" },
    ],
    previousItems: [
      { id: "current" },
      { id: "after" },
    ],
    previousId: "current",
    initialId: "current",
    initialChanged: false,
  }),
  "current",
);
assert.equal(
  resolvePreservedMediaSelectionId({
    items: [
      { id: "server-image", sourceRef: "media/image-1" },
      { id: "after" },
    ],
    previousItems: [
      { id: "optimistic-image", sourceRef: "media/image-1" },
      { id: "after" },
    ],
    previousId: "optimistic-image",
    initialId: "optimistic-image",
    initialChanged: false,
  }),
  "server-image",
);
assert.equal(
  resolvePreservedMediaSelectionId({
    items: [
      { id: "server-image" },
      { id: "after" },
    ],
    previousItems: [
      { id: "optimistic-image" },
      { id: "after" },
    ],
    previousId: "optimistic-image",
    initialId: "optimistic-image",
    initialChanged: false,
  }),
  "server-image",
);

console.log("media-asset-resolver-cache tests passed");
