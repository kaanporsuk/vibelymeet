import { useState, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { Play, Pause, Volume2, VolumeX, Maximize, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
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
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
      setIsPlaying(true);
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
          onClick={() => { setLoadError(false); }}
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
        <video
          ref={videoRef}
          src={videoUrl}
          playsInline
          muted={isMuted}
          preload="metadata"
          onLoadedData={() => setLoaded(true)}
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded}
          className="w-full h-full object-cover bg-black"
        />

        {/* Play overlay */}
        {!isPlaying && (
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
