import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Play,
  Volume2,
  VolumeX,
  Maximize,
  AlertCircle,
  Loader2,
  Film,
  CalendarPlus,
  Heart,
  Mic,
  Captions,
} from "lucide-react";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { EmojiBar, type ReactionEmoji } from "@/components/chat/EmojiBar";
import type { VibeClipDisplayMeta } from "../../../shared/chat/messageRouting";
import type { ReactionPair } from "../../../shared/chat/messageReactionModel";
import { compactReactionLabel } from "../../../shared/chat/messageReactionModel";
import { replyPromptForContext } from "../../../shared/chat/vibeClipPrompts";
import { CLIP_DATE_ACTION_HINT } from "../../../shared/dateSuggestions/dateComposerLaunch";
import { trackVibeClipEvent } from "@/lib/vibeClipAnalytics";
import { durationBucketFromSeconds, threadBucketFromCount } from "../../../shared/chat/vibeClipAnalytics";
import { captionTextFromMediaCaptions, mediaCaptionLanguage, mediaCaptionsToWebVtt } from "../../../shared/media/captions";
import { cn } from "@/lib/utils";
import { useMediaAsset, useMediaAssetPlayback } from "@/hooks/useMediaAsset";
import { useMediaPlaybackQoE } from "@/hooks/useMediaPlaybackQoE";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useMediaVideoPreloadForVisibility } from "@/hooks/useMediaVideoPreloadPolicy";
import {
  syncChatVibeClipStatus,
  type ChatVibeClipProcessingStatus,
} from "@/lib/mediaAssetResolver";

type VideoElementWithWebkitFullscreen = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
};
type VibeClipMediaRefreshReason = "preview" | "initial" | "playback" | "manual";

const CLIP_BUBBLE_WIDTH_CLASS = "w-[min(17.5rem,calc(100vw-4rem))] max-w-full";
const CHAT_VIBE_CLIP_STATUS_SYNC_SAFETY_NET_INTERVAL_MS = 30_000;
const CLIP_PLAYBACK_LOAD_TIMEOUT_MS = 12_000;
const MAX_CLIP_PLAYBACK_REFRESH_ATTEMPTS = 1;
const VIBE_CLIP_CAPTIONS_PREF_KEY = "vibely:vibe-clip-captions";

export type VibeClipLocalRecovery = {
  stateLabel?: string;
  error?: string;
  canResume?: boolean;
  canDiscard?: boolean;
  onResume?: () => void;
  onDiscardAndSendAgain?: () => void;
};

function isLocalPreviewUrl(value: string): boolean {
  return value.startsWith("blob:") || value.startsWith("file:") || value.startsWith("data:");
}

function isResolvableMediaRef(value: string | null | undefined): boolean {
  return !!value && !isLocalPreviewUrl(value) && !/^https?:\/\//i.test(value);
}

function initialCaptionPreference(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(VIBE_CLIP_CAPTIONS_PREF_KEY) !== "0";
  } catch {
    return true;
  }
}

interface VibeClipBubbleProps {
  meta: VibeClipDisplayMeta;
  isMine: boolean;
  onReplyWithClip?: () => void;
  onVoiceReply?: () => void;
  /** Secondary: existing date composer entry (gated in parent). */
  onSuggestDate?: () => void;
  onReactionPick?: (emoji: ReactionEmoji) => void;
  /** Persisted reactions for this clip (both participants in 1:1). */
  reactionPair?: ReactionPair | null;
  threadMessageCount?: number;
  sparkMessageId?: string;
  /** Opens chat fullscreen video viewer (preferred over browser fullscreen). */
  onRequestImmersive?: (media?: { videoUrl: string; thumbnailUrl?: string | null }) => void;
  /** Pause inline preview while immersive viewer is open for this clip URL. */
  immersiveActive?: boolean;
  videoSourceRef?: string | null;
  thumbnailSourceRef?: string | null;
  onResolvedVideoUrl?: (url: string) => void;
  onResolvedThumbnailUrl?: (url: string) => void;
  /** Older clips in the thread sit visually quieter than the latest. */
  threadVisualRecede?: boolean;
  localRecovery?: VibeClipLocalRecovery | null;
}

