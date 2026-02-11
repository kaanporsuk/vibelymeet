import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { User } from "lucide-react";

import { HandshakeTimer } from "@/components/video-date/HandshakeTimer";
import { IceBreakerCard } from "@/components/video-date/IceBreakerCard";
import { VideoDateControls } from "@/components/video-date/VideoDateControls";
import { SelfViewPIP } from "@/components/video-date/SelfViewPIP";
import { ConnectionOverlay } from "@/components/video-date/ConnectionOverlay";
import { PartnerProfileSheet } from "@/components/video-date/PartnerProfileSheet";
import { PostDateCheckpoint } from "@/components/video-date/PostDateCheckpoint";
import { UrgentBorderEffect } from "@/components/video-date/UrgentBorderEffect";
import { VibeCheckButton } from "@/components/video-date/VibeCheckButton";
import { MutualVibeToast } from "@/components/video-date/MutualVibeToast";
import { useVideoCall } from "@/hooks/useVideoCall";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

const HANDSHAKE_TIME = 60;
const DATE_TIME = 300; // 5 minutes

interface PartnerData {
  name: string;
  age: number;
  tags: string[];
  avatarUrl?: string;
  photos?: string[];
  bio?: string;
  job?: string;
  location?: string;
  heightCm?: number;
  prompts?: { question: string; answer: string }[];
}

type CallPhase = "handshake" | "date" | "ended";

