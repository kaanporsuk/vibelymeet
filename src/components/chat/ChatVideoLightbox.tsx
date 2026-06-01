import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Loader2, X, AlertCircle } from "lucide-react";
import { useMediaAsset, useMediaAssetPlayback, type MediaAssetKind } from "@/hooks/useMediaAsset";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import {
  getCachedMediaAssetFailureCode,
  isTransientMediaAssetFailureCode,
  refreshMediaAsset as refreshResolvedMediaAsset,
} from "@/lib/mediaAssetResolver";
import { hlsPlaybackErrorStatusCode } from "@/lib/vibeVideo/attachHlsPlayback";
import {
  resolveMediaFallbackCopy,
  resolveMediaFallbackReason,
  type MediaFallbackReason,
} from "@clientShared/media/mediaFallbackCopy";

type ChatVideoLightboxProps = {
  videoUrl: string;
  posterUrl?: string | null;
  messageId?: string;
  videoSourceRef?: string | null;
  thumbnailSourceRef?: string | null;
  mediaKind?: Extract<MediaAssetKind, "video" | "vibe_clip">;
  onResolvedVideoUrl?: (url: string) => void;
  onResolvedThumbnailUrl?: (url: string) => void;
  onClose: () => void;
};

const CLIP_PLAYBACK_LOAD_TIMEOUT_MS = 12_000;
const MAX_LIGHTBOX_PLAYBACK_REFRESH_ATTEMPTS = 2;
const PLAYBACK_REFRESH_RETRY_DELAY_MS = 650;

type LightboxMediaRefreshReason = "initial" | "playback" | "manual";
type LightboxPhase = "loading" | "ready" | "error";

function isPlayableMediaUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^(blob:|file:|data:)/i.test(value);
}

function displayablePosterUrl(value: string | null | undefined): string | null {
  return value && isPlayableMediaUrl(value) ? value : null;
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
      const url = displayablePosterUrl(value);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
}

