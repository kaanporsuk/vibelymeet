import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Video } from "lucide-react";
import { cn } from "@/lib/utils";

interface VibeVideoThumbnailProps {
  /** Presentational only: callers must pass resolver-ready URLs, not raw UID/status guesses. */
  thumbnailUrl: string;
  videoUrl: string;
  hasVibeVideo?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export const VibeVideoThumbnail = ({
  thumbnailUrl,
  videoUrl,
  hasVibeVideo = true,
  size = "md",
  className,
}: VibeVideoThumbnailProps) => {
  const [isHovering, setIsHovering] = useState(false);
  const [isLongPressing, setIsLongPressing] = useState(false);
  const [isVideoLoaded, setIsVideoLoaded] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const safeThumbnailUrl = thumbnailUrl.trim();
  const safeVideoUrl = videoUrl.trim();
  const canPreviewVideo = hasVibeVideo && safeVideoUrl.length > 0;
  const hasThumbnail = safeThumbnailUrl.length > 0;

  const sizeClasses = {
    sm: "w-12 h-12",
    md: "w-16 h-16",
    lg: "w-20 h-20",
  };

  const isActive = isHovering || isLongPressing;

  useEffect(() => {
    if (!canPreviewVideo) return;

    if (isActive && videoRef.current) {
      videoRef.current.play().catch(() => {});
    } else if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, [isActive, canPreviewVideo]);

  // Long press handlers for mobile
  const handleTouchStart = () => {
    if (!canPreviewVideo) return;
    longPressTimerRef.current = setTimeout(() => {
      setIsLongPressing(true);
    }, 300);
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }
    setIsLongPressing(false);
  };

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  return (
    <div
      className={cn("relative", sizeClasses[size], className)}
      onMouseEnter={() => canPreviewVideo && setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {/* Cyan glow ring for resolver-playable Vibe Video previews */}
      {canPreviewVideo && (
        <motion.div
          animate={{
            boxShadow: isActive
              ? [
                  "0 0 0 0 hsl(var(--neon-cyan) / 0.6)",
                  "0 0 15px 3px hsl(var(--neon-cyan) / 0.4)",
                ]
              : "0 0 8px 2px hsl(var(--neon-cyan) / 0.3)",
          }}
          transition={{ duration: 0.3 }}
          className="absolute inset-0 rounded-full ring-2 ring-[hsl(var(--neon-cyan))]"
        />
      )}

      {/* Container */}
      <div className="relative w-full h-full rounded-full overflow-hidden">
        {/* Static Thumbnail */}
        {hasThumbnail ? (
          <motion.img
            src={safeThumbnailUrl}
            alt="Profile thumbnail"
            className={cn(
              "absolute inset-0 w-full h-full object-cover transition-opacity duration-300",
              isActive && canPreviewVideo && isVideoLoaded ? "opacity-0" : "opacity-100"
            )}
          />
        ) : (
          <div className="absolute inset-0 bg-secondary flex items-center justify-center">
            <Video className="w-4 h-4 text-muted-foreground" />
          </div>
        )}

        {/* Video (hidden until hover/long-press) */}
        {canPreviewVideo && (
          <video
            ref={videoRef}
            src={safeVideoUrl}
            className={cn(
              "absolute inset-0 w-full h-full object-cover transition-opacity duration-300",
              isActive && isVideoLoaded ? "opacity-100" : "opacity-0"
            )}
            loop
            muted
            playsInline
            preload="metadata"
            onLoadedData={() => setIsVideoLoaded(true)}
          />
        )}
      </div>

      {/* Video Indicator Icon */}
      {canPreviewVideo && !isActive && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[hsl(var(--neon-cyan))] flex items-center justify-center shadow-lg"
        >
          <Video className="w-2.5 h-2.5 text-background" />
        </motion.div>
      )}
    </div>
  );
};

export default VibeVideoThumbnail;
