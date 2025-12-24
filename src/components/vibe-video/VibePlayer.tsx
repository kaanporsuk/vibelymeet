import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Volume2, VolumeX, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

interface VibePlayerProps {
  videoUrl: string;
  thumbnailUrl: string;
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
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [isLoaded, setIsLoaded] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.play().catch(() => {
          // Autoplay blocked, that's fine
        });
      } else {
        videoRef.current.pause();
      }
    }
  }, [isPlaying]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
    }
  }, [isMuted]);

  const handleToggleMute = () => {
    setIsMuted(!isMuted);
  };

  const handleVideoClick = () => {
    if (showControls) {
      handleToggleMute();
    }
  };

  return (
    <div className={cn("relative overflow-hidden", className)}>
      {/* Thumbnail (shown until video loads) */}
      <AnimatePresence>
        {!isLoaded && (
          <motion.img
            exit={{ opacity: 0 }}
            src={thumbnailUrl}
            alt="Video thumbnail"
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
      </AnimatePresence>

      {/* Video */}
      <video
        ref={videoRef}
        src={videoUrl}
        className="w-full h-full object-cover"
        loop
        muted={isMuted}
        playsInline
        autoPlay={autoPlay}
        onLoadedData={() => setIsLoaded(true)}
        onClick={handleVideoClick}
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
      {showControls && (
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
