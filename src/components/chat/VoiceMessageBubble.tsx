import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Play, Pause, Loader2, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface VoiceMessageBubbleProps {
  audioUrl: string;
  duration: number;
  isMine: boolean;
}

const generateWaveformData = (length: number = 30): number[] => {
  const data: number[] = [];
  for (let i = 0; i < length; i++) {
    const base = 0.2 + Math.random() * 0.5;
    const variation = Math.sin(i * 0.4) * 0.15;
    data.push(Math.min(1, Math.max(0.1, base + variation)));
  }
  return data;
};

export const VoiceMessageBubble = ({ audioUrl, duration: initialDuration, isMine }: VoiceMessageBubbleProps) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [resolvedDuration, setResolvedDuration] = useState(initialDuration);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const waveformData = useMemo(() => generateWaveformData(30), []);

  const duration = resolvedDuration || initialDuration;

  // Create and configure audio element
  useEffect(() => {
    if (!audioUrl) { setHasError(true); return; }

    const audio = new Audio();
    audio.preload = "metadata";
    audio.crossOrigin = "anonymous";
    audio.src = audioUrl;
    audioRef.current = audio;

    const onCanPlay = () => setIsLoading(false);
    const onWaiting = () => setIsLoading(true);
    const onError = () => {
      console.error("Audio failed to load:", audioUrl);
      setIsLoading(false);
      setHasError(true);
      setIsPlaying(false);
    };
    const onTimeUpdate = () => {
      if (audio.duration && isFinite(audio.duration) && audio.duration !== Infinity) {
        setProgress((audio.currentTime / audio.duration) * 100);
        setCurrentTime(audio.currentTime);
      }
    };
    const onDurationChange = () => {
      if (audio.duration && isFinite(audio.duration) && audio.duration !== Infinity) {
        setResolvedDuration(Math.round(audio.duration));
      }
    };
    const onLoadedMetadata = () => {
      if (audio.duration && isFinite(audio.duration) && audio.duration !== Infinity) {
        setResolvedDuration(Math.round(audio.duration));
      }
    };
    const onEnded = () => {
      setIsPlaying(false);
      setProgress(0);
      setCurrentTime(0);
    };

    audio.addEventListener("canplaythrough", onCanPlay);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("error", onError);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.removeEventListener("canplaythrough", onCanPlay);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
      audio.pause();
      audio.src = "";
    };
  }, [audioUrl]);

  const togglePlay = useCallback(async () => {
    if (!audioRef.current || hasError) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      setIsLoading(true);
      setHasError(false);
      try {
        await audioRef.current.play();
        setIsPlaying(true);
        setIsLoading(false);
      } catch (err) {
        console.error("Playback error:", err);
        setIsLoading(false);
        setHasError(true);
      }
    }
  }, [isPlaying, hasError]);

  const retry = useCallback(() => {
    setHasError(false);
    if (audioRef.current) {
      audioRef.current.load();
    }
  }, []);

  const formatDuration = (s: number) => {
    const totalSecs = Math.round(s);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const displayTime = isPlaying || currentTime > 0 ? formatDuration(currentTime) : formatDuration(duration);

  return (
    <div className="flex items-center gap-2.5 min-w-[160px]">
      {/* Play/Pause button */}
      <motion.button
        whileTap={{ scale: 0.9 }}
        onClick={hasError ? retry : togglePlay}
        className={cn(
          "w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-colors",
          isMine ? "bg-primary-foreground/20 hover:bg-primary-foreground/30" : "bg-primary/15 hover:bg-primary/25"
        )}
      >
        {isLoading ? (
          <Loader2 className={cn("w-4 h-4 animate-spin", isMine ? "text-primary-foreground" : "text-primary")} />
        ) : hasError ? (
          <AlertCircle className="w-4 h-4 text-destructive" />
        ) : isPlaying ? (
          <Pause className={cn("w-4 h-4", isMine ? "text-primary-foreground" : "text-foreground")} />
        ) : (
          <Play className={cn("w-4 h-4 ml-0.5", isMine ? "text-primary-foreground" : "text-foreground")} />
        )}
      </motion.button>

      {/* Waveform + time */}
      <div className="flex-1 min-w-0 space-y-1">
        {/* Waveform bars */}
        <div className="flex items-center gap-[2px] h-6">
          {waveformData.map((height, i) => {
            const barPct = (i / waveformData.length) * 100;
            const isPlayed = barPct <= progress;
            return (
              <div
                key={i}
                className={cn(
                  "w-[2.5px] rounded-full transition-colors duration-100",
                  isMine
                    ? isPlayed ? "bg-primary-foreground" : "bg-primary-foreground/35"
                    : isPlayed ? "bg-primary" : "bg-muted-foreground/25"
                )}
                style={{ height: `${height * 100}%` }}
              />
            );
          })}
        </div>
        <span className={cn("text-[10px] font-mono", isMine ? "text-primary-foreground/70" : "text-muted-foreground")}>
          {displayTime}
        </span>
      </div>
    </div>
  );
};
