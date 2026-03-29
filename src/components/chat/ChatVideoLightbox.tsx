import { useEffect, useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Loader2, X, AlertCircle } from "lucide-react";

type ChatVideoLightboxProps = {
  videoUrl: string;
  posterUrl?: string | null;
  onClose: () => void;
};

export function ChatVideoLightbox({ videoUrl, posterUrl, onClose }: ChatVideoLightboxProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");

  const resetPhase = useCallback(() => setPhase("loading"), []);

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
    resetPhase();
    const v = videoRef.current;
    if (!v) return;
    const t = window.setTimeout(() => {
      void v.play().catch(() => {});
    }, 120);
    return () => {
      window.clearTimeout(t);
      v.pause();
    };
  }, [videoUrl, resetPhase]);

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

      <header className="relative z-20 flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-transparent bg-clip-text bg-gradient-to-r from-fuchsia-400/95 via-violet-300/90 to-pink-400/90">
          Video
        </p>
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
                  resetPhase();
                  videoRef.current?.load();
                  void videoRef.current?.play().catch(() => setPhase("error"));
                }}
              >
                Try again
              </button>
            </div>
          ) : null}

          <div className="relative w-full bg-black">
            <video
              ref={videoRef}
              src={videoUrl}
              poster={posterUrl ?? undefined}
              className="aspect-video max-h-[min(78dvh,800px)] w-full bg-black object-contain"
              controls
              playsInline
              controlsList="nodownload"
              onLoadStart={() => setPhase("loading")}
              onLoadedData={() => setPhase("ready")}
              onCanPlay={() => setPhase("ready")}
              onPlaying={() => setPhase("ready")}
              onWaiting={() => setPhase("loading")}
              onError={() => setPhase("error")}
            />
          </div>

          <p className="border-t border-white/[0.06] bg-black/40 px-4 py-2.5 text-center text-[10px] font-medium tracking-wide text-white/40">
            System controls below · Esc to close
          </p>
        </motion.div>
      </div>
    </motion.div>
  );
}
