import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { User } from "lucide-react";
import * as Sentry from "@sentry/react";
import { vdbg, vdbgRedirect } from "@/lib/vdbg";
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
import { useVideoCall, type VideoCallStartFailure } from "@/hooks/useVideoCall";
import { useCredits } from "@/hooks/useCredits";
import { useReconnection } from "@/hooks/useReconnection";
import { useVideoDateDupTabGuard } from "@/hooks/useVideoDateDupTabGuard";
import { useAuth, useUserProfile } from "@/contexts/AuthContext";
import { useEventStatus } from "@/hooks/useEventStatus";
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/integrations/supabase/client";
import { resolvePhotoUrl } from "@/lib/photoUtils";
import { ProfilePhoto } from "@/components/ui/ProfilePhoto";
import { trackEvent } from "@/lib/analytics";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";
import { Button } from "@/components/ui/button";
import {
  clearDateEntryTransition,
  isDateEntryTransitionActive,
  markVideoDateEntryPipelineStarted,
} from "@/lib/dateEntryTransitionLatch";
import {
  getVideoDateJourneyEventName,
  type VideoDateJourneyEvent,
} from "@clientShared/matching/videoDateDiagnostics";
import {
  effectiveDateDurationSeconds,
  parseSpendVideoDateCreditExtensionPayload,
  remainingDatePhaseSeconds,
  userMessageForExtensionSpendFailure,
  type VideoDateExtendOutcome,
} from "@clientShared/matching/videoDateExtensionSpend";
import {
  canAttemptDailyRoomFromVideoSessionTruth,
  decideVideoSessionRouteFromTruth,
  videoSessionRowIndicatesHandshakeOrDate,
} from "@clientShared/matching/activeSession";
import {
  VIDEO_DATE_HANDSHAKE_TRUTH_SELECT,
  handshakeTruthLogPayload,
  persistHandshakeDecisionWithVerification,
  type VideoDateHandshakeTruth,
} from "@clientShared/matching/videoDateHandshakePersistence";

const HANDSHAKE_TIME = 60;
const DATE_TIME = 300;

function normalizedDateExtraSeconds(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
}

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

