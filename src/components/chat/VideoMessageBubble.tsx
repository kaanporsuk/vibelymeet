import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { Play, Volume2, VolumeX, Maximize, AlertCircle, Loader2 } from "lucide-react";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { cn } from "@/lib/utils";
import { useMediaAsset, useMediaAssetPlayback, type MediaAssetKind } from "@/hooks/useMediaAsset";
import { useMediaPlaybackQoE } from "@/hooks/useMediaPlaybackQoE";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useMediaVideoPreloadForVisibility } from "@/hooks/useMediaVideoPreloadPolicy";
import {
  getCachedMediaAssetFailureCode,
  isTransientMediaAssetFailureCode,
  refreshMediaAsset as refreshResolvedMediaAsset,
} from "@/lib/mediaAssetResolver";
import { hlsPlaybackErrorStatusCode } from "@/lib/vibeVideo/attachHlsPlayback";
import {
  claimInlineVideoPlayback,
  consumeInlineVideoPlaybackRegistryPause,
  releaseInlineVideoPlayback,
} from "@/components/chat/inlineVideoPlaybackRegistry";
import {
  resolveMediaFallbackCopy,
  resolveMediaFallbackReason,
  type MediaFallbackReason,
} from "@clientShared/media/mediaFallbackCopy";

interface VideoMessageBubbleProps {
  videoUrl: string;
  videoSourceRef?: string | null;
  messageId?: string;
  mediaKind?: Extract<MediaAssetKind, "video" | "vibe_clip">;
  onResolvedVideoUrl?: (url: string) => void;
  /** Optional poster. When a thumbnail ref is present it resolves through the same
   *  signed-media path as Vibe Clips and shows before the first video frame. */
  thumbnailUrl?: string | null;
  thumbnailSourceRef?: string | null;
  onResolvedThumbnailUrl?: (url: string) => void;
  duration: number;
  isMine: boolean;
  /** When set, tap / expand opens chat fullscreen viewer instead of browser fullscreen */
  onRequestImmersive?: () => void;
  /** Pause inline preview while immersive viewer is open for this URL */
  immersiveActive?: boolean;
  threadVisualRecede?: boolean;
}

type VideoElementWithWebkitFullscreen = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
};
type VideoMediaRefreshReason = "initial" | "playback" | "manual";

const VIDEO_BUBBLE_WIDTH_CLASS = "w-[min(17.5rem,calc(100svw-4rem))] max-w-full";
const MAX_VIDEO_PLAYBACK_REFRESH_ATTEMPTS = 2;
const PLAYBACK_REFRESH_RETRY_DELAY_MS = 650;
const VIDEO_PLAYBACK_LOAD_TIMEOUT_MS = 12_000;
// First-go poster reliability (mirrors VibeClipBubble): when a thumbnail ref exists,
// re-sign + reload the poster on a bounded backoff so it appears before the first frame.
const POSTER_PREVIEW_RETRY_DELAYS_MS = [1000, 3000, 8000];

function isDisplayablePosterUrl(value: string | null | undefined): boolean {
  return !!value && /^(https?:|blob:|data:|file:)/i.test(value);
}

function isMountableVideoUrl(value: string | null | undefined): boolean {
  return !!value && /^(https?:|blob:|data:|file:)/i.test(value);
}

function waitForPlaybackRefreshRetry(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, PLAYBACK_REFRESH_RETRY_DELAY_MS));
}

function uniqueDisplayablePosterUrls(
  ...groups: Array<string | null | undefined | readonly (string | null | undefined)[]>
): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    const values = Array.isArray(group) ? group : [group];
    for (const value of values) {
      if (!isDisplayablePosterUrl(value)) continue;
      if (seen.has(value)) continue;
      seen.add(value);
      urls.push(value);
    }
  }
  return urls;
}

const formatDuration = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

