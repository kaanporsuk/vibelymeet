import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
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
import { InCallSafetyModal } from "@/components/video-date/InCallSafetyModal";
import { useVideoCall } from "@/hooks/useVideoCall";
import { useCredits } from "@/hooks/useCredits";
import { useReconnection } from "@/hooks/useReconnection";
import { useVideoDateDupTabGuard } from "@/hooks/useVideoDateDupTabGuard";
import { useAuth, useUserProfile } from "@/contexts/AuthContext";
import { useEventStatus } from "@/hooks/useEventStatus";
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/integrations/supabase/client";
import { resolvePhotoUrl } from "@/lib/photoUtils";
import { ProfilePhoto } from "@/components/ui/ProfilePhoto";
import { trackEvent } from "@/lib/analytics";
import { Button } from "@/components/ui/button";
import {
  clearDateEntryTransition,
  isDateEntryTransitionActive,
  markVideoDateEntryPipelineStarted,
} from "@/lib/dateEntryTransitionLatch";

const HANDSHAKE_TIME = 60;
const DATE_TIME = 300;

type VideoDateAccess = "loading" | "allowed" | "denied" | "not_found";

function messageForHandshakeFailure(code?: string): string {
  if (code === "READY_GATE_NOT_READY") {
    return "Almost there — finish the Ready Gate with your match first.";
  }
  if (code === "SESSION_ENDED") {
    return "This date has already ended.";
  }
  return "Could not start your video date. Go back and try again.";
}

interface PartnerData {
  name: string;
  age: number;
  tags: string[];
  avatarUrl?: string;
  photos?: string[];
  about_me?: string;
  job?: string;
  location?: string;
  heightCm?: number;
  prompts?: { question: string; answer: string }[];
}

type CallPhase = "handshake" | "date" | "ended";

function videoDateDebug(message: string, data?: Record<string, unknown>) {
  if (!import.meta.env.DEV) return;
  console.log(`[VideoDate] ${message}`, data ?? {});
}

function vdbg(message: string, data?: Record<string, unknown>) {
  const payload = { ...(data ?? {}), ts: new Date().toISOString() };
  console.log(`[VDBG] ${message}`, payload);
  Sentry.addBreadcrumb({
    category: "vdbg",
    message,
    level: "info",
    data: payload,
  });
}

function vdbgRedirect(target: string, reason: string, data?: Record<string, unknown>) {
  vdbg("date_redirect", { target, reason, ...(data ?? {}) });
}

function videoSessionIndicatesHandshakeOrDate(
  row: { state?: string | null; phase?: string | null; handshake_started_at?: string | null } | null
): boolean {
  return Boolean(
    row &&
      (row.state === "handshake" ||
        row.state === "date" ||
        row.phase === "handshake" ||
        row.phase === "date" ||
        row.handshake_started_at)
  );
}

