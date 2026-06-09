import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
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
import {
  useVideoCall,
  type VideoCallStartFailure,
  type VideoDateMediaPromptIntent,
} from "@/hooks/useVideoCall";
import { useCredits } from "@/hooks/useCredits";
import { useReconnection } from "@/hooks/useReconnection";
import { useVideoDateDupTabGuard } from "@/hooks/useVideoDateDupTabGuard";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { useUserProfile } from "@/contexts/AuthContext";
import { useEventStatus } from "@/hooks/useEventStatus";
import {
  fetchEventDeck,
  type EventDeckFetchResult,
} from "@/hooks/useEventDeck";
import {
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
  supabase,
} from "@/integrations/supabase/client";
import { fetchVideoDateSnapshot } from "@/lib/videoDateSnapshot";
import { resolvePhotoUrl } from "@/lib/photoUtils";
import { ProfilePhoto } from "@/components/ui/ProfilePhoto";
import { trackEvent } from "@/lib/analytics";
import { recordUserAction } from "@/lib/browserDiagnostics";
import { preloadRouteOnIdle } from "@/lib/routePreload";
import { deckCardUrl } from "@/utils/imageUrl";
import { getVideoDateDeckPrefetchItems } from "@clientShared/matching/videoDateDeckPrefetch";
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
  clearVideoDateRouteOwnership,
  isDateEntryTransitionActive,
  isVideoDateRouteOwned,
  markVideoDateEntryPipelineStarted,
  markVideoDateRouteOwned,
  VIDEO_DATE_ROUTE_OWNERSHIP_REFRESH_MS,
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
  mediaPermissionMessage,
  mediaPermissionResultForStatus,
  mediaPermissionTitle,
} from "@clientShared/media/mediaPermissionResult";
import {
  buildVideoDateExtensionIdempotencyKey,
  buildVideoDateMutualExtensionIdempotencyKey,
  buildVideoDateTransitionIdempotencyKey,
} from "@clientShared/matching/videoDateTransitionCommands";
import {
  videoSessionHasEncounterExposureTruth,
  videoSessionHasPostDateSurveyTruth,
  videoSessionRowIndicatesHandshakeOrDate,
} from "@clientShared/matching/activeSession";
import {
  videoDateLifecycleRpcCode,
  videoDateLifecycleRpcIndicatesTerminalStop,
  videoDateLifecycleRpcIndicatesTerminalSurvey,
  videoDateLifecycleRpcRetryable,
} from "@clientShared/matching/videoDateLifecycleRpc";
import { adviseVideoSessionTruthRecovery } from "@clientShared/matching/videoDateRecoveryAdvisor";
import {
  VIDEO_DATE_HANDSHAKE_TRUTH_SELECT,
  handshakeDecisionFailureIndicatesSessionEnded,
  handshakeTruthLogPayload,
  persistHandshakeDecisionWithVerification,
  type VideoDateHandshakeTruth,
} from "@clientShared/matching/videoDateHandshakePersistence";
import {
  resolveVideoDateHandshakeUiState,
  shouldShowVideoDateIceBreaker,
} from "@clientShared/matching/videoDatePhase4Ux";
import {
  createVideoDateSessionChannel,
  resolveVideoDateSessionSeqDecision,
  type VideoDateSessionBroadcastEvent,
} from "@clientShared/matching/videoDateSessionChannel";
import {
  mergeVideoDateBroadcastGapRecovery,
  recordVideoDateBroadcastGapRecoveryFailure,
  recordVideoDateBroadcastGapRecoverySuccess,
  shouldAttemptVideoDateBroadcastGapRecovery,
  shouldRetainVideoDateBroadcastGapRecoveryForEvent,
  videoDateBroadcastGapRetryDelayMs,
  type VideoDateBroadcastGapRecoveryState,
} from "@clientShared/matching/videoDateBroadcastGapRecovery";
import {
  applyVideoDateTimelineSnapshot,
  resolveVideoDateTimelineCountdown,
  type VideoDateTimelineState,
} from "@clientShared/matching/videoDateTimeline";
import {
  clearVideoDatePushPreload,
  readVideoDatePushPreloadTimeline,
} from "@/lib/videoDatePushPreload";
import {
  getVideoDateWarmupChoiceNotice,
  type VideoDateWarmupChoiceNotice,
} from "@clientShared/matching/videoDateWarmupChoiceNotice";
import {
  buildReadyGateToDateLatencyPayload,
  buildVideoDateTimerDriftRecoveredPayload,
  recordReadyGateToDateLatencyCheckpoint,
  type ReadyGateToDateLatencyCheckpoint,
  type VideoDateOperatorOutcome,
} from "@clientShared/observability/videoDateOperatorMetrics";
import {
  VIDEO_DATE_REMOTE_OBJECT_FIT,
  VIDEO_DATE_REMOTE_OBJECT_POSITION,
  videoDateAspectRatio,
} from "@clientShared/matching/videoDateMediaContract";
import type { VideoDateSafetySubmitOutcome } from "@clientShared/safety/videoDateSafetyCopy";

const HANDSHAKE_TIME = 60;
const DATE_TIME = 300;
const MIN_DECISION_WINDOW_AFTER_REMOTE_FRAME_MS = 15_000;

function isoFromTimelineMs(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return new Date(value).toISOString();
}
const WEB_LIFECYCLE_AWAY_GRACE_MS = 12_000;
const VIDEO_DATE_ACCESS_LOADING_WATCHDOG_MS = 8_000;
const VIDEO_DATE_MANUAL_EXIT_CLEANUP_TIMEOUT_MS = 2_500;
const DUPLICATE_TAB_CONFLICT_STABLE_MS = 2_500;
const TERMINAL_SURVEY_RECONCILE_INTERVAL_MS = 2_500;
const TERMINAL_SURVEY_CONFIRM_RETRY_DELAYS_MS = [0, 350, 900, 1_600] as const;
const REMOTE_DATE_VIDEO_CONTAINER_CLASS = "flex-1 relative bg-black";
// Product invariant: remote date video preserves the full encoded camera frame.
// Do not switch this to cover/scale/transform; use a separate decorative layer for cinematic crops.
const REMOTE_DATE_VIDEO_CLASS = "w-full h-full object-contain object-center";

type VideoDateEndReason =
  | "ended_from_client"
  | "partial_join_peer_timeout"
  | "partner_absent_after_confirmed_encounter"
  | "date_timeout";
type VideoDateManualExitStepStatus = "completed" | "failed" | "timed_out";

type WebLifecycleLeaveSource =
  | "beforeunload"
  | "pagehide"
  | "visibilitychange"
  | "freeze";
const WEB_SOFT_LIFECYCLE_LEAVE_SOURCES = new Set<WebLifecycleLeaveSource>([
  "beforeunload",
  "pagehide",
  "visibilitychange",
  "freeze",
]);

function waitForVideoDateRuntimeRecovery(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function normalizedDateExtraSeconds(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw)
    ? Math.max(0, Math.floor(raw))
    : 0;
}

function makeExtensionIdempotencyKey(
  sessionId: string,
  type: "extra_time" | "extended_vibe",
): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return buildVideoDateExtensionIdempotencyKey(sessionId, type, random);
}

function makeMutualExtensionIdempotencyKey(
  sessionId: string,
  type: "extra_time" | "extended_vibe",
): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return buildVideoDateMutualExtensionIdempotencyKey(sessionId, type, random);
}

