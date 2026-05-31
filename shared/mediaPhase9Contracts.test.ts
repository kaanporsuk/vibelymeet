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
import { sanitizeMediaTelemetryProperties } from "./media/telemetry.ts";
import { telemetrySafeSourceRef } from "./media/telemetry-safe-ref.ts";
import { MEDIA_PLAYBACK_QOE_EVENTS, MEDIA_VIBE_VIDEO_EVENTS } from "./media/mediaTelemetry.ts";

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

  assert.equal(MEDIA_PLAYBACK_QOE_EVENTS.summary, "media_playback_qoe");
  assert.equal(MEDIA_PLAYBACK_QOE_EVENTS.rebuffer, "media_playback_qoe_rebuffer");

  for (const qoe of [webQoe, nativeQoe]) {
    assert.match(qoe, /MEDIA_PLAYBACK_QOE_EVENTS\.summary/);
    assert.match(qoe, /MEDIA_PLAYBACK_QOE_EVENTS\.rebuffer/);
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
  assert.match(fullscreen, /playbackRef\?: string \| null/);
  assert.match(fullscreen, /profileId\?: string \| null/);
  assert.match(fullscreen, /if \(usesSignedProfileRef && mediaAssetStatus !== "error"\) return/);
  assert.match(fullscreen, /signedProfileRefPlaybackPending/);

  assert.match(sharedPolicy, /REBUFFER_DEGRADE_WINDOW_MS = 30_000/);
  assert.match(sharedPolicy, /REBUFFER_DEGRADE_THRESHOLD = 2/);
  assert.match(sharedPolicy, /PREWARM_SESSION_BYTE_LIMIT = 10 \* 1024 \* 1024/);
  assert.match(sharedPolicy, /createMediaPlaybackSessionPolicy/);
  assert.match(sharedPolicy, /getMediaPlaybackQoeSnapshot/);
  assert.match(sharedPolicy, /mediaPlaybackAbrPolicy/);
  assert.match(hlsPlayback, /isMediaPlaybackQoeDegraded/);
  assert.match(hlsPlayback, /mediaConnectionSnapshot/);
  assert.match(hlsPlayback, /applyHlsAbrPolicy/);
  assert.match(hlsPlayback, /autoLevelCapping/);
  assert.match(hlsPlayback, /startLevel = Math\.min/);

  for (const policy of [webPolicy, nativePolicy]) {
    assert.match(policy, /createMediaPlaybackSessionPolicy/);
    assert.match(policy, /getMediaPlaybackQoeSnapshot/);
    assert.match(policy, /mediaConnectionSnapshot/);
    assert.match(policy, /mediaPlaybackAbrPolicy/);
  }
  assert.match(nativePolicy, /@react-native-community\/netinfo/);
  assert.match(nativePolicy, /nativeConnectionSnapshot/);
  assert.match(nativePolicy, /isConnectionExpensive/);
});

test("shared media telemetry sanitizer strips auth/url/path fields across product wrappers", () => {
  assert.deepEqual(
    sanitizeMediaTelemetryProperties(
      {
        source: "vibe_player_fullscreen",
        signedUrl: "https://example.test/private.m3u8?token=secret",
        Authorization: "Bearer secret",
        provider_path: "events/private.jpg",
        attempt: 1,
        outcome: "refreshed",
      },
      { defaults: { platform: "web" } },
    ),
    {
      platform: "web",
      source: "vibe_player_fullscreen",
      attempt: 1,
      outcome: "refreshed",
    },
  );
});

