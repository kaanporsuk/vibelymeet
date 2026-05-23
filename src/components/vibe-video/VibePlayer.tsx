import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Captions, Volume2, VolumeX, Pencil, Play, Loader2 } from "lucide-react";
import * as Sentry from "@sentry/react";
import { cn } from "@/lib/utils";
import { useMediaAsset, useMediaAssetPlayback } from "@/hooks/useMediaAsset";
import { useMediaPlaybackQoE } from "@/hooks/useMediaPlaybackQoE";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useMediaVideoPreloadForVisibility } from "@/hooks/useMediaVideoPreloadPolicy";
import { isHlsMediaAssetUrl, isProfileVibeVideoRef, prewarmMediaAssets } from "@/lib/mediaAssetResolver";
import { MediaPlaceholder } from "@/components/media/MediaPlaceholder";
import { trackVibeVideoEvent, VIBE_VIDEO_EVENTS } from "@/lib/vibeVideo/vibeVideoTelemetry";
import {
  captionTextFromMediaCaptions,
  mediaCaptionLanguage,
  mediaCaptionsToWebVtt,
  type MediaCaptions,
} from "../../../shared/media/captions";

// IntersectionObserver-based iOS hardware decoder management
const MAX_HLS_AUTH_REFRESH_ATTEMPTS = 2;

interface VibePlayerProps {
  videoUrl: string;
  thumbnailUrl?: string;
  vibeCaption?: string;
  captions?: MediaCaptions | null;
  autoPlay?: boolean;
  showControls?: boolean;
  isOwner?: boolean;
  onUpdateClick?: () => void;
  className?: string;
  overlayClassName?: string;
  /** When true, playback errors show copy that backend marked the asset ready (CDN/player issue). */
  backendReportsReady?: boolean;
  onPlaybackRequest?: () => void;
  onFirstFrame?: () => void;
}