function serializeManualExitError(
  error: unknown,
): Record<string, unknown> | string {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : String(error);
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
        vdbg("video_date_manual_exit_step", {
          step,
          status: "completed",
          timeoutMs,
        });
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

function messageForRetryableStartFailure(
  failure: VideoCallStartFailure | null,
): string {
  if (!failure)
    return "We’re still connecting your video date. Please try again.";
  if (failure.kind === "network")
    return "Your connection dropped while starting the date. Try again.";
  if (failure.kind === "DAILY_PROVIDER_ERROR") {
    return "The video service is still spinning up. Try again in a moment.";
  }
  if (
    failure.kind === "DAILY_PROVIDER_UNAVAILABLE" ||
    failure.kind === "DAILY_RATE_LIMIT"
  ) {
    return "The video service is still spinning up. Try again in a moment.";
  }
  if (failure.kind === "daily_join_failed") {
    return "We couldn’t finish joining the video room. Try again.";
  }
  if (failure.kind === "daily_call_busy") {
    return "We’re closing the previous video connection. Try again in a moment.";
  }
  if (failure.kind === "start_call_in_flight_failed") {
    return "The previous join attempt did not finish. Try joining again.";
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
  success?: boolean;
  state?: "date" | "ended" | "handshake";
  code?: string | null;
  retryable?: boolean;
  waiting_for_partner?: boolean;
  waiting_for_self?: boolean;
  local_decision_persisted?: boolean;
  partner_decision_persisted?: boolean;
  grace_expires_at?: string;
  seconds_remaining?: number;
  extended?: boolean;
  extension_started_at?: string | null;
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
  participant_1_remote_seen_at?: string | null;
  participant_2_remote_seen_at?: string | null;
};

type TerminalSurveyRegistrationFallbackRow = {
  event_id?: string | null;
  queue_status?: string | null;
  current_room_id?: string | null;
  current_partner_id?: string | null;
  last_active_at?: string | null;
};

const TERMINAL_SURVEY_SESSION_SELECT =
  "participant_1_id, participant_2_id, event_id, daily_room_name, daily_room_url, ended_at, ended_reason, state, phase, handshake_started_at, date_started_at, ready_gate_status, ready_gate_expires_at, participant_1_joined_at, participant_2_joined_at, participant_1_remote_seen_at, participant_2_remote_seen_at";

const TERMINAL_SURVEY_REGISTRATION_FALLBACK_SELECT =
  "event_id, queue_status, current_room_id, current_partner_id, last_active_at";

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
  const isSafari =
    /Safari/i.test(ua) && !/(Chrome|Chromium|CriOS|FxiOS|Edg|OPR)/i.test(ua);
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
  row: {
    ended_at?: string | null;
    state?: string | null;
    phase?: string | null;
  } | null,
): boolean {
  if (!row) return false;
  return Boolean(
    row.ended_at || row.state === "ended" || row.phase === "ended",
  );
}

function shouldOpenPostDateSurveyForTerminalSession(
  row: {
    ended_at?: string | null;
    ended_reason?: string | null;
    date_started_at?: string | null;
    participant_1_joined_at?: string | null;
    participant_2_joined_at?: string | null;
    participant_1_remote_seen_at?: string | null;
    participant_2_remote_seen_at?: string | null;
    state?: string | null;
    phase?: string | null;
  } | null,
  verdict: unknown,
): boolean {
  return videoSessionHasPostDateSurveyTruth(row) && !verdict;
}

const VideoDate = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const { user } = useUserProfile();
  const queryClient = useQueryClient();
  const readyRedirectForceSurveyState =
    location.state && typeof location.state === "object"
      ? (location.state as { forceSurvey?: boolean; source?: string })
      : null;
  const broadcastV2 = useFeatureFlag("video_date.broadcast_v2");
  const timelineV2 = useFeatureFlag("video_date.timeline_v2");
  const continueHandshakeV2 = useFeatureFlag(
    "video_date.outbox_v2.continue_handshake",
  );
  const handshakeAutoPromoteV2 = useFeatureFlag(
    "video_date.outbox_v2.handshake_auto_promote",
  );
  const dateTimeoutV2 = useFeatureFlag("video_date.outbox_v2.date_timeout");
  const extensionV2 = useFeatureFlag("video_date.outbox_v2.extension");
  const extensionMutualV2 = useFeatureFlag("video_date.extension_mutual_v2");
  const safetyV2 = useFeatureFlag("video_date.outbox_v2.safety");
  const safetyAlwaysOnV2 = useFeatureFlag("video_date.safety_always_on_v2");
  const postDateInstantNextV2 = useFeatureFlag(
    "video_date.post_date_instant_next_v2",
  );
  const resilienceV2 = useFeatureFlag("video_date.resilience_v2");
  const dailyTokenRefreshV2 = useFeatureFlag(
    "video_date.daily_token_refresh_v2",
  );
  const pushPayloadV2 = useFeatureFlag("video_date.push_payload_v2");
  const initialPushTimeline = useMemo(
    () => (pushPayloadV2.enabled ? readVideoDatePushPreloadTimeline(id) : null),
    [id, pushPayloadV2.enabled],
  );
  const initialPushCountdown = useMemo(
    () =>
      initialPushTimeline
        ? resolveVideoDateTimelineCountdown(initialPushTimeline)
        : null,
    [initialPushTimeline],
  );

  const [phase, setPhase] = useState<CallPhase>(
    initialPushTimeline?.phase === "date" ? "date" : "handshake",
  );
  /** Server-owned extension seconds (`video_sessions.date_extra_seconds`) for reconciliation after refetch/rejoin. */
  const [dateExtraSeconds, setDateExtraSeconds] = useState(0);
  const [dateStartedAt, setDateStartedAt] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(
    initialPushCountdown?.remainingSeconds ?? null,
  );
  const [videoDateAccess, setVideoDateAccess] =
    useState<VideoDateAccess>("loading");
  const [deniedEventId, setDeniedEventId] = useState<string | undefined>(
    undefined,
  );
  const [timingReady, setTimingReady] = useState(false);
  const [handshakeStartFailed, setHandshakeStartFailed] = useState(false);
  const [handshakeFailureCode, setHandshakeFailureCode] = useState<
    string | undefined
  >(undefined);
  const [blurAmount, setBlurAmount] = useState(20);
  const [showFeedback, setShowFeedback] = useState(false);
  const [terminalSurveyRecoveryActive, setTerminalSurveyRecoveryActive] =
    useState(false);
  const [callStarted, setCallStarted] = useState(false);
  const [callStartFailure, setCallStartFailure] =
    useState<VideoCallStartFailure | null>(null);
  const [showProfileSheet, setShowProfileSheet] = useState(false);
  const [showAudioOutputPicker, setShowAudioOutputPicker] = useState(false);
  const [showIceBreaker, setShowIceBreaker] = useState(true);
  const [showMutualToast, setShowMutualToast] = useState(false);
  const [pendingPartnerExtension, setPendingPartnerExtension] = useState<{
    type: "extra_time" | "extended_vibe";
    expiresAt: string | null;
  } | null>(null);
  const [showInCallSafety, setShowInCallSafety] = useState(false);
  const [safetySubmitOutcome, setSafetySubmitOutcome] =
    useState<VideoDateSafetySubmitOutcome | null>(null);
  const [showEndDateConfirm, setShowEndDateConfirm] = useState(false);
  const [isEndDateConfirming, setIsEndDateConfirming] = useState(false);
  const [isLeavingVideoDate, setIsLeavingVideoDate] = useState(false);
  const [handshakeStartedAt, setHandshakeStartedAt] = useState<string | null>(
    null,
  );
  const [handshakeTruth, setHandshakeTruth] =
    useState<VideoDateHandshakeTruth | null>(null);
  const [serverTimeline, setServerTimeline] =
    useState<VideoDateTimelineState | null>(initialPushTimeline);
  const [timingRefreshNonce, setTimingRefreshNonce] = useState(0);
  const [isParticipant1, setIsParticipant1] = useState(false);
  const [partnerId, setPartnerId] = useState<string>("");
  const [eventId, setEventId] = useState<string | undefined>(undefined);
  const [partnerPhotoUrl, setPartnerPhotoUrl] = useState<string | null>(null);
  const [remoteFrameSnapshotUrl, setRemoteFrameSnapshotUrl] = useState<
    string | null
  >(null);
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
  const routeMountIdRef = useRef(`vd-web-route-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
  const eventIdRef = useRef<string | undefined>(undefined);
  const handshakeCompletionInFlightRef = useRef(false);
  const handshakeDecisionInFlightRef = useRef(false);
  const handshakeCompletionDeadlineKeyRef = useRef<string | null>(null);
  const handshakeCompletionRetryTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const checkMutualVibeRef = useRef<
    ((source?: string, allowRetry?: boolean) => void) | null
  >(null);
  const firstRemoteFrameAtMsRef = useRef<number | null>(null);
  // Canonical Daily room name loaded from video_sessions; used for safe beforeunload cleanup.
  const canonicalRoomNameRef = useRef<string | null>(null);
  const hasEnteredDateFlowRef = useRef(false);
  const surveyOpenedRef = useRef(false);
  const terminalSurveyRecoveryInFlightRef = useRef(false);
  const loggedJourneyRef = useRef<Set<string>>(new Set());
  const extensionSpendInFlightRef = useRef(false);
  const extensionSpendRetryRef = useRef<{
    type: "extra_time" | "extended_vibe";
    key: string;
    mutual: boolean;
  } | null>(null);
  const dailyReconnectPerformanceStartedAtRef = useRef<number | null>(null);
  const dailyReconnectPerformanceSourceRef = useRef<string | null>(null);
  const postDatePrestageKeyRef = useRef<string | null>(null);
  const resilienceModeTrackedKeyRef = useRef<string | null>(null);
  const extensionBroadcastSeenRef = useRef<Set<number>>(new Set());
  const explicitEndRequestedRef = useRef<"idle" | "sending" | "acked">("idle");
  const leaveSignalTokenRef = useRef<string | null>(null);
  const leaveSignalSentRef = useRef(false);
  const lifecycleHiddenStartedAtRef = useRef<number | null>(null);
  const foregroundReconcileInFlightRef = useRef(false);
  const lastForegroundReconcileAtRef = useRef(0);
  const accessLoadingWatchdogKeyRef = useRef<string | null>(null);
  const videoJoinCycleRef = useRef(0);
  const nextVideoDateMediaPromptIntentRef =
    useRef<VideoDateMediaPromptIntent>("auto");
  const videoJoinOutcomeByCycleRef = useRef(new Set<number>());
  const lastRemoteLayoutDiagnosticKeyRef = useRef<string | null>(null);
  const manualExitInFlightRef = useRef(false);
  const sessionSeqRef = useRef<number | null>(null);
  const broadcastRefetchInFlightRef = useRef(false);
  const broadcastPendingRefetchSeqRef = useRef<number | null>(null);
  const broadcastGapRecoveryRef =
    useRef<VideoDateBroadcastGapRecoveryState | null>(null);
  const broadcastGapRetryTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const attemptBroadcastGapSnapshotRecoveryRef = useRef<
    (source: string) => void
  >(() => {});
  const serverTimelineRef = useRef<VideoDateTimelineState | null>(null);
  const terminalDailyStopRef = useRef<((reason: string) => void) | null>(null);
  const terminalDailyStopRequestedRef = useRef(false);
  const postEncounterPeerMissingSuppressedRef = useRef<string | null>(null);
  /** Set after `handleCallEnd` is defined — avoids TDZ when `handleHandshakeDecision` closes over end UX. */
  const handleCallEndRef = useRef<
    ((reason?: VideoDateEndReason) => Promise<void>) | null
  >(null);

  const clearHandshakeGraceState = useCallback(() => {}, []);

  const { credits, refetch: refetchCredits } = useCredits();
  const { setStatus } = useEventStatus({ eventId });

  useEffect(() => {
    setSafetySubmitOutcome(null);
  }, [id, partnerId]);

  const markDateFlowEntered = useCallback(() => {
    hasEnteredDateFlowRef.current = true;
  }, []);

  const logJourney = useCallback(
    (
      event: VideoDateJourneyEvent,
      payload?: Record<string, unknown>,
      dedupeKey?: string,
    ) => {
      const key = dedupeKey ?? event;
      if (loggedJourneyRef.current.has(key)) return;
      loggedJourneyRef.current.add(key);
      trackEvent(getVideoDateJourneyEventName(event), {
        platform: "web",
        session_id: id,
        event_id: eventId,
        ...(payload ?? {}),
      });
      vdbg(`journey_${event}`, {
        sessionId: id ?? null,
        eventId: eventId ?? null,
        ...(payload ?? {}),
      });
    },
    [id, eventId],
  );

  const enterTerminalSurveyHardStop = useCallback(
    (reason: string) => {
      terminalSurveyRecoveryInFlightRef.current = true;
      setTerminalSurveyRecoveryActive(true);
      if (id) markVideoDateRouteOwned(id, user?.id ?? null);
      const stopDailyForTerminal = terminalDailyStopRef.current;
      if (!terminalDailyStopRequestedRef.current && stopDailyForTerminal) {
        terminalDailyStopRequestedRef.current = true;
        stopDailyForTerminal(reason);
      }
      clearHandshakeGraceState();
      setPhase("ended");
      setTimeLeft(0);
      setVideoDateAccess("allowed");
      setTimingReady(true);
      setCallStarted(false);
      setCallStartFailure(null);
      setStatus("in_survey");
      vdbg("terminal_survey_recovery_hard_stop", {
        sessionId: id ?? null,
        userId: user?.id ?? null,
        eventId: eventId ?? null,
        reason,
      });
    },
    [clearHandshakeGraceState, eventId, id, setStatus, user?.id],
  );

  const openPostDateSurvey = useCallback(
    (reason: string) => {
      if (surveyOpenedRef.current) return false;
      surveyOpenedRef.current = true;
      enterTerminalSurveyHardStop(reason);
      setShowFeedback(true);
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
        logJourney(
          "survey_recovered",
          { reason },
          `survey_recovered_${reason}`,
        );
      }
      return true;
    },
    [enterTerminalSurveyHardStop, id, eventId, logJourney],
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
      const resolvedPartnerId = isP1
        ? sessionRow.participant_2_id
        : sessionRow.participant_1_id;
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
    async (
      source: string,
      sessionOverride?: TerminalSurveySessionRow | null,
    ) => {
      if (!id || !user?.id) return false;
      const sessionResult = sessionOverride
        ? { data: sessionOverride, error: null }
        : await supabase
            .from("video_sessions")
            .select(TERMINAL_SURVEY_SESSION_SELECT)
            .eq("id", id)
            .maybeSingle();
      if (sessionResult.error) {
        captureSupabaseError(
          "terminal_post_date_survey_session_fetch_failed",
          sessionResult.error,
        );
        recordUserAction("terminal_post_date_survey_session_fetch_failed", {
          surface: "video_date",
          session_id: id,
          user_id: user.id,
          source,
          code: sessionResult.error.code,
        });
        vdbg("terminal_post_date_survey_session_fetch_failed", {
          sessionId: id,
          userId: user.id,
          source,
          code: sessionResult.error.code,
          message: sessionResult.error.message,
        });
        const { data: registrationFallback, error: registrationError } =
          await supabase
            .from("event_registrations")
            .select(TERMINAL_SURVEY_REGISTRATION_FALLBACK_SELECT)
            .eq("profile_id", user.id)
            .eq("queue_status", "in_survey")
            .order("last_active_at", { ascending: false })
            .limit(1)
            .maybeSingle();
        if (registrationError) {
          captureSupabaseError(
            "terminal_post_date_survey_registration_fallback_failed",
            registrationError,
          );
          recordUserAction(
            "terminal_post_date_survey_registration_fallback_failed",
            {
              surface: "video_date",
              session_id: id,
              user_id: user.id,
              source,
              code: registrationError.code,
            },
          );
          vdbg("terminal_post_date_survey_registration_fallback_failed", {
            sessionId: id,
            userId: user.id,
            source,
            code: registrationError.code,
            message: registrationError.message,
          });
          return false;
        }
        const fallbackRow =
          (registrationFallback as TerminalSurveyRegistrationFallbackRow | null) ??
          null;
        const fallbackMatchesCurrentRoute =
          fallbackRow?.current_room_id == null ||
          fallbackRow.current_room_id === id;
        if (
          fallbackRow?.queue_status === "in_survey" &&
          fallbackMatchesCurrentRoute
        ) {
          if (fallbackRow.event_id) setEventId(fallbackRow.event_id);
          if (fallbackRow.current_partner_id) {
            setPartnerId(fallbackRow.current_partner_id);
          }
          setVideoDateAccess("allowed");
          setTimingReady(true);
          setCallStarted(false);
          setCallStartFailure(null);
          setStatus("in_survey");
          vdbg("terminal_post_date_survey_registration_fallback", {
            sessionId: id,
            userId: user.id,
            source,
            eventId: fallbackRow.event_id ?? null,
            currentRoomId: fallbackRow.current_room_id ?? null,
            currentPartnerId: fallbackRow.current_partner_id ?? null,
            lastActiveAt: fallbackRow.last_active_at ?? null,
          });
          openPostDateSurvey(`${source}_registration_recovery`);
          return true;
        }
        return false;
      }
      const sessionRow = sessionResult.data;

      if (!sessionRow) {
        setVideoDateAccess("not_found");
        return true;
      }

      if (!videoSessionIndicatesTerminalEnd(sessionRow)) {
        return false;
      }

      const hasPostDateSurveyTruth =
        videoSessionHasPostDateSurveyTruth(sessionRow);
      if (hasPostDateSurveyTruth) {
        enterTerminalSurveyHardStop(source);
        hydrateTerminalSurveyContext(sessionRow, source);
      }

      let verdict: { id?: string | null } | null = null;
      const { data: verdictData, error: verdictError } = await supabase
        .from("date_feedback")
        .select("id")
        .eq("session_id", id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (verdictError) {
        captureSupabaseError(
          "terminal_post_date_survey_verdict_fetch_failed",
          verdictError,
        );
        recordUserAction("terminal_post_date_survey_verdict_fetch_failed", {
          surface: "video_date",
          session_id: id,
          user_id: user.id,
          source,
          code: verdictError.code,
        });
        vdbg("terminal_post_date_survey_verdict_fetch_failed", {
          sessionId: id,
          userId: user.id,
          source,
          code: verdictError.code,
          message: verdictError.message,
        });
        if (!hasPostDateSurveyTruth) {
          return false;
        }
      } else {
        verdict = verdictData ?? null;
      }
      const verdictFetchFailed = Boolean(verdictError);

      const shouldOpenSurvey = shouldOpenPostDateSurveyForTerminalSession(
        sessionRow,
        verdict,
      );
      vdbg("terminal_post_date_survey_recovery_checked", {
        sessionId: id,
        userId: user.id,
        source,
        shouldOpenSurvey,
        hardStopApplied: hasPostDateSurveyTruth,
        verdictFetchFailed,
        verdictId: verdict?.id ?? null,
        endedAt: sessionRow.ended_at ?? null,
        endedReason: sessionRow.ended_reason ?? null,
        state: sessionRow.state ?? null,
        phase: sessionRow.phase ?? null,
        participant1Joined: Boolean(sessionRow.participant_1_joined_at),
        participant2Joined: Boolean(sessionRow.participant_2_joined_at),
        participant1RemoteSeen: Boolean(
          sessionRow.participant_1_remote_seen_at,
        ),
        participant2RemoteSeen: Boolean(
          sessionRow.participant_2_remote_seen_at,
        ),
      });

      if (shouldOpenSurvey || (hasPostDateSurveyTruth && verdictFetchFailed)) {
        hydrateTerminalSurveyContext(sessionRow, source);
        openPostDateSurvey(source);
        return true;
      }

      clearHandshakeGraceState();
      terminalSurveyRecoveryInFlightRef.current = false;
      setTerminalSurveyRecoveryActive(false);
      setPhase("ended");
      setTimeLeft(0);
      setShowFeedback(false);
      const target = sessionRow.event_id
        ? `/event/${encodeURIComponent(sessionRow.event_id)}/lobby`
        : "/events";
      clearDateEntryTransition(id);
      clearVideoDateRouteOwnership(id, user.id);
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
      enterTerminalSurveyHardStop,
      hydrateTerminalSurveyContext,
      id,
      navigate,
      openPostDateSurvey,
      setStatus,
      user?.id,
    ],
  );

  const recoverLifecycleRpcTerminalSurvey = useCallback(
    async (source: string, payload: unknown) => {
      const rpcPayload =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : null;
      if (!videoDateLifecycleRpcIndicatesTerminalSurvey(rpcPayload)) {
        return false;
      }
      return recoverTerminalPostDateSurvey(source);
    },
    [recoverTerminalPostDateSurvey],
  );

  const recoverFromNotStartableDateTruth = useCallback(
    async (source: string) => {
      if (!id || !user?.id) return false;
      const [vsRes, regRes] = await Promise.all([
        supabase
          .from("video_sessions")
          .select(
            "event_id, ended_at, ended_reason, state, phase, handshake_started_at, date_started_at, ready_gate_status, ready_gate_expires_at, daily_room_name, daily_room_url",
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
      const recovery = adviseVideoSessionTruthRecovery({
        sessionId: id,
        eventId,
        truth: vs,
        platform: "web",
        surface: "video_date",
      });
      const decision = recovery.routeDecision ?? "stay_lobby";
      const canAttemptDaily = recovery.canAttemptDaily === true;
      const reason =
        recovery.action === "go_date"
          ? null
          : recovery.action === "show_terminal" ||
              recovery.action === "go_survey"
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
        dateRouteOwned: isVideoDateRouteOwned(id, user.id),
      });

      if (
        isVideoDateRouteOwned(id, user.id) &&
        !canAttemptDaily &&
        (recovery.action === "go_ready_gate" || recovery.action === "go_lobby")
      ) {
        vdbg("date_route_bounce_suppressed_by_route_ownership", {
          sessionId: id,
          userId: user.id,
          source,
          action: recovery.action,
          queueStatus: reg?.queue_status ?? null,
          currentRoomId: reg?.current_room_id ?? null,
          vsState: vs?.state ?? null,
          vsPhase: vs?.phase ?? null,
          readyGateStatus: vs?.ready_gate_status ?? null,
        });
        setVideoDateAccess("allowed");
        return false;
      }

      if (!canAttemptDaily && recovery.action === "go_ready_gate") {
        const target = `/ready/${encodeURIComponent(id)}`;
        clearDateEntryTransition(id);
        logJourney(
          "date_route_bounced",
          { reason: source, target },
          `date_route_bounced_${source}`,
        );
        vdbgRedirect(target, source, { sessionId: id, userId: user.id });
        navigate(target, { replace: true });
        return true;
      }

      const fallbackEventId = vs?.event_id ?? eventId;
      if (
        !canAttemptDaily &&
        recovery.action === "go_lobby" &&
        fallbackEventId
      ) {
        const target = `/event/${encodeURIComponent(fallbackEventId)}/lobby`;
        clearDateEntryTransition(id);
        logJourney(
          "date_route_bounced",
          { reason: source, target },
          `date_route_bounced_${source}`,
        );
        vdbgRedirect(target, source, {
          sessionId: id,
          userId: user.id,
          eventId: fallbackEventId,
        });
        navigate(target, { replace: true });
        return true;
      }

      if (
        recovery.action === "show_terminal" ||
        recovery.action === "go_survey"
      ) {
        return recoverTerminalPostDateSurvey(`${source}_ended_truth`);
      }

      return false;
    },
    [
      eventId,
      id,
      logJourney,
      navigate,
      recoverTerminalPostDateSurvey,
      user?.id,
    ],
  );

  const recoverFromEndedSessionTruth = recoverTerminalPostDateSurvey;

  const {
    isConnecting,
    isConnected,
    isMuted,
    isVideoOff,
    mediaPermissionError,
    mediaPermissionResult,
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
    dailyMeetingState,
    localInDailyRoom,
    reconnectGraceTimeLeft,
    captureProfile,
  } = useVideoCall({
    roomId: id,
    userId: user?.id,
    eventId,
    resilienceV2: resilienceV2.enabled,
    dailyTokenRefreshV2: dailyTokenRefreshV2.enabled,
    dailyCallSingletonEligible:
      !showFeedback &&
      !terminalSurveyRecoveryActive &&
      phase !== "ended" &&
      (videoDateAccess === "allowed" ||
        phase === "handshake" ||
        phase === "date" ||
        Boolean(dateStartedAt) ||
        videoSessionHasEncounterExposureTruth(handshakeTruth)),
    videoSessionState: phase,
    localDecisionPersisted: Boolean(
      handshakeTruth &&
      user?.id &&
      ((handshakeTruth.participant_1_id === user.id &&
        handshakeTruth.participant_1_decided_at) ||
        (handshakeTruth.participant_2_id === user.id &&
          handshakeTruth.participant_2_decided_at)),
    ),
    onCallEnded: () => {
      Sentry.addBreadcrumb({
        category: "video-date",
        message: "Call ended",
        level: "info",
      });
    },
    onPartnerJoined: () => {
      Sentry.addBreadcrumb({
        category: "video-date",
        message: "Partner connected",
        level: "info",
      });
    },
    onPartnerLeft: () => {
      if (
        phaseRef.current === "ended" ||
        surveyOpenedRef.current ||
        terminalSurveyRecoveryInFlightRef.current
      )
        return;
      reconnection.startGraceWindow();
    },
    onPartnerTransientDisconnect: () => {
      toast("Connection softened. Reconnecting...", { duration: 2500 });
    },
    onPartnerTransientRecover: () => {
      toast("Connection restored", { duration: 1800 });
    },
    onTerminalSurveyTruth: (source) => {
      void recoverTerminalPostDateSurvey(source);
    },
  });

  useEffect(() => {
    terminalDailyStopRequestedRef.current = false;
  }, [id]);

  useEffect(() => {
    const stopDailyForTerminal = (reason: string) => {
      void endCall(`terminal_survey_hard_stop:${reason}`);
    };
    terminalDailyStopRef.current = stopDailyForTerminal;
    if (
      terminalSurveyRecoveryInFlightRef.current &&
      !terminalDailyStopRequestedRef.current
    ) {
      terminalDailyStopRequestedRef.current = true;
      stopDailyForTerminal("terminal_survey_ref_attached");
    }
    return () => {
      terminalDailyStopRef.current = null;
    };
  }, [endCall]);

  useEffect(() => {
    firstRemoteFrameAtMsRef.current = null;
  }, [id]);

  useEffect(() => {
    if (!remotePlayback.firstFrameRendered) {
      firstRemoteFrameAtMsRef.current = null;
      return;
    }
    if (firstRemoteFrameAtMsRef.current == null) {
      firstRemoteFrameAtMsRef.current = Date.now();
    }
  }, [remotePlayback.firstFrameRendered]);

  const videoDateSurfaceClaimable =
    phase === "date" ||
    Boolean(dateStartedAt) ||
    Boolean(handshakeStartedAt) ||
    handshakeTruth?.state === "date" ||
    handshakeTruth?.phase === "date" ||
    Boolean(handshakeTruth?.date_started_at) ||
    Boolean(handshakeTruth?.handshake_started_at) ||
    serverTimeline?.phase === "date" ||
    (serverTimeline?.phase === "handshake" &&
      serverTimeline.phaseStartedAtMs !== null);
  const videoDateSurfaceLeaseActive =
    videoDateAccess === "allowed" &&
    videoDateSurfaceClaimable &&
    !showFeedback &&
    !terminalSurveyRecoveryActive &&
    phase !== "ended";
  const shouldBridgeVideoDateSurfaceOnCleanup = useCallback(
    () =>
      videoDateSurfaceLeaseActive &&
      !manualExitInFlightRef.current &&
      !terminalSurveyRecoveryInFlightRef.current &&
      !surveyOpenedRef.current &&
      explicitEndRequestedRef.current === "idle" &&
      phaseRef.current !== "ended",
    [videoDateSurfaceLeaseActive],
  );
  const { dupBlocked, takeOver } = useVideoDateDupTabGuard(
    id,
    user?.id,
    videoDateSurfaceLeaseActive,
    shouldBridgeVideoDateSurfaceOnCleanup,
  );
  const [showDuplicateTabConflict, setShowDuplicateTabConflict] =
    useState(false);

  const reconnection = useReconnection({
    sessionId:
      videoDateAccess === "allowed" &&
      !terminalSurveyRecoveryActive &&
      !terminalSurveyRecoveryInFlightRef.current
        ? id
        : undefined,
    isConnected,
    phase,
    onReconnected: () => {
      toast("They're back! 💚", { duration: 2000 });
    },
    onGraceExpired: () => {
      if (terminalSurveyRecoveryInFlightRef.current || surveyOpenedRef.current)
        return;
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

  const captureRemoteFrameSnapshot = useCallback(
    (source: string) => {
      if (!resilienceV2.enabled) return;
      const videoEl = remoteVideoRef.current;
      if (
        !videoEl ||
        videoEl.readyState < 2 ||
        videoEl.videoWidth <= 0 ||
        videoEl.videoHeight <= 0
      )
        return;

      try {
        const maxWidth = 480;
        const scale = Math.min(1, maxWidth / videoEl.videoWidth);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(videoEl.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(videoEl.videoHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) return;
        context.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        const snapshotUrl = canvas.toDataURL("image/jpeg", 0.72);
        setRemoteFrameSnapshotUrl(snapshotUrl);
        vdbg("video_date_resilience_last_frame_snapshot", {
          sessionId: id ?? null,
          eventId: eventId ?? null,
          source,
          width: canvas.width,
          height: canvas.height,
        });
        trackEvent("video_date_resilience_last_frame_snapshot", {
          platform: "web",
          session_id: id ?? null,
          event_id: eventId ?? null,
          source,
          width: canvas.width,
          height: canvas.height,
        });
      } catch (error) {
        vdbg("video_date_resilience_last_frame_snapshot_failed", {
          sessionId: id ?? null,
          eventId: eventId ?? null,
          source,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [eventId, id, remoteVideoRef, resilienceV2.enabled],
  );

  useEffect(() => {
    if (!isConnected || showFeedback) {
      if (remoteBackdropVideoRef.current?.srcObject) {
        remoteBackdropVideoRef.current.srcObject = null;
      }
      return;
    }
    syncRemoteBackdropVideo("connected_effect");
    const intervalId = window.setInterval(
      () => syncRemoteBackdropVideo("connected_interval"),
      1_000,
    );
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
      const stream =
        videoEl.srcObject instanceof MediaStream ? videoEl.srcObject : null;
      const videoTrack = stream?.getVideoTracks()[0] ?? null;
      const trackSettings =
        videoTrack && typeof videoTrack.getSettings === "function"
          ? videoTrack.getSettings()
          : null;
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
        video_intrinsic_aspect_ratio: videoDateAspectRatio(
          videoEl.videoWidth,
          videoEl.videoHeight,
        ),
        rendered_rect_width: Math.round(videoRect.width),
        rendered_rect_height: Math.round(videoRect.height),
        rendered_rect_aspect_ratio: videoDateAspectRatio(
          videoRect.width,
          videoRect.height,
        ),
        container_rect_width: Math.round(containerRect.width),
        container_rect_height: Math.round(containerRect.height),
        container_rect_aspect_ratio: videoDateAspectRatio(
          containerRect.width,
          containerRect.height,
        ),
        receiver_object_fit: computed.objectFit,
        receiver_object_position: computed.objectPosition,
        receiver_transform: computed.transform,
        track_width: trackSettings?.width ?? null,
        track_height: trackSettings?.height ?? null,
        track_aspect_ratio: videoDateAspectRatio(
          trackSettings?.width,
          trackSettings?.height,
        ),
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
          aspectRatio: videoDateAspectRatio(
            videoEl.videoWidth,
            videoEl.videoHeight,
          ),
        },
        renderedRect: {
          width: Math.round(videoRect.width),
          height: Math.round(videoRect.height),
          aspectRatio: videoDateAspectRatio(videoRect.width, videoRect.height),
        },
        containerRect: {
          width: Math.round(containerRect.width),
          height: Math.round(containerRect.height),
          aspectRatio: videoDateAspectRatio(
            containerRect.width,
            containerRect.height,
          ),
        },
        css: {
          objectFit: computed.objectFit,
          objectPosition: computed.objectPosition,
          transform: computed.transform,
        },
        trackSettings,
        trackAspectRatio: videoDateAspectRatio(
          trackSettings?.width,
          trackSettings?.height,
        ),
        videoTrackId: videoTrack?.id ?? null,
        browser: summarizeWebVideoDateRuntime(),
      });
      trackEvent(
        LobbyPostDateEvents.VIDEO_DATE_RECEIVER_LAYOUT_DIAGNOSTIC,
        diagnosticPayload,
      );
    },
    [
      captureProfile,
      eventId,
      id,
      phase,
      remoteVideoRef,
      syncRemoteBackdropVideo,
    ],
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
    sessionIdRef.current = id;
    sessionSeqRef.current = null;
    broadcastRefetchInFlightRef.current = false;
    broadcastPendingRefetchSeqRef.current = null;
    serverTimelineRef.current = initialPushTimeline;
    dailyReconnectPerformanceStartedAtRef.current = null;
    dailyReconnectPerformanceSourceRef.current = null;
    extensionBroadcastSeenRef.current.clear();
    setPendingPartnerExtension(null);
    setServerTimeline(initialPushTimeline);
    setPhase(initialPushTimeline?.phase === "date" ? "date" : "handshake");
    setTimeLeft(initialPushCountdown?.remainingSeconds ?? null);
  }, [id, initialPushCountdown, initialPushTimeline]);

  useEffect(() => {
    if (initialPushTimeline) clearVideoDatePushPreload(id);
  }, [id, initialPushTimeline]);

  useEffect(() => {
    if (!pendingPartnerExtension?.expiresAt) return;
    const expiresMs = new Date(pendingPartnerExtension.expiresAt).getTime();
    if (!Number.isFinite(expiresMs)) return;
    const delayMs = expiresMs - Date.now();
    if (delayMs <= 0) {
      setPendingPartnerExtension(null);
      return;
    }
    const timeout = window.setTimeout(() => {
      setPendingPartnerExtension((current) =>
        current?.expiresAt === pendingPartnerExtension.expiresAt
          ? null
          : current,
      );
    }, delayMs + 250);
    return () => window.clearTimeout(timeout);
  }, [pendingPartnerExtension?.expiresAt]);

  useEffect(() => {
    serverTimelineRef.current = serverTimeline;
  }, [serverTimeline]);

  useEffect(() => {
    if (
      typeof handshakeTruth?.session_seq === "number" &&
      Number.isFinite(handshakeTruth.session_seq)
    ) {
      sessionSeqRef.current = handshakeTruth.session_seq;
    }
  }, [handshakeTruth?.session_seq]);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (mounted)
        leaveSignalTokenRef.current = data.session?.access_token ?? null;
    });
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        leaveSignalTokenRef.current = session?.access_token ?? null;
      },
    );
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
    (
      correctedTimeLeftSeconds: number,
      recoverySource: "session_reload" | "realtime" | "foreground_reconcile",
    ) => {
      if (timelineV2.enabled) return;
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
    [id, timelineV2.enabled],
  );

  const trackDailyPerformanceCheckpoint = useCallback(
    ({
      checkpoint,
      sourceAction,
      outcome,
      reasonCode,
      durationMs,
      extra,
    }: {
      checkpoint: ReadyGateToDateLatencyCheckpoint;
      sourceAction: string;
      outcome: VideoDateOperatorOutcome;
      reasonCode?: string | null;
      durationMs?: number | null;
      extra?: Record<string, string | number | boolean | null | undefined>;
    }) => {
      if (!id) return;
      const context = recordReadyGateToDateLatencyCheckpoint({
        sessionId: id,
        platform: "web",
        eventId: eventId ?? null,
        sourceSurface: "video_date_daily_performance",
        checkpoint,
      });
      trackEvent(
        LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
        buildReadyGateToDateLatencyPayload({
          context,
          checkpoint,
          sourceAction,
          outcome,
          reasonCode,
          durationMs,
          extra,
        }),
      );
    },
    [eventId, id],
  );

  useEffect(() => {
    if (!id || showFeedback || phase === "ended") {
      dailyReconnectPerformanceStartedAtRef.current = null;
      dailyReconnectPerformanceSourceRef.current = null;
      return;
    }

    const isReconnectActive =
      dailyReconnectState === "interrupted" ||
      dailyReconnectState === "partner_reconnecting" ||
      dailyReconnectState === "partner_left_grace";

    if (
      isReconnectActive &&
      dailyReconnectPerformanceStartedAtRef.current === null
    ) {
      const startedAt = Date.now();
      dailyReconnectPerformanceStartedAtRef.current = startedAt;
      dailyReconnectPerformanceSourceRef.current = dailyReconnectState;
      trackDailyPerformanceCheckpoint({
        checkpoint: "daily_reconnect_started",
        sourceAction: "daily_reconnect_started",
        outcome: "success",
        extra: {
          daily_performance_segment: "daily_reconnect",
          reconnect_source: dailyReconnectState,
        },
      });
      return;
    }

    const startedAt = dailyReconnectPerformanceStartedAtRef.current;
    if (startedAt === null) return;

    if (
      dailyReconnectState === "recovered" ||
      dailyReconnectState === "connected"
    ) {
      const durationMs = Math.max(0, Date.now() - startedAt);
      const reconnectSource =
        dailyReconnectPerformanceSourceRef.current ?? dailyReconnectState;
      dailyReconnectPerformanceStartedAtRef.current = null;
      dailyReconnectPerformanceSourceRef.current = null;
      trackDailyPerformanceCheckpoint({
        checkpoint: "daily_reconnect_success",
        sourceAction: "daily_reconnect_success",
        outcome: "success",
        durationMs,
        extra: {
          daily_performance_segment: "daily_reconnect",
          daily_reconnect_ms: durationMs,
          reconnect_source: reconnectSource,
        },
      });
      return;
    }

    if (dailyReconnectState === "failed_after_grace") {
      const durationMs = Math.max(0, Date.now() - startedAt);
      const reconnectSource =
        dailyReconnectPerformanceSourceRef.current ?? dailyReconnectState;
      dailyReconnectPerformanceStartedAtRef.current = null;
      dailyReconnectPerformanceSourceRef.current = null;
      trackDailyPerformanceCheckpoint({
        checkpoint: "daily_reconnect_failure",
        sourceAction: "daily_reconnect_failure",
        outcome: "failure",
        reasonCode: "failed_after_grace",
        durationMs,
        extra: {
          daily_performance_segment: "daily_reconnect",
          daily_reconnect_ms: durationMs,
          reconnect_source: reconnectSource,
        },
      });
    }
  }, [
    dailyReconnectState,
    id,
    phase,
    showFeedback,
    trackDailyPerformanceCheckpoint,
  ]);

  useEffect(() => {
    if (
      !postDateInstantNextV2.enabled ||
      !id ||
      showFeedback ||
      phase !== "date"
    )
      return;
    if ((timeLeft ?? Number.POSITIVE_INFINITY) > 30) return;
    if (postDatePrestageKeyRef.current === id) return;
    postDatePrestageKeyRef.current = id;
    preloadRouteOnIdle("eventLobby");
    if (eventId && user?.id) {
      const queryKey = ["event-deck", eventId, user.id, "deck_v3"] as const;
      void queryClient
        .prefetchQuery({
          queryKey,
          queryFn: () => fetchEventDeck(eventId, user.id),
          staleTime: 10_000,
        })
        .then(() => {
          if (typeof window === "undefined") return;
          const profiles =
            queryClient.getQueryData<EventDeckFetchResult>(queryKey)
              ?.profiles ?? [];
          for (const item of getVideoDateDeckPrefetchItems(profiles)) {
            const src = deckCardUrl(item.source);
            if (!src) continue;
            const image = new Image();
            image.decoding = "async";
            image.src = src;
          }
        })
        .catch(() => undefined);
    }
    trackEvent("post_date_survey_prestaged", {
      platform: "web",
      session_id: id,
      event_id: eventId ?? null,
      remaining_seconds: timeLeft ?? null,
    });
  }, [
    eventId,
    id,
    phase,
    postDateInstantNextV2.enabled,
    queryClient,
    showFeedback,
    timeLeft,
    user?.id,
  ]);

  useEffect(() => {
    if (!resilienceV2.enabled || !id || showFeedback || networkTier === "good")
      return;
    const key = `${id}:${networkTier}`;
    if (resilienceModeTrackedKeyRef.current === key) return;
    resilienceModeTrackedKeyRef.current = key;
    trackEvent("video_date_resilience_low_quality_mode", {
      platform: "web",
      session_id: id,
      event_id: eventId ?? null,
      network_tier: networkTier,
      adaptation: "ui_and_daily_capability_checked",
    });
  }, [eventId, id, networkTier, resilienceV2.enabled, showFeedback]);

  const applyTimelineSnapshot = useCallback(
    (
      snapshot: Awaited<ReturnType<typeof fetchVideoDateSnapshot>>,
      source: string,
    ) => {
      if (!timelineV2.enabled) return null;
      const decision = applyVideoDateTimelineSnapshot(
        snapshot,
        serverTimelineRef.current,
        {
          clientNowMs: Date.now(),
          expectedSessionId: id,
        },
      );
      if (decision.action !== "accepted") return decision;

      const timeline = decision.timeline;
      if (
        sessionSeqRef.current !== null &&
        timeline.seq < sessionSeqRef.current
      ) {
        return {
          action: "stale",
          timeline: serverTimelineRef.current,
          reason: "snapshot_seq_behind_cursor",
        };
      }
      serverTimelineRef.current = timeline;
      setServerTimeline(timeline);
      if (timeline.eventId) setEventId(timeline.eventId);
      sessionSeqRef.current = Math.max(
        sessionSeqRef.current ?? 0,
        timeline.seq,
      );

      const countdown = resolveVideoDateTimelineCountdown(timeline);
      if (timeline.phase === "handshake" || timeline.phase === "date") {
        setPhase(timeline.phase);
        setTimeLeft(countdown.remainingSeconds ?? 0);
        const startedIso = isoFromTimelineMs(timeline.phaseStartedAtMs);
        if (timeline.phase === "handshake") {
          setHandshakeStartedAt(startedIso);
          setDateStartedAt(null);
        } else {
          setHandshakeStartedAt(null);
          setDateStartedAt(startedIso);
        }
      } else if (timeline.phase === "ended") {
        setPhase("ended");
        setTimeLeft(0);
      }

      vdbg("video_date_timeline_snapshot_applied", {
        sessionId: timeline.sessionId,
        eventId: timeline.eventId,
        source,
        phase: timeline.phase,
        seq: timeline.seq,
        clockSkewMs: timeline.clockSkewMs,
        phaseDeadlineAtMs: timeline.phaseDeadlineAtMs,
      });
      return decision;
    },
    [id, timelineV2.enabled],
  );

  const confirmTerminalPostDateSurveyFromServerTruth = useCallback(
    async (source: string) => {
      if (!id || !user?.id) return false;
      for (
        let attempt = 0;
        attempt < TERMINAL_SURVEY_CONFIRM_RETRY_DELAYS_MS.length;
        attempt += 1
      ) {
        const delayMs = TERMINAL_SURVEY_CONFIRM_RETRY_DELAYS_MS[attempt];
        if (delayMs > 0) {
          await waitForVideoDateRuntimeRecovery(delayMs);
        }
        if (surveyOpenedRef.current) return true;

        const attemptSource =
          attempt === 0 ? source : `${source}_retry_${attempt}`;
        const { data: sessionRow, error: sessionError } = await supabase
          .from("video_sessions")
          .select(TERMINAL_SURVEY_SESSION_SELECT)
          .eq("id", id)
          .maybeSingle();
        if (sessionError || !sessionRow) {
          vdbg("terminal_post_date_survey_confirmation_row_unavailable", {
            sessionId: id,
            userId: user.id,
            source: attemptSource,
            attempt,
            error: sessionError
              ? { code: sessionError.code, message: sessionError.message }
              : null,
          });
        } else if (videoSessionIndicatesTerminalEnd(sessionRow)) {
          const recovered = await recoverTerminalPostDateSurvey(
            attemptSource,
            sessionRow,
          );
          if (recovered) return true;
        }

        if (timelineV2.enabled) {
          const snapshot = await fetchVideoDateSnapshot(id, {
            includeToken: false,
          });
          const decision = applyTimelineSnapshot(
            snapshot,
            `${attemptSource}_snapshot`,
          );
          if (
            snapshot.ok === true &&
            decision?.action === "accepted" &&
            (snapshot.phase === "ended" || snapshot.phase === "verdict")
          ) {
            setTimingRefreshNonce((n) => n + 1);
          }
        }
      }

      vdbg("terminal_post_date_survey_confirmation_unresolved", {
        sessionId: id,
        userId: user.id,
        source,
        attempts: TERMINAL_SURVEY_CONFIRM_RETRY_DELAYS_MS.length,
      });
      return false;
    },
    [
      applyTimelineSnapshot,
      id,
      recoverTerminalPostDateSurvey,
      timelineV2.enabled,
      user?.id,
    ],
  );

  useEffect(() => {
    videoJoinCycleRef.current = 0;
    nextVideoDateMediaPromptIntentRef.current = "auto";
    videoJoinOutcomeByCycleRef.current = new Set();
    surveyOpenedRef.current = false;
    terminalSurveyRecoveryInFlightRef.current = false;
    setTerminalSurveyRecoveryActive(false);
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
      const recovered = await recoverTerminalPostDateSurvey(
        "ended_phase_hydration_recovery",
      );
      if (cancelled || !recovered) return;
      if (surveyOpenedRef.current) {
        logJourney(
          "date_route_recovered",
          { source: "ended_phase_hydration_recovery" },
          "date_route_recovered",
        );
        logJourney("survey_lost_prevented", {
          source: "ended_phase_hydration_recovery",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    id,
    user?.id,
    showFeedback,
    phase,
    recoverTerminalPostDateSurvey,
    logJourney,
  ]);

  useEffect(() => {
    if (!id || !user?.id || !readyRedirectForceSurveyState?.forceSurvey) return;
    const source =
      readyRedirectForceSurveyState.source ?? "ready_redirect_force_survey";
    void recoverTerminalPostDateSurvey(source);
  }, [
    id,
    readyRedirectForceSurveyState?.forceSurvey,
    readyRedirectForceSurveyState?.source,
    recoverTerminalPostDateSurvey,
    user?.id,
  ]);

  useLayoutEffect(() => {
    if (!id) return;
    markVideoDateEntryPipelineStarted(id);
    videoDateDebug("date-entry pipeline latch marked", {
      sessionId: id,
      userId: user?.id ?? null,
    });
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
    if (!id || !user?.id || videoDateAccess !== "allowed") return;
    if (dupBlocked) return;
    const refreshDateRouteOwnership = () => {
      markVideoDateRouteOwned(id, user.id);
      vdbg("date_route_ownership_refresh", {
        sessionId: id,
        userId: user.id,
        routeMountId: routeMountIdRef.current,
        routeOwnerId: `${user.id}:${id}`,
      });
    };
    refreshDateRouteOwnership();
    const intervalId = window.setInterval(
      refreshDateRouteOwnership,
      VIDEO_DATE_ROUTE_OWNERSHIP_REFRESH_MS,
    );
    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    dupBlocked,
    id,
    user?.id,
    videoDateAccess,
  ]);

  useEffect(() => {
    if (
      !timelineV2.enabled ||
      !id ||
      !user?.id ||
      videoDateAccess !== "allowed"
    )
      return;
    let cancelled = false;
    void (async () => {
      const snapshot = await fetchVideoDateSnapshot(id, {
        includeToken: false,
      });
      if (cancelled) return;
      const decision = applyTimelineSnapshot(
        snapshot,
        "date_route_timeline_refresh",
      );
      if (
        !cancelled &&
        snapshot.ok &&
        decision?.action === "accepted" &&
        (snapshot.phase === "ended" || snapshot.phase === "verdict")
      ) {
        await recoverTerminalPostDateSurvey("timeline_snapshot_terminal");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    applyTimelineSnapshot,
    id,
    recoverTerminalPostDateSurvey,
    timelineV2.enabled,
    user?.id,
    videoDateAccess,
  ]);

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
          .select(
            "participant_1_id, participant_2_id, event_id, session_seq, daily_room_name, daily_room_url, ended_at, ended_reason, state, phase, handshake_started_at, date_started_at, ready_gate_status, ready_gate_expires_at, participant_1_joined_at, participant_2_joined_at, participant_1_remote_seen_at, participant_2_remote_seen_at, participant_1_liked, participant_2_liked, participant_1_decided_at, participant_2_decided_at, handshake_grace_expires_at",
          )
          .eq("id", id)
          .maybeSingle();

        if (cancelled) return;

        vdbg("date_guard_session_row", {
          sessionId: id,
          userId: user.id,
          row: sessionRow ?? null,
          error: sessionErr
            ? { code: sessionErr.code, message: sessionErr.message }
            : null,
        });

        if (sessionErr || !sessionRow) {
          vdbg("date_guard_blocked", {
            sessionId: id,
            userId: user.id,
            reason: "missing_session",
            error: sessionErr
              ? { code: sessionErr.code, message: sessionErr.message }
              : null,
          });
          setVideoDateAccess("not_found");
          return;
        }
        setHandshakeTruth({ id, ...(sessionRow as VideoDateHandshakeTruth) });

        const isP1 = sessionRow.participant_1_id === user.id;
        const isParticipant = isP1 || sessionRow.participant_2_id === user.id;
        const sessionIsDateCapable =
          videoSessionRowIndicatesHandshakeOrDate(sessionRow);
        const routeRecovery = adviseVideoSessionTruthRecovery({
          sessionId: id,
          eventId: sessionRow.event_id,
          truth: sessionRow,
          platform: "web",
          surface: "video_date",
        });
        const canAttemptDaily = routeRecovery.action === "go_date";
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
          await recoverTerminalPostDateSurvey(
            "session_load_terminal",
            sessionRow,
          );
          return;
        }

        let registrationQueueStatus: string | null = null;
        const logRegistrationStatus = (
          queueStatus: string | null | undefined,
        ) => {
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
              readyGateStatus:
                (sessionRow as { ready_gate_status?: string | null })
                  .ready_gate_status ?? null,
              readyGateExpiresAt:
                (
                  sessionRow as {
                    ready_gate_expires_at?: string | number | null;
                  }
                ).ready_gate_expires_at ?? null,
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
                error:
                  error instanceof Error
                    ? { name: error.name, message: error.message }
                    : String(error),
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
          const dateRouteOwned = isVideoDateRouteOwned(id, user.id);

          if (registrationQueueStatus === "in_ready_gate") {
            const rgStatus =
              (sessionRow as { ready_gate_status?: string | null })
                .ready_gate_status ?? null;
            const rgExpiresRaw =
              (sessionRow as { ready_gate_expires_at?: string | number | null })
                .ready_gate_expires_at ?? null;
            const readyGateBranch =
              rgStatus === "both_ready"
                ? "both_ready_not_provider_prepared_redirecting"
                : "no_both_ready_redirecting";
            const shouldRouteReadyGate =
              routeRecovery.action === "go_ready_gate";
            vdbg("date_guard_ready_gate_branch", {
              sessionId: id,
              userId: user.id,
              eventId: sessionRow.event_id,
              branch: readyGateBranch,
              truthDecision: routeRecovery.routeDecision ?? "stay_lobby",
              canAttemptDaily,
              routeOverride: null,
              finalRoute: shouldRouteReadyGate ? "ready" : "lobby",
              readyGateStatus: rgStatus,
              readyGateExpiresAt: rgExpiresRaw,
              latchActive: isDateEntryTransitionActive(id),
              dateRouteOwned,
              state: sessionRow.state,
              phase: sessionRow.phase,
              handshakeStarted: Boolean(sessionRow.handshake_started_at),
            });
            if (dateRouteOwned) {
              vdbg(
                "date_guard_ready_gate_bounce_suppressed_by_route_ownership",
                {
                  sessionId: id,
                  userId: user.id,
                  eventId: sessionRow.event_id,
                  queueStatus: registrationQueueStatus,
                  state: sessionRow.state,
                  phase: sessionRow.phase,
                  readyGateStatus: rgStatus,
                  readyGateExpiresAt: rgExpiresRaw,
                },
              );
              logRegistrationStatus(registrationQueueStatus);
              setVideoDateAccess("allowed");
              markVideoDateRouteOwned(id, user.id);
              return;
            }
            clearDateEntryTransition(id);
            videoDateDebug("bouncing ready_gate session back to lobby", {
              sessionId: id,
              eventId: sessionRow.event_id,
              queueStatus: registrationQueueStatus,
              state: sessionRow.state,
              phase: sessionRow.phase,
            });
            videoDateDebug("date_refresh_routing", {
              outcome: shouldRouteReadyGate
                ? "redirect_ready_gate"
                : "redirect_lobby",
              reason: shouldRouteReadyGate
                ? "canonical_ready_gate_without_provider_prepared_truth"
                : "in_ready_gate_without_provider_prepared_truth",
              sessionId: id,
              queueStatus: registrationQueueStatus,
              sessionTruth: {
                state: sessionRow.state ?? null,
                phase: sessionRow.phase ?? null,
                handshake_started_at: sessionRow.handshake_started_at ?? null,
                date_started_at: sessionRow.date_started_at ?? null,
                ready_gate_status:
                  (sessionRow as { ready_gate_status?: string | null })
                    .ready_gate_status ?? null,
              },
              latchActive: isDateEntryTransitionActive(id),
              target: shouldRouteReadyGate
                ? `/ready/${encodeURIComponent(id)}`
                : `/event/${encodeURIComponent(sessionRow.event_id)}/lobby`,
            });
            const target = shouldRouteReadyGate
              ? `/ready/${encodeURIComponent(id)}`
              : `/event/${encodeURIComponent(sessionRow.event_id)}/lobby`;
            vdbgRedirect(
              target,
              shouldRouteReadyGate
                ? "canonical_ready_gate_without_provider_prepared_truth"
                : "in_ready_gate_without_provider_prepared_truth",
              {
                sessionId: id,
                userId: user.id,
                eventId: sessionRow.event_id,
                queueStatus: registrationQueueStatus,
                state: sessionRow.state,
                phase: sessionRow.phase,
                handshakeStarted: Boolean(sessionRow.handshake_started_at),
                latchActive: isDateEntryTransitionActive(id),
              },
            );
            logJourney("date_route_bounced", {
              reason: shouldRouteReadyGate
                ? "canonical_ready_gate_without_provider_prepared_truth"
                : "in_ready_gate_without_provider_prepared_truth",
              target,
            });
            navigate(target, { replace: true });
            return;
          }

          if (routeRecovery.action === "go_ready_gate") {
            const target = `/ready/${encodeURIComponent(id)}`;
            if (dateRouteOwned) {
              vdbg(
                "date_guard_canonical_ready_bounce_suppressed_by_route_ownership",
                {
                  sessionId: id,
                  userId: user.id,
                  eventId: sessionRow.event_id,
                  queueStatus: registrationQueueStatus,
                  state: sessionRow.state,
                  phase: sessionRow.phase,
                },
              );
              setVideoDateAccess("allowed");
              markVideoDateRouteOwned(id, user.id);
              return;
            }
            clearDateEntryTransition(id);
            videoDateDebug("date_refresh_routing", {
              outcome: "redirect_ready_gate",
              reason: "date_guard_canonical_ready_gate",
              sessionId: id,
              queueStatus: registrationQueueStatus,
              sessionTruth: {
                state: sessionRow.state ?? null,
                phase: sessionRow.phase ?? null,
                handshake_started_at: sessionRow.handshake_started_at ?? null,
                date_started_at: sessionRow.date_started_at ?? null,
                ready_gate_status:
                  (sessionRow as { ready_gate_status?: string | null })
                    .ready_gate_status ?? null,
              },
              latchActive: isDateEntryTransitionActive(id),
              target,
            });
            vdbgRedirect(target, "date_guard_canonical_ready_gate", {
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
              reason: "date_guard_canonical_ready_gate",
              target,
            });
            navigate(target, { replace: true });
            return;
          }

          if (
            routeRecovery.action === "go_lobby" ||
            routeRecovery.action === "go_home"
          ) {
            const target =
              routeRecovery.action === "go_lobby" && sessionRow.event_id
                ? `/event/${encodeURIComponent(sessionRow.event_id)}/lobby`
                : "/home";
            if (routeRecovery.action === "go_lobby" && dateRouteOwned) {
              vdbg("date_guard_lobby_bounce_suppressed_by_route_ownership", {
                sessionId: id,
                userId: user.id,
                eventId: sessionRow.event_id,
                queueStatus: registrationQueueStatus,
                state: sessionRow.state,
                phase: sessionRow.phase,
              });
              setVideoDateAccess("allowed");
              markVideoDateRouteOwned(id, user.id);
              return;
            }
            clearDateEntryTransition(id);
            videoDateDebug("date_refresh_routing", {
              outcome:
                routeRecovery.action === "go_lobby"
                  ? "redirect_lobby"
                  : "redirect_home",
              reason: "date_guard_canonical_not_startable",
              sessionId: id,
              queueStatus: registrationQueueStatus,
              sessionTruth: {
                state: sessionRow.state ?? null,
                phase: sessionRow.phase ?? null,
                handshake_started_at: sessionRow.handshake_started_at ?? null,
                date_started_at: sessionRow.date_started_at ?? null,
                ready_gate_status:
                  (sessionRow as { ready_gate_status?: string | null })
                    .ready_gate_status ?? null,
              },
              latchActive: isDateEntryTransitionActive(id),
              target,
            });
            vdbgRedirect(target, "date_guard_canonical_not_startable", {
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
              reason: "date_guard_canonical_not_startable",
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
        const pId = isP1
          ? sessionRow.participant_2_id
          : sessionRow.participant_1_id;
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
            const { data: profile, error: profileError } = await supabase.rpc(
              "get_profile_for_viewer",
              {
                p_target_id: pId,
              },
            );

            if (cancelled) return;

            if (profileError) {
              vdbg("date_guard_partner_profile_failed", {
                sessionId: id,
                eventId: sessionRow.event_id ?? null,
                error: {
                  code: profileError.code,
                  message: profileError.message,
                },
              });
            }

            if (profile) {
              const row = profile as Record<string, unknown>;
              const tags = Array.isArray(row.vibes)
                ? row.vibes.filter(
                    (v): v is string =>
                      typeof v === "string" && v.trim().length > 0,
                  )
                : [];

              let prompts: { question: string; answer: string }[] = [];
              if (Array.isArray(row.prompts)) {
                prompts = (
                  row.prompts as Array<{ question?: string; answer?: string }>
                ).map((p) => ({
                  question: p.question || "",
                  answer: p.answer || "",
                }));
              }

              const photoArr = Array.isArray(row.photos)
                ? row.photos.filter((p): p is string => typeof p === "string")
                : [];
              const avatarUrl =
                typeof row.avatar_url === "string" ? row.avatar_url : null;
              const primaryPath = photoArr[0] || avatarUrl;
              const resolvedUrl = primaryPath
                ? resolvePhoto(primaryPath)
                : null;
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
                about_me:
                  typeof row.about_me === "string" ? row.about_me : undefined,
                job: typeof row.job === "string" ? row.job : undefined,
                location:
                  typeof row.location === "string" ? row.location : undefined,
                heightCm:
                  typeof row.height_cm === "number" ? row.height_cm : undefined,
                prompts,
              });
            }
          } catch (profileErr) {
            if (!cancelled) {
              vdbg("date_guard_partner_profile_failed", {
                sessionId: id,
                eventId: sessionRow.event_id ?? null,
                error:
                  profileErr instanceof Error
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
          error:
            err instanceof Error
              ? { name: err.name, message: err.message }
              : String(err),
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
          "handshake_started_at, handshake_grace_expires_at, date_started_at, date_extra_seconds, phase, state, ended_at, ended_reason, participant_1_id, participant_2_id, participant_1_joined_at, participant_2_joined_at, participant_1_remote_seen_at, participant_2_remote_seen_at, participant_1_decided_at, participant_2_decided_at",
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

      if (
        data.ended_at ||
        (data.state as string) === "ended" ||
        data.phase === "ended"
      ) {
        vdbg("date_timing_guard_ended", { sessionId: id, row: data });
        setHandshakeStartedAt(null);
        await recoverTerminalPostDateSurvey("timing_terminal");
        setDateStartedAt(
          typeof data.date_started_at === "string"
            ? data.date_started_at
            : null,
        );
        setTimingReady(true);
        return;
      }

      if (
        (data.state as string) === "date" ||
        data.phase === "date" ||
        Boolean(data.date_started_at)
      ) {
        vdbg("date_timing_existing_date", { sessionId: id, row: data });
        markDateFlowEntered();
        setHandshakeStartedAt(null);
        const dateStartedAt =
          typeof data.date_started_at === "string"
            ? data.date_started_at
            : null;
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
            void checkMutualVibeRef.current?.(
              "handshake_timing_refetch_deadline_elapsed",
            );
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
    if (
      !id ||
      videoDateAccess !== "allowed" ||
      showFeedback ||
      terminalSurveyRecoveryActive
    )
      return;

    const reconcile = (source: "visibilitychange" | "online") => {
      if (
        source === "visibilitychange" &&
        document.visibilityState !== "visible"
      )
        return;
      if (
        phaseRef.current === "ended" ||
        surveyOpenedRef.current ||
        terminalSurveyRecoveryInFlightRef.current ||
        explicitEndRequestedRef.current !== "idle"
      ) {
        return;
      }
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
            const { data: returnData, error: returnError } = await supabase.rpc(
              "video_date_transition",
              { p_session_id: id, p_action: "mark_reconnect_return" },
            );
            const returnPayload =
              returnData &&
              typeof returnData === "object" &&
              !Array.isArray(returnData)
                ? (returnData as Record<string, unknown>)
                : null;
            const returnRejected = returnPayload?.success === false;
            vdbg("video_date_foreground_return_result", {
              sessionId: id,
              source,
              ok: !returnError && !returnRejected,
              payload: returnData ?? null,
              error: returnError
                ? { code: returnError.code, message: returnError.message }
                : null,
            });
            if (
              !returnError &&
              (await recoverLifecycleRpcTerminalSurvey(
                `${source}_mark_reconnect_return_terminal_survey`,
                returnPayload,
              ))
            ) {
              return;
            }
            if (!returnError && !returnRejected) {
              trackEvent(LobbyPostDateEvents.VIDEO_DATE_RECONNECT_RETURNED, {
                platform: "web",
                session_id: id,
                event_id: eventId ?? null,
                source: "visibilitychange",
              });
            } else {
              trackEvent(
                LobbyPostDateEvents.VIDEO_DATE_FOREGROUND_RECONCILE_FAILED,
                {
                  platform: "web",
                  session_id: id,
                  event_id: eventId ?? null,
                  source,
                  step: "mark_reconnect_return",
                  code: returnError?.code ?? videoDateLifecycleRpcCode(returnPayload),
                  retryable: returnError
                    ? true
                    : videoDateLifecycleRpcRetryable(returnPayload) === true,
                },
              );
            }
          }
          const { data, error } = await supabase.rpc("video_date_transition", {
            p_session_id: id,
            p_action: "sync_reconnect",
          });
          const reconnectPayload =
            data && typeof data === "object" && !Array.isArray(data)
              ? (data as Record<string, unknown>)
              : null;
          const reconnectRejected = reconnectPayload?.success === false;
          vdbg("video_date_foreground_reconcile_result", {
            sessionId: id,
            source,
            ok: !error && !reconnectRejected,
            payload: data ?? null,
            error: error ? { code: error.code, message: error.message } : null,
          });
          if (
            !error &&
            (await recoverLifecycleRpcTerminalSurvey(
              `${source}_sync_reconnect_terminal_survey`,
              reconnectPayload,
            ))
          ) {
            return;
          }
          if (error || reconnectRejected) {
            trackEvent(
              LobbyPostDateEvents.VIDEO_DATE_FOREGROUND_RECONCILE_FAILED,
              {
                platform: "web",
                session_id: id,
                event_id: eventId ?? null,
                source,
                step: "sync_reconnect",
                code: error?.code ?? videoDateLifecycleRpcCode(reconnectPayload),
                retryable: error
                  ? true
                  : videoDateLifecycleRpcRetryable(reconnectPayload) === true,
              },
            );
            if (videoDateLifecycleRpcRetryable(reconnectPayload) === true) return;
          }
          if (
            !error &&
            (reconnectPayload?.ended === true ||
              videoDateLifecycleRpcCode(reconnectPayload) === "session_ended" ||
              reconnectPayload?.state === "ended" ||
              reconnectPayload?.phase === "ended")
          ) {
            const handled = await recoverTerminalPostDateSurvey(
              `${source}_sync_reconnect_terminal`,
            );
            if (handled) return;
          }
          setTimingRefreshNonce((n) => n + 1);
          attemptBroadcastGapSnapshotRecoveryRef.current(`${source}_resume`);
        } catch (error) {
          trackEvent(
            LobbyPostDateEvents.VIDEO_DATE_FOREGROUND_RECONCILE_FAILED,
            {
              platform: "web",
              session_id: id,
              event_id: eventId ?? null,
              source,
              step: "exception",
              error_name: error instanceof Error ? error.name : "unknown",
            },
          );
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
  }, [
    eventId,
    id,
    recoverLifecycleRpcTerminalSurvey,
    recoverTerminalPostDateSurvey,
    showFeedback,
    terminalSurveyRecoveryActive,
    videoDateAccess,
  ]);

  // Start Daily as soon as the participant guard passes; timing hydration can finish in parallel.
  useEffect(() => {
    if (!id) return;
    if (videoDateAccess !== "allowed" || handshakeStartFailed) return;
    if (
      phase === "ended" ||
      showFeedback ||
      terminalSurveyRecoveryActive ||
      terminalSurveyRecoveryInFlightRef.current
    )
      return;
    if (dupBlocked) return;
    if (callStarted) return;
    if (callStartFailure) return;

    let cancelled = false;
    setCallStarted(true);
    const mediaPromptIntent = nextVideoDateMediaPromptIntentRef.current;
    nextVideoDateMediaPromptIntentRef.current = "auto";
    videoJoinCycleRef.current += 1;
    const joinCycle = videoJoinCycleRef.current;
    trackEvent(LobbyPostDateEvents.VIDEO_DATE_JOIN_ATTEMPT, {
      platform: "web",
      session_id: id,
      event_id: eventId,
      is_retry: joinCycle > 1,
    });
    Sentry.addBreadcrumb({
      category: "video-date",
      message: "Joined video date",
      level: "info",
    });
    startCall(id, { mediaPromptIntent }).then((result) => {
      if (cancelled) {
        vdbg("date_entry_start_result_ignored_after_cleanup", {
          sessionId: id,
          userId: user?.id ?? null,
          eventId: eventId ?? null,
          joinCycle,
          ok: result.ok,
        });
        return;
      }
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
          const redirected = await recoverFromNotStartableDateTruth(
            "create_date_room_not_ready",
          );
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

      if (
        failure.kind === "SESSION_NOT_FOUND" ||
        failure.kind === "ROOM_NOT_FOUND"
      ) {
        setVideoDateAccess("not_found");
        return;
      }

      if (failure.kind === "auth") {
        toast.error("Please sign in again, then try once more.");
      }
      setHandshakeStartFailed(true);
      setHandshakeFailureCode(undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [
    callStartFailure,
    id,
    videoDateAccess,
    handshakeStartFailed,
    phase,
    showFeedback,
    terminalSurveyRecoveryActive,
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
          const row = payload.new as VideoDateHandshakeTruth & {
            session_seq?: number | null;
          };
          if (
            typeof row.session_seq === "number" &&
            Number.isFinite(row.session_seq)
          ) {
            sessionSeqRef.current = row.session_seq;
          }
          setHandshakeTruth({ id, ...row });
          const newState = row.state || row.phase;

          if (row.ended_at || newState === "ended") {
            setHandshakeStartedAt(null);
            setDateStartedAt(
              typeof row.date_started_at === "string"
                ? row.date_started_at
                : null,
            );
            void recoverTerminalPostDateSurvey("realtime_terminal", row);
            return;
          }

          if (newState === "date" || Boolean(row.date_started_at)) {
            markDateFlowEntered();
            clearHandshakeGraceState();
            setHandshakeStartedAt(null);
            const extraNorm = normalizedDateExtraSeconds(
              row.date_extra_seconds,
            );
            setDateExtraSeconds(extraNorm);
            const dateStartedAt =
              typeof row.date_started_at === "string"
                ? row.date_started_at
                : null;
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
              void checkMutualVibeRef.current?.(
                "handshake_realtime_deadline_elapsed",
              );
            }
            setPhase("handshake");
          }
        },
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

  const handleExtensionBroadcastEvent = useCallback(
    (event: VideoDateSessionBroadcastEvent) => {
      if (extensionBroadcastSeenRef.current.has(event.id)) return;
      if (
        event.kind !== "date_extension_requested" &&
        event.kind !== "date_extension_applied"
      )
        return;
      extensionBroadcastSeenRef.current.add(event.id);

      const addedSeconds =
        typeof event.payload.added_seconds === "number" &&
        Number.isFinite(event.payload.added_seconds)
          ? Math.max(0, Math.floor(event.payload.added_seconds))
          : 0;
      const minutes = addedSeconds > 0 ? addedSeconds / 60 : null;
      const minutesLabel =
        minutes === null
          ? null
          : Number.isInteger(minutes)
            ? String(minutes)
            : minutes.toFixed(1);
      const creditType =
        event.payload.credit_type === "extra_time" ||
        event.payload.credit_type === "extended_vibe"
          ? event.payload.credit_type
          : null;
      const requestExpiresAt =
        typeof event.payload.request_expires_at === "string"
          ? event.payload.request_expires_at
          : null;
      const effectiveRequestExpiresAt =
        requestExpiresAt ?? new Date(Date.now() + 45_000).toISOString();

      if (event.kind === "date_extension_requested") {
        if (event.actor && event.actor === user?.id) return;
        if (creditType) {
          setPendingPartnerExtension({
            type: creditType,
            expiresAt: effectiveRequestExpiresAt,
          });
        }
        toast(
          minutesLabel
            ? `Your date asked for +${minutesLabel} min. Tap Accept +${minutesLabel} if you do too.`
            : "Your date wants to keep going. Tap +time if you do too.",
          { duration: 4000 },
        );
        trackEvent("video_date_extension_partner_requested", {
          platform: "web",
          session_id: id,
          event_id: eventId,
          credit_type: creditType,
          added_seconds: addedSeconds || null,
        });
        return;
      }

      setPendingPartnerExtension(null);
      void refetchCredits();
      if (event.actor && event.actor === user?.id) return;
      toast.success(
        `${minutesLabel ?? "Extra"} ${minutes === 1 ? "minute" : "minutes"} added!`,
        {
          duration: 2500,
        },
      );
    },
    [eventId, id, refetchCredits, user?.id],
  );

  const clearBroadcastGapRetryTimer = useCallback(() => {
    if (!broadcastGapRetryTimerRef.current) return;
    clearTimeout(broadcastGapRetryTimerRef.current);
    broadcastGapRetryTimerRef.current = null;
  }, []);

  const attemptBroadcastGapSnapshotRecovery = useCallback(
    async (source: string) => {
      if (!id || !user?.id || videoDateAccess !== "allowed") return;
      const state = broadcastGapRecoveryRef.current;
      if (!shouldAttemptVideoDateBroadcastGapRecovery(state)) return;
      if (broadcastRefetchInFlightRef.current) return;

      broadcastRefetchInFlightRef.current = true;
      try {
        const snapshot = await fetchVideoDateSnapshot(id, {
          includeToken: false,
        });
        const latestState =
          broadcastGapRecoveryRef.current?.sessionId === state.sessionId
            ? broadcastGapRecoveryRef.current
            : state;
        if (snapshot.ok === true) {
          applyTimelineSnapshot(snapshot, source);
          sessionSeqRef.current = Math.max(
            sessionSeqRef.current ?? 0,
            snapshot.seq,
          );
          broadcastGapRecoveryRef.current =
            recordVideoDateBroadcastGapRecoverySuccess(
              latestState,
              snapshot.seq,
            );
          if (snapshot.phase === "ended") {
            const handled = await recoverTerminalPostDateSurvey(
              `${source}_terminal`,
            );
            if (handled) return;
          }
        } else {
          broadcastGapRecoveryRef.current =
            recordVideoDateBroadcastGapRecoveryFailure(
              latestState,
              snapshot.error,
            );
        }
        Sentry.addBreadcrumb({
          category: "video-date-broadcast",
          message: "snapshot_refetch_on_seq_gap_retry",
          level: snapshot.ok ? "info" : "warning",
          data: {
            session_id: id,
            event_id: eventId ?? null,
            source,
            target_seq: state.targetSeq,
            expected_seq: state.expectedSeq,
            attempt: state.attempts + 1,
            snapshot_ok: snapshot.ok,
          },
        });
        setTimingRefreshNonce((n) => n + 1);
      } catch (error) {
        broadcastGapRecoveryRef.current =
          recordVideoDateBroadcastGapRecoveryFailure(state, error);
      } finally {
        broadcastRefetchInFlightRef.current = false;
      }

      clearBroadcastGapRetryTimer();
      const delayMs = videoDateBroadcastGapRetryDelayMs(
        broadcastGapRecoveryRef.current,
      );
      if (delayMs != null) {
        broadcastGapRetryTimerRef.current = setTimeout(() => {
          broadcastGapRetryTimerRef.current = null;
          void attemptBroadcastGapSnapshotRecovery("bounded_timer");
        }, delayMs);
      }
    },
    [
      applyTimelineSnapshot,
      clearBroadcastGapRetryTimer,
      eventId,
      id,
      recoverTerminalPostDateSurvey,
      user?.id,
      videoDateAccess,
    ],
  );
  attemptBroadcastGapSnapshotRecoveryRef.current = (source: string) => {
    void attemptBroadcastGapSnapshotRecovery(source);
  };

  const reconcileBroadcastEvent = useCallback(
    async (event: VideoDateSessionBroadcastEvent) => {
      if (!id || !user?.id || videoDateAccess !== "allowed") return;
      const decision = resolveVideoDateSessionSeqDecision(
        sessionSeqRef.current,
        event.sessionSeq,
      );
      if (decision.action === "invalid" || decision.action === "duplicate")
        return;

      handleExtensionBroadcastEvent(event);
      if (decision.action === "gap") {
        broadcastGapRecoveryRef.current = mergeVideoDateBroadcastGapRecovery(
          broadcastGapRecoveryRef.current,
          {
            sessionId: id,
            targetSeq: event.sessionSeq,
            expectedSeq: decision.expectedSeq,
          },
        );
        if (broadcastRefetchInFlightRef.current) {
          broadcastPendingRefetchSeqRef.current = Math.max(
            broadcastPendingRefetchSeqRef.current ?? 0,
            event.sessionSeq,
          );
          return;
        }
        void attemptBroadcastGapSnapshotRecovery("broadcast_seq_gap");
        return;
      }

      const shouldRetainGapRecovery =
        shouldRetainVideoDateBroadcastGapRecoveryForEvent(
          broadcastGapRecoveryRef.current,
          event.sessionSeq,
        );
      if (!shouldRetainGapRecovery) {
        clearBroadcastGapRetryTimer();
        broadcastGapRecoveryRef.current = null;
      }
      sessionSeqRef.current = event.sessionSeq;
      if (broadcastRefetchInFlightRef.current) {
        broadcastPendingRefetchSeqRef.current = Math.max(
          broadcastPendingRefetchSeqRef.current ?? 0,
          event.sessionSeq,
        );
        return;
      }
      broadcastRefetchInFlightRef.current = true;
      try {
        let pendingRefetchSeq: number | null = event.sessionSeq;
        while (pendingRefetchSeq !== null) {
          const refetchSeq = pendingRefetchSeq;
          broadcastPendingRefetchSeqRef.current = null;
          const snapshot = await fetchVideoDateSnapshot(id, {
            includeToken: false,
          });
          if (snapshot.ok === true) {
            applyTimelineSnapshot(
              snapshot,
              refetchSeq === event.sessionSeq
                ? "broadcast_seq_gap"
                : "broadcast_queued_seq",
            );
            sessionSeqRef.current = Math.max(
              sessionSeqRef.current ?? 0,
              snapshot.seq,
            );
            if (snapshot.phase === "ended") {
              const handled = await recoverTerminalPostDateSurvey(
                "broadcast_snapshot_terminal",
              );
              if (handled) return;
            }
          }
          Sentry.addBreadcrumb({
            category: "video-date-broadcast",
            message: "snapshot_refetch_on_seq_gap",
            level: snapshot.ok ? "info" : "warning",
            data: {
              session_id: id,
              event_id: eventId ?? null,
              event_kind: event.kind,
              incoming_seq: refetchSeq,
              expected_seq: null,
              snapshot_ok: snapshot.ok,
            },
          });
          pendingRefetchSeq = broadcastPendingRefetchSeqRef.current;
        }
        setTimingRefreshNonce((n) => n + 1);
      } finally {
        broadcastRefetchInFlightRef.current = false;
      }
      if (shouldRetainGapRecovery) {
        void attemptBroadcastGapSnapshotRecovery("broadcast_event_progress");
      } else if (broadcastGapRecoveryRef.current) {
        void attemptBroadcastGapSnapshotRecovery("broadcast_refetch_complete");
      }
    },
    [
      applyTimelineSnapshot,
      attemptBroadcastGapSnapshotRecovery,
      clearBroadcastGapRetryTimer,
      eventId,
      handleExtensionBroadcastEvent,
      id,
      recoverTerminalPostDateSurvey,
      user?.id,
      videoDateAccess,
    ],
  );

  useEffect(() => {
    if (
      !id ||
      !user?.id ||
      videoDateAccess !== "allowed" ||
      !broadcastV2.enabled
    )
      return;
    const subscription = createVideoDateSessionChannel(supabase, {
      sessionId: id,
      onEvent: (event) => {
        void reconcileBroadcastEvent(event);
      },
      onInvalidPayload: () => {
        vdbg("video_date_broadcast_invalid_payload_ignored", {
          sessionId: id,
          eventId: eventId ?? null,
        });
      },
      onStatusChange: (status, error) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          vdbg("video_date_broadcast_channel_degraded", {
            sessionId: id,
            eventId: eventId ?? null,
            status,
            error: error instanceof Error ? error.message : String(error ?? ""),
          });
        }
      },
    });
    return () => {
      subscription.unsubscribe();
      clearBroadcastGapRetryTimer();
      broadcastGapRecoveryRef.current = null;
    };
  }, [
    broadcastV2.enabled,
    clearBroadcastGapRetryTimer,
    eventId,
    id,
    reconcileBroadcastEvent,
    user?.id,
    videoDateAccess,
  ]);

  // Progressive blur: clear over 10s when connected + track start
  useEffect(() => {
    if (isConnected) {
      trackEvent("video_date_started", { session_id: id, phase: "handshake" });
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
      if (
        !result.ok &&
        result.reason !== "unsupported_browser" &&
        result.reason !== "no_device_id"
      ) {
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
    if (
      !isConnected ||
      blurAmount !== 0 ||
      remoteReadableTrackedRef.current ||
      !id
    )
      return;
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
    const candidateTimeline = serverTimeline;
    const timelineForCountdown =
      candidateTimeline !== null &&
      candidateTimeline.sessionId === id &&
      candidateTimeline.phase === phase &&
      (phase === "handshake" || phase === "date") &&
      candidateTimeline.phaseDeadlineAtMs !== null
        ? candidateTimeline
        : null;
    const useTimelineCountdown =
      timelineV2.enabled && timelineForCountdown !== null;
    const hasAuthoritativeStart = useTimelineCountdown
      ? true
      : phase === "handshake"
        ? Boolean(handshakeStartedAt)
        : phase === "date"
          ? Boolean(dateStartedAt)
          : false;
    if (!hasAuthoritativeStart) return;

    let completionFired = false;
    const tick = () => {
      const countdown = useTimelineCountdown
        ? resolveVideoDateTimelineCountdown(timelineForCountdown)
        : resolveVideoDatePhaseCountdown({
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
        void handleCallEndRef.current?.("date_timeout");
      } else if (phaseRef.current === "handshake") {
        vdbg("handshake_visible_countdown_elapsed", {
          sessionId: id ?? null,
          trigger: "complete_handshake",
        });
        void checkMutualVibeRef.current?.(
          "handshake_visible_countdown_elapsed",
        );
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
    serverTimeline,
    timelineV2.enabled,
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
    if (
      !id ||
      !user?.id ||
      videoDateAccess !== "allowed" ||
      terminalSurveyRecoveryActive
    )
      return;
    let lifecycleAwayTimer: ReturnType<typeof setTimeout> | null = null;

    const clearLifecycleAwayTimer = () => {
      if (!lifecycleAwayTimer) return;
      clearTimeout(lifecycleAwayTimer);
      lifecycleAwayTimer = null;
    };
    const shouldTreatLifecycleAwayAsSoftTelemetry = (
      source: WebLifecycleLeaveSource,
    ) => {
      if (!WEB_SOFT_LIFECYCLE_LEAVE_SOURCES.has(source)) return false;
      if (localInDailyRoom || isConnecting || isConnected) return true;
      if (
        dailyMeetingState === "joining-meeting" ||
        dailyMeetingState === "joined-meeting"
      )
        return true;
      return phaseRef.current === "handshake" || phaseRef.current === "date";
    };
    const recordSoftLifecycleTelemetry = (
      source: WebLifecycleLeaveSource,
      action: string,
    ) => {
      vdbg("web_lifecycle_away_suppressed_active_daily", {
        sessionId: id,
        userId: user.id,
        eventId: eventId ?? null,
        source,
        action,
        phase: phaseRef.current,
        dailyMeetingState,
        localInDailyRoom,
        isConnecting,
        isConnected,
      });
      trackEvent("video_date_web_lifecycle_away_suppressed", {
        platform: "web",
        session_id: id,
        event_id: eventId ?? null,
        source,
        action,
        phase: phaseRef.current,
        daily_meeting_state: dailyMeetingState,
        local_in_daily_room: localInDailyRoom,
        connected: isConnected,
        connecting: isConnecting,
      });
    };

    const sendLeaveSignal = (source: WebLifecycleLeaveSource) => {
      if (
        showFeedback ||
        surveyOpenedRef.current ||
        terminalSurveyRecoveryInFlightRef.current ||
        explicitEndRequestedRef.current !== "idle"
      ) {
        return;
      }
      if (phaseRef.current === "ended") return;
      if (leaveSignalSentRef.current) return;
      if (shouldTreatLifecycleAwayAsSoftTelemetry(source)) {
        recordSoftLifecycleTelemetry(source, "send_suppressed");
        return;
      }
      const token = leaveSignalTokenRef.current;
      if (!token) return;
      leaveSignalSentRef.current = true;
      const postLeaveSignal = async (idempotencyKey?: string) => {
        const response = await fetch(
          `${SUPABASE_URL}/functions/v1/daily-room`,
          {
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
          },
        );
        const payload = await response.json().catch(() => null);
        if (
          !response.ok ||
          (payload as { success?: boolean } | null)?.success === false
        ) {
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
            operation: (_attempt, idempotencyKey) =>
              postLeaveSignal(idempotencyKey),
            isSuccess: (payload) =>
              (payload as { success?: boolean } | null)?.success !== false,
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
        void postLeaveSignal()
          .then(() => markSent())
          .catch(() => {
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
      source: Extract<
        WebLifecycleLeaveSource,
        "visibilitychange" | "pagehide" | "freeze"
      >,
    ) => {
      if (
        showFeedback ||
        surveyOpenedRef.current ||
        terminalSurveyRecoveryInFlightRef.current ||
        explicitEndRequestedRef.current !== "idle"
      ) {
        return;
      }
      if (phaseRef.current === "ended") return;
      if (leaveSignalSentRef.current) return;
      if (shouldTreatLifecycleAwayAsSoftTelemetry(source)) {
        recordSoftLifecycleTelemetry(source, "schedule_suppressed");
        return;
      }
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

    const sendLifecycleAwayIfGraceElapsed = (
      source: Extract<WebLifecycleLeaveSource, "pagehide" | "freeze">,
    ) => {
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
      if (
        isConnected &&
        !showFeedback &&
        explicitEndRequestedRef.current === "idle"
      ) {
        e.preventDefault();
        e.returnValue =
          "You're in a video date. Are you sure you want to leave?";
      }
      const softLifecycleAway =
        shouldTreatLifecycleAwayAsSoftTelemetry("beforeunload");
      if (softLifecycleAway) {
        recordSoftLifecycleTelemetry("beforeunload", "beforeunload_suppressed");
      } else {
        sendLeaveSignal("beforeunload");
      }

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

      if (!softLifecycleAway && localVideoRef.current?.srcObject) {
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
      if (shouldTreatLifecycleAwayAsSoftTelemetry("pagehide")) {
        clearLifecycleAwayTimer();
        recordSoftLifecycleTelemetry("pagehide", "pagehide_suppressed");
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
  }, [
    id,
    user?.id,
    eventId,
    isConnected,
    isConnecting,
    dailyMeetingState,
    localInDailyRoom,
    showFeedback,
    terminalSurveyRecoveryActive,
    videoDateAccess,
    localVideoRef,
  ]);

  // Record user's explicit handshake decision.
  const handleHandshakeDecision = useCallback(
    async (action: "vibe" | "pass"): Promise<boolean> => {
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
            const { data, error } =
              action === "vibe" && continueHandshakeV2.enabled
                ? await supabase.rpc(
                    "video_session_continue_handshake_v2" as never,
                    {
                      p_session_id: args.p_session_id,
                      p_idempotency_key: buildVideoDateTransitionIdempotencyKey(
                        args.p_session_id,
                        "continue_handshake",
                      ),
                    } as never,
                  )
                : await supabase.rpc("video_date_transition", args);
            return {
              data: data ?? null,
              error: error
                ? { code: error.code, message: error.message, name: error.name }
                : null,
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
              error: error
                ? { code: error.code, message: error.message, name: error.name }
                : null,
            };
          },
          log: (event, payload) => {
            vdbg(event, {
              ...payload,
              currentPhase: phaseRef.current,
            });
            if (event === "handshake_decision_rpc_after") {
              vdbg("video_date_transition_after", {
                action,
                sessionId: id,
                actorUserId: user.id,
                currentPhase: phaseRef.current,
                ok: payload.ok,
                payload: payload.rpcPayload ?? null,
                error: payload.error ?? null,
                participant_1_liked: payload.participant_1_liked ?? null,
                participant_2_liked: payload.participant_2_liked ?? null,
                participant_1_decided_at:
                  payload.participant_1_decided_at ?? null,
                participant_2_decided_at:
                  payload.participant_2_decided_at ?? null,
                actorDecisionPersisted: payload.actorDecisionPersisted,
              });
            }
          },
        });

        if (!("reason" in result)) {
          setHandshakeTruth(result.truth);
          const transitionedToDate =
            action === "vibe" &&
            (result.state === "date" ||
              result.truth.state === "date" ||
              result.truth.phase === "date" ||
              Boolean(result.truth.date_started_at));
          if (transitionedToDate) {
            clearHandshakeGraceState();
            markDateFlowEntered();
            const dateStartedAt =
              result.truth.date_started_at ?? new Date().toISOString();
            const nextExtraSeconds = normalizedDateExtraSeconds(
              result.truth.date_extra_seconds,
            );
            setDateStartedAt(dateStartedAt);
            setDateExtraSeconds(nextExtraSeconds);
            setPhase("date");
            setTimeLeft(
              remainingDatePhaseSeconds({
                dateStartedAtIso: dateStartedAt,
                baseDateSeconds: DATE_TIME,
                dateExtraSeconds: nextExtraSeconds,
              }),
            );
            setShowMutualToast(true);
          }
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
            participant_1_decided_at:
              result.truth.participant_1_decided_at ?? null,
            participant_2_decided_at:
              result.truth.participant_2_decided_at ?? null,
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
          participant_1_decided_at:
            result.truth?.participant_1_decided_at ?? null,
          participant_2_decided_at:
            result.truth?.participant_2_decided_at ?? null,
          completeHandshakeTriggeredAfterPersistence: false,
          completeHandshakeTriggerReason: "decision_not_persisted",
        });
        const sessionEnded = handshakeDecisionFailureIndicatesSessionEnded({
          truth: result.truth,
          rpcPayload: result.rpcPayload,
        });
        if (sessionEnded) {
          clearHandshakeGraceState();
          const recovered = await recoverLifecycleRpcTerminalSurvey(
            "handshake_decision_terminal_survey",
            result.rpcPayload,
          );
          if (recovered) return false;
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
    },
    [
      id,
      user?.id,
      continueHandshakeV2.enabled,
      clearHandshakeGraceState,
      markDateFlowEntered,
      endCall,
      recoverLifecycleRpcTerminalSurvey,
    ],
  );

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

  const handshakeUiState = useMemo(
    () => resolveVideoDateHandshakeUiState(handshakeTruth, user?.id),
    [handshakeTruth, user?.id],
  );
  const localHandshakeDecision = handshakeUiState.localDecision;
  const localHandshakeHasDecided = handshakeUiState.localHasDecided;
  const partnerHandshakeHasDecided = handshakeUiState.partnerHasDecided;

  // Check mutual vibe at the backend-owned handshake deadline.
  const checkMutualVibe = useCallback(
    async (source = "handshake_server_deadline", allowRetry = true) => {
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

      if (allowRetry && firstRemoteFrameAtMsRef.current != null) {
        const mediaAge = Date.now() - firstRemoteFrameAtMsRef.current;
        const deferMs = MIN_DECISION_WINDOW_AFTER_REMOTE_FRAME_MS - mediaAge;
        if (deferMs > 0) {
          vdbg("complete_handshake_deferred_for_remote_frame_window", {
            sessionId: id,
            source,
            deferMs,
            mediaAgeMs: mediaAge,
          });
          setTimingRefreshNonce((n) => n + 1);
          if (handshakeCompletionRetryTimerRef.current) {
            clearTimeout(handshakeCompletionRetryTimerRef.current);
          }
          handshakeCompletionRetryTimerRef.current = setTimeout(() => {
            handshakeCompletionRetryTimerRef.current = null;
            void checkMutualVibe(`${source}_after_remote_frame_window`, false);
          }, deferMs + 200);
          return;
        }
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
          ...handshakeTruthLogPayload(
            (truthBefore as VideoDateHandshakeTruth | null) ?? null,
          ),
        });
        vdbg("video_date_transition_before", {
          action: "complete_handshake",
          source,
          args,
        });
        const { data: result, error } = handshakeAutoPromoteV2.enabled
          ? await supabase.rpc(
              "video_session_handshake_auto_promote_v2" as never,
              {
                p_session_id: args.p_session_id,
                p_idempotency_key: buildVideoDateTransitionIdempotencyKey(
                  args.p_session_id,
                  "handshake_auto_promote",
                ),
              } as never,
            )
          : await supabase.rpc("video_date_transition", args);
        if (phaseRef.current !== "handshake") return;
        const { data: truthAfter } = await supabase
          .from("video_sessions")
          .select(VIDEO_DATE_HANDSHAKE_TRUTH_SELECT)
          .eq("id", id)
          .maybeSingle();
        setHandshakeTruth(
          (truthAfter as VideoDateHandshakeTruth | null) ?? null,
        );
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
          ...handshakeTruthLogPayload(
            (truthAfter as VideoDateHandshakeTruth | null) ?? null,
          ),
        });

        if (error || !result) {
          scheduleRetry(error ? "rpc_error" : "null_result");
          return;
        }

        const payload = result as CompleteHandshakePayload | null;
        const handledLifecycleTerminalSurvey =
          await recoverLifecycleRpcTerminalSurvey(
            "complete_handshake_lifecycle_terminal_survey",
            payload,
          );
        if (handledLifecycleTerminalSurvey) {
          void endCall("complete_handshake_lifecycle_terminal_survey");
          return;
        }
        if (payload?.success === false && payload.retryable === true) {
          scheduleRetry(
            payload.code ?? payload.reason ?? "retryable_transition_payload",
          );
          return;
        }
        if (payload?.state === "date") {
          const dateTruth =
            (truthAfter as VideoDateHandshakeTruth | null) ?? null;
          const extraNorm = normalizedDateExtraSeconds(
            dateTruth?.date_extra_seconds,
          );
          const startedAt =
            typeof dateTruth?.date_started_at === "string"
              ? dateTruth.date_started_at
              : null;
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
          const positiveExtensionSeconds =
            payload.extended === true &&
            typeof payload.seconds_remaining === "number" &&
            Number.isFinite(payload.seconds_remaining) &&
            payload.seconds_remaining > 0
              ? Math.ceil(payload.seconds_remaining)
              : null;
          if (positiveExtensionSeconds !== null) {
            const extensionStartedAt =
              typeof payload.extension_started_at === "string"
                ? payload.extension_started_at
                : typeof (truthAfter as VideoDateHandshakeTruth | null)
                      ?.handshake_started_at === "string"
                  ? (truthAfter as VideoDateHandshakeTruth).handshake_started_at
                  : null;
            if (handshakeCompletionRetryTimerRef.current) {
              clearTimeout(handshakeCompletionRetryTimerRef.current);
              handshakeCompletionRetryTimerRef.current = null;
            }
            handshakeCompletionDeadlineKeyRef.current = null;
            if (extensionStartedAt) {
              setHandshakeStartedAt(extensionStartedAt);
            }
            setPhase("handshake");
            setTimeLeft(positiveExtensionSeconds);
            setTimingRefreshNonce((n) => n + 1);
            vdbg("complete_handshake_extension_applied", {
              sessionId: id,
              source,
              seconds_remaining: positiveExtensionSeconds,
              extension_started_at: extensionStartedAt,
              reason: payload.reason ?? null,
            });
            return;
          }
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
          error:
            err instanceof Error
              ? { name: err.name, message: err.message }
              : String(err),
        });
        scheduleRetry("exception");
      } finally {
        handshakeCompletionInFlightRef.current = false;
      }
    },
    [
      id,
      eventId,
      endCall,
      clearHandshakeGraceState,
      markDateFlowEntered,
      recoverTerminalPostDateSurvey,
      recoverLifecycleRpcTerminalSurvey,
      handshakeAutoPromoteV2.enabled,
    ],
  );

  useEffect(() => {
    checkMutualVibeRef.current = checkMutualVibe;
    return () => {
      if (checkMutualVibeRef.current === checkMutualVibe) {
        checkMutualVibeRef.current = null;
      }
    };
  }, [checkMutualVibe]);

  useEffect(() => {
    if (!id || phase !== "handshake" || showFeedback) {
      return;
    }

    const candidateTimeline = serverTimeline;
    const timelineForHandshake =
      timelineV2.enabled &&
      candidateTimeline !== null &&
      candidateTimeline.sessionId === id &&
      candidateTimeline.phase === "handshake"
        ? candidateTimeline
        : null;
    const timelineDeadlineMs = timelineForHandshake
      ? timelineForHandshake.phaseDeadlineAtMs
      : null;
    const startedMs = handshakeStartedAt
      ? new Date(handshakeStartedAt).getTime()
      : null;
    const legacyDeadlineMs =
      typeof startedMs === "number" && Number.isFinite(startedMs)
        ? startedMs + HANDSHAKE_TIME * 1000
        : null;
    const deadlineMs = timelineDeadlineMs ?? legacyDeadlineMs;
    if (!deadlineMs) return;

    const deadlineKey = `${id}:${deadlineMs}`;
    const localNowMs = Date.now();
    const serverNowEstimateMs =
      timelineDeadlineMs !== null && timelineForHandshake
        ? localNowMs + timelineForHandshake.clockSkewMs
        : localNowMs;
    const delayMs = Math.max(0, deadlineMs - serverNowEstimateMs);
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
    serverTimeline,
    showFeedback,
    timelineV2.enabled,
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
  }, [
    id,
    eventId,
    clearHandshakeGraceState,
    markDateFlowEntered,
    dateExtraSeconds,
    dateStartedAt,
  ]);

  const handleExtend = useCallback(
    async (
      minutes: number,
      type: "extra_time" | "extended_vibe",
    ): Promise<VideoDateExtendOutcome> => {
      if (extensionSpendInFlightRef.current) {
        return { ok: false, userMessage: "", silent: true };
      }
      if (!id) {
        return {
          ok: false,
          userMessage: userMessageForExtensionSpendFailure("session_not_found"),
        };
      }
      extensionSpendInFlightRef.current = true;
      const useMutualExtension = extensionMutualV2.enabled;
      const retry =
        extensionSpendRetryRef.current?.type === type &&
        extensionSpendRetryRef.current.mutual === useMutualExtension
          ? extensionSpendRetryRef.current
          : null;
      const idempotencyKey =
        retry?.key ??
        (useMutualExtension
          ? makeMutualExtensionIdempotencyKey(id, type)
          : makeExtensionIdempotencyKey(id, type));
      extensionSpendRetryRef.current = {
        type,
        key: idempotencyKey,
        mutual: useMutualExtension,
      };
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_EXTENSION_ATTEMPTED, {
        platform: "web",
        session_id: id,
        event_id: eventId,
        credit_type: type,
      });
      const extensionMode = useMutualExtension
        ? "mutual_v2"
        : extensionV2.enabled
          ? "single_v2"
          : "legacy";
      const extensionRefreshStartedAt = Date.now();
      const trackExtensionRefreshCheckpoint = (
        checkpoint:
          | "extension_refresh_started"
          | "extension_refresh_success"
          | "extension_refresh_failure",
        outcome: "success" | "failure",
        reasonCode?: string | null,
        extra?: Record<string, string | number | boolean | null | undefined>,
      ) => {
        const durationMs =
          checkpoint === "extension_refresh_started"
            ? null
            : Math.max(0, Date.now() - extensionRefreshStartedAt);
        trackDailyPerformanceCheckpoint({
          checkpoint,
          sourceAction: checkpoint,
          outcome,
          reasonCode,
          durationMs,
          extra: {
            daily_performance_segment: "extension_refresh",
            extension_refresh_ms: durationMs,
            extension_mode: extensionMode,
            credit_type: type,
            extension_mutual: useMutualExtension,
            ...(extra ?? {}),
          },
        });
      };
      trackExtensionRefreshCheckpoint("extension_refresh_started", "success");
      try {
        const { data, error } = useMutualExtension
          ? await supabase.rpc(
              "video_session_request_extension_v2" as never,
              {
                p_session_id: id,
                p_credit_type: type,
                p_idempotency_key: idempotencyKey,
              } as never,
            )
          : extensionV2.enabled
            ? await supabase.rpc(
                "video_session_extend_date_v2" as never,
                {
                  p_session_id: id,
                  p_credit_type: type,
                  p_idempotency_key: idempotencyKey,
                } as never,
              )
            : await supabase.rpc("spend_video_date_credit_extension", {
                p_session_id: id,
                p_credit_type: type,
                p_idempotency_key: idempotencyKey,
              } as never);
        if (error) {
          captureSupabaseError(
            useMutualExtension
              ? "video_session_request_extension_v2"
              : extensionV2.enabled
                ? "video_session_extend_date_v2"
                : "spend_video_date_credit_extension",
            error,
          );
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_EXTENSION_FAILED, {
            platform: "web",
            session_id: id,
            event_id: eventId,
            credit_type: type,
            reason: "rpc_transport",
          });
          trackExtensionRefreshCheckpoint(
            "extension_refresh_failure",
            "failure",
            "rpc_transport",
            {
              extension_awaiting_partner: false,
              extension_applied: false,
            },
          );
          void refetchCredits();
          return {
            ok: false,
            userMessage: userMessageForExtensionSpendFailure("rpc_transport"),
          };
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
          trackExtensionRefreshCheckpoint(
            "extension_refresh_failure",
            "failure",
            parsed.error,
            {
              extension_awaiting_partner: false,
              extension_applied: false,
            },
          );
          void refetchCredits();
          return {
            ok: false,
            userMessage: userMessageForExtensionSpendFailure(parsed.error),
          };
        }
        extensionSpendRetryRef.current = null;
        if (parsed.awaitingPartner === true) {
          setPendingPartnerExtension(null);
          Sentry.addBreadcrumb({
            category: "credits",
            message: "Requested mutual Video Date extension",
            level: "info",
            data: {
              credit_type: type,
              request_expires_at: parsed.requestExpiresAt ?? null,
            },
          });
          trackEvent("video_date_extension_requested", {
            platform: "web",
            session_id: id,
            event_id: eventId,
            credit_type: type,
            request_expires_at: parsed.requestExpiresAt ?? null,
          });
          trackExtensionRefreshCheckpoint(
            "extension_refresh_success",
            "success",
            "awaiting_partner",
            {
              extension_awaiting_partner: true,
              extension_applied: false,
            },
          );
          return {
            ok: true,
            awaitingPartner: true,
            mutual: parsed.mutual === true,
            minutesAdded: 0,
            secondsAdded: 0,
            dateExtraSeconds,
            requestExpiresAt: parsed.requestExpiresAt ?? null,
          };
        }
        const addedSeconds = Math.max(
          0,
          Math.floor(parsed.addedSeconds ?? minutes * 60),
        );
        const nextExtra =
          parsed.dateExtraSeconds !== undefined
            ? Math.max(0, Math.floor(parsed.dateExtraSeconds))
            : Math.max(0, dateExtraSeconds + addedSeconds);
        setPendingPartnerExtension(null);
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
        trackExtensionRefreshCheckpoint(
          "extension_refresh_success",
          "success",
          "extension_applied",
          {
            extension_awaiting_partner: false,
            extension_applied: true,
          },
        );
        void refetchCredits();
        return {
          ok: true,
          mutual: parsed.mutual === true,
          minutesAdded: addedSeconds / 60,
          secondsAdded: addedSeconds,
          dateExtraSeconds: nextExtra,
        };
      } catch (error) {
        captureSupabaseError("video_date_extension_refresh_exception", error);
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_EXTENSION_FAILED, {
          platform: "web",
          session_id: id,
          event_id: eventId,
          credit_type: type,
          reason: "exception",
        });
        trackExtensionRefreshCheckpoint(
          "extension_refresh_failure",
          "failure",
          "exception",
          {
            extension_awaiting_partner: false,
            extension_applied: false,
          },
        );
        void refetchCredits();
        return {
          ok: false,
          userMessage: userMessageForExtensionSpendFailure("rpc_transport"),
        };
      } finally {
        extensionSpendInFlightRef.current = false;
      }
    },
    [
      dateExtraSeconds,
      dateStartedAt,
      eventId,
      extensionMutualV2.enabled,
      extensionV2.enabled,
      id,
      refetchCredits,
      trackDailyPerformanceCheckpoint,
    ],
  );

  // End call: server-owned `video_date_transition(end, …)` + survey/navigation UX (no direct session row writes here).
  const handleCallEnd = useCallback(
    async (reason: VideoDateEndReason = "ended_from_client") => {
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
          : HANDSHAKE_TIME +
            effectiveDateDurationSeconds(DATE_TIME, dateExtraSeconds);
      const emitConfirmedEndedAnalytics = () => {
        trackEvent("video_date_ended", {
          session_id: id,
          duration_seconds: analyticsBudgetSeconds - (timeLeft ?? 0),
          phase,
          reason,
        });
      };
      if (reason !== "date_timeout") {
        emitConfirmedEndedAnalytics();
      }
      if (!id) {
        explicitEndRequestedRef.current = "idle";
        return;
      }

      const args = {
        p_session_id: id,
        p_action: "end",
        p_reason: reason,
      };
      const useDateTimeoutV2 =
        reason === "date_timeout" && dateTimeoutV2.enabled;
      vdbg("video_date_transition_before", { action: "end", args });
      const transitionResult = await sendVideoDateSignalWithRetry({
        sessionId: id,
        action: useDateTimeoutV2 ? "phase3:date_timeout" : "end",
        operation: async (attempt, idempotencyKey) => {
          const { data, error } = useDateTimeoutV2
            ? await supabase.rpc(
                "video_session_date_timeout_v2" as never,
                {
                  p_session_id: id,
                  p_idempotency_key: idempotencyKey,
                } as never,
              )
            : await supabase.rpc("video_date_transition", args);
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
        isSuccess: (data) => {
          const payload =
            data && typeof data === "object" && !Array.isArray(data)
              ? (data as Record<string, unknown>)
              : null;
          if (payload?.success === false) {
            return (
              videoDateLifecycleRpcIndicatesTerminalSurvey(payload) ||
              videoDateLifecycleRpcIndicatesTerminalStop(payload)
            );
          }
          if (!useDateTimeoutV2) return true;
          return (
            payload?.already_ended === true ||
            payload?.state === "ended" ||
            payload?.phase === "ended"
          );
        },
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
            .select(TERMINAL_SURVEY_SESSION_SELECT)
            .eq("id", id)
            .maybeSingle();
          if (videoSessionIndicatesTerminalEnd(sessionRow)) {
            const recovered = await recoverTerminalPostDateSurvey(
              "local_end_recovered_after_rpc_error",
              sessionRow,
            );
            if (!recovered) {
              toast.error("Couldn't finish ending the date. Please try again.");
              explicitEndRequestedRef.current = "idle";
              return;
            }
            explicitEndRequestedRef.current = "acked";
            return;
          }
          if (reason === "date_timeout") {
            countdownCompletionKeyRef.current = null;
            setTimingRefreshNonce((n) => n + 1);
            explicitEndRequestedRef.current = "idle";
            return;
          }
          toast.error("Couldn't finish ending the date. Please try again.");
          explicitEndRequestedRef.current = "idle";
          return;
        }

        if (reason === "date_timeout") {
          toast("Time flies! Thanks for a great date 💚", { duration: 2500 });
          emitConfirmedEndedAnalytics();
        }
        explicitEndRequestedRef.current = "acked";
        recordUserAction("video_date_end_succeeded", {
          surface: "video_date",
          session_id: id,
          phase,
          reason,
        });
        const terminalHandled =
          await confirmTerminalPostDateSurveyFromServerTruth("local_end");
        if (terminalHandled) {
          markDateFlowEntered();
          return;
        }

        recordUserAction("video_date_end_failed", {
          surface: "video_date",
          session_id: id,
          phase,
          reason,
          failure_kind: "terminal_confirmation_missing",
        });
        if (reason === "date_timeout") {
          countdownCompletionKeyRef.current = null;
          setTimingRefreshNonce((n) => n + 1);
        }
        toast.error(
          "We're still confirming the date ended. Please try again in a moment.",
        );
        explicitEndRequestedRef.current = "idle";
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
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : String(error),
        });
        toast.error("Couldn't finish ending the date. Please try again.");
        explicitEndRequestedRef.current = "idle";
      }
    },
    [
      id,
      phase,
      timeLeft,
      dateExtraSeconds,
      dateTimeoutV2.enabled,
      recoverTerminalPostDateSurvey,
      confirmTerminalPostDateSurveyFromServerTruth,
      markDateFlowEntered,
    ],
  );

  useEffect(() => {
    handleCallEndRef.current = handleCallEnd;
  }, [handleCallEnd]);

  useEffect(() => {
    if (
      !id ||
      !peerMissing.terminal ||
      showFeedback ||
      terminalSurveyRecoveryActive ||
      explicitEndRequestedRef.current !== "idle"
    ) {
      return;
    }

    const confirmedEncounter =
      phaseRef.current === "date" ||
      Boolean(dateStartedAt) ||
      videoSessionHasEncounterExposureTruth(handshakeTruth);
    if (!confirmedEncounter) return;

    const key = `${id}:post_encounter_peer_missing_terminal_suppressed`;
    if (postEncounterPeerMissingSuppressedRef.current === key) return;
    postEncounterPeerMissingSuppressedRef.current = key;

    vdbg("post_encounter_peer_missing_terminal_end_suppressed", {
      sessionId: id,
      userId: user?.id ?? null,
      eventId: eventId ?? null,
      phase: phaseRef.current,
      dateStartedAt,
      hasEncounterExposureTruth:
        videoSessionHasEncounterExposureTruth(handshakeTruth),
    });
    trackEvent(LobbyPostDateEvents.VIDEO_DATE_NO_REMOTE_RECOVERY_FAILED, {
      platform: "web",
      session_id: id,
      event_id: eventId ?? null,
      source_surface: "video_date_route",
      source_action: "post_encounter_peer_missing_terminal_end_suppressed",
      reason_code: "provider_absence_server_owned_after_encounter",
    });
  }, [
    dateStartedAt,
    eventId,
    handshakeTruth,
    id,
    peerMissing.terminal,
    showFeedback,
    terminalSurveyRecoveryActive,
    user?.id,
  ]);

  const resolveVideoDateExitTarget = useCallback(
    (overrideEventId?: string | null) => {
      const destinationEventId = overrideEventId ?? eventId;
      return destinationEventId
        ? `/event/${encodeURIComponent(destinationEventId)}/lobby`
        : "/events";
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
          const { data, error } = await supabase.rpc(
            "video_date_transition",
            args,
          );
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
        isSuccess: (data) =>
          (data as { success?: boolean } | null)?.success !== false,
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

  const retryPreDateManualEndInBackground = useCallback(
    (
      reason: VideoDateEndReason,
      source: string,
      firstStatus: VideoDateManualExitStepStatus,
    ) => {
      if (!id) return;
      window.setTimeout(() => {
        void signalPreDateManualEnd(reason).then(
          (ok) => {
            recordUserAction(
              ok
                ? "video_date_pre_date_exit_end_background_retry_succeeded"
                : "video_date_pre_date_exit_end_background_retry_failed",
              {
                surface: "video_date",
                session_id: id,
                phase: phaseRef.current,
                reason,
                source,
                first_status: firstStatus,
              },
            );
            if (!ok) {
              Sentry.captureMessage(
                "video_date_pre_date_exit_end_background_retry_failed",
                {
                  level: "warning",
                  tags: { surface: "video_date", flow: "manual_pre_date_exit" },
                  extra: {
                    session_id: id,
                    reason,
                    source,
                    first_status: firstStatus,
                  },
                },
              );
            }
          },
          (error) => {
            recordUserAction(
              "video_date_pre_date_exit_end_background_retry_exception",
              {
                surface: "video_date",
                session_id: id,
                phase: phaseRef.current,
                reason,
                source,
                first_status: firstStatus,
                error: serializeManualExitError(error),
              },
            );
            Sentry.captureException(error, {
              tags: { surface: "video_date", flow: "manual_pre_date_exit" },
              extra: {
                session_id: id,
                reason,
                source,
                first_status: firstStatus,
              },
            });
          },
        );
      }, 750);
    },
    [id, signalPreDateManualEnd],
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
        clearVideoDateRouteOwnership(id, user?.id ?? null);
        suppressDateNavigationAfterManualExit(id);
      }
      setPhase("ended");
      setTimeLeft(0);
      setShowFeedback(false);
      void setStatus("browsing");

      const [dailyCleanup, serverEnd] = await Promise.all([
        runVideoDateManualExitStep("daily_cleanup", () => endCall(source)),
        runVideoDateManualExitStep("server_end", () =>
          signalPreDateManualEnd(reason),
        ),
      ]);
      if (serverEnd.status !== "completed") {
        retryPreDateManualEndInBackground(reason, source, serverEnd.status);
      }

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
      retryPreDateManualEndInBackground,
      setStatus,
      signalPreDateManualEnd,
      user?.id,
    ],
  );

  const handleLeave = useCallback(
    async (opts?: { reason?: VideoDateEndReason }) => {
      const hasDateEntryTruth =
        hasEnteredDateFlowRef.current ||
        phaseRef.current === "date" ||
        Boolean(dateStartedAt) ||
        videoSessionHasEncounterExposureTruth(handshakeTruth);
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
    },
    [
      dateStartedAt,
      endCall,
      handleCallEnd,
      handlePreDateExit,
      clearHandshakeGraceState,
      handshakeTruth,
      id,
      phase,
    ],
  );

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
    trackEvent(
      LobbyPostDateEvents.VIDEO_DATE_PEER_MISSING_TERMINAL_IMPRESSION,
      {
        platform: "web",
        session_id: id,
        event_id: eventId ?? null,
      },
    );
  }, [eventId, id, peerMissing.terminal]);

  useEffect(() => {
    if (
      !id ||
      videoDateAccess !== "allowed" ||
      showFeedback ||
      terminalSurveyRecoveryActive ||
      phase === "ended"
    )
      return;
    if (mediaPermissionError) return;
    const shouldReconcileTerminalSurvey =
      peerMissing.terminal ||
      remotePlayback.playRejected ||
      isConnecting ||
      !isConnected;
    if (!shouldReconcileTerminalSurvey) return;

    let cancelled = false;
    let inFlight = false;
    const reconcileTerminalSurvey = async (source: string) => {
      if (
        cancelled ||
        inFlight ||
        surveyOpenedRef.current ||
        terminalSurveyRecoveryInFlightRef.current
      )
        return;
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
    terminalSurveyRecoveryActive,
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
      trackEvent(
        LobbyPostDateEvents.VIDEO_DATE_PEER_MISSING_BACK_TO_LOBBY_TAP,
        {
          platform: "web",
          session_id: id,
          event_id: eventId ?? null,
        },
      );
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_NO_REMOTE_USER_EXIT, {
        platform: "web",
        session_id: id,
        event_id: eventId ?? null,
        source: "peer_missing_back_to_lobby",
      });
    }
    const hasDateEntryTruth =
      hasEnteredDateFlowRef.current ||
      phaseRef.current === "date" ||
      Boolean(dateStartedAt) ||
      videoSessionHasEncounterExposureTruth(handshakeTruth);
    if (hasDateEntryTruth) {
      void handleLeave({ reason: "partner_absent_after_confirmed_encounter" });
      return;
    }
    void handlePreDateExit({
      reason: "partial_join_peer_timeout",
      source: "peer_missing_back_to_lobby",
    });
  }, [
    dateStartedAt,
    eventId,
    handleLeave,
    handlePreDateExit,
    handshakeTruth,
    id,
  ]);

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

  const handleReportOnlySafetySuccess = useCallback(
    async (outcome: VideoDateSafetySubmitOutcome) => {
      setSafetySubmitOutcome(outcome);
      if (outcome.alsoBlock || outcome.ended) {
        setShowProfileSheet(false);
        setShowInCallSafety(false);
      }
      if (!outcome.ended) return;
      await endCall("end_after_in_call_report");
      explicitEndRequestedRef.current = "acked";
      setShowFeedback(false);
      const target = resolveVideoDateExitTarget(eventId);
      vdbgRedirect(target, "safety_report_report_only_ended", {
        sessionId: id ?? null,
        eventId: eventId ?? null,
      });
      navigate(target, { replace: true });
    },
    [endCall, eventId, id, navigate, resolveVideoDateExitTarget],
  );

  const handleServerEndedAfterInCallReport = useCallback(
    async (
      result: { surveyRequired?: boolean },
      outcome?: VideoDateSafetySubmitOutcome,
    ) => {
      setSafetySubmitOutcome((current) =>
        outcome
          ? {
              ...outcome,
              ended: true,
              surveyRequired: result.surveyRequired === true,
            }
          : current
            ? {
                ...current,
                ended: true,
                surveyRequired: result.surveyRequired === true,
              }
            : {
                mode: "end",
                alsoBlock: false,
                ended: true,
                surveyRequired: result.surveyRequired === true,
                idempotent: false,
                reportRecorded: true,
                nextDestination:
                  result.surveyRequired === true ? "survey" : "lobby",
              },
      );
      setShowProfileSheet(false);
      await endCall("end_after_in_call_report");
      explicitEndRequestedRef.current = "acked";
      recordUserAction("video_date_safety_end_succeeded", {
        surface: "video_date",
        session_id: id,
        phase,
        survey_required: result.surveyRequired === true,
      });
      if (result.surveyRequired === true) {
        const terminalHandled =
          await confirmTerminalPostDateSurveyFromServerTruth(
            "safety_report_server_ended",
          );
        if (terminalHandled) {
          markDateFlowEntered();
          return;
        }
        toast.error("We recorded your report and are syncing the date ending.");
      }
      setShowFeedback(false);
      const target = resolveVideoDateExitTarget(eventId);
      vdbgRedirect(target, "safety_report_server_ended_no_survey", {
        sessionId: id ?? null,
        eventId: eventId ?? null,
      });
      navigate(target, { replace: true });
    },
    [
      confirmTerminalPostDateSurveyFromServerTruth,
      endCall,
      eventId,
      id,
      markDateFlowEntered,
      navigate,
      phase,
      resolveVideoDateExitTarget,
    ],
  );

  useEffect(() => {
    if (!dupBlocked || videoDateAccess !== "allowed" || showFeedback) {
      setShowDuplicateTabConflict(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setShowDuplicateTabConflict(true);
      vdbg("duplicate_tab_conflict_visible", {
        sessionId: id ?? null,
        eventId: eventId ?? null,
        userId: user?.id ?? null,
        callStarted,
      });
    }, DUPLICATE_TAB_CONFLICT_STABLE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    callStarted,
    dupBlocked,
    eventId,
    id,
    showFeedback,
    user?.id,
    videoDateAccess,
  ]);

  const totalTime =
    phase === "handshake"
      ? HANDSHAKE_TIME
      : effectiveDateDurationSeconds(DATE_TIME, dateExtraSeconds);
  const handshakeTimerDisplayLeft = timeLeft ?? 0;
  const handshakeTimerTotal = totalTime;
  const handshakeTimerStarted =
    phase !== "handshake" || Boolean(handshakeStartedAt);
  const partnerFirstName = partner.name.trim().split(/\s+/)[0] || partner.name;
  const isUrgent = phase === "date" && (timeLeft ?? 999) <= 10;
  const suppressPartnerControlsAfterSafety =
    safetySubmitOutcome?.alsoBlock === true ||
    safetySubmitOutcome?.ended === true;
  const canOpenInCallSafety = Boolean(
    partnerId &&
    id &&
    !showFeedback &&
    phase !== "ended" &&
    !suppressPartnerControlsAfterSafety,
  );
  const transportReconnectVisible =
    dailyReconnectState === "interrupted" ||
    dailyReconnectState === "partner_reconnecting" ||
    dailyReconnectState === "partner_left_grace" ||
    dailyReconnectState === "failed_after_grace";
  const reconnectOverlayMode =
    dailyReconnectState === "partner_left_grace"
      ? "partner_away"
      : "network_interrupted";
  const anyReconnectVisible =
    transportReconnectVisible || reconnection.isPartnerDisconnected;

  useEffect(() => {
    if (!resilienceV2.enabled) return;
    if (anyReconnectVisible) {
      captureRemoteFrameSnapshot("reconnect_visible");
      return;
    }
    if (isConnected) {
      setRemoteFrameSnapshotUrl(null);
    }
  }, [
    anyReconnectVisible,
    captureRemoteFrameSnapshot,
    isConnected,
    resilienceV2.enabled,
  ]);

  const showFloatingIceBreaker = shouldShowVideoDateIceBreaker({
    baseVisible:
      isConnected &&
      remotePlayback.participantPresent &&
      showIceBreaker &&
      !showFeedback &&
      !showMutualToast &&
      !remotePlayback.playRejected &&
      !peerMissing.terminal &&
      !anyReconnectVisible &&
      (phase === "handshake" || phase === "date"),
    phase,
    localHasDecided: localHandshakeHasDecided,
  });
  const showCollapsedIceBreaker = shouldShowVideoDateIceBreaker({
    baseVisible:
      isConnected &&
      remotePlayback.participantPresent &&
      !showIceBreaker &&
      !showFeedback &&
      !showMutualToast &&
      !remotePlayback.playRejected &&
      !peerMissing.terminal &&
      !anyReconnectVisible &&
      (phase === "handshake" || phase === "date"),
    phase,
    localHasDecided: localHandshakeHasDecided,
  });
  const iceBreakerPositionClass =
    phase === "handshake" && handshakeTimerStarted
      ? "bottom-[14rem]"
      : "bottom-[6.75rem]";

  useEffect(() => {
    if (!id || !handshakeTimerStarted || phase !== "handshake") return;
    const key = `${id}:warmup_timer_started`;
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
        <h1 className="text-xl font-display font-semibold">
          We couldn&apos;t open this date
        </h1>
        <p className="text-muted-foreground text-sm max-w-sm">
          This link may be invalid or the session no longer exists.
        </p>
        <Button
          type="button"
          onClick={() => {
            vdbgRedirect("/events", "not_found_back_to_events", {
              sessionId: id ?? null,
            });
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
      <div className="min-h-screen bg-[#050507] text-white flex flex-col">
        <div className="flex-1 relative overflow-hidden">
          <div className="absolute inset-0 bg-[#050507]" />
          <div className="absolute inset-x-5 top-5 flex items-center justify-between text-xs text-white/60">
            <span className="font-medium">Vibely Video Date</span>
            <span>Opening room</span>
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="w-24 h-24 rounded-full border border-white/12 bg-white/[0.04] flex items-center justify-center shadow-[0_0_42px_rgba(255,255,255,0.08)]">
              <div className="w-12 h-12 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            </div>
            <div>
              <p className="text-lg font-display font-semibold">
                Opening your date
              </p>
              <p className="text-sm text-white/55 mt-1">
                Preparing camera, room, and timing together.
              </p>
            </div>
          </div>
          <div className="absolute left-5 right-5 bottom-8 h-24 rounded-2xl border border-white/10 bg-white/[0.035]" />
        </div>
      </div>
    );
  }

  if (videoDateAccess === "denied") {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center gap-4">
        <User className="w-14 h-14 text-muted-foreground" />
        <h1 className="text-xl font-display font-semibold">
          You don&apos;t have access to this date
        </h1>
        <p className="text-muted-foreground text-sm max-w-sm">
          This video date is for matched participants only.
        </p>
        <Button
          type="button"
          onClick={() => {
            const target = deniedEventId
              ? `/event/${encodeURIComponent(deniedEventId)}/lobby`
              : "/events";
            vdbgRedirect(target, "denied_back", {
              sessionId: id ?? null,
              eventId: deniedEventId ?? null,
            });
            navigate(target);
          }}
        >
          {deniedEventId ? "Back to event lobby" : "Back to events"}
        </Button>
      </div>
    );
  }

  if (mediaPermissionError) {
    const permissionBlock =
      mediaPermissionResult ??
      mediaPermissionResultForStatus({
        status: "denied",
        kind: "camera_microphone",
        permissionState: "denied",
        rawErrorMessage: mediaPermissionError,
      });
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center gap-4">
        <User className="w-14 h-14 text-muted-foreground" />
        <h1 className="text-xl font-display font-semibold">
          {mediaPermissionTitle(permissionBlock)}
        </h1>
        <p className="text-muted-foreground text-sm max-w-sm">
          {mediaPermissionMessage(permissionBlock)}
        </p>
        {permissionBlock.recoveryAction === "open_settings" ? (
          <p className="text-xs text-muted-foreground max-w-sm">
            Use the camera icon in the address bar or this browser's site
            settings, then return here.
          </p>
        ) : null}
        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            type="button"
            onClick={() => {
              trackEvent(
                LobbyPostDateEvents.VIDEO_DATE_MEDIA_PERMISSION_RETRY,
                {
                  platform: "web",
                  session_id: id,
                  event_id: eventId ?? null,
                  source: "retry_tap",
                },
              );
              nextVideoDateMediaPromptIntentRef.current = "user_retry";
              setCallStartFailure(null);
              setHandshakeStartFailed(false);
              setCallStarted(false);
              clearMediaPermissionError();
            }}
          >
            {permissionBlock.recoveryAction === "open_settings"
              ? "I updated settings"
              : "Try again"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void handlePreDateExit({
                reason: "ended_from_client",
                source: "camera_permission_denied_exit",
              });
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
        <h1 className="text-xl font-display font-semibold">
          Video date couldn&apos;t start
        </h1>
        <p className="text-muted-foreground text-sm max-w-sm">
          {messageForHandshakeFailure(handshakeFailureCode)}
        </p>
        <Button
          type="button"
          onClick={() => {
            void handlePreDateExit({
              reason: "ended_from_client",
              source: "handshake_start_failed_back",
            });
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
        <h1 className="text-xl font-display font-semibold">
          Still connecting your date
        </h1>
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
              void handlePreDateExit({
                reason: "ended_from_client",
                source: "retryable_call_start_back",
              });
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
      <div
        className="pointer-events-none absolute inset-0 hidden bg-[linear-gradient(135deg,rgba(10,10,16,0.92),rgba(5,5,9,0.98))] md:block"
        aria-hidden
      />
      {showDuplicateTabConflict &&
        videoDateAccess === "allowed" &&
        !showFeedback && (
          <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-background/95 p-6 text-center">
            <p className="text-lg font-display font-semibold text-foreground max-w-sm">
              This date is already open on another device
            </p>
            <p className="text-sm text-muted-foreground max-w-sm">
              Switch here only if you want this device to take over the live
              call.
            </p>
            <div className="flex flex-col sm:flex-row gap-2 w-full max-w-xs">
              <Button
                type="button"
                className="w-full"
                onClick={() => {
                  setShowDuplicateTabConflict(false);
                  takeOver();
                }}
              >
                Switch here
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => {
                  const target = eventId
                    ? `/event/${encodeURIComponent(eventId)}/lobby`
                    : "/events";
                  vdbgRedirect(target, "duplicate_tab_back", {
                    sessionId: id ?? null,
                    eventId: eventId ?? null,
                  });
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
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
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
                      {phase === "handshake"
                        ? handshakeTimerStarted
                          ? "Warm up"
                          : "Settling in"
                        : "Live"}
                    </span>
                  </div>
                  {networkTier !== "good" && (
                    <span
                      className={`max-w-[118px] truncate text-[10px] ${networkTier === "poor" ? "text-destructive" : "text-amber-400"}`}
                    >
                      {networkTier === "poor"
                        ? "Connection is fragile"
                        : "Connection is settling"}
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
                  <span className="text-[11px] text-white/60">
                    Waiting together
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
                mutualMode={extensionMutualV2.enabled}
                pendingPartnerRequestType={
                  pendingPartnerExtension?.type ?? null
                }
                analyticsSessionId={id}
                analyticsEventId={eventId}
              />
            )}
          </div>
        </motion.div>

        {/* ─── Remote Video with Progressive Blur ─── */}
        <div
          className={REMOTE_DATE_VIDEO_CONTAINER_CLASS}
          ref={remoteContainerRef}
        >
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
                  onLeave={
                    peerMissing.terminal
                      ? handlePeerMissingLeave
                      : handlePreDateExit
                  }
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
            graceTimeLeft={
              transportReconnectVisible
                ? reconnectGraceTimeLeft
                : reconnection.graceTimeLeft
            }
            mode={
              transportReconnectVisible ? reconnectOverlayMode : "partner_away"
            }
            networkTier={networkTier}
            resilienceV2={resilienceV2.enabled}
            backdropImageUrl={
              resilienceV2.enabled
                ? (remoteFrameSnapshotUrl ?? partnerPhotoUrl)
                : null
            }
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
          {isConnected &&
            phase === "handshake" &&
            handshakeTimerStarted &&
            !showFeedback && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="absolute bottom-[7.5rem] left-0 right-0 z-[25] flex justify-center"
              >
                <VibeCheckButton
                  timeLeft={timeLeft ?? 0}
                  decision={localHandshakeDecision}
                  localHasDecided={localHandshakeHasDecided}
                  partnerHasDecided={partnerHandshakeHasDecided}
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
            onViewProfile={
              suppressPartnerControlsAfterSafety
                ? undefined
                : () => {
                    recordUserAction("video_date_control_clicked", {
                      surface: "video_date",
                      session_id: id,
                      control: "view_profile",
                    });
                    setShowProfileSheet(true);
                  }
            }
            onSafety={
              canOpenInCallSafety
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
              isConnected &&
              !showFeedback &&
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

      <AlertDialog
        open={showEndDateConfirm}
        onOpenChange={setShowEndDateConfirm}
      >
        <AlertDialogContent className="w-[min(calc(100vw-2rem),24rem)] rounded-[1.75rem] border border-white/10 bg-[rgba(12,12,16,0.94)] text-foreground shadow-[0_26px_90px_rgba(0,0,0,0.55)] backdrop-blur-2xl">
          <AlertDialogHeader className="text-center">
            <AlertDialogTitle className="font-display text-xl">
              End this date?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center text-sm leading-relaxed text-muted-foreground">
              Stay if you tapped by accident. Ending will close the call for
              you.
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
              {isLeavingVideoDate || isEndDateConfirming
                ? "Ending..."
                : "End date"}
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
        partnerProfileId={partnerId}
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
        sessionId={id || null}
        safetyV2={safetyV2.enabled || safetyAlwaysOnV2.enabled}
        onReportOnlySuccess={handleReportOnlySafetySuccess}
        onEndAfterReport={handleEndAfterInCallReport}
        onServerEndedAfterReport={handleServerEndedAfterInCallReport}
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