function messageForRetryableStartFailure(failure: VideoCallStartFailure | null): string {
  if (!failure) return "We’re still connecting your video date. Please try again.";
  if (failure.kind === "network") return "Your connection dropped while starting the date. Try again.";
  if (failure.kind === "DAILY_PROVIDER_ERROR") {
    return "The video service is still spinning up. Try again in a moment.";
  }
  if (failure.kind === "daily_join_failed") {
    return "We couldn’t finish joining the video room. Try again.";
  }
  return "We’re still connecting your video date. Please try again.";
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
type CompleteHandshakePayload = {
  state?: "date" | "ended" | "handshake";
  waiting_for_partner?: boolean;
  waiting_for_self?: boolean;
  local_decision_persisted?: boolean;
  partner_decision_persisted?: boolean;
  grace_expires_at?: string;
  seconds_remaining?: number;
  already_ended?: boolean;
  reason?: string | null;
};

function videoDateDebug(message: string, data?: Record<string, unknown>) {
  if (!import.meta.env.DEV) return;
  console.log(`[VideoDate] ${message}`, data ?? {});
}

function videoSessionIndicatesTerminalEnd(
  row: { ended_at?: string | null; state?: string | null; phase?: string | null } | null
): boolean {
  if (!row) return false;
  return Boolean(row.ended_at || row.state === "ended" || row.phase === "ended");
}

const VideoDate = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const { session } = useAuth();
  const { user } = useUserProfile();

  const [phase, setPhase] = useState<CallPhase>("handshake");
  /** Server-owned extension seconds (`video_sessions.date_extra_seconds`) for reconciliation after refetch/rejoin. */
  const [dateExtraSeconds, setDateExtraSeconds] = useState(0);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [videoDateAccess, setVideoDateAccess] = useState<VideoDateAccess>("loading");
  const [deniedEventId, setDeniedEventId] = useState<string | undefined>(undefined);
  const [timingReady, setTimingReady] = useState(false);
  const [handshakeStartFailed, setHandshakeStartFailed] = useState(false);
  const [handshakeFailureCode, setHandshakeFailureCode] = useState<string | undefined>(undefined);
  const [blurAmount, setBlurAmount] = useState(20);
  const [showFeedback, setShowFeedback] = useState(false);
  const [callStarted, setCallStarted] = useState(false);
  const [callStartFailure, setCallStartFailure] = useState<VideoCallStartFailure | null>(null);
  const [showProfileSheet, setShowProfileSheet] = useState(false);
  const [showIceBreaker, setShowIceBreaker] = useState(true);
  const [showMutualToast, setShowMutualToast] = useState(false);
  const [showInCallSafety, setShowInCallSafety] = useState(false);
  const [handshakeGraceExpiresAt, setHandshakeGraceExpiresAt] = useState<string | null>(null);
  const [handshakeGraceSecondsRemaining, setHandshakeGraceSecondsRemaining] = useState<number | null>(null);
  const [handshakeStartedAt, setHandshakeStartedAt] = useState<string | null>(null);
  const [handshakeTruth, setHandshakeTruth] = useState<VideoDateHandshakeTruth | null>(null);
  const [timingRefreshNonce, setTimingRefreshNonce] = useState(0);
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
  const handshakeGraceRetryTriggeredRef = useRef(false);
  const handshakeCompletionInFlightRef = useRef(false);
  const handshakeDecisionInFlightRef = useRef(false);
  const handshakeCompletionDeadlineKeyRef = useRef<string | null>(null);
  const handshakeCompletionRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Canonical Daily room name loaded from video_sessions; used for safe beforeunload cleanup.
  const canonicalRoomNameRef = useRef<string | null>(null);
  const hasEnteredDateFlowRef = useRef(false);
  const surveyOpenedRef = useRef(false);
  const loggedJourneyRef = useRef<Set<string>>(new Set());
  const extensionSpendInFlightRef = useRef(false);
  const videoJoinCycleRef = useRef(0);
  const videoJoinOutcomeByCycleRef = useRef(new Set<number>());

  const clearHandshakeGraceState = useCallback(() => {
    setHandshakeGraceExpiresAt(null);
    setHandshakeGraceSecondsRemaining(null);
    handshakeGraceRetryTriggeredRef.current = false;
  }, []);

  const { credits, refetch: refetchCredits } = useCredits();
  const { setStatus } = useEventStatus({ eventId });

  const markDateFlowEntered = useCallback(() => {
    hasEnteredDateFlowRef.current = true;
  }, []);

  const logJourney = useCallback(
    (event: VideoDateJourneyEvent, payload?: Record<string, unknown>, dedupeKey?: string) => {
      const key = dedupeKey ?? event;
      if (loggedJourneyRef.current.has(key)) return;
      loggedJourneyRef.current.add(key);
      trackEvent(getVideoDateJourneyEventName(event), {
        platform: "web",
        session_id: id,
        event_id: eventId,
        ...(payload ?? {}),
      });
      vdbg(`journey_${event}`, { sessionId: id ?? null, eventId: eventId ?? null, ...(payload ?? {}) });
    },
    [id, eventId]
  );

  const openPostDateSurvey = useCallback(
    (reason: string) => {
      if (surveyOpenedRef.current) return false;
      surveyOpenedRef.current = true;
      clearHandshakeGraceState();
      setPhase("ended");
      setTimeLeft(0);
      setShowFeedback(true);
      setStatus("in_survey");
      vdbg("post_date_survey_opened", { sessionId: id ?? null, reason });
      logJourney("survey_opened", { reason }, `survey_opened_${reason}`);
      if (reason.includes("recovery") || reason === "session_load_terminal") {
        logJourney("survey_recovered", { reason }, `survey_recovered_${reason}`);
      }
      return true;
    },
    [clearHandshakeGraceState, id, setStatus, logJourney]
  );

  const recoverFromNotStartableDateTruth = useCallback(
    async (source: string) => {
      if (!id || !user?.id) return false;
      const [vsRes, regRes] = await Promise.all([
        supabase
          .from("video_sessions")
          .select(
            "event_id, ended_at, ended_reason, state, phase, handshake_started_at, date_started_at, ready_gate_status, ready_gate_expires_at"
          )
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from("event_registrations")
          .select("queue_status, current_room_id")
          .eq("profile_id", user.id)
          .eq("current_room_id", id)
          .maybeSingle(),
      ]);
      const vs = vsRes.data;
      const reg = regRes.data;
      const decision = decideVideoSessionRouteFromTruth(vs);
      const canAttemptDaily = canAttemptDailyRoomFromVideoSessionTruth(vs);
      const reason =
        decision === "navigate_date"
          ? null
          : decision === "ended"
            ? "session_ended"
            : canAttemptDaily
              ? "video_truth_startable_after_refetch"
              : "video_truth_not_startable";
      vdbg("date_route_decision", {
        sessionId: id,
        userId: user.id,
        source,
        decision,
        reason,
        canAttemptDaily,
        queueStatus: reg?.queue_status ?? null,
        currentRoomId: reg?.current_room_id ?? null,
        vsState: vs?.state ?? null,
        vsPhase: vs?.phase ?? null,
        handshakeStartedAt: vs?.handshake_started_at ?? null,
        readyGateStatus: vs?.ready_gate_status ?? null,
        readyGateExpiresAt: vs?.ready_gate_expires_at ?? null,
      });

      if (!canAttemptDaily && decision === "navigate_ready") {
        const target = `/ready/${encodeURIComponent(id)}`;
        clearDateEntryTransition(id);
        logJourney("date_route_bounced", { reason: source, target }, `date_route_bounced_${source}`);
        vdbgRedirect(target, source, { sessionId: id, userId: user.id });
        navigate(target, { replace: true });
        return true;
      }

      const fallbackEventId = vs?.event_id ?? eventId;
      if (!canAttemptDaily && decision === "stay_lobby" && fallbackEventId) {
        const target = `/event/${encodeURIComponent(fallbackEventId)}/lobby`;
        clearDateEntryTransition(id);
        logJourney("date_route_bounced", { reason: source, target }, `date_route_bounced_${source}`);
        vdbgRedirect(target, source, { sessionId: id, userId: user.id, eventId: fallbackEventId });
        navigate(target, { replace: true });
        return true;
      }

      if (decision === "ended") {
        return false;
      }

      return false;
    },
    [eventId, id, logJourney, navigate, user?.id]
  );

  const recoverFromEndedSessionTruth = useCallback(
    async (source: string) => {
      if (!id || !user?.id) return;
      const { data: sessionRow } = await supabase
        .from("video_sessions")
        .select("event_id, ended_at, ended_reason, state, phase, handshake_started_at, date_started_at")
        .eq("id", id)
        .maybeSingle();

      if (!sessionRow) {
        setVideoDateAccess("not_found");
        return;
      }

      const [{ data: reg }, { data: verdict }] = await Promise.all([
        sessionRow.event_id
          ? supabase
              .from("event_registrations")
              .select("queue_status")
              .eq("profile_id", user.id)
              .eq("event_id", sessionRow.event_id)
              .maybeSingle()
          : Promise.resolve({ data: null as { queue_status?: string | null } | null }),
        supabase
          .from("date_feedback")
          .select("id")
          .eq("session_id", id)
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);

      const shouldOpenSurvey =
        hasEnteredDateFlowRef.current ||
        reg?.queue_status === "in_survey" ||
        (
          (sessionRow as { ended_reason?: string | null }).ended_reason === "reconnect_grace_expired" &&
          Boolean(sessionRow.date_started_at) &&
          !verdict
        ) ||
        sessionRow.state === "date" ||
        sessionRow.phase === "date" ||
        Boolean(sessionRow.date_started_at);

      if (shouldOpenSurvey) {
        openPostDateSurvey(source);
        return;
      }

      clearHandshakeGraceState();
      setPhase("ended");
      setTimeLeft(0);
      const target = sessionRow.event_id
        ? `/event/${encodeURIComponent(sessionRow.event_id)}/lobby`
        : "/events";
      clearDateEntryTransition(id);
      vdbgRedirect(target, source, {
        sessionId: id,
        userId: user.id,
        eventId: sessionRow.event_id,
        endedAt: sessionRow.ended_at,
      });
      navigate(target, { replace: true });
    },
    [clearHandshakeGraceState, id, navigate, openPostDateSurvey, user?.id]
  );

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
    remotePlayback,
    retryRemotePlayback,
    dailyReconnectState,
    reconnectGraceTimeLeft,
  } = useVideoCall({
    roomId: id,
    userId: user?.id,
    eventId,
    videoSessionState: phase,
    localDecisionPersisted: Boolean(
      handshakeTruth &&
        user?.id &&
        ((handshakeTruth.participant_1_id === user.id && handshakeTruth.participant_1_decided_at) ||
          (handshakeTruth.participant_2_id === user.id && handshakeTruth.participant_2_decided_at))
    ),
    onCallEnded: () => {
      Sentry.addBreadcrumb({ category: "video-date", message: "Call ended", level: "info" });
    },
    onPartnerJoined: () => {
      Sentry.addBreadcrumb({ category: "video-date", message: "Partner connected", level: "info" });
    },
    onPartnerLeft: () => {
      reconnection.startGraceWindow();
    },
    onPartnerTransientDisconnect: () => {
      toast("Connection interrupted - reconnecting...", { duration: 2500 });
    },
    onPartnerTransientRecover: () => {
      toast("Connection restored", { duration: 1800 });
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

  useEffect(() => {
    videoJoinCycleRef.current = 0;
    videoJoinOutcomeByCycleRef.current = new Set();
    setHandshakeStartedAt(null);
    setCallStartFailure(null);
    handshakeCompletionInFlightRef.current = false;
    handshakeCompletionDeadlineKeyRef.current = null;
    if (handshakeCompletionRetryTimerRef.current) {
      clearTimeout(handshakeCompletionRetryTimerRef.current);
      handshakeCompletionRetryTimerRef.current = null;
    }
  }, [id]);

  /** Breadcrumbs for the next Sentry #310 / render crash: last stable tree checkpoint before failure. */
  useEffect(() => {
    Sentry.addBreadcrumb({
      category: "video_date.render_tree",
      level: "info",
      message: "VideoDate_checkpoint",
      data: {
        sessionId: id ?? null,
        eventId: eventId ?? null,
        videoDateAccess,
        timingReady,
        handshakeStartFailed,
        phase,
        showFeedback,
        isConnected,
        isConnecting,
        dupBlocked,
        callStarted,
        callStartFailure: callStartFailure?.kind ?? null,
        showMutualToast,
        handshakeGraceSecondsRemaining,
        reconnect_partner_disconnected: reconnection.isPartnerDisconnected,
        reconnect_timer_paused: reconnection.isTimerPaused,
      },
    });
  }, [
    id,
    eventId,
    videoDateAccess,
    timingReady,
    handshakeStartFailed,
    phase,
    showFeedback,
    isConnected,
    isConnecting,
    dupBlocked,
    callStarted,
    callStartFailure?.kind,
    showMutualToast,
    handshakeGraceSecondsRemaining,
    reconnection.isPartnerDisconnected,
    reconnection.isTimerPaused,
  ]);

  // After `video_date_transition('end')`, `event_registrations.current_room_id` is cleared while
  // `queue_status` may be `in_survey` — recover survey using `event_id` + `profile_id` (same shape as main session load).
  useEffect(() => {
    if (!id || !user?.id || showFeedback || phase !== "ended") return;
    let cancelled = false;
    void (async () => {
      const { data: sessionRow, error: sessionErr } = await supabase
        .from("video_sessions")
        .select("event_id, ended_reason, date_started_at")
        .eq("id", id)
        .maybeSingle();
      if (cancelled || sessionErr || !sessionRow) return;

      const eventIdForReg = (sessionRow as { event_id?: string | null }).event_id;
      const [{ data: reg }, { data: verdict }] = await Promise.all([
        eventIdForReg
          ? supabase
              .from("event_registrations")
              .select("queue_status")
              .eq("profile_id", user.id)
              .eq("event_id", eventIdForReg)
              .maybeSingle()
          : Promise.resolve({ data: null as { queue_status: string } | null }),
        supabase
          .from("date_feedback")
          .select("id")
          .eq("session_id", id)
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      const reconnectExpiredSurveyDue =
        ((sessionRow as { ended_reason?: string | null } | null)?.ended_reason === "reconnect_grace_expired") &&
        Boolean((sessionRow as { date_started_at?: string | null } | null)?.date_started_at) &&
        !verdict;
      if (reg?.queue_status === "in_survey" || reconnectExpiredSurveyDue) {
        logJourney("date_route_recovered", { source: "ended_phase_hydration_recovery" }, "date_route_recovered");
        logJourney("survey_lost_prevented", {
          source: "ended_phase_hydration_recovery",
          queueStatus: reg?.queue_status ?? null,
          reconnectExpiredSurveyDue,
        });
        openPostDateSurvey("ended_phase_hydration_recovery");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, user?.id, showFeedback, phase, openPostDateSurvey, logJourney]);

  useLayoutEffect(() => {
    if (!id) return;
    markVideoDateEntryPipelineStarted(id);
    videoDateDebug("date-entry latch marked", { sessionId: id, userId: user?.id ?? null });
  }, [id, user?.id]);

  useEffect(() => {
    vdbg("date_mount", { sessionId: id ?? null, userId: user?.id ?? null });
    logJourney("date_route_entered", { source: "mount" }, "date_route_entered");
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
  }, [id, user?.id, logJourney]);

  useEffect(() => {
    setDateExtraSeconds(0);
  }, [id]);

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
      setCallStartFailure(null);
      setCallStarted(false);

      try {
        const { data: sessionRow, error: sessionErr } = await supabase
          .from("video_sessions")
          .select("participant_1_id, participant_2_id, event_id, daily_room_name, ended_at, ended_reason, state, phase, handshake_started_at, date_started_at, ready_gate_status, ready_gate_expires_at, participant_1_joined_at, participant_2_joined_at, participant_1_liked, participant_2_liked, participant_1_decided_at, participant_2_decided_at, handshake_grace_expires_at")
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
        setHandshakeTruth({ id, ...(sessionRow as VideoDateHandshakeTruth) });

        const isP1 = sessionRow.participant_1_id === user.id;
        const isParticipant = isP1 || sessionRow.participant_2_id === user.id;
        const sessionIsDateCapable = videoSessionRowIndicatesHandshakeOrDate(sessionRow);
        const canAttemptDaily = canAttemptDailyRoomFromVideoSessionTruth(sessionRow);
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

        const { data: reg } = await supabase
          .from("event_registrations")
          .select("queue_status")
          .eq("event_id", sessionRow.event_id)
          .eq("profile_id", user.id)
          .maybeSingle();

        if (cancelled) return;

        if (videoSessionIndicatesTerminalEnd(sessionRow)) {
          const { data: verdict } = await supabase
            .from("date_feedback")
            .select("id")
            .eq("session_id", id)
            .eq("user_id", user.id)
            .maybeSingle();
          if (cancelled) return;
          const shouldOpenSurvey =
            hasEnteredDateFlowRef.current ||
            reg?.queue_status === "in_survey" ||
            (
              (sessionRow as { ended_reason?: string | null }).ended_reason === "reconnect_grace_expired" &&
              Boolean(sessionRow.date_started_at) &&
              !verdict
            ) ||
            sessionRow.state === "date" ||
            sessionRow.phase === "date" ||
            Boolean(sessionRow.date_started_at);
          if (shouldOpenSurvey) {
            openPostDateSurvey("session_load_terminal");
          } else {
            clearDateEntryTransition(id);
            toast.info("This date has already ended.", { duration: 2800 });
            const target = sessionRow.event_id
              ? `/event/${encodeURIComponent(sessionRow.event_id)}/lobby`
              : "/home";
            videoDateDebug("date_refresh_routing", {
              outcome: "redirect_lobby",
              reason: "session_ended",
              sessionId: id,
              queueStatus: reg?.queue_status ?? null,
              sessionTruth: {
                state: sessionRow.state ?? null,
                phase: sessionRow.phase ?? null,
                handshake_started_at: sessionRow.handshake_started_at ?? null,
                date_started_at: sessionRow.date_started_at ?? null,
                ended_at: sessionRow.ended_at ?? null,
              },
              target,
            });
            vdbgRedirect(target, "session_ended", {
              sessionId: id,
              userId: user.id,
              eventId: sessionRow.event_id,
              endedAt: sessionRow.ended_at,
            });
            logJourney("date_route_bounced", {
              reason: "session_ended",
              target,
            });
            navigate(target, { replace: true });
          }
          return;
        }

        if (reg?.queue_status === "in_ready_gate" && sessionIsDateCapable) {
          vdbg("date_guard_ready_gate_stale_registration_ignored", {
            sessionId: id,
            userId: user.id,
            eventId: sessionRow.event_id,
            queueStatus: reg.queue_status,
            state: sessionRow.state,
            phase: sessionRow.phase,
            handshakeStarted: Boolean(sessionRow.handshake_started_at),
            latchActive: isDateEntryTransitionActive(id),
            readyGateStatus: (sessionRow as { ready_gate_status?: string | null }).ready_gate_status ?? null,
            readyGateExpiresAt:
              (sessionRow as { ready_gate_expires_at?: string | number | null }).ready_gate_expires_at ?? null,
          });
        } else if (reg?.queue_status === "in_ready_gate") {
          const rgStatus = (sessionRow as { ready_gate_status?: string | null }).ready_gate_status ?? null;
          const rgExpiresRaw =
            (sessionRow as { ready_gate_expires_at?: string | number | null }).ready_gate_expires_at ?? null;
          const readyGateBranch = canAttemptDaily
            ? "daily_startable_staying"
            : rgStatus === "both_ready"
              ? "both_ready_not_startable_redirecting"
              : "no_both_ready_redirecting";
          vdbg("date_guard_ready_gate_branch", {
            sessionId: id,
            userId: user.id,
            eventId: sessionRow.event_id,
            branch: readyGateBranch,
            truthDecision: canAttemptDaily ? "navigate_date" : "stay_lobby",
            canAttemptDaily,
            routeOverride: isDateEntryTransitionActive(id) ? "date_entry_latch" : null,
            finalRoute: canAttemptDaily || isDateEntryTransitionActive(id) ? "date" : "lobby",
            readyGateStatus: rgStatus,
            readyGateExpiresAt: rgExpiresRaw,
            latchActive: isDateEntryTransitionActive(id),
            state: sessionRow.state,
            phase: sessionRow.phase,
            handshakeStarted: Boolean(sessionRow.handshake_started_at),
          });
          const allowEntry = canAttemptDaily || isDateEntryTransitionActive(id);
          if (!allowEntry) {
            videoDateDebug("bouncing ready_gate session back to lobby", {
              sessionId: id,
              eventId: sessionRow.event_id,
              queueStatus: reg.queue_status,
              state: sessionRow.state,
              phase: sessionRow.phase,
            });
            videoDateDebug("date_refresh_routing", {
              outcome: "redirect_lobby",
              reason: "in_ready_gate_without_date_entry_latch_or_handshake",
              sessionId: id,
              queueStatus: reg.queue_status,
              sessionTruth: {
                state: sessionRow.state ?? null,
                phase: sessionRow.phase ?? null,
                handshake_started_at: sessionRow.handshake_started_at ?? null,
                date_started_at: sessionRow.date_started_at ?? null,
                ready_gate_status: (sessionRow as { ready_gate_status?: string | null }).ready_gate_status ?? null,
              },
              latchActive: isDateEntryTransitionActive(id),
              target: `/event/${encodeURIComponent(sessionRow.event_id)}/lobby`,
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
            logJourney("date_route_bounced", {
              reason: "in_ready_gate_without_date_entry_latch_or_handshake",
              target,
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
          vdbg("date_guard_registration_status", {
            sessionId: id,
            userId: user.id,
            eventId: sessionRow.event_id,
            queueStatus: reg.queue_status,
            state: sessionRow.state,
            phase: sessionRow.phase,
            handshakeStarted: Boolean(sessionRow.handshake_started_at),
            latchActive: isDateEntryTransitionActive(id),
          });
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
          videoDateDebug("date_refresh_routing", {
            outcome: "stayed_on_date_route",
            reason: "guard_passed",
            sessionId: id,
            queueStatus: reg?.queue_status ?? null,
            sessionTruth: {
              state: sessionRow.state ?? null,
              phase: sessionRow.phase ?? null,
              handshake_started_at: sessionRow.handshake_started_at ?? null,
              date_started_at: sessionRow.date_started_at ?? null,
            },
            latchActive: isDateEntryTransitionActive(id),
          });
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
  }, [id, user?.id, navigate, openPostDateSurvey]);

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
        .select(
          "handshake_started_at, handshake_grace_expires_at, date_started_at, date_extra_seconds, phase, state, ended_at",
        )
        .eq("id", id)
        .maybeSingle();

      if (cancelled) return;

      if (error || !data) {
        vdbg("date_timing_fetch_failed", {
          sessionId: id,
          error: error ? { code: error.code, message: error.message } : null,
          hasData: Boolean(data),
        });
        setHandshakeStartedAt(null);
        setHandshakeStartFailed(true);
        setHandshakeFailureCode(undefined);
        setTimeLeft(null);
        setTimingReady(true);
        return;
      }

      const now = Date.now();
      const extraNorm = normalizedDateExtraSeconds(
        (data as { date_extra_seconds?: unknown }).date_extra_seconds,
      );
      setDateExtraSeconds(extraNorm);

      if (data.ended_at || (data.state as string) === "ended" || data.phase === "ended") {
        vdbg("date_timing_guard_ended", { sessionId: id, row: data });
        setHandshakeStartedAt(null);
        if (hasEnteredDateFlowRef.current) {
          openPostDateSurvey("timing_terminal");
        } else {
          clearHandshakeGraceState();
          setPhase("ended");
          setTimeLeft(0);
        }
        setTimingReady(true);
        return;
      }

      if ((data.state as string) === "date" || data.phase === "date" || Boolean(data.date_started_at)) {
        vdbg("date_timing_existing_date", { sessionId: id, row: data });
        markDateFlowEntered();
        setHandshakeStartedAt(null);
        const dateStartedAt = typeof data.date_started_at === "string" ? data.date_started_at : null;
        setTimeLeft(
          remainingDatePhaseSeconds({
            dateStartedAtIso: dateStartedAt,
            baseDateSeconds: DATE_TIME,
            dateExtraSeconds: extraNorm,
            nowMs: now,
          }),
        );
        setPhase("date");
        setTimingReady(true);
        return;
      }

      if (data.handshake_started_at) {
        vdbg("date_timing_existing_handshake", { sessionId: id, row: data });
        setHandshakeStartedAt(data.handshake_started_at);
        const elapsed = (now - new Date(data.handshake_started_at).getTime()) / 1000;
        const handshakeRemaining = Math.max(0, Math.ceil(HANDSHAKE_TIME - elapsed));
        setTimeLeft(handshakeRemaining);
        // Refresh/reconnect resilience: rebuild grace countdown from canonical server expiry.
        const graceExpiresAtRaw =
          (data as { handshake_grace_expires_at?: string | null }).handshake_grace_expires_at ?? null;
        if (handshakeRemaining <= 0 && graceExpiresAtRaw) {
          const graceRemaining = Math.max(0, Math.ceil((new Date(graceExpiresAtRaw).getTime() - Date.now()) / 1000));
          if (graceRemaining > 0) {
            setHandshakeGraceExpiresAt(graceExpiresAtRaw);
            setHandshakeGraceSecondsRemaining(graceRemaining);
          } else {
            clearHandshakeGraceState();
          }
        } else {
          clearHandshakeGraceState();
        }
        setTimingReady(true);
        return;
      }

      vdbg("date_timing_prejoin_pending", {
        sessionId: id,
        reason: "use_video_call_owns_enter_handshake",
        row: data,
      });
      setHandshakeStartFailed(false);
      clearHandshakeGraceState();
      setTimeLeft(null);
      setTimingReady(true);
    };

    void fetchTiming();

    return () => {
      cancelled = true;
    };
  }, [id, videoDateAccess, clearHandshakeGraceState, markDateFlowEntered, openPostDateSurvey, timingRefreshNonce]);

  // Start Daily only when timing/handshake bootstrap succeeded (or session already in progress).
  useEffect(() => {
    if (!id) return;
    if (videoDateAccess !== "allowed" || !timingReady || handshakeStartFailed) return;
    if (phase === "ended") return;
    if (dupBlocked) return;
    if (callStarted) return;
    if (callStartFailure) return;

    setCallStarted(true);
    videoJoinCycleRef.current += 1;
    const joinCycle = videoJoinCycleRef.current;
    trackEvent(LobbyPostDateEvents.VIDEO_DATE_JOIN_ATTEMPT, {
      platform: "web",
      session_id: id,
      event_id: eventId,
      is_retry: joinCycle > 1,
    });
    Sentry.addBreadcrumb({ category: "video-date", message: "Joined video date", level: "info" });
    startCall(id).then((result) => {
      const name = getRoomName();
      if (name) canonicalRoomNameRef.current = name;
      if (!videoJoinOutcomeByCycleRef.current.has(joinCycle)) {
        videoJoinOutcomeByCycleRef.current.add(joinCycle);
        trackEvent(
          result.ok ? LobbyPostDateEvents.VIDEO_DATE_JOIN_SUCCESS : LobbyPostDateEvents.VIDEO_DATE_JOIN_FAILURE,
          result.ok
            ? {
                platform: "web",
                session_id: id,
                event_id: eventId,
              }
            : {
                platform: "web",
                session_id: id,
                event_id: eventId,
                reason: "daily_join_failed",
              }
        );
      }
      if (result.ok === true) {
        markDateFlowEntered();
        setTimingRefreshNonce((n) => n + 1);
        clearDateEntryTransition(id);
        vdbg("date_entry_latch_cleared", {
          sessionId: id,
          userId: user?.id ?? null,
          eventId: eventId ?? null,
          reason: "daily_join_success",
          roomName: name ?? null,
        });
        return;
      }

      const failure = result.failure;
      setCallStarted(false);
      if (failure.retryable) {
        setCallStartFailure(failure);
        return;
      }

      if (failure.kind === "READY_GATE_NOT_READY") {
        void (async () => {
          const redirected = await recoverFromNotStartableDateTruth("create_date_room_not_ready");
          if (!redirected) {
            setHandshakeStartFailed(true);
            setHandshakeFailureCode("READY_GATE_NOT_READY");
          }
        })();
        return;
      }

      if (failure.kind === "SESSION_ENDED") {
        void recoverFromEndedSessionTruth("create_date_room_session_ended");
        return;
      }

      if (failure.kind === "ACCESS_DENIED") {
        clearDateEntryTransition(id);
        toast.error("This date link is no longer valid.");
        const target = eventId
          ? `/event/${encodeURIComponent(eventId)}/lobby`
          : "/events";
        vdbgRedirect(target, "create_date_room_access_denied", {
          sessionId: id,
          userId: user?.id ?? null,
          eventId: eventId ?? null,
        });
        navigate(target, { replace: true });
        return;
      }

      if (failure.kind === "SESSION_NOT_FOUND" || failure.kind === "ROOM_NOT_FOUND") {
        setVideoDateAccess("not_found");
        return;
      }

      if (failure.kind === "auth") {
        toast.error("Please sign in again, then try once more.");
      }
      setHandshakeStartFailed(true);
      setHandshakeFailureCode(undefined);
    });
  }, [
    callStartFailure,
    id,
    videoDateAccess,
    timingReady,
    handshakeStartFailed,
    phase,
    callStarted,
    startCall,
    getRoomName,
    dupBlocked,
    eventId,
    user?.id,
    markDateFlowEntered,
    navigate,
    recoverFromEndedSessionTruth,
    recoverFromNotStartableDateTruth,
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
          setHandshakeTruth({ id, ...(row as VideoDateHandshakeTruth) });
          const newState = row.state || row.phase;

          if (row.ended_at || newState === "ended") {
            setHandshakeStartedAt(null);
            if (hasEnteredDateFlowRef.current) {
              openPostDateSurvey("realtime_terminal");
            } else {
              clearHandshakeGraceState();
              setPhase("ended");
              setTimeLeft(0);
            }
            return;
          }

          if (newState === "date" || Boolean(row.date_started_at)) {
            markDateFlowEntered();
            clearHandshakeGraceState();
            setHandshakeStartedAt(null);
            const extraNorm = normalizedDateExtraSeconds(row.date_extra_seconds);
            setDateExtraSeconds(extraNorm);
            const dateStartedAt = typeof row.date_started_at === "string" ? row.date_started_at : null;
            setTimeLeft(
              remainingDatePhaseSeconds({
                dateStartedAtIso: dateStartedAt,
                baseDateSeconds: DATE_TIME,
                dateExtraSeconds: extraNorm,
              }),
            );
            setPhase("date");
            return;
          }

          if (row.handshake_started_at) {
            setHandshakeStartedAt(row.handshake_started_at);
            const elapsed = (Date.now() - new Date(row.handshake_started_at).getTime()) / 1000;
            const handshakeRemaining = Math.ceil(Math.max(0, HANDSHAKE_TIME - elapsed));
            setTimeLeft(handshakeRemaining);
            const graceExpiresAtRaw =
              typeof row.handshake_grace_expires_at === "string" ? row.handshake_grace_expires_at : null;
            if (handshakeRemaining <= 0 && graceExpiresAtRaw) {
              const graceRemaining = Math.max(0, Math.ceil((new Date(graceExpiresAtRaw).getTime() - Date.now()) / 1000));
              if (graceRemaining > 0) {
                setHandshakeGraceExpiresAt(graceExpiresAtRaw);
                setHandshakeGraceSecondsRemaining(graceRemaining);
              } else {
                clearHandshakeGraceState();
              }
            } else {
              clearHandshakeGraceState();
            }
            setPhase("handshake");
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, videoDateAccess, clearHandshakeGraceState, markDateFlowEntered, openPostDateSurvey]);

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
    if (
      timeLeft === null ||
      timeLeft <= 0 ||
      showFeedback ||
      !isConnected ||
      phase === "ended" ||
      reconnection.isTimerPaused ||
      // Pause base handshake timer while grace mode owns the countdown.
      (phase === "handshake" && handshakeGraceSecondsRemaining !== null)
    )
      return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev === null || prev <= 1) {
          if (phaseRef.current === "handshake") {
            vdbg("handshake_visible_countdown_elapsed", {
              sessionId: id ?? null,
              trigger: "display_only",
            });
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
  }, [
    timeLeft !== null,
    timeLeft,
    showFeedback,
    id,
    isConnected,
    phase,
    reconnection.isTimerPaused,
    handshakeGraceSecondsRemaining,
  ]);

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

      // Provider room cleanup is owned by video-date-room-cleanup after the session is terminal.
      // Do not delete here: the DB intentionally preserves daily_room_name until cleanup succeeds.
      const canonicalRoom = canonicalRoomNameRef.current;
      if (token && canonicalRoom) {
        vdbg("daily_room_delete_skipped", {
          action: "delete_room",
          caller: "VideoDate.beforeunload",
          reason: "backend_cleanup_owns_video_date_rooms",
          sessionId: id,
          userId: user.id,
          eventId: eventId ?? null,
          roomName: canonicalRoom,
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

  // Record user's explicit handshake decision.
  const handleHandshakeDecision = useCallback(async (action: "vibe" | "pass"): Promise<boolean> => {
    if (!id || !user?.id) return false;
    if (handshakeDecisionInFlightRef.current) return false;
    handshakeDecisionInFlightRef.current = true;
    try {
      const result = await persistHandshakeDecisionWithVerification({
        sessionId: id,
        actorUserId: user.id,
        action,
        rpc: async (args) => {
          vdbg("video_date_transition_before", {
            action,
            sessionId: id,
            actorUserId: user.id,
            currentPhase: phaseRef.current,
            args,
          });
          const { data, error } = await supabase.rpc("video_date_transition", args);
          return {
            data: data ?? null,
            error: error ? { code: error.code, message: error.message, name: error.name } : null,
          };
        },
        fetchTruth: async () => {
          const { data, error } = await supabase
            .from("video_sessions")
            .select(VIDEO_DATE_HANDSHAKE_TRUTH_SELECT)
            .eq("id", id)
            .maybeSingle();
          return {
            truth: (data as VideoDateHandshakeTruth | null) ?? null,
            error: error ? { code: error.code, message: error.message, name: error.name } : null,
          };
        },
        log: (event, payload) => {
          vdbg(event, {
            ...payload,
            currentPhase: phaseRef.current,
          });
          if (event === "handshake_decision_rpc_after") {
            vdbg("video_date_transition_after", {
              action: "vibe",
              sessionId: id,
              actorUserId: user.id,
              currentPhase: phaseRef.current,
              ok: payload.ok,
              payload: payload.rpcPayload ?? null,
              error: payload.error ?? null,
              participant_1_liked: payload.participant_1_liked ?? null,
              participant_2_liked: payload.participant_2_liked ?? null,
              participant_1_decided_at: payload.participant_1_decided_at ?? null,
              participant_2_decided_at: payload.participant_2_decided_at ?? null,
              actorDecisionPersisted: payload.actorDecisionPersisted,
            });
          }
        },
      });

      if (!("reason" in result)) {
        setHandshakeTruth(result.truth);
        vdbg("handshake_decision_ui_result", {
          sessionId: id,
          actorUserId: user.id,
          action,
          ok: true,
          attempts: result.attempts,
          reason: null,
          actorDecisionPersisted: result.actorDecisionPersisted,
          participant_1_liked: result.truth.participant_1_liked ?? null,
          participant_2_liked: result.truth.participant_2_liked ?? null,
          participant_1_decided_at: result.truth.participant_1_decided_at ?? null,
          participant_2_decided_at: result.truth.participant_2_decided_at ?? null,
          completeHandshakeTriggeredAfterPersistence: false,
          completeHandshakeTriggerReason: "decision_rpc_owns_transition",
        });
        return true;
      }
      setHandshakeTruth(result.truth);
      vdbg("handshake_decision_ui_result", {
        sessionId: id,
        actorUserId: user.id,
        action,
        ok: false,
        attempts: result.attempts,
        reason: result.reason,
        actorDecisionPersisted: result.actorDecisionPersisted,
        participant_1_liked: result.truth?.participant_1_liked ?? null,
        participant_2_liked: result.truth?.participant_2_liked ?? null,
        participant_1_decided_at: result.truth?.participant_1_decided_at ?? null,
        participant_2_decided_at: result.truth?.participant_2_decided_at ?? null,
        completeHandshakeTriggeredAfterPersistence: false,
        completeHandshakeTriggerReason: "decision_not_persisted",
      });
      toast.error(result.userMessage);
      return false;
    } finally {
      handshakeDecisionInFlightRef.current = false;
    }
  }, [id, user?.id]);

  const handleUserVibe = useCallback(() => handleHandshakeDecision("vibe"), [handleHandshakeDecision]);
  const handleUserPass = useCallback(() => handleHandshakeDecision("pass"), [handleHandshakeDecision]);

  const localHandshakeDecision = useMemo<boolean | null>(() => {
    if (!handshakeTruth || !user?.id) return null;
    if (handshakeTruth.participant_1_id === user.id) {
      return handshakeTruth.participant_1_decided_at ? handshakeTruth.participant_1_liked ?? null : null;
    }
    if (handshakeTruth.participant_2_id === user.id) {
      return handshakeTruth.participant_2_decided_at ? handshakeTruth.participant_2_liked ?? null : null;
    }
    return null;
  }, [
    handshakeTruth?.participant_1_decided_at,
    handshakeTruth?.participant_1_id,
    handshakeTruth?.participant_1_liked,
    handshakeTruth?.participant_2_decided_at,
    handshakeTruth?.participant_2_id,
    handshakeTruth?.participant_2_liked,
    user?.id,
  ]);

  // Check mutual vibe at the backend-owned handshake deadline.
  const checkMutualVibe = useCallback(async (source = "handshake_server_deadline", allowRetry = true) => {
    if (!id) return;
    if (phaseRef.current !== "handshake") return;
    if (handshakeCompletionInFlightRef.current) {
      vdbg("complete_handshake_skip", {
        sessionId: id,
        source,
        reason: "in_flight",
      });
      return;
    }
    if (handshakeDecisionInFlightRef.current) {
      vdbg("complete_handshake_skip", {
        sessionId: id,
        source,
        reason: "local_decision_persistence_in_flight",
        retryScheduled: allowRetry,
      });
      setTimingRefreshNonce((n) => n + 1);
      if (allowRetry && phaseRef.current === "handshake") {
        if (handshakeCompletionRetryTimerRef.current) {
          clearTimeout(handshakeCompletionRetryTimerRef.current);
        }
        handshakeCompletionRetryTimerRef.current = setTimeout(() => {
          handshakeCompletionRetryTimerRef.current = null;
          void checkMutualVibe(`${source}_after_decision_persistence`, false);
        }, 900);
      }
      return;
    }

    const scheduleRetry = (reason: string) => {
      vdbg("complete_handshake_uncertain", {
        sessionId: id,
        source,
        reason,
        retryScheduled: allowRetry,
      });
      setTimingRefreshNonce((n) => n + 1);
      if (!allowRetry || phaseRef.current !== "handshake") return;
      if (handshakeCompletionRetryTimerRef.current) {
        clearTimeout(handshakeCompletionRetryTimerRef.current);
      }
      handshakeCompletionRetryTimerRef.current = setTimeout(() => {
        handshakeCompletionRetryTimerRef.current = null;
        void checkMutualVibe(`${source}_retry`, false);
      }, 1500);
    };

    handshakeCompletionInFlightRef.current = true;
    const args = {
      p_session_id: id,
      p_action: "complete_handshake",
    };
    try {
      const { data: truthBefore } = await supabase
        .from("video_sessions")
        .select(VIDEO_DATE_HANDSHAKE_TRUTH_SELECT)
        .eq("id", id)
        .maybeSingle();
      vdbg("complete_handshake_truth_before", {
        action: "complete_handshake",
        sessionId: id,
        source,
        ...handshakeTruthLogPayload((truthBefore as VideoDateHandshakeTruth | null) ?? null),
      });
      vdbg("video_date_transition_before", { action: "complete_handshake", source, args });
      const { data: result, error } = await supabase.rpc("video_date_transition", args);
      if (phaseRef.current !== "handshake") return;
      const { data: truthAfter } = await supabase
        .from("video_sessions")
        .select(VIDEO_DATE_HANDSHAKE_TRUTH_SELECT)
        .eq("id", id)
        .maybeSingle();
      setHandshakeTruth((truthAfter as VideoDateHandshakeTruth | null) ?? null);
      vdbg("video_date_transition_after", {
        action: "complete_handshake",
        source,
        ok: !error,
        payload: result ?? null,
        error: error ? { code: error.code, message: error.message } : null,
      });
      vdbg("complete_handshake_truth_after", {
        action: "complete_handshake",
        sessionId: id,
        source,
        ok: !error,
        rpcPayload: result ?? null,
        ...handshakeTruthLogPayload((truthAfter as VideoDateHandshakeTruth | null) ?? null),
      });

      if (error || !result) {
        scheduleRetry(error ? "rpc_error" : "null_result");
        return;
      }

      const payload = result as CompleteHandshakePayload | null;
      if (payload?.state === "date") {
        clearHandshakeGraceState();
        setShowMutualToast(true);
      } else if (payload?.waiting_for_partner === true) {
        const graceExpiresAt =
          typeof payload?.grace_expires_at === "string" ? payload.grace_expires_at : null;
        const serverSeconds =
          typeof payload?.seconds_remaining === "number" && Number.isFinite(payload.seconds_remaining)
            ? Math.max(0, Math.ceil(payload.seconds_remaining))
            : null;
        const derivedSeconds =
          graceExpiresAt !== null
            ? Math.max(0, Math.ceil((new Date(graceExpiresAt).getTime() - Date.now()) / 1000))
            : null;

        setHandshakeGraceExpiresAt(graceExpiresAt);
        setHandshakeGraceSecondsRemaining(derivedSeconds ?? serverSeconds ?? 0);
        return;
      } else {
        clearHandshakeGraceState();
        if (payload?.reason === "handshake_grace_expired") {
          const message = payload.waiting_for_self
            ? "You didn't choose Vibe or Pass in time."
            : payload.waiting_for_partner
              ? "Your match didn't choose in time."
              : "The handshake timed out before both choices were saved.";
          toast.error(message, { duration: 3000 });
        } else {
          toast("Great meeting you! 👋", { duration: 2500 });
        }
        await endCall("complete_handshake_not_mutual");
        handleCallEnd();
      }
    } catch (err) {
      console.error("Error checking mutual vibe:", err);
      vdbg("video_date_transition_after", {
        action: "complete_handshake",
        source,
        ok: false,
        error: err instanceof Error ? { name: err.name, message: err.message } : String(err),
      });
      scheduleRetry("exception");
    } finally {
      handshakeCompletionInFlightRef.current = false;
    }
  }, [id, endCall, clearHandshakeGraceState]);

  useEffect(() => {
    if (
      !id ||
      phase !== "handshake" ||
      showFeedback ||
      handshakeGraceSecondsRemaining !== null ||
      !handshakeStartedAt
    ) {
      return;
    }

    const startedMs = new Date(handshakeStartedAt).getTime();
    if (!Number.isFinite(startedMs)) return;

    const deadlineKey = `${id}:${handshakeStartedAt}`;
    const delayMs = Math.max(0, startedMs + HANDSHAKE_TIME * 1000 - Date.now());
    const fire = () => {
      if (handshakeCompletionDeadlineKeyRef.current === deadlineKey) return;
      handshakeCompletionDeadlineKeyRef.current = deadlineKey;
      void checkMutualVibe("handshake_server_deadline");
    };

    const timer = setTimeout(fire, delayMs);
    return () => clearTimeout(timer);
  }, [
    checkMutualVibe,
    handshakeGraceSecondsRemaining,
    handshakeStartedAt,
    id,
    phase,
    showFeedback,
  ]);

  // Handshake grace countdown. One forced complete_handshake retry at expiry.
  useEffect(() => {
    if (
      !id ||
      phase !== "handshake" ||
      showFeedback ||
      handshakeGraceSecondsRemaining === null ||
      handshakeGraceRetryTriggeredRef.current
    ) {
      return;
    }

    const interval = setInterval(() => {
      const derivedFromExpiry = handshakeGraceExpiresAt
        ? Math.max(0, Math.ceil((new Date(handshakeGraceExpiresAt).getTime() - Date.now()) / 1000))
        : null;
      const nextValue =
        derivedFromExpiry !== null
          ? derivedFromExpiry
          : Math.max(0, (handshakeGraceSecondsRemaining ?? 0) - 1);

      setHandshakeGraceSecondsRemaining(nextValue);

      if (nextValue <= 0 && !handshakeGraceRetryTriggeredRef.current) {
        if (phaseRef.current !== "handshake") {
          clearHandshakeGraceState();
          return;
        }
        // One-shot guard prevents repeated force-retries in grace expiry race windows.
        handshakeGraceRetryTriggeredRef.current = true;
        void checkMutualVibe("handshake_grace_expiry");
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [
    id,
    phase,
    showFeedback,
    handshakeGraceExpiresAt,
    handshakeGraceSecondsRemaining,
    checkMutualVibe,
    clearHandshakeGraceState,
  ]);

  const handleMutualToastComplete = useCallback(async () => {
    clearHandshakeGraceState();
    markDateFlowEntered();
    setShowMutualToast(false);
    setPhase("date");
    setTimeLeft(effectiveDateDurationSeconds(DATE_TIME, dateExtraSeconds));
    trackEvent('video_date_extended', { session_id: id });
    setShowIceBreaker(true);
    setTimeout(() => setShowIceBreaker(false), 30000);

    // Server already transitioned to date via video_date_transition; no client-owned writes needed here.
  }, [id, clearHandshakeGraceState, markDateFlowEntered, dateExtraSeconds]);

  const handleExtend = useCallback(
    async (minutes: number, type: "extra_time" | "extended_vibe"): Promise<VideoDateExtendOutcome> => {
      if (extensionSpendInFlightRef.current) {
        return { ok: false, userMessage: "", silent: true };
      }
      if (!id) {
        return { ok: false, userMessage: userMessageForExtensionSpendFailure("session_not_found") };
      }
      extensionSpendInFlightRef.current = true;
      try {
        const { data, error } = await supabase.rpc("spend_video_date_credit_extension", {
          p_session_id: id,
          p_credit_type: type,
        });
        if (error) {
          captureSupabaseError("spend_video_date_credit_extension", error);
          void refetchCredits();
          return { ok: false, userMessage: userMessageForExtensionSpendFailure("rpc_transport") };
        }
        const parsed = parseSpendVideoDateCreditExtensionPayload(data);
        if (parsed.success === false) {
          void refetchCredits();
          return { ok: false, userMessage: userMessageForExtensionSpendFailure(parsed.error) };
        }
        if (parsed.dateExtraSeconds !== undefined) {
          setDateExtraSeconds(Math.max(0, Math.floor(parsed.dateExtraSeconds)));
        }
        Sentry.addBreadcrumb({ category: "credits", message: `Used ${type} credit, +${minutes} min`, level: "info" });
        setTimeLeft((prev) => (prev ?? 0) + minutes * 60);
        void refetchCredits();
        return { ok: true, minutesAdded: minutes };
      } finally {
        extensionSpendInFlightRef.current = false;
      }
    },
    [id, refetchCredits]
  );

  // End call: server-owned `video_date_transition(end, …)` + survey/navigation UX (no direct session row writes here).
  const handleCallEnd = useCallback(async () => {
    const hasDateEntryTruth = hasEnteredDateFlowRef.current || phase === "date";
    const analyticsBudgetSeconds =
      phase === "handshake"
        ? HANDSHAKE_TIME
        : HANDSHAKE_TIME + effectiveDateDurationSeconds(DATE_TIME, dateExtraSeconds);
    trackEvent('video_date_ended', {
      session_id: id,
      duration_seconds: analyticsBudgetSeconds - (timeLeft ?? 0),
      phase,
    });
    if (hasDateEntryTruth) {
      markDateFlowEntered();
      openPostDateSurvey("local_end");
    } else {
      clearHandshakeGraceState();
      setPhase("ended");
      setTimeLeft(0);
      setShowFeedback(false);
      setStatus("offline");
    }

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
  }, [id, phase, timeLeft, dateExtraSeconds, openPostDateSurvey, markDateFlowEntered, clearHandshakeGraceState, setStatus]);

  const handleLeave = useCallback(async () => {
    clearHandshakeGraceState();
    await endCall("user_leave_button");
    toast("You left the date — stay safe! 💚", { duration: 2000 });
    handleCallEnd();
  }, [endCall, handleCallEnd, clearHandshakeGraceState]);

  useEffect(() => {
    if (phase === "date" || phase === "ended") {
      clearHandshakeGraceState();
    }
  }, [phase, clearHandshakeGraceState]);

  useEffect(() => {
    return () => {
      clearHandshakeGraceState();
    };
  }, [clearHandshakeGraceState]);

  /** After in-call "End & report" succeeds (report RPC already sent). */
  const handleEndAfterInCallReport = useCallback(async () => {
    await endCall("end_after_in_call_report");
    await handleCallEnd();
  }, [endCall, handleCallEnd]);

  const dupLeaseNavigateRef = useRef(false);
  useEffect(() => {
    if (!dupBlocked || !callStarted) return;
    if (dupLeaseNavigateRef.current) return;
    dupLeaseNavigateRef.current = true;
    void (async () => {
      toast.info("This date continued in another tab — closing here.", { duration: 3500 });
      await endCall("duplicate_tab_lease_blocked");
      setCallStarted(false);
      const target = eventId ? `/event/${encodeURIComponent(eventId)}/lobby` : "/events";
      vdbgRedirect(target, "duplicate_tab_lease_blocked", { sessionId: id ?? null, eventId: eventId ?? null });
      navigate(target);
    })();
  }, [dupBlocked, callStarted, endCall, navigate, eventId]);

  const totalTime =
    phase === "handshake" ? HANDSHAKE_TIME : effectiveDateDurationSeconds(DATE_TIME, dateExtraSeconds);
  const isUrgent = phase === "date" && (timeLeft ?? 999) <= 10;
  const transportReconnectVisible =
    dailyReconnectState === "interrupted" ||
    dailyReconnectState === "partner_reconnecting" ||
    dailyReconnectState === "failed_after_grace";
  const anyReconnectVisible = transportReconnectVisible || reconnection.isPartnerDisconnected;

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
        <p className="text-sm text-muted-foreground">Loading your date...</p>
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

  if (callStartFailure?.retryable) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center gap-4">
        <User className="w-14 h-14 text-muted-foreground" />
        <h1 className="text-xl font-display font-semibold">Still connecting your date</h1>
        <p className="text-muted-foreground text-sm max-w-sm">
          {messageForRetryableStartFailure(callStartFailure)}
        </p>
        <div className="flex flex-col sm:flex-row gap-2 w-full max-w-xs">
          <Button
            type="button"
            className="w-full"
            onClick={() => {
              setCallStartFailure(null);
              setCallStarted(false);
            }}
          >
            Try again
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={() => {
              const target = eventId
                ? `/event/${encodeURIComponent(eventId)}/lobby`
                : "/events";
              clearDateEntryTransition(id);
              vdbgRedirect(target, "retryable_call_start_back", {
                sessionId: id ?? null,
                eventId: eventId ?? null,
                code: callStartFailure.kind,
              });
              navigate(target, { replace: true });
            }}
          >
            Back
          </Button>
        </div>
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
          {isConnected && phase === "handshake" && handshakeGraceSecondsRemaining !== null && (
            <motion.div
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              className="px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30"
            >
              <span className="text-[10px] font-medium text-amber-500">
                Waiting for your partner... {handshakeGraceSecondsRemaining}s
              </span>
            </motion.div>
          )}
        </div>

        {/* Keep the Vibe — credits extension (date phase only) */}
        {isConnected && phase === "date" && !showFeedback && (
          <KeepTheVibe
            extraTimeCredits={credits.extraTime}
            extendedVibeCredits={credits.extendedVibe}
            onExtend={handleExtend}
            analyticsSessionId={id}
            analyticsEventId={eventId}
          />
        )}
      </motion.div>

      {/* ─── Remote Video with Progressive Blur ─── */}
      <div className="flex-1 relative bg-black" ref={remoteContainerRef}>
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="w-full h-full object-contain"
          style={{
            filter: `blur(${blurAmount}px)`,
            transition: "filter 10s linear",
          }}
        />

        {/* Connection overlay */}
        <AnimatePresence>
          {(isConnecting || !isConnected || remotePlayback.playRejected) &&
            !showFeedback &&
            !anyReconnectVisible && (
              <ConnectionOverlay
                isConnecting={isConnecting}
                remotePlayback={remotePlayback}
                onRetryRemotePlayback={retryRemotePlayback}
                onLeave={handleLeave}
              />
            )}
        </AnimatePresence>

        {/* Reconnection overlay */}
        <ReconnectionOverlay
          isVisible={anyReconnectVisible}
          partnerName={partner.name}
          graceTimeLeft={transportReconnectVisible ? reconnectGraceTimeLeft : reconnection.graceTimeLeft}
          mode={transportReconnectVisible ? "network_interrupted" : "partner_away"}
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
            <VibeCheckButton
              timeLeft={timeLeft}
              decision={localHandshakeDecision}
              onVibe={handleUserVibe}
              onPass={handleUserPass}
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
