import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Video } from "lucide-react";
import { cn } from "@/lib/utils";

interface VibeVideoThumbnailProps {
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

  const sizeClasses = {
    sm: "w-12 h-12",
    md: "w-16 h-16",
    lg: "w-20 h-20",
  };

  const isActive = isHovering || isLongPressing;

  useEffect(() => {
    if (!hasVibeVideo) return;

    if (isActive && videoRef.current) {
      videoRef.current.play().catch(() => {});
    } else if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, [isActive, hasVibeVideo]);

  // Long press handlers for mobile
  const handleTouchStart = () => {
    if (!hasVibeVideo) return;
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
      onMouseEnter={() => hasVibeVideo && setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {/* Cyan glow ring for users with Vibe Video */}
      {hasVibeVideo && (
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
        <motion.img
          src={thumbnailUrl}
          alt="Profile thumbnail"
          className={cn(
            "absolute inset-0 w-full h-full object-cover transition-opacity duration-300",
            isActive && hasVibeVideo && isVideoLoaded ? "opacity-0" : "opacity-100"
          )}
        />

        {/* Video (hidden until hover/long-press) */}
        {hasVibeVideo && (
          <video
            ref={videoRef}
            src={videoUrl}
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
      {hasVibeVideo && !isActive && (
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
