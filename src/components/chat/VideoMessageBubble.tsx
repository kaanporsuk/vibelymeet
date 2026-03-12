import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { Play, Volume2, VolumeX, Maximize, AlertCircle, Loader2 } from "lucide-react";
import { AspectRatio } from "@/components/ui/aspect-ratio";

interface VideoMessageBubbleProps {
  videoUrl: string;
  duration: number;
  isMine: boolean;
}

const formatDuration = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

export const VideoMessageBubble = ({ videoUrl, duration, isMine }: VideoMessageBubbleProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [hasMetadata, setHasMetadata] = useState(false);
  const [loadError, setLoadError] = useState(false);

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
    setIsPlaying(false);
    setCurrentTime(0);
    setIsLoading(true);
    setIsReady(false);
    setHasMetadata(false);
    setLoadError(false);
  }, [videoUrl]);

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

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().then(() => setIsPlaying(true)).catch((err: unknown) => {
        const name = err instanceof Error ? err.name : "";
        if (name === "AbortError" || name === "NotAllowedError" || name === "NotSupportedError") {
          setLoadError(true);
        }
      });
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }, []);

  const toggleMute = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  }, []);

  const handleFullscreen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    if (video.requestFullscreen) {
      video.requestFullscreen();
    } else if ((video as any).webkitEnterFullscreen) {
      (video as any).webkitEnterFullscreen();
    }
  }, []);

  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  }, []);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(0);
  }, []);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (loadError) {
    return (
      <div className="w-56 rounded-2xl overflow-hidden bg-secondary/50 flex flex-col items-center justify-center py-8 px-4 gap-2">
        <AlertCircle className="w-6 h-6 text-muted-foreground" />
        <span className="text-xs text-muted-foreground text-center">Video unavailable</span>
        <button
          onClick={() => {
            setLoadError(false);
            setIsLoading(true);
            setIsReady(false);
            setIsPlaying(false);
            setCurrentTime(0);
            videoRef.current?.load();
          }}
          className="text-xs text-primary hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="w-56 rounded-2xl overflow-hidden relative group cursor-pointer" onClick={togglePlay}>
      <AspectRatio ratio={9 / 16}>
        {/* Premium loading placeholder */}
        {!isReady && (
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
              <div className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 backdrop-blur-sm">
                <Loader2 className="h-4 w-4 animate-spin text-white/80" />
                <span className="text-xs text-white/80">Loading video</span>
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

        <video
          ref={videoRef}
          src={videoUrl}
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
            setLoadError(true);
          }}
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded}
          className={[
            "w-full h-full object-cover bg-black",
            "transition-opacity duration-300",
            isReady ? "opacity-100" : "opacity-0",
          ].join(" ")}
        />

        {/* Play overlay */}
        {!isPlaying && isReady && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 flex items-center justify-center bg-black/30"
          >
            <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <Play className="w-6 h-6 text-white ml-0.5" fill="white" />
            </div>
          </motion.div>
        )}

        {/* Bottom controls */}
        <div className="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-black/60 to-transparent">
          {/* Progress bar */}
          <div className="w-full h-1 rounded-full bg-white/30 mb-2">
            <div
              className="h-full rounded-full bg-white transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[10px] text-white/80 font-mono">
              {isPlaying ? formatDuration(Math.round(currentTime)) : formatDuration(duration)}
            </span>
            <div className="flex items-center gap-1.5">
              <button onClick={toggleMute} className="text-white/80 hover:text-white">
                {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              </button>
              <button onClick={handleFullscreen} className="text-white/80 hover:text-white">
                <Maximize className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </AspectRatio>
    </div>
  );
};
