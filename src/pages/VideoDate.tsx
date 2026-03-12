import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { User } from "lucide-react";
import * as Sentry from "@sentry/react";
import { captureSupabaseError } from "@/lib/errorTracking";

import { HandshakeTimer } from "@/components/video-date/HandshakeTimer";
import { IceBreakerCard } from "@/components/video-date/IceBreakerCard";
import { VideoDateControls } from "@/components/video-date/VideoDateControls";
import { SelfViewPIP } from "@/components/video-date/SelfViewPIP";
import { ConnectionOverlay } from "@/components/video-date/ConnectionOverlay";
import { PartnerProfileSheet } from "@/components/video-date/PartnerProfileSheet";
import { PostDateSurvey } from "@/components/video-date/PostDateSurvey";
import { UrgentBorderEffect } from "@/components/video-date/UrgentBorderEffect";
import { VibeCheckButton } from "@/components/video-date/VibeCheckButton";
import { MutualVibeToast } from "@/components/video-date/MutualVibeToast";
import { KeepTheVibe } from "@/components/video-date/KeepTheVibe";
import { ReconnectionOverlay } from "@/components/video-date/ReconnectionOverlay";
import { useVideoCall } from "@/hooks/useVideoCall";
import { useCredits } from "@/hooks/useCredits";
import { useReconnection } from "@/hooks/useReconnection";
import { useAuth, useUserProfile } from "@/contexts/AuthContext";
import { useEventStatus } from "@/hooks/useEventStatus";
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/integrations/supabase/client";
import { resolvePhotoUrl } from "@/lib/photoUtils";
import { ProfilePhoto } from "@/components/ui/ProfilePhoto";
import { trackEvent } from "@/lib/analytics";

