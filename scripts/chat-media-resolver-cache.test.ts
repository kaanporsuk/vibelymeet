import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __chatMediaUrlCacheSizeForTests,
  __clearChatMediaUrlCacheForTests,
  __setChatMediaUrlIssuerForTests,
  getCachedChatMediaUrl,
  refreshCachedChatMediaUrl,
} from "../src/lib/chatMediaResolver";
import { resolvePreservedMediaSelectionId } from "../shared/chat/mediaSelection";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

__clearChatMediaUrlCacheForTests();

assert.equal(
  await getCachedChatMediaUrl("local-preview", "image", "blob:https://vibely.test/photo"),
  "blob:https://vibely.test/photo",
);
assert.equal(__chatMediaUrlCacheSizeForTests(), 0);

assert.equal(
  await getCachedChatMediaUrl(
    "550e8400-e29b-41d4-a716-446655440010",
    "video",
    "https://cdn.example.com/already-signed.mp4",
  ),
  "https://cdn.example.com/already-signed.mp4",
);
assert.equal(__chatMediaUrlCacheSizeForTests(), 0);

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
  const first = await getCachedChatMediaUrl(messageId, "voice", "voice/test.webm");
  const second = await getCachedChatMediaUrl(messageId, "voice", "voice/test.webm");
  const refreshed = await refreshCachedChatMediaUrl(messageId, "voice", "voice/test.webm");

  assert.equal(first, "https://signed.example.com/media-1");
  assert.equal(second, first);
  assert.equal(refreshed, "https://signed.example.com/media-2");
  assert.equal(invokeCount, 2);
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
    provider: "bunny_stream",
    playbackKind: "hls",
    expiresInSeconds: 300,
  };
});
try {
  const messageId = "550e8400-e29b-41d4-a716-446655440001";
  const videoId = "11111111-1111-4111-8111-111111111111";
  const playback = await refreshCachedChatMediaUrl(messageId, "vibe_clip", `bunny_stream:${videoId}`);
  const poster = await getCachedChatMediaUrl(messageId, "thumbnail", `bunny_stream:${videoId}:thumbnail`);

  assert.equal(playback, "https://vz-chat.example/bcdn_token=HS256-play/stream-id/playlist.m3u8");
  assert.equal(poster, "https://vz-chat.example/bcdn_token=HS256-poster/stream-id/thumbnail.jpg");
  assert.equal(streamInvokeCount, 1);
  assert.equal(__chatMediaUrlCacheSizeForTests(), 2);
} finally {
  __setChatMediaUrlIssuerForTests(null);
  __clearChatMediaUrlCacheForTests();
}

