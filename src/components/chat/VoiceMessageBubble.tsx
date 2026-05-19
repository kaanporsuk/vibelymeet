import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Play, Pause, Loader2, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useMediaAsset } from "@/hooks/useMediaAsset";
import { waveformHeightsFromSeed } from "../../../shared/chat/voiceWaveformSeed";

interface VoiceMessageBubbleProps {
  audioUrl?: string;
  audioSourceRef?: string;
  messageId?: string;
  duration: number;
  isMine: boolean;
}

export const VoiceMessageBubble = ({
  audioUrl,
  audioSourceRef,
  messageId,
  duration: initialDuration,
  isMine,
}: VoiceMessageBubbleProps) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [resolvedDuration, setResolvedDuration] = useState(initialDuration);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingAutoplayRef = useRef(false);
  const refreshAttemptedForUrlRef = useRef<string | null>(null);
  const { url: mediaAssetUrl, refresh: refreshMediaAsset } = useMediaAsset({
    kind: "voice",
    messageId,
    sourceRef: audioSourceRef,
    initialUrl: audioUrl,
    autoResolve: false,
  });
  const [playableUrl, setPlayableUrl] = useState(mediaAssetUrl ?? audioUrl);
  const waveformData = useMemo(
    () => waveformHeightsFromSeed(`${audioSourceRef ?? playableUrl ?? ""}|${initialDuration}`, 28),
    [audioSourceRef, playableUrl, initialDuration],
  );

  const totalDuration = (() => {
    const resolved = Number.isFinite(resolvedDuration) && resolvedDuration > 0 ? resolvedDuration : 0;
    const initial = Number.isFinite(initialDuration) && initialDuration > 0 ? initialDuration : 0;
    return resolved > 0 ? resolved : initial;
  })();

  useEffect(() => {
    setPlayableUrl(mediaAssetUrl ?? audioUrl);
    setHasError(false);
    refreshAttemptedForUrlRef.current = null;
  }, [audioUrl, mediaAssetUrl]);

  const refreshAudioUrl = useCallback(async (): Promise<string | null> => {
    if (!messageId || !audioSourceRef) return null;
    const freshUrl = await refreshMediaAsset("playback");
    if (!freshUrl) return null;
    setPlayableUrl(freshUrl);
    return freshUrl;
  }, [audioSourceRef, messageId, refreshMediaAsset]);

  // Create and configure audio element
  useEffect(() => {
    if (!playableUrl) {
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
    // Do not set crossOrigin: voice files are served from CDN/storage without CORS for anonymous
    // reads in many setups; credentialed CORS mode causes the element to fail load/play in browsers.
    audio.src = playableUrl;
    audioRef.current = audio;

    const onCanPlay = () => setIsLoading(false);
    const onWaiting = () => setIsLoading(true);
    const onError = () => {
      setIsLoading(false);
      setIsPlaying(false);
      if (audioSourceRef && messageId && refreshAttemptedForUrlRef.current !== playableUrl) {
        void refreshAudioUrl().then((freshUrl) => {
          if (!freshUrl || freshUrl === playableUrl) {
            setHasError(true);
            return;
          }
          refreshAttemptedForUrlRef.current = playableUrl ?? null;
        });
        return;
      }
      setHasError(true);
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

    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("canplaythrough", onCanPlay);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("error", onError);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);

    if (pendingAutoplayRef.current) {
      pendingAutoplayRef.current = false;
      setIsLoading(true);
      void audio.play()
        .then(() => {
          setIsPlaying(true);
          setIsLoading(false);
          setHasError(false);
        })
        .catch(() => {
          setIsLoading(false);
          setHasError(true);
        });
    }

    return () => {
      audio.removeEventListener("canplay", onCanPlay);
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
  }, [audioSourceRef, messageId, playableUrl, refreshAudioUrl]);

  const playCurrentAudio = useCallback(async () => {
    if (!audioRef.current) throw new Error("audio_unavailable");
    await audioRef.current.play();
    setIsPlaying(true);
    setIsLoading(false);
    setHasError(false);
  }, []);

  const refreshAndPlay = useCallback(async (fallbackToCurrentAudio: boolean): Promise<boolean> => {
    setHasError(false);
    setIsLoading(true);
    pendingAutoplayRef.current = true;
    const freshUrl = await refreshAudioUrl();

    if (freshUrl && freshUrl !== playableUrl) {
      refreshAttemptedForUrlRef.current = playableUrl ?? null;
      return true;
    }

    pendingAutoplayRef.current = false;
    if (!freshUrl && !fallbackToCurrentAudio) {
      setIsLoading(false);
      setHasError(true);
      return false;
    }

    try {
      if (!freshUrl) audioRef.current?.load();
      await playCurrentAudio();
      return true;
    } catch {
      setIsLoading(false);
      setHasError(true);
      return false;
    }
  }, [playCurrentAudio, playableUrl, refreshAudioUrl]);

  const togglePlay = useCallback(async () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      setIsLoading(true);
      setHasError(false);
      try {
        await playCurrentAudio();
      } catch {
        if (audioSourceRef && messageId && refreshAttemptedForUrlRef.current !== playableUrl) {
          await refreshAndPlay(false);
          return;
        }
        setIsLoading(false);
        setHasError(true);
      }
    }
  }, [audioSourceRef, isPlaying, messageId, playableUrl, playCurrentAudio, refreshAndPlay]);

  const retry = useCallback(async () => {
    await refreshAndPlay(true);
  }, [refreshAndPlay]);

  const formatDuration = (s: number) => {
    const totalSecs = Math.round(s);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Canonical voice timing ownership: only this component renders voice time labels.
  const displayTime = (() => {
    const dur = formatDuration(totalDuration > 0 ? totalDuration : Math.max(0, Math.round(currentTime)));
    if (totalDuration <= 0 && !isPlaying && currentTime <= 0) return "0:00";
    if (isPlaying && totalDuration > 0)
      return `${formatDuration(Math.max(0, Math.floor(currentTime)))} · ${formatDuration(totalDuration)}`;
    if (isPlaying) return formatDuration(Math.max(0, Math.floor(currentTime)));
    return dur;
  })();

  return (
    <div className="flex items-center gap-1.5 min-w-[140px] w-full max-w-[min(18rem,100%)]">
      {/* Play/Pause button */}
      <motion.button
        whileTap={{ scale: 0.94 }}
        onClick={hasError ? retry : togglePlay}
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all duration-200 ring-1 shadow-sm",
          isMine
            ? "bg-primary-foreground/18 hover:bg-primary-foreground/28 ring-primary-foreground/25 shadow-[0_0_20px_rgba(255,255,255,0.08)]"
            : "bg-primary/14 hover:bg-primary/24 ring-fuchsia-400/25 shadow-[0_0_24px_hsl(var(--primary)/0.2)]"
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
      <div className="flex-1 min-w-0 space-y-0">
        <span
          className={cn(
            "text-[9px] font-semibold uppercase tracking-wide block mb-0.5",
            isMine ? "text-primary-foreground/55" : "text-muted-foreground/80",
          )}
        >
          Voice
        </span>
        <div
          className={cn(
            "flex items-center gap-px h-[18px] rounded-full px-1 border backdrop-blur-[2px]",
            isMine
              ? "bg-primary-foreground/[0.09] border-primary-foreground/10"
              : "bg-black/20 border-white/[0.08]",
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
            "text-[10px] font-mono tabular-nums tracking-tight mt-1 block leading-none",
            isMine ? "text-primary-foreground/85" : "text-muted-foreground/90",
          )}
        >
          {displayTime}
        </span>
      </div>
    </div>
  );
};
