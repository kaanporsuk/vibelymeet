import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  extractChatImageMediaRef,
  formatChatImageMessageContent,
  inferChatMediaRenderKind,
  parseChatImageStructuredPayload,
} from "./chat/messageRouting.ts";
import { captionTextFromMediaCaptions, mediaCaptionsToWebVtt } from "./media/captions.ts";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("Phase 8 chat images prefer structured payload while preserving legacy markers", () => {
  const payload = {
    v: 2,
    kind: "chat_image",
    provider: "bunny_storage",
    media_ref: "photos/user/req-abc/photo.jpg",
    client_request_id: "550e8400-e29b-41d4-a716-446655440000",
  };

  assert.equal(
    parseChatImageStructuredPayload(payload, { allowPrivateMediaRefs: true }),
    "photos/user/req-abc/photo.jpg",
  );
  assert.equal(
    extractChatImageMediaRef({
      content: formatChatImageMessageContent("photos/legacy/fallback.jpg"),
      structured_payload: payload,
    }, { allowPrivateMediaRefs: true }),
    "photos/user/req-abc/photo.jpg",
  );
  assert.equal(
    inferChatMediaRenderKind({
      content: "Photo",
      structuredPayload: payload,
    }),
    "image",
  );
  assert.equal(
    parseChatImageStructuredPayload({
      ...payload,
      provider: "unknown",
    }, { allowPrivateMediaRefs: true }),
    null,
  );
  assert.equal(
    extractChatImageMediaRef({
      content: formatChatImageMessageContent("photos/legacy/fallback.jpg"),
      structured_payload: { ...payload, v: 3 },
    }, { allowPrivateMediaRefs: true }),
    "photos/legacy/fallback.jpg",
  );
});

test("Phase 8 server contracts write and hydrate structured chat-image payloads", () => {
  const sendMessage = read("supabase/functions/send-message/index.ts");
  const threadPage = read("supabase/functions/chat-thread-page/index.ts");
  const webMessages = read("src/hooks/useMessages.ts");
  const nativeChatApi = read("apps/mobile/lib/chatApi.ts");
  const previews = read("shared/chat/conversationListPreview.ts");

  assert.match(sendMessage, /function chatImageStructuredPayload/);
  assert.match(sendMessage, /kind: "chat_image"/);
  assert.match(sendMessage, /provider: "bunny_storage"/);
  assert.match(sendMessage, /media_ref: mediaRef/);
  assert.match(sendMessage, /insertRow\.structured_payload = chatImageStructuredPayload/);
  assert.match(threadPage, /function parseStructuredChatImageRef/);
  assert.match(threadPage, /extractChatImageMediaRef\(next\)/);
  assert.match(threadPage, /payload\.media_ref = durableImageRef/);
  assert.match(webMessages, /extractChatImageMediaRef\(row, \{ allowPrivateMediaRefs: true \}\)/);
  assert.match(nativeChatApi, /extractChatImageMediaRef\(row, \{ allowPrivateMediaRefs: true \}\)/);
  assert.match(previews, /structuredPayload: row\.structured_payload/);
});