export const VibeClipBubble = ({
  meta,
  isMine,
  onReplyWithClip,
  onVoiceReply,
  onSuggestDate,
  onReactionPick,
  reactionPair,
  threadMessageCount = 0,
  sparkMessageId,
  onRequestImmersive,
  immersiveActive,
  videoSourceRef,
  thumbnailSourceRef,
  onResolvedVideoUrl,
  onResolvedThumbnailUrl,
  threadVisualRecede = false,
  localRecovery = null,
}: VibeClipBubbleProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [hasMetadata, setHasMetadata] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [showReactBar, setShowReactBar] = useState(false);
  const [playableVideoUrl, setPlayableVideoUrl] = useState(meta.videoUrl);
  const [playableThumbnailUrl, setPlayableThumbnailUrl] = useState(meta.thumbnailUrl ?? null);
  const [playRequested, setPlayRequested] = useState(false);
  const [syncedProcessingStatus, setSyncedProcessingStatus] = useState<ChatVibeClipProcessingStatus | null>(null);
  const [syncAttemptCount, setSyncAttemptCount] = useState(0);
  const [isSyncingStatus, setIsSyncingStatus] = useState(false);
  const [showCaptions, setShowCaptions] = useState(initialCaptionPreference);
  const [captionTrackUrl, setCaptionTrackUrl] = useState<string | null>(null);
  const [isViewportVisible, setIsViewportVisible] = useState(true);
  const prefersReducedMotion = usePrefersReducedMotion();
  const playStartTracked = useRef(false);
  const playCompleteTracked = useRef(false);
  const playbackRefreshAttemptCountRef = useRef(0);
  const posterRefreshAttemptedForRef = useRef<string | null>(null);
  const playableVideoUrlRef = useRef(meta.videoUrl);
  const playableThumbnailUrlRef = useRef<string | null>(meta.thumbnailUrl ?? null);
  const readyRefreshKeyRef = useRef<string | null>(null);
  const statusSyncInFlightRef = useRef(false);
  const statusSyncRunIdRef = useRef(0);
  const isMountedRef = useRef(true);
  const handleRealtimeProcessingStatus = useCallback((status: ChatVibeClipProcessingStatus) => {
    setSyncedProcessingStatus(status);
  }, []);
  const { url: videoAssetUrl, refresh: refreshVideoAsset } = useMediaAsset({
    kind: "vibe_clip",
    messageId: sparkMessageId,
    sourceRef: videoSourceRef,
    initialUrl: meta.videoUrl,
    autoResolve: false,
    processingStatus: syncedProcessingStatus ?? meta.processingStatus,
    onResolvedUrl: onResolvedVideoUrl,
    onProcessingStatusChange: handleRealtimeProcessingStatus,
  });
  const { url: thumbnailAssetUrl, refresh: refreshThumbnailAsset } = useMediaAsset({
    kind: "thumbnail",
    messageId: sparkMessageId,
    sourceRef: thumbnailSourceRef,
    initialUrl: meta.thumbnailUrl,
    autoResolve: false,
    onResolvedUrl: onResolvedThumbnailUrl,
  });

  const hasPrimary = !!(onReplyWithClip || onVoiceReply);
  const hasSecondary = !!(onSuggestDate || onReactionPick);
  const reactionSummary = compactReactionLabel(reactionPair ?? null);
  const replySpark =
    hasPlayed && !isMine && (hasPrimary || hasSecondary) && sparkMessageId
      ? replyPromptForContext(threadMessageCount, sparkMessageId)
      : null;

  const isIosSafari = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua);
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    return isIOS && isSafari;
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      statusSyncRunIdRef.current += 1;
      statusSyncInFlightRef.current = false;
    };
  }, []);

  useEffect(() => {
    playableVideoUrlRef.current = meta.videoUrl;
    playableThumbnailUrlRef.current = meta.thumbnailUrl ?? null;
    setPlayableVideoUrl(meta.videoUrl);
    setPlayableThumbnailUrl(meta.thumbnailUrl ?? null);
    setIsPlaying(false);
    setCurrentTime(0);
    setIsLoading(true);
    setIsReady(false);
    setPlayRequested(false);
    setHasMetadata(false);
    setLoadError(false);
    setSyncedProcessingStatus(null);
    setShowCaptions(initialCaptionPreference());
    setCaptionTrackUrl(null);
    setSyncAttemptCount(0);
    setIsSyncingStatus(false);
    playStartTracked.current = false;
    playCompleteTracked.current = false;
    playbackRefreshAttemptCountRef.current = 0;
    posterRefreshAttemptedForRef.current = null;
    readyRefreshKeyRef.current = null;
    statusSyncRunIdRef.current += 1;
    statusSyncInFlightRef.current = false;
  }, [meta.processingStatus, meta.thumbnailUrl, meta.videoUrl, sparkMessageId]);

  useEffect(() => {
    setShowReactBar(false);
  }, [meta.videoUrl]);

  useEffect(() => {
    if (!videoAssetUrl || videoAssetUrl === playableVideoUrlRef.current) return;
    playableVideoUrlRef.current = videoAssetUrl;
    setPlayableVideoUrl(videoAssetUrl);
  }, [videoAssetUrl]);

  useEffect(() => {
    const nextThumbnailUrl = thumbnailAssetUrl ?? null;
    if (!nextThumbnailUrl || nextThumbnailUrl === playableThumbnailUrlRef.current) return;
    playableThumbnailUrlRef.current = nextThumbnailUrl;
    setPlayableThumbnailUrl(nextThumbnailUrl);
  }, [thumbnailAssetUrl]);

  const processingStatus = syncedProcessingStatus ?? meta.processingStatus;
  const displayMeta = useMemo(
    () => ({
      ...meta,
      processingStatus,
      videoUrl: playableVideoUrl,
      thumbnailUrl: playableThumbnailUrl,
    }),
    [meta, playableThumbnailUrl, playableVideoUrl, processingStatus],
  );
  const isLocalPreview = isLocalPreviewUrl(displayMeta.videoUrl);
  const isRemotePlayableUrl = /^https?:\/\//i.test(displayMeta.videoUrl);
  const isHlsUrl = /\.m3u8(?:[?#]|$)/i.test(displayMeta.videoUrl);
  const canMountPlayer = isRemotePlayableUrl || isLocalPreview;
  const isServerProcessing = (processingStatus === "uploading" || processingStatus === "processing") && !isLocalPreview;
  const isAwaitingPlaybackIntent = !isServerProcessing && !canMountPlayer;
  const isSurfaceInteractive = !isServerProcessing;
  const canShowPosterImage =
    !!displayMeta.thumbnailUrl &&
    (isLocalPreviewUrl(displayMeta.thumbnailUrl) || /^https?:\/\//i.test(displayMeta.thumbnailUrl));
  const showPreparingOverlay = isServerProcessing || (!isReady && !isAwaitingPlaybackIntent && !isLocalPreview);
  const captionText = useMemo(() => captionTextFromMediaCaptions(displayMeta.captions), [displayMeta.captions]);
  const captionLanguage = useMemo(() => mediaCaptionLanguage(displayMeta.captions) ?? "und", [displayMeta.captions]);
  const videoPreload = useMediaVideoPreloadForVisibility(
    !immersiveActive && isViewportVisible && canMountPlayer && !isServerProcessing,
    displayMeta.videoUrl,
    undefined,
    prefersReducedMotion,
  );
  const shouldResolvePosterPreview =
    !isServerProcessing &&
    !!thumbnailSourceRef &&
    (!playableThumbnailUrl || isResolvableMediaRef(playableThumbnailUrl) || !canShowPosterImage);

  useEffect(() => {
    if (!isServerProcessing || !sparkMessageId) return;
    let cancelled = false;
    let terminalReached = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const syncStatus = async () => {
      if (statusSyncInFlightRef.current) return;
      const runId = statusSyncRunIdRef.current + 1;
      statusSyncRunIdRef.current = runId;
      statusSyncInFlightRef.current = true;
      setIsSyncingStatus(true);
      try {
        const status = await syncChatVibeClipStatus(sparkMessageId);
        if (!cancelled) {
          setSyncAttemptCount((count) => count + 1);
          if (status) {
            setSyncedProcessingStatus(status);
            if (status === "ready" || status === "failed") {
              terminalReached = true;
              if (timeoutId) clearTimeout(timeoutId);
            }
          }
        }
      } catch {
        if (!cancelled) setSyncAttemptCount((count) => count + 1);
      } finally {
        if (statusSyncRunIdRef.current === runId) {
          statusSyncInFlightRef.current = false;
          if (!cancelled) setIsSyncingStatus(false);
        }
      }
    };

    const scheduleNextSync = () => {
      if (cancelled || terminalReached) return;
      timeoutId = setTimeout(() => {
        void syncStatus().finally(scheduleNextSync);
      }, CHAT_VIBE_CLIP_STATUS_SYNC_SAFETY_NET_INTERVAL_MS);
    };

    void syncStatus().finally(scheduleNextSync);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isServerProcessing, sparkMessageId]);

  useEffect(() => {
    if (!isServerProcessing) {
      statusSyncRunIdRef.current += 1;
      statusSyncInFlightRef.current = false;
      setIsSyncingStatus(false);
    }
  }, [isServerProcessing]);

  const requestManualStatusSync = useCallback(async () => {
    if (!sparkMessageId || statusSyncInFlightRef.current) return;
    const runId = statusSyncRunIdRef.current + 1;
    statusSyncRunIdRef.current = runId;
    statusSyncInFlightRef.current = true;
    setIsSyncingStatus(true);
    try {
      const status = await syncChatVibeClipStatus(sparkMessageId);
      if (!isMountedRef.current) return;
      setSyncAttemptCount((count) => count + 1);
      if (status) setSyncedProcessingStatus(status);
    } catch {
      if (isMountedRef.current) setSyncAttemptCount((count) => count + 1);
    } finally {
      if (statusSyncRunIdRef.current === runId) {
        statusSyncInFlightRef.current = false;
        if (isMountedRef.current) setIsSyncingStatus(false);
      }
    }
  }, [sparkMessageId]);

  const refreshClipMedia = useCallback(async (reason: VibeClipMediaRefreshReason = "playback"): Promise<boolean> => {
    if (!sparkMessageId || (!videoSourceRef && !thumbnailSourceRef)) return false;
    const refreshOptions = reason === "manual" ? { bypassFailureCooldown: true } : undefined;
    if (reason === "playback") {
      if (!videoSourceRef) return false;
      if (playbackRefreshAttemptCountRef.current >= MAX_CLIP_PLAYBACK_REFRESH_ATTEMPTS) return false;
      playbackRefreshAttemptCountRef.current += 1;
    }
    const freshThumbnailUrl = thumbnailSourceRef
      ? await refreshThumbnailAsset(reason === "manual" ? "manual" : "preview", refreshOptions)
      : null;
    if (freshThumbnailUrl) {
      playableThumbnailUrlRef.current = freshThumbnailUrl;
      setPlayableThumbnailUrl(freshThumbnailUrl);
      onResolvedThumbnailUrl?.(freshThumbnailUrl);
    }
    if (reason === "preview") return !!freshThumbnailUrl;
    if (!videoSourceRef) return false;

    const freshVideoUrl = await refreshVideoAsset(reason, refreshOptions);
    if (!freshVideoUrl || freshVideoUrl === playableVideoUrl) return false;
    playableVideoUrlRef.current = freshVideoUrl;
    setPlayableVideoUrl(freshVideoUrl);
    onResolvedVideoUrl?.(freshVideoUrl);
    return true;
  }, [
    onResolvedThumbnailUrl,
    onResolvedVideoUrl,
    playableVideoUrl,
    refreshThumbnailAsset,
    refreshVideoAsset,
    sparkMessageId,
    thumbnailSourceRef,
    videoSourceRef,
  ]);

  useEffect(() => {
    if (processingStatus !== "ready" || syncedProcessingStatus !== "ready" || !sparkMessageId) return;
    if (!videoSourceRef && !thumbnailSourceRef) return;
    const refreshKey = `${sparkMessageId}:${videoSourceRef ?? ""}:${thumbnailSourceRef ?? ""}`;
    if (readyRefreshKeyRef.current === refreshKey) return;
    readyRefreshKeyRef.current = refreshKey;
    void refreshClipMedia("manual");
  }, [processingStatus, refreshClipMedia, sparkMessageId, syncedProcessingStatus, thumbnailSourceRef, videoSourceRef]);

  const requestImmersiveWithCurrentMedia = useCallback(() => {
    onRequestImmersive?.({
      videoUrl: playableVideoUrlRef.current,
      thumbnailUrl: playableThumbnailUrlRef.current,
    });
  }, [onRequestImmersive]);

  useEffect(() => {
    const posterResolveKey = thumbnailSourceRef ?? playableThumbnailUrl ?? "";
    if (
      !shouldResolvePosterPreview ||
      !posterResolveKey ||
      posterRefreshAttemptedForRef.current === posterResolveKey
    ) {
      return;
    }
    posterRefreshAttemptedForRef.current = posterResolveKey;
    void refreshClipMedia("preview");
  }, [playableThumbnailUrl, refreshClipMedia, shouldResolvePosterPreview, thumbnailSourceRef]);

  useEffect(() => {
    const vtt = mediaCaptionsToWebVtt(displayMeta.captions, displayMeta.durationMs);
    if (!vtt) {
      setCaptionTrackUrl(null);
      return;
    }
    const nextUrl = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
    setCaptionTrackUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [displayMeta.captions, displayMeta.durationMs]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    for (const track of Array.from(video.textTracks)) {
      track.mode = showCaptions ? "showing" : "disabled";
    }
  }, [captionTrackUrl, showCaptions]);

  const markReadyIfPossible = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const readyForFirstFrame = video.readyState >= 2 && video.videoWidth > 0;
    const readyEnoughForIosSafari = isIosSafari && video.readyState >= 1;
    if (readyForFirstFrame || readyEnoughForIosSafari) {
      setIsReady(true);
      setIsLoading(false);
    }
  }, [isIosSafari]);

  useEffect(() => {
    if (!isIosSafari || !hasMetadata || isReady || loadError) return;
    const t = setTimeout(() => {
      if (!videoRef.current) return;
      setIsReady(true);
      setIsLoading(false);
    }, 900);
    return () => clearTimeout(t);
  }, [hasMetadata, isIosSafari, isReady, loadError]);

  const handlePlaybackAttachError = useCallback(() => {
    void refreshClipMedia().then((didRefresh) => {
      if (!didRefresh) setLoadError(true);
    });
  }, [refreshClipMedia]);

  useMediaPlaybackQoE(videoRef, {
    enabled: canMountPlayer && !isServerProcessing,
    family: "vibe_clip",
    surface: "chat_vibe_clip_bubble",
    provider: displayMeta.provider ?? "bunny_stream",
    sourceRef: videoSourceRef ?? displayMeta.videoUrl,
    messageId: sparkMessageId ?? null,
    muted: isMuted,
    autoplay: false,
  });
  useMediaAssetPlayback(videoRef, displayMeta.videoUrl, {
    enabled: canMountPlayer && isHlsUrl,
    autoPlay: false,
    onManifestParsed: markReadyIfPossible,
    onError: handlePlaybackAttachError,
  });

  useEffect(() => {
    if (!playRequested || !isReady) return;
    const video = videoRef.current;
    if (!video) return;
    void video.play().then(() => {
      setIsPlaying(true);
      setHasPlayed(true);
    }).catch(() => {});
  }, [isReady, playRequested]);

  useEffect(() => {
    if (
      !playRequested ||
      isReady ||
      loadError ||
      isServerProcessing ||
      isLocalPreview ||
      isAwaitingPlaybackIntent
    ) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      void refreshClipMedia().then((didRefresh) => {
        if (!didRefresh) setLoadError(true);
      });
    }, CLIP_PLAYBACK_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [
    isAwaitingPlaybackIntent,
    isLocalPreview,
    isReady,
    isServerProcessing,
    loadError,
    playRequested,
    refreshClipMedia,
  ]);

  const togglePlay = useCallback(() => {
    if (isServerProcessing) return;
    const video = videoRef.current;
    if (!canMountPlayer) {
      setPlayRequested(true);
      setIsLoading(true);
      void refreshClipMedia("initial").then((didRefresh) => {
        if (!didRefresh) setLoadError(true);
      });
      return;
    }
    if (!video) return;
    if (video.paused) {
      setPlayRequested(true);
      video.play().then(() => {
        setIsPlaying(true);
        setHasPlayed(true);
        if (!playStartTracked.current) {
          playStartTracked.current = true;
          trackVibeClipEvent("clip_play_started", {
            thread_bucket: threadBucketFromCount(threadMessageCount),
            is_sender: isMine,
            duration_bucket: durationBucketFromSeconds(displayMeta.durationSec),
            has_poster: !!displayMeta.thumbnailUrl,
          });
        }
      }).catch((err: unknown) => {
        const name = err instanceof Error ? err.name : "";
        if (name === "AbortError" || name === "NotAllowedError" || name === "NotSupportedError") {
          void refreshClipMedia().then((didRefresh) => {
            if (!didRefresh) setLoadError(true);
          });
        }
      });
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }, [canMountPlayer, displayMeta.durationSec, displayMeta.thumbnailUrl, isMine, isServerProcessing, refreshClipMedia, threadMessageCount]);

  const toggleMute = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  }, []);

  const handleFullscreen = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isServerProcessing) return;
      if (onRequestImmersive) {
        if (!canMountPlayer) {
          void refreshClipMedia("initial").then((didRefresh) => {
            if (didRefresh) requestImmersiveWithCurrentMedia();
            else setLoadError(true);
          });
        } else {
          requestImmersiveWithCurrentMedia();
        }
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      if (video.requestFullscreen) {
        video.requestFullscreen();
      } else {
        const webkitVideo = video as VideoElementWithWebkitFullscreen;
        webkitVideo.webkitEnterFullscreen?.();
      }
    },
    [canMountPlayer, isServerProcessing, onRequestImmersive, refreshClipMedia, requestImmersiveWithCurrentMedia],
  );

  useEffect(() => {
    if (immersiveActive || !isViewportVisible) {
      videoRef.current?.pause();
      setIsPlaying(false);
    }
  }, [immersiveActive, isViewportVisible]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsViewportVisible(entry.isIntersecting),
      { threshold: 0.01 },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const onVideoSurfaceClick = useCallback(() => {
    if (isServerProcessing) return;
    if (onRequestImmersive) {
      if (!canMountPlayer) {
        void refreshClipMedia("initial").then((didRefresh) => {
          if (didRefresh) requestImmersiveWithCurrentMedia();
          else setLoadError(true);
        });
      } else {
        requestImmersiveWithCurrentMedia();
      }
      return;
    }
    togglePlay();
  }, [canMountPlayer, isServerProcessing, onRequestImmersive, refreshClipMedia, requestImmersiveWithCurrentMedia, togglePlay]);

  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
  }, []);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    if (!playCompleteTracked.current) {
      playCompleteTracked.current = true;
      trackVibeClipEvent("clip_play_completed", {
        thread_bucket: threadBucketFromCount(threadMessageCount),
        is_sender: isMine,
        duration_bucket: durationBucketFromSeconds(displayMeta.durationSec),
        has_poster: !!displayMeta.thumbnailUrl,
      });
    }
  }, [displayMeta.durationSec, displayMeta.thumbnailUrl, isMine, threadMessageCount]);

  const toggleCaptions = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    setShowCaptions((visible) => {
      const next = !visible;
      try {
        window.localStorage.setItem(VIBE_CLIP_CAPTIONS_PREF_KEY, next ? "1" : "0");
      } catch {
        // Caption visibility preference is best-effort.
      }
      trackVibeClipEvent("caption_toggle_changed", {
        enabled: next,
        surface: "chat_vibe_clip_bubble",
        is_sender: isMine,
      });
      return next;
    });
  }, [isMine]);

  const progress = displayMeta.durationSec > 0 ? (currentTime / displayMeta.durationSec) * 100 : 0;
  const isBuffering = isReady && isLoading && isPlaying;
  const isProcessingFailed = processingStatus === "failed";
  const clipAspectRatio =
    typeof displayMeta.aspectRatio === "number" && Number.isFinite(displayMeta.aspectRatio) && displayMeta.aspectRatio > 0
      ? Math.max(0.5, Math.min(1.2, displayMeta.aspectRatio))
      : 9 / 16;
  const hasLocalRecoveryAction = Boolean(localRecovery?.canResume || localRecovery?.canDiscard || localRecovery?.error);
  const showServerProcessingNudge = isMine && isServerProcessing && syncAttemptCount > 0 && !hasLocalRecoveryAction;
  const showRecoveryPanel = isMine && (hasLocalRecoveryAction || showServerProcessingNudge);

  if (loadError || isProcessingFailed) {
    return (
      <div
      className={cn(
        CLIP_BUBBLE_WIDTH_CLASS,
        "rounded-xl overflow-hidden border border-violet-500/25 bg-gradient-to-b from-secondary/25 to-black/50 flex flex-col items-center justify-center py-5 px-3 gap-2 shadow-inner shadow-black/40",
      )}
      data-testid="vibe-clip-bubble"
      data-processing-status={processingStatus}
    >
        <AlertCircle className="w-7 h-7 text-violet-400/90" />
        <span className="text-[11px] text-muted-foreground text-center leading-snug">Clip unavailable</span>
        {loadError ? (
          <button
            type="button"
            onClick={() => {
              playbackRefreshAttemptCountRef.current = 0;
              setLoadError(false);
              setIsLoading(true);
              setIsReady(false);
              setIsPlaying(false);
              setCurrentTime(0);
              void refreshClipMedia("manual").then((didRefresh) => {
                if (!didRefresh) videoRef.current?.load();
              });
            }}
            className="text-[11px] font-semibold text-violet-400 hover:text-violet-300 underline-offset-2 hover:underline"
          >
            Try again
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        CLIP_BUBBLE_WIDTH_CLASS,
        "rounded-xl overflow-hidden relative group transition-opacity duration-200",
        isMine
          ? "ring-1 ring-violet-500/35 bg-violet-500/[0.04]"
          : "ring-1 ring-white/[0.08] bg-white/[0.025]",
        threadVisualRecede && "opacity-[0.9] ring-violet-500/20 saturate-[0.92]",
      )}
      data-testid="vibe-clip-bubble"
      data-processing-status={processingStatus}
    >
      {/* Video surface */}
      <div
        className="cursor-pointer"
        onClick={onVideoSurfaceClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onVideoSurfaceClick();
          }
        }}
        role={isSurfaceInteractive ? "button" : undefined}
        tabIndex={isSurfaceInteractive ? 0 : undefined}
        aria-label={isSurfaceInteractive ? (onRequestImmersive ? "Open clip" : isPlaying ? "Pause clip" : "Play clip") : undefined}
      >
        <AspectRatio ratio={clipAspectRatio}>
          {isAwaitingPlaybackIntent ? (
            <div className="absolute inset-0 bg-black">
              {canShowPosterImage ? (
                <img
                  src={displayMeta.thumbnailUrl ?? undefined}
                  alt=""
                  className="h-full w-full object-cover"
                  draggable={false}
                  onError={() => {
                    void refreshClipMedia("preview");
                  }}
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-white/[0.04] via-transparent to-violet-400/[0.08]" />
              )}
            </div>
          ) : null}

          {showPreparingOverlay && (
            <div className="absolute inset-0 bg-black">
              <div className="absolute inset-0 bg-gradient-to-br from-white/5 via-white/0 to-white/10" />
              <motion.div
                aria-hidden
                className="absolute inset-0"
                initial={prefersReducedMotion ? false : { x: "-120%" }}
                animate={prefersReducedMotion ? false : { x: "120%" }}
                transition={prefersReducedMotion ? undefined : { duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                style={{
                  background:
                    "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0) 100%)",
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex items-center gap-2 rounded-full border border-violet-400/20 bg-black/55 px-3.5 py-2 backdrop-blur-md shadow-[0_0_28px_rgba(139,92,246,0.15)]">
                  <Loader2 className={cn("h-4 w-4 text-violet-300/95", !prefersReducedMotion && "animate-spin")} />
                  <span className="text-[11px] font-medium text-white/88 tracking-tight">
                    {isServerProcessing ? "Preparing clip…" : "Preparing playback…"}
                  </span>
                </div>
              </div>
              <div className="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-black/60 to-transparent">
                <span className="text-[10px] text-white/70 font-mono">{displayMeta.durationLabel}</span>
              </div>
            </div>
          )}

          {!isServerProcessing && canMountPlayer ? (
            <video
              ref={videoRef}
              src={isHlsUrl ? undefined : displayMeta.videoUrl}
              poster={displayMeta.thumbnailUrl ?? undefined}
              playsInline
              muted={isMuted}
              preload={videoPreload}
              onLoadStart={() => setIsLoading(true)}
              onLoadedMetadata={() => {
                setHasMetadata(true);
                markReadyIfPossible();
              }}
              onLoadedData={markReadyIfPossible}
              onCanPlay={markReadyIfPossible}
              onPlaying={() => setIsLoading(false)}
              onWaiting={() => setIsLoading(true)}
              onError={() => {
                setIsLoading(false);
                void refreshClipMedia().then((didRefresh) => {
                  if (!didRefresh) setLoadError(true);
                });
              }}
              onTimeUpdate={handleTimeUpdate}
              onEnded={handleEnded}
              className={[
                "w-full h-full object-cover bg-black transition-opacity duration-300",
                isReady || isLocalPreview ? "opacity-100" : "opacity-0",
              ].join(" ")}
            >
              {captionTrackUrl ? (
                <track kind="subtitles" src={captionTrackUrl} srcLang={captionLanguage} label="Captions" default={showCaptions} />
              ) : null}
            </video>
          ) : null}

          {captionText && showCaptions && !isServerProcessing ? (
            <div className="pointer-events-none absolute inset-x-3 bottom-10 z-[6] rounded-md bg-black/62 px-2.5 py-1.5 text-center text-[11px] font-medium leading-snug text-white shadow-lg">
              {captionText}
            </div>
          ) : null}

          {/* Play overlay */}
          {isBuffering ? (
            <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center bg-black/30">
              <div className="flex items-center gap-2 rounded-full border border-violet-400/20 bg-black/50 px-3 py-1.5 backdrop-blur-sm">
                <Loader2 className={cn("h-3.5 w-3.5 text-violet-300/90", !prefersReducedMotion && "animate-spin")} />
                <span className="text-[10px] font-medium text-white/85">Buffering…</span>
              </div>
            </div>
          ) : null}

          {!isPlaying && !isServerProcessing && (isReady || isAwaitingPlaybackIntent) && (
            <motion.div
              initial={prefersReducedMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
              className="absolute inset-0 flex items-center justify-center bg-black/38"
            >
              <div className="w-11 h-11 rounded-full bg-gradient-to-br from-violet-500/40 to-violet-600/20 backdrop-blur-md flex items-center justify-center ring-1 ring-violet-300/35 shadow-lg shadow-violet-500/20">
                <Play className="w-5 h-5 text-white ml-0.5 drop-shadow-md" fill="white" />
              </div>
            </motion.div>
          )}

          {/* Bottom controls */}
          <div className="absolute bottom-0 inset-x-0 px-2 pt-2 pb-1.5 bg-gradient-to-t from-black/70 via-black/35 to-transparent">
            <div className="w-full h-1 rounded-full bg-white/12 overflow-hidden mb-1.5 ring-1 ring-violet-400/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-violet-400 via-fuchsia-400 to-pink-400 transition-[width] duration-150 ease-out shadow-[0_0_10px_rgba(167,139,250,0.4)]"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex items-center justify-between gap-1">
              <span className="text-[9px] text-white/82 font-mono tabular-nums font-medium">
                {isPlaying && displayMeta.durationSec > 0
                  ? `${formatDuration(Math.round(currentTime))} · ${formatDuration(displayMeta.durationSec)}`
                  : displayMeta.durationLabel}
              </span>
              <div className="flex items-center gap-0.5">
                {canMountPlayer ? (
                  <button
                    type="button"
                    onClick={toggleMute}
                    aria-label={isMuted ? "Unmute clip" : "Mute clip"}
                    className="rounded-md border border-white/10 bg-black/30 p-1 text-white/75 hover:bg-white/10 hover:text-white transition-colors"
                  >
                    {isMuted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                  </button>
                ) : null}
                {captionText ? (
                  <button
                    type="button"
                    onClick={toggleCaptions}
                    aria-label={showCaptions ? "Hide captions" : "Show captions"}
                    className="rounded-md border border-white/10 bg-black/30 p-1 text-white/75 hover:bg-white/10 hover:text-white transition-colors"
                  >
                    <Captions className="w-3 h-3" />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={handleFullscreen}
                  aria-label="Open clip full screen"
                  className="rounded-md border border-white/10 bg-black/30 p-1 text-white/75 hover:bg-white/10 hover:text-white transition-colors"
                >
                  <Maximize className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>
        </AspectRatio>
      </div>

      {showRecoveryPanel ? (
        <div
          className="border-t border-violet-500/15 bg-black/18 px-2.5 py-2"
          data-testid="vibe-clip-recovery-panel"
        >
          <p className="text-[10px] leading-snug text-white/70">
            {localRecovery?.error
              ? localRecovery.error
              : localRecovery?.stateLabel
                ? localRecovery.stateLabel
                : isServerProcessing
                  ? "Processing - usually about 30 s."
                  : "Still preparing this clip."}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {localRecovery?.canResume && localRecovery.onResume ? (
              <button
                type="button"
                onClick={localRecovery.onResume}
                className="rounded-full border border-violet-400/35 bg-violet-500/16 px-2.5 py-1 text-[10px] font-semibold text-violet-100 hover:bg-violet-500/24"
                data-testid="vibe-clip-resume-upload"
              >
                Resume upload
              </button>
            ) : null}
            {localRecovery?.canDiscard && localRecovery.onDiscardAndSendAgain ? (
              <button
                type="button"
                onClick={localRecovery.onDiscardAndSendAgain}
                className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold text-white/72 hover:bg-white/[0.08]"
                data-testid="vibe-clip-discard-send-again"
              >
                Discard + send again
              </button>
            ) : null}
            {showServerProcessingNudge ? (
              <button
                type="button"
                onClick={() => void requestManualStatusSync()}
                disabled={isSyncingStatus}
                className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold text-white/72 hover:bg-white/[0.08] disabled:pointer-events-none disabled:opacity-55"
                data-testid="vibe-clip-check-status"
              >
                {isSyncingStatus ? "Checking..." : "Check again"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* After-play: primary (reply) + secondary (date / react) — received clips only */}
      {hasPlayed && !isMine && (hasPrimary || hasSecondary) && (
        <div className="border-t border-violet-500/15">
          {replySpark ? (
            <p className="text-[10px] leading-snug text-muted-foreground/90 px-2.5 pt-2 pb-0.5">
              {replySpark}
            </p>
          ) : null}
          {hasPrimary && (
            <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-2">
              {onReplyWithClip && (
                <button
                  type="button"
                  onClick={() => {
                    trackVibeClipEvent("clip_reply_with_clip_clicked", {
                      thread_bucket: threadBucketFromCount(threadMessageCount),
                      is_receiver: true,
                    });
                    trackVibeClipEvent("clip_entry_opened", {
                      thread_bucket: threadBucketFromCount(threadMessageCount),
                      is_sender: true,
                      launched_from: "clip_context",
                    });
                    onReplyWithClip();
                  }}
                  className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 border border-violet-500/20 px-2.5 py-1 text-[10px] font-semibold text-violet-400 hover:bg-violet-500/20 transition-colors"
                >
                  <Film className="w-3 h-3" />
                  Reply with clip
                </button>
              )}
              {onVoiceReply && (
                <button
                  type="button"
                  onClick={() => {
                    trackVibeClipEvent("clip_voice_reply_clicked", {
                      thread_bucket: threadBucketFromCount(threadMessageCount),
                      is_receiver: true,
                    });
                    onVoiceReply();
                  }}
                  className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 border border-violet-500/20 px-2.5 py-1 text-[10px] font-semibold text-violet-400 hover:bg-violet-500/20 transition-colors"
                >
                  <Mic className="w-3 h-3" />
                  Voice reply
                </button>
              )}
            </div>
          )}
          {hasSecondary && (
            <div className="relative border-t border-violet-500/10 px-2.5 pb-2 pt-1.5 flex flex-wrap items-end gap-x-3 gap-y-2 w-full min-w-0">
              {onSuggestDate && (
                <div className="flex flex-col gap-0.5 min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      trackVibeClipEvent("clip_date_cta_clicked", {
                        thread_bucket: threadBucketFromCount(threadMessageCount),
                        is_receiver: true,
                        launched_from: "clip_context",
                      });
                      onSuggestDate();
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/35 bg-rose-500/12 px-2.5 py-1.5 text-[10px] font-semibold text-rose-100/95 shadow-sm hover:bg-rose-500/20 transition-colors text-left"
                  >
                    <CalendarPlus className="w-3.5 h-3.5 shrink-0 text-rose-300" />
                    Suggest a date
                  </button>
                  <span className="text-[9px] text-muted-foreground/85 leading-tight pl-0.5 max-w-[11rem]">
                    {CLIP_DATE_ACTION_HINT}
                  </span>
                </div>
              )}
              {onReactionPick && (
                <button
                  type="button"
                  onClick={() => {
                    trackVibeClipEvent("clip_react_clicked", {
                      thread_bucket: threadBucketFromCount(threadMessageCount),
                      is_receiver: true,
                    });
                    setShowReactBar(true);
                  }}
                  className="inline-flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground/90 hover:text-foreground/90 transition-colors pb-0.5"
                >
                  <Heart className="w-3 h-3 shrink-0 opacity-75" />
                  React
                </button>
              )}
              <AnimatePresence>
                {showReactBar && onReactionPick ? (
                  <EmojiBar
                    position="left"
                    onClose={() => setShowReactBar(false)}
                    onSelect={(emoji) => {
                      onReactionPick(emoji);
                      setShowReactBar(false);
                    }}
                  />
                ) : null}
              </AnimatePresence>
              {reactionSummary ? (
                <span className="ml-auto text-[11px] leading-none text-muted-foreground tabular-nums shrink-0">
                  {reactionSummary}
                </span>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

function formatDuration(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