__setChatMediaUrlIssuerForTests(async () => {
  throw new Error("network_down");
});
try {
  const messageId = "550e8400-e29b-41d4-a716-446655440000";
  const failedRefresh = await refreshCachedChatMediaUrl(messageId, "voice", "voice/test.webm");
  assert.equal(failedRefresh, null);
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
  const first = await getCachedChatMediaUrl(messageId, "image", "image/short.jpg");
  Date.now = () => originalDateNow() + 2_000;
  const second = await getCachedChatMediaUrl(messageId, "image", "image/short.jpg");

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
const webMediaResolver = read("src/lib/chatMediaResolver.ts");
const webMessagesHook = read("src/hooks/useMessages.ts");
const webChatPage = read("src/pages/Chat.tsx");
const nativeChat = read("apps/mobile/lib/chatApi.ts");
const nativeChatScreen = read("apps/mobile/app/chat/[id].tsx");
const nativeClipCard = read("apps/mobile/components/chat/VibeClipCard.tsx");
const nativeMediaViewer = read("apps/mobile/components/chat/ChatThreadMediaViewer.tsx");
const nativeMediaResolver = read("apps/mobile/lib/chatMediaResolver.ts");
const threadPage = read("supabase/functions/chat-thread-page/index.ts");

assert.match(resolver, /syncChatMessageMedia/);
assert.match(
  resolver,
  /let asset = await resolveMessageAsset[\s\S]*syncChatMessageMedia[\s\S]*asset = await resolveMessageAsset/,
);
assert.match(webBubble, /refreshCachedChatMediaUrl/);
assert.match(webBubble, /await audioRef\.current\.play\(\);[\s\S]{0,500}refreshAudioUrl/);
assert.match(
  webBubble,
  /if \(freshUrl && freshUrl !== playableUrl\) \{[\s\S]{0,140}refreshAttemptedForUrlRef\.current = playableUrl \?\? null;[\s\S]{0,80}return true;/,
);
assert.match(
  webBubble,
  /if \(!freshUrl \|\| freshUrl === playableUrl\) \{[\s\S]{0,120}setHasError\(true\);[\s\S]{0,80}return;[\s\S]{0,80}\}[\s\S]{0,80}refreshAttemptedForUrlRef\.current = playableUrl \?\? null;/,
);
assert.doesNotMatch(webBubble, /console\.error\("Audio failed to load:/);
assert.match(webVideoBubble, /refreshCachedChatMediaUrl/);
assert.match(webVideoBubble, /videoSourceRef/);
assert.match(webVideoBubble, /mediaKind\s*=\s*"video"/);
assert.match(webVideoBubble, /onError=\{\(\) => \{[\s\S]{0,240}tryRefreshAfterFailure/);
assert.match(
  webVideoBubble,
  /const freshUrl = await refreshVideoUrl\(\);[\s\S]{0,80}if \(!freshUrl \|\| freshUrl === playableVideoUrl\) return false;[\s\S]{0,80}refreshAttemptedForUrlRef\.current = playableVideoUrl;[\s\S]{0,80}return true;/,
);
assert.match(webClipBubble, /refreshCachedChatMediaUrl/);
assert.match(webClipBubble, /videoSourceRef/);
assert.match(webClipBubble, /thumbnailSourceRef/);
assert.match(webClipBubble, /refreshCachedChatMediaUrl\(sparkMessageId, "vibe_clip", videoSourceRef\)/);
assert.match(webClipBubble, /refreshCachedChatMediaUrl\(sparkMessageId, "thumbnail", thumbnailSourceRef\)/);
assert.match(
  webClipBubble,
  /if \(!freshVideoUrl \|\| freshVideoUrl === playableVideoUrl\) return false;[\s\S]{0,80}refreshAttemptedForUrlRef\.current = playableVideoUrl;[\s\S]{0,160}return true;/,
);
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
  /if \(!freshVideoUrl \|\| freshVideoUrl === currentUrl\) return false;[\s\S]{0,80}refreshAttemptedForUrlRef\.current = currentUrl;[\s\S]{0,160}return true;/,
);
assert.match(webVideoLightbox, /CLIP_PLAYBACK_LOAD_TIMEOUT_MS/);
assert.match(webVideoLightbox, /phase !== "loading" \|\| !canMountPlayer/);
assert.match(webClipBubble, /refreshAttemptedForUrlRef\.current = null;[\s\S]{0,160}setLoadError\(false\)/);
assert.match(webMediaResolver, /catch \{[\s\S]{0,80}return null;[\s\S]{0,80}\}/);
assert.match(webMediaResolver, /function bunnyStreamThumbnailRefFor/);
assert.match(webMediaResolver, /payload\.posterUrl/);
assert.match(nativeBubble, /refreshCachedChatMediaUrl/);
assert.match(nativeBubble, /player\.play\(\)[\s\S]{0,600}refreshAndQueuePlay/);
assert.match(
  nativeBubble,
  /if \(fresh === playableUri\) \{[\s\S]{0,140}return playCurrent\(\);[\s\S]{0,80}\}[\s\S]{0,80}refreshAttemptedForUriRef\.current = playableUri;[\s\S]{0,80}return true;/,
);
assert.match(
  nativeBubble,
  /if \(!fresh \|\| fresh === playableUri\) \{[\s\S]{0,120}setHasError\(true\);[\s\S]{0,80}return;[\s\S]{0,80}\}[\s\S]{0,80}refreshAttemptedForUriRef\.current = playableUri;/,
);
assert.match(nativeClipCard, /refreshCachedChatMediaUrl/);
assert.match(nativeClipCard, /videoSourceRef/);
assert.match(nativeClipCard, /thumbnailSourceRef/);
assert.match(nativeClipCard, /posterRefreshAttemptedForRef/);
assert.match(nativeClipCard, /isResolvableMediaRef\(playableThumbnailUrl\)/);
assert.match(nativeClipCard, /CLIP_PLAYBACK_LOAD_TIMEOUT_MS/);
assert.match(nativeClipCard, /onResetPlaybackRefreshAttempt/);
assert.match(nativeClipCard, /setHasError\(false\)/);
assert.match(nativeClipCard, /refreshCachedChatMediaUrl\(sparkMessageId, 'vibe_clip', videoSourceRef\)/);
assert.match(nativeClipCard, /refreshCachedChatMediaUrl\(sparkMessageId, 'thumbnail', thumbnailSourceRef\)/);
assert.match(nativeClipCard, /onResolvedVideoUrl\?\.\(freshVideoUri\)/);
assert.match(nativeClipCard, /onResolvedThumbnailUrl\?\.\(freshThumbnailUri\)/);
assert.match(nativeClipCard, /\(!videoSourceRef && !thumbnailSourceRef\)/);
assert.match(nativeClipCard, /freshThumbnailUri !== playableThumbnailUrl/);
assert.match(
  nativeChatScreen,
  /if \(!freshUri \|\| freshUri === playableUri\) return false;[\s\S]{0,80}refreshAttemptedForUriRef\.current = playableUri;[\s\S]{0,160}return true;/,
);
assert.match(
  nativeClipCard,
  /if \(reason === 'preview'\) return !!freshThumbnailUri;/,
);
assert.match(
  nativeClipCard,
  /if \(!videoSourceRef \|\| refreshAttemptedForUriRef\.current === playableVideoUrl\) return false;[\s\S]{0,240}if \(!freshVideoUri \|\| freshVideoUri === playableVideoUrl\) return false;[\s\S]{0,80}refreshAttemptedForUriRef\.current = playableVideoUrl;[\s\S]{0,160}return true;/,
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
  /if \(!fresh\?\.uri \|\| fresh\.uri === playableUri\) return false;[\s\S]{0,80}refreshAttemptedForUriRef\.current = playableUri;[\s\S]{0,160}return true;/,
);
assert.match(nativeMediaViewer, /CLIP_PLAYBACK_LOAD_TIMEOUT_MS/);
assert.match(nativeMediaViewer, /phase !== 'loading'/);
assert.match(nativeMediaViewer, /onResetPlaybackRefreshAttempt/);
assert.match(nativeMediaResolver, /catch \{[\s\S]{0,80}return null;[\s\S]{0,80}\}/);
assert.match(nativeMediaResolver, /getFreshCachedAccessToken/);
assert.match(nativeMediaResolver, /headers: \{ Authorization: `Bearer \$\{accessToken\}` \}/);
assert.match(nativeMediaResolver, /function bunnyStreamThumbnailRefFor/);
assert.match(nativeMediaResolver, /payload\.posterUrl/);
assert.match(nativeChat, /extras:\s*\{\s*httpSend:\s*true\s*\}/);
assert.match(threadPage, /\.from\("media_assets"\)/);
assert.match(threadPage, /date_suggestions/);
assert.doesNotMatch(threadPage, /syncChatMessageMedia/);
assert.doesNotMatch(threadPage, /createToken|signedProxyUrl|TOKEN_TTL_SECONDS/);
assert.match(threadPage, /const durableAssetRef = \(messageId: string, kind: MediaKind\): string \| null =>/);
assert.match(threadPage, /next\.audio_url = durableAssetRef\(next\.id, "voice"\) \?\? next\.audio_url/);
assert.match(threadPage, /const durableThumbnailRef = durableAssetRef\(next\.id, "thumbnail"\) \?\? thumbnailRef/);
assert.match(threadPage, /kind === "thumbnail" && asset\.provider === "bunny_stream" && asset\.media_family === "chat_video"/);
assert.match(threadPage, /payload\.thumbnail_url = durableThumbnailRef/);
assert.match(threadPage, /payload\.poster_ref = durableThumbnailRef/);
assert.match(threadPage, /formatChatImageMessageContent\(durableImageRef\)/);
assert.match(threadPage, /function parseThreadPageCursor/);
assert.match(threadPage, /\.order\("created_at", \{ ascending: false \}\)[\s\S]{0,120}\.order\("id", \{ ascending: false \}\)/);
assert.match(threadPage, /created_at\.lt\.\$\{beforeCursor\.createdAt\},and\(created_at\.eq\.\$\{beforeCursor\.createdAt\},id\.lt\.\$\{beforeCursor\.id\}\)/);
assert.match(threadPage, /next_cursor: rowsDesc\.length >= limit \? encodeThreadPageCursor/);
assert.match(webMessagesHook, /function parseThreadPageCursor/);
assert.match(webMessagesHook, /\[89ab\]\[0-9a-f\]\{3\}-\[0-9a-f\]\{12\}/);
assert.doesNotMatch(webMessagesHook, /\[89ab\]\[0-9a-f\]\{12\}/);
assert.match(webMessagesHook, /collectChatMediaSourceRefs/);
assert.match(webMessagesHook, /imageSourceRef: sourceRefs\?\.image/);
assert.match(webMessagesHook, /videoSourceRef: sourceRefs\?\.video/);
assert.match(webMessagesHook, /thumbnailSourceRef: sourceRefs\?\.thumbnail/);
assert.match(webMessagesHook, /\.order\("created_at", \{ ascending: false \}\)[\s\S]{0,120}\.order\("id", \{ ascending: false \}\)/);
assert.match(webMessagesHook, /for \(const page of chronologicalPages\) \{[\s\S]*page\.dateSuggestions/);
assert.match(webChatPage, /photoUrlOverridesById/);
assert.match(webChatPage, /videoUrlOverridesById/);
assert.match(webChatPage, /thumbnailUrlOverridesById/);
assert.match(webChatPage, /refreshCachedChatMediaUrl\(message\.id, "image", message\.imageSourceRef\)/);
assert.match(webChatPage, /onError=\{\(\) => \{[\s\S]{0,180}refreshPhotoUrlForMessage/);
assert.match(webChatPage, /videoSourceRef=\{groupedMessage\.videoSourceRef\}/);
assert.match(webChatPage, /thumbnailSourceRef=\{message\.thumbnailSourceRef\}/);
assert.match(webChatPage, /onResolvedVideoUrl=\{rememberResolvedVideoUrl\}/);
assert.match(webChatPage, /onResolvedThumbnailUrl=\{rememberResolvedThumbnailUrl\}/);
assert.match(nativeChat, /collectChatMediaSourceRefs/);
assert.match(nativeChat, /image_source_ref: m\.image_source_ref/);
assert.match(nativeChat, /video_source_ref: m\.video_source_ref/);
assert.match(nativeChat, /thumbnail_source_ref: m\.thumbnail_source_ref/);
assert.match(nativeChat, /for \(const page of chronologicalPages\) \{[\s\S]*page\.dateSuggestions/);
assert.match(nativeChatScreen, /photoUriOverridesById/);
assert.match(nativeChatScreen, /videoUriOverridesById/);
assert.match(nativeChatScreen, /thumbnailUriOverridesById/);
assert.match(nativeChatScreen, /refreshCachedChatMediaUrl\(message\.id, 'image', message\.image_source_ref\)/);
assert.match(nativeChatScreen, /onLoadError=\{\(\) => \{[\s\S]{0,180}refreshPhotoUriForMessage/);
assert.match(nativeChatScreen, /sourceRef=\{item\.video_source_ref\}/);
assert.match(nativeChatScreen, /thumbnailSourceRef=\{item\.thumbnail_source_ref\}/);
assert.match(nativeChatScreen, /onResolvedVideoUrl=\{\(uri\) => rememberResolvedVideoUri\(item\.id, uri\)\}/);
assert.match(nativeChatScreen, /onResolvedThumbnailUrl=\{\(uri\) => rememberResolvedThumbnailUri\(item\.id, uri\)\}/);
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

console.log("chat-media-resolver-cache tests passed");
