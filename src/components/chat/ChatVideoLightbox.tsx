import { useEffect, useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Loader2, X, AlertCircle } from "lucide-react";
import { refreshCachedChatMediaUrl, type ChatMediaKind } from "@/lib/chatMediaResolver";
import { attachHlsPlayback } from "@/lib/vibeVideo/attachHlsPlayback";

type ChatVideoLightboxProps = {
  videoUrl: string;
  posterUrl?: string | null;
  messageId?: string;
  videoSourceRef?: string | null;
  thumbnailSourceRef?: string | null;
  mediaKind?: Extract<ChatMediaKind, "video" | "vibe_clip">;
  onResolvedVideoUrl?: (url: string) => void;
  onResolvedThumbnailUrl?: (url: string) => void;
  onClose: () => void;
};

const CLIP_PLAYBACK_LOAD_TIMEOUT_MS = 12_000;

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
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [playableVideoUrl, setPlayableVideoUrl] = useState(videoUrl);
  const [playablePosterUrl, setPlayablePosterUrl] = useState(posterUrl ?? null);
  const refreshAttemptedForUrlRef = useRef<string | null>(null);
  const playableVideoUrlRef = useRef(playableVideoUrl);

  const resetPhase = useCallback(() => setPhase("loading"), []);
  const isRemoteUrl = /^https?:\/\//i.test(playableVideoUrl);
  const isLocalUrl = /^(blob:|file:|data:)/i.test(playableVideoUrl);
  const canMountPlayer = isRemoteUrl || isLocalUrl;
  const isHlsUrl = /\.m3u8(?:[?#]|$)/i.test(playableVideoUrl);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    playableVideoUrlRef.current = playableVideoUrl;
  }, [playableVideoUrl]);

  const refreshMedia = useCallback(async (): Promise<boolean> => {
    const currentUrl = playableVideoUrlRef.current;
    if (!messageId || !videoSourceRef || refreshAttemptedForUrlRef.current === currentUrl) return false;
    const freshVideoUrl = await refreshCachedChatMediaUrl(messageId, mediaKind, videoSourceRef);
    const freshPosterUrl = thumbnailSourceRef
      ? await refreshCachedChatMediaUrl(messageId, "thumbnail", thumbnailSourceRef)
      : null;
    if (freshPosterUrl) {
      setPlayablePosterUrl(freshPosterUrl);
      onResolvedThumbnailUrl?.(freshPosterUrl);
    }
    if (!freshVideoUrl || freshVideoUrl === currentUrl) return false;
    refreshAttemptedForUrlRef.current = currentUrl;
    setPlayableVideoUrl(freshVideoUrl);
    onResolvedVideoUrl?.(freshVideoUrl);
    return true;
  }, [
    mediaKind,
    messageId,
    onResolvedThumbnailUrl,
    onResolvedVideoUrl,
    thumbnailSourceRef,
    videoSourceRef,
  ]);

  useEffect(() => {
    playableVideoUrlRef.current = videoUrl;
    setPlayableVideoUrl(videoUrl);
    setPlayablePosterUrl(posterUrl ?? null);
    refreshAttemptedForUrlRef.current = null;
    resetPhase();
    const v = videoRef.current;
    if (!/^https?:\/\//i.test(videoUrl) && !/^(blob:|file:|data:)/i.test(videoUrl) && videoSourceRef) {
      void refreshMedia().then((didRefresh) => {
        if (!didRefresh) setPhase("error");
      });
      return;
    }
    if (!/^https?:\/\//i.test(videoUrl) && !/^(blob:|file:|data:)/i.test(videoUrl)) {
      setPhase("error");
      return;
    }
    if (!v) return;
    const t = window.setTimeout(() => {
      void v.play().catch(() => {});
    }, 120);
    return () => {
      window.clearTimeout(t);
      v.pause();
    };
  }, [posterUrl, refreshMedia, resetPhase, videoSourceRef, videoUrl]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !isRemoteUrl || !isHlsUrl) return;
    return attachHlsPlayback(v, playableVideoUrl, {
      autoPlay: true,
      onManifestParsed: () => setPhase("ready"),
      onError: () => {
        void refreshMedia().then((didRefresh) => {
          if (!didRefresh) setPhase("error");
        });
      },
    });
  }, [isHlsUrl, isRemoteUrl, playableVideoUrl, refreshMedia]);

  useEffect(() => {
    if (phase !== "loading" || !canMountPlayer) return;
    const timeoutId = window.setTimeout(() => {
      void refreshMedia().then((didRefresh) => {
        if (!didRefresh) setPhase("error");
      });
    }, CLIP_PLAYBACK_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [canMountPlayer, phase, playableVideoUrl, refreshMedia]);

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Video viewer"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
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
          initial={{ opacity: 0, scale: 0.97, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="relative w-full max-w-4xl overflow-hidden rounded-2xl border border-white/[0.08] bg-black shadow-[0_0_0_1px_rgba(168,85,247,0.12),0_24px_80px_-12px_rgba(0,0,0,0.85),0_0_120px_-20px_rgba(168,85,247,0.15)] ring-1 ring-fuchsia-500/10"
        >
          {phase === "loading" ? (
            <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/55 backdrop-blur-[2px]">
              <div className="flex items-center gap-2.5 rounded-full border border-white/10 bg-black/50 px-4 py-2.5 shadow-inner">
                <Loader2 className="h-5 w-5 animate-spin text-fuchsia-300/90" aria-hidden />
                <span className="text-[12px] font-medium tracking-tight text-white/88">Preparing playback…</span>
              </div>
            </div>
          ) : null}

          {phase === "error" ? (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/80 px-6">
              <AlertCircle className="h-10 w-10 text-fuchsia-400/80" />
              <p className="text-center text-sm text-white/75">Couldn&apos;t play this video.</p>
              <button
                type="button"
                className="rounded-full border border-fuchsia-500/35 bg-fuchsia-500/10 px-5 py-2 text-xs font-semibold text-fuchsia-200 transition-colors hover:bg-fuchsia-500/20"
                onClick={() => {
                  refreshAttemptedForUrlRef.current = null;
                  resetPhase();
                  void refreshMedia().then((didRefresh) => {
                    if (didRefresh) return;
                    videoRef.current?.load();
                    void videoRef.current?.play().catch(() => setPhase("error"));
                  });
                }}
              >
                Try again
              </button>
            </div>
          ) : null}

          <div className="relative w-full bg-black">
            {canMountPlayer ? (
              <video
                ref={videoRef}
                src={isHlsUrl ? undefined : playableVideoUrl}
                poster={playablePosterUrl ?? undefined}
                className="aspect-video max-h-[min(78dvh,800px)] w-full bg-black object-contain"
                controls
                playsInline
                controlsList="nodownload"
                onLoadStart={() => setPhase("loading")}
                onLoadedData={() => setPhase("ready")}
                onCanPlay={() => setPhase("ready")}
                onPlaying={() => setPhase("ready")}
                onWaiting={() => setPhase("loading")}
                onError={() => {
                  void refreshMedia().then((didRefresh) => {
                    if (!didRefresh) setPhase("error");
                  });
                }}
              />
            ) : (
              <div className="aspect-video max-h-[min(78dvh,800px)] w-full bg-black" />
            )}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