const HANDSHAKE_TIME = 60;
const DATE_TIME = 300;

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
  const { session } = useAuth();
  const { user } = useUserProfile();

  const [phase, setPhase] = useState<CallPhase>("handshake");
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [serverTimeLoaded, setServerTimeLoaded] = useState(false);
  const [blurAmount, setBlurAmount] = useState(20);
  const [showFeedback, setShowFeedback] = useState(false);
  const [callStarted, setCallStarted] = useState(false);
  const [showProfileSheet, setShowProfileSheet] = useState(false);
  const [showIceBreaker, setShowIceBreaker] = useState(true);
  const [showMutualToast, setShowMutualToast] = useState(false);
  const [isParticipant1, setIsParticipant1] = useState(false);
  const [partnerId, setPartnerId] = useState<string>("");
  const [eventId, setEventId] = useState<string | undefined>(undefined);
  const [partnerPhotoUrl, setPartnerPhotoUrl] = useState<string | null>(null);
  const [partner, setPartner] = useState<PartnerData>({
    name: "Your Match",
    age: 0,
    tags: [],
  });

  const remoteContainerRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef<CallPhase>("handshake");
  const sessionIdRef = useRef(id);
  const accessTokenRef = useRef<string | null>(null);

  const { credits, useExtraTime, useExtendedVibe } = useCredits();
  const { setStatus } = useEventStatus({ eventId });

  const {
    isConnecting,
    isConnected,
    isMuted,
    isVideoOff,
    localVideoRef,
    remoteVideoRef,
    localStream,
    startCall,
    endCall,
    toggleMute,
    toggleVideo,
  } = useVideoCall({
    roomId: id,
    userId: user?.id,
    onCallEnded: () => {
      Sentry.addBreadcrumb({ category: "video-date", message: "Call ended", level: "info" });
    },
    onPartnerJoined: () => {
      Sentry.addBreadcrumb({ category: "video-date", message: "Partner connected", level: "info" });
    },
    onPartnerLeft: () => {
      reconnection.startGraceWindow();
    },
  });

  const reconnection = useReconnection({
    sessionId: id,
    eventId,
    isConnected,
    onReconnected: () => {
      toast("They're back! 💚", { duration: 2000 });
    },
    onGraceExpired: () => {
      toast("Your date got disconnected — we hope you enjoyed the chat! 💚", {
        duration: 3000,
      });
      if (phaseRef.current !== "ended") {
        handleCallEnd();
      }
    },
  });

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Resolve a photo path to a displayable URL (sync via public URL)
  const resolvePhoto = (path: string): string | null => {
    if (!path) return null;
    return resolvePhotoUrl(path) || null;
  };

  // Fetch partner profile
  useEffect(() => {
    if (!id || !user?.id) return;

    const fetchPartner = async () => {
      try {
        const { data: session } = await supabase
          .from("video_sessions")
          .select("participant_1_id, participant_2_id, event_id")
          .eq("id", id)
          .maybeSingle();

        if (!session) return;

        const isP1 = session.participant_1_id === user.id;
        setIsParticipant1(isP1);
        setEventId(session.event_id);

        const pId = isP1 ? session.participant_2_id : session.participant_1_id;
        setPartnerId(pId);

        const { data: profile } = await supabase
          .from("profiles")
          .select("name, age, avatar_url, photos, bio, job, location, height_cm, prompts")
          .eq("id", pId)
          .maybeSingle();

        if (profile) {
          const { data: vibes } = await supabase
            .from("profile_vibes")
            .select("vibe_tags(label)")
            .eq("profile_id", pId);

          const tags = vibes?.map((v: any) => v.vibe_tags?.label).filter(Boolean) || [];

          let prompts: { question: string; answer: string }[] = [];
          if (profile.prompts && Array.isArray(profile.prompts)) {
            prompts = (profile.prompts as any[]).map((p) => ({
              question: p.question || "",
              answer: p.answer || "",
            }));
          }

          // Resolve photo URLs
          const photoArr = (profile.photos as string[]) || [];
          const primaryPath = photoArr[0] || profile.avatar_url;
          const resolvedUrl = primaryPath ? resolvePhoto(primaryPath) : null;
          setPartnerPhotoUrl(resolvedUrl);

          // Resolve all photo URLs for the profile sheet
          const resolvedPhotos: string[] = photoArr.slice(0, 6)
            .map(p => resolvePhoto(p))
            .filter(Boolean) as string[];

          setPartner({
            name: profile.name,
            age: profile.age,
            tags,
            avatarUrl: resolvedUrl || undefined,
            photos: resolvedPhotos.length > 0 ? resolvedPhotos : undefined,
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
      Sentry.addBreadcrumb({ category: "video-date", message: "Joined video date", level: "info" });
      startCall(id);
    }
  }, [callStarted, startCall, id]);

  // Fetch server-side timing on mount and refresh
  useEffect(() => {
    if (!id) return;

    const fetchTiming = async () => {
      const { data } = await supabase
        .from("video_sessions")
        .select("handshake_started_at, date_started_at, phase, state, ended_at")
        .eq("id", id)
        .single();

      if (!data) {
        // Fallback: use frontend-only timer
        setTimeLeft(HANDSHAKE_TIME);
        setServerTimeLoaded(true);
        return;
      }

      const now = Date.now();

      if (data.ended_at || (data.state as any) === "ended" || data.phase === "ended") {
        setPhase("ended");
        setTimeLeft(0);
        setServerTimeLoaded(true);
        return;
      }

      if (((data.state as any) === "date" || data.phase === "date") && data.date_started_at) {
        const elapsed = (now - new Date(data.date_started_at).getTime()) / 1000;
        setTimeLeft(Math.max(0, Math.ceil(DATE_TIME - elapsed)));
        setPhase("date");
      } else if (data.handshake_started_at) {
        const elapsed = (now - new Date(data.handshake_started_at).getTime()) / 1000;
        setTimeLeft(Math.max(0, Math.ceil(HANDSHAKE_TIME - elapsed)));
      } else {
        // No server timestamp yet — set it via server-owned transition
        await supabase.rpc("video_date_transition", { p_session_id: id, p_action: "enter_handshake" });
        setTimeLeft(HANDSHAKE_TIME);
      }
      setServerTimeLoaded(true);
    };

    fetchTiming();
  }, [id]);

  // Subscribe to phase changes via Realtime
  useEffect(() => {
    if (!id) return;

    const channel = supabase
      .channel(`session-timer-${id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "video_sessions",
          filter: `id=eq.${id}`,
        },
        (payload) => {
          const row = payload.new as any;
          const newState = row.state || row.phase;

          if (row.ended_at || newState === "ended") {
            setPhase("ended");
            setTimeLeft(0);
            return;
          }

          if (newState === "date" && row.date_started_at) {
            const elapsed = (Date.now() - new Date(row.date_started_at).getTime()) / 1000;
            setTimeLeft(Math.ceil(Math.max(0, DATE_TIME - elapsed)));
            setPhase("date");
            return;
          }

          if (row.handshake_started_at) {
            const elapsed = (Date.now() - new Date(row.handshake_started_at).getTime()) / 1000;
            setTimeLeft(Math.ceil(Math.max(0, HANDSHAKE_TIME - elapsed)));
            setPhase("handshake");
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);

  // Progressive blur: clear over 10s when connected + track start
  useEffect(() => {
    if (isConnected) {
      trackEvent('video_date_started', { session_id: id, phase: 'handshake' });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setBlurAmount(0);
        });
      });
    }
  }, [isConnected]);

  // Countdown timer
  useEffect(() => {
    if (timeLeft === null || showFeedback || !isConnected || phase === "ended" || reconnection.isTimerPaused)
      return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev === null || prev <= 1) {
          if (phaseRef.current === "handshake") {
            checkMutualVibe();
          } else {
            toast("Time flies! Thanks for a great date 💚", { duration: 2500 });
            handleCallEnd();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [timeLeft !== null, showFeedback, isConnected, phase, reconnection.isTimerPaused]);

  // Auto-hide ice breaker after 20s
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

  useEffect(() => {
    accessTokenRef.current = session?.access_token ?? null;
  }, [session?.access_token]);

  // Beforeunload — warn user and cleanup via keepalive fetch
  useEffect(() => {
    if (!id || !user?.id) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isConnected) {
        e.preventDefault();
        e.returnValue = "You're in a video date. Are you sure you want to leave?";
      }

      const token = accessTokenRef.current;
      const baseUrl = SUPABASE_URL;

      // Server-owned transition + status update (keepalive fetch with JWT)
      if (token && baseUrl) {
        fetch(`${baseUrl}/rest/v1/rpc/video_date_transition`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            apikey: SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ p_session_id: id, p_action: "end", p_reason: "beforeunload" }),
          keepalive: true,
        }).catch(() => {});

        if (eventId) {
          fetch(`${baseUrl}/rest/v1/rpc/update_participant_status`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              apikey: SUPABASE_PUBLISHABLE_KEY,
            },
            body: JSON.stringify({ p_event_id: eventId, p_user_id: user.id, p_status: "offline" }),
            keepalive: true,
          }).catch(() => {});
        }
      }

      // Best-effort Daily room cleanup (requires JWT when daily-room has verify_jwt = true)
      if (token) {
        const dailyRoomUrl = `${baseUrl}/functions/v1/daily-room`;
        fetch(dailyRoomUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "delete_room", roomName: `date-${id?.replace(/-/g, "")}` }),
          keepalive: true,
        });
      }

      // Stop media tracks
      if (localVideoRef.current?.srcObject) {
        (localVideoRef.current.srcObject as MediaStream)
          .getTracks()
          .forEach((t) => t.stop());
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [id, user?.id, eventId, isConnected]);

  // Record user's vibe
  const handleUserVibe = useCallback(async () => {
    if (!id || !user?.id) return;
    try {
      await supabase.rpc("video_date_transition", { p_session_id: id, p_action: "vibe" });
    } catch (err) {
      console.error("Error recording vibe:", err);
    }
  }, [id, user?.id, isParticipant1]);

  // Check mutual vibe at end of handshake
  const checkMutualVibe = useCallback(async () => {
    if (!id) {
      handleCallEnd();
      return;
    }
    try {
      const { data: result } = await supabase.rpc("video_date_transition", {
        p_session_id: id,
        p_action: "complete_handshake",
      });

      if ((result as any)?.state === "date") {
        setShowMutualToast(true);
        setStatus("in_date");
      } else {
        toast("Great meeting you! 👋", { duration: 2500 });
        endCall();
        handleCallEnd();
      }
    } catch (err) {
      console.error("Error checking mutual vibe:", err);
      handleCallEnd();
    }
  }, [id, endCall, setStatus]);

  const handleMutualToastComplete = useCallback(async () => {
    setShowMutualToast(false);
    setPhase("date");
    setTimeLeft(DATE_TIME);
    trackEvent('video_date_extended', { session_id: id });
    setShowIceBreaker(true);
    setTimeout(() => setShowIceBreaker(false), 30000);

    // Server already transitioned to date via video_date_transition; no client-owned writes needed here.
  }, [id]);

  const handleExtend = useCallback(
    async (minutes: number, type: "extra_time" | "extended_vibe"): Promise<boolean> => {
      const success =
        type === "extra_time" ? await useExtraTime() : await useExtendedVibe();
      if (success) {
        Sentry.addBreadcrumb({ category: "credits", message: `Used ${type} credit, +${minutes} min`, level: "info" });
        trackEvent('credit_used', { type, minutes });
        setTimeLeft((prev) => (prev ?? 0) + minutes * 60);
      }
      return success;
    },
    [useExtraTime, useExtendedVibe]
  );

  // End call: update session, show survey
  const handleCallEnd = useCallback(async () => {
    const totalTime = phase === "handshake" ? HANDSHAKE_TIME : HANDSHAKE_TIME + DATE_TIME;
    trackEvent('video_date_ended', {
      session_id: id,
      duration_seconds: totalTime - (timeLeft ?? 0),
      phase,
    });
    setPhase("ended");
    setShowFeedback(true);
    setStatus("in_survey");

    // Server-owned end (idempotent)
    if (id) {
      try {
        await supabase.rpc("video_date_transition", {
          p_session_id: id,
          p_action: "end",
          p_reason: "ended_from_client",
        });
      } catch {}
    }
  }, [id, setStatus, phase, timeLeft]);

  const handleLeave = useCallback(async () => {
    endCall();
    if (id && user?.id && eventId) {
      try {
        await supabase.rpc("leave_matching_queue", {
          p_event_id: eventId,
          p_user_id: user.id,
        });
      } catch (err) {
        console.error("Error cleaning up:", err);
      }
    }
    toast("You left the date — stay safe! 💚", { duration: 2000 });
    handleCallEnd();
  }, [endCall, id, user?.id, eventId, handleCallEnd]);

  const totalTime = phase === "handshake" ? HANDSHAKE_TIME : DATE_TIME;
  const isUrgent = phase === "date" && (timeLeft ?? 999) <= 10;

  return (
    <div className="fixed inset-0 bg-background flex flex-col overflow-hidden">
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
          {partnerPhotoUrl ? (
            <img
              src={partnerPhotoUrl}
              alt={partner.name}
              className="w-8 h-8 rounded-full object-cover border border-primary/30"
              loading="eager"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <ProfilePhoto
              name={partner.name}
              size="sm"
              rounded="full"
              loading="eager"
              className="w-8 h-8"
            />
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
                  className="w-1.5 h-1.5 rounded-full bg-green-500"
                  animate={{ opacity: [1, 0.5, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
                <span className="text-[10px] text-green-500">
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
            timeLeft={timeLeft ?? 0}
            totalTime={totalTime}
            phase={phase}
          />
        </div>

        {/* Keep the Vibe — credits extension (date phase only) */}
        {isConnected && phase === "date" && !showFeedback && (
          <KeepTheVibe
            extraTimeCredits={credits.extraTime}
            extendedVibeCredits={credits.extendedVibe}
            onExtend={handleExtend}
          />
        )}
      </motion.div>

      {/* ─── Remote Video with Progressive Blur ─── */}
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
          {(isConnecting || !isConnected) &&
            !showFeedback &&
            !reconnection.isPartnerDisconnected && (
              <ConnectionOverlay
                isConnecting={isConnecting}
                onLeave={handleLeave}
              />
            )}
        </AnimatePresence>

        {/* Reconnection overlay */}
        <ReconnectionOverlay
          isVisible={reconnection.isPartnerDisconnected}
          partnerName={partner.name}
          graceTimeLeft={reconnection.graceTimeLeft}
        />

        {/* Bottom gradient */}
        <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-background via-background/50 to-transparent pointer-events-none" />
      </div>

      {/* ─── Self-View PIP ─── */}
      {isConnected && (
        <SelfViewPIP
          stream={localStream}
          isVideoOff={isVideoOff}
          isMuted={isMuted}
          containerRef={remoteContainerRef}
          blurAmount={blurAmount}
        />
      )}

      {/* ─── Ice Breaker (compact pill) ─── */}
      <AnimatePresence>
        {isConnected && showIceBreaker && !showFeedback && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 10, opacity: 0 }}
            className="absolute bottom-28 left-3 right-3 z-20"
          >
            <IceBreakerCard
              sessionId={id}
              onDismiss={() => setShowIceBreaker(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Vibed ✓ Button (handshake only) ─── */}
      <AnimatePresence>
        {isConnected && phase === "handshake" && !showFeedback && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-28 left-0 right-0 z-25 flex justify-center"
          >
            <VibeCheckButton timeLeft={timeLeft} onVibe={handleUserVibe} />
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

      {/* ─── Post-Date Survey ─── */}
      <PostDateSurvey
        isOpen={showFeedback}
        sessionId={id || ""}
        partnerId={partnerId}
        partnerName={partner.name}
        partnerImage={partnerPhotoUrl || ""}
        eventId={eventId}
      />
    </div>
  );
};

export default VideoDate;