const VideoDate = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const { session } = useAuth();
  const { user } = useUserProfile();

  const [phase, setPhase] = useState<CallPhase>("handshake");
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [videoDateAccess, setVideoDateAccess] = useState<VideoDateAccess>("loading");
  const [deniedEventId, setDeniedEventId] = useState<string | undefined>(undefined);
  const [timingReady, setTimingReady] = useState(false);
  const [handshakeStartFailed, setHandshakeStartFailed] = useState(false);
  const [handshakeFailureCode, setHandshakeFailureCode] = useState<string | undefined>(undefined);
  const [blurAmount, setBlurAmount] = useState(20);
  const [showFeedback, setShowFeedback] = useState(false);
  const [callStarted, setCallStarted] = useState(false);
  const [showProfileSheet, setShowProfileSheet] = useState(false);
  const [showIceBreaker, setShowIceBreaker] = useState(true);
  const [showMutualToast, setShowMutualToast] = useState(false);
  const [showInCallSafety, setShowInCallSafety] = useState(false);
  const [isParticipant1, setIsParticipant1] = useState(false);
  const [partnerId, setPartnerId] = useState<string>("");
  const [eventId, setEventId] = useState<string | undefined>(undefined);
  const [partnerPhotoUrl, setPartnerPhotoUrl] = useState<string | null>(null);
  const [partner, setPartner] = useState<PartnerData>({
    name: "Your date",
    age: 0,
    tags: [],
  });

  const remoteContainerRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef<CallPhase>("handshake");
  const sessionIdRef = useRef(id);
  const accessTokenRef = useRef<string | null>(null);
  // Canonical Daily room name loaded from video_sessions; used for safe beforeunload cleanup.
  const canonicalRoomNameRef = useRef<string | null>(null);

  const { credits, refetch: refetchCredits } = useCredits();
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
    getRoomName,
    networkTier,
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

  const { dupBlocked, takeOver } = useVideoDateDupTabGuard(
    id,
    videoDateAccess === "allowed" && !showFeedback && phase !== "ended",
  );

  const reconnection = useReconnection({
    sessionId: videoDateAccess === "allowed" ? id : undefined,
    isConnected,
    phase,
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

  useLayoutEffect(() => {
    if (!id) return;
    markVideoDateEntryPipelineStarted(id);
    videoDateDebug("date-entry latch marked", { sessionId: id, userId: user?.id ?? null });
  }, [id, user?.id]);

  useEffect(() => {
    vdbg("date_mount", { sessionId: id ?? null, userId: user?.id ?? null });
    if (!id || !user?.id) return;
    const userId = user.id;
    let cancelled = false;
    void supabase
      .from("video_sessions")
      .select("*")
      .eq("id", id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        vdbg("date_mount_session_row", {
          sessionId: id,
          userId,
          row: data ?? null,
          error: error ? { code: error.code, message: error.message } : null,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [id, user?.id]);

  // Resolve a photo path to a displayable URL (sync via public URL)
  const resolvePhoto = (path: string): string | null => {
    if (!path) return null;
    return resolvePhotoUrl(path) || null;
  };

  // Load session, enforce participant guard, then resolve partner profile (only when allowed).
  // Ended + in_ready_gate navigations: defense-in-depth vs `SessionRouteHydration` (hydration-gated).
  useEffect(() => {
    if (!id) {
      setVideoDateAccess("not_found");
      return;
    }
    if (!user?.id) return;

    let cancelled = false;

    const load = async () => {
      setVideoDateAccess("loading");
      setTimingReady(false);
      setHandshakeStartFailed(false);
      setHandshakeFailureCode(undefined);
      setCallStarted(false);

      try {
        const { data: sessionRow, error: sessionErr } = await supabase
          .from("video_sessions")
          .select("participant_1_id, participant_2_id, event_id, daily_room_name, ended_at, state, phase, handshake_started_at, ready_gate_status, ready_gate_expires_at")
          .eq("id", id)
          .maybeSingle();

        if (cancelled) return;

        vdbg("date_guard_session_row", {
          sessionId: id,
          userId: user.id,
          row: sessionRow ?? null,
          error: sessionErr ? { code: sessionErr.code, message: sessionErr.message } : null,
        });

        if (sessionErr || !sessionRow) {
          vdbg("date_guard_blocked", {
            sessionId: id,
            userId: user.id,
            reason: "missing_session",
            error: sessionErr ? { code: sessionErr.code, message: sessionErr.message } : null,
          });
          setVideoDateAccess("not_found");
          return;
        }

        const isP1 = sessionRow.participant_1_id === user.id;
        const isParticipant = isP1 || sessionRow.participant_2_id === user.id;
        if (!isParticipant) {
          vdbg("date_guard_blocked", {
            sessionId: id,
            userId: user.id,
            reason: "not_a_participant",
            eventId: sessionRow.event_id,
          });
          setDeniedEventId(sessionRow.event_id ?? undefined);
          setVideoDateAccess("denied");
          return;
        }

        if (sessionRow.ended_at) {
          clearDateEntryTransition(id);
          toast.info("This date has already ended.", { duration: 2800 });
          const target = sessionRow.event_id
            ? `/event/${encodeURIComponent(sessionRow.event_id)}/lobby`
            : "/home";
          vdbgRedirect(target, "session_ended", {
            sessionId: id,
            userId: user.id,
            eventId: sessionRow.event_id,
            endedAt: sessionRow.ended_at,
          });
          navigate(target, { replace: true });
          return;
        }

        const { data: reg } = await supabase
          .from("event_registrations")
          .select("queue_status")
          .eq("event_id", sessionRow.event_id)
          .eq("profile_id", user.id)
          .maybeSingle();

        if (cancelled) return;

        if (reg?.queue_status === "in_ready_gate") {
          const rgStatus = (sessionRow as { ready_gate_status?: string | null }).ready_gate_status ?? null;
          const rgExpiresRaw = (sessionRow as { ready_gate_expires_at?: string | number | null }).ready_gate_expires_at ?? null;
          const rgExpiresMs =
            rgExpiresRaw == null
              ? null
              : typeof rgExpiresRaw === "number"
                ? rgExpiresRaw
                : Date.parse(String(rgExpiresRaw));
          const bothReady = rgStatus === "both_ready";
          const bothReadyValid =
            bothReady && rgExpiresMs != null && Number.isFinite(rgExpiresMs) && rgExpiresMs > Date.now();
          const readyGateBranch = bothReadyValid
            ? "both_ready_valid_staying"
            : bothReady
              ? "both_ready_expired_redirecting"
              : "no_both_ready_redirecting";
          vdbg("date_guard_ready_gate_branch", {
            sessionId: id,
            userId: user.id,
            branch: readyGateBranch,
            readyGateStatus: rgStatus,
            readyGateExpiresAt: rgExpiresRaw,
          });
          const allowEntry =
            bothReadyValid ||
            isDateEntryTransitionActive(id) ||
            videoSessionIndicatesHandshakeOrDate(sessionRow);
          if (!allowEntry) {
            videoDateDebug("bouncing ready_gate session back to lobby", {
              sessionId: id,
              eventId: sessionRow.event_id,
              queueStatus: reg.queue_status,
              state: sessionRow.state,
              phase: sessionRow.phase,
            });
            const target = `/event/${encodeURIComponent(sessionRow.event_id)}/lobby`;
            vdbgRedirect(target, "in_ready_gate_without_date_entry_latch_or_handshake", {
              sessionId: id,
              userId: user.id,
              eventId: sessionRow.event_id,
              queueStatus: reg.queue_status,
              state: sessionRow.state,
              phase: sessionRow.phase,
              handshakeStarted: Boolean(sessionRow.handshake_started_at),
              latchActive: isDateEntryTransitionActive(id),
            });
            navigate(target, { replace: true });
            return;
          }
          videoDateDebug("allowing ready_gate registration through date-entry latch", {
            sessionId: id,
            eventId: sessionRow.event_id,
            state: sessionRow.state,
            phase: sessionRow.phase,
            handshakeStarted: Boolean(sessionRow.handshake_started_at),
          });
        } else if (reg?.queue_status) {
          clearDateEntryTransition(id);
        }

        if (sessionRow.daily_room_name) {
          canonicalRoomNameRef.current = sessionRow.daily_room_name;
        }
        setIsParticipant1(isP1);
        setEventId(sessionRow.event_id);
        const pId = isP1 ? sessionRow.participant_2_id : sessionRow.participant_1_id;
        setPartnerId(pId);

        const { data: profile } = await supabase
          .from("profiles")
          .select("name, age, avatar_url, photos, about_me, job, location, height_cm, prompts")
          .eq("id", pId)
          .maybeSingle();

        if (cancelled) return;

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

          const photoArr = (profile.photos as string[]) || [];
          const primaryPath = photoArr[0] || profile.avatar_url;
          const resolvedUrl = primaryPath ? resolvePhoto(primaryPath) : null;
          setPartnerPhotoUrl(resolvedUrl);

          const resolvedPhotos: string[] = photoArr
            .slice(0, 6)
            .map((p) => resolvePhoto(p))
            .filter(Boolean) as string[];

          setPartner({
            name: profile.name,
            age: profile.age,
            tags,
            avatarUrl: resolvedUrl || undefined,
            photos: resolvedPhotos.length > 0 ? resolvedPhotos : undefined,
            about_me: profile.about_me || undefined,
            job: profile.job || undefined,
            location: profile.location || undefined,
            heightCm: profile.height_cm || undefined,
            prompts,
          });
        }

        if (!cancelled) {
          setVideoDateAccess("allowed");
        }
      } catch (err) {
        console.error("Error loading video date session:", err);
        vdbg("date_guard_exception", {
          sessionId: id,
          userId: user.id,
          error: err instanceof Error ? { name: err.name, message: err.message } : String(err),
        });
        if (!cancelled) {
          setVideoDateAccess("not_found");
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [id, user?.id, navigate]);

  // Server-side phase timing + enter_handshake (only after participant guard passes).
  useEffect(() => {
    if (!id || videoDateAccess !== "allowed") return;

    let cancelled = false;

    const fetchTiming = async () => {
      setTimingReady(false);
      setHandshakeStartFailed(false);
      setHandshakeFailureCode(undefined);

      const { data, error } = await supabase
        .from("video_sessions")
        .select("handshake_started_at, date_started_at, phase, state, ended_at")
        .eq("id", id)
        .maybeSingle();

      if (cancelled) return;

      if (error || !data) {
        vdbg("date_timing_fetch_failed", {
          sessionId: id,
          error: error ? { code: error.code, message: error.message } : null,
          hasData: Boolean(data),
        });
        setHandshakeStartFailed(true);
        setHandshakeFailureCode(undefined);
        setTimeLeft(null);
        setTimingReady(true);
        return;
      }

      const now = Date.now();

      if (data.ended_at || (data.state as string) === "ended" || data.phase === "ended") {
        vdbg("date_timing_guard_ended", { sessionId: id, row: data });
        setPhase("ended");
        setTimeLeft(0);
        setTimingReady(true);
        return;
      }

      if (((data.state as string) === "date" || data.phase === "date") && data.date_started_at) {
        vdbg("date_timing_existing_date", { sessionId: id, row: data });
        const elapsed = (now - new Date(data.date_started_at).getTime()) / 1000;
        setTimeLeft(Math.max(0, Math.ceil(DATE_TIME - elapsed)));
        setPhase("date");
        setTimingReady(true);
        return;
      }

      if (data.handshake_started_at) {
        vdbg("date_timing_existing_handshake", { sessionId: id, row: data });
        const elapsed = (now - new Date(data.handshake_started_at).getTime()) / 1000;
        setTimeLeft(Math.max(0, Math.ceil(HANDSHAKE_TIME - elapsed)));
        setTimingReady(true);
        return;
      }

      const enterHandshakeArgs = {
        p_session_id: id,
        p_action: "enter_handshake",
      };
      vdbg("video_date_transition_before", {
        action: "enter_handshake",
        args: enterHandshakeArgs,
      });
      const { data: rpcData, error: rpcErr } = await supabase.rpc("video_date_transition", enterHandshakeArgs);

      if (cancelled) return;

      if (rpcErr) {
        console.error("enter_handshake RPC error:", rpcErr);
        vdbg("video_date_transition_after", {
          action: "enter_handshake",
          ok: false,
          error: { code: rpcErr.code, message: rpcErr.message },
        });
        captureSupabaseError("video_date_enter_handshake", rpcErr);
        setHandshakeStartFailed(true);
        setHandshakeFailureCode(undefined);
        setTimeLeft(null);
        setTimingReady(true);
        return;
      }

      const payload = rpcData as { success?: boolean; code?: string } | null;
      vdbg("video_date_transition_after", {
        action: "enter_handshake",
        ok: payload?.success !== false,
        payload,
      });
      if (payload && payload.success === false) {
        setHandshakeStartFailed(true);
        setHandshakeFailureCode(payload.code);
        setTimeLeft(null);
        setTimingReady(true);
        return;
      }

      setHandshakeStartFailed(false);
      setTimeLeft(HANDSHAKE_TIME);
      setTimingReady(true);
    };

    void fetchTiming();

    return () => {
      cancelled = true;
    };
  }, [id, videoDateAccess]);

  // Start Daily only when timing/handshake bootstrap succeeded (or session already in progress).
  useEffect(() => {
    if (!id) return;
    if (videoDateAccess !== "allowed" || !timingReady || handshakeStartFailed) return;
    if (phase === "ended") return;
    if (dupBlocked) return;
    if (callStarted) return;

    setCallStarted(true);
    Sentry.addBreadcrumb({ category: "video-date", message: "Joined video date", level: "info" });
    startCall(id).then(() => {
      const name = getRoomName();
      if (name) canonicalRoomNameRef.current = name;
    });
  }, [
    id,
    videoDateAccess,
    timingReady,
    handshakeStartFailed,
    phase,
    callStarted,
    startCall,
    getRoomName,
    dupBlocked,
  ]);

  // Subscribe to phase changes via Realtime
  useEffect(() => {
    if (!id || videoDateAccess !== "allowed") return;

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
  }, [id, videoDateAccess]);

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
    if (!id || !user?.id || videoDateAccess !== "allowed") return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isConnected) {
        e.preventDefault();
        e.returnValue = "You're in a video date. Are you sure you want to leave?";
      }

      const token = accessTokenRef.current;
      const baseUrl = SUPABASE_URL;

      // Server-owned transition + status update (keepalive fetch with JWT)
      if (token && baseUrl) {
        const transitionArgs = { p_session_id: id, p_action: "end", p_reason: "beforeunload" };
        vdbg("video_date_transition_before", {
          action: "end",
          args: transitionArgs,
          transport: "keepalive_fetch",
        });
        fetch(`${baseUrl}/rest/v1/rpc/video_date_transition`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            apikey: SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify(transitionArgs),
          keepalive: true,
        })
          .then((response) => {
            vdbg("video_date_transition_after", {
              action: "end",
              ok: response.ok,
              status: response.status,
              transport: "keepalive_fetch",
            });
          })
          .catch((error) => {
            vdbg("video_date_transition_after", {
              action: "end",
              ok: false,
              transport: "keepalive_fetch",
              error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
            });
          });
        // video_date_transition(end, beforeunload) sets queue_status = offline on server
      }

      // Best-effort Daily room cleanup using canonical stored room name (never reconstructed).
      // canonicalRoomNameRef is populated from video_sessions.daily_room_name on session load.
      const canonicalRoom = canonicalRoomNameRef.current;
      if (token && canonicalRoom) {
        const dailyRoomUrl = `${baseUrl}/functions/v1/daily-room`;
        fetch(dailyRoomUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "delete_room", roomName: canonicalRoom }),
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
  }, [id, user?.id, eventId, isConnected, videoDateAccess]);

  // Record user's vibe
  const handleUserVibe = useCallback(async () => {
    if (!id || !user?.id) return;
    const args = { p_session_id: id, p_action: "vibe" };
    vdbg("video_date_transition_before", { action: "vibe", args });
    try {
      const { data, error } = await supabase.rpc("video_date_transition", args);
      vdbg("video_date_transition_after", {
        action: "vibe",
        ok: !error,
        payload: data ?? null,
        error: error ? { code: error.code, message: error.message } : null,
      });
    } catch (err) {
      console.error("Error recording vibe:", err);
      vdbg("video_date_transition_after", {
        action: "vibe",
        ok: false,
        error: err instanceof Error ? { name: err.name, message: err.message } : String(err),
      });
    }
  }, [id, user?.id, isParticipant1]);

  // Check mutual vibe at end of handshake
  const checkMutualVibe = useCallback(async () => {
    if (!id) {
      handleCallEnd();
      return;
    }
    const args = {
      p_session_id: id,
      p_action: "complete_handshake",
    };
    vdbg("video_date_transition_before", { action: "complete_handshake", args });
    try {
      const { data: result, error } = await supabase.rpc("video_date_transition", args);
      vdbg("video_date_transition_after", {
        action: "complete_handshake",
        ok: !error,
        payload: result ?? null,
        error: error ? { code: error.code, message: error.message } : null,
      });

      if ((result as any)?.state === "date") {
        setShowMutualToast(true);
      } else {
        toast("Great meeting you! 👋", { duration: 2500 });
        endCall();
        handleCallEnd();
      }
    } catch (err) {
      console.error("Error checking mutual vibe:", err);
      vdbg("video_date_transition_after", {
        action: "complete_handshake",
        ok: false,
        error: err instanceof Error ? { name: err.name, message: err.message } : String(err),
      });
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
      if (!id) return false;
      const { data, error } = await supabase.rpc("spend_video_date_credit_extension", {
        p_session_id: id,
        p_credit_type: type,
      });
      const row = data as { success?: boolean; error?: string } | null;
      if (error || !row?.success) {
        if (error) captureSupabaseError("spend_video_date_credit_extension", error);
        return false;
      }
      Sentry.addBreadcrumb({ category: "credits", message: `Used ${type} credit, +${minutes} min`, level: "info" });
      trackEvent("credit_used", { type, minutes });
      setTimeLeft((prev) => (prev ?? 0) + minutes * 60);
      void refetchCredits();
      return true;
    },
    [id, refetchCredits]
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

    if (id) {
      const args = {
        p_session_id: id,
        p_action: "end",
        p_reason: "ended_from_client",
      };
      vdbg("video_date_transition_before", { action: "end", args });
      try {
        const { data, error } = await supabase.rpc("video_date_transition", args);
        vdbg("video_date_transition_after", {
          action: "end",
          ok: !error,
          payload: data ?? null,
          error: error ? { code: error.code, message: error.message } : null,
        });
      } catch (error) {
        vdbg("video_date_transition_after", {
          action: "end",
          ok: false,
          error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
        });
      }
    }
    setStatus("in_survey");
  }, [id, setStatus, phase, timeLeft]);

  const handleLeave = useCallback(async () => {
    endCall();
    toast("You left the date — stay safe! 💚", { duration: 2000 });
    handleCallEnd();
  }, [endCall, handleCallEnd]);

  /** After in-call "End & report" succeeds (report RPC already sent). */
  const handleEndAfterInCallReport = useCallback(async () => {
    await endCall();
    await handleCallEnd();
  }, [endCall, handleCallEnd]);

  const dupLeaseNavigateRef = useRef(false);
  useEffect(() => {
    if (!dupBlocked || !callStarted) return;
    if (dupLeaseNavigateRef.current) return;
    dupLeaseNavigateRef.current = true;
    void (async () => {
      toast.info("This date continued in another tab — closing here.", { duration: 3500 });
      await endCall();
      setCallStarted(false);
      const target = eventId ? `/event/${encodeURIComponent(eventId)}/lobby` : "/events";
      vdbgRedirect(target, "duplicate_tab_lease_blocked", { sessionId: id ?? null, eventId: eventId ?? null });
      navigate(target);
    })();
  }, [dupBlocked, callStarted, endCall, navigate, eventId]);

  const totalTime = phase === "handshake" ? HANDSHAKE_TIME : DATE_TIME;
  const isUrgent = phase === "date" && (timeLeft ?? 999) <= 10;

  if (!id || videoDateAccess === "not_found") {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center gap-4">
        <User className="w-14 h-14 text-muted-foreground" />
        <h1 className="text-xl font-display font-semibold">We couldn&apos;t open this date</h1>
        <p className="text-muted-foreground text-sm max-w-sm">
          This link may be invalid or the session no longer exists.
        </p>
        <Button
          type="button"
          onClick={() => {
            vdbgRedirect("/events", "not_found_back_to_events", { sessionId: id ?? null });
            navigate("/events");
          }}
        >
          Back to events
        </Button>
      </div>
    );
  }

  if (!user?.id) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-12 h-12 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (videoDateAccess === "loading") {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
        <div className="w-12 h-12 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        <p className="text-sm text-muted-foreground">Loading your date…</p>
      </div>
    );
  }

  if (videoDateAccess === "denied") {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center gap-4">
        <User className="w-14 h-14 text-muted-foreground" />
        <h1 className="text-xl font-display font-semibold">You don&apos;t have access to this date</h1>
        <p className="text-muted-foreground text-sm max-w-sm">
          This video date is for matched participants only.
        </p>
        <Button
          type="button"
          onClick={() => {
            const target = deniedEventId
              ? `/event/${encodeURIComponent(deniedEventId)}/lobby`
              : "/events";
            vdbgRedirect(target, "denied_back", { sessionId: id ?? null, eventId: deniedEventId ?? null });
            navigate(target);
          }}
        >
          {deniedEventId ? "Back to event lobby" : "Back to events"}
        </Button>
      </div>
    );
  }

  if (handshakeStartFailed) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center gap-4">
        <User className="w-14 h-14 text-muted-foreground" />
        <h1 className="text-xl font-display font-semibold">Video date couldn&apos;t start</h1>
        <p className="text-muted-foreground text-sm max-w-sm">{messageForHandshakeFailure(handshakeFailureCode)}</p>
        <Button
          type="button"
          onClick={() => {
            const target = eventId
              ? `/event/${encodeURIComponent(eventId)}/lobby`
              : "/events";
            vdbgRedirect(target, "handshake_start_failed_back", {
              sessionId: id ?? null,
              eventId: eventId ?? null,
              code: handshakeFailureCode ?? null,
            });
            navigate(target);
          }}
        >
          {eventId ? "Back to event lobby" : "Back to events"}
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-background flex flex-col overflow-hidden">
      {dupBlocked && !callStarted && videoDateAccess === "allowed" && !showFeedback && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-background/95 p-6 text-center">
          <p className="text-lg font-display font-semibold text-foreground max-w-sm">
            This date is already open in another window
          </p>
          <p className="text-sm text-muted-foreground max-w-sm">
            Continue here only if you closed the other tab, or you may disconnect the call there.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 w-full max-w-xs">
            <Button type="button" className="w-full" onClick={() => takeOver()}>
              Continue here
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => {
                const target = eventId ? `/event/${encodeURIComponent(eventId)}/lobby` : "/events";
                vdbgRedirect(target, "duplicate_tab_back", { sessionId: id ?? null, eventId: eventId ?? null });
                navigate(target);
              }}
            >
              Back
            </Button>
          </div>
        </div>
      )}

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
              <div className="flex flex-col items-start gap-0.5">
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
                {networkTier !== "good" && (
                  <span
                    className={`text-[10px] ${networkTier === "poor" ? "text-destructive" : "text-amber-500"}`}
                  >
                    {networkTier === "poor" ? "Poor connection" : "Fair connection"}
                  </span>
                )}
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
      {isConnected && !showFeedback && (
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
          onSafety={
            isConnected && !showFeedback && partnerId
              ? () => setShowInCallSafety(true)
              : undefined
          }
        />
      </div>

      {/* ─── Partner Profile Sheet ─── */}
      <PartnerProfileSheet
        isOpen={showProfileSheet}
        onClose={() => setShowProfileSheet(false)}
        partner={partner}
      />

      <InCallSafetyModal
        open={showInCallSafety}
        onOpenChange={setShowInCallSafety}
        reportedUserId={partnerId || null}
        onEndAfterReport={handleEndAfterInCallReport}
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
