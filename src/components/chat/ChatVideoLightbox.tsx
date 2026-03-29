import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type ChatVideoLightboxProps = {
  videoUrl: string;
  posterUrl?: string | null;
  onClose: () => void;
};

export function ChatVideoLightbox({ videoUrl, posterUrl, onClose }: ChatVideoLightboxProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [showLoader, setShowLoader] = useState(true);

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
    setShowLoader(true);
    const v = videoRef.current;
    if (!v) return;
    const t = window.setTimeout(() => {
      void v.play().catch(() => {});
    }, 120);
    return () => {
      window.clearTimeout(t);
      v.pause();
    };
  }, [videoUrl]);

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Video viewer"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-0 z-[200] flex flex-col bg-black"
    >
      <motion.button
        type="button"
        aria-label="Close video"
        className="absolute inset-0 z-0 bg-black"
        initial={{ opacity: 0.92 }}
        animate={{ opacity: 1 }}
        onClick={onClose}
      />

      <div className="relative z-10 flex justify-end px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-10 w-10 rounded-full text-white hover:bg-white/10"
          aria-label="Close"
        >
          <X className="h-6 w-6" />
        </Button>
      </div>

      <div
        className="relative z-10 flex flex-1 items-center justify-center px-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="relative w-full max-w-4xl overflow-hidden rounded-2xl bg-black ring-1 ring-white/10 shadow-2xl"
        >
          <div className="relative w-full">
            {showLoader ? (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/40">
                <Loader2 className="h-10 w-10 animate-spin text-white/70" aria-hidden />
              </div>
            ) : null}
            <video
              ref={videoRef}
              src={videoUrl}
              poster={posterUrl ?? undefined}
              className="aspect-video max-h-[min(78dvh,800px)] w-full bg-black object-contain"
              controls
              playsInline
              controlsList="nodownload"
              onLoadStart={() => setShowLoader(true)}
              onLoadedData={() => setShowLoader(false)}
              onPlaying={() => setShowLoader(false)}
              onWaiting={() => setShowLoader(true)}
              onError={() => setShowLoader(false)}
            />
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
