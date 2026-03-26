import { useState, useRef, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Play, Pause, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VoiceMessagePlayerProps {
  audioUrl?: string;
  audioBlob?: Blob;
  duration: number;
  sender: 'me' | 'them';
  className?: string;
}

// Generate mock waveform data
const generateWaveformData = (length: number = 40): number[] => {
  const data: number[] = [];
  for (let i = 0; i < length; i++) {
    // Create a natural-looking waveform pattern
    const base = 0.3 + Math.random() * 0.4;
    const variation = Math.sin(i * 0.3) * 0.2;
    data.push(Math.min(1, Math.max(0.15, base + variation)));
  }
  return data;
};

const VoiceMessagePlayer = ({ 
  audioUrl, 
  audioBlob, 
  duration: initialDuration, 
  sender,
  className 
}: VoiceMessagePlayerProps) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(initialDuration);
  const [playbackSpeed, setPlaybackSpeed] = useState<1 | 1.5 | 2>(1);
  const [isDragging, setIsDragging] = useState(false);
  const [loadError, setLoadError] = useState(false);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const waveformData = useMemo(() => generateWaveformData(40), []);

  // Create audio element from blob or URL
  useEffect(() => {
    if (audioBlob) {
      const url = URL.createObjectURL(audioBlob);
      audioRef.current = new Audio(url);
      
      audioRef.current.onloadedmetadata = () => {
        if (audioRef.current) {
          setDuration(audioRef.current.duration);
        }
      };

      return () => {
        URL.revokeObjectURL(url);
      };
    } else if (audioUrl) {
      const audio = new Audio(audioUrl);
      audio.onerror = () => setLoadError(true);
      audioRef.current = audio;
    }
  }, [audioBlob, audioUrl]);

  // Update playback rate
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  // Handle time updates
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      if (!isDragging) {
        setCurrentTime(audio.currentTime);
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [isDragging]);

  // Play/pause toggle
  const togglePlayback = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {
        // Audio failed to load/play
      });
    }
    setIsPlaying(!isPlaying);
  };

  // Cycle playback speed
  const cycleSpeed = () => {
    setPlaybackSpeed((prev) => {
      if (prev === 1) return 1.5;
      if (prev === 1.5) return 2;
      return 1;
    });
  };

  // Handle waveform scrubbing
  const handleWaveformInteraction = (clientX: number) => {
    if (!waveformRef.current) return;

    const rect = waveformRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const newTime = percentage * duration;

    setCurrentTime(newTime);
    
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    handleWaveformInteraction(e.clientX);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      handleWaveformInteraction(e.clientX);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true);
    handleWaveformInteraction(e.touches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isDragging) {
      handleWaveformInteraction(e.touches[0].clientX);
    }
  };

  // Format time display
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const totalDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  // Calculate progress percentage
  const progress = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;
  const displayTime = (() => {
    if (totalDuration <= 0 && !isPlaying && currentTime <= 0) return 'Voice message';
    if (isPlaying && totalDuration > 0) return `${formatTime(currentTime)} · ${formatTime(totalDuration)}`;
    if (isPlaying) return formatTime(currentTime);
    return formatTime(totalDuration > 0 ? totalDuration : currentTime);
  })();


  const isMine = sender === 'me';

  if (loadError) {
    return (
      <div className={cn(
        "flex items-center gap-2 px-3 py-2.5 rounded-2xl min-w-[200px]",
        isMine ? "bg-primary/30" : "bg-secondary/50",
        className
      )}>
        <AlertCircle className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Voice message unavailable</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-3 p-3 rounded-2xl min-w-[200px] max-w-[280px]",
        isMine 
          ? "bg-gradient-to-r from-neon-violet to-neon-pink text-white" 
          : "glass-card border border-border/30",
        className
      )}
    >
      {/* Play/Pause button */}
      <motion.button
        whileTap={{ scale: 0.9 }}
        onClick={togglePlayback}
        className={cn(
          "shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors",
          isMine 
            ? "bg-white/20 hover:bg-white/30" 
            : "bg-secondary hover:bg-secondary/80"
        )}
      >
        {isPlaying ? (
          <Pause className={cn("w-5 h-5", isMine ? "text-white" : "text-foreground")} />
        ) : (
          <Play className={cn("w-5 h-5 ml-0.5", isMine ? "text-white" : "text-foreground")} />
        )}
      </motion.button>

      {/* Waveform and controls */}
      <div className="flex-1 min-w-0">
        {/* Waveform */}
        <div
          ref={waveformRef}
          className="flex items-center gap-0.5 h-8 cursor-pointer touch-none select-none"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleMouseUp}
        >
          {waveformData.map((height, i) => {
            const barProgress = (i / waveformData.length) * 100;
            const isPlayed = barProgress <= progress;
            
            return (
              <motion.div
                key={i}
                className={cn(
                  "w-1 rounded-full transition-colors duration-150",
                  isMine
                    ? isPlayed ? "bg-white" : "bg-white/40"
                    : isPlayed ? "bg-neon-violet" : "bg-muted-foreground/30"
                )}
                style={{ height: `${height * 100}%` }}
                animate={isPlaying && isPlayed ? { 
                  scaleY: [1, 1.1, 1],
                } : {}}
                transition={{
                  duration: 0.3,
                  delay: i * 0.02,
                }}
              />
            );
          })}
        </div>

        {/* Time and speed controls */}
        <div className="flex items-center justify-between mt-1">
          <span className={cn(
            "text-xs font-mono",
            isMine ? "text-white/80" : "text-muted-foreground"
          )}>
            {displayTime}
          </span>

          {/* Speed toggle */}
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={cycleSpeed}
            className={cn(
              "text-xs px-2 py-0.5 rounded-full font-medium transition-colors",
              isMine 
                ? "bg-white/20 hover:bg-white/30 text-white" 
                : "bg-secondary hover:bg-secondary/80 text-foreground"
            )}
          >
            {playbackSpeed}x
          </motion.button>
        </div>
      </div>
    </div>
  );
};

export default VoiceMessagePlayer;