export const VideoMessageBubble = ({
  videoUrl,
  videoSourceRef,
  messageId,
  mediaKind = "video",
  onResolvedVideoUrl,
  thumbnailUrl,
  thumbnailSourceRef,
  onResolvedThumbnailUrl,
  duration,
  isMine,
  onRequestImmersive,
  immersiveActive,
  threadVisualRecede = false,
}: VideoMessageBubbleProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [hasMetadata, setHasMetadata] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [fallbackReason, setFallbackReason] = useState<MediaFallbackReason | null>(null);
  const [playRequested, setPlayRequested] = useState(false);
  const [hasStartedPlayback, setHasStartedPlayback] = useState(false);
  const [isViewportVisible, setIsViewportVisible] = useState(true);
  const prefersReducedMotion = usePrefersReducedMotion();
  const playbackRefreshAttemptCountRef = useRef(0);
  const initialPlaybackResolveInFlightRef = useRef(false);
  const initialPlaybackResolveRunIdRef = useRef(0);
  const {
    url: mediaAssetUrl,
    expiresAtMs: mediaAssetExpiresAtMs,
    fallbackReason: mediaAssetFallbackReason,
    fallbackCopy: mediaAssetFallbackCopy,
    refresh: refreshMediaAsset,
  } = useMediaAsset({
    kind: mediaKind,
    messageId,
    sourceRef: videoSourceRef,
    initialUrl: videoUrl,
    autoResolve: false,
    onResolvedUrl: onResolvedVideoUrl,
  });
  const [playableVideoUrl, setPlayableVideoUrl] = useState(mediaAssetUrl ?? videoUrl);
  const playableVideoUrlRef = useRef(mediaAssetUrl ?? videoUrl);
  const isHlsUrl = /\.m3u8(?:[?#]|$)/i.test(playableVideoUrl);
  const handleResolvedThumbnailUrl = useCallback((url: string) => {
    if (isDisplayablePosterUrl(url)) onResolvedThumbnailUrl?.(url);
  }, [onResolvedThumbnailUrl]);

  // Optional poster (legacy/plain chat video parity with Vibe Clips). No-op when the
  // message carries no thumbnail ref — the loading shimmer behaves exactly as before.
  const {
    url: thumbnailAssetUrl,
    fallbackUrls: thumbnailFallbackUrls,
    refresh: refreshThumbnailAsset,
  } = useMediaAsset({
    kind: "thumbnail",
    messageId,
    sourceRef: thumbnailSourceRef,
    initialUrl: thumbnailUrl,
    onResolvedUrl: handleResolvedThumbnailUrl,
  });
  const [playablePosterUrl, setPlayablePosterUrl] = useState<string | null>(thumbnailUrl ?? null);
  const [posterImageBroken, setPosterImageBroken] = useState(false);
  const playablePosterUrlRef = useRef<string | null>(thumbnailUrl ?? null);
  const posterRetryStateRef = useRef<{ key: string; attempts: number }>({ key: "", attempts: 0 });
  const posterNotReadyRef = useRef(false);
  const posterCandidateUrlsRef = useRef<string[]>([]);
  const visibleFallbackCopy =
    (fallbackReason ? resolveMediaFallbackCopy({ reason: fallbackReason }) : null) ??
    mediaAssetFallbackCopy ??
    resolveMediaFallbackCopy({ reason: "unknown" });

  const isIosSafari = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua);
    // Safari on iOS uses WebKit; exclude common iOS browsers that also embed WebKit but
    // still behave differently enough that we don't want a broad heuristic.
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    return isIOS && isSafari;
  }, []);

  useEffect(() => {
    const nextUrl = mediaAssetUrl ?? videoUrl;
    playableVideoUrlRef.current = nextUrl;
    setPlayableVideoUrl(nextUrl);
    setIsPlaying(false);
    setCurrentTime(0);
    setIsLoading(true);
    setIsReady(false);
    setPlayRequested(false);
    setHasStartedPlayback(false);
    initialPlaybackResolveInFlightRef.current = false;
    initialPlaybackResolveRunIdRef.current += 1;
    setHasMetadata(false);
    setLoadError(false);
    setFallbackReason(null);
    playbackRefreshAttemptCountRef.current = 0;
  }, [mediaAssetUrl, videoUrl]);

  useEffect(() => {
    playablePosterUrlRef.current = thumbnailUrl ?? null;
    setPlayablePosterUrl(thumbnailUrl ?? null);
    setPosterImageBroken(false);
    posterRetryStateRef.current = { key: "", attempts: 0 };
  }, [thumbnailSourceRef, thumbnailUrl]);

  useEffect(() => {
    const next = isDisplayablePosterUrl(thumbnailAssetUrl) ? thumbnailAssetUrl : null;
    if (!next || next === playablePosterUrlRef.current) return;
    playablePosterUrlRef.current = next;
    setPlayablePosterUrl(next);
    setPosterImageBroken(false);
  }, [thumbnailAssetUrl]);

  const posterCandidateUrls = useMemo(
    () => uniqueDisplayablePosterUrls(playablePosterUrl, thumbnailFallbackUrls),
    [playablePosterUrl, thumbnailFallbackUrls],
  );

  useEffect(() => {
    posterCandidateUrlsRef.current = posterCandidateUrls;
  }, [posterCandidateUrls]);

  const handlePosterImageError = useCallback(() => {
    const current = playablePosterUrlRef.current;
    const candidates = posterCandidateUrlsRef.current;
    const currentIndex = current ? candidates.indexOf(current) : -1;
    const next = candidates.find((candidate, index) => index > currentIndex && candidate !== current);
    if (next) {
      playablePosterUrlRef.current = next;
      setPlayablePosterUrl(next);
      setPosterImageBroken(false);
      handleResolvedThumbnailUrl(next);
      return;
    }
    setPosterImageBroken(true);
  }, [handleResolvedThumbnailUrl]);

  const refreshPoster = useCallback(async (): Promise<string | null> => {
    if (!messageId || !thumbnailSourceRef) return null;
    const fresh = await refreshThumbnailAsset("preview", {
      bypassFailureCooldown: true,
      suppressFailureCache: true,
    });
    const displayableFresh = isDisplayablePosterUrl(fresh) ? fresh : null;
    if (!displayableFresh) return null;
    playablePosterUrlRef.current = displayableFresh;
    setPlayablePosterUrl(displayableFresh);
    setPosterImageBroken(false);
    return displayableFresh;
  }, [messageId, refreshThumbnailAsset, thumbnailSourceRef]);

  const posterNotReady =
    !!thumbnailSourceRef &&
    !hasStartedPlayback &&
    (!playablePosterUrl || !isDisplayablePosterUrl(playablePosterUrl) || posterImageBroken);
  useEffect(() => {
    posterNotReadyRef.current = posterNotReady;
  }, [posterNotReady]);

  // Bounded first-go poster retry. Re-signs the thumbnail (new URL → <img> reloads) on a
  // [1s, 3s, 8s] backoff while missing/broken, capped per target so a never-generated
  // thumbnail cannot loop.
  useEffect(() => {
    if (!messageId || !thumbnailSourceRef || !posterNotReady) return;
    const retryKey = `${messageId}:${thumbnailSourceRef}`;
    if (posterRetryStateRef.current.key !== retryKey) {
      posterRetryStateRef.current = { key: retryKey, attempts: 0 };
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = () => {
      const state = posterRetryStateRef.current;
      if (cancelled || state.attempts >= POSTER_PREVIEW_RETRY_DELAYS_MS.length) return;
      const delay = POSTER_PREVIEW_RETRY_DELAYS_MS[state.attempts];
      timer = setTimeout(() => {
        timer = null;
        if (cancelled || !posterNotReadyRef.current) return;
        posterRetryStateRef.current.attempts += 1;
        void refreshPoster().finally(() => {
          if (!cancelled && posterNotReadyRef.current) run();
        });
      }, delay);
    };
    run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [messageId, posterNotReady, refreshPoster, thumbnailSourceRef]);

  const canShowPoster = isDisplayablePosterUrl(playablePosterUrl);
  const showPosterVisual = canShowPoster && !posterImageBroken;
  const canMountPlayer = isMountableVideoUrl(playableVideoUrl);
  const isAwaitingPlaybackIntent = !canMountPlayer;
  const showResolvingPlaybackOverlay = isAwaitingPlaybackIntent && playRequested && !loadError;
  const showPreparingOverlay = !isReady && !isAwaitingPlaybackIntent;
  const showIdlePosterOverlay =
    showPosterVisual && canMountPlayer && !showPreparingOverlay && !hasStartedPlayback;

  const refreshVideoUrl = useCallback(
    async (
      reason: VideoMediaRefreshReason = "playback",
      options?: { bypassFailureCooldown?: boolean },
    ): Promise<string | null> => {
      if (!messageId || !videoSourceRef) return null;
      const freshUrl = await refreshMediaAsset(reason, options);
      if (!freshUrl) return null;
      if (!isMountableVideoUrl(freshUrl)) return null;
      playableVideoUrlRef.current = freshUrl;
      setPlayableVideoUrl(freshUrl);
      onResolvedVideoUrl?.(freshUrl);
      return freshUrl;
    },
    [messageId, onResolvedVideoUrl, refreshMediaAsset, videoSourceRef],
  );

  const refreshVideoUrlWithRetry = useCallback(
    async (
      reason: VideoMediaRefreshReason,
      options?: { bypassFailureCooldown?: boolean },
      consumePlaybackBudget = false,
    ): Promise<string | null> => {
      if (!messageId || !videoSourceRef) return null;
      for (let attempt = 0; attempt < MAX_VIDEO_PLAYBACK_REFRESH_ATTEMPTS; attempt += 1) {
        if (consumePlaybackBudget) {
          if (playbackRefreshAttemptCountRef.current >= MAX_VIDEO_PLAYBACK_REFRESH_ATTEMPTS) return null;
          playbackRefreshAttemptCountRef.current += 1;
        }
        const attemptOptions = attempt === 0 ? options : { ...(options ?? {}), bypassFailureCooldown: true };
        let refreshRejected = false;
        const freshUrl = await refreshVideoUrl(reason, attemptOptions).catch(() => {
          refreshRejected = true;
          return null;
        });
        if (freshUrl) return freshUrl;
        const failureCode = getCachedMediaAssetFailureCode(messageId, mediaKind, videoSourceRef);
        if (!refreshRejected && !isTransientMediaAssetFailureCode(failureCode)) return null;
        if (attempt + 1 >= MAX_VIDEO_PLAYBACK_REFRESH_ATTEMPTS) return null;
        if (consumePlaybackBudget && playbackRefreshAttemptCountRef.current >= MAX_VIDEO_PLAYBACK_REFRESH_ATTEMPTS) {
          return null;
        }
        await waitForPlaybackRefreshRetry();
      }
      return null;
    },
    [mediaKind, messageId, refreshVideoUrl, videoSourceRef],
  );

  const tryRefreshAfterFailure = useCallback(async (): Promise<boolean> => {
    if (!messageId || !videoSourceRef) return false;
    const freshUrl = await refreshVideoUrlWithRetry("playback", undefined, true);
    if (!freshUrl) return false;
    if (freshUrl === playableVideoUrl) {
      videoRef.current?.load();
      return true;
    }
    return true;
  }, [messageId, playableVideoUrl, refreshVideoUrlWithRetry, videoSourceRef]);

  const commitResolvedPlaybackAsset = useCallback((fresh: { url?: string | null } | null | undefined): boolean => {
    const freshUrl = fresh?.url;
    if (!freshUrl || !isMountableVideoUrl(freshUrl)) return false;
    playableVideoUrlRef.current = freshUrl;
    setPlayableVideoUrl(freshUrl);
    onResolvedVideoUrl?.(freshUrl);
    return true;
  }, [onResolvedVideoUrl]);

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

  const markReadyIfPossible = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    // HAVE_CURRENT_DATA (2) means the first frame is available in most browsers.
    // On iOS Safari, decoding/painting the first frame can be deferred until a user
    // gesture even though metadata is loaded and the element is effectively usable.
    const readyForFirstFrame = video.readyState >= 2 && video.videoWidth > 0;
    const readyEnoughForInteractionOnIosSafari = isIosSafari && video.readyState >= 1;

    if (readyForFirstFrame || readyEnoughForInteractionOnIosSafari) {
      setIsReady(true);
      setIsLoading(false);
    }
  }, [isIosSafari]);

  // iOS Safari fallback: avoid infinite loading when the browser won't paint the first frame
  // until the first user gesture. After metadata is loaded, give it a short window to become
  // truly frame-ready; if it doesn't, allow interaction UI instead of an endless placeholder.
  useEffect(() => {
    if (!isIosSafari) return;
    if (!hasMetadata) return;
    if (isReady || loadError) return;

    const t = setTimeout(() => {
      if (!videoRef.current) return;
      setIsReady(true);
      setIsLoading(false);
    }, 900);

    return () => clearTimeout(t);
  }, [hasMetadata, isIosSafari, isReady, loadError]);

  useEffect(() => {
    if (!playRequested || !isReady) return;
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) return;
    video.play().then(() => setIsPlaying(true)).catch((err: unknown) => {
      const name = err instanceof Error ? err.name : "";
      if (name === "AbortError" && consumeInlineVideoPlaybackRegistryPause(video)) return;
      if (name === "AbortError" || name === "NotAllowedError" || name === "NotSupportedError") {
        void tryRefreshAfterFailure().then((didRefresh) => {
          if (!didRefresh) {
            setFallbackReason(mediaAssetFallbackReason ?? "unknown");
            setLoadError(true);
          }
        });
      }
    });
  }, [isReady, mediaAssetFallbackReason, playRequested, tryRefreshAfterFailure]);

  useEffect(() => {
    if (!playRequested || isReady || loadError || !canMountPlayer) return;
    const timeoutId = window.setTimeout(() => {
      void tryRefreshAfterFailure().then((didRefresh) => {
        if (!didRefresh) {
          setFallbackReason(mediaAssetFallbackReason ?? "unknown");
          setLoadError(true);
        }
      });
    }, VIDEO_PLAYBACK_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [canMountPlayer, isReady, loadError, mediaAssetFallbackReason, playRequested, tryRefreshAfterFailure]);

  const togglePlay = useCallback(() => {
    if (!canMountPlayer) {
      if (playRequested || initialPlaybackResolveInFlightRef.current) return;
      initialPlaybackResolveInFlightRef.current = true;
      const runId = initialPlaybackResolveRunIdRef.current + 1;
      initialPlaybackResolveRunIdRef.current = runId;
      setPlayRequested(true);
      setIsLoading(true);
      void refreshVideoUrlWithRetry("initial", { bypassFailureCooldown: true })
        .then((freshUrl) => {
          if (initialPlaybackResolveRunIdRef.current !== runId) return;
          if (!freshUrl) {
            setFallbackReason(mediaAssetFallbackReason ?? "unknown");
            setLoadError(true);
          }
        })
        .catch(() => {
          if (initialPlaybackResolveRunIdRef.current !== runId) return;
          setFallbackReason(mediaAssetFallbackReason ?? "unknown");
          setLoadError(true);
        })
        .finally(() => {
          if (initialPlaybackResolveRunIdRef.current === runId) {
            initialPlaybackResolveInFlightRef.current = false;
          }
        });
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      setPlayRequested(true);
      video.play().then(() => setIsPlaying(true)).catch((err: unknown) => {
        const name = err instanceof Error ? err.name : "";
        if (name === "AbortError" && consumeInlineVideoPlaybackRegistryPause(video)) return;
        if (name === "AbortError" || name === "NotAllowedError" || name === "NotSupportedError") {
          void tryRefreshAfterFailure().then((didRefresh) => {
            if (!didRefresh) {
              setFallbackReason(mediaAssetFallbackReason ?? "unknown");
              setLoadError(true);
            }
          });
        }
      });
    } else {
      video.pause();
      setIsPlaying(false);
      setPlayRequested(false);
    }
  }, [canMountPlayer, mediaAssetFallbackReason, playRequested, refreshVideoUrlWithRetry, tryRefreshAfterFailure]);

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
      if (onRequestImmersive) {
        onRequestImmersive();
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
    [onRequestImmersive],
  );

  const onSurfaceInteract = useCallback(() => {
    // Single tap plays inline in place; the ⤢ expand button opens the full-screen viewer.
    togglePlay();
  }, [togglePlay]);

  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  }, []);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    setPlayRequested(false);
  }, []);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    setPlayRequested(false);
    setHasStartedPlayback(false);
    setCurrentTime(0);
    releaseInlineVideoPlayback(videoRef.current);
  }, []);

  const handlePlaying = useCallback(() => {
    setIsLoading(false);
    setIsPlaying(true);
    setHasStartedPlayback(true);
  }, []);

  useMediaPlaybackQoE(videoRef, {
    enabled: canMountPlayer && !loadError,
    family: mediaKind,
    surface: "chat_video_message_bubble",
    provider: "bunny_storage",
    sourceRef: videoSourceRef ?? playableVideoUrl,
    messageId: messageId ?? null,
    muted: isMuted,
    autoplay: false,
  });
  const refreshPlaybackOnAuthError = useCallback(async () => {
    if (!messageId || !videoSourceRef) return null;
    for (let attempt = 0; attempt < MAX_VIDEO_PLAYBACK_REFRESH_ATTEMPTS; attempt += 1) {
      if (playbackRefreshAttemptCountRef.current >= MAX_VIDEO_PLAYBACK_REFRESH_ATTEMPTS) return null;
      playbackRefreshAttemptCountRef.current += 1;
      let refreshRejected = false;
      const fresh = await refreshResolvedMediaAsset(messageId, mediaKind, videoSourceRef, {
        bypassFailureCooldown: true,
      }).catch(() => {
        refreshRejected = true;
        return null;
      });
      if (commitResolvedPlaybackAsset(fresh)) return fresh;
      const failureCode = getCachedMediaAssetFailureCode(messageId, mediaKind, videoSourceRef);
      if (!refreshRejected && !isTransientMediaAssetFailureCode(failureCode)) return null;
      if (attempt + 1 >= MAX_VIDEO_PLAYBACK_REFRESH_ATTEMPTS) return null;
      if (playbackRefreshAttemptCountRef.current >= MAX_VIDEO_PLAYBACK_REFRESH_ATTEMPTS) return null;
      await waitForPlaybackRefreshRetry();
    }
    return null;
  }, [commitResolvedPlaybackAsset, mediaKind, messageId, videoSourceRef]);
  const refreshPlaybackProactively = useCallback(async () => {
    if (!messageId || !videoSourceRef) return null;
    const fresh = await refreshResolvedMediaAsset(messageId, mediaKind, videoSourceRef, {
      suppressFailureCache: true,
    });
    commitResolvedPlaybackAsset(fresh);
    return fresh;
  }, [commitResolvedPlaybackAsset, mediaKind, messageId, videoSourceRef]);
  useMediaAssetPlayback(videoRef, playableVideoUrl, {
    enabled: canMountPlayer && isHlsUrl && !loadError,
    autoPlay: false,
    expiresAtMs: mediaAssetExpiresAtMs,
    onManifestParsed: markReadyIfPossible,
    onError: (_kind, detail) => {
      setIsLoading(false);
      void tryRefreshAfterFailure().then((didRefresh) => {
        if (!didRefresh) {
          setFallbackReason(resolveMediaFallbackReason({
            stage: isHlsUrl ? "hls_auth" : "playback",
            httpStatus: isHlsUrl ? hlsPlaybackErrorStatusCode(detail) : null,
          }));
          setLoadError(true);
        }
      });
    },
    onAuthErrorRefresh: refreshPlaybackOnAuthError,
    onProactiveRefresh: refreshPlaybackProactively,
  });

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const isBuffering = isReady && isLoading && isPlaying;
  const videoPreload = useMediaVideoPreloadForVisibility(
    !immersiveActive && isViewportVisible && canMountPlayer,
    playableVideoUrl,
  );
  const videoAriaLabel =
    showResolvingPlaybackOverlay || showPreparingOverlay || isBuffering
      ? "Preparing video"
      : isPlaying
        ? "Pause video"
        : "Play video";

  if (loadError) {
    return (
      <div
        className={cn(
          VIDEO_BUBBLE_WIDTH_CLASS,
          "rounded-xl overflow-hidden border border-fuchsia-500/20 bg-gradient-to-b from-secondary/30 to-black/40 flex flex-col items-center justify-center py-5 px-3 gap-1.5 shadow-inner shadow-black/30",
        )}
      >
        <AlertCircle className="w-6 h-6 text-muted-foreground" />
        <span className="text-[11px] font-semibold text-muted-foreground text-center leading-snug">
          {visibleFallbackCopy.title}
        </span>
        <span className="text-[10px] text-muted-foreground/85 text-center leading-snug">
          {visibleFallbackCopy.message}
        </span>
        {visibleFallbackCopy.actionLabel ? (
          <button
            type="button"
            onClick={() => {
              playbackRefreshAttemptCountRef.current = 0;
              setLoadError(false);
              setFallbackReason(null);
              setIsLoading(true);
              setIsReady(false);
              setIsPlaying(false);
              setCurrentTime(0);
              void refreshVideoUrlWithRetry("manual", { bypassFailureCooldown: true }).then((freshUrl) => {
                if (!freshUrl || freshUrl === playableVideoUrl) videoRef.current?.load();
              });
            }}
            className="text-[11px] font-medium text-primary hover:underline underline-offset-2"
          >
            {visibleFallbackCopy.actionLabel}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        VIDEO_BUBBLE_WIDTH_CLASS,
        "rounded-xl overflow-hidden relative group cursor-pointer shadow-md shadow-black/20 ring-1 ring-white/10 transition-opacity duration-200",
        threadVisualRecede && "opacity-[0.9] ring-white/[0.06] shadow-black/10",
      )}
      onClick={onSurfaceInteract}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSurfaceInteract();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={videoAriaLabel}
    >
      <div className="flex items-center gap-1 px-2 pt-1.5 pb-0.5">
        <span className="inline-flex items-center rounded-full border border-white/[0.1] bg-white/[0.04] px-1.5 py-px">
          <span className="text-[8px] font-bold uppercase tracking-[0.14em] text-white/55">Video</span>
        </span>
      </div>
      <AspectRatio ratio={9 / 16}>
        {/* Premium loading placeholder */}
        {isAwaitingPlaybackIntent ? (
          <div className="absolute inset-0 bg-black">
            {showPosterVisual ? (
              <img
                src={playablePosterUrl ?? undefined}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                draggable={false}
                onError={handlePosterImageError}
              />
            ) : null}
            <div className="absolute inset-0 bg-gradient-to-br from-white/[0.04] via-transparent to-fuchsia-400/[0.08]" />
            {showResolvingPlaybackOverlay ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/28">
                <div className="flex items-center gap-2 rounded-full bg-black/55 px-3.5 py-2 backdrop-blur-md border border-fuchsia-500/15 shadow-[0_0_24px_rgba(168,85,247,0.12)]">
                  <Loader2 className={cn("h-3.5 w-3.5 text-fuchsia-300/90", !prefersReducedMotion && "animate-spin")} />
                  <span className="text-[11px] text-white/88 font-medium tracking-tight">Preparing playback…</span>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {showPreparingOverlay && (
          <div className="absolute inset-0 bg-black">
            {showPosterVisual ? (
              <img
                src={playablePosterUrl ?? undefined}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                draggable={false}
                onError={handlePosterImageError}
              />
            ) : null}
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
              <div className="flex items-center gap-2 rounded-full bg-black/55 px-3.5 py-2 backdrop-blur-md border border-fuchsia-500/15 shadow-[0_0_24px_rgba(168,85,247,0.12)]">
                <Loader2 className={cn("h-3.5 w-3.5 text-fuchsia-300/90", !prefersReducedMotion && "animate-spin")} />
                <span className="text-[11px] text-white/88 font-medium tracking-tight">Preparing…</span>
              </div>
            </div>

            {/* Subtle duration hint while loading */}
            <div className="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-black/60 to-transparent">
              <span className="text-[10px] text-white/70 font-mono">
                {formatDuration(duration)}
              </span>
            </div>
          </div>
        )}

        {canMountPlayer ? (
          <video
            ref={videoRef}
            src={isHlsUrl ? undefined : playableVideoUrl}
            poster={showPosterVisual ? playablePosterUrl ?? undefined : undefined}
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
            onPlay={() => claimInlineVideoPlayback(videoRef.current)}
            onPlaying={handlePlaying}
            onPause={handlePause}
            onWaiting={() => setIsLoading(true)}
            onError={() => {
              if (isHlsUrl) return;
              setIsLoading(false);
              void tryRefreshAfterFailure().then((didRefresh) => {
                if (!didRefresh) {
                  setFallbackReason(resolveMediaFallbackReason({ stage: "playback" }));
                  setLoadError(true);
                }
              });
            }}
            onTimeUpdate={handleTimeUpdate}
            onEnded={handleEnded}
            className={[
              "w-full h-full object-cover bg-black",
              "transition-opacity duration-300",
              isReady ? "opacity-100" : "opacity-0",
            ].join(" ")}
          />
        ) : null}

        {showIdlePosterOverlay ? (
          <img
            src={playablePosterUrl ?? undefined}
            alt=""
            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
            draggable={false}
            onError={handlePosterImageError}
          />
        ) : null}

        {isBuffering ? (
          <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center bg-black/25">
            <div className="flex items-center gap-2 rounded-full border border-white/12 bg-black/55 px-3 py-1.5 backdrop-blur-sm">
              <Loader2 className={cn("h-3 w-3 text-fuchsia-300/90", !prefersReducedMotion && "animate-spin")} />
              <span className="text-[10px] font-medium text-white/85">Buffering…</span>
            </div>
          </div>
        ) : null}

        {/* Play overlay */}
        {!isPlaying && (isReady || (isAwaitingPlaybackIntent && !showResolvingPlaybackOverlay)) && (
          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
            className="absolute inset-0 flex items-center justify-center bg-black/40"
          >
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-white/20 to-white/5 backdrop-blur-md border border-white/25 flex items-center justify-center shadow-lg shadow-fuchsia-500/10 ring-1 ring-fuchsia-400/20">
              <Play className="w-5 h-5 text-white ml-0.5 drop-shadow-md" fill="white" />
            </div>
          </motion.div>
        )}

        {/* Bottom controls */}
        <div className="absolute bottom-0 inset-x-0 px-2 pt-2 pb-1.5 bg-gradient-to-t from-black/70 via-black/35 to-transparent">
          <div className="w-full h-1 rounded-full bg-white/15 overflow-hidden mb-1.5 ring-1 ring-white/[0.06]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-fuchsia-400 via-violet-400 to-pink-400 transition-[width] duration-150 ease-out shadow-[0_0_12px_rgba(232,121,249,0.35)]"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="flex items-center justify-between gap-1">
            <span className="text-[9px] text-white/80 font-mono tabular-nums font-medium">
              {isPlaying && duration > 0
                ? `${formatDuration(Math.round(currentTime))} · ${formatDuration(duration)}`
                : formatDuration(duration)}
            </span>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleMute(e);
                }}
                aria-label={isMuted ? "Unmute video" : "Mute video"}
                className="rounded-md border border-white/10 bg-black/30 p-1 text-white/75 hover:bg-white/10 hover:text-white transition-colors"
              >
                {isMuted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
              </button>
              <button
                type="button"
                onClick={handleFullscreen}
                aria-label="Open video full screen"
                className="rounded-md border border-white/10 bg-black/30 p-1 text-white/75 hover:bg-white/10 hover:text-white transition-colors"
              >
                <Maximize className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      </AspectRatio>
    </div>
  );
};
