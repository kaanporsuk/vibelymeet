import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Play, Pause, Loader2, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface VoiceMessageBubbleProps {
  audioUrl?: string;
  duration: number;
  isMine: boolean;
}

/** Stable pseudo-waveform per message (no random remount flicker). */
function waveformHeightsFromSeed(seed: string, length: number): number[] {
  let h = 2166136261;
  for (let c = 0; c < seed.length; c++) {
    h ^= seed.charCodeAt(c);
    h = Math.imul(h, 16777619);
  }
  const out: number[] = [];
  for (let i = 0; i < length; i++) {
    h ^= i * 2654435761;
    h = Math.imul(h, 1597334677);
    const t = (h >>> 0) / 4294967296;
    const wave = 0.42 + 0.38 * Math.sin(i * 0.35 + t * 6.28) + 0.12 * Math.sin(i * 0.71 + t * 3.14);
    out.push(Math.min(1, Math.max(0.12, wave)));
  }
  return out;
}

export const VoiceMessageBubble = ({ audioUrl, duration: initialDuration, isMine }: VoiceMessageBubbleProps) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [resolvedDuration, setResolvedDuration] = useState(initialDuration);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const waveformData = useMemo(
    () => waveformHeightsFromSeed(`${audioUrl ?? ""}|${initialDuration}`, 28),
    [audioUrl, initialDuration],
  );

  const totalDuration = (() => {
    const resolved = Number.isFinite(resolvedDuration) && resolvedDuration > 0 ? resolvedDuration : 0;
    const initial = Number.isFinite(initialDuration) && initialDuration > 0 ? initialDuration : 0;
    return resolved > 0 ? resolved : initial;
  })();

  // Create and configure audio element
  useEffect(() => {
    if (!audioUrl) {
      setHasError(false);
      setIsLoading(false);
      setIsPlaying(false);
      setProgress(0);
      setCurrentTime(0);
      audioRef.current = null;
      return;
    }

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
      } catch {
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

  // Canonical voice timing ownership: only this component renders voice time labels.
  // Parent/footer status rows must not add a second time readout for voice bubbles.
  const displayTime = (() => {
    if (totalDuration <= 0 && !isPlaying && currentTime <= 0) return "Voice message";
    if (isPlaying && totalDuration > 0) return `${formatDuration(currentTime)} · ${formatDuration(totalDuration)}`;
    if (isPlaying) return formatDuration(currentTime);
    return formatDuration(totalDuration > 0 ? totalDuration : currentTime);
  })();

  return (
    <div className="flex items-center gap-2 min-w-[148px]">
      {/* Play/Pause button */}
      <motion.button
        whileTap={{ scale: 0.94 }}
        onClick={hasError ? retry : togglePlay}
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ring-1",
          isMine
            ? "bg-primary-foreground/18 hover:bg-primary-foreground/28 ring-primary-foreground/15"
            : "bg-primary/12 hover:bg-primary/22 ring-primary/20"
        )}
      >
        {isLoading ? (
          <Loader2 className={cn("w-3.5 h-3.5 animate-spin", isMine ? "text-primary-foreground" : "text-primary")} />
        ) : hasError ? (
          <AlertCircle className="w-3.5 h-3.5 text-destructive" />
        ) : isPlaying ? (
          <Pause className={cn("w-3.5 h-3.5", isMine ? "text-primary-foreground" : "text-foreground")} />
        ) : (
          <Play className={cn("w-3.5 h-3.5 ml-0.5", isMine ? "text-primary-foreground" : "text-foreground")} />
        )}
      </motion.button>

      {/* Waveform + time */}
      <div className="flex-1 min-w-0 space-y-0.5">
        <div
          className={cn(
            "flex items-center gap-px h-5 rounded-full px-1",
            isMine ? "bg-primary-foreground/10" : "bg-muted/45",
          )}
          role="img"
          aria-label="Voice level"
        >
          {waveformData.map((height, i) => {
            const barPct = (i / Math.max(1, waveformData.length - 1)) * 100;
            const isPlayed = barPct <= progress;
            return (
              <div
                key={i}
                className={cn(
                  "w-[2px] rounded-full transition-colors duration-150",
                  isMine
                    ? isPlayed
                      ? "bg-primary-foreground shadow-[0_0_6px_rgba(255,255,255,0.25)]"
                      : "bg-primary-foreground/30"
                    : isPlayed
                      ? "bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.35)]"
                      : "bg-muted-foreground/20",
                )}
                style={{ height: `${height * 100}%` }}
              />
            );
          })}
        </div>
        <span
          className={cn(
            "text-[10px] font-mono tabular-nums tracking-tight",
            isMine ? "text-primary-foreground/75" : "text-muted-foreground",
          )}
        >
          {displayTime}
        </span>
      </div>
    </div>
  );
};
