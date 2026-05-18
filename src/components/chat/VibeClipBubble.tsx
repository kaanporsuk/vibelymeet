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
import { cn } from "@/lib/utils";
import {
  refreshCachedChatMediaUrl,
  syncChatVibeClipStatus,
  type ChatVibeClipProcessingStatus,
} from "@/lib/chatMediaResolver";
import { attachHlsPlayback } from "@/lib/vibeVideo/attachHlsPlayback";

type VideoElementWithWebkitFullscreen = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
};
type VibeClipMediaRefreshReason = "preview" | "playback";

const CLIP_BUBBLE_WIDTH_CLASS = "w-[min(17.5rem,calc(100vw-4rem))] max-w-full";
const CHAT_VIBE_CLIP_STATUS_SYNC_DELAY_MS = 2500;
const CHAT_VIBE_CLIP_STATUS_SYNC_INTERVAL_MS = 12_000;
const CLIP_PLAYBACK_LOAD_TIMEOUT_MS = 12_000;

function isLocalPreviewUrl(value: string): boolean {
  return value.startsWith("blob:") || value.startsWith("file:") || value.startsWith("data:");
}

function isResolvableMediaRef(value: string | null | undefined): boolean {
  return !!value && !isLocalPreviewUrl(value) && !/^https?:\/\//i.test(value);
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
  onRequestImmersive?: () => void;
  /** Pause inline preview while immersive viewer is open for this clip URL. */
  immersiveActive?: boolean;
  videoSourceRef?: string | null;
  thumbnailSourceRef?: string | null;
  onResolvedVideoUrl?: (url: string) => void;
  onResolvedThumbnailUrl?: (url: string) => void;
  /** Older clips in the thread sit visually quieter than the latest. */
  threadVisualRecede?: boolean;
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
}: VibeClipBubbleProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
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
  const playStartTracked = useRef(false);
  const playCompleteTracked = useRef(false);
  const refreshAttemptedForUrlRef = useRef<string | null>(null);
  const posterRefreshAttemptedForRef = useRef<string | null>(null);

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
    playStartTracked.current = false;
    playCompleteTracked.current = false;
    refreshAttemptedForUrlRef.current = null;
    posterRefreshAttemptedForRef.current = null;
  }, [meta.processingStatus, meta.thumbnailUrl, meta.videoUrl]);

  useEffect(() => {
    setShowReactBar(false);
  }, [meta.videoUrl]);

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
  const shouldResolvePosterPreview =
    !isServerProcessing &&
    !!thumbnailSourceRef &&
    (!playableThumbnailUrl || isResolvableMediaRef(playableThumbnailUrl) || !canShowPosterImage);

  useEffect(() => {
    if (!isServerProcessing || !sparkMessageId) return;
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | undefined;

    const syncStatus = async () => {
      const status = await syncChatVibeClipStatus(sparkMessageId);
      if (cancelled || !status) return;
      setSyncedProcessingStatus(status);
      if (status === "ready" || status === "failed") {
        if (intervalId) clearInterval(intervalId);
      }
    };

    const timeoutId = setTimeout(() => {
      void syncStatus();
      intervalId = setInterval(() => {
        void syncStatus();
      }, CHAT_VIBE_CLIP_STATUS_SYNC_INTERVAL_MS);
    }, CHAT_VIBE_CLIP_STATUS_SYNC_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [isServerProcessing, sparkMessageId]);

  const refreshClipMedia = useCallback(async (reason: VibeClipMediaRefreshReason = "playback"): Promise<boolean> => {
    if (!sparkMessageId || (!videoSourceRef && !thumbnailSourceRef)) return false;
    const freshThumbnailUrl = thumbnailSourceRef
      ? await refreshCachedChatMediaUrl(sparkMessageId, "thumbnail", thumbnailSourceRef)
      : null;
    if (freshThumbnailUrl) {
      setPlayableThumbnailUrl(freshThumbnailUrl);
      onResolvedThumbnailUrl?.(freshThumbnailUrl);
    }
    if (reason === "preview") return !!freshThumbnailUrl;
    if (!videoSourceRef || refreshAttemptedForUrlRef.current === playableVideoUrl) return false;

    const freshVideoUrl = await refreshCachedChatMediaUrl(sparkMessageId, "vibe_clip", videoSourceRef);
    if (!freshVideoUrl || freshVideoUrl === playableVideoUrl) return false;
    refreshAttemptedForUrlRef.current = playableVideoUrl;
    setPlayableVideoUrl(freshVideoUrl);
    onResolvedVideoUrl?.(freshVideoUrl);
    return true;
  }, [onResolvedThumbnailUrl, onResolvedVideoUrl, playableVideoUrl, sparkMessageId, thumbnailSourceRef, videoSourceRef]);

  useEffect(() => {
    const posterResolveKey = thumbnailSourceRef ?? playableThumbnailUrl ?? "";
    if (
      !shouldResolvePosterPreview ||
      !posterResolveKey ||
      posterRefreshAttemptedForRef.current === posterResolveKey
    ) {
      return;
    }
    let cancelled = false;
    posterRefreshAttemptedForRef.current = posterResolveKey;
    void refreshClipMedia("preview").then((didRefresh) => {
      if (cancelled) return;
      if (didRefresh) posterRefreshAttemptedForRef.current = null;
    });
    return () => {
      cancelled = true;
    };
  }, [playableThumbnailUrl, refreshClipMedia, shouldResolvePosterPreview, thumbnailSourceRef]);

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

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !canMountPlayer) return;
    if (!isHlsUrl) return;
    return attachHlsPlayback(video, displayMeta.videoUrl, {
      autoPlay: false,
      onManifestParsed: markReadyIfPossible,
      onError: () => {
        void refreshClipMedia().then((didRefresh) => {
          if (!didRefresh) setLoadError(true);
        });
      },
    });
  }, [canMountPlayer, displayMeta.videoUrl, isHlsUrl, markReadyIfPossible, refreshClipMedia]);

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
      void refreshClipMedia().then((didRefresh) => {
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
          void refreshClipMedia().then((didRefresh) => {
            if (didRefresh) onRequestImmersive();
            else setLoadError(true);
          });
        } else {
          onRequestImmersive();
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
    [canMountPlayer, isServerProcessing, onRequestImmersive, refreshClipMedia],
  );

  useEffect(() => {
    if (immersiveActive) {
      videoRef.current?.pause();
      setIsPlaying(false);
    }
  }, [immersiveActive]);

  const onVideoSurfaceClick = useCallback(() => {
    if (isServerProcessing) return;
    if (onRequestImmersive) {
      if (!canMountPlayer) {
        void refreshClipMedia().then((didRefresh) => {
          if (didRefresh) onRequestImmersive();
          else setLoadError(true);
        });
      } else {
        onRequestImmersive();
      }
      return;
    }
    togglePlay();
  }, [canMountPlayer, isServerProcessing, onRequestImmersive, refreshClipMedia, togglePlay]);

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

  const progress = displayMeta.durationSec > 0 ? (currentTime / displayMeta.durationSec) * 100 : 0;
  const isBuffering = isReady && isLoading && isPlaying;
  const isProcessingFailed = processingStatus === "failed";
  const clipAspectRatio =
    typeof displayMeta.aspectRatio === "number" && Number.isFinite(displayMeta.aspectRatio) && displayMeta.aspectRatio > 0
      ? Math.max(0.5, Math.min(1.2, displayMeta.aspectRatio))
      : 9 / 16;

  if (loadError || isProcessingFailed) {
    return (
      <div
        className={cn(
          CLIP_BUBBLE_WIDTH_CLASS,
          "rounded-xl overflow-hidden border border-violet-500/25 bg-gradient-to-b from-secondary/25 to-black/50 flex flex-col items-center justify-center py-5 px-3 gap-2 shadow-inner shadow-black/40",
        )}
      >
        <AlertCircle className="w-7 h-7 text-violet-400/90" />
        <span className="text-[11px] text-muted-foreground text-center leading-snug">Clip unavailable</span>
        {loadError ? (
          <button
            type="button"
            onClick={() => {
              refreshAttemptedForUrlRef.current = null;
              setLoadError(false);
              setIsLoading(true);
              setIsReady(false);
              setIsPlaying(false);
              setCurrentTime(0);
              void refreshClipMedia().then((didRefresh) => {
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
      className={cn(
        CLIP_BUBBLE_WIDTH_CLASS,
        "rounded-xl overflow-hidden relative group transition-opacity duration-200",
        isMine
          ? "ring-1 ring-violet-500/35 bg-violet-500/[0.04]"
          : "ring-1 ring-white/[0.08] bg-white/[0.025]",
        threadVisualRecede && "opacity-[0.9] ring-violet-500/20 saturate-[0.92]",
      )}
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
                initial={{ x: "-120%" }}
                animate={{ x: "120%" }}
                transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                style={{
                  background:
                    "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0) 100%)",
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex items-center gap-2 rounded-full border border-violet-400/20 bg-black/55 px-3.5 py-2 backdrop-blur-md shadow-[0_0_28px_rgba(139,92,246,0.15)]">
                  <Loader2 className="h-4 w-4 animate-spin text-violet-300/95" />
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
              preload="metadata"
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
            />
          ) : null}

          {/* Play overlay */}
          {isBuffering ? (
            <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center bg-black/30">
              <div className="flex items-center gap-2 rounded-full border border-violet-400/20 bg-black/50 px-3 py-1.5 backdrop-blur-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-300/90" />
                <span className="text-[10px] font-medium text-white/85">Buffering…</span>
              </div>
            </div>
          ) : null}

          {!isPlaying && !isServerProcessing && (isReady || isAwaitingPlaybackIntent) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
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
