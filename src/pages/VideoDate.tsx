import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Clock, Sparkles, User } from "lucide-react";
import * as Sentry from "@sentry/react";
import { vdbg, vdbgRedirect } from "@/lib/vdbg";
import { captureSupabaseError } from "@/lib/errorTracking";

import { HandshakeTimer } from "@/components/video-date/HandshakeTimer";
import { IceBreakerCard } from "@/components/video-date/IceBreakerCard";
import { VideoDateControls } from "@/components/video-date/VideoDateControls";
import { SelfViewPIP } from "@/components/video-date/SelfViewPIP";
import { ConnectionOverlay } from "@/components/video-date/ConnectionOverlay";
import { PartnerProfileSheet } from "@/components/video-date/PartnerProfileSheet";
import { AudioOutputPicker } from "@/components/video-date/AudioOutputPicker";
import {
  applyStoredAudioOutputPreference,
  isAudioDeviceEnumerationSupported,
  isSetSinkIdSupported,
} from "@/lib/videoDateAudioOutput";
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
import { useUserProfile } from "@/contexts/AuthContext";
import { useEventStatus } from "@/hooks/useEventStatus";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabase } from "@/integrations/supabase/client";
import { resolvePhotoUrl } from "@/lib/photoUtils";
import { ProfilePhoto } from "@/components/ui/ProfilePhoto";
import { trackEvent } from "@/lib/analytics";
import { recordUserAction } from "@/lib/browserDiagnostics";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  clearDateEntryTransition,
  isDateEntryTransitionActive,
  markVideoDateEntryPipelineStarted,
} from "@/lib/dateEntryTransitionLatch";
import { suppressDateNavigationAfterManualExit } from "@/lib/dateNavigationGuard";
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
  remainingStartedAtCountdownSeconds,
  resolveVideoDatePhaseCountdown,
} from "@clientShared/matching/videoDateCountdown";
import { sendVideoDateSignalWithRetry } from "@clientShared/matching/videoDateSignalRetry";
import {
  canAttemptDailyRoomFromVideoSessionTruth,
  decideVideoSessionRouteFromTruth,
  videoSessionHasEncounterExposureTruth,
  videoSessionHasPostDateSurveyTruth,
  videoSessionRowIndicatesHandshakeOrDate,
} from "@clientShared/matching/activeSession";
import {
  VIDEO_DATE_HANDSHAKE_TRUTH_SELECT,
  handshakeDecisionFailureIndicatesSessionEnded,
  handshakeTruthLogPayload,
  persistHandshakeDecisionWithVerification,
  type VideoDateHandshakeTruth,
} from "@clientShared/matching/videoDateHandshakePersistence";
import {
  getVideoDateWarmupChoiceNotice,
  type VideoDateWarmupChoiceNotice,
} from "@clientShared/matching/videoDateWarmupChoiceNotice";
import {
  buildReadyGateToDateLatencyPayload,
  buildVideoDateTimerDriftRecoveredPayload,
  recordReadyGateToDateLatencyCheckpoint,
} from "@clientShared/observability/videoDateOperatorMetrics";
import {
  VIDEO_DATE_REMOTE_OBJECT_FIT,
  VIDEO_DATE_REMOTE_OBJECT_POSITION,
  videoDateAspectRatio,
} from "@clientShared/matching/videoDateMediaContract";

const HANDSHAKE_TIME = 60;
const DATE_TIME = 300;
const WEB_LIFECYCLE_AWAY_GRACE_MS = 12_000;
const VIDEO_DATE_ACCESS_LOADING_WATCHDOG_MS = 8_000;
const VIDEO_DATE_MANUAL_EXIT_CLEANUP_TIMEOUT_MS = 2_500;
const TERMINAL_SURVEY_RECONCILE_INTERVAL_MS = 2_500;
const REMOTE_DATE_VIDEO_CONTAINER_CLASS = "flex-1 relative bg-black";
// Product invariant: remote date video preserves the full encoded camera frame.
// Do not switch this to cover/scale/transform; use a separate decorative layer for cinematic crops.
const REMOTE_DATE_VIDEO_CLASS = "w-full h-full object-contain object-center";

type VideoDateEndReason = "ended_from_client" | "partial_join_peer_timeout";
type VideoDateManualExitStepStatus = "completed" | "failed" | "timed_out";

type WebLifecycleLeaveSource = "beforeunload" | "pagehide" | "visibilitychange" | "freeze";

function normalizedDateExtraSeconds(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
}

