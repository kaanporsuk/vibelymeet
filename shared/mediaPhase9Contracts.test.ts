import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  MEDIA_CAPTIONS_MAX_TEXT_LENGTH,
  mediaCaptionLanguage,
  mediaCaptionsToWebVtt,
  parseMediaCaptions,
} from "./media/captions.ts";
import { telemetrySafeSourceRef } from "./media/telemetry-safe-ref.ts";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("Phase 9 QoE contracts and prewarm policy constants are pinned", () => {
  const webQoe = read("src/hooks/useMediaPlaybackQoE.ts");
  const nativeQoe = read("apps/mobile/hooks/useNativeMediaPlaybackQoE.ts");
  const sharedPolicy = read("shared/media/playback-session-policy-core.ts");
  const webPolicy = read("src/lib/mediaPlaybackSessionPolicy.ts");
  const nativePolicy = read("apps/mobile/lib/mediaPlaybackSessionPolicy.ts");
  const fullscreen = read("src/components/vibe-video/VibeVideoFullscreenPlayer.tsx");
  const hlsPlayback = read("src/lib/vibeVideo/attachHlsPlayback.ts");

  for (const qoe of [webQoe, nativeQoe]) {
    assert.match(qoe, /media_playback_qoe/);
    assert.match(qoe, /media_playback_qoe_rebuffer/);
    assert.match(qoe, /telemetrySafeSourceRef/);
    assert.match(qoe, /startup_ms/);
    assert.match(qoe, /rebuffer_count/);
    assert.match(qoe, /client_request_id/);
    assert.match(qoe, /connection_type/);
    assert.match(qoe, /recordMediaPlaybackStartup/);
  }

  assert.match(fullscreen, /useMediaPlaybackQoE/);
  assert.match(fullscreen, /sourceRef: vibeVideoInfo\.playbackUrl/);
  assert.match(fullscreen, /surface: "vibe_player_fullscreen"/);
  assert.match(fullscreen, /video\.textTracks/);

  assert.match(sharedPolicy, /REBUFFER_DEGRADE_WINDOW_MS = 30_000/);
  assert.match(sharedPolicy, /REBUFFER_DEGRADE_THRESHOLD = 2/);
  assert.match(sharedPolicy, /PREWARM_SESSION_BYTE_LIMIT = 10 \* 1024 \* 1024/);
  assert.match(sharedPolicy, /createMediaPlaybackSessionPolicy/);
  assert.match(sharedPolicy, /getMediaPlaybackQoeSnapshot/);
  assert.match(hlsPlayback, /isMediaPlaybackQoeDegraded/);
  assert.match(hlsPlayback, /autoLevelCapping/);
  assert.match(hlsPlayback, /startLevel = 0/);

  for (const policy of [webPolicy, nativePolicy]) {
    assert.match(policy, /createMediaPlaybackSessionPolicy/);
    assert.match(policy, /getMediaPlaybackQoeSnapshot/);
    assert.match(policy, /mediaConnectionSnapshot/);
  }
  assert.match(nativePolicy, /@react-native-community\/netinfo/);
  assert.match(nativePolicy, /nativeConnectionSnapshot/);
  assert.match(nativePolicy, /isConnectionExpensive/);
});

