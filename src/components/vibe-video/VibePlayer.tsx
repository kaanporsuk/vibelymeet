import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Volume2, VolumeX, Pencil, Play, Loader2 } from "lucide-react";
import * as Sentry from "@sentry/react";
import { cn } from "@/lib/utils";

// IntersectionObserver-based iOS hardware decoder management

interface VibePlayerProps {
  videoUrl: string;
  thumbnailUrl?: string;
  vibeCaption?: string;
  autoPlay?: boolean;
  showControls?: boolean;
  isOwner?: boolean;
  onUpdateClick?: () => void;
  className?: string;
  overlayClassName?: string;
  /** When true, playback errors show copy that backend marked the asset ready (CDN/player issue). */
  backendReportsReady?: boolean;
}

export const VibePlayer = ({
  videoUrl,
  thumbnailUrl,
  vibeCaption,
  autoPlay = true,
  showControls = true,
  isOwner = false,
  onUpdateClick,
  className,
  overlayClassName,
  backendReportsReady = false,
}: VibePlayerProps) => {
  const [isMuted, setIsMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [shouldLoad, setShouldLoad] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset state when videoUrl changes
  useEffect(() => {
    setIsLoaded(false);
    setHasError(false);
    setIsLoading(true);
    setIsPlaying(false);
  }, [videoUrl]);

  // iOS Safari has a hard limit on ~4 simultaneous buffering <video> elements.
  // Use React state to control src prop — avoids fighting React reconciliation.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldLoad(true);
        } else {
          setShouldLoad(false);
          if (videoRef.current) {
            videoRef.current.pause();
            setIsPlaying(false);
          }
        }
      },
      { threshold: 0 }
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const attemptPlay = useCallback(() => {
    if (videoRef.current && isLoaded && !hasError) {
      videoRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch((err) => {
        console.log("Autoplay blocked:", err);
        setIsPlaying(false);
      });
    }
  }, [isLoaded, hasError]);

  useEffect(() => {
    if (autoPlay && isLoaded && shouldLoad) {
      attemptPlay();
    }
  }, [autoPlay, isLoaded, shouldLoad, attemptPlay]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
    }
  }, [isMuted]);

  const handleToggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsMuted(!isMuted);
  };

  const handleVideoClick = () => {
    if (!videoRef.current) return;
    
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch(console.error);
    }
  };

  const handleLoadedData = () => {
    setIsLoaded(true);
    setIsLoading(false);
  };

  const handleError = () => {
    setHasError(true);
    setIsLoading(false);
    Sentry.addBreadcrumb({
      category: "vibe-video-playback",
      message: backendReportsReady ? "inline_player_error_backend_ready" : "inline_player_error",
      level: "error",
      data: { surface: "vibe_player" },
    });
  };

  const handleCanPlay = () => {
    setIsLoading(false);
  };

  return (
    <div ref={containerRef} className={cn("relative overflow-hidden bg-secondary", className)}>
      {/* Loading state */}
      {isLoading && !hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-secondary z-10">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Error state — honest when DB says ready but stream fails */}
      {hasError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-secondary z-10 px-4 text-center">
          <Play className="w-8 h-8 text-muted-foreground mb-2 opacity-80" />
          <p className="text-sm font-medium text-foreground">
            {backendReportsReady ? "Can't play right now" : "Video unavailable"}
          </p>
          {backendReportsReady && (
            <p className="text-xs text-muted-foreground mt-1.5 max-w-[240px]">
              It's ready on our side, but playback didn't load. Try again shortly.
            </p>
          )}
        </div>
      )}

      {/* Play button overlay when paused */}
      <AnimatePresence>
        {!isPlaying && isLoaded && !hasError && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center z-10 bg-background/30"
            onClick={handleVideoClick}
          >
            <motion.div
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              className="w-16 h-16 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center cursor-pointer"
            >
              <Play className="w-8 h-8 text-foreground ml-1" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Video */}
      <video
        ref={videoRef}
        src={shouldLoad ? videoUrl : undefined}
        className="w-full h-full object-cover"
        loop
        muted={isMuted}
        playsInline
        preload="metadata"
        onLoadedData={handleLoadedData}
        onCanPlay={handleCanPlay}
        onError={handleError}
        onClick={handleVideoClick}
        poster={thumbnailUrl}
      />

      {/* Vibe Caption Overlay */}
      {vibeCaption && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className={cn(
            "absolute bottom-0 left-0 right-0 z-10 px-6 pb-6",
            overlayClassName
          )}
          style={{
            background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%)',
          }}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: 'linear-gradient(135deg, #8B5CF6, #E84393)' }}
            />
            <span
              className="text-xs font-semibold uppercase tracking-widest"
              style={{
                background: 'linear-gradient(90deg, #8B5CF6, #E84393)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              Vibing on
            </span>
          </div>
          <p
            className="text-white font-bold leading-tight"
            style={{
              fontSize: '18px',
              letterSpacing: '-0.3px',
              textShadow: '0 2px 12px rgba(0,0,0,0.5)',
            }}
          >
            {vibeCaption}
          </p>
        </motion.div>
      )}

      {/* Mute/Unmute Control */}
      {showControls && isLoaded && !hasError && (
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={handleToggleMute}
          className="absolute top-4 right-4 z-20 w-10 h-10 rounded-full bg-background/50 backdrop-blur-md flex items-center justify-center hover:bg-background/70 transition-colors"
        >
          {isMuted ? (
            <VolumeX className="w-5 h-5 text-foreground" />
          ) : (
            <Volume2 className="w-5 h-5 text-foreground" />
          )}
        </motion.button>
      )}

      {/* Owner Update Button */}
      {isOwner && onUpdateClick && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={onUpdateClick}
          className="absolute bottom-4 right-4 z-20 flex items-center gap-2 px-4 py-2 rounded-full bg-primary text-primary-foreground font-medium text-sm shadow-lg"
        >
          <Pencil className="w-4 h-4" />
          Update Vibe
        </motion.button>
      )}

      {/* Gradient overlay at bottom for caption readability */}
      <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-background/80 to-transparent pointer-events-none" />
    </div>
  );
};

export default VibePlayer;