const VideoDate = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const { user } = useAuth();

  // Call phase state
  const [phase, setPhase] = useState<CallPhase>("handshake");
  const [timeLeft, setTimeLeft] = useState(HANDSHAKE_TIME);
  const [blurAmount, setBlurAmount] = useState(20);
  const [showFeedback, setShowFeedback] = useState(false);
  const [callStarted, setCallStarted] = useState(false);
  const [showProfileSheet, setShowProfileSheet] = useState(false);
  const [showIceBreaker, setShowIceBreaker] = useState(true);
  const [showMutualToast, setShowMutualToast] = useState(false);
  const [isParticipant1, setIsParticipant1] = useState(false);
  const [partner, setPartner] = useState<PartnerData>({
    name: "Your Match",
    age: 0,
    tags: [],
  });

  const remoteContainerRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef<CallPhase>("handshake");

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
    onCallEnded: () => toast.info("Call ended"),
    onPartnerJoined: () => toast.success("Partner joined! 🎉"),
    onPartnerLeft: () => {
      toast.info("Partner left the call");
      if (phaseRef.current !== "ended") {
        handleCallEnd();
      }
    },
  });

  // Keep phaseRef in sync
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Fetch partner profile + determine participant position
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

        const isP1 = session.participant_1_id === user.id;
        setIsParticipant1(isP1);

        const partnerId = isP1
          ? session.participant_2_id
          : session.participant_1_id;

        const { data: profile } = await supabase
          .from("profiles")
          .select("name, age, avatar_url, photos, bio, job, location, height_cm, prompts")
          .eq("id", partnerId)
          .maybeSingle();

        if (profile) {
          const { data: vibes } = await supabase
            .from("profile_vibes")
            .select("vibe_tags(label)")
            .eq("profile_id", partnerId);

          const tags = vibes?.map((v: any) => v.vibe_tags?.label).filter(Boolean) || [];

          let prompts: { question: string; answer: string }[] = [];
          if (profile.prompts && Array.isArray(profile.prompts)) {
            prompts = (profile.prompts as any[]).map((p) => ({
              question: p.question || "",
              answer: p.answer || "",
            }));
          }

          setPartner({
            name: profile.name,
            age: profile.age,
            tags,
            avatarUrl: profile.avatar_url || undefined,
            photos: (profile.photos as string[]) || undefined,
            bio: profile.bio || undefined,
            job: profile.job || undefined,
            location: profile.location || undefined,
            heightCm: profile.height_cm || undefined,
            prompts,
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

  // Progressive blur: trigger CSS transition when connected
  useEffect(() => {
    if (isConnected) {
      // Use rAF to ensure the initial blur(20px) is rendered first,
      // then transition to 0 over 10 seconds via CSS transition
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setBlurAmount(0);
        });
      });
    }
  }, [isConnected]);

  // Countdown timer — handles both handshake and date phases
  useEffect(() => {
    if (showFeedback || !isConnected || phase === "ended") return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          if (phaseRef.current === "handshake") {
            // Handshake ended — check mutual vibe
            checkMutualVibe();
          } else {
            // Date ended
            handleCallEnd();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [showFeedback, isConnected, phase]);

  // Auto-hide ice breaker after 20s during handshake
  useEffect(() => {
    if (!isConnected) return;
    const timer = setTimeout(() => setShowIceBreaker(false), 20000);
    return () => clearTimeout(timer);
  }, [isConnected]);

  // Wake lock
  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;
    const request = async () => {
      try {
        if ("wakeLock" in navigator) {
          wakeLock = await navigator.wakeLock.request("screen");
        }
      } catch {}
    };
    request();
    return () => {
      wakeLock?.release();
    };
  }, []);

  // Record user's vibe to DB
  const handleUserVibe = useCallback(async () => {
    if (!id || !user?.id) return;

    try {
      const field = isParticipant1 ? "participant_1_liked" : "participant_2_liked";
      await supabase
        .from("video_sessions")
        .update({ [field]: true })
        .eq("id", id);
    } catch (err) {
      console.error("Error recording vibe:", err);
    }
  }, [id, user?.id, isParticipant1]);

  // Check if both users vibed at end of handshake
  const checkMutualVibe = useCallback(async () => {
    if (!id) {
      handleCallEnd();
      return;
    }

    try {
      const { data: session } = await supabase
        .from("video_sessions")
        .select("participant_1_liked, participant_2_liked")
        .eq("id", id)
        .maybeSingle();

      if (session?.participant_1_liked && session?.participant_2_liked) {
        // Mutual vibe! Extend to 5-minute date
        setShowMutualToast(true);
      } else {
        // No mutual vibe — end warmly
        toast("Great meeting you! 👋", { duration: 2500 });
        endCall();
        setPhase("ended");
        setTimeout(() => navigate("/dashboard"), 2000);
      }
    } catch (err) {
      console.error("Error checking mutual vibe:", err);
      handleCallEnd();
    }
  }, [id, endCall, navigate]);

  // Transition from mutual toast to date phase
  const handleMutualToastComplete = useCallback(() => {
    setShowMutualToast(false);
    setPhase("date");
    setTimeLeft(DATE_TIME);
    setShowIceBreaker(true);
    // Re-hide after 30s during date
    setTimeout(() => setShowIceBreaker(false), 30000);
  }, []);

  // End call and show feedback
  const handleCallEnd = useCallback(() => {
    setPhase("ended");
    setShowFeedback(true);
  }, []);

  const handleLeave = useCallback(async () => {
    endCall();
    if (id && user?.id) {
      try {
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
    toast("You left the date. Stay safe! 💜", { duration: 2000 });
    navigate("/dashboard");
  }, [endCall, id, user?.id, navigate]);

  const totalTime = phase === "handshake" ? HANDSHAKE_TIME : DATE_TIME;
  const isUrgent = phase === "date" && timeLeft <= 10;

  return (
    <div className="fixed inset-0 bg-background flex flex-col overflow-hidden">
      {/* Urgent border — only during the 5-min date */}
      <UrgentBorderEffect isActive={isUrgent && !showFeedback} />

      {/* ─── Top HUD ─── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-4 pt-3 pb-2"
        style={{
          background:
            "linear-gradient(to bottom, hsl(var(--background) / 0.8), transparent)",
        }}
      >
        {/* Partner info pill */}
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={() => isConnected && setShowProfileSheet(true)}
          className="flex items-center gap-2 glass-card px-3 py-2"
        >
          {partner.avatarUrl ? (
            <img
              src={partner.avatarUrl}
              alt={partner.name}
              className="w-8 h-8 rounded-full object-cover border border-primary/30"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
              <User className="w-4 h-4 text-muted-foreground" />
            </div>
          )}
          <div className="text-left">
            <p className="text-sm font-display font-semibold text-foreground leading-tight">
              {partner.name}
              {partner.age > 0 && (
                <span className="font-normal text-foreground/60 ml-1">
                  {partner.age}
                </span>
              )}
            </p>
            {isConnected && (
              <div className="flex items-center gap-1">
                <motion.div
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: "hsl(142, 71%, 45%)" }}
                  animate={{ opacity: [1, 0.5, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
                <span
                  className="text-[10px]"
                  style={{ color: "hsl(142, 69%, 58%)" }}
                >
                  {phase === "handshake" ? "Handshake" : "Live"}
                </span>
              </div>
            )}
          </div>
        </motion.button>

        {/* Phase indicator + Timer */}
        <div className="flex items-center gap-2">
          {isConnected && phase === "handshake" && (
            <motion.div
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              className="px-2.5 py-1 rounded-full bg-primary/15 border border-primary/30"
            >
              <span className="text-[10px] font-medium text-primary uppercase tracking-wider">
                Handshake
              </span>
            </motion.div>
          )}
          {isConnected && phase === "date" && (
            <motion.div
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              className="px-2.5 py-1 rounded-full bg-accent/15 border border-accent/30"
            >
              <span className="text-[10px] font-medium text-accent uppercase tracking-wider">
                Date
              </span>
            </motion.div>
          )}
          <HandshakeTimer
            timeLeft={timeLeft}
            totalTime={totalTime}
            phase={phase}
          />
        </div>
      </motion.div>

      {/* ─── Remote Video (Full Screen) with Progressive Blur ─── */}
      <div className="flex-1 relative" ref={remoteContainerRef}>
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
          style={{
            filter: `blur(${blurAmount}px)`,
            transition: "filter 10s linear",
          }}
        />

        {/* Connection overlay */}
        <AnimatePresence>
          {(isConnecting || !isConnected) && !showFeedback && (
            <ConnectionOverlay
              isConnecting={isConnecting}
              onLeave={handleLeave}
            />
          )}
        </AnimatePresence>

        {/* Bottom gradient for controls */}
        <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-background via-background/50 to-transparent pointer-events-none" />
      </div>

      {/* ─── Self-View PIP with blur ─── */}
      {isConnected && (
        <SelfViewPIP
          videoRef={localVideoRef}
          isVideoOff={isVideoOff}
          isMuted={isMuted}
          containerRef={remoteContainerRef}
          blurAmount={blurAmount}
        />
      )}

      {/* ─── Ice Breaker ─── */}
      <AnimatePresence>
        {isConnected && showIceBreaker && !showFeedback && (
          <motion.div
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            className="absolute bottom-44 left-4 right-4 z-20"
          >
            <IceBreakerCard />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Vibed ✓ Button (handshake phase only) ─── */}
      <AnimatePresence>
        {isConnected && phase === "handshake" && !showFeedback && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-28 left-0 right-0 z-25 flex justify-center"
          >
            <VibeCheckButton
              timeLeft={timeLeft}
              onVibe={handleUserVibe}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Mutual Vibe Celebration ─── */}
      <AnimatePresence>
        {showMutualToast && (
          <MutualVibeToast onComplete={handleMutualToastComplete} />
        )}
      </AnimatePresence>

      {/* ─── Controls Dock ─── */}
      <div className="absolute bottom-0 left-0 right-0 px-3 pb-safe z-30">
        <VideoDateControls
          isMuted={isMuted}
          isVideoOff={isVideoOff}
          onToggleMute={toggleMute}
          onToggleVideo={toggleVideo}
          onLeave={handleLeave}
          onViewProfile={() => setShowProfileSheet(true)}
        />
      </div>

      {/* ─── Partner Profile Sheet ─── */}
      <PartnerProfileSheet
        isOpen={showProfileSheet}
        onClose={() => setShowProfileSheet(false)}
        partner={partner}
      />

      {/* ─── Post-Date Checkpoint ─── */}
      <PostDateCheckpoint
        isOpen={showFeedback}
        partnerName={partner.name}
        partnerImage={partner.avatarUrl || partner.photos?.[0] || ""}
        dateDuration={
          phase === "date"
            ? DATE_TIME - timeLeft
            : HANDSHAKE_TIME - timeLeft
        }
      />
    </div>
  );
};

export default VideoDate;
