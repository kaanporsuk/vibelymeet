import { useState, useRef } from "react";
import { Play, Pause } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface VoiceMessageBubbleProps {
  audioUrl: string;
  duration: number;
  isMine: boolean;
}

export const VoiceMessageBubble = ({ audioUrl, duration, isMine }: VoiceMessageBubbleProps) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setProgress((audioRef.current.currentTime / audioRef.current.duration) * 100);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setProgress(0);
  };

  const formatDuration = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex items-center gap-3 min-w-[180px]">
      <audio ref={audioRef} src={audioUrl} onTimeUpdate={handleTimeUpdate} onEnded={handleEnded} preload="metadata" />
      <motion.button
        whileTap={{ scale: 0.9 }}
        onClick={togglePlay}
        className={cn(
          "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
          isMine ? "bg-primary-foreground/20" : "bg-primary/20"
        )}
      >
        {isPlaying ? (
          <Pause className="w-4 h-4" />
        ) : (
          <Play className="w-4 h-4 ml-0.5" />
        )}
      </motion.button>
      <div className="flex-1 space-y-1">
        <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
          <motion.div
            className={cn("h-full rounded-full", isMine ? "bg-primary-foreground/60" : "bg-primary/60")}
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-[10px] opacity-70">{formatDuration(duration)}</span>
      </div>
    </div>
  );
};