test("Phase 9 reduce-motion defaults, animation gates, and preload policy are pinned", () => {
  const nativeReduceMotion = read("apps/mobile/hooks/useReduceMotion.ts");
  const nativeQoe = read("apps/mobile/hooks/useNativeMediaPlaybackQoE.ts");
  const nativeVibePlayer = read("apps/mobile/components/video/VibeVideoPlayer.tsx");
  const nativeChatViewer = read("apps/mobile/components/chat/ChatThreadMediaViewer.tsx");
  const nativeVibeClip = read("apps/mobile/components/chat/VibeClipCard.tsx");
  const nativeFullscreenVibe = read("apps/mobile/components/video/FullscreenVibeVideoModal.tsx");
  const nativeProfileFullView = read("apps/mobile/components/profile/UserProfileFullView.tsx");
  const webVibePlayer = read("src/components/vibe-video/VibePlayer.tsx");
  const webVibeClip = read("src/components/chat/VibeClipBubble.tsx");
  const webVideoBubble = read("src/components/chat/VideoMessageBubble.tsx");
  const webRecorder = read("src/components/chat/VideoMessageRecorder.tsx");
  const voiceBubble = read("src/components/chat/VoiceMessageBubble.tsx");
  const lightbox = read("src/components/vibe-video/VibeVideoFullscreenPlayer.tsx");
  const chatVideoLightbox = read("src/components/chat/ChatVideoLightbox.tsx");
  const chatPhotoLightbox = read("src/components/chat/ChatPhotoLightbox.tsx");
  const vibeStudioModal = read("src/components/vibe-video/VibeStudioModal.tsx");

  assert.match(nativeReduceMotion, /reduceMotion: cachedReduceMotion \?\? false/);
  assert.match(nativeReduceMotion, /useReduceMotionState/);
  assert.match(nativeReduceMotion, /resolved: cachedReduceMotion !== null/);
  assert.match(nativeReduceMotion, /AccessibilityInfo\.isReduceMotionEnabled/);
  assert.match(nativeReduceMotion, /catch\(\(\) =>[\s\S]*reduceMotion: false, resolved: true/);
  assert.match(nativeQoe, /enabled\?: boolean/);
  assert.match(nativeQoe, /if \(!enabled\) return/);
  assert.match(nativeVibePlayer, /useReduceMotionState/);
  assert.match(nativeVibePlayer, /reduceMotionResolved/);
  assert.match(nativeVibePlayer, /shouldAttachPlayback[\s\S]*reduceMotionResolved/);
  assert.match(nativeVibePlayer, /enabled: shouldAttachPlayback/);
  assert.match(nativeVibePlayer, /if \(!shouldAttachPlayback\) return;[\s\S]*player\.addListener\('statusChange'/);
  assert.match(nativeVibePlayer, /setManualPlaybackRequested\(true\)/);
  assert.match(nativeChatViewer, /useReduceMotionState/);
  assert.match(nativeChatViewer, /shouldAttachPlayback[\s\S]*reduceMotionResolved/);
  assert.match(nativeChatViewer, /chat\.viewerVideo\.replace/);
  assert.match(nativeChatViewer, /setManualPlaybackRequested\(true\)/);
  assert.match(nativeVibeClip, /useReduceMotionState/);
  assert.match(nativeVibeClip, /shouldAttachPlayback[\s\S]*reduceMotionResolved/);
  assert.match(nativeVibeClip, /useMemo<VideoSource>\(\(\) => \(shouldAttachPlayback \? videoSourceForUri\(meta\.videoUrl\) : null\)/);
  assert.match(nativeVibeClip, /enabled: shouldAttachPlayback/);
  assert.match(nativeVibeClip, /if \(!shouldAttachPlayback\) return;[\s\S]*vibeClip\.player\.statusListener/);
  assert.match(nativeVibeClip, /if \(!immersiveActive\) return;[\s\S]*vibeClip\.player\.pause\.immersive/);
  assert.match(nativeVibePlayer, /vibeVideo\.player\.pause\.detached/);
  assert.match(nativeFullscreenVibe, /animationType=\{reduceMotion \? 'none' : 'fade'\}/);
  assert.match(nativeChatViewer, /animationType=\{reduceMotion \? 'none' : 'fade'\}/);
  assert.match(nativeProfileFullView, /useReduceMotion/);
  assert.match(nativeProfileFullView, /animationType=\{reduceMotion \? 'none' : 'fade'\}/);
  assert.match(webVibePlayer, /useMediaVideoPreloadForVisibility\(shouldLoad, playbackUrl, undefined, prefersReducedMotion\)/);
  assert.match(webVibePlayer, /preload=\{videoPreload\}/);
  assert.match(webVibePlayer, /video\.textTracks/);
  assert.match(webVibePlayer, /!prefersReducedMotion && "animate-spin"/);
  assert.match(webVibeClip, /useMediaVideoPreloadForVisibility[\s\S]*prefersReducedMotion/);
  assert.match(webVibeClip, /!prefersReducedMotion && "animate-spin"/);
  assert.match(webVideoBubble, /!prefersReducedMotion && "animate-spin"/);
  assert.match(voiceBubble, /usePrefersReducedMotion/);
  assert.match(voiceBubble, /prefersReducedMotion \? undefined/);
  assert.match(lightbox, /prefersReducedMotion \? undefined/);
  assert.match(lightbox, /controls=\{prefersReducedMotion\}/);
  assert.match(lightbox, /preload=\{prefersReducedMotion \? "none" : "metadata"\}/);
  assert.match(lightbox, /autoplay: !prefersReducedMotion/);
  assert.match(lightbox, /autoPlay: shouldPlayOnAttach/);
  assert.match(lightbox, /shouldAttachPlayback/);
  assert.match(chatVideoLightbox, /usePrefersReducedMotion/);
  assert.match(chatVideoLightbox, /autoPlay: !prefersReducedMotion/);
  assert.match(chatVideoLightbox, /prefersReducedMotion \? "" : "animate-spin"/);
  assert.match(chatPhotoLightbox, /usePrefersReducedMotion/);
  assert.match(vibeStudioModal, /usePrefersReducedMotion/);
  assert.match(vibeStudioModal, /!prefersReducedMotion && "animate-ping"/);
  assert.match(vibeStudioModal, /if \(!prefersReducedMotion\)[\s\S]*videoEl\.play/);
  assert.match(webRecorder, /usePrefersReducedMotion/);
  assert.match(webRecorder, /autoPlay=\{!prefersReducedMotion\}/);
  assert.match(webRecorder, /controls=\{prefersReducedMotion\}/);
});

test("Phase 9 caption parser validates shape, size, language, and WebVTT escaping", () => {
  assert.equal(parseMediaCaptions(null), null);
  assert.equal(parseMediaCaptions(" hello "), "hello");
  assert.deepEqual(parseMediaCaptions({ text: "hola", language: "es-ES" }), { text: "hola", language: "es-ES" });
  assert.equal(mediaCaptionLanguage({ text: "hola", language: "es-ES" }), "es-ES");
  assert.equal(parseMediaCaptions({ text: "x".repeat(MEDIA_CAPTIONS_MAX_TEXT_LENGTH + 1) }), null);
  assert.equal(parseMediaCaptions({ text: "hello", language: "not a language tag" }), null);
  assert.equal(parseMediaCaptions({ cues: [{ text: "" }] }), null);
  assert.equal(parseMediaCaptions({ cues: [{ startMs: 0, endMs: 1000 }] }), null);
  assert.equal(parseMediaCaptions({ cues: [{ text: "bad", startMs: 1000, endMs: 900 }] }), null);

  const vtt = mediaCaptionsToWebVtt({ text: "<b>hi</b> & bye", language: "en-US" }, 1200) ?? "";
  assert.match(vtt, /WEBVTT/);
  assert.match(vtt, /&lt;b>hi&lt;\/b> &amp; bye/);
  assert.doesNotMatch(vtt, /<b>hi<\/b>/);
});

test("Phase 9 caption parity covers web/native chat clips and profile Vibe Videos", () => {
  const packageJson = read("apps/mobile/package.json");
  const nativeHook = read("apps/mobile/hooks/useNativeCaptionCapture.ts");
  const nativeChat = read("apps/mobile/app/chat/[id].tsx");
  const nativeVibeRecord = read("apps/mobile/app/vibe-video-record.tsx");
  const webRecorder = read("src/components/chat/VideoMessageRecorder.tsx");
  const webStudio = read("src/components/vibe-video/VibeStudioModal.tsx");
  const migration = read("supabase/migrations/20260520230000_media_phase9_completion.sql");
  const createVideoUpload = read("supabase/functions/create-video-upload/index.ts");
  const webVibePlayer = read("src/components/vibe-video/VibePlayer.tsx");
  const webFullscreen = read("src/components/vibe-video/VibeVideoFullscreenPlayer.tsx");
  const nativePlayer = read("apps/mobile/components/video/VibeVideoPlayer.tsx");
  const webVibeClip = read("src/components/chat/VibeClipBubble.tsx");

  assert.match(packageJson, /expo-speech-recognition/);
  assert.match(nativeHook, /expo-speech-recognition/);
  assert.match(nativeHook, /requiresOnDeviceRecognition: true/);
  assert.match(nativeHook, /on_device_recognition_unavailable/);
  assert.match(nativeHook, /startRecognitionForRun/);
  assert.match(nativeHook, /useSpeechRecognitionEvent\('end'[\s\S]*startRecognitionForRun/);
  assert.match(nativeChat, /NativeVibeClipCameraModal/);
  assert.match(nativeChat, /captions: p\.captions \?\? null/);
  assert.match(nativeVibeRecord, /useNativeCaptionCapture/);
  assert.match(nativeVibeRecord, /useReduceMotion/);
  assert.match(nativeVibeRecord, /animationType=\{reduceMotion \? 'none' : 'fade'\}/);
  assert.match(nativeVibeRecord, /const captions = captionsFromReviewText\(captionReviewText/);
  assert.match(webRecorder, /caption_capture_unavailable/);
  assert.match(webRecorder, /caption_capture_succeeded/);
  assert.match(webRecorder, /pendingRecording/);
  assert.match(webStudio, /caption_capture_unavailable/);
  assert.match(webStudio, /captionsFromReview/);
  assert.match(migration, /ALTER TABLE public\.vibe_video_uploads[\s\S]*ADD COLUMN IF NOT EXISTS captions jsonb/);
  assert.match(migration, /jsonb_typeof\(v_cue->'text'\) IS DISTINCT FROM 'string'/);
  assert.match(migration, /profiles\.vibe_video_captions/);
  assert.match(createVideoUpload, /normalizeMediaCaptions/);
  assert.match(createVideoUpload, /invalid_captions/);
  assert.match(createVideoUpload, /vibe_video_captions/);
  assert.doesNotMatch(createVideoUpload, /if \(captions\) \{[\s\S]*vibe_video_captions/);
  assert.match(createVideoUpload, /\.update\(\{ vibe_video_captions: captions \}\)/);
  assert.match(createVideoUpload, /\.update\(\{ captions \}\)/);
  assert.match(webVibePlayer, /captions\?: MediaCaptions/);
  assert.match(webFullscreen, /captions\?: MediaCaptions/);
  assert.match(nativePlayer, /captionTextFromMediaCaptions/);
  assert.match(webVibePlayer, /captionToggleChanged/);
  assert.match(webFullscreen, /captionToggleChanged/);
  assert.match(webVibeClip, /mediaCaptionLanguage/);
  assert.doesNotMatch(webVibeClip, /srcLang="en"/);
});

test("Phase 9 user-facing media health panel and retry surfaces are wired", () => {
  const webPanel = read("src/components/media/MediaHealthPanel.tsx");
  const nativePanel = read("apps/mobile/components/media/MediaHealthPanel.tsx");
  const webOutbox = read("src/contexts/WebChatOutboxContext.tsx");
  const nativeOutbox = read("apps/mobile/lib/chatOutbox/ChatOutboxContext.tsx");
  const chatHeader = read("src/components/chat/ChatHeader.tsx");
  const webChat = read("src/pages/Chat.tsx");
  const nativeActions = read("apps/mobile/components/match/MatchActionsSheet.tsx");
  const nativeChat = read("apps/mobile/app/chat/[id].tsx");

  for (const panel of [webPanel, nativePanel]) {
    assert.match(panel, /getMediaPlaybackQoeSnapshot/);
    assert.match(panel, /mediaConnectionSnapshot/);
    assert.match(panel, /uploadSummary/);
    assert.match(panel, /onRetryFailed/);
  }
  assert.match(webOutbox, /getSessionUploadSummary/);
  assert.match(webOutbox, /retryAllFailed/);
  assert.match(webOutbox, /setSessionUploadStats\(\{ enqueued: 0, succeeded: 0, failed: 0 \}\)/);
  assert.match(webOutbox, /isMediaOutboxItem\(next\) && !treatAsOfflineWait/);
  assert.match(nativeOutbox, /getSessionUploadSummary/);
  assert.match(nativeOutbox, /retryAllFailed/);
  assert.match(nativeOutbox, /setSessionUploadStats\(\{ enqueued: 0, succeeded: 0, failed: 0 \}\)/);
  assert.match(nativeOutbox, /isMediaOutboxItem\(next\) && !treatAsOfflineWait/);
  assert.match(chatHeader, /onOpenMediaHealth/);
  assert.match(webChat, /MediaHealthPanel/);
  assert.match(nativeActions, /onOpenMediaHealth/);
  assert.match(nativeChat, /MediaHealthPanel/);
});

test("Phase 9 cold storage tiering and URL routing are wired", () => {
  const migration = read("supabase/migrations/20260520230000_media_phase9_completion.sql");
  const grantLockdownMigration = read("supabase/migrations/20260520233000_media_phase9_mark_accessed_grant_lockdown.sql");
  const bunnyMedia = read("supabase/functions/_shared/bunny-media.ts");
  const worker = read("supabase/functions/process-media-delete-jobs/index.ts");
  const resolver = read("supabase/functions/get-chat-media-url/index.ts");
  const createChatVibeClipUpload = read("supabase/functions/create-chat-vibe-clip-upload/index.ts");

  assert.match(migration, /media_assets[\s\S]*storage_zone/);
  assert.match(migration, /media_assets[\s\S]*last_accessed_at/);
  assert.match(migration, /mark_media_asset_accessed/);
  assert.match(bunnyMedia, /archiveBunnyStorageFile/);
  assert.match(bunnyMedia, /BUNNY_ARCHIVE_STORAGE_ZONE/);
  assert.match(worker, /archiveBunnyStorageFile/);
  assert.match(worker, /cold_tier_preview_count/);
  assert.match(worker, /created_at[\s\S]*90 \* 24/);
  assert.match(worker, /last_accessed_at[\s\S]*60 \* 24/);
  assert.match(resolver, /storage_zone/);
  assert.match(resolver, /mark_media_asset_accessed/);
  assert.match(resolver, /bunnyStorageConfigForTier/);
  assert.match(resolver, /encodeStoragePathForProxy/);
  assert.match(createChatVibeClipUpload, /invalid_captions/);
  assert.match(grantLockdownMigration, /REVOKE ALL ON FUNCTION public\.mark_media_asset_accessed\(uuid\) FROM anon/);
  assert.match(grantLockdownMigration, /REVOKE ALL ON FUNCTION public\.mark_media_asset_accessed\(uuid\) FROM authenticated/);
  assert.match(grantLockdownMigration, /GRANT EXECUTE ON FUNCTION public\.mark_media_asset_accessed\(uuid\) TO service_role/);
});

test("Phase 9 Bunny CDN health, geo docs, and privacy docs are present", () => {
  const config = read("supabase/config.toml");
  const migration = read("supabase/migrations/20260520230000_media_phase9_completion.sql");
  const health = read("supabase/functions/check-bunny-cdn-health/index.ts");
  const geoDoc = read("docs/operations/bunny-geo-replication.md");
  const privacyDoc = read("docs/architecture/media-privacy.md");

  assert.match(config, /\[functions\.check-bunny-cdn-health\]/);
  assert.match(migration, /bunny_cdn_health_state/);
  assert.match(migration, /bunny-cdn-health-minutely/);
  assert.match(health, /BUNNY_CDN_HEALTH_STREAM_URL/);
  assert.match(health, /BUNNY_CDN_HEALTH_STORAGE_URL/);
  assert.match(health, /BUNNY_STREAM_TOKEN_SECURITY_KEY/);
  assert.match(health, /resolveStreamProbeUrl/);
  assert.match(health, /signBunnyStreamDirectoryUrl/);
  assert.match(health, /bunny_cdn_health/);
  assert.match(health, /consecutiveFailures >= 3/);
  assert.match(health, /type HealthStatus = "healthy" \| "degraded" \| "misconfigured"/);
  assert.match(health, /status,\s*healthy,/);
  assert.doesNotMatch(health, /healthy \? 200 : 503/);
  assert.match(geoDoc, /BUNNY_ARCHIVE_STORAGE_ZONE/);
  assert.match(geoDoc, /check-bunny-cdn-health/);
  assert.match(geoDoc, /returns HTTP 200 for healthy, degraded, and misconfigured probe outcomes/);
  assert.match(privacyDoc, /profiles\.encryption_pub_key/);
  assert.match(privacyDoc, /matches\.encrypted_conversation_keys/);
  assert.match(privacyDoc, /server stores and hashes ciphertext only/);
  assert.match(privacyDoc, /Runtime client-side encryption\/decryption[\s\S]*is not active yet/);
});

test("Phase 9 contracts are wired directly into CI and cloud validation", () => {
  const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
  assert.equal(packageJson.scripts?.["test:media-phase9"], "tsx shared/mediaPhase9Contracts.test.ts");

  const workflow = read(".github/workflows/phase-9-media-playback-policy.yml");
  assert.match(workflow, /npm run test:media-phase9/);
  assert.match(workflow, /shared\/mediaPhase9Contracts\.test\.ts/);
  assert.match(workflow, /src\/hooks\/useMediaPlaybackQoE\.ts/);
  assert.match(workflow, /apps\/mobile\/\*\*/);
  assert.match(workflow, /supabase\/functions\/_shared\/\*\*/);
  assert.match(workflow, /supabase\/functions\/check-bunny-cdn-health\/\*\*/);
  assert.match(workflow, /supabase\/functions\/get-chat-media-url\/\*\*/);
  assert.match(workflow, /supabase\/functions\/process-media-delete-jobs\/\*\*/);
  assert.match(workflow, /supabase\/migrations\/\*\*/);
  assert.match(workflow, /supabase\/validation\/media_phase9_completion\.sql/);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/);

  const validation = read("supabase/validation/media_phase9_completion.sql");
  assert.match(validation, /media_phase9_completion_ok/);
  assert.match(validation, /vibe_video_uploads', 'captions/);
  assert.match(validation, /profiles', 'vibe_video_captions/);
  assert.match(validation, /media_assets', 'storage_zone/);
  assert.match(validation, /media_captions_jsonb_valid/);
  assert.match(validation, /mark_media_asset_accessed must stay service-role only/);
  assert.match(validation, /bunny-cdn-health-minutely/);
});

test("Phase 9 telemetry-safe source ref classification is PII-safe", () => {
  assert.equal(telemetrySafeSourceRef("https://example.com/raw/path"), "remote_url");
  assert.equal(telemetrySafeSourceRef("blob:https://example.com/abc"), "local_media");
  assert.equal(telemetrySafeSourceRef("bunny_stream:abc"), "bunny_stream_ref");
  assert.equal(telemetrySafeSourceRef("bunny_storage:photos/a.jpg"), "bunny_storage_ref");
  assert.equal(telemetrySafeSourceRef("profile_vibe_video:profile:video"), "profile_vibe_video_ref");
  assert.equal(telemetrySafeSourceRef("encrypted_chat_media:abc"), "encrypted_chat_media_ref");
  assert.equal(telemetrySafeSourceRef("some-user-generated-opaque-id"), "opaque_ref");
});
