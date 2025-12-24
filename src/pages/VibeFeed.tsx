import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Heart, MessageCircle, Volume2, VolumeX, Sparkles, MapPin, ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VerificationBadge } from "@/components/VerificationBadge";
import { VibeTag } from "@/components/VibeTag";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

interface VibeVideo {
  id: string;
  name: string;
  age: number;
  location: string;
  verified: boolean;
  avatarUrl: string;
  videoUrl: string;
  vibeCaption: string;
  vibeTags: string[];
  vibeScore: number;
}

// Mock data for the feed
const mockVibeVideos: VibeVideo[] = [
  {
    id: "1",
    name: "Sarah",
    age: 24,
    location: "Brooklyn, NY",
    verified: true,
    avatarUrl: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
    vibeCaption: "Marathon Training 🏃‍♀️",
    vibeTags: ["Fitness", "Night Owl", "Foodie"],
    vibeScore: 94,
  },
  {
    id: "2",
    name: "Marcus",
    age: 28,
    location: "Manhattan, NY",
    verified: true,
    avatarUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
    vibeCaption: "DJing & Vinyl Hunting 🎵",
    vibeTags: ["Music Lover", "Creative", "Tech Nerd"],
    vibeScore: 87,
  },
  {
    id: "3",
    name: "Elena",
    age: 26,
    location: "Queens, NY",
    verified: false,
    avatarUrl: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4",
    vibeCaption: "Travel Planning Season ✈️",
    vibeTags: ["Traveler", "Bookworm", "Nature"],
    vibeScore: 91,
  },
  {
    id: "4",
    name: "Jordan",
    age: 30,
    location: "Brooklyn, NY",
    verified: true,
    avatarUrl: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4",
    vibeCaption: "Gaming & Coffee ☕",
    vibeTags: ["Gamer", "Coffee Addict", "Film Buff"],
    vibeScore: 82,
  },
  {
    id: "5",
    name: "Aria",
    age: 25,
    location: "Williamsburg, NY",
    verified: true,
    avatarUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4",
    vibeCaption: "Art & Gallery Hopping 🎨",
    vibeTags: ["Creative", "Coffee Addict", "Bookworm"],
    vibeScore: 96,
  },
];

