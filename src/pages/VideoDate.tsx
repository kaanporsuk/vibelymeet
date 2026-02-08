import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";

import { VibeProgressRing } from "@/components/video-date/VibeProgressRing";
import { IceBreakerCard } from "@/components/video-date/IceBreakerCard";
import { VideoControls } from "@/components/video-date/VideoControls";
import { PostDateCheckpoint } from "@/components/video-date/PostDateCheckpoint";
import { UrgentBorderEffect } from "@/components/video-date/UrgentBorderEffect";
import { useVideoCall } from "@/hooks/useVideoCall";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, VideoOff, User, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

const TOTAL_TIME = 300; // 5 minutes in seconds

interface PartnerData {
  name: string;
  age: number;
  tags: string[];
}

const VideoDate = () => {
  const navigate = useNavigate();
  const { id } = useParams(); // This is the video_session ID / room ID
  const { user } = useAuth();

  const [timeLeft, setTimeLeft] = useState(TOTAL_TIME);
  const [showFeedback, setShowFeedback] = useState(false);
  const [isUrgent, setIsUrgent] = useState(false);
  const [callStarted, setCallStarted] = useState(false);
  const [partner, setPartner] = useState<PartnerData>({
    name: "Your Match",
    age: 0,
    tags: [],
  });

  const localVideoContainerRef = useRef<HTMLDivElement>(null);
  const remoteVideoContainerRef = useRef<HTMLDivElement>(null);

  const {
    isConnecting,
    isConnected,
    isMuted,
    isVideoOff,
    localVideoRef,
    remoteVideoRef,
    startCall,
    endCall,
    toggleMute,
    toggleVideo,
  } = useVideoCall({
    roomId: id,
    userId: user?.id,
    onCallEnded: () => {
      toast.info("Call ended");
    },
    onPartnerJoined: () => {
      toast.success("Partner joined! 🎉");
    },
    onPartnerLeft: () => {
      toast.info("Partner left the call");
    },
  });

  // Fetch partner info from video_session
  useEffect(() => {
    if (!id || !user?.id) return;

    const fetchPartner = async () => {
      try {
        const { data: session } = await supabase
          .from("video_sessions")
          .select("participant_1_id, participant_2_id")
          .eq("id", id)
          .maybeSingle();

        if (!session) return;

        const partnerId =
          session.participant_1_id === user.id
            ? session.participant_2_id
            : session.participant_1_id;

        const { data: profile } = await supabase
          .from("profiles")
          .select("name, age")
          .eq("id", partnerId)
          .maybeSingle();

        if (profile) {
          setPartner({
            name: profile.name,
            age: profile.age,
            tags: [],
          });
        }
      } catch (err) {
        console.error("Error fetching partner:", err);
      }
    };

    fetchPartner();
  }, [id, user?.id]);

  // Auto-start call
  useEffect(() => {
    if (!callStarted && id) {
      setCallStarted(true);
      startCall(id);
    }
  }, [callStarted, startCall, id]);

  // Countdown timer
  useEffect(() => {
    if (showFeedback || !isConnected) return;

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
  }, [showFeedback, isConnected]);

  // Keep screen awake
  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;

    const requestWakeLock = async () => {
      try {
        if ("wakeLock" in navigator) {
          wakeLock = await navigator.wakeLock.request("screen");
        }
      } catch {
        console.log("Wake Lock not supported or failed");
      }
    };

    requestWakeLock();
    return () => {
      wakeLock?.release();
    };
  }, []);

  const handleLeave = async () => {
    endCall();

    // Reset matching state via edge function
    if (id && user?.id) {
      try {
        // Find the event_id from the video_session
        const { data: session } = await supabase
          .from("video_sessions")
          .select("event_id")
          .eq("id", id)
          .maybeSingle();

        if (session?.event_id) {
          await supabase.functions.invoke("video-matching", {
            body: { action: "leave_queue", eventId: session.event_id },
          });
        }
      } catch (err) {
        console.error("Error cleaning up:", err);
      }
    }

    toast("You left the date early. Stay safe! 💜", { duration: 2000 });
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

      {/* Main Video (Remote/Partner) */}
      <div className="flex-1 relative" ref={remoteVideoContainerRef}>
        {/* Remote video stream */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
        />

        {/* Loading/Connecting State */}
        {(isConnecting || !isConnected) && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-50">
            <div className="text-center space-y-4">
              <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto" />
              <p className="text-muted-foreground">
                {isConnecting
                  ? "Connecting to your date..."
                  : "Waiting for partner to join..."}
              </p>
              <p className="text-xs text-muted-foreground/60">
                Both users must be on this page for the call to start
              </p>
              <Button variant="outline" onClick={handleLeave} className="mt-4">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Leave
              </Button>
            </div>
          </div>
        )}

        {/* Gradient overlay at bottom */}
        <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-background via-background/60 to-transparent" />

        {/* Partner Info - Bottom Left */}
        {isConnected && (
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4 }}
            className="absolute bottom-48 left-4 glass-card px-4 py-3"
          >
            <div className="flex items-center gap-2 mb-1">
              <h2 className="font-display font-bold text-lg text-foreground">
                {partner.name}
                {partner.age > 0 ? `, ${partner.age}` : ""}
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
            {partner.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {partner.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 rounded-full bg-secondary/80 text-xs text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {/* Local Video (Self View - PIP) */}
        <motion.div
          ref={localVideoContainerRef}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="absolute top-20 right-4 w-32 h-44 rounded-2xl overflow-hidden shadow-lg border-2 border-primary/30 z-40"
          drag
          dragConstraints={remoteVideoContainerRef}
          dragElastic={0.1}
        >
          {isVideoOff ? (
            <div className="w-full h-full bg-secondary flex items-center justify-center">
              <VideoOff className="w-8 h-8 text-muted-foreground" />
            </div>
          ) : (
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover mirror"
            />
          )}

          {/* Mic indicator */}
          <div
            className={`absolute bottom-2 right-2 w-3 h-3 rounded-full ${
              !isMuted ? "bg-green-500 animate-pulse" : "bg-red-500"
            }`}
          />
        </motion.div>
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
          onToggleMute={toggleMute}
          onToggleVideo={toggleVideo}
          onLeave={handleLeave}
        />
      </div>

      {/* Post-Date Checkpoint Modal */}
      <PostDateCheckpoint
        isOpen={showFeedback}
        partnerName={partner.name}
        partnerImage=""
        dateDuration={TOTAL_TIME - timeLeft}
      />

      {/* Mirror effect for local video */}
      <style>{`
        .mirror {
          transform: scaleX(-1);
        }
      `}</style>
    </div>
  );
};

export default VideoDate;