test("Phase 8 private profile Vibe Video uses signed playback refs", () => {
  const migration = read("supabase/migrations/20260519210000_media_phase_8_profile_vibe_signing.sql");
  const resolver = read("supabase/functions/get-chat-media-url/index.ts");
  const webResolver = read("src/lib/mediaAssetResolver.ts");
  const nativeResolver = read("apps/mobile/lib/mediaAssetResolver.ts");
  const webProfile = read("src/components/profile/OtherUserFullProfileView.tsx");
  const nativeProfile = read("apps/mobile/components/profile/UserProfileFullView.tsx");
  const webMediaAssetHook = read("src/hooks/useMediaAsset.ts");
  const nativeMediaAssetHook = read("apps/mobile/hooks/useMediaAsset.ts");
  const webFetcher = read("src/services/fetchUserProfile.ts");
  const nativeFetcher = read("apps/mobile/lib/fetchUserProfile.ts");

  assert.match(migration, /vibe_video_signed_playback_required/);
  assert.match(migration, /vibe_video_playback_ref/);
  assert.match(migration, /NOT public\.is_profile_discoverable\(p_target_id, v_viewer_id\)/);
  assert.match(migration, /concat\('profile_vibe_video:'/);

  assert.match(resolver, /"profile_vibe_video"/);
  assert.match(resolver, /BUNNY_STREAM_TOKEN_SECURITY_KEY/);
  assert.match(resolver, /get_profile_for_viewer/);
  assert.match(resolver, /stale_profile_vibe_video_ref/);
  assert.match(resolver, /missing_or_invalid_profile_ref/);
  assert.match(resolver, /profile_stream_url_issued/);
  assert.match(resolver, /token_path/);

  assert.match(webResolver, /parseProfileVibeVideoRef/);
  assert.match(webResolver, /profileId: profileRef\.profileId, mediaKind, sourceRef: rawRef/);
  assert.match(nativeResolver, /parseProfileVibeVideoRef/);
  assert.match(nativeResolver, /profileId: profileRef\.profileId, mediaKind, sourceRef: rawRef/);

  assert.match(webProfile, /signedVibeVideoRef/);
  assert.match(webProfile, /kind: "profile_vibe_video"/);
  assert.match(webProfile, /signedVibeVideoStatus === "ready"/);
  assert.match(nativeProfile, /signedVibeVideoRef/);
  assert.match(nativeProfile, /kind: 'profile_vibe_video'/);
  assert.match(nativeProfile, /signedVibeVideoStatus === 'ready'/);
  assert.match(webMediaAssetHook, /initialUrl === null \? null : initialUrl \?\? sourceRef \?\? null/);
  assert.match(nativeMediaAssetHook, /initialUrl === null \? null : initialUrl \?\? sourceRef \?\? null/);
  assert.match(webFetcher, /vibe_video_signed_playback_required/);
  assert.match(nativeFetcher, /vibe_video_playback_ref/);
});

test("Phase 8 Bunny Storage presign decision stays documented as EF mediated", () => {
  const closure = read("docs/media-phase8-closure.md");
  assert.match(closure, /does not expose an S3-style presigned direct-upload URL/);
  assert.match(closure, /keep photos, voice notes, and event covers flowing through Edge Functions/);
});

test("Phase 6 display path uses realtime, QoE, reduce-motion, and bounded media caches", () => {
  const webHook = read("src/hooks/useMediaAsset.ts");
  const nativeHook = read("apps/mobile/hooks/useMediaAsset.ts");
  const webResolver = read("src/lib/mediaAssetResolver.ts");
  const nativeResolver = read("apps/mobile/lib/mediaAssetResolver.ts");
  const webVibeClip = read("src/components/chat/VibeClipBubble.tsx");
  const nativeVibeClip = read("apps/mobile/components/chat/VibeClipCard.tsx");
  const nativeChat = read("apps/mobile/app/chat/[id].tsx");
  const chatVibeClipShared = read("supabase/functions/_shared/chat-vibe-clips.ts");
  const chatVibeClipCreate = read("supabase/functions/create-chat-vibe-clip-upload/index.ts");
  const chatVibeClipCaptionMigration = read("supabase/migrations/20260520183000_phase6_chat_vibe_clip_captions.sql");
  const webVibePlayer = read("src/components/vibe-video/VibePlayer.tsx");
  const webVideoBubble = read("src/components/chat/VideoMessageBubble.tsx");
  const nativeVibePlayer = read("apps/mobile/components/video/VibeVideoPlayer.tsx");
  const webVideoUploads = read("src/lib/mediaSdk/webVideoUploads.ts");
  const nativeVideoUploads = read("apps/mobile/lib/mediaSdk/nativeVideoUploads.ts");
  const webRecorder = read("src/components/chat/VideoMessageRecorder.tsx");
  const webChat = read("src/pages/Chat.tsx");
  const webOutboxExecute = read("src/lib/webChatOutbox/execute.ts");
  const nativeOutboxExecute = read("apps/mobile/lib/chatOutbox/execute.ts");
  const webQoe = read("src/hooks/useMediaPlaybackQoE.ts");
  const nativeQoe = read("apps/mobile/hooks/useNativeMediaPlaybackQoE.ts");
  const webPolicy = read("src/lib/mediaPlaybackSessionPolicy.ts");
  const nativeReduceMotion = read("apps/mobile/hooks/useReduceMotion.ts");

  assert.match(webHook, /postgres_changes/);
  assert.match(webHook, /table: "messages"/);
  assert.match(webHook, /onProcessingStatusChange/);
  assert.match(webHook, /bypassFailureCooldown: true/);
  assert.match(nativeHook, /postgres_changes/);
  assert.match(nativeHook, /table: 'messages'/);
  assert.match(nativeHook, /onProcessingStatusChange/);
  assert.match(nativeHook, /bypassFailureCooldown: true/);

  assert.match(webVibeClip, /CHAT_VIBE_CLIP_STATUS_SYNC_SAFETY_NET_INTERVAL_MS = 30_000/);
  assert.match(nativeVibeClip, /CHAT_VIBE_CLIP_STATUS_SYNC_SAFETY_NET_INTERVAL_MS = 30_000/);
  assert.doesNotMatch(webVibeClip, /CHAT_VIBE_CLIP_STATUS_SYNC_FAST_INTERVAL_MS/);
  assert.doesNotMatch(nativeVibeClip, /CHAT_VIBE_CLIP_STATUS_SYNC_FAST_INTERVAL_MS/);
  assert.equal(webVibeClip.match(/onProcessingStatusChange: handleRealtimeProcessingStatus/g)?.length, 1);
  assert.equal(nativeVibeClip.match(/onProcessingStatusChange: handleRealtimeProcessingStatus/g)?.length, 1);
  assert.match(webVibeClip, /readyRefreshKeyRef/);
  assert.match(nativeVibeClip, /readyRefreshKeyRef/);

  assert.match(webQoe, /media_playback_qoe/);
  assert.match(webQoe, /media_playback_qoe_rebuffer/);
  assert.match(webQoe, /source_ref: telemetrySafeSourceRef\(sourceRef\)/);
  assert.match(webQoe, /device_class: deviceClass\(\)/);
  assert.match(webQoe, /bitrate_switch_count: bitrateSwitchCount/);
  assert.match(webQoe, /vibely-hls-level-switched/);
  assert.match(nativeQoe, /media_playback_qoe/);
  assert.match(nativeQoe, /media_playback_qoe_rebuffer/);
  assert.match(nativeQoe, /source_ref: telemetrySafeSourceRef\(sourceRef\)/);
  assert.match(nativeQoe, /device_class: `native_\$\{Platform\.OS\}`/);
  assert.match(nativeQoe, /bitrate_switch_count: -1/);
  assert.match(webVibePlayer, /useMediaPlaybackQoE/);
  assert.match(webVibeClip, /useMediaPlaybackQoE/);
  assert.match(webVideoBubble, /useMediaPlaybackQoE/);
  assert.match(nativeVibePlayer, /useNativeMediaPlaybackQoE/);
  assert.match(nativeVibeClip, /useNativeMediaPlaybackQoE/);

  assert.match(webVibePlayer, /usePrefersReducedMotion/);
  assert.match(webVideoBubble, /usePrefersReducedMotion/);
  assert.match(nativeVibePlayer, /useReduceMotion/);
  assert.match(nativeReduceMotion, /AccessibilityInfo\.isReduceMotionEnabled/);
  assert.match(nativeReduceMotion, /useState\(true\)/);

  assert.match(webPolicy, /saveData/);
  assert.match(webPolicy, /slow-2g/);
  assert.match(webPolicy, /navigator[\s\S]{0,80}getBattery/);
  assert.match(webPolicy, /PREWARM_SESSION_BYTE_LIMIT = 10 \* 1024 \* 1024/);
  assert.match(webPolicy, /reserveMediaPrewarmBudgetForSource/);
  assert.match(webPolicy, /recordMediaPrewarmBytes\(bytesEstimate\)/);
  assert.match(webVibePlayer, /useMediaVideoPreloadForVisibility/);
  assert.match(webVibeClip, /useMediaVideoPreloadForVisibility/);
  assert.match(webVideoBubble, /useMediaVideoPreloadForVisibility/);
  assert.match(webVibeClip, /IntersectionObserver/);
  assert.match(webVideoBubble, /IntersectionObserver/);
  assert.match(read("src/lib/vibeVideo/attachHlsPlayback.ts"), /LEVEL_SWITCHED/);

  assert.match(webResolver, /MEDIA_URL_CACHE_MAX_ENTRIES = 200/);
  assert.match(webResolver, /SIGNED_MEDIA_FAILURE_COOLDOWN_MAX_MS = 5 \* 60 \* 1000/);
  assert.match(webResolver, /recordMediaUrlFailure/);
  assert.match(webResolver, /getCachedMediaAssetFailureCode/);
  assert.match(webResolver, /resolverPayloadForHttpFailure/);
  assert.match(webResolver, /response\.status === 401 \|\| response\.status === 403/);
  assert.match(webResolver, /error: "asset_deleted"/);
  assert.match(nativeResolver, /MEDIA_URL_CACHE_MAX_ENTRIES = 200/);
  assert.match(nativeResolver, /SIGNED_MEDIA_FAILURE_COOLDOWN_MAX_MS = 5 \* 60 \* 1000/);
  assert.match(nativeResolver, /recordMediaUrlFailure/);
  assert.match(nativeResolver, /getCachedMediaAssetFailureCode/);
  assert.match(nativeResolver, /resolverPayloadForHttpFailure/);
  assert.match(nativeResolver, /response\.status === 401 \|\| response\.status === 403/);
  assert.match(nativeResolver, /error: 'asset_deleted'/);

  assert.match(nativeChat, /onViewableItemsChanged=\{onVibeClipViewableItemsChangedRef\.current\}/);
  assert.match(nativeChat, /visibleVibeClipMessageIds/);
  assert.match(nativeVibeClip, /isViewportActive/);
  assert.match(nativeVibeClip, /setInlinePlayRequestToken\(0\)/);

  assert.match(webVibeClip, /mediaCaptionsToWebVtt/);
  assert.match(webVibeClip, /<track kind="subtitles"/);
  assert.match(webVibeClip, /VIBE_CLIP_CAPTIONS_PREF_KEY/);
  assert.match(nativeVibeClip, /captionTextFromMediaCaptions/);
  assert.match(nativeVibeClip, /captionToggleBtn/);
  assert.match(nativeVibeClip, /AsyncStorage\.getItem\(VIBE_CLIP_CAPTIONS_PREF_KEY\)/);
  assert.match(chatVibeClipCaptionMigration, /ADD COLUMN IF NOT EXISTS captions jsonb/);
  assert.match(chatVibeClipCreate, /normalizeChatVibeClipCaptions\(body\.captions\)/);
  assert.match(chatVibeClipCreate, /upload_session_caption_synced/);
  assert.match(chatVibeClipShared, /normalizeChatVibeClipCaptions/);
  assert.match(chatVibeClipShared, /\.\.\.\(captions \? \{ captions \} : \{\}\)/);
  assert.match(webVideoUploads, /captions: params\.captions/);
  assert.match(nativeVideoUploads, /captions: params\.captions/);
  assert.match(webRecorder, /SpeechRecognition/);
  assert.match(webRecorder, /captionsFromTranscript/);
  assert.match(webChat, /captions: meta\?\.captions \?\? null/);
  assert.match(webOutboxExecute, /captions: payload\.captions \?\? null/);
  assert.match(nativeOutboxExecute, /captions: payload\.captions \?\? null/);
});

test("Phase 6 caption helpers normalize text and WebVTT cues", () => {
  assert.equal(captionTextFromMediaCaptions({ cues: [{ text: "hello" }, { text: "world" }] }), "hello world");
  assert.match(mediaCaptionsToWebVtt("hello", 1200) ?? "", /WEBVTT/);
  assert.match(mediaCaptionsToWebVtt({ cues: [{ startMs: 0, endMs: 900, text: "hi" }] }, 1200) ?? "", /00:00:00\.000 --> 00:00:00\.900/);
  assert.match(mediaCaptionsToWebVtt("line one\nline two --> line three", 1200) ?? "", /line one line two -> line three/);
  assert.match(mediaCaptionsToWebVtt("<b>hi</b> & bye", 1200) ?? "", /&lt;b>hi&lt;\/b> &amp; bye/);
});