const VibeFeed = () => {
  const navigate = useNavigate();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const [likedVideos, setLikedVideos] = useState<Set<string>>(new Set());
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isScrolling, setIsScrolling] = useState(false);

  const currentVideo = mockVibeVideos[currentIndex];

  // Handle video playback based on current index
  useEffect(() => {
    videoRefs.current.forEach((video, index) => {
      if (video) {
        if (index === currentIndex) {
          video.currentTime = 0;
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      }
    });
  }, [currentIndex]);

  // Scroll handler for TikTok-style navigation
  const handleScroll = useCallback((direction: "up" | "down") => {
    if (isScrolling) return;
    
    setIsScrolling(true);
    
    if (direction === "down" && currentIndex < mockVibeVideos.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else if (direction === "up" && currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    }
    
    setTimeout(() => setIsScrolling(false), 500);
  }, [currentIndex, isScrolling]);

  // Wheel event for desktop scroll
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let lastScrollTime = 0;
    const scrollCooldown = 500;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const now = Date.now();
      if (now - lastScrollTime < scrollCooldown) return;
      
      lastScrollTime = now;
      handleScroll(e.deltaY > 0 ? "down" : "up");
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [handleScroll]);

  // Touch events for mobile swipe
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let touchStartY = 0;
    let touchEndY = 0;

    const handleTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0].clientY;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      touchEndY = e.changedTouches[0].clientY;
      const deltaY = touchStartY - touchEndY;
      
      if (Math.abs(deltaY) > 50) {
        handleScroll(deltaY > 0 ? "down" : "up");
      }
    };

    container.addEventListener("touchstart", handleTouchStart);
    container.addEventListener("touchend", handleTouchEnd);
    
    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchend", handleTouchEnd);
    };
  }, [handleScroll]);

  const toggleLike = (id: string) => {
    setLikedVideos((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
    videoRefs.current.forEach((video) => {
      if (video) video.muted = !isMuted;
    });
  };

  return (
    <div 
      ref={containerRef}
      className="fixed inset-0 bg-background overflow-hidden"
    >
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-50 p-4 bg-gradient-to-b from-background/80 to-transparent">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(-1)}
            className="rounded-full bg-background/30 backdrop-blur-sm"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <span className="font-display font-bold text-lg">Vibe Feed</span>
          </div>
          
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleMute}
            className="rounded-full bg-background/30 backdrop-blur-sm"
          >
            {isMuted ? (
              <VolumeX className="w-5 h-5" />
            ) : (
              <Volume2 className="w-5 h-5" />
            )}
          </Button>
        </div>
      </div>

      {/* Video Stack */}
      <div className="relative w-full h-full">
        <AnimatePresence mode="popLayout">
          {mockVibeVideos.map((video, index) => (
            <motion.div
              key={video.id}
              initial={{ opacity: 0, y: index > currentIndex ? "100%" : "-100%" }}
              animate={{
                opacity: index === currentIndex ? 1 : 0,
                y: index === currentIndex ? 0 : index > currentIndex ? "100%" : "-100%",
                scale: index === currentIndex ? 1 : 0.9,
              }}
              exit={{ opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className={cn(
                "absolute inset-0",
                index !== currentIndex && "pointer-events-none"
              )}
            >
              {/* Video */}
              <video
                ref={(el) => (videoRefs.current[index] = el)}
                src={video.videoUrl}
                className="w-full h-full object-cover"
                loop
                muted={isMuted}
                playsInline
                preload="metadata"
              />

              {/* Gradient Overlays */}
              <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent opacity-80" />
              <div className="absolute inset-0 bg-gradient-to-b from-background/50 via-transparent to-transparent" />
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Video Progress Indicators */}
        <div className="absolute top-20 right-4 flex flex-col gap-1.5 z-40">
          {mockVibeVideos.map((_, index) => (
            <motion.div
              key={index}
              className={cn(
                "w-1 rounded-full transition-all duration-300",
                index === currentIndex
                  ? "h-6 bg-primary"
                  : "h-1.5 bg-white/30"
              )}
            />
          ))}
        </div>

        {/* Right Side Actions */}
        <div className="absolute right-4 bottom-40 flex flex-col items-center gap-6 z-40">
          {/* Like Button */}
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => toggleLike(currentVideo.id)}
            className="flex flex-col items-center gap-1"
          >
            <motion.div
              animate={likedVideos.has(currentVideo.id) ? {
                scale: [1, 1.3, 1],
              } : {}}
              className={cn(
                "w-12 h-12 rounded-full flex items-center justify-center backdrop-blur-sm",
                likedVideos.has(currentVideo.id)
                  ? "bg-neon-pink/30"
                  : "bg-background/30"
              )}
            >
              <Heart
                className={cn(
                  "w-7 h-7 transition-colors",
                  likedVideos.has(currentVideo.id)
                    ? "text-neon-pink fill-neon-pink"
                    : "text-white"
                )}
              />
            </motion.div>
            <span className="text-xs text-white/80">Like</span>
          </motion.button>

          {/* Message Button */}
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => navigate(`/chat/${currentVideo.id}`)}
            className="flex flex-col items-center gap-1"
          >
            <div className="w-12 h-12 rounded-full bg-background/30 backdrop-blur-sm flex items-center justify-center">
              <MessageCircle className="w-7 h-7 text-white" />
            </div>
            <span className="text-xs text-white/80">Chat</span>
          </motion.button>

          {/* Vibe Score */}
          <div className="flex flex-col items-center gap-1">
            <div className="w-12 h-12 rounded-full bg-gradient-primary flex items-center justify-center neon-glow-violet">
              <span className="text-sm font-bold text-white">{currentVideo.vibeScore}%</span>
            </div>
            <span className="text-xs text-white/80">Vibe</span>
          </div>
        </div>

        {/* Bottom Info */}
        <div className="absolute bottom-20 left-4 right-20 z-40">
          <motion.div
            key={currentVideo.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-3"
          >
            {/* User Info */}
            <div className="flex items-center gap-3">
              <div className="relative">
                <img
                  src={currentVideo.avatarUrl}
                  alt={currentVideo.name}
                  className="w-12 h-12 rounded-full object-cover border-2 border-white/30"
                />
                {currentVideo.verified && (
                  <div className="absolute -bottom-1 -right-1">
                    <VerificationBadge verified size="sm" />
                  </div>
                )}
              </div>
              <div>
                <h3 className="text-lg font-display font-bold text-white">
                  {currentVideo.name}, {currentVideo.age}
                </h3>
                <div className="flex items-center gap-1 text-white/70 text-sm">
                  <MapPin className="w-3 h-3" />
                  <span>{currentVideo.location}</span>
                </div>
              </div>
            </div>

            {/* Vibe Caption */}
            <div className="glass-card px-4 py-2 rounded-xl inline-block">
              <p className="text-sm">
                <span className="text-muted-foreground">Currently vibing on: </span>
                <span className="font-medium gradient-text">{currentVideo.vibeCaption}</span>
              </p>
            </div>

            {/* Vibe Tags */}
            <div className="flex flex-wrap gap-2">
              {currentVideo.vibeTags.map((tag) => (
                <VibeTag key={tag} label={tag} variant="display" />
              ))}
            </div>
          </motion.div>
        </div>

        {/* Navigation Hints */}
        <div className="absolute left-1/2 -translate-x-1/2 bottom-4 z-40 flex flex-col items-center gap-1">
          <motion.div
            animate={{ y: [-2, 2, -2] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            {currentIndex < mockVibeVideos.length - 1 && (
              <ChevronDown className="w-6 h-6 text-white/50" />
            )}
          </motion.div>
          <span className="text-xs text-white/40">Swipe for more</span>
        </div>

        {/* Up Navigation Hint */}
        {currentIndex > 0 && (
          <motion.div
            className="absolute left-1/2 -translate-x-1/2 top-24 z-40"
            animate={{ y: [2, -2, 2] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            <ChevronUp className="w-6 h-6 text-white/30" />
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default VibeFeed;