export const VibePlayer = ({
  videoUrl,
  thumbnailUrl,
  vibeCaption,
  captions = null,
  autoPlay = true,
  showControls = true,
  isOwner = false,
  onUpdateClick,
  className,
  overlayClassName,
  backendReportsReady = false,
  onPlaybackRequest,
  onFirstFrame,
}: VibePlayerProps) => {
  const [isMuted, setIsMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [shouldLoad, setShouldLoad] = useState(true);
  const [manualPlaybackRequested, setManualPlaybackRequested] = useState(false);
  const [showCaptions, setShowCaptions] = useState(true);
  const [captionTrackUrl, setCaptionTrackUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const manualPlayPendingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const playbackAttemptedRef = useRef(false);
  const playbackSucceededRef = useRef(false);
  const firstFrameReportedRef = useRef(false);
  const hlsAuthRefreshAttemptCountRef = useRef(0);
  const prefersReducedMotion = usePrefersReducedMotion();
  const usesSignedProfileRef = isProfileVibeVideoRef(videoUrl);
  const {
    url: mediaAssetUrl,
    posterUrl: mediaAssetPosterUrl,
    placeholderKind,
    placeholderHash,
    dominantColor,
    status: mediaAssetStatus,
    refresh: refreshMediaAsset,
  } = useMediaAsset({
    kind: usesSignedProfileRef ? "profile_vibe_video" : "vibe_video",
    sourceRef: videoUrl,
    initialUrl: usesSignedProfileRef ? null : videoUrl,
    autoResolve: usesSignedProfileRef,
  });
  const playbackUrl = mediaAssetUrl ?? (usesSignedProfileRef ? null : videoUrl);
  const isHlsPlaybackUrl = playbackUrl ? isHlsMediaAssetUrl(playbackUrl) : false;
  const posterUrl = mediaAssetPosterUrl ?? thumbnailUrl;
  const effectiveAutoPlay = autoPlay && !prefersReducedMotion;
  const shouldAttachPlayback = shouldLoad && !!playbackUrl && (!prefersReducedMotion || manualPlaybackRequested);
  const videoPreload = useMediaVideoPreloadForVisibility(shouldLoad, playbackUrl, undefined, prefersReducedMotion);
  const captionText = useMemo(() => captionTextFromMediaCaptions(captions), [captions]);
  const captionLanguage = useMemo(() => mediaCaptionLanguage(captions) ?? "und", [captions]);

  useEffect(() => {
    if (!shouldLoad || prefersReducedMotion || !videoUrl) return;
    if (!usesSignedProfileRef && !isHlsMediaAssetUrl(videoUrl)) return;
    void prewarmMediaAssets(
      [{
        kind: usesSignedProfileRef ? "profile_vibe_video" : "video",
        sourceRef: videoUrl,
      }],
      { concurrency: 1 },
    ).catch(() => {});
  }, [prefersReducedMotion, shouldLoad, usesSignedProfileRef, videoUrl]);

  useEffect(() => {
    const vtt = mediaCaptionsToWebVtt(captions, 15_000);
    if (!vtt) {
      setCaptionTrackUrl(null);
      return;
    }
    const blobUrl = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
    setCaptionTrackUrl(blobUrl);
    return () => URL.revokeObjectURL(blobUrl);
  }, [captions]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    for (const track of Array.from(video.textTracks)) {
      track.mode = showCaptions ? "showing" : "disabled";
    }
  }, [captionTrackUrl, showCaptions]);

  // Reset state when videoUrl changes
  useEffect(() => {
    setIsLoaded(false);
    setHasError(false);
    setIsLoading(true);
    setIsPlaying(false);
    setManualPlaybackRequested(false);
    manualPlayPendingRef.current = false;
    playbackAttemptedRef.current = false;
    playbackSucceededRef.current = false;
    firstFrameReportedRef.current = false;
    hlsAuthRefreshAttemptCountRef.current = 0;
  }, [videoUrl]);

  // iOS Safari has a hard limit on ~4 simultaneous buffering <video> elements.
  // Use React state to control src prop — avoids fighting React reconciliation.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldLoad(true);
        } else {
          setShouldLoad(false);
          if (videoRef.current) {
            videoRef.current.pause();
            setIsPlaying(false);
          }
        }
      },
      { threshold: 0 }
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const attemptPlay = useCallback(() => {
    if (videoRef.current && isLoaded && !hasError) {
      if (!playbackAttemptedRef.current) {
        playbackAttemptedRef.current = true;
        trackVibeVideoEvent(VIBE_VIDEO_EVENTS.playbackAttempted, {
          source: "vibe_player_inline",
          autoplay: effectiveAutoPlay,
          backend_reports_ready: backendReportsReady,
        });
      }
      videoRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch(() => {
        setIsPlaying(false);
      });
    }
  }, [isLoaded, hasError, backendReportsReady, effectiveAutoPlay]);

  useEffect(() => {
    if (effectiveAutoPlay && isLoaded && shouldLoad) {
      attemptPlay();
    }
  }, [effectiveAutoPlay, isLoaded, shouldLoad, attemptPlay]);

  useEffect(() => {
    if (!manualPlayPendingRef.current || !isLoaded || hasError) return;
    manualPlayPendingRef.current = false;
    attemptPlay();
  }, [attemptPlay, hasError, isLoaded]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
    }
  }, [isMuted]);

  const reportPlaybackError = useCallback((kind: string = "element") => {
    setHasError(true);
    setIsLoading(false);
    trackVibeVideoEvent(VIBE_VIDEO_EVENTS.playbackFailed, {
      source: "vibe_player_inline",
      kind,
      backend_reports_ready: backendReportsReady,
    });
    Sentry.addBreadcrumb({
      category: "vibe-video-playback",
      message: backendReportsReady ? "inline_player_error_backend_ready" : "inline_player_error",
      level: "error",
      data: { surface: "vibe_player", kind },
    });
  }, [backendReportsReady]);
  const handlePlaybackAttachError = useCallback((kind: "native" | "unsupported" | "fatal", detail?: unknown) => {
    reportPlaybackError(kind);
    if (detail && typeof window !== "undefined" && window.localStorage.getItem("__vibely_diag") === "1") {
      console.warn("[VibeVideo] inline hls playback error", detail);
    }
  }, [reportPlaybackError]);
  const refreshPlaybackOnAuthError = useCallback(async () => {
    if (!usesSignedProfileRef) return null;
    if (hlsAuthRefreshAttemptCountRef.current >= MAX_HLS_AUTH_REFRESH_ATTEMPTS) return null;
    hlsAuthRefreshAttemptCountRef.current += 1;
    const attempt = hlsAuthRefreshAttemptCountRef.current;
    try {
      const freshUrl = await refreshMediaAsset("playback", { bypassFailureCooldown: true });
      trackVibeVideoEvent(VIBE_VIDEO_EVENTS.tokenRefreshOnAuthError, {
        source: "vibe_player_inline",
        attempt,
        outcome: freshUrl ? "refreshed" : "unavailable",
      });
      return freshUrl;
    } catch {
      trackVibeVideoEvent(VIBE_VIDEO_EVENTS.tokenRefreshOnAuthError, {
        source: "vibe_player_inline",
        attempt,
        outcome: "failed",
      });
      return null;
    }
  }, [refreshMediaAsset, usesSignedProfileRef]);

  const reportFirstFrame = useCallback(() => {
    if (firstFrameReportedRef.current) return;
    firstFrameReportedRef.current = true;
    onFirstFrame?.();
  }, [onFirstFrame]);

  useEffect(() => {
    if (usesSignedProfileRef && mediaAssetStatus === "error") {
      reportPlaybackError("signed_url_resolve_failed");
    }
  }, [mediaAssetStatus, reportPlaybackError, usesSignedProfileRef]);

  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !shouldLoad || !playbackUrl) return;

    setIsLoaded(false);
    setIsLoading(true);
  }, [playbackUrl, shouldLoad]);

  useMediaPlaybackQoE(videoRef, {
    enabled: shouldAttachPlayback,
    family: usesSignedProfileRef ? "profile_vibe_video" : "vibe_video",
    surface: "vibe_player_inline",
    provider: usesSignedProfileRef ? "bunny_stream" : "remote",
    sourceRef: videoUrl,
    muted: isMuted,
    autoplay: effectiveAutoPlay,
  });
  useMediaAssetPlayback(videoRef, playbackUrl, {
    enabled: shouldAttachPlayback,
    autoPlay: false,
    onError: handlePlaybackAttachError,
    onAuthErrorRefresh: refreshPlaybackOnAuthError,
  });

  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    const onPlay = () => {
      setIsPlaying(true);
      if (!playbackSucceededRef.current) {
        playbackSucceededRef.current = true;
        trackVibeVideoEvent(VIBE_VIDEO_EVENTS.playbackSucceeded, {
          source: "vibe_player_inline",
          backend_reports_ready: backendReportsReady,
        });
      }
    };
    const onPlaying = () => reportFirstFrame();
    const onPause = () => setIsPlaying(false);
    videoEl.addEventListener("play", onPlay);
    videoEl.addEventListener("playing", onPlaying);
    videoEl.addEventListener("pause", onPause);
    return () => {
      videoEl.removeEventListener("play", onPlay);
      videoEl.removeEventListener("playing", onPlaying);
      videoEl.removeEventListener("pause", onPause);
    };
  }, [backendReportsReady, reportFirstFrame]);

  const handleToggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsMuted(!isMuted);
  };

  const handleVideoClick = () => {
    if (!videoRef.current) return;
    
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      if (prefersReducedMotion && !manualPlaybackRequested) {
        onPlaybackRequest?.();
        manualPlayPendingRef.current = true;
        setManualPlaybackRequested(true);
        setIsLoading(true);
        return;
      }
      if (!playbackAttemptedRef.current) {
        onPlaybackRequest?.();
        playbackAttemptedRef.current = true;
        trackVibeVideoEvent(VIBE_VIDEO_EVENTS.playbackAttempted, {
          source: "vibe_player_inline",
          autoplay: false,
          backend_reports_ready: backendReportsReady,
        });
      }
      videoRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch(() => {
        setIsPlaying(false);
        reportPlaybackError("play_rejected");
      });
    }
  };

  const handleLoadedData = () => {
    setIsLoaded(true);
    setIsLoading(false);
    reportFirstFrame();
  };

  const handleError = () => {
    if (isHlsPlaybackUrl) return;
    reportPlaybackError();
  };

  const handleCanPlay = () => {
    setIsLoading(false);
  };

  return (
    <div ref={containerRef} className={cn("relative overflow-hidden bg-secondary", className)}>
      <MediaPlaceholder
        kind={placeholderKind}
        hash={placeholderHash}
        dominantColor={dominantColor}
      />

      {posterUrl ? (
        <img
          src={posterUrl}
          alt=""
          className="pointer-events-none absolute inset-0 z-[1] h-full w-full object-cover"
          decoding="sync"
          loading="eager"
          fetchPriority="high"
          draggable={false}
        />
      ) : null}

      {/* Loading state */}
      {isLoading && !hasError && (!prefersReducedMotion || manualPlaybackRequested) && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/10">
          <Loader2 className={cn("w-8 h-8 text-white/80 drop-shadow", !prefersReducedMotion && "animate-spin")} />
        </div>
      )}

      {/* Error state — honest when DB says ready but stream fails */}
      {hasError && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/70 px-4 text-center backdrop-blur-sm">
          <Play className="w-8 h-8 text-muted-foreground mb-2 opacity-80" />
          <p className="text-sm font-medium text-foreground">
            Can't play right now
          </p>
          {backendReportsReady && (
            <p className="text-xs text-muted-foreground mt-1.5 max-w-[240px]">
              It's ready on our side, but playback didn't load. Try again shortly.
            </p>
          )}
        </div>
      )}

      {/* Play button overlay when paused */}
      <AnimatePresence>
        {!isPlaying && !hasError && (isLoaded || (prefersReducedMotion && !manualPlaybackRequested)) && (
          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={prefersReducedMotion ? undefined : { opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center z-10 bg-background/30"
            onClick={handleVideoClick}
          >
            <motion.div
              whileHover={prefersReducedMotion ? undefined : { scale: 1.1 }}
              whileTap={prefersReducedMotion ? undefined : { scale: 0.9 }}
              className="w-16 h-16 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center cursor-pointer"
            >
              <Play className="w-8 h-8 text-foreground ml-1" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Video */}
      <video
        ref={videoRef}
        className={cn(
          "relative z-[2] w-full h-full object-cover transition-opacity duration-150",
          posterUrl && !isLoaded && !hasError ? "opacity-0" : "opacity-100",
        )}
        loop
        muted={isMuted}
        playsInline
        preload={videoPreload}
        onLoadedData={handleLoadedData}
        onCanPlay={handleCanPlay}
        onError={handleError}
        onClick={handleVideoClick}
        poster={posterUrl}
      >
        {captionTrackUrl ? (
          <track kind="subtitles" src={captionTrackUrl} srcLang={captionLanguage} label="Captions" default={showCaptions} />
        ) : null}
      </video>

      {captionText && showCaptions && !hasError ? (
        <div className="pointer-events-none absolute inset-x-6 bottom-24 z-20 rounded-md bg-black/65 px-3 py-2 text-center text-xs font-medium leading-snug text-white shadow-lg">
          {captionText}
        </div>
      ) : null}

      {/* Vibe Caption Overlay */}
      {vibeCaption && (
        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: prefersReducedMotion ? 0 : 0.3, duration: prefersReducedMotion ? 0 : undefined }}
          className={cn(
            "absolute bottom-0 left-0 right-0 z-10 px-6 pb-6",
            overlayClassName
          )}
          style={{
            background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%)',
          }}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: 'linear-gradient(135deg, #8B5CF6, #E84393)' }}
            />
            <span
              className="text-xs font-semibold uppercase tracking-widest"
              style={{
                background: 'linear-gradient(90deg, #8B5CF6, #E84393)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              Vibing on
            </span>
          </div>
          <p
            className="text-white font-bold leading-tight"
            style={{
              fontSize: '18px',
              letterSpacing: '-0.3px',
              textShadow: '0 2px 12px rgba(0,0,0,0.5)',
            }}
          >
            {vibeCaption}
          </p>
        </motion.div>
      )}

      {/* Mute/Unmute Control */}
      {showControls && isLoaded && !hasError && (
        <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
          {captionText ? (
            <motion.button
              initial={prefersReducedMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              whileHover={prefersReducedMotion ? undefined : { scale: 1.1 }}
              whileTap={prefersReducedMotion ? undefined : { scale: 0.9 }}
              onClick={(event) => {
                event.stopPropagation();
                setShowCaptions((visible) => {
                  const next = !visible;
                  trackVibeVideoEvent(VIBE_VIDEO_EVENTS.captionToggleChanged, {
                    surface: "vibe_player_inline",
                    enabled: next,
                  });
                  return next;
                });
              }}
              className="w-10 h-10 rounded-full bg-background/50 backdrop-blur-md flex items-center justify-center hover:bg-background/70 transition-colors"
              aria-label={showCaptions ? "Hide captions" : "Show captions"}
            >
              <Captions className="w-5 h-5 text-foreground" />
            </motion.button>
          ) : null}
          <motion.button
            initial={prefersReducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            whileHover={prefersReducedMotion ? undefined : { scale: 1.1 }}
            whileTap={prefersReducedMotion ? undefined : { scale: 0.9 }}
            onClick={handleToggleMute}
            className="w-10 h-10 rounded-full bg-background/50 backdrop-blur-md flex items-center justify-center hover:bg-background/70 transition-colors"
            aria-label={isMuted ? "Unmute video" : "Mute video"}
          >
            {isMuted ? (
              <VolumeX className="w-5 h-5 text-foreground" />
            ) : (
              <Volume2 className="w-5 h-5 text-foreground" />
            )}
          </motion.button>
        </div>
      )}

      {/* Owner Update Button */}
      {isOwner && onUpdateClick && (
        <motion.button
          initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          whileHover={prefersReducedMotion ? undefined : { scale: 1.1 }}
          whileTap={prefersReducedMotion ? undefined : { scale: 0.9 }}
          onClick={onUpdateClick}
          className="absolute bottom-4 right-4 z-20 flex items-center gap-2 px-4 py-2 rounded-full bg-primary text-primary-foreground font-medium text-sm shadow-lg"
        >
          <Pencil className="w-4 h-4" />
          Update Vibe
        </motion.button>
      )}

      {/* Gradient overlay at bottom for caption readability */}
      <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-background/80 to-transparent pointer-events-none" />
    </div>
  );
};

export default VibePlayer;