test("Phase 9 reduce-motion defaults, animation gates, and preload policy are pinned", () => {
  const nativeReduceMotion = read("apps/mobile/hooks/useReduceMotion.ts");
  const nativeQoe = read("apps/mobile/hooks/useNativeMediaPlaybackQoE.ts");
  const nativeVibePlayer = read("apps/mobile/components/video/VibeVideoPlayer.tsx");
  const nativeChatViewer = read("apps/mobile/components/chat/ChatThreadMediaViewer.tsx");
  const nativeChat = read("apps/mobile/app/chat/[id].tsx");
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
  assert.doesNotMatch(nativeVibePlayer, /player\.replace\(/);
  assert.doesNotMatch(nativeVibePlayer, /vibeVideo\.player\.pause\.unmount/);
  assert.match(nativeVibePlayer, /vibeVideo\.player\.status\.initial/);
  assert.match(nativeVibePlayer, /setManualPlaybackRequested\(true\)/);
  assert.match(nativeChatViewer, /useReduceMotionState/);
  assert.match(nativeChatViewer, /shouldAttachPlayback[\s\S]*reduceMotionResolved/);
  assert.doesNotMatch(nativeChatViewer, /chat\.viewerVideo\.replace/);
  assert.match(nativeChatViewer, /chat\.viewerVideo\.status\.initial/);
  assert.match(nativeChatViewer, /setManualPlaybackRequested\(true\)/);
  assert.doesNotMatch(nativeChat, /chat\.video\.pause\.unmount/);
  assert.match(nativeChat, /chat\.video\.status\.initial/);
  assert.match(nativeVibeClip, /useReduceMotionState/);
  assert.match(nativeVibeClip, /shouldAttachPlayback[\s\S]*reduceMotionResolved/);
  assert.match(nativeVibeClip, /useMemo<VideoSource>\(\(\) => \(shouldAttachPlayback \? videoSourceForUri\(meta\.videoUrl\) : null\)/);
  assert.match(nativeVibeClip, /enabled: shouldAttachPlayback/);
  assert.doesNotMatch(nativeVibeClip, /vibeClip\.player\.replace/);
  assert.match(nativeVibeClip, /vibeClip\.player\.status\.initial/);
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
  assert.match(webVibeClip, /CLIP_PLAYBACK_LOAD_TIMEOUT_MS/);
  assert.match(webVibeClip, /isIosSafari/);
  assert.match(webVibeClip, /onLoadedData=\{markReadyIfPossible\}/);
  assert.match(webVibeClip, /onCanPlay=\{markReadyIfPossible\}/);
  assert.match(webVideoBubble, /!prefersReducedMotion && "animate-spin"/);
  assert.match(webVideoBubble, /isIosSafari/);
  assert.match(webVideoBubble, /onLoadedData=\{markReadyIfPossible\}/);
  assert.match(webVideoBubble, /onCanPlay=\{markReadyIfPossible\}/);
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
  assert.match(chatVideoLightbox, /CLIP_PLAYBACK_LOAD_TIMEOUT_MS/);
  assert.match(chatVideoLightbox, /onAutoplayBlocked: revealPlayer/);
  assert.match(chatVideoLightbox, /onManifestParsed: revealPlayer/);
  assert.match(chatVideoLightbox, /prefersReducedMotion \? "" : "animate-spin"/);
  assert.match(chatPhotoLightbox, /usePrefersReducedMotion/);
  assert.match(vibeStudioModal, /usePrefersReducedMotion/);
  assert.match(vibeStudioModal, /!prefersReducedMotion && "animate-ping"/);
  assert.match(vibeStudioModal, /if \(!prefersReducedMotion\)[\s\S]*videoEl\.play/);
  assert.match(webRecorder, /usePrefersReducedMotion/);
  assert.match(webRecorder, /autoPlay=\{!prefersReducedMotion\}/);
  assert.match(webRecorder, /controls=\{prefersReducedMotion\}/);
});

test("chat shared video playback keeps HLS attached when only callback props change", () => {
  const mediaAssetHook = read("src/hooks/useMediaAsset.ts");

  assert.match(mediaAssetHook, /const onAutoplayBlockedRef = useRef\(onAutoplayBlocked\)/);
  assert.match(mediaAssetHook, /const onManifestParsedRef = useRef\(onManifestParsed\)/);
  assert.match(mediaAssetHook, /const onErrorRef = useRef\(onError\)/);
  assert.match(mediaAssetHook, /onAutoplayBlocked: \(detail\) => onAutoplayBlockedRef\.current\?\.\(detail\)/);
  assert.match(mediaAssetHook, /onManifestParsed: \(\) => onManifestParsedRef\.current\?\.\(\)/);
  assert.match(mediaAssetHook, /onError: \(kind, detail\) => onErrorRef\.current\?\.\(kind, detail\)/);
  assert.ok(
    mediaAssetHook.includes(
      "}, [autoPlay, enabled, expiresAtMs, hasAuthErrorRefresh, hasProactiveRefresh, sourceUrl, videoRef]);",
    ),
  );
  assert.doesNotMatch(
    mediaAssetHook,
    /\[autoPlay, enabled, onAutoplayBlocked, onError, onManifestParsed, sourceUrl, videoRef\]/,
  );
});

test("web HLS element errors are owned by the attach-layer token refresh path", () => {
  const mediaAssetHook = read("src/hooks/useMediaAsset.ts");
  const hlsPlayback = read("src/lib/vibeVideo/attachHlsPlayback.ts");
  const vibePlayer = read("src/components/vibe-video/VibePlayer.tsx");
  const vibeClip = read("src/components/chat/VibeClipBubble.tsx");
  const videoBubble = read("src/components/chat/VideoMessageBubble.tsx");
  const chatVideoLightbox = read("src/components/chat/ChatVideoLightbox.tsx");

  assert.match(mediaAssetHook, /const hasAuthErrorRefresh = typeof onAuthErrorRefresh === "function"/);
  assert.match(mediaAssetHook, /const hasProactiveRefresh = typeof onProactiveRefresh === "function"/);
  assert.match(
    mediaAssetHook,
    /onAuthErrorRefresh: hasAuthErrorRefresh \? \(detail\) => onAuthErrorRefreshRef\.current\?\.\(detail\) : undefined/,
  );
  assert.match(
    mediaAssetHook,
    /onProactiveRefresh: hasProactiveRefresh \? \(\) => onProactiveRefreshRef\.current\?\.\(\) : undefined/,
  );
  assert.match(hlsPlayback, /refreshAfterAuthError/);
  assert.match(hlsPlayback, /playbackMode === "hls_js" && \(!isAuthStatusCode\(statusCode\) \|\| !isNetworkHlsError\(data\)\)/);

  assert.match(vibePlayer, /const isHlsPlaybackUrl = playbackUrl \? isHlsMediaAssetUrl\(playbackUrl\) : false/);
  assert.match(vibePlayer, /const handleError = \(\) => \{\s*if \(isHlsPlaybackUrl\) return;\s*reportPlaybackError\(\);\s*\};/);
  assert.match(vibeClip, /const handleVideoLoadError = useCallback\(\(\) => \{\s*if \(isHlsUrl\) return;/);
  assert.match(videoBubble, /onError=\{\(\) => \{\s*if \(isHlsUrl\) return;\s*setIsLoading\(false\);/);
  assert.match(chatVideoLightbox, /onError=\{\(\) => \{\s*if \(isHlsUrl\) return;\s*void refreshMedia\(\)/);
});

test("chat shared video lightbox does not reset loading phase for unchanged media URLs", () => {
  const chatVideoLightbox = read("src/components/chat/ChatVideoLightbox.tsx");

  assert.match(
    chatVideoLightbox,
    /const refreshMediaRef = useRef<\(\(reason\?: LightboxMediaRefreshReason\) => Promise<boolean>\) \| null>\(null\)/,
  );
  assert.match(chatVideoLightbox, /refreshMediaRef\.current = refreshMedia/);
  assert.match(chatVideoLightbox, /const refresh = refreshMediaRef\.current/);
  assert.match(chatVideoLightbox, /const initialPosterUrl = displayablePosterUrl\(posterUrl\)/);
  assert.match(chatVideoLightbox, /const posterUrlRef = useRef\(initialPosterUrl\)/);
  assert.ok(chatVideoLightbox.includes("}, [resetPhase, videoAssetFallbackReason, videoSourceRef, videoUrl]);"));
  assert.ok(chatVideoLightbox.includes("}, [canMountPlayer, isHlsUrl, playableVideoUrl, prefersReducedMotion, revealPlayer]);"));
  assert.doesNotMatch(
    chatVideoLightbox,
    /\[posterUrl, prefersReducedMotion, refreshMedia, resetPhase, revealPlayer, videoSourceRef, videoUrl\]/,
  );
  assert.doesNotMatch(
    chatVideoLightbox,
    /\[posterUrl, prefersReducedMotion, resetPhase, revealPlayer, videoSourceRef, videoUrl\]/,
  );
});

test("chat shared video callbacks are stable across row and lightbox rerenders", () => {
  const webChat = read("src/pages/Chat.tsx");

  assert.match(webChat, /const handleResolvedVideoUrl = useCallback/);
  assert.match(webChat, /const handleResolvedThumbnailUrl = useCallback/);
  assert.match(webChat, /const handleRequestClipImmersive = useCallback/);
  assert.match(webChat, /onResolvedVideoUrl=\{handleResolvedVideoUrl\}/);
  assert.match(webChat, /onResolvedThumbnailUrl=\{handleResolvedThumbnailUrl\}/);
  assert.match(webChat, /onRequestImmersive=\{handleRequestClipImmersive\}/);
  assert.match(webChat, /const handleVideoLightboxResolvedVideoUrl = useCallback/);
  assert.match(webChat, /const handleVideoLightboxResolvedThumbnailUrl = useCallback/);
  assert.match(webChat, /onResolvedVideoUrl=\{handleVideoLightboxResolvedVideoUrl\}/);
  assert.match(webChat, /onResolvedThumbnailUrl=\{handleVideoLightboxResolvedThumbnailUrl\}/);
  assert.match(webChat, /onClose=\{closeVideoLightbox\}/);
  assert.doesNotMatch(webChat, /onResolvedVideoUrl=\{\(url\) => onResolvedVideoUrl\?\.\(message\.id, url\)\}/);
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

test("Phase 9 captions stay on chat clips while profile Vibe Videos suppress generated captions", () => {
  const packageJson = read("apps/mobile/package.json");
  const nativeHook = read("apps/mobile/hooks/useNativeCaptionCapture.ts");
  const nativeChat = read("apps/mobile/app/chat/[id].tsx");
  const nativeVibeRecord = read("apps/mobile/app/vibe-video-record.tsx");
  const nativeVibeStudio = read("apps/mobile/app/vibe-studio.tsx");
  const nativeProfileFullView = read("apps/mobile/components/profile/UserProfileFullView.tsx");
  const nativeVibeState = read("apps/mobile/lib/vibeVideoState.ts");
  const webRecorder = read("src/components/chat/VideoMessageRecorder.tsx");
  const webStudio = read("src/components/vibe-video/VibeStudioModal.tsx");
  const webProfileStudio = read("src/pages/ProfileStudio.tsx");
  const webVibeStudio = read("src/pages/VibeStudio.tsx");
  const webVibeState = read("src/lib/vibeVideo/webVibeVideoState.ts");
  const otherUserViewModel = read("shared/profile/otherUserProfileViewModel.ts");
  const migration = read("supabase/migrations/20260520230000_media_phase9_completion.sql");
  const createVideoUpload = read("supabase/functions/create-video-upload/index.ts");
  const webVibePlayer = read("src/components/vibe-video/VibePlayer.tsx");
  const webFullscreen = read("src/components/vibe-video/VibeVideoFullscreenPlayer.tsx");
  const nativePlayer = read("apps/mobile/components/video/VibeVideoPlayer.tsx");
  const webVibeClip = read("src/components/chat/VibeClipBubble.tsx");

  assert.match(packageJson, /expo-speech-recognition/);
  assert.match(nativeHook, /expo-speech-recognition/);
  assert.doesNotMatch(nativeHook, /import\s+(?!type\b)[\s\S]{0,160}from 'expo-speech-recognition'/);
  assert.doesNotMatch(nativeHook, /import\s+\{[\s\S]*ExpoSpeechRecognitionModule[\s\S]*\}\s+from 'expo-speech-recognition'/);
  assert.doesNotMatch(nativeHook, /useSpeechRecognitionEvent/);
  assert.match(nativeHook, /requireOptionalNativeModule/);
  assert.match(nativeHook, /requireOptionalNativeModule\('ExpoSpeechRecognition'\)[\s\S]*require\('expo-speech-recognition'\)/);
  assert.doesNotMatch(nativeHook, /cachedSpeechRecognitionModule\s*=\s*null/);
  assert.match(nativeHook, /require\('expo-speech-recognition'\)/);
  assert.match(nativeHook, /native_module_unavailable/);
  assert.match(nativeHook, /requiresOnDeviceRecognition: true/);
  assert.match(nativeHook, /on_device_recognition_unavailable/);
  assert.match(nativeHook, /startRecognitionForRun/);
  assert.match(nativeHook, /useSafeSpeechRecognitionEvent\('end'[\s\S]*startRecognitionForRun/);
  assert.match(nativeChat, /NativeVibeClipCameraModal/);
  assert.match(nativeChat, /captions: p\.captions \?\? null/);
  assert.match(nativeVibeRecord, /useReduceMotion/);
  assert.match(nativeVibeRecord, /animationType=\{reduceMotion \? 'none' : 'fade'\}/);
  assert.doesNotMatch(nativeVibeRecord, /useNativeCaptionCapture/);
  assert.doesNotMatch(nativeVibeRecord, /captionReviewText|captionsFromReviewText|generatedCaptionEditor/);
  assert.match(webRecorder, /caption_capture_unavailable/);
  assert.match(webRecorder, /caption_capture_succeeded/);
  assert.match(webRecorder, /pendingRecording/);
  assert.doesNotMatch(webStudio, /caption_capture_unavailable|caption_capture_succeeded|captionsFromReview|captionReviewText/);
  assert.doesNotMatch(webStudio, /<label[\s\S]{0,160}Captions|<textarea[\s\S]{0,240}Captions/);
  assert.match(migration, /ALTER TABLE public\.vibe_video_uploads[\s\S]*ADD COLUMN IF NOT EXISTS captions jsonb/);
  assert.match(migration, /jsonb_typeof\(v_cue->'text'\) IS DISTINCT FROM 'string'/);
  assert.match(migration, /profiles\.vibe_video_captions/);
  assert.doesNotMatch(createVideoUpload, /normalizeMediaCaptions/);
  assert.doesNotMatch(createVideoUpload, /invalid_captions/);
  assert.match(createVideoUpload, /vibe_video_captions/);
  assert.match(createVideoUpload, /\.update\(\{ vibe_video_captions: null \}\)/);
  assert.match(createVideoUpload, /\.update\(\{ captions: null \}\)/);
  assert.match(webVibeState, /const captions = null/);
  assert.match(nativeVibeState, /const captions = null/);
  assert.match(webProfileStudio, /captions=\{null\}/);
  assert.match(webVibeStudio, /captions=\{null\}/);
  assert.match(nativeVibeStudio, /captions=\{null\}/);
  assert.match(nativeProfileFullView, /captions=\{null\}/);
  assert.match(otherUserViewModel, /captions: null/);
  assert.doesNotMatch(otherUserViewModel, /parseMediaCaptions/);
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

test("Sprint 1 native HLS auth refresh stays bounded, signed-only, and fatal-safe", () => {
  const nativeVibePlayer = read("apps/mobile/components/video/VibeVideoPlayer.tsx");
  const nativeMediaAssetHook = read("apps/mobile/hooks/useMediaAsset.ts");

  assert.match(nativeVibePlayer, /const MAX_HLS_AUTH_REFRESH_ATTEMPTS = 2/);
  assert.match(nativeVibePlayer, /const PROACTIVE_HLS_TOKEN_REFRESH_RETRY_MS = 5 \* 1000/);
  assert.match(nativeVibePlayer, /const usesSignedProfileRef = isProfileVibeVideoRef\(sourceUri\)/);
  assert.match(nativeVibePlayer, /if \(!usesSignedProfileRef\) return false;/);
  assert.match(nativeVibePlayer, /authRefreshAttemptsRef\.current >= MAX_HLS_AUTH_REFRESH_ATTEMPTS/);
  assert.match(nativeVibePlayer, /refreshMediaAsset\('playback', \{ bypassFailureCooldown: true \}\)/);
  assert.match(nativeVibePlayer, /refreshMediaAsset\('proactive', \{ suppressFailureCache: true \}\)/);
  assert.doesNotMatch(nativeVibePlayer, /vibeVideo\.player\.replace\.authRefresh/);
  assert.match(nativeVibePlayer, /freshUri === playbackSourceUri[\s\S]*player\.replaceAsync\(freshUri\)/);
  assert.match(nativeVibePlayer, /if \(authRefreshInFlightRef\.current\) \{\s*scheduleRetry\(\);\s*return;\s*\}/);
  assert.match(nativeVibePlayer, /VIBE_VIDEO_EVENTS\.tokenRefreshOnAuthError/);
  assert.match(nativeMediaAssetHook, /kind === 'profile_vibe_video' && url && isHlsMediaAssetUrl\(url\)/);
  assert.doesNotMatch(nativeMediaAssetHook, /if \(url && isHlsMediaAssetUrl\(url\)\) return/);
  assert.match(
    nativeVibePlayer,
    /usesSignedProfileRef[\s\S]*authRefreshAttemptsRef\.current < MAX_HLS_AUTH_REFRESH_ATTEMPTS[\s\S]*refreshPlaybackAfterAuthError\(\)[\s\S]*if \(!didRefresh\) reportFatalPlaybackError\(\)/,
  );
});

test("Sprint 1 local preview ownership is cleaned on pagehide and preserved after upload handoff", () => {
  const controller = read("src/lib/heroVideo/heroVideoUploadController.ts");
  const studioModal = read("src/components/vibe-video/VibeStudioModal.tsx");
  const onboardingStep = read("src/pages/onboarding/steps/VibeVideoStep.tsx");

  assert.match(controller, /function _handlePageHide\(\): void \{\s*_clearLocalPreview\(\);\s*\}/);
  assert.match(controller, /window\.addEventListener\("pagehide", _pageHideHandler\)/);
  assert.match(controller, /window\.removeEventListener\("pagehide", _pageHideHandler\)/);

  assert.match(studioModal, /const pendingLocalPreviewUrl = recordedVideoUrl \?\? URL\.createObjectURL\(file\)/);
  assert.match(
    studioModal,
    /catch \(error\) \{\s*if \(pendingLocalPreviewUrl !== recordedVideoUrl\) URL\.revokeObjectURL\(pendingLocalPreviewUrl\);/,
  );
  assert.match(studioModal, /setRecordedVideoUrl\(null\)/);
  assert.match(onboardingStep, /const pendingLocalPreviewUrl = URL\.createObjectURL\(file\)/);
  assert.match(onboardingStep, /catch \(error\) \{\s*URL\.revokeObjectURL\(pendingLocalPreviewUrl\);/);
});

test("Sprint 1 native CDN hostname mismatch emits sanitized PostHog and Sentry warnings", () => {
  const nativePlaybackUrl = read("apps/mobile/lib/vibeVideoPlaybackUrl.ts");
  const nativeTelemetry = read("apps/mobile/lib/vibeVideoTelemetry.ts");

  assert.match(nativeTelemetry, /export function captureVibeVideoMessage/);
  assert.match(nativeTelemetry, /captureMediaTelemetryMessage\(message, properties/);
  assert.match(nativeTelemetry, /feature: 'vibe_video'/);
  assert.match(nativePlaybackUrl, /captureVibeVideoMessage/);
  assert.match(nativePlaybackUrl, /VIBE_VIDEO_EVENTS\.cdnHostnamePersistenceMismatch/);
  assert.match(nativePlaybackUrl, /captureVibeVideoMessage\('vibe_video_cdn_hostname_persistence_mismatch', properties, 'warning'\)/);
  assert.match(nativePlaybackUrl, /env_hostname_present: true/);
  assert.match(nativePlaybackUrl, /persisted_hostname_present: true/);
});

test("Sprint 2 profile Vibe Video TTFF and placeholder backfill ops are pinned", () => {
  const sharedTtff = read("shared/media/profileVibeVideoTtff.ts");
  const webTelemetry = read("src/lib/vibeVideo/vibeVideoTelemetry.ts");
  const nativeTelemetry = read("apps/mobile/lib/vibeVideoTelemetry.ts");
  const webProfileTtff = read("src/lib/vibeVideo/profileVibeVideoTtff.ts");
  const nativeProfileTtff = read("apps/mobile/lib/profileVibeVideoTtff.ts");
  const webProfileView = read("src/components/profile/OtherUserFullProfileView.tsx");
  const webFullscreen = read("src/components/vibe-video/VibeVideoFullscreenPlayer.tsx");
  const nativeProfileView = read("apps/mobile/components/profile/UserProfileFullView.tsx");
  const nativeFullscreen = read("apps/mobile/components/video/FullscreenVibeVideoModal.tsx");
  const nativeVibePlayer = read("apps/mobile/components/video/VibeVideoPlayer.tsx");
  const backfillFn = read("supabase/functions/backfill-media-placeholders/index.ts");
  const backfillOpsMigration = read("supabase/migrations/20260523120000_media_placeholder_backfill_ops.sql");

  assert.equal(MEDIA_VIBE_VIDEO_EVENTS.profileTtffMeasured, "vibe_video_profile_ttff_ms");
  assert.match(webTelemetry, /MEDIA_VIBE_VIDEO_EVENTS/);
  assert.match(nativeTelemetry, /MEDIA_VIBE_VIDEO_EVENTS/);
  assert.match(sharedTtff, /prewarm_age_ms/);
  assert.match(sharedTtff, /signed_profile_ref/);
  assert.match(sharedTtff, /source_kind/);
  assert.doesNotMatch(sharedTtff, /profile_id/);
  assert.match(webProfileTtff, /trackVibeVideoEvent\(VIBE_VIDEO_EVENTS\.profileTtffMeasured, payload\)/);
  assert.match(nativeProfileTtff, /trackVibeVideoEvent\(VIBE_VIDEO_EVENTS\.profileTtffMeasured, payload\)/);
  assert.match(webProfileView, /beginInlineProfileVibeVideoTtff\(\);[\s\S]{0,80}setShowVideoPlayer\(true\)/);
  assert.match(webProfileView, /if \(!prefersReducedMotion\) beginInlineProfileVibeVideoTtff\(\)/);
  assert.match(webProfileView, /onPlaybackRequest=\{beginInlineProfileVibeVideoTtff\}/);
  assert.match(webFullscreen, /beginFullscreenProfileVibeVideoTtff\("fullscreen_open"\)/);
  assert.match(nativeProfileView, /beginNativeProfileVibeVideoTtff\(\);[\s\S]{0,80}setShowFullscreenVibe\(true\)/);
  assert.match(nativeProfileView, /if \(!reduceMotion\) beginNativeProfileVibeVideoTtff\(\)/);
  assert.match(nativeProfileView, /onPlaybackAbort=\{resetNativeProfileVibeVideoTtff\}/);
  assert.match(nativeFullscreen, /onPlaybackRequest=\{onPlaybackRequest\}/);
  assert.match(nativeFullscreen, /onFirstFrame=\{onFirstFrame\}/);
  assert.match(nativeFullscreen, /onPlaybackAbort\?: \(\) => void/);
  assert.match(nativeFullscreen, /onPlaybackAbort\?\.\(\);[\s\S]{0,80}onClose\(\)/);
  assert.match(nativeVibePlayer, /onPlaybackRequest\?\.\(\);[\s\S]*setManualPlaybackRequested\(true\)/);
  assert.match(nativeVibePlayer, /onFirstFrameRender=\{\(\) => \{[\s\S]*reportFirstFrame\(\);[\s\S]*\}\}/);
  assert.doesNotMatch(nativeVibePlayer, /label: 'vibeVideo\.player\.statusListener',\s*label:/);

  assert.match(backfillFn, /const cronSecret = Deno\.env\.get\("CRON_SECRET"\)/);
  assert.match(backfillFn, /\(cronSecret && bearer === cronSecret\)/);
  assert.match(backfillOpsMigration, /trigger_media_placeholder_backfill_now/);
  assert.match(backfillOpsMigration, /pg_extension WHERE extname = 'pg_cron'/);
  assert.match(backfillOpsMigration, /pg_extension WHERE extname = 'pg_net'/);
  assert.match(backfillOpsMigration, /vault\.decrypted_secrets/);
  assert.match(backfillOpsMigration, /media-placeholder-backfill-hourly/);
  assert.match(backfillOpsMigration, /'Authorization', 'Bearer ' \|\| btrim/);
});