function makeExtensionIdempotencyKey(sessionId: string, type: "extra_time" | "extended_vibe"): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${sessionId}:${type}:${random}`;
}

function serializeManualExitError(error: unknown): Record<string, unknown> | string {
  return error instanceof Error ? { name: error.name, message: error.message } : String(error);
}

function showWarmupChoiceNoticeToast(notice: VideoDateWarmupChoiceNotice) {
  toast.custom(
    () => (
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto w-[min(calc(100vw-2rem),28rem)] overflow-hidden rounded-2xl border border-white/10 bg-[linear-gradient(180deg,hsl(var(--card)/0.94),hsl(var(--background)/0.9))] text-foreground shadow-[0_20px_65px_-36px_rgba(0,0,0,0.95),0_0_34px_-24px_hsl(var(--primary)/0.9)] backdrop-blur-2xl"
      >
        <div className="flex items-start gap-3 px-4 py-3.5">
          <span className="mt-0.5 h-10 w-1 shrink-0 rounded-full bg-gradient-to-b from-primary via-accent to-neon-cyan" />
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/15 text-neon-cyan shadow-[0_0_20px_-8px_hsl(var(--primary)/0.9)]">
            <Clock className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-display font-semibold leading-snug text-foreground">
              {notice.title}
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
              {notice.message}
            </span>
          </span>
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      </div>
    ),
    {
      duration: 5200,
      position: "top-center",
      unstyled: true,
    },
  );
}

function runVideoDateManualExitStep(
  step: string,
  operation: () => Promise<unknown>,
  timeoutMs = VIDEO_DATE_MANUAL_EXIT_CLEANUP_TIMEOUT_MS,
): Promise<{ status: VideoDateManualExitStepStatus; error?: unknown }> {
  return new Promise((resolve) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      vdbg("video_date_manual_exit_step", {
        step,
        status: "timed_out",
        timeoutMs,
      });
      resolve({ status: "timed_out" });
    }, timeoutMs);

    void operation().then(
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        vdbg("video_date_manual_exit_step", { step, status: "completed", timeoutMs });
        resolve({ status: "completed" });
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        vdbg("video_date_manual_exit_step", {
          step,
          status: "failed",
          timeoutMs,
          error: serializeManualExitError(error),
        });
        resolve({ status: "failed", error });
      },
    );
  });
}

type VideoDateAccess = "loading" | "allowed" | "denied" | "not_found";

function messageForHandshakeFailure(code?: string): string {
  if (code === "READY_GATE_NOT_READY") {
    return "Almost there — finish the Ready Gate with your match first.";
  }
  if (code === "BLOCKED_PAIR") {
    return "This call is no longer available.";
  }
  if (code === "SESSION_ENDED") {
    return "This date has already ended.";
  }
  if (code === "EVENT_NOT_ACTIVE") {
    return "This date link is no longer available.";
  }
  if (code === "DAILY_AUTH_FAILED" || code === "DAILY_CREDENTIALS_INVALID") {
    return "Video provider authentication failed. Please try again later.";
  }
  if (code === "DAILY_REQUEST_REJECTED") {
    return "Could not prepare this video room. Go back and try again.";
  }
  return "Could not start your video date. Go back and try again.";
}

function messageForRetryableStartFailure(failure: VideoCallStartFailure | null): string {
  if (!failure) return "We’re still connecting your video date. Please try again.";
  if (failure.kind === "network") return "Your connection dropped while starting the date. Try again.";
  if (failure.kind === "DAILY_PROVIDER_ERROR") {
    return "The video service is still spinning up. Try again in a moment.";
  }
  if (failure.kind === "DAILY_PROVIDER_UNAVAILABLE" || failure.kind === "DAILY_RATE_LIMIT") {
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
  survey_required?: boolean;
};

type TerminalSurveySessionRow = {
  participant_1_id?: string | null;
  participant_2_id?: string | null;
  event_id?: string | null;
  daily_room_name?: string | null;
  daily_room_url?: string | null;
  ended_at?: string | null;
  ended_reason?: string | null;
  state?: string | null;
  phase?: string | null;
  handshake_started_at?: string | null;
  date_started_at?: string | null;
  ready_gate_status?: string | null;
  ready_gate_expires_at?: string | number | null;
  participant_1_joined_at?: string | null;
  participant_2_joined_at?: string | null;
};

const TERMINAL_SURVEY_SESSION_SELECT =
  "participant_1_id, participant_2_id, event_id, daily_room_name, daily_room_url, ended_at, ended_reason, state, phase, handshake_started_at, date_started_at, ready_gate_status, ready_gate_expires_at, participant_1_joined_at, participant_2_joined_at";

function videoDateDebug(message: string, data?: Record<string, unknown>) {
  if (!import.meta.env.DEV) return;
  console.log(`[VideoDate] ${message}`, data ?? {});
}

function summarizeWebVideoDateRuntime() {
  if (typeof navigator === "undefined") {
    return {
      browser_family: "unknown",
      is_ios: false,
      is_mobile_safari: false,
      is_safari: false,
    };
  }
  const ua = navigator.userAgent ?? "";
  const vendor = navigator.vendor ?? "";
  const isIOS = /\b(iPhone|iPad|iPod)\b/i.test(ua);
  const isSafari = /Safari/i.test(ua) && !/(Chrome|Chromium|CriOS|FxiOS|Edg|OPR)/i.test(ua);
  const browserFamily = /CriOS|Chrome|Chromium/i.test(ua)
    ? "chrome"
    : /FxiOS|Firefox/i.test(ua)
      ? "firefox"
      : /Edg/i.test(ua)
        ? "edge"
        : isSafari || /Apple/i.test(vendor)
          ? "safari"
          : "unknown";
  return {
    browser_family: browserFamily,
    is_ios: isIOS,
    is_mobile_safari: isIOS && isSafari,
    is_safari: isSafari,
  };
}

function videoSessionIndicatesTerminalEnd(
  row: { ended_at?: string | null; state?: string | null; phase?: string | null } | null
): boolean {
  if (!row) return false;
  return Boolean(row.ended_at || row.state === "ended" || row.phase === "ended");
}

function shouldOpenPostDateSurveyForTerminalSession(
  row: {
    ended_at?: string | null;
    ended_reason?: string | null;
    date_started_at?: string | null;
    participant_1_joined_at?: string | null;
    participant_2_joined_at?: string | null;
    state?: string | null;
    phase?: string | null;
  } | null,
  verdict: unknown,
): boolean {
  return videoSessionHasPostDateSurveyTruth(row) && !verdict;
}

const VideoDate = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const { user } = useUserProfile();

  const [phase, setPhase] = useState<CallPhase>("handshake");
  /** Server-owned extension seconds (`video_sessions.date_extra_seconds`) for reconciliation after refetch/rejoin. */
  const [dateExtraSeconds, setDateExtraSeconds] = useState(0);
  const [dateStartedAt, setDateStartedAt] = useState<string | null>(null);
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
  const [showAudioOutputPicker, setShowAudioOutputPicker] = useState(false);
  const [showIceBreaker, setShowIceBreaker] = useState(true);
  const [showMutualToast, setShowMutualToast] = useState(false);
  const [showInCallSafety, setShowInCallSafety] = useState(false);
  const [showEndDateConfirm, setShowEndDateConfirm] = useState(false);
  const [isEndDateConfirming, setIsEndDateConfirming] = useState(false);
  const [isLeavingVideoDate, setIsLeavingVideoDate] = useState(false);
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
  const remoteBackdropVideoRef = useRef<HTMLVideoElement>(null);
  const phaseRef = useRef<CallPhase>("handshake");
  const timeLeftRef = useRef<number | null>(null);
  const countdownCompletionKeyRef = useRef<string | null>(null);
  const remoteReadableTrackedRef = useRef(false);
  const warmupTimerStartedTrackedRef = useRef<string | null>(null);
  const timerDriftTrackingReadyRef = useRef(false);
  const sessionIdRef = useRef(id);
  const eventIdRef = useRef<string | undefined>(undefined);
  const handshakeCompletionInFlightRef = useRef(false);
  const handshakeDecisionInFlightRef = useRef(false);
  const handshakeCompletionDeadlineKeyRef = useRef<string | null>(null);
  const handshakeCompletionRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkMutualVibeRef = useRef<((source?: string, allowRetry?: boolean) => void) | null>(null);
  // Canonical Daily room name loaded from video_sessions; used for safe beforeunload cleanup.
  const canonicalRoomNameRef = useRef<string | null>(null);
  const hasEnteredDateFlowRef = useRef(false);
  const surveyOpenedRef = useRef(false);
  const loggedJourneyRef = useRef<Set<string>>(new Set());
  const extensionSpendInFlightRef = useRef(false);
  const extensionSpendRetryRef = useRef<{
    type: "extra_time" | "extended_vibe";
    key: string;
  } | null>(null);
  const explicitEndRequestedRef = useRef<"idle" | "sending" | "acked">("idle");
  const leaveSignalTokenRef = useRef<string | null>(null);
  const leaveSignalSentRef = useRef(false);
  const lifecycleHiddenStartedAtRef = useRef<number | null>(null);
  const foregroundReconcileInFlightRef = useRef(false);
  const lastForegroundReconcileAtRef = useRef(0);
  const accessLoadingWatchdogKeyRef = useRef<string | null>(null);
  const videoJoinCycleRef = useRef(0);
  const videoJoinOutcomeByCycleRef = useRef(new Set<number>());
  const lastRemoteLayoutDiagnosticKeyRef = useRef<string | null>(null);
  const manualExitInFlightRef = useRef(false);
  /** Set after `handleCallEnd` is defined — avoids TDZ when `handleHandshakeDecision` closes over end UX. */
  const handleCallEndRef = useRef<(() => Promise<void>) | null>(null);

  const clearHandshakeGraceState = useCallback(() => {}, []);

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
      setVideoDateAccess("allowed");
      setTimingReady(true);
      setCallStarted(false);
      setCallStartFailure(null);
      setShowFeedback(true);
      setStatus("in_survey");
      vdbg("post_date_survey_opened", { sessionId: id ?? null, reason });
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_SURVEY_OPENED, {
        platform: "web",
        session_id: id,
        event_id: eventId,
        reason,
        source_surface: "video_date_route",
        source_action: reason,
      });
      logJourney("survey_opened", { reason }, `survey_opened_${reason}`);
      if (reason.includes("recovery") || reason === "session_load_terminal") {
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_SURVEY_RECOVERED, {
          platform: "web",
          session_id: id,
          event_id: eventId,
          source_surface: "video_date_route",
          source_action: reason,
          outcome: "recovered",
          reason_code: reason,
        });
        logJourney("survey_recovered", { reason }, `survey_recovered_${reason}`);
      }
      return true;
    },
    [clearHandshakeGraceState, id, eventId, setStatus, logJourney]
  );

  const hydrateTerminalSurveyContext = useCallback(
    (
      sessionRow: {
        participant_1_id?: string | null;
        participant_2_id?: string | null;
        event_id?: string | null;
        daily_room_name?: string | null;
      },
      source: string,
    ) => {
      const isP1 = sessionRow.participant_1_id === user?.id;
      const resolvedPartnerId = isP1 ? sessionRow.participant_2_id : sessionRow.participant_1_id;
      if (sessionRow.daily_room_name) {
        canonicalRoomNameRef.current = sessionRow.daily_room_name;
      }
      setIsParticipant1(isP1);
      setEventId(sessionRow.event_id ?? undefined);
      setPartnerId(resolvedPartnerId ?? "");
      setVideoDateAccess("allowed");
      setTimingReady(true);
      setCallStarted(false);
      setCallStartFailure(null);
      vdbg("terminal_survey_context_hydrated", {
        sessionId: id ?? null,
        userId: user?.id ?? null,
        source,
        eventId: sessionRow.event_id ?? null,
        partnerId: resolvedPartnerId ?? null,
        isParticipant1: isP1,
      });
    },
    [id, user?.id],
  );

  const recoverTerminalPostDateSurvey = useCallback(
    async (source: string, sessionOverride?: TerminalSurveySessionRow | null) => {
      if (!id || !user?.id) return false;
      const sessionRow =
        sessionOverride ??
        (
          await supabase
            .from("video_sessions")
            .select(TERMINAL_SURVEY_SESSION_SELECT)
            .eq("id", id)
            .maybeSingle()
        ).data;

      if (!sessionRow) {
        setVideoDateAccess("not_found");
        return true;
      }

      if (!videoSessionIndicatesTerminalEnd(sessionRow)) {
        return false;
      }

      const { data: verdict } = await supabase
        .from("date_feedback")
        .select("id")
        .eq("session_id", id)
        .eq("user_id", user.id)
        .maybeSingle();

      const shouldOpenSurvey = shouldOpenPostDateSurveyForTerminalSession(sessionRow, verdict);
      vdbg("terminal_post_date_survey_recovery_checked", {
        sessionId: id,
        userId: user.id,
        source,
        shouldOpenSurvey,
        verdictId: verdict?.id ?? null,
        endedAt: sessionRow.ended_at ?? null,
        endedReason: sessionRow.ended_reason ?? null,
        state: sessionRow.state ?? null,
        phase: sessionRow.phase ?? null,
        participant1Joined: Boolean(sessionRow.participant_1_joined_at),
        participant2Joined: Boolean(sessionRow.participant_2_joined_at),
      });

      if (shouldOpenSurvey) {
        hydrateTerminalSurveyContext(sessionRow, source);
        openPostDateSurvey(source);
        return true;
      }

      clearHandshakeGraceState();
      setPhase("ended");
      setTimeLeft(0);
      setShowFeedback(false);
      const target = sessionRow.event_id
        ? `/event/${encodeURIComponent(sessionRow.event_id)}/lobby`
        : "/events";
      clearDateEntryTransition(id);
      vdbgRedirect(target, source, {
        sessionId: id,
        userId: user.id,
        eventId: sessionRow.event_id ?? null,
        endedAt: sessionRow.ended_at ?? null,
        endedReason: sessionRow.ended_reason ?? null,
      });
      navigate(target, { replace: true });
      return true;
    },
    [
      clearHandshakeGraceState,
      hydrateTerminalSurveyContext,
      id,
      navigate,
      openPostDateSurvey,
      user?.id,
    ],
  );

  const recoverFromNotStartableDateTruth = useCallback(
    async (source: string) => {
      if (!id || !user?.id) return false;
      const [vsRes, regRes] = await Promise.all([
        supabase
          .from("video_sessions")
          .select(
            "event_id, ended_at, ended_reason, state, phase, handshake_started_at, date_started_at, ready_gate_status, ready_gate_expires_at, daily_room_name, daily_room_url"
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
        return recoverTerminalPostDateSurvey(`${source}_ended_truth`);
      }

      return false;
    },
    [eventId, id, logJourney, navigate, recoverTerminalPostDateSurvey, user?.id]
  );

  const recoverFromEndedSessionTruth = recoverTerminalPostDateSurvey;

  const {
    isConnecting,
    isConnected,
    isMuted,
    isVideoOff,
    mediaPermissionError,
    localVideoRef,
    remoteVideoRef,
    localStream,
    canFlipCamera,
    isFlippingCamera,
    startCall,
    endCall,
    toggleMute,
    toggleVideo,
    flipCamera,
    getRoomName,
    networkTier,
    remotePlayback,
    peerMissing,
    retryRemotePlayback,
    clearPeerMissing,
    clearMediaPermissionError,
    dailyReconnectState,
    reconnectGraceTimeLeft,
    captureProfile,
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
      toast("Connection softened. Reconnecting...", { duration: 2500 });
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

  const syncRemoteBackdropVideo = useCallback(
    (source: string) => {
      const backdropEl = remoteBackdropVideoRef.current;
      const remoteEl = remoteVideoRef.current;
      if (!backdropEl) return;
      const nextStream = remoteEl?.srcObject ?? null;
      if (backdropEl.srcObject !== nextStream) {
        backdropEl.srcObject = nextStream;
        vdbg("remote_date_backdrop_video_synced", {
          sessionId: id ?? null,
          eventId: eventId ?? null,
          source,
          hasStream: Boolean(nextStream),
        });
      }
      if (nextStream && backdropEl.paused) {
        const playPromise = backdropEl.play();
        if (playPromise && typeof playPromise.catch === "function") {
          void playPromise.catch(() => undefined);
        }
      }
    },
    [eventId, id, remoteVideoRef],
  );

  useEffect(() => {
    if (!isConnected || showFeedback) {
      if (remoteBackdropVideoRef.current?.srcObject) {
        remoteBackdropVideoRef.current.srcObject = null;
      }
      return;
    }
    syncRemoteBackdropVideo("connected_effect");
    const intervalId = window.setInterval(() => syncRemoteBackdropVideo("connected_interval"), 1_000);
    return () => window.clearInterval(intervalId);
  }, [isConnected, showFeedback, syncRemoteBackdropVideo]);

  const logRemoteVideoLayout = useCallback(
    (source: "loadedmetadata" | "playing" | "resize") => {
      syncRemoteBackdropVideo(source);
      const videoEl = remoteVideoRef.current;
      const containerEl = remoteContainerRef.current;
      if (!videoEl || !containerEl) return;

      const videoRect = videoEl.getBoundingClientRect();
      const containerRect = containerEl.getBoundingClientRect();
      const computed = window.getComputedStyle(videoEl);
      const stream = videoEl.srcObject instanceof MediaStream ? videoEl.srcObject : null;
      const videoTrack = stream?.getVideoTracks()[0] ?? null;
      const trackSettings =
        videoTrack && typeof videoTrack.getSettings === "function" ? videoTrack.getSettings() : null;
      const diagnosticKey = [
        source,
        phase,
        videoEl.videoWidth,
        videoEl.videoHeight,
        Math.round(videoRect.width),
        Math.round(videoRect.height),
        Math.round(containerRect.width),
        Math.round(containerRect.height),
        trackSettings?.width ?? "na",
        trackSettings?.height ?? "na",
      ].join(":");

      if (lastRemoteLayoutDiagnosticKeyRef.current === diagnosticKey) return;
      lastRemoteLayoutDiagnosticKeyRef.current = diagnosticKey;

      const diagnosticPayload = {
        platform: "web",
        session_id: id ?? null,
        event_id: eventId ?? null,
        source_surface: "video_date_route",
        source_action: source,
        diagnostic_scope: "receiver_layout",
        phase,
        capture_profile: captureProfile,
        video_intrinsic_width: videoEl.videoWidth,
        video_intrinsic_height: videoEl.videoHeight,
        video_intrinsic_aspect_ratio: videoDateAspectRatio(videoEl.videoWidth, videoEl.videoHeight),
        rendered_rect_width: Math.round(videoRect.width),
        rendered_rect_height: Math.round(videoRect.height),
        rendered_rect_aspect_ratio: videoDateAspectRatio(videoRect.width, videoRect.height),
        container_rect_width: Math.round(containerRect.width),
        container_rect_height: Math.round(containerRect.height),
        container_rect_aspect_ratio: videoDateAspectRatio(containerRect.width, containerRect.height),
        receiver_object_fit: computed.objectFit,
        receiver_object_position: computed.objectPosition,
        receiver_transform: computed.transform,
        track_width: trackSettings?.width ?? null,
        track_height: trackSettings?.height ?? null,
        track_aspect_ratio: videoDateAspectRatio(trackSettings?.width, trackSettings?.height),
        track_frame_rate: trackSettings?.frameRate ?? null,
        track_facing_mode: trackSettings?.facingMode ?? null,
        video_track_id: videoTrack?.id ?? null,
        ...summarizeWebVideoDateRuntime(),
      };

      vdbg("remote_date_video_layout", {
        source,
        sessionId: id ?? null,
        eventId: eventId ?? null,
        phase,
        captureProfile,
        videoIntrinsic: {
          width: videoEl.videoWidth,
          height: videoEl.videoHeight,
          aspectRatio: videoDateAspectRatio(videoEl.videoWidth, videoEl.videoHeight),
        },
        renderedRect: {
          width: Math.round(videoRect.width),
          height: Math.round(videoRect.height),
          aspectRatio: videoDateAspectRatio(videoRect.width, videoRect.height),
        },
        containerRect: {
          width: Math.round(containerRect.width),
          height: Math.round(containerRect.height),
          aspectRatio: videoDateAspectRatio(containerRect.width, containerRect.height),
        },
        css: {
          objectFit: computed.objectFit,
          objectPosition: computed.objectPosition,
          transform: computed.transform,
        },
        trackSettings,
        trackAspectRatio: videoDateAspectRatio(trackSettings?.width, trackSettings?.height),
        videoTrackId: videoTrack?.id ?? null,
        browser: summarizeWebVideoDateRuntime(),
      });
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_RECEIVER_LAYOUT_DIAGNOSTIC, diagnosticPayload);
    },
    [captureProfile, eventId, id, phase, remoteVideoRef, syncRemoteBackdropVideo]
  );

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    timeLeftRef.current = timeLeft;
  }, [timeLeft]);

  useEffect(() => {
    eventIdRef.current = eventId;
  }, [eventId]);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (mounted) leaveSignalTokenRef.current = data.session?.access_token ?? null;
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      leaveSignalTokenRef.current = session?.access_token ?? null;
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (phase !== "date") {
      timerDriftTrackingReadyRef.current = false;
      return;
    }
    if (timeLeft !== null) {
      timerDriftTrackingReadyRef.current = true;
    }
  }, [phase, timeLeft]);

  const trackTimerDriftRecovery = useCallback(
    (correctedTimeLeftSeconds: number, recoverySource: "session_reload" | "realtime" | "foreground_reconcile") => {
      if (!timerDriftTrackingReadyRef.current) return;
      const payload = buildVideoDateTimerDriftRecoveredPayload({
        platform: "web",
        sessionId: id,
        eventId: eventIdRef.current,
        previousTimeLeftSeconds: timeLeftRef.current,
        correctedTimeLeftSeconds,
        recoverySource,
        phase: phaseRef.current,
      });
      if (!payload) return;

      trackEvent(LobbyPostDateEvents.VIDEO_DATE_TIMER_DRIFT_DETECTED, {
        ...payload,
        outcome: "no_op",
        reason_code: "client_server_timer_mismatch",
      });
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_TIMER_DRIFT_RECOVERED, payload);
      vdbg("timer_drift_recovered_by_server_truth", {
        sessionId: id ?? null,
        eventId: eventIdRef.current ?? null,
        driftMs: payload.drift_ms,
        driftBucket: payload.drift_bucket,
        recoverySource,
      });
    },
    [id],
  );

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
    reconnection.isPartnerDisconnected,
    reconnection.isTimerPaused,
  ]);

  // After `video_date_transition('end')`, `event_registrations.current_room_id` is cleared while
  // `queue_status` may be `in_survey` — recover survey using `event_id` + `profile_id` (same shape as main session load).
  useEffect(() => {
    if (!id || !user?.id || showFeedback || phase !== "ended") return;
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      const recovered = await recoverTerminalPostDateSurvey("ended_phase_hydration_recovery");
      if (cancelled || !recovered) return;
      if (surveyOpenedRef.current) {
        logJourney("date_route_recovered", { source: "ended_phase_hydration_recovery" }, "date_route_recovered");
        logJourney("survey_lost_prevented", { source: "ended_phase_hydration_recovery" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, user?.id, showFeedback, phase, recoverTerminalPostDateSurvey, logJourney]);

  useLayoutEffect(() => {
    if (!id) return;
    markVideoDateEntryPipelineStarted(id);
    videoDateDebug("date-entry latch marked", { sessionId: id, userId: user?.id ?? null });
  }, [id, user?.id]);

  useEffect(() => {
    vdbg("date_mount", { sessionId: id ?? null, userId: user?.id ?? null });
    if (id) {
      const latencyContext = recordReadyGateToDateLatencyCheckpoint({
        sessionId: id,
        platform: "web",
        eventId: eventId ?? null,
        sourceSurface: "video_date_route",
        checkpoint: "date_route_entered",
      });
      trackEvent(
        LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
        buildReadyGateToDateLatencyPayload({
          context: latencyContext,
          checkpoint: "date_route_entered",
          sourceAction: "route_mount",
          outcome: "success",
        }),
      );
      const shellContext = recordReadyGateToDateLatencyCheckpoint({
        sessionId: id,
        platform: "web",
        eventId: eventId ?? null,
        sourceSurface: "video_date_route",
        checkpoint: "video_stage_shell_visible",
      });
      trackEvent(
        LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
        buildReadyGateToDateLatencyPayload({
          context: shellContext,
          checkpoint: "video_stage_shell_visible",
          sourceAction: "route_mount",
          outcome: "success",
        }),
      );
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_VIDEO_STAGE_SHELL_VISIBLE, {
        platform: "web",
        session_id: id,
        event_id: eventId ?? null,
        source_surface: "video_date_route",
        source_action: "route_mount",
      });
    }
    trackEvent(LobbyPostDateEvents.VIDEO_DATE_ROUTE_ENTERED, {
      platform: "web",
      session_id: id,
      event_id: eventId,
      source_surface: "video_date_route",
      source_action: "route_mount",
    });
    logJourney("date_route_entered", { source: "mount" }, "date_route_entered");
    if (!id || !user?.id) return;
    if (!import.meta.env.DEV) return;
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
  }, [eventId, id, user?.id, logJourney]);

  useEffect(() => {
    if (!id || !user?.id || videoDateAccess !== "loading") return;
    const startedAt = Date.now();
    const key = `${id}:${user.id}`;
    const timeoutId = setTimeout(() => {
      if (accessLoadingWatchdogKeyRef.current === key) return;
      accessLoadingWatchdogKeyRef.current = key;
      const elapsedMs = Date.now() - startedAt;
      const payload = {
        platform: "web",
        session_id: id,
        event_id: eventId ?? null,
        source_surface: "video_date_route",
        source_action: "access_loading_watchdog",
        reason_code: "access_loading_slow",
        elapsed_ms: elapsedMs,
      };
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_ROUTE_GUARD_SLOW, payload);
      Sentry.captureMessage("video_date_route_guard_slow", {
        level: "warning",
        extra: {
          ...payload,
          videoDateAccess,
          timingReady,
          handshakeStartFailed,
          callStarted,
          isConnecting,
          isConnected,
          phase,
        },
      });
      vdbg("date_guard_loading_watchdog", {
        sessionId: id,
        eventId: eventId ?? null,
        elapsedMs,
        videoDateAccess,
        timingReady,
        handshakeStartFailed,
        callStarted,
        isConnecting,
        isConnected,
        phase,
      });
    }, VIDEO_DATE_ACCESS_LOADING_WATCHDOG_MS);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [
    callStarted,
    eventId,
    handshakeStartFailed,
    id,
    isConnected,
    isConnecting,
    phase,
    timingReady,
    user?.id,
    videoDateAccess,
  ]);

  useEffect(() => {
    setDateExtraSeconds(0);
    setDateStartedAt(null);
    setHandshakeStartedAt(null);
    setTimeLeft(null);
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
          .select("participant_1_id, participant_2_id, event_id, daily_room_name, daily_room_url, ended_at, ended_reason, state, phase, handshake_started_at, date_started_at, ready_gate_status, ready_gate_expires_at, participant_1_joined_at, participant_2_joined_at, participant_1_liked, participant_2_liked, participant_1_decided_at, participant_2_decided_at, handshake_grace_expires_at")
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

        if (videoSessionIndicatesTerminalEnd(sessionRow)) {
          await recoverTerminalPostDateSurvey("session_load_terminal", sessionRow);
          return;
        }

        let registrationQueueStatus: string | null = null;
        const logRegistrationStatus = (queueStatus: string | null | undefined) => {
          if (!queueStatus) return;
          if (queueStatus === "in_ready_gate" && sessionIsDateCapable) {
            vdbg("date_guard_ready_gate_stale_registration_ignored", {
              sessionId: id,
              userId: user.id,
              eventId: sessionRow.event_id,
              queueStatus,
              state: sessionRow.state,
              phase: sessionRow.phase,
              handshakeStarted: Boolean(sessionRow.handshake_started_at),
              latchActive: isDateEntryTransitionActive(id),
              readyGateStatus: (sessionRow as { ready_gate_status?: string | null }).ready_gate_status ?? null,
              readyGateExpiresAt:
                (sessionRow as { ready_gate_expires_at?: string | number | null }).ready_gate_expires_at ?? null,
            });
            return;
          }
          vdbg("date_guard_registration_status", {
            sessionId: id,
            userId: user.id,
            eventId: sessionRow.event_id,
            queueStatus,
            state: sessionRow.state,
            phase: sessionRow.phase,
            handshakeStarted: Boolean(sessionRow.handshake_started_at),
            latchActive: isDateEntryTransitionActive(id),
          });
        };

        if (canAttemptDaily) {
          void (async () => {
            try {
              const { data: reg } = await supabase
                .from("event_registrations")
                .select("queue_status")
                .eq("event_id", sessionRow.event_id)
                .eq("profile_id", user.id)
                .maybeSingle();
              if (cancelled) return;
              logRegistrationStatus(reg?.queue_status ?? null);
            } catch (error: unknown) {
              if (cancelled) return;
              vdbg("date_guard_registration_status_failed", {
                sessionId: id,
                userId: user.id,
                eventId: sessionRow.event_id,
                state: sessionRow.state,
                phase: sessionRow.phase,
                error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
              });
            }
          })();
        } else {
          const { data: reg } = await supabase
            .from("event_registrations")
            .select("queue_status")
            .eq("event_id", sessionRow.event_id)
            .eq("profile_id", user.id)
            .maybeSingle();

          if (cancelled) return;
          registrationQueueStatus = reg?.queue_status ?? null;

          if (registrationQueueStatus === "in_ready_gate") {
            const rgStatus = (sessionRow as { ready_gate_status?: string | null }).ready_gate_status ?? null;
            const rgExpiresRaw =
              (sessionRow as { ready_gate_expires_at?: string | number | null }).ready_gate_expires_at ?? null;
            const readyGateBranch = rgStatus === "both_ready"
              ? "both_ready_not_provider_prepared_redirecting"
              : "no_both_ready_redirecting";
            vdbg("date_guard_ready_gate_branch", {
              sessionId: id,
              userId: user.id,
              eventId: sessionRow.event_id,
              branch: readyGateBranch,
              truthDecision: "stay_lobby",
              canAttemptDaily,
              routeOverride: null,
              finalRoute: "lobby",
              readyGateStatus: rgStatus,
              readyGateExpiresAt: rgExpiresRaw,
              latchActive: isDateEntryTransitionActive(id),
              state: sessionRow.state,
              phase: sessionRow.phase,
              handshakeStarted: Boolean(sessionRow.handshake_started_at),
            });
            clearDateEntryTransition(id);
            videoDateDebug("bouncing ready_gate session back to lobby", {
              sessionId: id,
              eventId: sessionRow.event_id,
              queueStatus: registrationQueueStatus,
              state: sessionRow.state,
              phase: sessionRow.phase,
            });
            videoDateDebug("date_refresh_routing", {
              outcome: "redirect_lobby",
              reason: "in_ready_gate_without_provider_prepared_truth",
              sessionId: id,
              queueStatus: registrationQueueStatus,
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
            vdbgRedirect(target, "in_ready_gate_without_provider_prepared_truth", {
              sessionId: id,
              userId: user.id,
              eventId: sessionRow.event_id,
              queueStatus: registrationQueueStatus,
              state: sessionRow.state,
              phase: sessionRow.phase,
              handshakeStarted: Boolean(sessionRow.handshake_started_at),
              latchActive: isDateEntryTransitionActive(id),
            });
            logJourney("date_route_bounced", {
              reason: "in_ready_gate_without_provider_prepared_truth",
              target,
            });
            navigate(target, { replace: true });
            return;
          }
          logRegistrationStatus(registrationQueueStatus);
        }

        if (sessionRow.daily_room_name) {
          canonicalRoomNameRef.current = sessionRow.daily_room_name;
        }
        setIsParticipant1(isP1);
        setEventId(sessionRow.event_id);
        const pId = isP1 ? sessionRow.participant_2_id : sessionRow.participant_1_id;
        setPartnerId(pId);

        videoDateDebug("date_refresh_routing", {
          outcome: "stayed_on_date_route",
          reason: "guard_passed",
          sessionId: id,
          queueStatus: registrationQueueStatus,
          sessionTruth: {
            state: sessionRow.state ?? null,
            phase: sessionRow.phase ?? null,
            handshake_started_at: sessionRow.handshake_started_at ?? null,
            date_started_at: sessionRow.date_started_at ?? null,
          },
          latchActive: isDateEntryTransitionActive(id),
        });
        setVideoDateAccess("allowed");

        void (async () => {
          try {
            const { data: profile, error: profileError } = await supabase.rpc("get_profile_for_viewer", {
              p_target_id: pId,
            });

            if (cancelled) return;

            if (profileError) {
              vdbg("date_guard_partner_profile_failed", {
                sessionId: id,
                eventId: sessionRow.event_id ?? null,
                error: { code: profileError.code, message: profileError.message },
              });
            }

            if (profile) {
              const row = profile as Record<string, unknown>;
              const tags = Array.isArray(row.vibes)
                ? row.vibes.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
                : [];

              let prompts: { question: string; answer: string }[] = [];
              if (Array.isArray(row.prompts)) {
                prompts = (row.prompts as Array<{ question?: string; answer?: string }>).map((p) => ({
                  question: p.question || "",
                  answer: p.answer || "",
                }));
              }

              const photoArr = Array.isArray(row.photos) ? row.photos.filter((p): p is string => typeof p === "string") : [];
              const avatarUrl = typeof row.avatar_url === "string" ? row.avatar_url : null;
              const primaryPath = photoArr[0] || avatarUrl;
              const resolvedUrl = primaryPath ? resolvePhoto(primaryPath) : null;
              setPartnerPhotoUrl(resolvedUrl);

              const resolvedPhotos: string[] = photoArr
                .slice(0, 6)
                .map((p) => resolvePhoto(p))
                .filter(Boolean) as string[];

              setPartner({
                name: typeof row.name === "string" ? row.name : "Your date",
                age: typeof row.age === "number" ? row.age : 0,
                tags,
                avatarUrl: resolvedUrl || undefined,
                photos: resolvedPhotos.length > 0 ? resolvedPhotos : undefined,
                about_me: typeof row.about_me === "string" ? row.about_me : undefined,
                job: typeof row.job === "string" ? row.job : undefined,
                location: typeof row.location === "string" ? row.location : undefined,
                heightCm: typeof row.height_cm === "number" ? row.height_cm : undefined,
                prompts,
              });
            }
          } catch (profileErr) {
            if (!cancelled) {
              vdbg("date_guard_partner_profile_failed", {
                sessionId: id,
                eventId: sessionRow.event_id ?? null,
                error: profileErr instanceof Error
                  ? { name: profileErr.name, message: profileErr.message }
                  : String(profileErr),
              });
            }
          }
        })();
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
  }, [id, user?.id, navigate, logJourney, recoverTerminalPostDateSurvey]);

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
          "handshake_started_at, handshake_grace_expires_at, date_started_at, date_extra_seconds, phase, state, ended_at, ended_reason, participant_1_id, participant_2_id, participant_1_joined_at, participant_2_joined_at, participant_1_decided_at, participant_2_decided_at",
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
        await recoverTerminalPostDateSurvey("timing_terminal");
        setDateStartedAt(typeof data.date_started_at === "string" ? data.date_started_at : null);
        setTimingReady(true);
        return;
      }

      if ((data.state as string) === "date" || data.phase === "date" || Boolean(data.date_started_at)) {
        vdbg("date_timing_existing_date", { sessionId: id, row: data });
        markDateFlowEntered();
        setHandshakeStartedAt(null);
        const dateStartedAt = typeof data.date_started_at === "string" ? data.date_started_at : null;
        setDateStartedAt(dateStartedAt);
        const correctedTimeLeft = remainingDatePhaseSeconds({
          dateStartedAtIso: dateStartedAt,
          baseDateSeconds: DATE_TIME,
          dateExtraSeconds: extraNorm,
          nowMs: now,
        });
        trackTimerDriftRecovery(correctedTimeLeft, "session_reload");
        setTimeLeft(correctedTimeLeft);
        setPhase("date");
        setTimingReady(true);
        return;
      }

      if (data.handshake_started_at) {
        vdbg("date_timing_existing_handshake", { sessionId: id, row: data });
        setHandshakeStartedAt(data.handshake_started_at);
        setDateStartedAt(null);
        const handshakeRemaining =
          remainingStartedAtCountdownSeconds({
            startedAtIso: data.handshake_started_at,
            durationSeconds: HANDSHAKE_TIME,
            nowMs: now,
          }) ?? 0;
        setTimeLeft(handshakeRemaining);
        clearHandshakeGraceState();
        if (handshakeRemaining <= 0) {
          window.setTimeout(() => {
            void checkMutualVibeRef.current?.("handshake_timing_refetch_deadline_elapsed");
          }, 0);
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
      setDateStartedAt(null);
      setTimeLeft(null);
      setTimingReady(true);
    };

    void fetchTiming();

    return () => {
      cancelled = true;
    };
  }, [
    id,
    user?.id,
    videoDateAccess,
    clearHandshakeGraceState,
    markDateFlowEntered,
    recoverTerminalPostDateSurvey,
    timingRefreshNonce,
    trackTimerDriftRecovery,
  ]);

  // Browser foreground/online recovery mirrors native AppState reconciliation without polling storms.
  useEffect(() => {
    if (!id || videoDateAccess !== "allowed" || showFeedback) return;

    const reconcile = (source: "visibilitychange" | "online") => {
      if (source === "visibilitychange" && document.visibilityState !== "visible") return;
      if (phaseRef.current === "ended" || surveyOpenedRef.current || explicitEndRequestedRef.current !== "idle") return;
      const now = Date.now();
      if (foregroundReconcileInFlightRef.current) return;
      if (now - lastForegroundReconcileAtRef.current < 4_000) return;
      foregroundReconcileInFlightRef.current = true;
      lastForegroundReconcileAtRef.current = now;
      vdbg("video_date_foreground_reconcile_start", {
        sessionId: id,
        source,
        phase: phaseRef.current,
      });
      void (async () => {
        try {
          if (source === "visibilitychange") {
            const { data: returnData, error: returnError } = await supabase
              .rpc("video_date_transition", { p_session_id: id, p_action: "mark_reconnect_return" });
            vdbg("video_date_foreground_return_result", {
              sessionId: id,
              source,
              ok: !returnError,
              payload: returnData ?? null,
              error: returnError ? { code: returnError.code, message: returnError.message } : null,
            });
            if (!returnError) {
              trackEvent(LobbyPostDateEvents.VIDEO_DATE_RECONNECT_RETURNED, {
                platform: "web",
                session_id: id,
                event_id: eventId ?? null,
                source: "visibilitychange",
              });
            } else {
              trackEvent(LobbyPostDateEvents.VIDEO_DATE_FOREGROUND_RECONCILE_FAILED, {
                platform: "web",
                session_id: id,
                event_id: eventId ?? null,
                source,
                step: "mark_reconnect_return",
                code: returnError.code ?? null,
              });
            }
          }
          const { data, error } = await supabase
            .rpc("video_date_transition", { p_session_id: id, p_action: "sync_reconnect" });
          vdbg("video_date_foreground_reconcile_result", {
            sessionId: id,
            source,
            ok: !error,
            payload: data ?? null,
            error: error ? { code: error.code, message: error.message } : null,
          });
          if (error) {
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_FOREGROUND_RECONCILE_FAILED, {
              platform: "web",
              session_id: id,
              event_id: eventId ?? null,
              source,
              step: "sync_reconnect",
              code: error.code ?? null,
            });
          }
          const reconnectPayload = data as { ended?: boolean; state?: string | null; phase?: string | null } | null;
          if (
            !error &&
            (reconnectPayload?.ended === true ||
              reconnectPayload?.state === "ended" ||
              reconnectPayload?.phase === "ended")
          ) {
            const handled = await recoverTerminalPostDateSurvey(`${source}_sync_reconnect_terminal`);
            if (handled) return;
          }
          setTimingRefreshNonce((n) => n + 1);
        } catch (error) {
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_FOREGROUND_RECONCILE_FAILED, {
            platform: "web",
            session_id: id,
            event_id: eventId ?? null,
            source,
            step: "exception",
            error_name: error instanceof Error ? error.name : "unknown",
          });
        } finally {
          foregroundReconcileInFlightRef.current = false;
        }
      })();
    };

    const handleVisibilityChange = () => reconcile("visibilitychange");
    const handleOnline = () => reconcile("online");
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
    };
  }, [eventId, id, recoverTerminalPostDateSurvey, showFeedback, videoDateAccess]);

  // Start Daily as soon as the participant guard passes; timing hydration can finish in parallel.
  useEffect(() => {
    if (!id) return;
    if (videoDateAccess !== "allowed" || handshakeStartFailed) return;
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
        if (result.ok) {
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_JOIN_SUCCESS, {
            platform: "web",
            session_id: id,
            event_id: eventId,
          });
        } else if ("failure" in result) {
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_JOIN_FAILURE, {
            platform: "web",
            session_id: id,
            event_id: eventId,
            reason: result.failure.kind,
          });
        }
      }
      if (result.ok === true) {
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

      if (failure.kind === "BLOCKED_PAIR" || failure.kind === "ACCESS_DENIED") {
        clearDateEntryTransition(id);
        toast.error(
          failure.kind === "BLOCKED_PAIR"
            ? "This call is no longer available."
            : "This date link is no longer valid.",
        );
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
    handshakeStartFailed,
    phase,
    callStarted,
    startCall,
    getRoomName,
    dupBlocked,
    eventId,
    user?.id,
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
          const row = payload.new as VideoDateHandshakeTruth;
          setHandshakeTruth({ id, ...row });
          const newState = row.state || row.phase;

          if (row.ended_at || newState === "ended") {
            setHandshakeStartedAt(null);
            setDateStartedAt(typeof row.date_started_at === "string" ? row.date_started_at : null);
            void recoverTerminalPostDateSurvey("realtime_terminal", row);
            return;
          }

          if (newState === "date" || Boolean(row.date_started_at)) {
            markDateFlowEntered();
            clearHandshakeGraceState();
            setHandshakeStartedAt(null);
            const extraNorm = normalizedDateExtraSeconds(row.date_extra_seconds);
            setDateExtraSeconds(extraNorm);
            const dateStartedAt = typeof row.date_started_at === "string" ? row.date_started_at : null;
            setDateStartedAt(dateStartedAt);
            const correctedTimeLeft = remainingDatePhaseSeconds({
              dateStartedAtIso: dateStartedAt,
              baseDateSeconds: DATE_TIME,
              dateExtraSeconds: extraNorm,
            });
            trackTimerDriftRecovery(correctedTimeLeft, "realtime");
            setTimeLeft(correctedTimeLeft);
            setPhase("date");
            return;
          }

          if (row.handshake_started_at) {
            setHandshakeStartedAt(row.handshake_started_at);
            setDateStartedAt(null);
            const handshakeRemaining =
              remainingStartedAtCountdownSeconds({
                startedAtIso: row.handshake_started_at,
                durationSeconds: HANDSHAKE_TIME,
              }) ?? 0;
            setTimeLeft(handshakeRemaining);
            clearHandshakeGraceState();
            if (handshakeRemaining <= 0) {
              void checkMutualVibeRef.current?.("handshake_realtime_deadline_elapsed");
            }
            setPhase("handshake");
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [
    id,
    user?.id,
    videoDateAccess,
    clearHandshakeGraceState,
    markDateFlowEntered,
    recoverTerminalPostDateSurvey,
    trackTimerDriftRecovery,
  ]);

  // Progressive blur: clear over 10s when connected + track start
  useEffect(() => {
    if (isConnected) {
      trackEvent('video_date_started', { session_id: id, phase: 'handshake' });
      remoteReadableTrackedRef.current = false;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setBlurAmount(0);
        });
      });
    }
  }, [isConnected, id]);

  // Apply the user's stored audio output preference whenever we connect or
  // when the remote `<video>` element gets its first track. Browsers without
  // setSinkId silently no-op via the helper.
  useEffect(() => {
    if (!isConnected) return;
    if (!isSetSinkIdSupported()) return;
    let cancelled = false;
    void (async () => {
      const element = remoteVideoRef.current;
      if (!element) return;
      const result = await applyStoredAudioOutputPreference(element);
      if (cancelled) return;
      if (!result.ok && result.reason !== "unsupported_browser" && result.reason !== "no_device_id") {
        trackEvent("video_date_audio_output_apply_failed", {
          surface: "video_date",
          session_id: id,
          reason: result.reason,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isConnected, id, remoteVideoRef]);

  useEffect(() => {
    if (!isConnected || blurAmount !== 0 || remoteReadableTrackedRef.current || !id) return;
    const timerId = window.setTimeout(() => {
      if (remoteReadableTrackedRef.current) return;
      remoteReadableTrackedRef.current = true;
      const readableContext = recordReadyGateToDateLatencyCheckpoint({
        sessionId: id,
        platform: "web",
        eventId: eventId ?? null,
        sourceSurface: "video_date_daily",
        checkpoint: "remote_readable",
      });
      trackEvent(
        LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
        buildReadyGateToDateLatencyPayload({
          context: readableContext,
          checkpoint: "remote_readable",
          sourceAction: "progressive_blur_complete",
          outcome: "success",
        }),
      );
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_REMOTE_READABLE, {
        platform: "web",
        session_id: id,
        event_id: eventId ?? null,
        source_surface: "video_date_daily",
        source_action: "progressive_blur_complete",
      });
    }, 10_000);
    return () => window.clearTimeout(timerId);
  }, [blurAmount, eventId, id, isConnected]);

  // Countdown timer: display derives from server-owned phase timestamps, never from route mount time.
  useEffect(() => {
    if (showFeedback || phase === "ended") return;
    const hasAuthoritativeStart =
      phase === "handshake" ? Boolean(handshakeStartedAt) : phase === "date" ? Boolean(dateStartedAt) : false;
    if (!hasAuthoritativeStart) return;

    let completionFired = false;
    const tick = () => {
      const countdown = resolveVideoDatePhaseCountdown({
        phase,
        handshakeStartedAtIso: handshakeStartedAt,
        dateStartedAtIso: dateStartedAt,
        handshakeDurationSeconds: HANDSHAKE_TIME,
        dateDurationSeconds: DATE_TIME,
        dateExtraSeconds,
      });
      const next = countdown.remainingSeconds ?? 0;
      setTimeLeft(next);

      if (next > 0 || completionFired) return;
      const completionKey = `${id ?? "unknown-session"}:${phase}:${countdown.deadlineMs ?? "no-deadline"}`;
      if (countdownCompletionKeyRef.current === completionKey) return;
      completionFired = true;
      countdownCompletionKeyRef.current = completionKey;

      if (phaseRef.current === "date") {
        toast("Time flies! Thanks for a great date 💚", { duration: 2500 });
        void handleCallEndRef.current?.();
      } else if (phaseRef.current === "handshake") {
        vdbg("handshake_visible_countdown_elapsed", {
          sessionId: id ?? null,
          trigger: "complete_handshake",
        });
        void checkMutualVibeRef.current?.("handshake_visible_countdown_elapsed");
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [
    showFeedback,
    id,
    phase,
    dateStartedAt,
    dateExtraSeconds,
    handshakeStartedAt,
  ]);

  const dismissIceBreakerTemporarily = useCallback(() => {
    setShowIceBreaker(false);
  }, []);

  useEffect(() => {
    if (isConnected && (phase === "handshake" || phase === "date")) {
      setShowIceBreaker(true);
    }
  }, [id, isConnected, phase]);

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

  // Browser lifecycle — warn on unload, but only mark tab/background away after a native-like grace.
  useEffect(() => {
    leaveSignalSentRef.current = false;
    lifecycleHiddenStartedAtRef.current = null;
  }, [id]);

  useEffect(() => {
    if (!id || !user?.id || videoDateAccess !== "allowed") return;
    let lifecycleAwayTimer: ReturnType<typeof setTimeout> | null = null;

    const clearLifecycleAwayTimer = () => {
      if (!lifecycleAwayTimer) return;
      clearTimeout(lifecycleAwayTimer);
      lifecycleAwayTimer = null;
    };

    const sendLeaveSignal = (source: WebLifecycleLeaveSource) => {
      if (showFeedback || surveyOpenedRef.current || explicitEndRequestedRef.current !== "idle") return;
      if (phaseRef.current === "ended") return;
      if (leaveSignalSentRef.current) return;
      const token = leaveSignalTokenRef.current;
      if (!token) return;
      leaveSignalSentRef.current = true;
      const postLeaveSignal = async (idempotencyKey?: string) => {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/daily-room`, {
          method: "POST",
          keepalive: true,
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            action: "video_date_leave",
            sessionId: id,
            reason: `web_${source}`,
            idempotency_key: idempotencyKey,
          }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || (payload as { success?: boolean } | null)?.success === false) {
          throw new Error(
            `video_date_leave_failed:${response.status}:${String((payload as { code?: unknown } | null)?.code ?? "unknown")}`,
          );
        }
        return payload;
      };
      const markSent = (attempts?: number) => {
        vdbg("video_date_leave_signal_sent", {
          sessionId: id,
          userId: user.id,
          eventId: eventId ?? null,
          source,
          attempts: attempts ?? null,
        });
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_LEAVE_SIGNAL_SENT, {
          platform: "web",
          session_id: id,
          event_id: eventId ?? null,
          source,
          attempts: attempts ?? null,
        });
      };
      const markFailed = () => {
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_LEAVE_SIGNAL_FAILED, {
          platform: "web",
          session_id: id,
          event_id: eventId ?? null,
          source,
        });
      };
      try {
        if (source === "visibilitychange") {
          void sendVideoDateSignalWithRetry({
            sessionId: id,
            action: "video_date_leave",
            operation: (_attempt, idempotencyKey) => postLeaveSignal(idempotencyKey),
            isSuccess: (payload) => (payload as { success?: boolean } | null)?.success !== false,
          }).then((result) => {
            if (result.ok) {
              markSent(result.attempts);
              return;
            }
            leaveSignalSentRef.current = false;
            markFailed();
          });
          return;
        }
        void postLeaveSignal().then(() => markSent()).catch(() => {
          leaveSignalSentRef.current = false;
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_LEAVE_SIGNAL_FAILED, {
            platform: "web",
            session_id: id,
            event_id: eventId ?? null,
            source,
          });
        });
      } catch {
        leaveSignalSentRef.current = false;
        /* best-effort during browser teardown */
      }
    };

    const scheduleLifecycleAway = (
      source: Extract<WebLifecycleLeaveSource, "visibilitychange" | "pagehide" | "freeze">,
    ) => {
      if (showFeedback || surveyOpenedRef.current || explicitEndRequestedRef.current !== "idle") return;
      if (phaseRef.current === "ended") return;
      if (leaveSignalSentRef.current) return;
      const startedAt = lifecycleHiddenStartedAtRef.current ?? Date.now();
      lifecycleHiddenStartedAtRef.current = startedAt;
      const elapsedMs = Math.max(0, Date.now() - startedAt);
      const delayMs = Math.max(0, WEB_LIFECYCLE_AWAY_GRACE_MS - elapsedMs);
      clearLifecycleAwayTimer();
      lifecycleAwayTimer = setTimeout(() => sendLeaveSignal(source), delayMs);
      vdbg("web_lifecycle_away_scheduled", {
        sessionId: id,
        userId: user.id,
        eventId: eventId ?? null,
        source,
        delayMs,
        graceMs: WEB_LIFECYCLE_AWAY_GRACE_MS,
      });
    };

    const sendLifecycleAwayIfGraceElapsed = (source: Extract<WebLifecycleLeaveSource, "pagehide" | "freeze">) => {
      const startedAt = lifecycleHiddenStartedAtRef.current ?? Date.now();
      lifecycleHiddenStartedAtRef.current = startedAt;
      const elapsedMs = Math.max(0, Date.now() - startedAt);
      if (elapsedMs >= WEB_LIFECYCLE_AWAY_GRACE_MS) {
        clearLifecycleAwayTimer();
        sendLeaveSignal(source);
        return;
      }
      scheduleLifecycleAway(source);
    };

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isConnected && !showFeedback && explicitEndRequestedRef.current === "idle") {
        e.preventDefault();
        e.returnValue = "You're in a video date. Are you sure you want to leave?";
      }
      sendLeaveSignal("beforeunload");

      // Provider room cleanup is owned by video-date-room-cleanup after the session is terminal.
      // Do not delete here: the DB intentionally preserves daily_room_name until cleanup succeeds.
      const canonicalRoom = canonicalRoomNameRef.current;
      if (canonicalRoom) {
        vdbg("daily_room_delete_skipped", {
          action: "delete_room",
          caller: "VideoDate.beforeunload",
          reason: "backend_cleanup_and_reconnect_grace_own_video_date_rooms",
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
    const handlePageHide = (event: PageTransitionEvent) => {
      if (event.persisted) {
        sendLifecycleAwayIfGraceElapsed("pagehide");
        return;
      }
      clearLifecycleAwayTimer();
      sendLeaveSignal("pagehide");
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        scheduleLifecycleAway("visibilitychange");
      } else {
        leaveSignalSentRef.current = false;
        lifecycleHiddenStartedAtRef.current = null;
        clearLifecycleAwayTimer();
      }
    };
    const handleFreeze = () => {
      sendLifecycleAwayIfGraceElapsed("freeze");
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("freeze", handleFreeze);
    return () => {
      clearLifecycleAwayTimer();
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("freeze", handleFreeze);
    };
  }, [id, user?.id, eventId, isConnected, showFeedback, videoDateAccess, localVideoRef]);

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
      setHandshakeTruth(result.truth ?? null);
      setTimingRefreshNonce((n) => n + 1);
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
      const sessionEnded = handshakeDecisionFailureIndicatesSessionEnded({
        truth: result.truth,
        rpcPayload: result.rpcPayload,
      });
      if (sessionEnded) {
        clearHandshakeGraceState();
        toast.error(result.userMessage);
        void (async () => {
          await endCall("handshake_decision_terminal_failure");
          await handleCallEndRef.current?.();
        })();
        return false;
      }
      toast.error(result.userMessage);
      return false;
    } finally {
      handshakeDecisionInFlightRef.current = false;
    }
  }, [id, user?.id, clearHandshakeGraceState, endCall]);

  const handleUserVibe = useCallback(() => {
    recordUserAction("video_date_handshake_decision_clicked", {
      surface: "video_date",
      session_id: id,
      decision: "vibe",
      phase,
    });
    return handleHandshakeDecision("vibe");
  }, [handleHandshakeDecision, id, phase]);
  const handleUserPass = useCallback(() => {
    recordUserAction("video_date_handshake_decision_clicked", {
      surface: "video_date",
      session_id: id,
      decision: "pass",
      phase,
    });
    return handleHandshakeDecision("pass");
  }, [handleHandshakeDecision, id, phase]);

  const localHandshakeDecision = useMemo<boolean | null>(() => {
    if (!handshakeTruth || !user?.id) return null;
    if (handshakeTruth.participant_1_id === user.id) {
      return handshakeTruth.participant_1_decided_at ? handshakeTruth.participant_1_liked ?? null : null;
    }
    if (handshakeTruth.participant_2_id === user.id) {
      return handshakeTruth.participant_2_decided_at ? handshakeTruth.participant_2_liked ?? null : null;
    }
    return null;
  }, [handshakeTruth, user?.id]);

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
        const dateTruth = (truthAfter as VideoDateHandshakeTruth | null) ?? null;
        const extraNorm = normalizedDateExtraSeconds(dateTruth?.date_extra_seconds);
        const startedAt = typeof dateTruth?.date_started_at === "string" ? dateTruth.date_started_at : null;
        markDateFlowEntered();
        clearHandshakeGraceState();
        setDateExtraSeconds(extraNorm);
        setDateStartedAt(startedAt);
        setTimeLeft(
          remainingDatePhaseSeconds({
            dateStartedAtIso: startedAt,
            baseDateSeconds: DATE_TIME,
            dateExtraSeconds: extraNorm,
          }),
        );
        setShowMutualToast(true);
      } else if (payload?.state === "handshake") {
        clearHandshakeGraceState();
        scheduleRetry("handshake_deadline_not_terminal");
        return;
      } else {
        clearHandshakeGraceState();
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_HANDSHAKE_NOT_MUTUAL, {
          platform: "web",
          session_id: id,
          event_id: eventId,
          reason: payload?.reason ?? null,
        });
        if (payload?.reason === "handshake_timeout") {
          const notice = getVideoDateWarmupChoiceNotice({
            waitingForSelf: payload.waiting_for_self,
            waitingForPartner: payload.waiting_for_partner,
          });
          showWarmupChoiceNoticeToast(notice);
        } else if (payload?.reason === "handshake_grace_expired") {
          showWarmupChoiceNoticeToast(getVideoDateWarmupChoiceNotice());
        } else {
          toast("Great meeting you! 👋", { duration: 2500 });
        }
        const handledTerminalSurvey = await recoverTerminalPostDateSurvey(
          payload?.survey_required === true
            ? "complete_handshake_survey_required"
            : "complete_handshake_terminal",
        );
        if (handledTerminalSurvey) {
          void endCall("complete_handshake_not_mutual");
          return;
        }
        await endCall("complete_handshake_not_mutual");
        void handleCallEndRef.current?.();
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
  }, [id, eventId, endCall, clearHandshakeGraceState, markDateFlowEntered, recoverTerminalPostDateSurvey]);

  useEffect(() => {
    checkMutualVibeRef.current = checkMutualVibe;
    return () => {
      if (checkMutualVibeRef.current === checkMutualVibe) {
        checkMutualVibeRef.current = null;
      }
    };
  }, [checkMutualVibe]);

  useEffect(() => {
    if (
      !id ||
      phase !== "handshake" ||
      showFeedback ||
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
    handshakeStartedAt,
    id,
    phase,
    showFeedback,
  ]);

  const handleMutualToastComplete = useCallback(async () => {
    clearHandshakeGraceState();
    markDateFlowEntered();
    setShowMutualToast(false);
    setPhase("date");
    setTimeLeft(
      remainingDatePhaseSeconds({
        dateStartedAtIso: dateStartedAt,
        baseDateSeconds: DATE_TIME,
        dateExtraSeconds,
      }),
    );
    trackEvent(LobbyPostDateEvents.VIDEO_DATE_HANDSHAKE_COMPLETED_MUTUAL, {
      platform: "web",
      session_id: id,
      event_id: eventId,
    });
    setShowIceBreaker(true);

    // Server already transitioned to date via video_date_transition; no client-owned writes needed here.
  }, [id, eventId, clearHandshakeGraceState, markDateFlowEntered, dateExtraSeconds, dateStartedAt]);

  const handleExtend = useCallback(
    async (minutes: number, type: "extra_time" | "extended_vibe"): Promise<VideoDateExtendOutcome> => {
      if (extensionSpendInFlightRef.current) {
        return { ok: false, userMessage: "", silent: true };
      }
      if (!id) {
        return { ok: false, userMessage: userMessageForExtensionSpendFailure("session_not_found") };
      }
      extensionSpendInFlightRef.current = true;
      const retry =
        extensionSpendRetryRef.current?.type === type ? extensionSpendRetryRef.current : null;
      const idempotencyKey = retry?.key ?? makeExtensionIdempotencyKey(id, type);
      extensionSpendRetryRef.current = { type, key: idempotencyKey };
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_EXTENSION_ATTEMPTED, {
        platform: "web",
        session_id: id,
        event_id: eventId,
        credit_type: type,
      });
      try {
        const { data, error } = await supabase.rpc("spend_video_date_credit_extension", {
          p_session_id: id,
          p_credit_type: type,
          p_idempotency_key: idempotencyKey,
        } as never);
        if (error) {
          captureSupabaseError("spend_video_date_credit_extension", error);
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_EXTENSION_FAILED, {
            platform: "web",
            session_id: id,
            event_id: eventId,
            credit_type: type,
            reason: "rpc_transport",
          });
          void refetchCredits();
          return { ok: false, userMessage: userMessageForExtensionSpendFailure("rpc_transport") };
        }
        const parsed = parseSpendVideoDateCreditExtensionPayload(data);
        if (parsed.success === false) {
          extensionSpendRetryRef.current = null;
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_EXTENSION_FAILED, {
            platform: "web",
            session_id: id,
            event_id: eventId,
            credit_type: type,
            reason: parsed.error,
          });
          void refetchCredits();
          return { ok: false, userMessage: userMessageForExtensionSpendFailure(parsed.error) };
        }
        extensionSpendRetryRef.current = null;
        const addedSeconds = Math.max(
          0,
          Math.floor(parsed.addedSeconds ?? minutes * 60),
        );
        const nextExtra =
          parsed.dateExtraSeconds !== undefined
            ? Math.max(0, Math.floor(parsed.dateExtraSeconds))
            : Math.max(0, dateExtraSeconds + addedSeconds);
        setDateExtraSeconds(nextExtra);
        Sentry.addBreadcrumb({
          category: "credits",
          message: `Used ${type} credit`,
          level: "info",
          data: {
            added_seconds: addedSeconds,
            date_extra_seconds: nextExtra,
            idempotent: parsed.idempotent === true,
          },
        });
        setTimeLeft((prev) => {
          if (!dateStartedAt) return (prev ?? 0) + addedSeconds;
          return remainingDatePhaseSeconds({
            dateStartedAtIso: dateStartedAt,
            baseDateSeconds: DATE_TIME,
            dateExtraSeconds: nextExtra,
          });
        });
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_EXTENSION_SUCCEEDED, {
          platform: "web",
          session_id: id,
          event_id: eventId,
          credit_type: type,
          added_seconds: addedSeconds,
          date_extra_seconds: nextExtra,
          idempotent: parsed.idempotent === true,
        });
        void refetchCredits();
        return {
          ok: true,
          minutesAdded: addedSeconds / 60,
          secondsAdded: addedSeconds,
          dateExtraSeconds: nextExtra,
        };
      } finally {
        extensionSpendInFlightRef.current = false;
      }
    },
    [dateExtraSeconds, dateStartedAt, eventId, id, refetchCredits]
  );

  // End call: server-owned `video_date_transition(end, …)` + survey/navigation UX (no direct session row writes here).
  const handleCallEnd = useCallback(async (reason: VideoDateEndReason = "ended_from_client") => {
    if (explicitEndRequestedRef.current !== "idle") return;
    explicitEndRequestedRef.current = "sending";
    recordUserAction("video_date_end_requested", {
      surface: "video_date",
      session_id: id,
      phase,
      reason,
    });
    const analyticsBudgetSeconds =
      phase === "handshake"
        ? HANDSHAKE_TIME
        : HANDSHAKE_TIME + effectiveDateDurationSeconds(DATE_TIME, dateExtraSeconds);
    trackEvent('video_date_ended', {
      session_id: id,
      duration_seconds: analyticsBudgetSeconds - (timeLeft ?? 0),
      phase,
    });
    if (!id) {
      explicitEndRequestedRef.current = "idle";
      return;
    }

    const args = {
      p_session_id: id,
      p_action: "end",
      p_reason: reason,
    };
    vdbg("video_date_transition_before", { action: "end", args });
    const transitionResult = await sendVideoDateSignalWithRetry({
      sessionId: id,
      action: "end",
      operation: async (attempt, idempotencyKey) => {
        const { data, error } = await supabase.rpc("video_date_transition", args);
        vdbg("video_date_transition_after", {
          action: "end",
          ok: !error,
          payload: data ?? null,
          error: error ? { code: error.code, message: error.message } : null,
          attempt,
          idempotencyKey,
        });
        if (error) throw error;
        return data;
      },
      isSuccess: (data) => (data as { success?: boolean } | null)?.success !== false,
    });

    try {
      if (!transitionResult.ok) {
        recordUserAction("video_date_end_failed", {
          surface: "video_date",
          session_id: id,
          phase,
          reason,
          failure_kind: "transition_not_ok",
        });
        const { data: sessionRow } = await supabase
          .from("video_sessions")
          .select("ended_at, ended_reason, state, phase, date_started_at, participant_1_joined_at, participant_2_joined_at")
          .eq("id", id)
          .maybeSingle();
        if (videoSessionIndicatesTerminalEnd(sessionRow)) {
          const recovered = await recoverTerminalPostDateSurvey("local_end_recovered_after_rpc_error");
          if (!recovered) {
            toast.error("Couldn't finish ending the date. Please try again.");
            explicitEndRequestedRef.current = "idle";
            return;
          }
          explicitEndRequestedRef.current = "acked";
          return;
        }
        toast.error("Couldn't finish ending the date. Please try again.");
        explicitEndRequestedRef.current = "idle";
        return;
      }

      explicitEndRequestedRef.current = "acked";
      recordUserAction("video_date_end_succeeded", {
        surface: "video_date",
        session_id: id,
        phase,
        reason,
      });
      const { data: sessionRow } = await supabase
        .from("video_sessions")
        .select("ended_at, ended_reason, state, phase, date_started_at, participant_1_joined_at, participant_2_joined_at")
        .eq("id", id)
        .maybeSingle();
      if (videoSessionIndicatesTerminalEnd(sessionRow)) {
        const recovered = await recoverTerminalPostDateSurvey("local_end");
        if (recovered) {
          markDateFlowEntered();
          return;
        }
      }

      {
        markDateFlowEntered();
        clearHandshakeGraceState();
        openPostDateSurvey("local_end");
      }
    } catch (error) {
      recordUserAction("video_date_end_failed", {
        surface: "video_date",
        session_id: id,
        phase,
        reason,
        failure_kind: "exception",
      });
      vdbg("video_date_transition_after", {
        action: "end",
        ok: false,
        error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
      });
      toast.error("Couldn't finish ending the date. Please try again.");
      explicitEndRequestedRef.current = "idle";
    }
  }, [id, phase, timeLeft, dateExtraSeconds, recoverTerminalPostDateSurvey, markDateFlowEntered, clearHandshakeGraceState, openPostDateSurvey]);

  useEffect(() => {
    handleCallEndRef.current = handleCallEnd;
  }, [handleCallEnd]);

  const resolveVideoDateExitTarget = useCallback(
    (overrideEventId?: string | null) => {
      const destinationEventId = overrideEventId ?? eventId;
      return destinationEventId ? `/event/${encodeURIComponent(destinationEventId)}/lobby` : "/events";
    },
    [eventId],
  );

  const signalPreDateManualEnd = useCallback(
    async (reason: VideoDateEndReason) => {
      if (!id) return false;
      const args = {
        p_session_id: id,
        p_action: "end",
        p_reason: reason,
      };
      vdbg("video_date_transition_before", {
        action: "end",
        source: "manual_pre_date_exit",
        args,
      });
      const transitionResult = await sendVideoDateSignalWithRetry({
        sessionId: id,
        action: "end",
        operation: async (attempt, idempotencyKey) => {
          const { data, error } = await supabase.rpc("video_date_transition", args);
          vdbg("video_date_transition_after", {
            action: "end",
            source: "manual_pre_date_exit",
            ok: !error,
            payload: data ?? null,
            error: error ? { code: error.code, message: error.message } : null,
            attempt,
            idempotencyKey,
          });
          if (error) throw error;
          return data;
        },
        isSuccess: (data) => (data as { success?: boolean } | null)?.success !== false,
      });

      recordUserAction(
        transitionResult.ok
          ? "video_date_pre_date_exit_end_signal_succeeded"
          : "video_date_pre_date_exit_end_signal_failed",
        {
          surface: "video_date",
          session_id: id,
          phase: phaseRef.current,
          reason,
          attempts: transitionResult.attempts,
        },
      );
      return transitionResult.ok;
    },
    [id],
  );

  const handlePreDateExit = useCallback(
    async (opts?: { reason?: VideoDateEndReason; source?: string }) => {
      const reason = opts?.reason ?? "ended_from_client";
      const source = opts?.source ?? "connection_overlay_leave";
      if (manualExitInFlightRef.current) return;
      manualExitInFlightRef.current = true;
      setIsLeavingVideoDate(true);
      recordUserAction("video_date_pre_date_leave_clicked", {
        surface: "video_date",
        session_id: id,
        phase: phaseRef.current,
        reason,
        source,
      });
      clearHandshakeGraceState();
      if (id) {
        clearDateEntryTransition(id);
        suppressDateNavigationAfterManualExit(id);
      }
      setPhase("ended");
      setTimeLeft(0);
      setShowFeedback(false);
      void setStatus("browsing");

      const [dailyCleanup, serverEnd] = await Promise.all([
        runVideoDateManualExitStep("daily_cleanup", () => endCall(source)),
        runVideoDateManualExitStep("server_end", () => signalPreDateManualEnd(reason)),
      ]);

      const target = resolveVideoDateExitTarget();
      recordUserAction("video_date_pre_date_leave_navigating", {
        surface: "video_date",
        session_id: id,
        phase: phaseRef.current,
        reason,
        source,
        daily_cleanup_status: dailyCleanup.status,
        server_end_status: serverEnd.status,
        target,
      });
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_NO_REMOTE_USER_EXIT, {
        platform: "web",
        session_id: id,
        event_id: eventId ?? null,
        source,
        daily_cleanup_status: dailyCleanup.status,
        server_end_status: serverEnd.status,
      });
      vdbgRedirect(target, "manual_pre_date_exit", {
        sessionId: id ?? null,
        eventId: eventId ?? null,
        reason,
        source,
        dailyCleanupStatus: dailyCleanup.status,
        serverEndStatus: serverEnd.status,
      });
      navigate(target, { replace: true });
    },
    [
      clearHandshakeGraceState,
      endCall,
      eventId,
      id,
      navigate,
      resolveVideoDateExitTarget,
      setStatus,
      signalPreDateManualEnd,
    ],
  );

  const handleLeave = useCallback(async (opts?: { reason?: VideoDateEndReason }) => {
    const hasDateEntryTruth = hasEnteredDateFlowRef.current || phaseRef.current === "date" || Boolean(dateStartedAt) || videoSessionHasEncounterExposureTruth(handshakeTruth);
    if (!hasDateEntryTruth) {
      await handlePreDateExit({
        reason: opts?.reason ?? "ended_from_client",
        source: "pre_date_leave_button",
      });
      return;
    }

    recordUserAction("video_date_leave_clicked", {
      surface: "video_date",
      session_id: id,
      phase,
      reason: opts?.reason ?? "ended_from_client",
    });
    clearHandshakeGraceState();
    await endCall("user_leave_button");
    toast("You left the date — stay safe! 💚", { duration: 2000 });
    await handleCallEnd(opts?.reason);
  }, [dateStartedAt, endCall, handleCallEnd, handlePreDateExit, clearHandshakeGraceState, handshakeTruth, id, phase]);

  const requestEndDateConfirmation = useCallback(() => {
    if (isLeavingVideoDate || isEndDateConfirming) return;
    setShowEndDateConfirm(true);
  }, [isEndDateConfirming, isLeavingVideoDate]);

  const confirmEndDate = useCallback(async () => {
    if (isLeavingVideoDate || isEndDateConfirming) return;
    setIsEndDateConfirming(true);
    try {
      await handleLeave();
      setShowEndDateConfirm(false);
    } finally {
      setIsEndDateConfirming(false);
    }
  }, [handleLeave, isEndDateConfirming, isLeavingVideoDate]);

  useEffect(() => {
    if (!peerMissing.terminal || !id) return;
    trackEvent(LobbyPostDateEvents.VIDEO_DATE_PEER_MISSING_TERMINAL_IMPRESSION, {
      platform: "web",
      session_id: id,
      event_id: eventId ?? null,
    });
  }, [eventId, id, peerMissing.terminal]);

  useEffect(() => {
    if (!id || videoDateAccess !== "allowed" || showFeedback || phase === "ended") return;
    if (mediaPermissionError) return;
    const shouldReconcileTerminalSurvey =
      peerMissing.terminal || remotePlayback.playRejected || isConnecting || !isConnected;
    if (!shouldReconcileTerminalSurvey) return;

    let cancelled = false;
    let inFlight = false;
    const reconcileTerminalSurvey = async (source: string) => {
      if (cancelled || inFlight || surveyOpenedRef.current) return;
      if (explicitEndRequestedRef.current !== "idle") return;
      inFlight = true;
      try {
        await recoverTerminalPostDateSurvey(source);
      } finally {
        inFlight = false;
      }
    };

    void reconcileTerminalSurvey("peer_wait_terminal_reconcile_initial");
    const interval = window.setInterval(() => {
      void reconcileTerminalSurvey("peer_wait_terminal_reconcile_interval");
    }, TERMINAL_SURVEY_RECONCILE_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    id,
    videoDateAccess,
    showFeedback,
    phase,
    mediaPermissionError,
    peerMissing.terminal,
    remotePlayback.playRejected,
    isConnecting,
    isConnected,
    recoverTerminalPostDateSurvey,
  ]);

  const handlePeerMissingRetry = useCallback(() => {
    if (!id) return;
    trackEvent(LobbyPostDateEvents.VIDEO_DATE_PEER_MISSING_RETRY_TAP, {
      platform: "web",
      session_id: id,
      event_id: eventId ?? null,
    });
    trackEvent(LobbyPostDateEvents.VIDEO_DATE_NO_REMOTE_RECOVERY_ATTEMPT, {
      platform: "web",
      session_id: id,
      event_id: eventId ?? null,
      source: "user_tap",
    });
    void (async () => {
      clearPeerMissing();
      setCallStartFailure(null);
      try {
        await endCall("peer_missing_retry");
      } finally {
        setCallStarted(false);
      }
    })();
  }, [clearPeerMissing, endCall, eventId, id]);

  const handlePeerMissingKeepWaiting = useCallback(() => {
    if (id) {
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_PEER_MISSING_KEEP_WAITING_TAP, {
        platform: "web",
        session_id: id,
        event_id: eventId ?? null,
      });
    }
    clearPeerMissing();
  }, [clearPeerMissing, eventId, id]);

  const handlePeerMissingLeave = useCallback(() => {
    if (id) {
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_PEER_MISSING_BACK_TO_LOBBY_TAP, {
        platform: "web",
        session_id: id,
        event_id: eventId ?? null,
      });
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_NO_REMOTE_USER_EXIT, {
        platform: "web",
        session_id: id,
        event_id: eventId ?? null,
        source: "peer_missing_back_to_lobby",
      });
    }
    void handlePreDateExit({ reason: "partial_join_peer_timeout", source: "peer_missing_back_to_lobby" });
  }, [eventId, handlePreDateExit, id]);

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
  }, [dupBlocked, callStarted, endCall, navigate, eventId, id]);

  const totalTime =
    phase === "handshake" ? HANDSHAKE_TIME : effectiveDateDurationSeconds(DATE_TIME, dateExtraSeconds);
  const handshakeTimerDisplayLeft = timeLeft ?? 0;
  const handshakeTimerTotal = totalTime;
  const handshakeTimerStarted =
    phase !== "handshake" || Boolean(handshakeStartedAt);
  const partnerFirstName = partner.name.trim().split(/\s+/)[0] || partner.name;
  const isUrgent = phase === "date" && (timeLeft ?? 999) <= 10;
  const transportReconnectVisible =
    dailyReconnectState === "interrupted" ||
    dailyReconnectState === "partner_reconnecting" ||
    dailyReconnectState === "partner_left_grace" ||
    dailyReconnectState === "failed_after_grace";
  const reconnectOverlayMode =
    dailyReconnectState === "partner_left_grace" ? "partner_away" : "network_interrupted";
  const anyReconnectVisible = transportReconnectVisible || reconnection.isPartnerDisconnected;
  const showFloatingIceBreaker =
    isConnected &&
    remotePlayback.participantPresent &&
    showIceBreaker &&
    !showFeedback &&
    !showMutualToast &&
    !remotePlayback.playRejected &&
    !peerMissing.terminal &&
    !anyReconnectVisible &&
    (phase === "handshake" || phase === "date");
  const showCollapsedIceBreaker =
    isConnected &&
    remotePlayback.participantPresent &&
    !showIceBreaker &&
    !showFeedback &&
    !showMutualToast &&
    !remotePlayback.playRejected &&
    !peerMissing.terminal &&
    !anyReconnectVisible &&
    (phase === "handshake" || phase === "date");
  const iceBreakerPositionClass =
    phase === "handshake" && handshakeTimerStarted
      ? "bottom-[14rem]"
      : "bottom-[6.75rem]";

  useEffect(() => {
    if (!id || !handshakeTimerStarted || phase !== "handshake") return;
    const key = `${id}:${handshakeStartedAt ?? "phase_not_handshake"}`;
    if (warmupTimerStartedTrackedRef.current === key) return;
    warmupTimerStartedTrackedRef.current = key;
    const latencyContext = recordReadyGateToDateLatencyCheckpoint({
      sessionId: id,
      platform: "web",
      eventId: eventId ?? null,
      sourceSurface: "video_date_route",
      checkpoint: "warmup_timer_started",
    });
    trackEvent(
      LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
      buildReadyGateToDateLatencyPayload({
        context: latencyContext,
        checkpoint: "warmup_timer_started",
        sourceAction: "server_handshake_started_at",
        outcome: "success",
      }),
    );
    trackEvent(LobbyPostDateEvents.VIDEO_DATE_WARMUP_TIMER_STARTED, {
      platform: "web",
      session_id: id,
      event_id: eventId ?? null,
      source_surface: "video_date_route",
      source_action: "server_handshake_started_at",
      handshake_started_at: handshakeStartedAt ?? null,
    });
  }, [eventId, handshakeStartedAt, handshakeTimerStarted, id, phase]);

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

  if (mediaPermissionError) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center gap-4">
        <User className="w-14 h-14 text-muted-foreground" />
        <h1 className="text-xl font-display font-semibold">Camera and microphone are needed</h1>
        <p className="text-muted-foreground text-sm max-w-sm">
          Allow access so your date can begin softly with audio and video. Then try again.
        </p>
        <p className="text-xs text-muted-foreground max-w-sm">
          In Chrome or Safari, use the camera icon in the address bar or your site settings to allow access for Vibely.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            type="button"
            onClick={() => {
              trackEvent(LobbyPostDateEvents.VIDEO_DATE_MEDIA_PERMISSION_RETRY, {
                platform: "web",
                session_id: id,
                event_id: eventId ?? null,
                source: "retry_tap",
              });
              setCallStartFailure(null);
              setHandshakeStartFailed(false);
              setCallStarted(false);
              clearMediaPermissionError();
            }}
          >
            Try again
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const target = eventId ? `/event/${encodeURIComponent(eventId)}/lobby` : "/events";
              vdbgRedirect(target, "camera_permission_denied_exit", { sessionId: id ?? null, eventId: eventId ?? null });
              navigate(target);
            }}
          >
            Back to lobby
          </Button>
        </div>
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
    <div className="fixed inset-0 overflow-hidden bg-[radial-gradient(circle_at_50%_10%,hsl(var(--primary)/0.18),transparent_32%),radial-gradient(circle_at_50%_95%,hsl(var(--accent)/0.14),transparent_30%),hsl(var(--background))] md:flex md:items-center md:justify-center md:p-4">
      <div className="pointer-events-none absolute inset-0 hidden bg-[linear-gradient(135deg,rgba(10,10,16,0.92),rgba(5,5,9,0.98))] md:block" aria-hidden />
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

      <div
        data-video-date-stage
        className="relative z-10 flex h-[100dvh] w-screen flex-col overflow-hidden bg-background md:h-[min(calc(100dvh_-_2rem),920px)] md:max-h-[920px] md:w-[min(calc(100vw_-_2rem),500px)] md:translate-y-2 md:rounded-[2rem] md:border md:border-white/10 md:shadow-[0_34px_110px_rgba(0,0,0,0.56),0_0_60px_rgba(139,92,246,0.12)]"
      >
      <UrgentBorderEffect isActive={isUrgent && !showFeedback} />

      {/* ─── Top HUD ─── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between gap-3 px-4 pb-3 md:px-5"
        style={{
          paddingTop: "max(1rem, env(safe-area-inset-top))",
          background:
            "linear-gradient(to bottom, hsl(var(--background) / 0.92), hsl(var(--background) / 0.42) 62%, transparent)",
        }}
      >
        {/* Partner info pill */}
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={() => isConnected && setShowProfileSheet(true)}
          aria-label={`View ${partner.name}'s profile`}
          className="flex min-w-0 max-w-[9.75rem] items-center gap-2 rounded-full border border-white/[0.12] bg-black/[0.45] px-2.5 py-2 text-left shadow-[0_16px_46px_rgba(0,0,0,0.38),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl transition-colors hover:bg-black/[0.55] sm:max-w-[15rem]"
        >
          {partnerPhotoUrl ? (
            <img
              src={partnerPhotoUrl}
              alt={partner.name}
              className="w-10 h-10 rounded-full object-cover border border-primary/35 shadow-[0_0_18px_hsl(var(--primary)/0.2)]"
              loading="eager"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <ProfilePhoto
              name={partner.name}
              size="sm"
              rounded="full"
              loading="eager"
              className="w-10 h-10"
            />
          )}
          <div className="min-w-0 text-left">
            <p className="truncate text-[15px] font-display font-semibold text-foreground leading-tight">
              {partnerFirstName}
              {partner.age > 0 && (
                <span className="font-normal text-foreground/60 ml-1">
                  {partner.age}
                </span>
              )}
            </p>
            {isConnected && (
              <div className="flex min-w-0 flex-col items-start gap-0.5">
                <div className="flex items-center gap-1.5">
                  <motion.div
                    className="w-1.5 h-1.5 rounded-full bg-green-400 shadow-[0_0_10px_rgba(74,222,128,0.75)]"
                    animate={{ opacity: [1, 0.5, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                  <span className="text-[11px] font-medium text-green-400">
                    {phase === "handshake" ? (handshakeTimerStarted ? "Warm up" : "Settling in") : "Live"}
                  </span>
                </div>
                {networkTier !== "good" && (
                  <span
                    className={`max-w-[118px] truncate text-[10px] ${networkTier === "poor" ? "text-destructive" : "text-amber-400"}`}
                  >
                    {networkTier === "poor" ? "Connection is fragile" : "Connection is settling"}
                  </span>
                )}
              </div>
            )}
          </div>
        </motion.button>

        {/* Phase indicator + Timer */}
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            {isConnected && phase === "handshake" && (
              <motion.div
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                className="px-3 py-2 rounded-full bg-primary/15 border border-primary/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl"
              >
                <span className="text-[11px] font-display font-semibold text-primary uppercase tracking-[0.18em]">
                  {handshakeTimerStarted ? "Warm up" : "Settling in"}
                </span>
              </motion.div>
            )}
            {isConnected && phase === "date" && (
              <motion.div
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                className="px-3 py-2 rounded-full bg-accent/15 border border-accent/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl"
              >
                <span className="text-[11px] font-display font-semibold text-accent uppercase tracking-[0.18em]">
                  Date
                </span>
              </motion.div>
            )}
            {handshakeTimerStarted ? (
              <HandshakeTimer
                timeLeft={handshakeTimerDisplayLeft}
                totalTime={handshakeTimerTotal}
                phase={phase}
              />
            ) : (
              <motion.div
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                className="px-3 py-2 rounded-full bg-black/40 border border-white/10 backdrop-blur-xl"
              >
                <span className="text-[11px] text-white/60">Waiting together</span>
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
        </div>
      </motion.div>

      {/* ─── Remote Video with Progressive Blur ─── */}
      <div className={REMOTE_DATE_VIDEO_CONTAINER_CLASS} ref={remoteContainerRef}>
        <video
          ref={remoteBackdropVideoRef}
          aria-hidden="true"
          tabIndex={-1}
          autoPlay
          playsInline
          muted
          className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-35 blur-2xl saturate-[0.72]"
          style={{
            backgroundColor: "#000",
            filter: `blur(${Math.max(18, blurAmount + 14)}px)`,
          }}
        />
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className={REMOTE_DATE_VIDEO_CLASS}
          onLoadedMetadata={() => logRemoteVideoLayout("loadedmetadata")}
          onPlaying={() => logRemoteVideoLayout("playing")}
          onResize={() => logRemoteVideoLayout("resize")}
          style={{
            width: "100%",
            height: "100%",
            position: "relative",
            zIndex: 1,
            backgroundColor: "#000",
            objectFit: VIDEO_DATE_REMOTE_OBJECT_FIT,
            objectPosition: VIDEO_DATE_REMOTE_OBJECT_POSITION,
            filter: `blur(${blurAmount}px)`,
            transition: "filter 10s linear",
          }}
        />

        {/* Connection overlay */}
        <AnimatePresence>
          {(isConnecting || !isConnected || remotePlayback.playRejected) &&
            !showFeedback &&
            !mediaPermissionError &&
            !anyReconnectVisible && (
              <ConnectionOverlay
                isConnecting={isConnecting}
                remotePlayback={remotePlayback}
                peerMissing={peerMissing}
                onRetryRemotePlayback={retryRemotePlayback}
                onRetryPeerMissing={handlePeerMissingRetry}
                onKeepWaitingPeerMissing={handlePeerMissingKeepWaiting}
                onLeave={peerMissing.terminal ? handlePeerMissingLeave : handlePreDateExit}
                isLeaving={isLeavingVideoDate}
                partnerName={partnerFirstName}
                partnerAvatarUrl={partnerPhotoUrl}
              />
            )}
        </AnimatePresence>

        {/* Reconnection overlay */}
        <ReconnectionOverlay
          isVisible={anyReconnectVisible}
          partnerName={partner.name}
          graceTimeLeft={transportReconnectVisible ? reconnectGraceTimeLeft : reconnection.graceTimeLeft}
          mode={transportReconnectVisible ? reconnectOverlayMode : "partner_away"}
        />

        {/* Cinematic glass wash */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_15%,rgba(168,85,247,0.10),transparent_48%),linear-gradient(to_bottom,rgba(0,0,0,0.16),transparent_32%,rgba(0,0,0,0.16))] pointer-events-none" />

        {/* Bottom gradient */}
        <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-background via-background/70 to-transparent pointer-events-none" />
      </div>

      {/* ─── Self-View PIP ─── */}
      {isConnected && !showFeedback && (
        <SelfViewPIP
          stream={localStream}
          isVideoOff={isVideoOff}
          isMuted={isMuted}
          containerRef={remoteContainerRef}
          blurAmount={blurAmount}
          sessionId={id}
          eventId={eventId ?? null}
          canFlipCamera={canFlipCamera}
          isFlippingCamera={isFlippingCamera}
          onFlipCamera={flipCamera}
        />
      )}

      {/* ─── Ice Breaker (floating prompt) ─── */}
      <AnimatePresence>
        {showFloatingIceBreaker && (
          <motion.div
            initial={{ y: -10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -8, opacity: 0 }}
            className={`pointer-events-auto absolute left-4 right-4 z-20 mx-auto max-w-[520px] ${iceBreakerPositionClass}`}
          >
            <IceBreakerCard
              sessionId={id}
              onDismiss={dismissIceBreakerTemporarily}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCollapsedIceBreaker && (
          <motion.button
            type="button"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => setShowIceBreaker(true)}
            className={`absolute left-4 z-20 flex items-center gap-2 rounded-full border border-primary/25 bg-black/[0.48] px-3.5 py-2 text-xs font-display font-semibold text-primary shadow-[0_14px_36px_rgba(0,0,0,0.34)] backdrop-blur-2xl ${iceBreakerPositionClass}`}
            aria-label="Show ice-breaker question"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Icebreaker
          </motion.button>
        )}
      </AnimatePresence>

      {/* ─── Pass/Vibe decision rail (handshake only) ─── */}
      <AnimatePresence>
        {isConnected && phase === "handshake" && handshakeTimerStarted && !showFeedback && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-[7.5rem] left-0 right-0 z-[25] flex justify-center"
          >
            <VibeCheckButton
              timeLeft={timeLeft ?? 0}
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
      <div className="absolute bottom-0 left-0 right-0 z-30 px-3 pb-safe">
        <VideoDateControls
          isMuted={isMuted}
          isVideoOff={isVideoOff}
          onToggleMute={() => {
            recordUserAction("video_date_control_clicked", {
              surface: "video_date",
              session_id: id,
              control: "mute",
              next_muted: !isMuted,
            });
            toggleMute();
          }}
          onToggleVideo={() => {
            recordUserAction("video_date_control_clicked", {
              surface: "video_date",
              session_id: id,
              control: "camera",
              next_video_off: !isVideoOff,
            });
            toggleVideo();
          }}
          onLeave={requestEndDateConfirmation}
          isLeaving={isLeavingVideoDate}
          onViewProfile={() => {
            recordUserAction("video_date_control_clicked", {
              surface: "video_date",
              session_id: id,
              control: "view_profile",
            });
            setShowProfileSheet(true);
          }}
          onSafety={
            isConnected && !showFeedback && partnerId
              ? () => {
                  recordUserAction("video_date_control_clicked", {
                    surface: "video_date",
                    session_id: id,
                    control: "safety",
                  });
                  setShowInCallSafety(true);
                }
              : undefined
          }
          onAudioSettings={
            isConnected && !showFeedback &&
              (isSetSinkIdSupported() || isAudioDeviceEnumerationSupported())
              ? () => {
                  recordUserAction("video_date_control_clicked", {
                    surface: "video_date",
                    session_id: id,
                    control: "audio_settings",
                  });
                  setShowAudioOutputPicker(true);
                }
              : undefined
          }
        />
      </div>
      </div>

      <AlertDialog open={showEndDateConfirm} onOpenChange={setShowEndDateConfirm}>
        <AlertDialogContent className="w-[min(calc(100vw-2rem),24rem)] rounded-[1.75rem] border border-white/10 bg-[rgba(12,12,16,0.94)] text-foreground shadow-[0_26px_90px_rgba(0,0,0,0.55)] backdrop-blur-2xl">
          <AlertDialogHeader className="text-center">
            <AlertDialogTitle className="font-display text-xl">End this date?</AlertDialogTitle>
            <AlertDialogDescription className="text-center text-sm leading-relaxed text-muted-foreground">
              Stay if you tapped by accident. Ending will close the call for you.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
            <AlertDialogAction
              className="w-full rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isLeavingVideoDate || isEndDateConfirming}
              onClick={(event) => {
                event.preventDefault();
                void confirmEndDate();
              }}
            >
              {isLeavingVideoDate || isEndDateConfirming ? "Ending..." : "End date"}
            </AlertDialogAction>
            <AlertDialogCancel
              className="mt-0 w-full rounded-full border-white/10 bg-white/[0.06] text-foreground hover:bg-white/[0.1]"
              disabled={isLeavingVideoDate || isEndDateConfirming}
            >
              Stay
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Partner Profile Sheet ─── */}
      <PartnerProfileSheet
        isOpen={showProfileSheet}
        onClose={() => setShowProfileSheet(false)}
        partner={partner}
      />

      {/* ─── Audio Output Picker ─── */}
      <AudioOutputPicker
        isOpen={showAudioOutputPicker}
        onClose={() => setShowAudioOutputPicker(false)}
        remoteMediaElement={remoteVideoRef.current}
        onDeviceChanged={(deviceId) => {
          trackEvent("video_date_audio_output_changed", {
            surface: "video_date",
            session_id: id,
            device_id_kind:
              deviceId === "default"
                ? "default"
                : deviceId === "communications"
                  ? "communications"
                  : "specific",
          });
        }}
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
