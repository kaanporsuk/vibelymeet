import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Play,
  Volume2,
  VolumeX,
  Maximize,
  AlertCircle,
  Loader2,
  Film,
} from "lucide-react";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import type { VibeClipDisplayMeta } from "../../../shared/chat/messageRouting";

interface VibeClipBubbleProps {
  meta: VibeClipDisplayMeta;
  isMine: boolean;
  onReplyWithClip?: () => void;
  onVoiceReply?: () => void;
}

export const VibeClipBubble = ({ meta, isMine, onReplyWithClip, onVoiceReply }: VibeClipBubbleProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [hasMetadata, setHasMetadata] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);

  const isIosSafari = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua);
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
  }, [meta.videoUrl]);

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

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().then(() => {
        setIsPlaying(true);
        setHasPlayed(true);
      }).catch((err: unknown) => {
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
    if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
  }, []);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(0);
  }, []);

  const progress = meta.durationSec > 0 ? (currentTime / meta.durationSec) * 100 : 0;

  if (loadError) {
    return (
      <div className="w-56 rounded-2xl overflow-hidden bg-secondary/50 flex flex-col items-center justify-center py-8 px-4 gap-2">
        <AlertCircle className="w-6 h-6 text-muted-foreground" />
        <span className="text-xs text-muted-foreground text-center">Clip unavailable</span>
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
    <div
      className={[
        "w-56 rounded-2xl overflow-hidden relative group",
        isMine
          ? "ring-1 ring-violet-500/40 bg-violet-500/5"
          : "ring-1 ring-white/10 bg-white/[0.03]",
      ].join(" ")}
    >
      {/* Branded header */}
      <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/12 border border-violet-500/25 px-2 py-0.5">
          <Film className="w-3 h-3 text-violet-400" />
          <span className="text-[10px] font-bold text-violet-400 tracking-wide">Vibe Clip</span>
        </span>
      </div>

      {/* Video surface */}
      <div className="cursor-pointer" onClick={togglePlay}>
        <AspectRatio ratio={9 / 16}>
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
                  <span className="text-xs text-white/80">Loading clip</span>
                </div>
              </div>
              <div className="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-black/60 to-transparent">
                <span className="text-[10px] text-white/70 font-mono">{meta.durationLabel}</span>
              </div>
            </div>
          )}

          <video
            ref={videoRef}
            src={meta.videoUrl}
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
              "w-full h-full object-cover bg-black transition-opacity duration-300",
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
              <div className="w-12 h-12 rounded-full bg-violet-500/30 backdrop-blur-sm flex items-center justify-center ring-1 ring-violet-400/40">
                <Play className="w-6 h-6 text-white ml-0.5" fill="white" />
              </div>
            </motion.div>
          )}

          {/* Bottom controls */}
          <div className="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-black/60 to-transparent">
            <div className="w-full h-1 rounded-full bg-white/30 mb-2">
              <div
                className="h-full rounded-full bg-violet-400 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-white/80 font-mono">
                {isPlaying ? formatDuration(Math.round(currentTime)) : meta.durationLabel}
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

      {/* After-play interaction scaffold */}
      {hasPlayed && !isMine && (onReplyWithClip || onVoiceReply) && (
        <div className="flex items-center gap-1.5 px-2.5 py-2 border-t border-violet-500/15">
          {onReplyWithClip && (
            <button
              onClick={onReplyWithClip}
              className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 border border-violet-500/20 px-2.5 py-1 text-[10px] font-semibold text-violet-400 hover:bg-violet-500/20 transition-colors"
            >
              <Film className="w-3 h-3" />
              Reply with clip
            </button>
          )}
          {onVoiceReply && (
            <button
              onClick={onVoiceReply}
              className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 border border-violet-500/20 px-2.5 py-1 text-[10px] font-semibold text-violet-400 hover:bg-violet-500/20 transition-colors"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
              Voice reply
            </button>
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
