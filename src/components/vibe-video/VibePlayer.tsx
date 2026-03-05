import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Volume2, VolumeX, Pencil, Play, Loader2 } from "lucide-react";
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
    console.error("Video failed to load:", videoUrl);
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

      {/* Error state */}
      {hasError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-secondary z-10">
          <Play className="w-8 h-8 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">Video unavailable</p>
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
            "absolute bottom-4 left-4 right-4 z-10",
            overlayClassName
          )}
        >
          <div className="glass-card px-4 py-2.5 rounded-xl">
            <p className="text-xs text-muted-foreground">Currently Vibing on...</p>
            <p className="text-sm font-medium text-foreground">{vibeCaption}</p>
          </div>
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
