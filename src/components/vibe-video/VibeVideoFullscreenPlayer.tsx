import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import * as Sentry from "@sentry/react";
import {
  getWebVibeVideoPlaybackUrl,
  getWebVibeVideoThumbnailUrl,
  normalizeBunnyVideoStatus,
} from "@/lib/vibeVideo/webVibeVideoState";

type Props = {
  show: boolean;
  bunnyVideoUid: string | null;
  bunnyVideoStatus: string;
  vibeCaption: string;
  onClose: () => void;
};

/**
 * Fullscreen HLS playback (Safari native + hls.js elsewhere) with honest error overlay
 * when the stream is "ready" in DB but manifest/media fails.
 */
export function VibeVideoFullscreenPlayer({ show, bunnyVideoUid, bunnyVideoStatus, vibeCaption, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);
  const [playbackFailed, setPlaybackFailed] = useState(false);

  const norm = normalizeBunnyVideoStatus(bunnyVideoStatus);
  const isReady = norm === "ready" && !!bunnyVideoUid?.trim();

  useEffect(() => {
    let cancelled = false;
    setPlaybackFailed(false);
    if (!show || !isReady || !bunnyVideoUid) return;

    const src = getWebVibeVideoPlaybackUrl(bunnyVideoUid);
    if (!src) {
      setPlaybackFailed(true);
      Sentry.addBreadcrumb({
        category: "vibe-video-playback",
        message: "fullscreen_missing_cdn_or_uid",
        level: "warning",
        data: { hasUid: true },
      });
      return;
    }

    const videoEl = videoRef.current;
    if (!videoEl) return;

    const onVideoError = () => {
      if (cancelled) return;
      setPlaybackFailed(true);
      Sentry.addBreadcrumb({
        category: "vibe-video-playback",
        message: "fullscreen_video_element_error",
        level: "error",
        data: { surface: "fullscreen" },
      });
    };

    videoEl.addEventListener("error", onVideoError);

    if (videoEl.canPlayType("application/vnd.apple.mpegurl")) {
      videoEl.src = src;
      videoEl.play().catch(() => {});
    } else {
      import("hls.js").then(({ default: Hls }) => {
        if (cancelled || !videoRef.current) return;
        if (!Hls.isSupported()) {
          setPlaybackFailed(true);
          return;
        }
        const hls = new Hls();
        hlsRef.current = hls;
        hls.loadSource(src);
        hls.attachMedia(videoRef.current);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          videoRef.current?.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            setPlaybackFailed(true);
            Sentry.addBreadcrumb({
              category: "vibe-video-playback",
              message: "fullscreen_hls_fatal",
              level: "error",
              data: { type: data.type },
            });
          }
        });
      });
    }

    return () => {
      cancelled = true;
      videoEl.removeEventListener("error", onVideoError);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      videoEl.pause();
      videoEl.removeAttribute("src");
      videoEl.load();
    };
  }, [show, bunnyVideoUid, bunnyVideoStatus, isReady]);

  const poster = bunnyVideoUid ? getWebVibeVideoThumbnailUrl(bunnyVideoUid) : null;

  return (
    <AnimatePresence>
      {show && isReady && bunnyVideoUid && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 bg-black flex items-center justify-center z-[9999]"
          style={{ height: "100dvh" }}
          onClick={onClose}
        >
          <button
            type="button"
            className="absolute top-4 right-4 z-30 w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.15)", backdropFilter: "blur(8px)" }}
            onClick={onClose}
            aria-label="Close video"
          >
            <X className="w-5 h-5 text-white" />
          </button>

          <video
            ref={videoRef}
            className={`w-full h-full object-contain ${playbackFailed ? "opacity-0" : "opacity-100"}`}
            poster={poster ?? undefined}
            playsInline
            loop
            onClick={(e) => e.stopPropagation()}
          />

          {playbackFailed && (
            <div
              className="absolute inset-0 z-20 flex flex-col items-center justify-center px-8 text-center"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-white text-base font-medium">Can&apos;t play right now</p>
              <p className="text-white/70 text-sm mt-2 max-w-sm">
                It&apos;s ready on our side, but playback didn&apos;t load. Try again in a moment.
              </p>
            </div>
          )}

          {vibeCaption && !playbackFailed && (
            <div
              className="absolute bottom-0 left-0 right-0 px-6 pb-8 pointer-events-none z-10"
              style={{
                background: "linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%)",
              }}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <div
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: "linear-gradient(135deg, #8B5CF6, #E84393)" }}
                />
                <span
                  className="text-xs font-semibold uppercase tracking-widest"
                  style={{
                    background: "linear-gradient(90deg, #8B5CF6, #E84393)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  Vibing on
                </span>
              </div>
              <p
                className="text-white font-bold leading-tight"
                style={{
                  fontSize: "22px",
                  letterSpacing: "-0.3px",
                  textShadow: "0 2px 12px rgba(0,0,0,0.5)",
                }}
              >
                {vibeCaption}
              </p>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