function isHlsMediaUrl(value: string): boolean {
  return /\.m3u8(?:[?#]|$)/i.test(value);
}

export function ChatVideoLightbox({
  videoUrl,
  posterUrl,
  messageId,
  videoSourceRef,
  thumbnailSourceRef,
  mediaKind = "video",
  onResolvedVideoUrl,
  onResolvedThumbnailUrl,
  onClose,
}: ChatVideoLightboxProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const prefersReducedMotion = usePrefersReducedMotion();
  const initialPosterUrl = displayablePosterUrl(posterUrl);
  const [phase, setPhase] = useState<LightboxPhase>("loading");
  const [playableVideoUrl, setPlayableVideoUrl] = useState(videoUrl);
  const [playablePosterUrl, setPlayablePosterUrl] = useState(initialPosterUrl);
  const [extraPosterFallbackUrls, setExtraPosterFallbackUrls] = useState<string[]>([]);
  const [posterImageBroken, setPosterImageBroken] = useState(false);
  const [hasStartedPlayback, setHasStartedPlayback] = useState(false);
  const [fallbackReason, setFallbackReason] = useState<MediaFallbackReason | null>(null);
  const playbackRefreshAttemptCountRef = useRef(0);
  const playableVideoUrlRef = useRef(playableVideoUrl);
  const posterUrlRef = useRef(initialPosterUrl);
  const onCloseRef = useRef(onClose);
  const onResolvedVideoUrlRef = useRef(onResolvedVideoUrl);
  const onResolvedThumbnailUrlRef = useRef(onResolvedThumbnailUrl);
  const playablePosterUrlRef = useRef(initialPosterUrl);
  const posterCandidateUrlsRef = useRef<string[]>([]);
  const posterFallbackResolveInFlightRef = useRef(false);
  const posterFallbackResolveAttemptedForRef = useRef<string | null>(null);
  const refreshMediaRef = useRef<((reason?: LightboxMediaRefreshReason) => Promise<boolean>) | null>(null);
  const initialResolveRunIdRef = useRef(0);
  const {
    url: videoAssetUrl,
    expiresAtMs: videoAssetExpiresAtMs,
    fallbackReason: videoAssetFallbackReason,
    fallbackCopy: videoAssetFallbackCopy,
    refresh: refreshVideoAsset,
  } = useMediaAsset({
    kind: mediaKind,
    messageId,
    sourceRef: videoSourceRef,
    initialUrl: videoUrl,
    autoResolve: false,
    onResolvedUrl: onResolvedVideoUrl,
  });
  const {
    url: posterAssetUrl,
    fallbackUrls: posterFallbackUrls,
    refresh: refreshPosterAsset,
  } = useMediaAsset({
    kind: "thumbnail",
    messageId,
    sourceRef: thumbnailSourceRef,
    initialUrl: initialPosterUrl,
    autoResolve: false,
    onResolvedUrl: (url) => {
      const displayableUrl = displayablePosterUrl(url);
      if (displayableUrl) onResolvedThumbnailUrl?.(displayableUrl);
    },
  });

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    onResolvedVideoUrlRef.current = onResolvedVideoUrl;
  }, [onResolvedVideoUrl]);

  useEffect(() => {
    onResolvedThumbnailUrlRef.current = onResolvedThumbnailUrl;
  }, [onResolvedThumbnailUrl]);

  const resetPhase = useCallback(() => setPhase("loading"), []);
  const revealPlayer = useCallback(() => {
    setPhase((current) => (current === "error" ? current : "ready"));
  }, []);
  const isRemoteUrl = /^https?:\/\//i.test(playableVideoUrl);
  const isLocalUrl = /^(blob:|file:|data:)/i.test(playableVideoUrl);
  const canMountPlayer = isRemoteUrl || isLocalUrl;
  const isHlsUrl = isHlsMediaUrl(playableVideoUrl);
  const visiblePosterUrl = posterImageBroken ? null : displayablePosterUrl(playablePosterUrl);
  const showPosterProbe = !!visiblePosterUrl && !hasStartedPlayback && phase !== "error";
  const showLoadingPosterOverlay = !!visiblePosterUrl && phase === "loading";
  const visibleFallbackCopy =
    (fallbackReason ? resolveMediaFallbackCopy({ reason: fallbackReason }) : null) ??
    videoAssetFallbackCopy ??
    resolveMediaFallbackCopy({ reason: "unknown" });

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    playableVideoUrlRef.current = playableVideoUrl;
  }, [playableVideoUrl]);

  useEffect(() => {
    posterUrlRef.current = initialPosterUrl;
    playablePosterUrlRef.current = initialPosterUrl;
    setExtraPosterFallbackUrls([]);
    setPosterImageBroken(false);
    posterFallbackResolveAttemptedForRef.current = null;
  }, [initialPosterUrl]);

  useEffect(() => {
    if (!videoAssetUrl) return;
    setPlayableVideoUrl(videoAssetUrl);
    playableVideoUrlRef.current = videoAssetUrl;
  }, [videoAssetUrl]);

  useEffect(() => {
    const nextPosterUrl = displayablePosterUrl(posterAssetUrl) ?? initialPosterUrl;
    setPlayablePosterUrl(nextPosterUrl);
    playablePosterUrlRef.current = nextPosterUrl;
    setPosterImageBroken(false);
  }, [initialPosterUrl, posterAssetUrl]);

  const posterCandidateUrls = useMemo(
    () => uniqueDisplayablePosterUrls(playablePosterUrl, posterFallbackUrls, extraPosterFallbackUrls),
    [extraPosterFallbackUrls, playablePosterUrl, posterFallbackUrls],
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
      onResolvedThumbnailUrlRef.current?.(next);
      return;
    }
    const thumbnailSource = thumbnailSourceRef;
    if (!messageId || !thumbnailSource) {
      setPosterImageBroken(true);
      return;
    }
    const stableMessageId = messageId;
    const stableThumbnailSource = thumbnailSource;
    const resolveKey = `${stableMessageId}:${stableThumbnailSource}`;
    const hasExhaustedKnownFallbacks = candidates.length > 1 && currentIndex >= candidates.length - 1;
    if (
      hasExhaustedKnownFallbacks ||
      posterFallbackResolveAttemptedForRef.current === resolveKey ||
      posterFallbackResolveInFlightRef.current
    ) {
      setPosterImageBroken(true);
      return;
    }
    posterFallbackResolveAttemptedForRef.current = resolveKey;
    posterFallbackResolveInFlightRef.current = true;
    void refreshResolvedMediaAsset(stableMessageId, "thumbnail", stableThumbnailSource, {
      bypassFailureCooldown: true,
      suppressFailureCache: true,
    }).then((asset) => {
      const refreshedFallbackUrls = asset?.fallbackUrls ?? [];
      setExtraPosterFallbackUrls(refreshedFallbackUrls.filter((url): url is string => !!displayablePosterUrl(url)));
      const refreshedCandidates = uniqueDisplayablePosterUrls(asset?.url, refreshedFallbackUrls);
      const refreshedCurrentIndex = current ? refreshedCandidates.indexOf(current) : -1;
      const refreshedNext =
        refreshedCandidates.find((candidate, index) => index > refreshedCurrentIndex && candidate !== current) ??
        (refreshedCurrentIndex === -1 ? refreshedCandidates.find((candidate) => candidate !== current) : null) ??
        null;
      if (refreshedNext) {
        playablePosterUrlRef.current = refreshedNext;
        setPlayablePosterUrl(refreshedNext);
        setPosterImageBroken(false);
        onResolvedThumbnailUrlRef.current?.(refreshedNext);
        return;
      }
      setPosterImageBroken(true);
    }).catch(() => {
      setPosterImageBroken(true);
    }).finally(() => {
      posterFallbackResolveInFlightRef.current = false;
    });
  }, [messageId, thumbnailSourceRef]);

  useEffect(() => {
    if (displayablePosterUrl(playablePosterUrl) || !thumbnailSourceRef) return;
    void refreshPosterAsset("cache").then((freshPosterUrl) => {
      const displayableUrl = displayablePosterUrl(freshPosterUrl);
      if (!displayableUrl) return;
      setPlayablePosterUrl(displayableUrl);
      playablePosterUrlRef.current = displayableUrl;
      setPosterImageBroken(false);
      onResolvedThumbnailUrlRef.current?.(displayableUrl);
    });
  }, [playablePosterUrl, refreshPosterAsset, thumbnailSourceRef]);

  const refreshMedia = useCallback(async (reason: LightboxMediaRefreshReason = "playback"): Promise<boolean> => {
    const currentUrl = playableVideoUrlRef.current;
    if (!messageId || !videoSourceRef) return false;
    const refreshOptions = reason === "manual" ? { bypassFailureCooldown: true } : undefined;
    let freshVideoUrl: string | null = null;
    for (let attempt = 0; attempt < MAX_LIGHTBOX_PLAYBACK_REFRESH_ATTEMPTS; attempt += 1) {
      if (reason === "playback") {
        if (playbackRefreshAttemptCountRef.current >= MAX_LIGHTBOX_PLAYBACK_REFRESH_ATTEMPTS) return false;
        playbackRefreshAttemptCountRef.current += 1;
      }
      const attemptOptions = attempt === 0 ? refreshOptions : { ...(refreshOptions ?? {}), bypassFailureCooldown: true };
      let refreshRejected = false;
      try {
        freshVideoUrl = await refreshVideoAsset(reason, attemptOptions);
      } catch {
        refreshRejected = true;
        freshVideoUrl = null;
      }
      if (freshVideoUrl && isPlayableMediaUrl(freshVideoUrl)) break;
      freshVideoUrl = null;
      const failureCode = getCachedMediaAssetFailureCode(messageId, mediaKind, videoSourceRef);
      if (!refreshRejected && !isTransientMediaAssetFailureCode(failureCode)) return false;
      if (attempt + 1 >= MAX_LIGHTBOX_PLAYBACK_REFRESH_ATTEMPTS) return false;
      if (reason === "playback" && playbackRefreshAttemptCountRef.current >= MAX_LIGHTBOX_PLAYBACK_REFRESH_ATTEMPTS) {
        return false;
      }
      await waitForPlaybackRefreshRetry();
    }
    if (!freshVideoUrl) return false;
    if (freshVideoUrl === currentUrl) {
      videoRef.current?.load();
    } else {
      playableVideoUrlRef.current = freshVideoUrl;
      setPlayableVideoUrl(freshVideoUrl);
      onResolvedVideoUrlRef.current?.(freshVideoUrl);
    }
    if (thumbnailSourceRef && (reason === "initial" || reason === "manual")) {
      void (async () => {
        const freshPosterUrl = reason === "manual"
          ? await refreshPosterAsset("manual", refreshOptions)
          : await refreshPosterAsset("cache");
        const displayableFreshPosterUrl = displayablePosterUrl(freshPosterUrl);
        if (!displayableFreshPosterUrl) return;
        setPlayablePosterUrl(displayableFreshPosterUrl);
        playablePosterUrlRef.current = displayableFreshPosterUrl;
        setPosterImageBroken(false);
        onResolvedThumbnailUrlRef.current?.(displayableFreshPosterUrl);
      })().catch(() => {});
    }
    return true;
  }, [
    mediaKind,
    messageId,
    refreshPosterAsset,
    refreshVideoAsset,
    thumbnailSourceRef,
    videoSourceRef,
  ]);

  useEffect(() => {
    refreshMediaRef.current = refreshMedia;
  }, [refreshMedia]);

  useEffect(() => {
    const runId = initialResolveRunIdRef.current + 1;
    initialResolveRunIdRef.current = runId;
    playableVideoUrlRef.current = videoUrl;
    setPlayableVideoUrl(videoUrl);
    setPlayablePosterUrl(posterUrlRef.current);
    playablePosterUrlRef.current = posterUrlRef.current;
    setExtraPosterFallbackUrls([]);
    setPosterImageBroken(false);
    posterFallbackResolveAttemptedForRef.current = null;
    setHasStartedPlayback(false);
    setFallbackReason(null);
    playbackRefreshAttemptCountRef.current = 0;
    resetPhase();
    if (!isPlayableMediaUrl(videoUrl) && videoSourceRef) {
      const refresh = refreshMediaRef.current;
      if (!refresh) {
        setFallbackReason(videoAssetFallbackReason ?? "unknown");
        setPhase("error");
        return;
      }
      void refresh("initial").then((didRefresh) => {
        if (initialResolveRunIdRef.current !== runId) return;
        if (!didRefresh) {
          setFallbackReason(videoAssetFallbackReason ?? "unknown");
          setPhase("error");
        }
      }).catch(() => {
        if (initialResolveRunIdRef.current !== runId) return;
        setFallbackReason(videoAssetFallbackReason ?? "unknown");
        setPhase("error");
      });
      return;
    }
    if (!isPlayableMediaUrl(videoUrl)) {
      setFallbackReason("unknown");
      setPhase("error");
      return;
    }
  }, [resetPhase, videoAssetFallbackReason, videoSourceRef, videoUrl]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !canMountPlayer || isHlsUrl || prefersReducedMotion) return;
    const t = window.setTimeout(() => {
      void v.play().catch(() => revealPlayer());
    }, 120);
    return () => {
      window.clearTimeout(t);
      v.pause();
    };
  }, [canMountPlayer, isHlsUrl, playableVideoUrl, prefersReducedMotion, revealPlayer]);

  const handlePlaybackAttachError = useCallback((_kind: unknown, detail?: unknown) => {
    void refreshMedia().then((didRefresh) => {
      if (!didRefresh) {
        setFallbackReason(resolveMediaFallbackReason({
          stage: isHlsUrl ? "hls_auth" : "playback",
          httpStatus: isHlsUrl ? hlsPlaybackErrorStatusCode(detail) : null,
        }));
        setPhase("error");
      }
    });
  }, [isHlsUrl, refreshMedia]);

  const handlePlaying = useCallback(() => {
    setHasStartedPlayback(true);
    revealPlayer();
  }, [revealPlayer]);

  const handleEnded = useCallback(() => {
    setHasStartedPlayback(false);
    revealPlayer();
  }, [revealPlayer]);

  const commitResolvedPlaybackAsset = useCallback((fresh: { url?: string | null } | null | undefined): boolean => {
    const freshUrl = fresh?.url;
    if (!freshUrl || !isPlayableMediaUrl(freshUrl)) return false;
    playableVideoUrlRef.current = freshUrl;
    setPlayableVideoUrl(freshUrl);
    onResolvedVideoUrlRef.current?.(freshUrl);
    return true;
  }, []);

  const refreshPlaybackOnAuthError = useCallback(async () => {
    if (!messageId || !videoSourceRef) return null;
    for (let attempt = 0; attempt < MAX_LIGHTBOX_PLAYBACK_REFRESH_ATTEMPTS; attempt += 1) {
      if (playbackRefreshAttemptCountRef.current >= MAX_LIGHTBOX_PLAYBACK_REFRESH_ATTEMPTS) return null;
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
      if (attempt + 1 >= MAX_LIGHTBOX_PLAYBACK_REFRESH_ATTEMPTS) return null;
      if (playbackRefreshAttemptCountRef.current >= MAX_LIGHTBOX_PLAYBACK_REFRESH_ATTEMPTS) return null;
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
    enabled: isRemoteUrl && isHlsUrl,
    autoPlay: !prefersReducedMotion,
    expiresAtMs: videoAssetExpiresAtMs,
    onAutoplayBlocked: revealPlayer,
    onManifestParsed: revealPlayer,
    onError: handlePlaybackAttachError,
    onAuthErrorRefresh: refreshPlaybackOnAuthError,
    onProactiveRefresh: refreshPlaybackProactively,
  });

  useEffect(() => {
    if (phase !== "loading" || !canMountPlayer) return;
    const timeoutId = window.setTimeout(() => {
      revealPlayer();
    }, CLIP_PLAYBACK_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [canMountPlayer, phase, playableVideoUrl, revealPlayer]);

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Video viewer"
      initial={prefersReducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={prefersReducedMotion ? undefined : { opacity: 0 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-0 z-[200] flex flex-col bg-[#030308]"
    >
      {/* Immersive vignette + subtle grid (Neon Noir) */}
      <div
        className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(ellipse_85%_70%_at_50%_45%,rgba(88,28,135,0.12),transparent_65%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-b from-black/40 via-transparent to-black/80"
        aria-hidden
      />

      <motion.button
        type="button"
        aria-label="Close video"
        className="absolute inset-0 z-[2] bg-transparent"
        onClick={onClose}
      />

      <header className="relative z-20 flex items-center justify-end px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-white/12 bg-white/[0.06] text-white shadow-lg shadow-black/40 backdrop-blur-md transition-colors hover:bg-white/12"
          aria-label="Close"
        >
          <X className="h-5 w-5" strokeWidth={2} />
        </button>
      </header>

      <div
        className="relative z-10 flex flex-1 items-center justify-center px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.97, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: prefersReducedMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="relative w-full max-w-4xl overflow-hidden rounded-2xl border border-white/[0.08] bg-black shadow-[0_0_0_1px_rgba(168,85,247,0.12),0_24px_80px_-12px_rgba(0,0,0,0.85),0_0_120px_-20px_rgba(168,85,247,0.15)] ring-1 ring-fuchsia-500/10"
        >
          {phase === "loading" ? (
            <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/55 backdrop-blur-[2px]">
              <div className="flex items-center gap-2.5 rounded-full border border-white/10 bg-black/50 px-4 py-2.5 shadow-inner">
                <Loader2
                  className={`h-5 w-5 text-fuchsia-300/90 ${prefersReducedMotion ? "" : "animate-spin"}`}
                  aria-hidden
                />
                <span className="text-[12px] font-medium tracking-tight text-white/88">Preparing playback…</span>
              </div>
            </div>
          ) : null}

          {phase === "error" ? (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/80 px-6">
              <AlertCircle className="h-10 w-10 text-fuchsia-400/80" />
              <p className="text-center text-sm font-semibold text-white/85">{visibleFallbackCopy.title}</p>
              <p className="max-w-sm text-center text-xs leading-5 text-white/65">{visibleFallbackCopy.message}</p>
              {visibleFallbackCopy.actionLabel ? (
                <button
                  type="button"
                  className="rounded-full border border-fuchsia-500/35 bg-fuchsia-500/10 px-5 py-2 text-xs font-semibold text-fuchsia-200 transition-colors hover:bg-fuchsia-500/20"
                  onClick={() => {
                    playbackRefreshAttemptCountRef.current = 0;
                    setFallbackReason(null);
                    resetPhase();
                    void refreshMedia("manual").then((didRefresh) => {
                      if (didRefresh) return;
                      videoRef.current?.load();
                      void videoRef.current?.play().catch(() => revealPlayer());
                    });
                  }}
                >
                  {visibleFallbackCopy.actionLabel}
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="relative w-full bg-black">
            {canMountPlayer ? (
              <video
                ref={videoRef}
                src={isHlsUrl ? undefined : playableVideoUrl}
                poster={visiblePosterUrl ?? undefined}
                className="aspect-video max-h-[min(78dvh,800px)] w-full bg-black object-contain"
                controls
                playsInline
                controlsList="nodownload"
                onLoadStart={() => setPhase((current) => (current === "ready" ? current : "loading"))}
                onLoadedMetadata={revealPlayer}
                onLoadedData={revealPlayer}
                onCanPlay={revealPlayer}
                onPlaying={handlePlaying}
                onEnded={handleEnded}
                onError={() => {
                  if (isHlsUrl) return;
                  void refreshMedia().then((didRefresh) => {
                    if (!didRefresh) setPhase("error");
                  });
                }}
              />
            ) : (
              <div className="aspect-video max-h-[min(78dvh,800px)] w-full bg-black" />
            )}
            {showLoadingPosterOverlay ? (
              <img
                src={visiblePosterUrl}
                alt=""
                className="pointer-events-none absolute inset-0 h-full w-full object-contain"
                draggable={false}
              />
            ) : null}
            {showPosterProbe ? (
              <img
                src={visiblePosterUrl}
                alt=""
                aria-hidden
                className="pointer-events-none absolute left-0 top-0 h-px w-px opacity-0"
                draggable={false}
                onError={handlePosterImageError}
              />
            ) : null}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
