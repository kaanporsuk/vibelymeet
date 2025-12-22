import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";

import { VibeProgressRing } from "@/components/video-date/VibeProgressRing";
import { IceBreakerCard } from "@/components/video-date/IceBreakerCard";
import { DraggablePIP } from "@/components/video-date/DraggablePIP";
import { VideoControls } from "@/components/video-date/VideoControls";
import { PostDateCheckpoint } from "@/components/video-date/PostDateCheckpoint";
import { UrgentBorderEffect } from "@/components/video-date/UrgentBorderEffect";

// Mock partner data
const PARTNER = {
  name: "Emma",
  age: 26,
  image: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=800",
  tags: ["Music Lover", "Traveler", "Foodie"],
};

const TOTAL_TIME = 300; // 5 minutes in seconds

const VideoDate = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [timeLeft, setTimeLeft] = useState(TOTAL_TIME);
  const [showFeedback, setShowFeedback] = useState(false);
  const [isUrgent, setIsUrgent] = useState(false);

  // Countdown timer
  useEffect(() => {
    if (showFeedback) return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          setShowFeedback(true);
          return 0;
        }
        if (prev <= 10) {
          setIsUrgent(true);
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [showFeedback]);

  // Keep screen awake
  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;

    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await navigator.wakeLock.request('screen');
        }
      } catch (err) {
        console.log('Wake Lock not supported or failed');
      }
    };

    requestWakeLock();

    return () => {
      wakeLock?.release();
    };
  }, []);

  const handleLeave = () => {
    toast("You left the date early. Stay safe! 💜", {
      duration: 2000,
    });
    navigate("/dashboard");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col overflow-hidden relative">
      {/* Urgent border effect */}
      <UrgentBorderEffect isActive={isUrgent && !showFeedback} />

      {/* Timer Ring - Top Center */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="absolute top-4 left-1/2 -translate-x-1/2 z-50"
      >
        <VibeProgressRing timeLeft={timeLeft} totalTime={TOTAL_TIME} />
      </motion.div>

      {/* Main Video (Partner) */}
      <div className="flex-1 relative">
        <motion.img
          initial={{ opacity: 0, scale: 1.1 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          src={PARTNER.image}
          alt={PARTNER.name}
          className="w-full h-full object-cover"
        />

        {/* Gradient overlay at bottom */}
        <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-background via-background/60 to-transparent" />

        {/* Partner Info - Bottom Left */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.4 }}
          className="absolute bottom-48 left-4 glass-card px-4 py-3"
        >
          <div className="flex items-center gap-2 mb-1">
            <h2 className="font-display font-bold text-lg text-foreground">
              {PARTNER.name}, {PARTNER.age}
            </h2>
            <motion.div
              className="w-2 h-2 rounded-full bg-green-500"
              animate={{
                boxShadow: [
                  "0 0 4px #22c55e",
                  "0 0 8px #22c55e",
                  "0 0 4px #22c55e",
                ],
              }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PARTNER.tags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 rounded-full bg-secondary/80 text-xs text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        </motion.div>

        {/* Draggable PIP (Self View) */}
        <DraggablePIP
          isVideoOff={isVideoOff}
          isMicActive={!isMuted}
          imageSrc="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300"
        />
      </div>

      {/* Ice Breaker Card */}
      <div className="absolute bottom-36 left-0 right-0 px-4 z-30">
        <IceBreakerCard />
      </div>

      {/* Controls Dock */}
      <div className="absolute bottom-0 left-0 right-0 p-4 pb-safe z-30">
        <VideoControls
          isMuted={isMuted}
          isVideoOff={isVideoOff}
          onToggleMute={() => setIsMuted(!isMuted)}
          onToggleVideo={() => setIsVideoOff(!isVideoOff)}
          onLeave={handleLeave}
        />
      </div>

      {/* Post-Date Checkpoint Modal */}
      <PostDateCheckpoint
        isOpen={showFeedback}
        partnerName={PARTNER.name}
        partnerImage={PARTNER.image}
        dateDuration={TOTAL_TIME - timeLeft}
      />
    </div>
  );
};

export default VideoDate;
