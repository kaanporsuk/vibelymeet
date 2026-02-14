import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence, useMotionValue, useTransform, PanInfo } from "framer-motion";
import { ArrowLeft, X, Heart, Star, Clock, Sparkles, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useEventDetails, useIsRegisteredForEvent } from "@/hooks/useEventDetails";
import { useEventDeck, DeckProfile } from "@/hooks/useEventDeck";
import { useSwipeAction } from "@/hooks/useSwipeAction";
import { useEventStatus } from "@/hooks/useEventStatus";
import { useMatchQueue } from "@/hooks/useMatchQueue";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { addMinutes, differenceInSeconds } from "date-fns";
import LobbyProfileCard from "@/components/lobby/LobbyProfileCard";
import LobbyEmptyState from "@/components/lobby/LobbyEmptyState";
import ReadyGateOverlay from "@/components/lobby/ReadyGateOverlay";

const EventLobby = () => {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  // Data hooks
  const { data: event, isLoading: eventLoading } = useEventDetails(eventId);
  const { data: isRegistered, isLoading: regLoading } = useIsRegisteredForEvent(eventId, user?.id);
  const { profiles, isLoading: deckLoading, refetch: refetchDeck } = useEventDeck({
    eventId: eventId || "",
    enabled: !!eventId && !!user?.id,
  });
  const { setStatus, currentStatus } = useEventStatus({ eventId, enabled: !!eventId && !!user?.id });

  // Ready Gate overlay state
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Current card index in the local deck
  const [currentIndex, setCurrentIndex] = useState(0);
  const [exitDirection, setExitDirection] = useState<"left" | "right" | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [superVibeCount, setSuperVibeCount] = useState(0);
  const [userVibes, setUserVibes] = useState<string[]>([]);

  // Swipe action — show Ready Gate on immediate match
  const { swipe, isProcessing } = useSwipeAction({
    eventId: eventId || "",
    onMatch: (matchId) => {
      setActiveSessionId(matchId);
    },
    onMatchQueued: () => {
      // Toast already handled by useSwipeAction
    },
  });

  // Match queue — fires Ready Gate when a queued match becomes ready
  const { queuedCount } = useMatchQueue({
    eventId,
    currentStatus: currentStatus || "browsing",
    onMatchReady: (matchId, _partnerId) => {
      setActiveSessionId(matchId);
    },
  });

  // Timer state
  const [timeRemaining, setTimeRemaining] = useState("");

  // Fetch user's vibe tags for "shared vibes" display
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const { data } = await supabase
        .from("profile_vibes")
        .select("vibe_tags(label)")
        .eq("profile_id", user.id);
      if (data) {
        const labels = data
          .map((v) => (v.vibe_tags as { label: string } | null)?.label)
          .filter(Boolean) as string[];
        setUserVibes(labels);
      }
    })();
  }, [user?.id]);

  // Fetch super vibe credit count
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const { data } = await supabase
        .from("user_credits")
        .select("super_vibe_credits")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data) setSuperVibeCount(data.super_vibe_credits);
    })();
  }, [user?.id]);

  // Set status to browsing on mount, offline on unmount
  useEffect(() => {
    setStatus("browsing");
    return () => {
      setStatus("offline");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Event countdown timer
  useEffect(() => {
    if (!event) return;
    const endTime = addMinutes(event.eventDate, event.durationMinutes);

    const tick = () => {
      const diff = differenceInSeconds(endTime, new Date());
      if (diff <= 0) {
        setTimeRemaining("Ended");
        return;
      }
      const m = Math.floor(diff / 60);
      const s = diff % 60;
      setTimeRemaining(`${m}:${String(s).padStart(2, "0")}`);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [event]);

  // Guards: redirect if not live or not registered
  useEffect(() => {
    if (eventLoading || regLoading || !event) return;

    const now = new Date();
    const endTime = addMinutes(event.eventDate, event.durationMinutes);
    const isLive = now >= event.eventDate && now < endTime;

    if (!isLive) {
      toast("This event isn't live yet.", { duration: 2500 });
      navigate(`/events/${eventId}`, { replace: true });
      return;
    }

    if (isRegistered === false) {
      toast("Register for this event first!", { duration: 2500 });
      navigate(`/events/${eventId}`, { replace: true });
    }
  }, [event, eventLoading, regLoading, isRegistered, eventId, navigate]);

  // Sort deck: super vibes first
  const sortedProfiles = useMemo(() => {
    const sorted = [...profiles];
    sorted.sort((a, b) => {
      if (a.has_super_vibed && !b.has_super_vibed) return -1;
      if (!a.has_super_vibed && b.has_super_vibed) return 1;
      return 0;
    });
    return sorted;
  }, [profiles]);

  const currentProfile = sortedProfiles[currentIndex] || null;
  const nextProfile = sortedProfiles[currentIndex + 1] || null;

  // Reset index when deck refreshes with new data
  useEffect(() => {
    if (currentIndex >= sortedProfiles.length && sortedProfiles.length > 0) {
      setCurrentIndex(0);
    }
  }, [sortedProfiles.length, currentIndex]);

  const advanceCard = useCallback((direction: "left" | "right") => {
    setExitDirection(direction);
    setIsAnimating(true);
    setTimeout(() => {
      setCurrentIndex((prev) => prev + 1);
      setExitDirection(null);
      setIsAnimating(false);
    }, 300);
  }, []);

  const handleVibe = useCallback(async () => {
    if (!currentProfile || isProcessing || isAnimating) return;
    const result = await swipe(currentProfile.profile_id, "vibe");
    if (result) advanceCard("right");
  }, [currentProfile, isProcessing, isAnimating, swipe, advanceCard]);

  const handlePass = useCallback(async () => {
    if (!currentProfile || isProcessing || isAnimating) return;
    const result = await swipe(currentProfile.profile_id, "pass");
    if (result) advanceCard("left");
  }, [currentProfile, isProcessing, isAnimating, swipe, advanceCard]);

  const handleSuperVibe = useCallback(async () => {
    if (!currentProfile || isProcessing || isAnimating) return;
    const result = await swipe(currentProfile.profile_id, "super_vibe");
    if (result && result.result === "super_vibe_sent") {
      setSuperVibeCount((prev) => Math.max(0, prev - 1));
      advanceCard("right");
    }
  }, [currentProfile, isProcessing, isAnimating, swipe, advanceCard]);

  // Loading state
  if (eventLoading || regLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-12 h-12 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  const isEmpty = currentIndex >= sortedProfiles.length;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top Bar */}
      <header className="sticky top-0 z-50 glass-card border-b border-white/10 px-4 py-3">
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <button
            onClick={() => navigate("/dashboard")}
            className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-secondary transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>

          <div className="flex items-center gap-2">
            <h1 className="text-sm font-display font-semibold text-foreground truncate max-w-[160px]">
              {event?.title || "Event"}
            </h1>
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 text-xs font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              LIVE
            </span>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-secondary text-muted-foreground">
            <Clock className="w-3.5 h-3.5" />
            <span className="text-xs font-medium font-display tabular-nums">{timeRemaining}</span>
          </div>
        </div>
      </header>

      {/* Card Area */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-4 max-w-lg mx-auto w-full relative">
        {deckLoading && sortedProfiles.length === 0 ? (
          <CardSkeleton />
        ) : isEmpty ? (
          <LobbyEmptyState onRefresh={refetchDeck} />
        ) : (
          <div className="relative w-full" style={{ aspectRatio: "3/4", maxHeight: "65vh" }}>
            {/* Next card (behind) */}
            {nextProfile && (
              <div className="absolute inset-0 scale-[0.96] opacity-60 pointer-events-none">
                <LobbyProfileCard
                  profile={nextProfile}
                  userVibes={userVibes}
                  isBehind
                />
              </div>
            )}

            {/* Current card */}
            <AnimatePresence mode="wait">
              {currentProfile && !exitDirection && (
                <SwipeableCard
                  key={currentProfile.profile_id}
                  profile={currentProfile}
                  userVibes={userVibes}
                  onSwipeLeft={handlePass}
                  onSwipeRight={handleVibe}
                  disabled={isProcessing || isAnimating}
                />
              )}
              {currentProfile && exitDirection && (
                <motion.div
                  key={`exit-${currentProfile.profile_id}`}
                  className="absolute inset-0"
                  initial={{ x: 0, opacity: 1, rotate: 0 }}
                  animate={{
                    x: exitDirection === "left" ? -400 : 400,
                    opacity: 0,
                    rotate: exitDirection === "left" ? -15 : 15,
                  }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                >
                  <LobbyProfileCard profile={currentProfile} userVibes={userVibes} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Action Buttons */}
        {!isEmpty && currentProfile && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-4 mt-5"
          >
            {/* Pass */}
            <button
              onClick={handlePass}
              disabled={isProcessing || isAnimating}
              className="w-14 h-14 rounded-full bg-secondary border border-border flex items-center justify-center hover:bg-destructive/20 hover:border-destructive/40 transition-all active:scale-90 disabled:opacity-40"
            >
              <X className="w-6 h-6 text-muted-foreground" />
            </button>

            {/* Super Vibe */}
            <button
              onClick={handleSuperVibe}
              disabled={isProcessing || isAnimating || superVibeCount <= 0}
              className="relative w-12 h-12 rounded-full bg-neon-yellow/20 border border-neon-yellow/40 flex items-center justify-center hover:bg-neon-yellow/30 transition-all active:scale-90 disabled:opacity-30"
            >
              <Star className="w-5 h-5 text-neon-yellow" fill="hsl(var(--neon-yellow))" />
              {superVibeCount > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-neon-yellow text-background text-[10px] font-bold flex items-center justify-center">
                  {superVibeCount}
                </span>
              )}
            </button>

            {/* Vibe */}
            <button
              onClick={handleVibe}
              disabled={isProcessing || isAnimating}
              className="w-14 h-14 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center hover:shadow-lg hover:shadow-primary/30 transition-all active:scale-90 disabled:opacity-40 neon-glow-pink"
            >
              <Heart className="w-6 h-6 text-primary-foreground" fill="white" />
            </button>
          </motion.div>
        )}
      </main>

      {/* Ready Gate Overlay */}
      <AnimatePresence>
        {activeSessionId && eventId && (
          <ReadyGateOverlay
            sessionId={activeSessionId}
            eventId={eventId}
            onClose={() => {
              setActiveSessionId(null);
              setStatus("browsing");
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

/* ---------- Swipeable wrapper ---------- */

interface SwipeableCardProps {
  profile: DeckProfile;
  userVibes: string[];
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  disabled?: boolean;
}

const SwipeableCard = ({ profile, userVibes, onSwipeLeft, onSwipeRight, disabled }: SwipeableCardProps) => {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 0, 200], [-12, 0, 12]);
  const vibeOpacity = useTransform(x, [0, 80], [0, 1]);
  const passOpacity = useTransform(x, [-80, 0], [1, 0]);

  const handleDragEnd = (_: any, info: PanInfo) => {
    if (disabled) return;
    const threshold = 80;
    if (info.offset.x > threshold) {
      onSwipeRight();
    } else if (info.offset.x < -threshold) {
      onSwipeLeft();
    }
  };

  return (
    <motion.div
      className="absolute inset-0 cursor-grab active:cursor-grabbing touch-none"
      style={{ x, rotate }}
      drag={disabled ? false : "x"}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.8}
      onDragEnd={handleDragEnd}
      initial={{ scale: 0.95, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      {/* Swipe indicators */}
      <motion.div
        className="absolute top-6 left-6 z-20 px-4 py-2 rounded-xl border-2 border-green-400 bg-green-500/20 backdrop-blur-sm"
        style={{ opacity: vibeOpacity }}
      >
        <span className="text-green-400 font-display font-bold text-lg">VIBE</span>
      </motion.div>
      <motion.div
        className="absolute top-6 right-6 z-20 px-4 py-2 rounded-xl border-2 border-destructive bg-destructive/20 backdrop-blur-sm"
        style={{ opacity: passOpacity }}
      >
        <span className="text-destructive font-display font-bold text-lg">PASS</span>
      </motion.div>

      <LobbyProfileCard profile={profile} userVibes={userVibes} />
    </motion.div>
  );
};

/* ---------- Card Skeleton ---------- */

const CardSkeleton = () => (
  <div className="w-full rounded-2xl overflow-hidden bg-card border border-border" style={{ aspectRatio: "3/4", maxHeight: "65vh" }}>
    <div className="w-full h-full shimmer-effect" />
  </div>
);

export default EventLobby;
