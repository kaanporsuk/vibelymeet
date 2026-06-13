/**
 * Video date screen: full Vibely experience — warm-up phase (60s) with blur, vibe check,
 * mutual vibe → date (300s), controls, partner sheet, keep-the-vibe, reconnection, post-date survey.
 */

import "react-native-get-random-values";
import * as Sentry from "@sentry/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  StyleSheet,
  View,
  Text,
  Image,
  Pressable,
  ActivityIndicator,
  Platform,
  Animated,
  Dimensions,
  AppState,
  Alert,
  Easing,
  AccessibilityInfo,
  type LayoutChangeEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, router, usePathname } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { BlurView } from "expo-blur";
import { DailyMediaView } from "@daily-co/react-native-daily-js";
import type { DailyParticipant } from "@daily-co/react-native-daily-js";
import { useAuth } from "@/context/AuthContext";
import { openPermissionSettings } from "@/lib/permissionSettings";
import {
  useVideoDateSession,
  getDailyRoomTokenWithTimeout,
  VideoDateRequestTimeoutError,
  type GetDailyRoomTokenResult,
  type RoomTokenFailureCode,
  endVideoDate,
  recordEntryDecision,
  completeEntry,
  syncVideoDateReconnect,
  markReconnectPartnerAway,
  signalVideoDateLeave,
  markReconnectReturn,
  updateParticipantStatus,
  fetchPartnerProfile,
  advanceVibeQuestion,
  getOrSeedVibeQuestionState,
  submitVerdictAndCheckMutual,
  fetchUserCredits,
  spendVideoDateCreditExtension,
  ENTRY_SECONDS,
  DATE_SECONDS,
  fetchVideoSessionDateEntryTruth,
  fetchVideoSessionDateEntryTruthCoalesced,
  type PartnerProfileData,
  type VideoSessionDateEntryTruth,
  type VibeQuestionState,
} from "@/lib/videoDateApi";
import { fetchVideoDateSessionRow } from "@/lib/videoDateSessionRow";
import {
  effectiveDateDurationSeconds,
  remainingDatePhaseSeconds,
  userMessageForExtensionSpendFailure,
  type VideoDateExtendOutcome,
} from "@clientShared/matching/videoDateExtensionSpend";
import {
  resolveVideoDatePhaseCountdown,
  startedAtCountdownDeadlineMs,
} from "@clientShared/matching/videoDateCountdown";
import { videoDateEntryStartedAtIso } from "@clientShared/matching/videoDateEntryTiming";
import { resolveVideoDateTimelineCountdown } from "@clientShared/matching/videoDateTimeline";
import { nextConvergenceDelayMs } from "@clientShared/matching/convergenceScheduling";
import {
  getVideoSessionPartnerIdForUser,
  videoSessionHasEncounterExposureTruth,
  videoSessionHasPostDateSurveyTruth,
  videoSessionRowIndicatesEntryOrDate,
} from "@clientShared/matching/activeSession";
import {
  videoDateLifecycleRpcCode,
  videoDateLifecycleRpcIndicatesTerminalStop,
  videoDateLifecycleRpcIndicatesTerminalSurvey,
  videoDateLifecycleRpcRetryable,
} from "@clientShared/matching/videoDateLifecycleRpc";
import {
  adviseVideoDateTokenRecovery,
  adviseVideoSessionTruthRecovery,
} from "@clientShared/matching/videoDateRecoveryAdvisor";
import {
  isVideoDateDailyMeetingEnded,
  isVideoDateTokenRefreshRateLimited,
  isVideoDateTokenRefreshTerminal,
  videoDateTokenRefreshRetryAfterMs,
} from "@clientShared/matching/videoDatePublicApi";
import {
  buildVideoDateMutualExtensionIdempotencyKey,
} from "@clientShared/matching/videoDateTransitionCommands";
import type { VideoDateSessionBroadcastEvent } from "@clientShared/matching/videoDateSessionChannel";
import { entryDecisionFailureIndicatesSessionEnded } from "@clientShared/matching/videoDateEntryPersistence";
import {
  LEGACY_VIDEO_DATE_ENTRY_GRACE_EXPIRED_REASON,
  LEGACY_VIDEO_DATE_ENTRY_TIMEOUT_REASON,
  isVideoDateEntryPhase,
} from "@clientShared/matching/videoDateEntryCompatibility";
import {
  createVideoDateCameraSwitchRenderHint,
  parseVideoDateCameraSwitchRenderHint,
} from "@clientShared/matching/videoDateCameraSwitchRenderHint";
import { resolveNativeCameraSwitchCommit } from "@clientShared/chat/nativeCameraSwitchCommit";
import { VibeCheckButton } from "@/components/video-date/VibeCheckButton";
import { IceBreakerCard } from "@/components/video-date/IceBreakerCard";
import { EntryPhaseTimer } from "@/components/video-date/EntryPhaseTimer";
import { ConnectionOverlay } from "@/components/video-date/ConnectionOverlay";
import { VideoDateControls } from "@/components/video-date/VideoDateControls";
import { PartnerProfileSheet } from "@/components/video-date/PartnerProfileSheet";
import { KeepTheVibe } from "@/components/video-date/KeepTheVibe";
import { ReconnectionOverlay } from "@/components/video-date/ReconnectionOverlay";
import { MutualVibeToast } from "@/components/video-date/MutualVibeToast";
import { PostDateSurvey } from "@/components/video-date/PostDateSurvey";
import { InCallSafetySheet } from "@/components/video-date/InCallSafetySheet";
import { supabase } from "@/lib/supabase";
import { isVdbgEnabled, vdbg, vdbgRedirect } from "@/lib/vdbg";
import { fonts, spacing } from "@/constants/theme";
import Colors from "@/constants/Colors";
import { useColorScheme } from "@/components/useColorScheme";
import { trackEvent } from "@/lib/analytics";
import { setSafeAudioMode } from "@/lib/safeAudioMode";
import { requestNativeCameraMicrophonePermissions } from "@/lib/nativeMediaPermissions";
import {
  consumePreparedVideoDateEntry,
  getPreparedVideoDateEntry,
  preparedEntryBothReadyToFirstRemoteFrameMs,
  preparedEntryPrepareToJoinStartMs,
  prepareVideoDateEntry,
  rejectPreparedVideoDateEntry,
} from "@/lib/videoDatePrepareEntry";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";
import { classifyDailyRoomTokenFailureClass } from "@clientShared/matching/dailyRoomFailure";
import {
  buildReadyGateToDateLatencyPayload,
  buildVideoDateTimerDriftRecoveredPayload,
  bucketVideoDateLatencyMs,
  recordReadyGateToDateLatencyCheckpoint,
  type ReadyGateToDateLatencyCheckpoint,
  type VideoDateOperatorOutcome,
} from "@clientShared/observability/videoDateOperatorMetrics";
import { getVideoDatePermissionHandoff } from "@clientShared/matching/videoDatePermissionHandoff";
import { LiveSurfaceOfflineStrip } from "@/components/connectivity/LiveSurfaceOfflineStrip";
import { avatarUrl } from "@/lib/imageUrl";
import {
  clearDateEntryTransition,
  clearVideoDateRouteOwnership,
  isDateEntryTransitionActive,
  markVideoDateEntryPipelineStarted,
  markVideoDateRouteOwned,
  VIDEO_DATE_ROUTE_OWNERSHIP_REFRESH_MS,
  suppressDateNavigationAfterManualExit,
  videoDateNavigationIntents,
} from "@/lib/videoDateNavigationIntents";
import { decideVideoDateSurfaceRoute } from "@clientShared/videoDate/routeDecision";
import {
  eventLobbyHref,
  eventLobbyHrefPostSurveyComplete,
  readyGateHref,
  tabsRootHref,
} from "@/lib/activeSessionRoutes";
import {
  consumeNativeVideoDateLaunchIntent,
  videoDateLaunchBreadcrumb,
  videoDateLaunchDurationMs,
} from "@/lib/videoDateLaunchTrace";
import { RC_CATEGORY, rcBreadcrumb } from "@/lib/nativeRcDiagnostics";
import { sanitizeNativeDiagnosticRecord } from "@/lib/nativeDiagnosticsPayload";
import {
  getVideoDateJourneyEventName,
  type VideoDateJourneyEvent,
  VIDEO_DATE_RECONNECT_SYNC_OUTCOMES,
} from "@clientShared/matching/videoDateDiagnostics";
import {
  shouldPreservePrejoinAttemptOnCleanup,
  type PrejoinAttemptStep,
} from "@clientShared/matching/videoDatePrejoinAttempt";
import { markDailyJoinedWithBackoff } from "@clientShared/matching/dailyJoinedConfirmation";
import {
  createVideoDateDailyCallObjectGuarded,
  isVideoDateCameraConstraintError as isNativeVideoDateCameraConstraintError,
  type NativeVideoDateCaptureProfile,
  type VideoDateDailyCallObject,
} from "@/lib/videoDateDailyMediaConfig";
import { registerNativeVideoDateDailyCleanup } from "@/lib/nativeDailyCallInstance";
import {
  consumeNativeVideoDateDailyPrewarm,
  markNativeVideoDateDailyPrewarmFallback,
} from "@/lib/videoDateDailyPrewarm";
import {
  VIDEO_DATE_REMOTE_OBJECT_FIT,
  VIDEO_DATE_REMOTE_OBJECT_POSITION,
  videoDateAspectRatio,
} from "@clientShared/matching/videoDateMediaContract";
import type { VideoDateSafetySubmitOutcome } from "@clientShared/safety/videoDateSafetyCopy";
import {
  VIDEO_DATE_ICE_BREAKER_MANUAL_PAUSE_MS,
  normalizeVideoDateIceBreakerIndex,
  normalizeVideoDateIceBreakerQuestions,
  resolveVideoDateIceBreakerIndex,
} from "@clientShared/matching/videoDateIceBreakers";
import {
  resolveVideoDateEntryUiState,
  shouldShowVideoDateIceBreaker,
} from "@clientShared/matching/videoDatePhase4Ux";
import { shouldRefreshDailyTokenBeforeReconnect } from "@clientShared/matching/videoDatePhase4";
import {
  getVideoDateWarmupChoiceNotice,
  type VideoDateWarmupChoiceNotice,
} from "@clientShared/matching/videoDateWarmupChoiceNotice";
import { refreshVideoDateToken } from "@/lib/videoDateTokenRefresh";
import {
  getVideoDateEntryOwner,
  updateVideoDateDailyOwnerState,
  updateVideoDateEntryOwnerState,
} from "@clientShared/matching/videoDateEntryOwner";

import {
  readNativeDailyProviderSessionId,
  safeNativeDailyMeetingState,
  NATIVE_DAILY_CALL_SINGLETON_IDLE_MS,
  NATIVE_VIDEO_DATE_DAILY_GUARD_CREATE_MAX_ATTEMPTS,
  NATIVE_VIDEO_DATE_DAILY_GUARD_CREATE_RETRY_BASE_MS,
  nativeDailyCallSingletonState,
  nativePrejoinPipelineKey,
  summarizeSharedDailyError,
  destroyNativeVideoDateDailyCall,
  type DailyCallObject,
  type DailyReceiveSettingsCapable,
  type SharedDailyCallEntry,
  type NativeDailyCleanupOptions,
  type NativePrejoinPipelineEntry,
  type PrejoinAttemptState,
  type ActiveNativeDailyCallIdentity,
} from "@/lib/daily/nativeDailyCallSingleton";
import {
  NATIVE_REMOTE_RENDER_REMOUNT_DELAY_MS,
  NATIVE_CAMERA_SWITCH_RENDER_WATCH_TTL_MS,
  NATIVE_CAMERA_SWITCH_FRESH_FRAME_POLL_MS,
  NATIVE_CAMERA_SWITCH_FRESH_FRAME_TIMEOUT_MS,
  NATIVE_CAMERA_SWITCH_SAME_TRACK_REMOUNT_GRACE_MS,
  NATIVE_REMOTE_RENDER_REMOUNT_MAX_ATTEMPTS_PER_TRACK,
  NATIVE_REMOTE_RENDER_REMOUNT_MAX_ATTEMPTS_PER_SCOPE,
  NATIVE_CAMERA_SWITCH_COMMIT_TIMEOUT_MS,
  NATIVE_CAMERA_SWITCH_COMMIT_POLL_MS,
  getTrack,
  summarizeVideoTrackSettings,
  sleepNativeCameraSwitch,
  normalizeNativeCameraFacingMode,
  oppositeNativeCameraFacingMode,
  nativeCameraDeviceId,
  nativeCameraDeviceKey,
  nativeCameraDeviceFacingMode,
  nativeLocalCameraSnapshot,
  chooseNativeCameraDevice,
  describeNativeCameraSwitchError,
  finiteNativeStat,
  applyLocalMediaUiFromParticipant,
  dailyParticipantId,
  dailyParticipantSessionId,
  nativeRemoteRenderTrackKey,
  normalizeNativeRemoteRenderRecoveryScope,
  pruneNativeRemoteRenderAttemptMap,
  ensureNativeFrontCameraIntent,
  type NativeMediaStreamTrack,
  type NativeDailyCameraFacingMode,
  type NativeDailyCameraControls,
  type NativeDailyAppMessageControls,
  type NativeDailyStatsControls,
  type NativeLocalCameraSnapshot,
  type NativeCameraSwitchCommit,
  type NativeCameraSwitchCommitMethod,
  type NativeCameraSwitchCommitExpectation,
  type NativeRemoteRenderAttemptEntry,
  type NativeCameraSwitchRenderWatch,
} from "@/lib/daily/nativeDailyMediaHelpers";
import {
  NATIVE_VIDEO_DATE_SURFACE_CLAIM_TTL_SECONDS,
  NATIVE_VIDEO_DATE_SURFACE_CLAIM_REFRESH_MS,
  NATIVE_VIDEO_DATE_SURFACE_CLAIM_RELEASE_GRACE_MS,
  nextNativeSurfaceClaimBackoffMs,
  nativeVideoDateActiveSurfaceOwners,
  nativeVideoDateActiveSurfaceKey,
  nativeVideoDateSurfaceClientInstanceIds,
  nativeVideoDateSurfaceStorageKey,
  createNativeVideoDateClientInstanceId,
  createNativeVideoDateSurfaceOwnerId,
  getOrCreateNativeVideoDateClientInstanceId,
  getCachedNativeVideoDateClientInstanceId,
  isValidNativeVideoDateClientInstanceId,
  type NativeVideoDateSurfaceClaimResult,
} from "@/lib/videoDate/nativeVideoDateSurfaceClient";
import {
  FIRST_CONNECT_TIMEOUT_MS,
  PREJOIN_STEP_TIMEOUT_MS,
  NATIVE_BACKGROUND_GRACE_MS,
  NATIVE_VIDEO_DATE_DAILY_ALIVE_HEARTBEAT_MS,
  NATIVE_DAILY_TRANSPORT_RECONNECT_GRACE_MS,
  NATIVE_BACKGROUND_GRACE_SECONDS,
  NATIVE_BACKGROUND_RECOVERED_BANNER_MS,
  NATIVE_TERMINAL_SURVEY_CONFIRM_RETRY_DELAYS_MS,
  ICE_BREAKER_CLOCK_TICK_MS,
  DATE_CONTROLS_STACK_HEIGHT,
  DATE_PHASE_ICE_BREAKER_MIN_BOTTOM,
  ENTRY_CTA_STACK_HEIGHT,
  ENTRY_CTA_DOCK_TIGHTEN_OFFSET,
  FLOATING_CHROME_GAP,
  REMOTE_SEEN_RPC_MAX_ATTEMPTS,
  REMOTE_SEEN_RPC_RETRY_DELAY_MS,
  REMOTE_SEEN_RPC_RESTAMP_MIN_INTERVAL_MS,
  MIN_DECISION_WINDOW_AFTER_MEDIA_MS,
  sleepNativeRuntimeRecovery,
  makeMutualExtensionIdempotencyKey,
  WarmupChoiceNoticeBanner,
  networkTierFromDailyEvent,
  userMessageForTokenFailure,
  READY_GATE_RACE_RETRY_BACKOFFS_MS,
  NATIVE_PREPARE_DATE_ENTRY_RETRY_DELAYS_MS,
  dailyRoomTokenRetryDelayMs,
  refetchTruthAndCheckStartable,
  videoDateDailyDiagnostic,
  videoDateSessionDiagnostic,
  addVideoDateBreadcrumb,
  shouldRecoverPendingPostDateSurvey,
  nativeVideoSessionIndicatesTerminalEnd,
  shouldTerminalizeNativePeerMissingAbort,
  NATIVE_TERMINAL_SURVEY_SESSION_SELECT,
  NATIVE_TERMINAL_SURVEY_REGISTRATION_FALLBACK_SELECT,
  type DateTheme,
  type EntryCtaTelemetrySnapshot,
  type VideoDatePostJoinStage,
  type DailyTokenRefreshSourceAction,
  type DailyTokenRefreshFailureState,
  type NativeTerminalSurveySessionRow,
  type NativeVideoDateEndReason,
  type NativeTerminalSurveyRegistrationFallbackRow,
} from "@/lib/videoDate/videoDateScreenShared";
import { useNativeDailyAliveHeartbeat } from "@/lib/videoDate/useNativeDailyAliveHeartbeat";
import { styles } from "@/lib/videoDate/videoDateScreenStyles";
import { useNativeVideoDateCallListeners } from "@/lib/videoDate/useNativeVideoDateCallListeners";
import { useNativeVideoDateRemoteSeen } from "@/lib/videoDate/useNativeVideoDateRemoteSeen";
import { useNativeVideoDateCallEndCleanup } from "@/lib/videoDate/useNativeVideoDateCallEndCleanup";
import { useNativeVideoDateAppStateBackground } from "@/lib/videoDate/useNativeVideoDateAppStateBackground";
import { useNativeVideoDateSurfaceClaim } from "@/lib/videoDate/useNativeVideoDateSurfaceClaim";
import { useNativeVideoDateStartCall } from "@/lib/videoDate/useNativeVideoDateStartCall";
import { useNativeVideoDateCameraControls } from "@/lib/videoDate/useNativeVideoDateCameraControls";

export default function VideoDateScreen() {
  const { id: sessionId } = useLocalSearchParams<{ id: string }>();
  const pathname = usePathname();
  const { user, loading: authLoading } = useAuth();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [localTimeLeft, setLocalTimeLeft] = useState<number | null>(null);
  const [fullPartner, setFullPartner] = useState<PartnerProfileData | null>(
    null,
  );
  const [partnerId, setPartnerId] = useState<string>("");
  const [eventId, setEventId] = useState<string>("");
  const [isParticipant1, setIsParticipant1] = useState(false);
  const [vibeQuestionState, setVibeQuestionState] = useState<VibeQuestionState>(
    {
      questions: [],
      questionIndex: 0,
      questionAnchorAt: null,
    },
  );
  const [iceBreakerClockMs, setIceBreakerClockMs] = useState(() => Date.now());
  const [iceBreakerManualPause, setIceBreakerManualPause] = useState<{
    startedAtMs: number;
    untilMs: number;
  } | null>(null);
  const [showIceBreaker, setShowIceBreaker] = useState(true);
  const [showProfileSheet, setShowProfileSheet] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [controlsStackHeight, setControlsStackHeight] = useState(
    DATE_CONTROLS_STACK_HEIGHT,
  );
  const [showMutualToast, setShowMutualToast] = useState(false);
  /** Ephemeral feedback after +2 / +5 min credit (web: sonner toasts). */
  const [extendBanner, setExtendBanner] = useState<
    | { kind: "success"; minutes: number | null }
    | { kind: "pending"; message: string }
    | { kind: "error"; message: string }
    | null
  >(null);
  const [pendingPartnerExtension, setPendingPartnerExtension] = useState<{
    type: "extra_time" | "extended_vibe";
    expiresAt: string | null;
  } | null>(null);
  const [blurIntensity, setBlurIntensity] = useState(80);
  const [credits, setCredits] = useState({ extraTime: 0, extendedVibe: 0 });
  const [isExtending, setIsExtending] = useState(false);
  const [reconnectionGrace, setReconnectionGrace] = useState(0);
  const [isPartnerDisconnected, setIsPartnerDisconnected] = useState(false);
  const [isTimerPaused, setIsTimerPaused] = useState(false);
  const [nativeBackgroundStatus, setNativeBackgroundStatus] = useState<
    "none" | "grace" | "recovered"
  >("none");
  const [nativeBackgroundGraceSeconds, setNativeBackgroundGraceSeconds] =
    useState(0);
  const [showInCallSafety, setShowInCallSafety] = useState(false);
  const [safetySubmitOutcome, setSafetySubmitOutcome] =
    useState<VideoDateSafetySubmitOutcome | null>(null);
  const [isEndDateConfirming, setIsEndDateConfirming] = useState(false);
  const [netQualityTier, setNetQualityTier] = useState<
    "good" | "fair" | "poor"
  >("good");
  const [dateEntryPermissionEligible, setDateEntryPermissionEligible] =
    useState(false);
  const [captureProfile, setCaptureProfile] =
    useState<NativeVideoDateCaptureProfile>("ideal");
  const [isAbortingConnection, setIsAbortingConnection] = useState(false);
  const [surfaceClaimBlocked, setSurfaceClaimBlocked] = useState(false);
  const surfaceClaimBlockedRef = useRef(false);
  const setSurfaceClaimBlockedState = useCallback((value: boolean) => {
    surfaceClaimBlockedRef.current = value;
    setSurfaceClaimBlocked(value);
  }, []);
  const [surfaceClaimTakeoverBusy, setSurfaceClaimTakeoverBusy] =
    useState(false);
  const [nativeSurfaceClientReady, setNativeSurfaceClientReady] =
    useState(false);

  const handleSessionBroadcastEvent = useCallback(
    (event: VideoDateSessionBroadcastEvent) => {
      if (event.kind === "date_extension_requested") {
        if (event.actor && event.actor === user?.id) return;
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
        const addedSeconds =
          typeof event.payload.added_seconds === "number" &&
          Number.isFinite(event.payload.added_seconds)
            ? Math.max(0, Math.floor(event.payload.added_seconds))
            : 0;
        const requestedMinutes = addedSeconds > 0 ? addedSeconds / 60 : null;
        if (creditType) {
          setPendingPartnerExtension({
            type: creditType,
            expiresAt: effectiveRequestExpiresAt,
          });
        }
        setExtendBanner({
          kind: "pending",
          message:
            requestedMinutes == null
              ? "Your date wants to keep going. Tap +time if you do too."
              : `Your date asked for +${
                  Number.isInteger(requestedMinutes)
                    ? String(requestedMinutes)
                    : requestedMinutes.toFixed(1)
                } min. Tap Accept if you do too.`,
        });
        return;
      }
      if (event.kind !== "date_extension_applied") return;
      setPendingPartnerExtension(null);
      void (user?.id
        ? fetchUserCredits(user.id).then(setCredits)
        : Promise.resolve());
      if (event.actor && event.actor === user?.id) return;
      const addedSeconds =
        typeof event.payload.added_seconds === "number" &&
        Number.isFinite(event.payload.added_seconds)
          ? Math.max(0, Math.floor(event.payload.added_seconds))
          : 0;
      setExtendBanner({
        kind: "success",
        minutes: addedSeconds > 0 ? addedSeconds / 60 : null,
      });
    },
    [user?.id],
  );

  const {
    session,
    partner: basicPartner,
    phase,
    timeLeft: serverTimeLeft,
    timeline: serverTimeline,
    loading: sessionLoading,
    error: sessionError,
    refetch: refetchVideoSession,
    retryBroadcastGapRecovery,
  } = useVideoDateSession(sessionId ?? null, user?.id ?? null, {
    onBroadcastEvent: handleSessionBroadcastEvent,
  });
  const entryStartedAtIso = videoDateEntryStartedAtIso(session);

  const callRef = useRef<DailyCallObject | null>(null);
  const captureProfileRef = useRef<NativeVideoDateCaptureProfile>("ideal");
  const roomNameRef = useRef<string | null>(null);
  const activeNativeDailyCallIdentityRef =
    useRef<ActiveNativeDailyCallIdentity | null>(null);
  const hasStartedJoinRef = useRef(false);
  const prejoinAttemptSeqRef = useRef(0);
  const prejoinAttemptRef = useRef<PrejoinAttemptState | null>(null);
  const observedNativePrejoinPipelineKeyRef = useRef<string | null>(null);
  const phaseRef = useRef(phase);
  const localTimeLeftRef = useRef<number | null>(null);
  const countdownCompletionKeyRef = useRef<string | null>(null);
  const timerDriftTrackingReadyRef = useRef(false);
  const lastTimerDriftRecoveryKeyRef = useRef<string | null>(null);
  const latestDateRouteSessionIdRef = useRef<string | null>(null);
  const latestDateRouteUserIdRef = useRef<string | null>(null);
  const latestDateRouteEndedRef = useRef(false);
  const extensionSpendInFlightRef = useRef(false);
  const extensionSpendRetryRef = useRef<{
    type: "extra_time" | "extended_vibe";
    key: string;
    mutual: boolean;
  } | null>(null);
  const dailyReconnectPerformanceStartedAtRef = useRef<number | null>(null);
  const dailyReconnectPerformanceSourceRef = useRef<string | null>(null);
  /** True once we have ever observed a remote Daily participant (survives transient participant-left). */
  const [partnerEverJoined, setPartnerEverJoined] = useState(false);
  const prevLocalInDailyRef = useRef(false);
  /** True after local `call.join` succeeds until leave/cleanup. */
  const [localInDailyRoom, setLocalInDailyRoom] = useState(false);
  /** Terminal: bounded wait elapsed without a remote peer. */
  const [peerMissingTerminal, setPeerMissingTerminal] = useState(false);
  /** Counts truth refreshes caused by the first-remote watchdog. No automatic rejoin is attempted. */
  const peerMissingTruthRefreshCountRef = useRef(0);
  /** True after sync_reconnect reports ended (avoid calling handleCallEnd every poll tick). */
  const reconnectEndedHandledRef = useRef(false);
  const reconnectSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const reconnectSyncCountRef = useRef(0);
  const reconnectSyncWindowStartedAtRef = useRef<number | null>(null);
  const requestReconnectSyncRef = useRef<(reason: string) => void>(() => {});
  const partnerAwayAfterTransportGraceTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const videoDateClientInstanceIdRef = useRef(
    createNativeVideoDateClientInstanceId(),
  );
  const videoDateSurfaceOwnerIdRef = useRef(
    createNativeVideoDateSurfaceOwnerId(),
  );
  const routeMountIdRef = useRef(
    `vd-native-route-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`,
  );
  const surfaceClaimInFlightRef = useRef(false);
  const surfaceClaimInFlightPromiseRef =
    useRef<Promise<NativeVideoDateSurfaceClaimResult> | null>(null);
  const surfaceClaimBackoffUntilRef = useRef(0);
  const surfaceClaimFailureCountRef = useRef(0);
  const handleCallEndRef = useRef<
    ((source?: "local_end" | "server_end") => Promise<void>) | null
  >(null);
  const entryAnalyticsRef = useRef(false);
  const videoDateEndedRef = useRef(false);
  const dateEstablishedRef = useRef(false);
  const firstConnectWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const topChromeAnim = useRef(new Animated.Value(1)).current;
  const controlsAnim = useRef(new Animated.Value(1)).current;
  /** Dedupe first-time remote presence in React state (covers participant-joined / participant-updated paths). */
  const remotePromotionLoggedRef = useRef(false);
  const lastLocalMountedTrackIdRef = useRef<string | null>(null);
  const lastRemoteMountedTrackIdRef = useRef<string | null>(null);
  const localParticipantRef = useRef<DailyParticipant | null>(null);
  const remoteParticipantRef = useRef<DailyParticipant | null>(null);

  useEffect(() => {
    if (!sessionId || !user?.id) {
      setNativeSurfaceClientReady(false);
      return;
    }
    const profileId = user.id;
    const storageKey = nativeVideoDateSurfaceStorageKey(sessionId, profileId);
    const cachedInstanceId = getCachedNativeVideoDateClientInstanceId(
      sessionId,
      profileId,
    );
    if (cachedInstanceId) {
      videoDateClientInstanceIdRef.current = cachedInstanceId;
      setNativeSurfaceClientReady(true);
      return;
    }
    setNativeSurfaceClientReady(false);
    let cancelled = false;

    void AsyncStorage.getItem(storageKey)
      .then(async (stored) => {
        if (cancelled) return;
        let clientInstanceId: string;
        if (isValidNativeVideoDateClientInstanceId(stored)) {
          clientInstanceId = stored;
          nativeVideoDateSurfaceClientInstanceIds.set(
            storageKey,
            clientInstanceId,
          );
          videoDateClientInstanceIdRef.current = clientInstanceId;
          setNativeSurfaceClientReady(true);
          vdbg("native_video_date_surface_client_instance_hydrated", {
            sessionId,
            userId: profileId,
            source: "async_storage",
          });
          return;
        }
        clientInstanceId = createNativeVideoDateClientInstanceId();
        nativeVideoDateSurfaceClientInstanceIds.set(
          storageKey,
          clientInstanceId,
        );
        videoDateClientInstanceIdRef.current = clientInstanceId;
        setNativeSurfaceClientReady(true);
        await AsyncStorage.setItem(storageKey, clientInstanceId);
        vdbg("native_video_date_surface_client_instance_created", {
          sessionId,
          userId: profileId,
          source: "async_storage",
        });
      })
      .catch((error) => {
        if (cancelled) return;
        const fallbackInstanceId = getOrCreateNativeVideoDateClientInstanceId(
          sessionId,
          profileId,
        );
        videoDateClientInstanceIdRef.current = fallbackInstanceId;
        setNativeSurfaceClientReady(true);
        vdbg("native_video_date_surface_client_instance_storage_failed", {
          sessionId,
          userId: profileId,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, user?.id]);

  const markRemoteSeenOnServerRef = useRef<((source: string) => void) | null>(
    null,
  );
  const nativeCameraSwitchInFlightRef = useRef(false);
  const nativeRemoteRenderRemountTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const nativeCameraSwitchFreshnessTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const nativeCameraSwitchFreshnessSeqRef = useRef(0);
  const nativeRemoteRenderTrackAttemptsRef = useRef<
    Map<string, NativeRemoteRenderAttemptEntry>
  >(new Map());
  const nativeRemoteRenderScopedAttemptsRef = useRef<
    Map<string, NativeRemoteRenderAttemptEntry>
  >(new Map());
  const lastNativeRemoteRenderTrackKeyRef = useRef<string | null>(null);
  const lastNativeRemoteCameraSwitchHintIdRef = useRef<string | null>(null);
  const activeNativeRemoteCameraSwitchRenderWatchRef =
    useRef<NativeCameraSwitchRenderWatch | null>(null);
  const loggedJourneyRef = useRef<Set<string>>(new Set());
  const surveyOpenedRef = useRef(false);
  const terminalSurveyHardStopRef = useRef(false);
  const lastLoggedPostJoinStageRef = useRef<VideoDatePostJoinStage | null>(
    null,
  );
  /** Opacity heartbeat for the final 10 seconds of entry. */
  const lastChanceBlinkOpacity = useRef(new Animated.Value(1)).current;
  const entryCompletionInFlightRef = useRef(false);
  const entryDecisionInFlightRef = useRef(false);
  const entryCompletionDeadlineKeyRef = useRef<string | null>(null);
  const entryCompletionRetryTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const entryCtaImpressionRef = useRef<{
    key: string;
    shownAtMs: number;
    lastTimeLeft: number | null;
  } | null>(null);
  const entryCtaLastVisibleMsRef = useRef(0);
  const entryCtaLatestRef = useRef<EntryCtaTelemetrySnapshot>({
    cta_visible: false,
    cta_visible_ms: 0,
    cta_last_time_left: null,
    has_remote_partner: false,
    peer_server_joined: false,
    partner_ever_joined: false,
    is_partner_disconnected: false,
    peer_missing_terminal: false,
    remote_video_mounted: false,
    remote_audio_mounted: false,
    first_playable_remote_seen: false,
    first_playable_remote_age_ms: null,
    local_decision: "none",
  });
  const entryFinalTenNudgeKeyRef = useRef<string | null>(null);
  const peerMissingTerminalImpressionRef = useRef(false);
  const localInDailyRoomRef = useRef(false);
  const dailySdkUnresponsiveKeyRef = useRef<string | null>(null);
  const appStateBackgroundTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const appStateBackgroundIntervalRef = useRef<ReturnType<
    typeof setInterval
  > | null>(null);
  const appStateRecoveredTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const appStateAwaySessionRef = useRef<string | null>(null);
  const appStateExpiredSessionRef = useRef<string | null>(null);
  const appStateBackgroundStartedAtRef = useRef<number | null>(null);
  const bootstrapTimingsRef = useRef<Record<string, number>>({});
  const activePreparedEntryCacheRef = useRef<ReturnType<
    typeof getPreparedVideoDateEntry
  > | null>(null);
  const activePreparedEntryCacheHitRef = useRef<boolean | null>(null);
  const dailyJoinStartedAtMsRef = useRef<number | null>(null);
  const dailyPrewarmConsumedForJoinRef = useRef(false);
  const prewarmedAlreadyJoinedRef = useRef(false);
  const prewarmedJoinInFlightRef = useRef(false);
  const providerVerifySkippedRef = useRef<boolean | null>(null);
  const preparedJoinRetryUsedRef = useRef(false);
  const firstIceConnectedLoggedRef = useRef(false);
  const firstRemoteParticipantTimedRef = useRef(false);
  const firstPlayableRemoteTimedRef = useRef(false);
  const remoteSeenInFlightSessionRef = useRef<string | null>(null);
  const remoteSeenLastStampRef = useRef<{
    sessionId: string;
    stampedAtMs: number;
  } | null>(null);
  const remoteSeenRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const remoteSeenActiveSessionRef = useRef<string | null>(sessionId ?? null);
  const localVideoReadyTrackedRef = useRef(false);
  const remoteReadableTrackedRef = useRef(false);
  const warmupTimerStartedTrackedRef = useRef<string | null>(null);
  const resilienceModeTrackedKeyRef = useRef<string | null>(null);
  const resilienceDailyAdaptationKeyRef = useRef<string | null>(null);
  const abortConnectionInFlightRef = useRef(false);
  const postEncounterPeerMissingSuppressedRef = useRef<string | null>(null);
  const warmupChoiceNoticeTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const dailyTokenRefreshTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const dailyTokenRecoveryInFlightRef = useRef(false);
  const dailyTokenExpiresAtRef = useRef<string | null>(null);
  const recoverNativeDailyTokenRef = useRef<
    (
      sourceAction: DailyTokenRefreshSourceAction,
      cause?: unknown,
    ) => Promise<boolean>
  >(() => Promise.resolve(false));
  /** Epoch ms when the first playable remote track was mounted; 0 = not yet. */
  const firstPlayableRemoteAtMsRef = useRef(0);

  const [isConnecting, setIsConnecting] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const [permissionRecoveryAction, setPermissionRecoveryAction] = useState<
    string | null
  >(null);
  const permissionSettingsOpenedRef = useRef(false);
  const [warmupChoiceNotice, setWarmupChoiceNotice] =
    useState<VideoDateWarmupChoiceNotice | null>(null);
  const [localParticipant, setLocalParticipant] =
    useState<DailyParticipant | null>(null);
  const [remoteParticipant, setRemoteParticipant] =
    useState<DailyParticipant | null>(null);
  const [remoteMediaRenderNonce, setRemoteMediaRenderNonce] = useState(0);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [canFlipCamera, setCanFlipCamera] = useState(false);
  const [isFlippingCamera, setIsFlippingCamera] = useState(false);
  const [joining, setJoining] = useState(false);
  const [awaitingFirstConnect, setAwaitingFirstConnect] = useState(false);
  const [preJoinFailed, setPreJoinFailed] = useState(false);
  const [joinAttemptNonce, setJoinAttemptNonce] = useState(0);

  remoteParticipantRef.current = remoteParticipant;
  localParticipantRef.current = localParticipant;

  useEffect(() => {
    void setSafeAudioMode({
      playsInSilentModeIOS: true,
      allowsRecordingIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: false,
    });
    return () => {
      void setSafeAudioMode({
        playsInSilentModeIOS: false,
        allowsRecordingIOS: false,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
      });
    };
  }, []);

  const showWarmupChoiceNotice = useCallback(
    (notice: VideoDateWarmupChoiceNotice) => {
      if (warmupChoiceNoticeTimerRef.current) {
        clearTimeout(warmupChoiceNoticeTimerRef.current);
        warmupChoiceNoticeTimerRef.current = null;
      }
      setWarmupChoiceNotice(notice);
      warmupChoiceNoticeTimerRef.current = setTimeout(() => {
        warmupChoiceNoticeTimerRef.current = null;
        setWarmupChoiceNotice(null);
      }, 5200);
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (warmupChoiceNoticeTimerRef.current) {
        clearTimeout(warmupChoiceNoticeTimerRef.current);
        warmupChoiceNoticeTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    surveyOpenedRef.current = false;
    terminalSurveyHardStopRef.current = false;
    dailyReconnectPerformanceStartedAtRef.current = null;
    dailyReconnectPerformanceSourceRef.current = null;
    resilienceDailyAdaptationKeyRef.current = null;
    if (warmupChoiceNoticeTimerRef.current) {
      clearTimeout(warmupChoiceNoticeTimerRef.current);
      warmupChoiceNoticeTimerRef.current = null;
    }
    setWarmupChoiceNotice(null);
  }, [sessionId]);

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
        platform: "native",
        session_id: sessionId ?? null,
        event_id: eventId || null,
        ...(payload ?? {}),
      });
      vdbg(`journey_${event}`, {
        sessionId: sessionId ?? null,
        eventId: eventId || null,
        ...(payload ?? {}),
      });
    },
    [sessionId, eventId],
  );

  const openNativePostDateSurvey = useCallback(
    (
      reason: string,
      context?: {
        eventId?: string | null;
        roomName?: string | null;
        pendingPostDateSurveyDue?: boolean;
        reconnectExpiredSurveyDue?: boolean;
      },
    ) => {
      if (surveyOpenedRef.current) return false;
      surveyOpenedRef.current = true;
      if (sessionId) {
        markVideoDateRouteOwned(sessionId, user?.id ?? null);
      }
      terminalSurveyHardStopRef.current = true;
      phaseRef.current = "ended";
      setLocalTimeLeft(0);
      setIsPartnerDisconnected(false);
      setIsTimerPaused(false);
      setReconnectionGrace(0);
      setDateEntryPermissionEligible(false);
      setJoining(false);
      setIsConnecting(false);
      setPreJoinFailed(false);
      setShowFeedback(true);
      const surveyEventId = context?.eventId ?? eventId ?? null;
      const surveyRoomName = context?.roomName ?? roomNameRef.current ?? null;
      vdbg("post_date_survey_opened", {
        sessionId: sessionId ?? null,
        eventId: surveyEventId,
        roomName: surveyRoomName,
        reason,
      });
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_SURVEY_OPENED, {
        platform: "native",
        session_id: sessionId ?? null,
        event_id: surveyEventId,
        room_name: surveyRoomName,
        reason,
        source_surface: "video_date_route",
        source_action: reason,
        pendingPostDateSurveyDue: context?.pendingPostDateSurveyDue,
        reconnectExpiredSurveyDue: context?.reconnectExpiredSurveyDue,
      });
      logJourney("survey_opened", { reason }, `survey_opened_${reason}`);
      return true;
    },
    [eventId, logJourney, sessionId, user?.id],
  );

  const openNativePostDateSurveyFromTerminalTruth = useCallback(
    async (
      source: string,
      sessionOverride?: NativeTerminalSurveySessionRow | null,
    ) => {
      if (!sessionId || !user?.id) return false;
      if (surveyOpenedRef.current) {
        vdbg("post_date_survey_open_already_active", {
          sessionId,
          userId: user.id,
          source,
        });
        return true;
      }
      let sessionRow: NativeTerminalSurveySessionRow | null =
        sessionOverride ?? null;
      if (!sessionRow) {
        const { data, error } = await supabase
          .from("video_sessions")
          .select(NATIVE_TERMINAL_SURVEY_SESSION_SELECT)
          .eq("id", sessionId)
          .maybeSingle();
        if (error) {
          vdbg("terminal_post_date_survey_session_fetch_failed", {
            sessionId,
            userId: user.id,
            source,
            code: error.code ?? null,
            message: error.message,
          });
          const { data: registrationFallback, error: registrationError } =
            await supabase
              .from("event_registrations")
              .select(NATIVE_TERMINAL_SURVEY_REGISTRATION_FALLBACK_SELECT)
              .eq("profile_id", user.id)
              .eq("queue_status", "in_survey")
              .order("last_active_at", { ascending: false })
              .limit(1)
              .maybeSingle();
          if (registrationError) {
            vdbg("terminal_post_date_survey_registration_fallback_failed", {
              sessionId,
              userId: user.id,
              source,
              code: registrationError.code ?? null,
              message: registrationError.message,
            });
            return false;
          }
          const fallbackRow =
            (registrationFallback as NativeTerminalSurveyRegistrationFallbackRow | null) ??
            null;
          const fallbackMatchesCurrentRoute =
            fallbackRow?.current_room_id == null ||
            fallbackRow.current_room_id === sessionId;
          if (
            fallbackRow?.queue_status === "in_survey" &&
            fallbackMatchesCurrentRoute
          ) {
            if (fallbackRow.current_partner_id) {
              setPartnerId(fallbackRow.current_partner_id);
            }
            if (fallbackRow.event_id) setEventId(fallbackRow.event_id);
            dateEstablishedRef.current = true;
            logJourney(
              "date_route_recovered",
              { source: `${source}_registration_recovery` },
              "date_route_recovered",
            );
            logJourney(
              "survey_lost_prevented",
              { source: `${source}_registration_recovery` },
              "survey_lost_prevented",
            );
            vdbg("terminal_post_date_survey_registration_fallback", {
              sessionId,
              userId: user.id,
              source,
              eventId: fallbackRow.event_id ?? null,
              currentRoomId: fallbackRow.current_room_id ?? null,
              currentPartnerId: fallbackRow.current_partner_id ?? null,
              lastActiveAt: fallbackRow.last_active_at ?? null,
            });
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_SURVEY_RECOVERED, {
              platform: "native",
              session_id: sessionId,
              event_id: fallbackRow.event_id ?? eventId ?? null,
              room_name: roomNameRef.current ?? null,
              source_surface: "video_date_route",
              source_action: `${source}_registration_recovery`,
              outcome: "recovered",
              reason_code: `${source}_registration_recovery`,
              pendingPostDateSurveyDue: true,
              registrationFallback: true,
            });
            return openNativePostDateSurvey(`${source}_registration_recovery`, {
              eventId: fallbackRow.event_id ?? eventId ?? null,
              roomName: roomNameRef.current ?? null,
              pendingPostDateSurveyDue: true,
            });
          }
          return false;
        }
        sessionRow = data ?? null;
      }

      if (!sessionRow) return false;
      if (!nativeVideoSessionIndicatesTerminalEnd(sessionRow)) return false;

      const { data: verdict } = await supabase
        .from("date_feedback")
        .select("id")
        .eq("session_id", sessionId)
        .eq("user_id", user.id)
        .maybeSingle();

      const pendingPostDateSurveyDue = shouldRecoverPendingPostDateSurvey(
        sessionRow,
        user.id,
        verdict,
      );
      const reconnectExpiredSurveyDue =
        sessionRow.ended_reason === "reconnect_grace_expired" &&
        videoSessionHasEncounterExposureTruth(sessionRow) &&
        !verdict;
      vdbg("terminal_post_date_survey_recovery_checked", {
        sessionId,
        userId: user.id,
        source,
        pendingPostDateSurveyDue,
        verdictId: verdict?.id ?? null,
        endedAt: sessionRow.ended_at ?? null,
        endedReason: sessionRow.ended_reason ?? null,
        state: sessionRow.state ?? null,
        phase: sessionRow.phase ?? null,
        participant1Joined: Boolean(sessionRow.participant_1_joined_at),
        participant2Joined: Boolean(sessionRow.participant_2_joined_at),
      });
      if (!pendingPostDateSurveyDue) return false;

      const recoveredPartnerId =
        user.id === sessionRow.participant_1_id
          ? sessionRow.participant_2_id
          : sessionRow.participant_1_id;
      if (recoveredPartnerId) setPartnerId(recoveredPartnerId);
      if (sessionRow.event_id) setEventId(sessionRow.event_id);
      setIsParticipant1(user.id === sessionRow.participant_1_id);
      dateEstablishedRef.current = true;
      logJourney("date_route_recovered", { source }, "date_route_recovered");
      logJourney(
        "survey_recovered",
        {
          source,
          reconnectExpiredSurveyDue,
          pendingPostDateSurveyDue,
        },
        `survey_recovered_${source}`,
      );
      logJourney("survey_lost_prevented", { source }, "survey_lost_prevented");
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_SURVEY_RECOVERED, {
        platform: "native",
        session_id: sessionId,
        event_id: sessionRow.event_id ?? eventId ?? null,
        room_name: sessionRow.daily_room_name ?? roomNameRef.current ?? null,
        source_surface: "video_date_route",
        source_action: source,
        outcome: "recovered",
        reason_code: source,
        reconnectExpiredSurveyDue,
        pendingPostDateSurveyDue,
      });
      return openNativePostDateSurvey(source, {
        eventId: sessionRow.event_id ?? eventId ?? null,
        roomName: sessionRow.daily_room_name ?? roomNameRef.current ?? null,
        reconnectExpiredSurveyDue,
        pendingPostDateSurveyDue,
      });
    },
    [eventId, logJourney, openNativePostDateSurvey, sessionId, user?.id],
  );

  const confirmNativeTerminalPostDateRecovery = useCallback(
    async (
      source: string,
      sessionOverride?: NativeTerminalSurveySessionRow | null,
    ) => {
      if (!sessionId || !user?.id) return false;
      for (
        let attempt = 0;
        attempt < NATIVE_TERMINAL_SURVEY_CONFIRM_RETRY_DELAYS_MS.length;
        attempt += 1
      ) {
        const delayMs = NATIVE_TERMINAL_SURVEY_CONFIRM_RETRY_DELAYS_MS[attempt];
        if (delayMs > 0) {
          await sleepNativeRuntimeRecovery(delayMs);
        }

        const attemptSource =
          attempt === 0 ? source : `${source}_retry_${attempt}`;
        let sessionRow: NativeTerminalSurveySessionRow | null =
          attempt === 0 && sessionOverride ? sessionOverride : null;
        if (!sessionRow) {
          const { data, error } = await supabase
            .from("video_sessions")
            .select(NATIVE_TERMINAL_SURVEY_SESSION_SELECT)
            .eq("id", sessionId)
            .maybeSingle();
          if (error || !data) {
            vdbg("terminal_post_date_survey_confirmation_row_unavailable", {
              sessionId,
              userId: user.id,
              source: attemptSource,
              attempt,
              error: error?.message ?? null,
            });
          }
          sessionRow = data ?? null;
        }

        if (!nativeVideoSessionIndicatesTerminalEnd(sessionRow)) {
          if (
            attempt <
            NATIVE_TERMINAL_SURVEY_CONFIRM_RETRY_DELAYS_MS.length - 1
          ) {
            await refetchVideoSession().catch(() => undefined);
          }
          continue;
        }

        const recoveredSurvey = await openNativePostDateSurveyFromTerminalTruth(
          attemptSource,
          sessionRow,
        );
        if (recoveredSurvey) return true;

        const fallbackEventId = sessionRow?.event_id ?? eventId;
        if (fallbackEventId) {
          // Mirror web useTerminalSurveyRecovery: when the own verdict already
          // exists, release the registration before leaving so a stale
          // in_survey stamp cannot bounce the lobby back here (2026-06-12
          // acceptance-run livelock). update_participant_status refuses
          // server-side while a survey is genuinely pending.
          const { data: ownVerdict } = await supabase
            .from("date_feedback")
            .select("id")
            .eq("session_id", sessionId)
            .eq("user_id", user.id)
            .maybeSingle();
          if (ownVerdict?.id) {
            let releaseError: { code?: string } | null = null;
            let releaseAttempts = 0;
            for (let attemptIdx = 0; attemptIdx < 3; attemptIdx += 1) {
              if (attemptIdx > 0) {
                await sleepNativeRuntimeRecovery(800 * attemptIdx);
              }
              releaseAttempts = attemptIdx + 1;
              const { error } = await supabase.rpc(
                "update_participant_status",
                { p_event_id: fallbackEventId, p_status: "browsing" },
              );
              releaseError = error ?? null;
              if (!releaseError) break;
            }
            vdbg("terminal_survey_complete_registration_release", {
              sessionId,
              userId: user.id,
              source: attemptSource,
              eventId: fallbackEventId,
              released: !releaseError,
              attempts: releaseAttempts,
              code: releaseError?.code ?? null,
            });
          }
        }
        const target = fallbackEventId
          ? eventLobbyHref(fallbackEventId)
          : tabsRootHref();
        setShowFeedback(false);
        clearDateEntryTransition(sessionId);
        clearVideoDateRouteOwnership(sessionId, user.id);
        vdbgRedirect(target, `${attemptSource}_terminal_no_survey_truth`, {
          sessionId,
          userId: user.id,
          eventId: fallbackEventId ?? null,
          endedAt: sessionRow?.ended_at ?? null,
          endedReason: sessionRow?.ended_reason ?? null,
        });
        logJourney("date_route_bounced", {
          reason: `${attemptSource}_terminal_no_survey_truth`,
          target: String(target),
        });
        router.replace(target);
        return true;
      }

      vdbg("terminal_post_date_survey_confirmation_unresolved", {
        sessionId,
        userId: user.id,
        source,
        attempts: NATIVE_TERMINAL_SURVEY_CONFIRM_RETRY_DELAYS_MS.length,
      });
      return false;
    },
    [
      eventId,
      logJourney,
      openNativePostDateSurveyFromTerminalTruth,
      refetchVideoSession,
      sessionId,
      user?.id,
    ],
  );

  const beginBootstrapTiming = useCallback(
    (step: string, data?: Record<string, unknown>) => {
      if (!isVdbgEnabled()) return;
      bootstrapTimingsRef.current[step] = Date.now();
      vdbg("date_bootstrap_timing_start", {
        sessionId: sessionId ?? null,
        userId: user?.id ?? null,
        step,
        ...(data ?? {}),
      });
    },
    [sessionId, user?.id],
  );

  const endBootstrapTiming = useCallback(
    (step: string, data?: Record<string, unknown>) => {
      if (!isVdbgEnabled()) return;
      const startedAt = bootstrapTimingsRef.current[step];
      vdbg("date_bootstrap_timing_end", {
        sessionId: sessionId ?? null,
        userId: user?.id ?? null,
        step,
        duration_ms:
          typeof startedAt === "number"
            ? Math.max(0, Date.now() - startedAt)
            : null,
        ...(data ?? {}),
      });
    },
    [sessionId, user?.id],
  );

  const releaseSharedCallIfOwned = useCallback(
    (call: DailyCallObject | null, reason: string) => {
      if (!call) return;
      if (nativeDailyCallSingletonState.sharedDailyCallEntry?.call !== call) return;
      const entry = nativeDailyCallSingletonState.sharedDailyCallEntry;
      if (entry.idleDestroyTimer) {
        clearTimeout(entry.idleDestroyTimer);
        entry.idleDestroyTimer = null;
      }
      vdbg("daily_call_singleton_release", {
        reason,
        sessionId: entry.sessionId,
        userId: entry.userId,
        roomName: entry.roomName,
        state: entry.state,
        joinInFlight: Boolean(entry.joinPromise),
      });
      nativeDailyCallSingletonState.sharedDailyCallEntry = null;
    },
    [],
  );
  const parkSharedCallForWarmHandoff = useCallback(
    (call: DailyCallObject, reason: string) => {
      if (nativeDailyCallSingletonState.sharedDailyCallEntry?.call !== call) return false;
      const entry = nativeDailyCallSingletonState.sharedDailyCallEntry;
      if (entry.idleDestroyTimer) {
        clearTimeout(entry.idleDestroyTimer);
      }
      const idleMs = NATIVE_DAILY_CALL_SINGLETON_IDLE_MS;
      entry.state = "idle";
      entry.joinPromise = null;
      entry.joinStartedAtMs = null;
      entry.lastError = null;
      entry.parkedAtMs = Date.now();
      entry.idleDestroyTimer = null;
      entry.idleDestroyDisabled = idleMs == null;
      if (typeof idleMs === "number") {
        nativeDailyCallSingletonState.sharedDailyCallEntry.idleDestroyTimer = setTimeout(() => {
          const entry = nativeDailyCallSingletonState.sharedDailyCallEntry;
          if (!entry || entry.call !== call || entry.state !== "idle") return;
          const idleAgeMs = entry.parkedAtMs
            ? Math.max(0, Date.now() - entry.parkedAtMs)
            : null;
          vdbg("daily_call_singleton_idle_destroy", {
            reason: "idle_timeout",
            sessionId: entry.sessionId,
            userId: entry.userId,
            roomName: entry.roomName,
            idleMs,
            idleAgeMs,
          });
          void destroyNativeVideoDateDailyCall(
            entry.call,
            "daily_call_singleton_idle_destroy",
            {
              sessionId: entry.sessionId,
              userId: entry.userId,
              roomName: entry.roomName,
            },
          ).catch(() => undefined);
          nativeDailyCallSingletonState.sharedDailyCallEntry = null;
        }, idleMs);
      }
      vdbg("daily_call_singleton_parked", {
        reason,
        sessionId: entry.sessionId,
        userId: entry.userId,
        roomName: entry.roomName,
        idleMs,
        idleDestroyDisabled: entry.idleDestroyDisabled,
      });
      return true;
    },
    [],
  );
  const clearFirstConnectWatchdog = useCallback(() => {
    if (firstConnectWatchdogRef.current) {
      clearTimeout(firstConnectWatchdogRef.current);
      firstConnectWatchdogRef.current = null;
    }
  }, []);

  const clearDailyTokenRefreshTimer = useCallback(() => {
    if (!dailyTokenRefreshTimerRef.current) return;
    clearTimeout(dailyTokenRefreshTimerRef.current);
    dailyTokenRefreshTimerRef.current = null;
  }, []);

  const {
    clearDailyAliveHeartbeatTimer,
    markNativeVideoDateDailyAlive,
    startDailyAliveHeartbeat,
  } = useNativeDailyAliveHeartbeat({
    callRef,
    openNativePostDateSurveyFromTerminalTruth,
  });

  useEffect(() => {
    localInDailyRoomRef.current = localInDailyRoom;
  }, [localInDailyRoom]);

  useEffect(() => {
    if (!isConnecting && !localInDailyRoom) {
      dailySdkUnresponsiveKeyRef.current = null;
      return;
    }

    const emitUnresponsive = (
      reason: string,
      meetingState: string | null,
      error?: unknown,
    ) => {
      const key = `${sessionId ?? "unknown"}:${reason}:${meetingState ?? "none"}`;
      if (dailySdkUnresponsiveKeyRef.current === key) return;
      dailySdkUnresponsiveKeyRef.current = key;
      const payload = {
        platform: "native",
        session_id: sessionId ?? null,
        event_id: eventId || null,
        source_surface: "video_date_daily",
        source_action: "daily_sdk_heartbeat",
        reason,
        daily_meeting_state: meetingState,
        connected: localInDailyRoom,
        connecting: isConnecting,
      };
      trackEvent(
        LobbyPostDateEvents.VIDEO_DATE_DAILY_SDK_UNRESPONSIVE,
        payload,
      );
      Sentry.captureMessage("video_date_daily_sdk_unresponsive", {
        level: "warning",
        extra: {
          ...payload,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : (error ?? null),
        },
      });
    };

    const intervalId = setInterval(() => {
      const call = callRef.current as
        | (DailyCallObject & { meetingState?: () => unknown })
        | null;
      if (!call || typeof call.meetingState !== "function") return;
      let meetingState: string | null = null;
      try {
        const state = call.meetingState();
        meetingState =
          typeof state === "string"
            ? state
            : state == null
              ? null
              : String(state);
      } catch (error) {
        emitUnresponsive("meeting_state_throw", null, error);
        return;
      }
      if (
        meetingState === "error" ||
        (localInDailyRoom && meetingState === "left-meeting")
      ) {
        emitUnresponsive("unexpected_meeting_state", meetingState);
      }
    }, 5_000);

    return () => clearInterval(intervalId);
  }, [eventId, isConnecting, localInDailyRoom, sessionId]);

  useEffect(() => {
    setDateEntryPermissionEligible(false);
  }, [sessionId, user?.id]);

  const nativeRemoteRenderDiagnostics = useCallback(
    (participant: DailyParticipant | null | undefined) => {
      const videoTrack = getTrack(participant ?? undefined, "video");
      const audioTrack = getTrack(participant ?? undefined, "audio");
      return {
        session_id: sessionId ?? "",
        event_id: eventId || null,
        participant_id: dailyParticipantId(participant ?? undefined) ?? null,
        track_key: nativeRemoteRenderTrackKey(participant ?? undefined),
        video_track_id: videoTrack?.id ?? null,
        audio_track_id: audioTrack?.id ?? null,
        video_ready_state: videoTrack?.readyState ?? null,
        audio_ready_state: audioTrack?.readyState ?? null,
        video_enabled: videoTrack?.enabled ?? null,
        audio_enabled: audioTrack?.enabled ?? null,
      };
    },
    [eventId, sessionId],
  );

  const clearNativeRemoteRenderRemount = useCallback(
    (reason: string) => {
      if (nativeRemoteRenderRemountTimerRef.current) {
        clearTimeout(nativeRemoteRenderRemountTimerRef.current);
        nativeRemoteRenderRemountTimerRef.current = null;
        videoDateDailyDiagnostic("native_remote_render_remount_timer_cleared", {
          session_id: sessionId ?? "",
          event_id: eventId || null,
          reason,
        });
      }
    },
    [eventId, sessionId],
  );

  const clearNativeCameraSwitchFreshnessWatch = useCallback(
    (reason: string, opts: { clearActiveWatch?: boolean } = {}) => {
      nativeCameraSwitchFreshnessSeqRef.current += 1;
      if (nativeCameraSwitchFreshnessTimerRef.current) {
        clearTimeout(nativeCameraSwitchFreshnessTimerRef.current);
        nativeCameraSwitchFreshnessTimerRef.current = null;
        videoDateDailyDiagnostic(
          "native_camera_switch_freshness_timer_cleared",
          {
            session_id: sessionId ?? "",
            event_id: eventId || null,
            reason,
          },
        );
      }
      if (opts.clearActiveWatch) {
        activeNativeRemoteCameraSwitchRenderWatchRef.current = null;
      }
    },
    [eventId, sessionId],
  );

  const resetNativeRemoteRenderRecovery = useCallback(
    (participant: DailyParticipant | null | undefined, reason: string) => {
      clearNativeCameraSwitchFreshnessWatch(reason, { clearActiveWatch: true });
      clearNativeRemoteRenderRemount(reason);
      nativeRemoteRenderTrackAttemptsRef.current.clear();
      nativeRemoteRenderScopedAttemptsRef.current.clear();
      lastNativeRemoteRenderTrackKeyRef.current = nativeRemoteRenderTrackKey(
        participant ?? undefined,
      );
      videoDateDailyDiagnostic("native_remote_render_recovery_reset", {
        ...nativeRemoteRenderDiagnostics(participant),
        reason,
      });
    },
    [
      clearNativeCameraSwitchFreshnessWatch,
      clearNativeRemoteRenderRemount,
      nativeRemoteRenderDiagnostics,
    ],
  );

  const scheduleNativeRemoteRenderRemount = useCallback(
    (
      participant: DailyParticipant | null | undefined,
      source: string,
      recoveryScope = source,
    ) => {
      const trackKey = nativeRemoteRenderTrackKey(participant ?? undefined);
      const videoTrack = getTrack(participant ?? undefined, "video");
      if (!participant || !trackKey || !videoTrack) {
        videoDateDailyDiagnostic("native_remote_render_remount_skipped", {
          ...nativeRemoteRenderDiagnostics(participant),
          source,
          recovery_scope: recoveryScope,
          reason: participant
            ? "missing_remote_video_track"
            : "missing_remote_participant",
        });
        return;
      }

      const previousTrackKey = lastNativeRemoteRenderTrackKeyRef.current;
      if (previousTrackKey !== trackKey) {
        lastNativeRemoteRenderTrackKeyRef.current = trackKey;
        nativeRemoteRenderTrackAttemptsRef.current.clear();
        nativeRemoteRenderScopedAttemptsRef.current.clear();
        videoDateDailyDiagnostic("native_remote_render_track_key_changed", {
          ...nativeRemoteRenderDiagnostics(participant),
          source,
          previous_track_key: previousTrackKey,
        });
      }

      const nowMs = Date.now();
      const scopeKey = normalizeNativeRemoteRenderRecoveryScope(recoveryScope);
      let cameraSwitchRenderWatch =
        activeNativeRemoteCameraSwitchRenderWatchRef.current;
      const cameraSwitchRenderWatchActive = Boolean(
        cameraSwitchRenderWatch && cameraSwitchRenderWatch.expiresAtMs > nowMs,
      );
      if (cameraSwitchRenderWatch && !cameraSwitchRenderWatchActive) {
        activeNativeRemoteCameraSwitchRenderWatchRef.current = null;
        cameraSwitchRenderWatch = null;
      }
      if (
        scopeKey === "participant_updated_same_track" &&
        cameraSwitchRenderWatchActive
      ) {
        videoDateDailyDiagnostic("native_remote_render_remount_skipped", {
          ...nativeRemoteRenderDiagnostics(participant),
          source,
          recovery_scope: recoveryScope,
          scope_key: scopeKey,
          reason: "camera_switch_watch_active",
          switch_id: cameraSwitchRenderWatch?.switchId ?? null,
          watch_expires_at_ms: cameraSwitchRenderWatch?.expiresAtMs ?? null,
        });
        return;
      }

      const scopedAttemptKey = `${trackKey}:${scopeKey}`;
      pruneNativeRemoteRenderAttemptMap(
        nativeRemoteRenderTrackAttemptsRef.current,
        nowMs,
      );
      pruneNativeRemoteRenderAttemptMap(
        nativeRemoteRenderScopedAttemptsRef.current,
        nowMs,
      );
      const trackAttempts =
        nativeRemoteRenderTrackAttemptsRef.current.get(trackKey)?.attempts ?? 0;
      const scopeAttempts =
        nativeRemoteRenderScopedAttemptsRef.current.get(scopedAttemptKey)
          ?.attempts ?? 0;
      const maxScopeAttemptsForScope =
        scopeKey === "camera_switch_hint"
          ? 1
          : NATIVE_REMOTE_RENDER_REMOUNT_MAX_ATTEMPTS_PER_SCOPE;
      if (
        trackAttempts >= NATIVE_REMOTE_RENDER_REMOUNT_MAX_ATTEMPTS_PER_TRACK ||
        scopeAttempts >= maxScopeAttemptsForScope
      ) {
        videoDateDailyDiagnostic("native_remote_render_remount_skipped", {
          ...nativeRemoteRenderDiagnostics(participant),
          source,
          recovery_scope: recoveryScope,
          scope_key: scopeKey,
          reason: "max_attempts_reached",
          track_attempts: trackAttempts,
          scope_attempts: scopeAttempts,
          max_track_attempts:
            NATIVE_REMOTE_RENDER_REMOUNT_MAX_ATTEMPTS_PER_TRACK,
          max_scope_attempts: maxScopeAttemptsForScope,
        });
        return;
      }

      const nextTrackAttempt = trackAttempts + 1;
      const nextScopeAttempt = scopeAttempts + 1;
      nativeRemoteRenderTrackAttemptsRef.current.set(trackKey, {
        attempts: nextTrackAttempt,
        updatedAtMs: nowMs,
      });
      nativeRemoteRenderScopedAttemptsRef.current.set(scopedAttemptKey, {
        attempts: nextScopeAttempt,
        updatedAtMs: nowMs,
      });
      pruneNativeRemoteRenderAttemptMap(
        nativeRemoteRenderTrackAttemptsRef.current,
        nowMs,
      );
      pruneNativeRemoteRenderAttemptMap(
        nativeRemoteRenderScopedAttemptsRef.current,
        nowMs,
      );
      clearNativeRemoteRenderRemount("reschedule_remote_render_remount");
      const remountDelayMs =
        scopeKey === "participant_updated_same_track"
          ? NATIVE_CAMERA_SWITCH_SAME_TRACK_REMOUNT_GRACE_MS
          : NATIVE_REMOTE_RENDER_REMOUNT_DELAY_MS;
      videoDateDailyDiagnostic("native_remote_render_remount_scheduled", {
        ...nativeRemoteRenderDiagnostics(participant),
        source,
        recovery_scope: recoveryScope,
        scope_key: scopeKey,
        track_attempt: nextTrackAttempt,
        scope_attempt: nextScopeAttempt,
        delay_ms: remountDelayMs,
      });

      nativeRemoteRenderRemountTimerRef.current = setTimeout(() => {
        nativeRemoteRenderRemountTimerRef.current = null;
        const latestCameraSwitchWatch =
          activeNativeRemoteCameraSwitchRenderWatchRef.current;
        if (
          scopeKey === "participant_updated_same_track" &&
          latestCameraSwitchWatch &&
          latestCameraSwitchWatch.expiresAtMs > Date.now()
        ) {
          videoDateDailyDiagnostic("native_remote_render_remount_skipped", {
            ...nativeRemoteRenderDiagnostics(
              remoteParticipantRef.current ?? participant,
            ),
            source,
            recovery_scope: recoveryScope,
            scope_key: scopeKey,
            reason: "camera_switch_watch_active",
            switch_id: latestCameraSwitchWatch.switchId,
            watch_expires_at_ms: latestCameraSwitchWatch.expiresAtMs,
          });
          return;
        }
        const latestParticipant = remoteParticipantRef.current ?? participant;
        const latestTrackKey = nativeRemoteRenderTrackKey(
          latestParticipant ?? undefined,
        );
        if (latestTrackKey !== trackKey) {
          videoDateDailyDiagnostic("native_remote_render_remount_skipped", {
            ...nativeRemoteRenderDiagnostics(latestParticipant),
            source,
            recovery_scope: recoveryScope,
            reason: "stale_track_key",
            scheduled_track_key: trackKey,
          });
          return;
        }

        setRemoteMediaRenderNonce((nonce) => nonce + 1);
        videoDateDailyDiagnostic("native_remote_render_remounted", {
          ...nativeRemoteRenderDiagnostics(latestParticipant),
          source,
          recovery_scope: recoveryScope,
          scope_key: scopeKey,
          track_attempt: nextTrackAttempt,
          scope_attempt: nextScopeAttempt,
        });
      }, remountDelayMs);
    },
    [clearNativeRemoteRenderRemount, nativeRemoteRenderDiagnostics],
  );

  const readNativeCameraSwitchFreshness = useCallback(
    async (participant: DailyParticipant | null | undefined) => {
      const call =
        callRef.current as unknown as NativeDailyStatsControls | null;
      const videoTrack = getTrack(participant ?? undefined, "video");
      const expectedTrackId = videoTrack?.id ?? null;
      if (!call) {
        return {
          supported: false,
          fresh: false,
          source: "none" as const,
          reason: "missing_call",
        };
      }

      if (typeof call.getCpuLoadStats === "function") {
        try {
          const cpuStats = await call.getCpuLoadStats();
          const inboundStats =
            cpuStats.stats?.latest?.cpuInboundVideoStats ?? [];
          const matchingStats =
            expectedTrackId != null
              ? inboundStats.find((entry) => entry.trackId === expectedTrackId)
              : null;
          const candidate =
            matchingStats ??
            (inboundStats.length === 1 ? inboundStats[0] : null);
          const fps = finiteNativeStat(candidate?.fps);
          if (candidate) {
            return {
              supported: true,
              fresh: fps != null && fps > 0,
              source: "cpu" as const,
              expectedTrackId,
              statTrackId:
                typeof candidate.trackId === "string"
                  ? candidate.trackId
                  : null,
              fps,
              frameWidth: finiteNativeStat(candidate.frameWidth),
              frameHeight: finiteNativeStat(candidate.frameHeight),
              inboundVideoStatsCount: inboundStats.length,
            };
          }
        } catch (error) {
          videoDateDailyDiagnostic(
            "native_camera_switch_freshness_stats_failed",
            {
              ...nativeRemoteRenderDiagnostics(participant),
              source: "cpu",
              error: describeNativeCameraSwitchError(error),
            },
          );
        }
      }

      if (typeof call.getNetworkStats === "function") {
        try {
          const networkStats = await call.getNetworkStats();
          const videoRecvBitsPerSecond = finiteNativeStat(
            networkStats.stats?.latest?.videoRecvBitsPerSecond,
          );
          return {
            supported: true,
            fresh: videoRecvBitsPerSecond != null && videoRecvBitsPerSecond > 0,
            source: "network" as const,
            expectedTrackId,
            videoRecvBitsPerSecond,
          };
        } catch (error) {
          videoDateDailyDiagnostic(
            "native_camera_switch_freshness_stats_failed",
            {
              ...nativeRemoteRenderDiagnostics(participant),
              source: "network",
              error: describeNativeCameraSwitchError(error),
            },
          );
        }
      }

      return {
        supported: false,
        fresh: false,
        source: "none" as const,
        reason: "stats_unavailable",
        expectedTrackId,
      };
    },
    [nativeRemoteRenderDiagnostics],
  );

  const scheduleNativeCameraSwitchFreshnessWatch = useCallback(
    (participant: DailyParticipant | null | undefined, switchId: string) => {
      clearNativeCameraSwitchFreshnessWatch(
        "reschedule_camera_switch_freshness_watch",
      );
      const watchSeq = nativeCameraSwitchFreshnessSeqRef.current + 1;
      nativeCameraSwitchFreshnessSeqRef.current = watchSeq;
      const startedAtMs = Date.now();
      const initialTrackKey = nativeRemoteRenderTrackKey(
        participant ?? undefined,
      );

      videoDateDailyDiagnostic("native_camera_switch_render_watch_started", {
        ...nativeRemoteRenderDiagnostics(participant),
        switch_id: switchId,
        poll_ms: NATIVE_CAMERA_SWITCH_FRESH_FRAME_POLL_MS,
        timeout_ms: NATIVE_CAMERA_SWITCH_FRESH_FRAME_TIMEOUT_MS,
      });

      const pollFreshness = async () => {
        nativeCameraSwitchFreshnessTimerRef.current = null;
        if (nativeCameraSwitchFreshnessSeqRef.current !== watchSeq) return;
        const latestParticipant = remoteParticipantRef.current ?? participant;
        const latestTrackKey = nativeRemoteRenderTrackKey(
          latestParticipant ?? undefined,
        );
        if (
          initialTrackKey &&
          latestTrackKey &&
          latestTrackKey !== initialTrackKey
        ) {
          activeNativeRemoteCameraSwitchRenderWatchRef.current = null;
          videoDateDailyDiagnostic(
            "native_camera_switch_render_watch_stale_track",
            {
              ...nativeRemoteRenderDiagnostics(latestParticipant),
              switch_id: switchId,
              initial_track_key: initialTrackKey,
              latest_track_key: latestTrackKey,
            },
          );
          return;
        }

        const freshness =
          await readNativeCameraSwitchFreshness(latestParticipant);
        if (nativeCameraSwitchFreshnessSeqRef.current !== watchSeq) return;
        const elapsedMs = Date.now() - startedAtMs;
        if (freshness.fresh) {
          activeNativeRemoteCameraSwitchRenderWatchRef.current = null;
          videoDateDailyDiagnostic("native_camera_switch_no_remount_needed", {
            ...nativeRemoteRenderDiagnostics(latestParticipant),
            switch_id: switchId,
            elapsed_ms: elapsedMs,
            freshness,
          });
          return;
        }

        if (elapsedMs >= NATIVE_CAMERA_SWITCH_FRESH_FRAME_TIMEOUT_MS) {
          activeNativeRemoteCameraSwitchRenderWatchRef.current = null;
          videoDateDailyDiagnostic(
            "native_camera_switch_render_watch_timed_out",
            {
              ...nativeRemoteRenderDiagnostics(latestParticipant),
              switch_id: switchId,
              elapsed_ms: elapsedMs,
              freshness,
            },
          );
          scheduleNativeRemoteRenderRemount(
            latestParticipant,
            "app_message_camera_switch_hint_timeout",
            "camera_switch_hint",
          );
          return;
        }

        if (!freshness.supported) {
          videoDateDailyDiagnostic(
            "native_camera_switch_render_watch_unverified",
            {
              ...nativeRemoteRenderDiagnostics(latestParticipant),
              switch_id: switchId,
              elapsed_ms: elapsedMs,
              freshness,
              next_poll_ms: NATIVE_CAMERA_SWITCH_FRESH_FRAME_POLL_MS,
            },
          );
        }

        nativeCameraSwitchFreshnessTimerRef.current = setTimeout(
          () => void pollFreshness(),
          NATIVE_CAMERA_SWITCH_FRESH_FRAME_POLL_MS,
        );
      };

      nativeCameraSwitchFreshnessTimerRef.current = setTimeout(
        () => void pollFreshness(),
        NATIVE_CAMERA_SWITCH_FRESH_FRAME_POLL_MS,
      );
    },
    [
      clearNativeCameraSwitchFreshnessWatch,
      nativeRemoteRenderDiagnostics,
      readNativeCameraSwitchFreshness,
      scheduleNativeRemoteRenderRemount,
    ],
  );

  const clearPartnerAwayAfterTransportGrace = useCallback(
    (reason: string) => {
      if (!partnerAwayAfterTransportGraceTimerRef.current) return;
      clearTimeout(partnerAwayAfterTransportGraceTimerRef.current);
      partnerAwayAfterTransportGraceTimerRef.current = null;
      vdbg("native_daily_transport_partner_away_timer_cleared", {
        sessionId: sessionId ?? null,
        userId: user?.id ?? null,
        reason,
      });
    },
    [sessionId, user?.id],
  );

  useEffect(() => {
    const remountTrackAttempts = nativeRemoteRenderTrackAttemptsRef.current;
    const remountScopedAttempts = nativeRemoteRenderScopedAttemptsRef.current;
    return () => {
      clearPartnerAwayAfterTransportGrace("screen_unmount");
      clearNativeCameraSwitchFreshnessWatch("screen_unmount", {
        clearActiveWatch: true,
      });
      clearNativeRemoteRenderRemount("screen_unmount");
      remountTrackAttempts.clear();
      remountScopedAttempts.clear();
      lastNativeRemoteRenderTrackKeyRef.current = null;
      remoteParticipantRef.current = null;
      localParticipantRef.current = null;
      nativeCameraSwitchInFlightRef.current = false;
      lastNativeRemoteCameraSwitchHintIdRef.current = null;
    };
  }, [
    clearNativeCameraSwitchFreshnessWatch,
    clearNativeRemoteRenderRemount,
    clearPartnerAwayAfterTransportGrace,
  ]);

  const boundCallRef = useRef<DailyCallObject | null>(null);
  const boundHandlersRef = useRef<{
    onParticipantJoined: (event: { participant?: DailyParticipant }) => void;
    onParticipantUpdated: (event: { participant?: DailyParticipant }) => void;
    onParticipantLeft: (event: { participant?: DailyParticipant }) => void;
    onLeftMeeting: () => void;
    onAppMessage: (event: { data?: unknown; fromId?: string }) => void;
    onError: (event: unknown) => void;
    onNetworkQualityChange?: (event: unknown) => void;
  } | null>(null);

  const partnerEverJoinedRef = useRef(false);
  const {
    detachCallListeners,
    cleanupTerminalDailyCall,
    bindCallListeners,
  } = useNativeVideoDateCallListeners({
    activeNativeDailyCallIdentityRef,
    activeNativeRemoteCameraSwitchRenderWatchRef,
    activePreparedEntryCacheHitRef,
    activePreparedEntryCacheRef,
    boundCallRef,
    boundHandlersRef,
    callRef,
    clearDailyAliveHeartbeatTimer,
    clearDailyTokenRefreshTimer,
    clearFirstConnectWatchdog,
    clearNativeRemoteRenderRemount,
    clearPartnerAwayAfterTransportGrace,
    dailyTokenExpiresAtRef,
    dailyTokenRecoveryInFlightRef,
    endBootstrapTiming,
    eventId,
    firstIceConnectedLoggedRef,
    firstRemoteParticipantTimedRef,
    hasStartedJoinRef,
    lastNativeRemoteCameraSwitchHintIdRef,
    lastNativeRemoteRenderTrackKeyRef,
    localInDailyRoomRef,
    localParticipantRef,
    nativeCameraSwitchInFlightRef,
    nativeRemoteRenderDiagnostics,
    nativeRemoteRenderScopedAttemptsRef,
    nativeRemoteRenderTrackAttemptsRef,
    partnerAwayAfterTransportGraceTimerRef,
    partnerEverJoinedRef,
    phaseRef,
    recoverNativeDailyTokenRef,
    refetchVideoSession,
    releaseSharedCallIfOwned,
    remoteParticipantRef,
    requestReconnectSyncRef,
    resetNativeRemoteRenderRecovery,
    roomNameRef,
    scheduleNativeCameraSwitchFreshnessWatch,
    scheduleNativeRemoteRenderRemount,
    sessionId,
    setAwaitingFirstConnect,
    setCallError,
    setIsConnecting,
    setIsMuted,
    setIsPartnerDisconnected,
    setIsVideoOff,
    setJoining,
    setLocalInDailyRoom,
    setLocalParticipant,
    setNetQualityTier,
    setPartnerEverJoined,
    setRemoteParticipant,
    user,
  });

  const terminalSurveyHardStopActive = terminalSurveyHardStopRef.current;
  phaseRef.current = terminalSurveyHardStopActive ? "ended" : phase;
  latestDateRouteSessionIdRef.current = sessionId ?? null;
  latestDateRouteUserIdRef.current = user?.id ?? null;
  latestDateRouteEndedRef.current = Boolean(
    terminalSurveyHardStopActive ||
    session?.ended_at ||
    session?.state === "ended" ||
    phase === "ended",
  );

  useEffect(() => {
    setSafetySubmitOutcome(null);
  }, [sessionId, partnerId]);

  useEffect(() => {
    localTimeLeftRef.current = localTimeLeft;
  }, [localTimeLeft]);

  useEffect(() => {
    if (phase !== "date") {
      timerDriftTrackingReadyRef.current = false;
      lastTimerDriftRecoveryKeyRef.current = null;
    }
  }, [phase]);

  useEffect(() => {
    if (!sessionId) {
      dateEstablishedRef.current = false;
      return;
    }
    if (phase === "date" || videoSessionHasEncounterExposureTruth(session)) {
      dateEstablishedRef.current = true;
    }
  }, [
    sessionId,
    phase,
    session,
    session?.state,
    session?.phase,
    session?.date_started_at,
    session?.participant_1_joined_at,
    session?.participant_2_joined_at,
    session?.participant_1_remote_seen_at,
    session?.participant_2_remote_seen_at,
  ]);

  const clearEntryGraceState = useCallback(() => {}, []);

  const hasRemotePartner = !!remoteParticipant;
  /** Remote participant's first Daily join stamp (null = they have not opened/joined this date yet). */
  const peerServerJoinedAt = useMemo(() => {
    if (!session || !user?.id) return null;
    return user.id === session.participant_1_id
      ? (session.participant_2_joined_at ?? null)
      : (session.participant_1_joined_at ?? null);
  }, [session, user?.id]);

  useEffect(() => {
    partnerEverJoinedRef.current = partnerEverJoined;
  }, [partnerEverJoined]);

  useEffect(() => {
    setPartnerEverJoined(false);
    hasStartedJoinRef.current = false;
    prejoinAttemptRef.current = null;
    observedNativePrejoinPipelineKeyRef.current = null;
    dateEstablishedRef.current = false;
    bootstrapTimingsRef.current = {};
    activePreparedEntryCacheRef.current = null;
    activePreparedEntryCacheHitRef.current = null;
    dailyJoinStartedAtMsRef.current = null;
    dailyPrewarmConsumedForJoinRef.current = false;
    prewarmedAlreadyJoinedRef.current = false;
    prewarmedJoinInFlightRef.current = false;
    providerVerifySkippedRef.current = null;
    preparedJoinRetryUsedRef.current = false;
    firstIceConnectedLoggedRef.current = false;
    firstRemoteParticipantTimedRef.current = false;
    firstPlayableRemoteTimedRef.current = false;
    localVideoReadyTrackedRef.current = false;
    remoteReadableTrackedRef.current = false;
    warmupTimerStartedTrackedRef.current = null;
    firstPlayableRemoteAtMsRef.current = 0;
    vdbg("prejoin_state_hasStartedJoinRef", {
      value: false,
      sessionId: sessionId ?? null,
      userId: user?.id ?? null,
      step: "session_reset",
    });
    vdbg("prejoin_state_localInDailyRoom", {
      value: false,
      sessionId: sessionId ?? null,
      userId: user?.id ?? null,
      step: "session_reset",
    });
    setLocalInDailyRoom(false);
    setPeerMissingTerminal(false);
    clearPartnerAwayAfterTransportGrace("session_reset");
    clearEntryGraceState();
    entryCompletionInFlightRef.current = false;
    entryCompletionDeadlineKeyRef.current = null;
    entryCtaImpressionRef.current = null;
    entryCtaLastVisibleMsRef.current = 0;
    entryFinalTenNudgeKeyRef.current = null;
    if (entryCompletionRetryTimerRef.current) {
      clearTimeout(entryCompletionRetryTimerRef.current);
      entryCompletionRetryTimerRef.current = null;
    }
    peerMissingTruthRefreshCountRef.current = 0;
    lastLoggedPostJoinStageRef.current = null;
  }, [
    sessionId,
    user?.id,
    clearEntryGraceState,
    clearPartnerAwayAfterTransportGrace,
  ]);

  /** Latch + RC before paint for the date entry pipeline. */
  useLayoutEffect(() => {
    if (!sessionId) return;
    rcBreadcrumb(RC_CATEGORY.videoDateEntry, "date_screen_mount", {
      date_screen_param_session_id: sessionId,
      pathname: pathname ?? null,
      user_id: user?.id ?? null,
      ts_ms: Date.now(),
    });
    markVideoDateEntryPipelineStarted(sessionId);
    const launch = consumeNativeVideoDateLaunchIntent();
    if (launch) {
      videoDateLaunchBreadcrumb("date_route_layout_after_nav_intent", {
        session_id: sessionId,
        duration_ms_since_nav_intent: videoDateLaunchDurationMs(launch.t0Ms),
        nav_intent_source: launch.source,
      });
    }
    rcBreadcrumb(RC_CATEGORY.videoDateEntry, "navigate_to_date_started", {
      session_id: sessionId,
      user_id: user?.id ?? null,
    });
  }, [sessionId, user?.id, pathname]);

  useEffect(() => {
    if (!sessionId || !user?.id) return;
    const terminalSurveyOwner =
      showFeedback || phase === "ended" || terminalSurveyHardStopRef.current;
    if (!dateEntryPermissionEligible && !terminalSurveyOwner) return;
    const refreshDateRouteOwnership = () => {
      markVideoDateRouteOwned(sessionId, user.id);
      vdbg("native_date_route_ownership_refresh", {
        sessionId,
        userId: user.id,
        routeMountId: routeMountIdRef.current,
        routeOwnerId: `${user.id}:${sessionId}`,
        terminalSurveyOwner,
        dateEntryPermissionEligible,
      });
    };
    refreshDateRouteOwnership();
    const intervalId = setInterval(
      refreshDateRouteOwnership,
      VIDEO_DATE_ROUTE_OWNERSHIP_REFRESH_MS,
    );
    return () => {
      clearInterval(intervalId);
    };
  }, [dateEntryPermissionEligible, phase, sessionId, showFeedback, user?.id]);

  useEffect(() => {
    vdbg("date_mount", {
      sessionId: sessionId ?? null,
      userId: user?.id ?? null,
    });
    if (sessionId) {
      const latencyContext = recordReadyGateToDateLatencyCheckpoint({
        sessionId,
        platform: "native",
        eventId: eventId || null,
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
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_ROUTE_ENTERED, {
        platform: "native",
        session_id: sessionId,
        event_id: eventId || null,
        source_surface: "video_date_route",
        source_action: "route_mount",
      });
      const shellContext = recordReadyGateToDateLatencyCheckpoint({
        sessionId,
        platform: "native",
        eventId: eventId || null,
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
        platform: "native",
        session_id: sessionId,
        event_id: eventId || null,
        source_surface: "video_date_route",
        source_action: "route_mount",
      });
    }
    beginBootstrapTiming("date_route_entered", { source: "mount" });
    endBootstrapTiming("date_route_entered", { source: "mount" });
    logJourney("date_route_entered", { source: "mount" }, "date_route_entered");
    if (!sessionId || !user?.id) return;
    const userId = user.id;
    let cancelled = false;
    if (isVdbgEnabled() || __DEV__) {
      void fetchVideoDateSessionRow(sessionId, { fresh: true })
        .then(({ data, error }) => {
          if (cancelled) return;
          vdbg("date_mount_session_row", {
            sessionId,
            userId,
            row: data ?? null,
            error: error ? { code: error.code, message: error.message } : null,
          });
        });
    }
    return () => {
      cancelled = true;
    };
  }, [
    sessionId,
    user?.id,
    eventId,
    beginBootstrapTiming,
    endBootstrapTiming,
    logJourney,
  ]);

  // Ended + in_ready_gate: defense-in-depth vs `NativeSessionRouteHydration` (backend truth first).
  useEffect(() => {
    if (!sessionId || !user?.id) return;
    let cancelled = false;
    void (async () => {
      beginBootstrapTiming("truth_fetch", { source: "route_guard" });
      const vs = await fetchVideoSessionDateEntryTruthCoalesced(sessionId);
      endBootstrapTiming("truth_fetch", {
        source: "route_guard",
        has_truth: Boolean(vs),
      });
      if (cancelled) return;
      vdbg("date_entry_truth_row", {
        sessionId,
        userId: user.id,
        row: vs ?? null,
      });
      if (!vs) {
        setDateEntryPermissionEligible(false);
        vdbg("date_guard_blocked", {
          sessionId,
          userId: user.id,
          reason: "missing_session_truth_row",
        });
        return;
      }
      if (!getVideoSessionPartnerIdForUser(vs, user.id)) {
        setDateEntryPermissionEligible(false);
        vdbg("date_guard_blocked", {
          sessionId,
          userId: user.id,
          reason: "not_participant",
        });
        return;
      }
      const regQuery = supabase
        .from("event_registrations")
        .select("queue_status, current_room_id")
        .eq("profile_id", user.id);
      if (vs.event_id) {
        regQuery.eq("event_id", vs.event_id as string);
      } else {
        regQuery.eq("current_room_id", sessionId);
      }
      const { data: reg } = await regQuery.maybeSingle();
      if (cancelled) return;
      // PR 8.5: the shared controller owns the date-route decision (canonical
      // truth + ownership/latch suppression; intent mutations applied inside).
      // This effect keeps only native navigation side effects and diagnostics
      // — same contract as the web `date_route` guard in `VideoDate.tsx`.
      const decision = decideVideoDateSurfaceRoute({
        surface: "date_route",
        sessionId,
        profileId: user.id,
        intents: videoDateNavigationIntents,
        canonicalInput: {
          eventId: (vs.event_id as string | null) ?? null,
          truth: vs,
          registration: {
            queue_status: reg?.queue_status ?? null,
            // Pass the real current_room_id so an `in_survey` registration scoped
            // to a different room cannot force this /date/:sessionId into the
            // survey path; a null/cleared room id stays unscoped (review P2 on
            // PR #1310). After `end`, current_room_id is cleared to null, so the
            // normal pending-survey recovery is unchanged.
            current_room_id: reg?.current_room_id ?? null,
            event_id: (vs.event_id as string | null) ?? null,
          },
        },
      });
      const canAttemptDaily = decision.canonical?.canAttemptDaily === true;
      const routedTo =
        decision.target === "survey" || decision.target === "ended"
          ? "ended"
          : decision.target;
      rcBreadcrumb(RC_CATEGORY.videoDateEntry, "date_route_decision", {
        session_id: sessionId,
        user_id: user.id,
        truth_decision: decision.reason,
        can_attempt_daily: canAttemptDaily,
        canonical_target: decision.canonical?.target ?? null,
        suppressed_by: decision.suppressedBy,
        applied_intents: decision.appliedIntents,
        final_route: routedTo,
        source: "route_guard",
        queue_status: reg?.queue_status ?? null,
        vs_state: vs.state ?? null,
        vs_phase: vs.phase ?? null,
        ready_gate_status: vs.ready_gate_status ?? null,
        ready_gate_expires_at:
          vs.ready_gate_expires_at == null
            ? null
            : String(vs.ready_gate_expires_at),
      });
      vdbg("date_route_decision", {
        sessionId,
        userId: user.id,
        source: "route_guard",
        truthDecision: decision.reason,
        canAttemptDaily,
        canonicalTarget: decision.canonical?.target ?? null,
        suppressedBy: decision.suppressedBy,
        appliedIntents: decision.appliedIntents,
        finalRoute: routedTo,
        queueStatus: reg?.queue_status ?? null,
        vsState: vs.state ?? null,
        vsPhase: vs.phase ?? null,
        readyGateStatus: vs.ready_gate_status ?? null,
        readyGateExpiresAt: vs.ready_gate_expires_at ?? null,
      });
      if (decision.target === "survey" || decision.target === "ended") {
        setDateEntryPermissionEligible(false);
        const openedSurvey = await openNativePostDateSurveyFromTerminalTruth(
          decision.target === "survey"
            ? "go_survey_route_guard"
            : "ended_route_guard",
          vs,
        );
        if (cancelled) return;
        if (openedSurvey) {
          return;
        }
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, "route_bounced_to_lobby", {
          session_id: sessionId,
          user_id: user.id,
          reason: "session_ended",
          event_id: vs.event_id,
        });
        if (vs.event_id) {
          const target = eventLobbyHref(vs.event_id as string);
          vdbgRedirect(target, "session_ended_route_guard", {
            sessionId,
            userId: user.id,
            eventId: vs.event_id,
            endedAt: vs.ended_at,
          });
          logJourney("date_route_bounced", {
            reason: "session_ended_route_guard",
            target,
          });
          router.replace(target);
        } else {
          const target = tabsRootHref();
          vdbgRedirect(target, "session_ended_route_guard", {
            sessionId,
            userId: user.id,
            endedAt: vs.ended_at,
          });
          logJourney("date_route_bounced", {
            reason: "session_ended_route_guard",
            target,
          });
          router.replace(target);
        }
        return;
      }
      if (decision.target === "date") {
        if (
          decision.suppressedBy === "route_ownership" ||
          decision.suppressedBy === "entry_latch"
        ) {
          rcBreadcrumb(
            RC_CATEGORY.videoDateEntry,
            "route_bounce_suppressed_by_date_ownership",
            {
              session_id: sessionId,
              user_id: user.id,
              target:
                decision.canonical?.target === "ready_gate" ? "ready" : "lobby",
              suppressed_by: decision.suppressedBy,
              queue_status: reg?.queue_status ?? null,
              vs_state: vs.state,
              vs_phase: vs.phase,
              ready_gate_status: vs.ready_gate_status ?? null,
            },
          );
          vdbg("date_guard_bounce_suppressed_by_route_ownership", {
            sessionId,
            userId: user.id,
            suppressedBy: decision.suppressedBy,
            queueStatus: reg?.queue_status ?? null,
            state: vs.state,
            phase: vs.phase,
            readyGateStatus: vs.ready_gate_status ?? null,
          });
        }
        setDateEntryPermissionEligible(true);
        return;
      }
      if (decision.target === "ready") {
        setDateEntryPermissionEligible(false);
        vdbg("date_guard_ready_gate_branch", {
          sessionId,
          userId: user.id,
          branch: "canonical_ready_gate",
          canAttemptDaily,
          routed_to: "ready",
          readyGateStatus: vs.ready_gate_status ?? null,
          readyGateExpiresAt: vs.ready_gate_expires_at ?? null,
        });
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, "route_bounced_to_ready", {
          session_id: sessionId,
          user_id: user.id,
          queue_status: reg?.queue_status ?? null,
          vs_state: vs.state,
          vs_phase: vs.phase,
          entry_started_at: Boolean(vs.entry_started_at),
          ready_gate_status: vs.ready_gate_status ?? null,
          ready_gate_expires_at:
            vs.ready_gate_expires_at == null
              ? null
              : String(vs.ready_gate_expires_at),
          can_attempt_daily: canAttemptDaily,
          routed_to: "ready",
        });
        const target = readyGateHref(sessionId);
        vdbgRedirect(target, "in_ready_gate_without_provider_prepared_truth", {
          sessionId,
          userId: user.id,
          queueStatus: reg?.queue_status ?? null,
          state: vs.state,
          phase: vs.phase,
          entryStarted: Boolean(vs.entry_started_at),
          latchActive: isDateEntryTransitionActive(sessionId),
        });
        logJourney("date_route_bounced", {
          reason: "in_ready_gate_without_provider_prepared_truth",
          target,
        });
        router.replace(target);
        return;
      }
      setDateEntryPermissionEligible(false);
      rcBreadcrumb(RC_CATEGORY.videoDateEntry, "route_bounced_to_lobby", {
        session_id: sessionId,
        user_id: user.id,
        reason: "video_truth_not_startable",
        event_id: vs.event_id,
      });
      if (vs.event_id) {
        const target = eventLobbyHref(vs.event_id as string);
        vdbgRedirect(target, "video_truth_not_startable_route_guard", {
          sessionId,
          userId: user.id,
          eventId: vs.event_id,
          state: vs.state,
          phase: vs.phase,
          readyGateStatus: vs.ready_gate_status ?? null,
        });
        logJourney("date_route_bounced", {
          reason: "video_truth_not_startable_route_guard",
          target,
        });
        router.replace(target);
        return;
      }
      const target = tabsRootHref();
      vdbgRedirect(target, "video_truth_not_startable_route_guard", {
        sessionId,
        userId: user.id,
        state: vs.state,
        phase: vs.phase,
        readyGateStatus: vs.ready_gate_status ?? null,
      });
      logJourney("date_route_bounced", {
        reason: "video_truth_not_startable_route_guard",
        target,
      });
      router.replace(target);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    sessionId,
    user?.id,
    eventId,
    logJourney,
    beginBootstrapTiming,
    endBootstrapTiming,
    openNativePostDateSurveyFromTerminalTruth,
  ]);

  const recoverFromNotStartableDateTruth = useCallback(
    async (source: "prepare_date_entry") => {
      if (!sessionId || !user?.id) return false;
      const [vs, regRes] = await Promise.all([
        fetchVideoSessionDateEntryTruth(sessionId),
        supabase
          .from("event_registrations")
          .select("queue_status, current_room_id")
          .eq("profile_id", user.id)
          .eq("current_room_id", sessionId)
          .maybeSingle(),
      ]);
      const reg = regRes.data;
      const recovery = adviseVideoSessionTruthRecovery({
        sessionId,
        eventId,
        truth: vs,
        platform: "native",
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
      const routedTo =
        recovery.action === "go_date"
          ? "date"
          : recovery.action === "go_ready_gate"
            ? "ready"
            : recovery.action === "show_terminal" ||
                recovery.action === "go_survey"
              ? "ended"
              : "lobby";
      rcBreadcrumb(RC_CATEGORY.videoDateEntry, "date_route_decision", {
        session_id: sessionId,
        user_id: user.id,
        decision,
        can_attempt_daily: canAttemptDaily,
        reason,
        routed_to: routedTo,
        source,
        queue_status: reg?.queue_status ?? null,
        current_room_id: reg?.current_room_id ?? null,
        vs_state: vs?.state ?? null,
        vs_phase: vs?.phase ?? null,
        entry_started_at: Boolean(vs?.entry_started_at),
        ready_gate_status: vs?.ready_gate_status ?? null,
        ready_gate_expires_at:
          vs?.ready_gate_expires_at == null
            ? null
            : String(vs.ready_gate_expires_at),
      });
      vdbg("date_route_decision", {
        sessionId,
        userId: user.id,
        source,
        decision,
        reason,
        canAttemptDaily,
        routed_to: routedTo,
        queueStatus: reg?.queue_status ?? null,
        currentRoomId: reg?.current_room_id ?? null,
        vsState: vs?.state ?? null,
        vsPhase: vs?.phase ?? null,
          entryStartedAt: videoDateEntryStartedAtIso(vs),
        readyGateStatus: vs?.ready_gate_status ?? null,
        readyGateExpiresAt: vs?.ready_gate_expires_at ?? null,
      });
      if (!canAttemptDaily && recovery.action === "go_ready_gate") {
        const target = readyGateHref(sessionId);
        rcBreadcrumb(
          RC_CATEGORY.videoDateEntry,
          "latch_cleared_before_recovery_redirect",
          {
            session_id: sessionId,
            source,
            target: String(target),
          },
        );
        clearDateEntryTransition(sessionId);
        vdbgRedirect(target, "ready_gate_not_ready_recover_to_ready", {
          source,
          sessionId,
          userId: user.id,
        });
        router.replace(target);
        return true;
      }
      if (
        recovery.action === "show_terminal" ||
        recovery.action === "go_survey"
      ) {
        const openedSurvey = await openNativePostDateSurveyFromTerminalTruth(
          `${source}_ended_truth`,
          vs,
        );
        if (openedSurvey) return true;
        const fallbackEventId = vs?.event_id ?? eventId;
        if (fallbackEventId) {
          const target = eventLobbyHref(fallbackEventId as string);
          rcBreadcrumb(
            RC_CATEGORY.videoDateEntry,
            "latch_cleared_before_recovery_redirect",
            {
              session_id: sessionId,
              source,
              target: String(target),
            },
          );
          clearDateEntryTransition(sessionId);
          vdbgRedirect(target, "ready_gate_not_ready_recover_to_lobby", {
            source,
            sessionId,
            userId: user.id,
            eventId: fallbackEventId,
          });
          router.replace(target);
        } else {
          const target = tabsRootHref();
          rcBreadcrumb(
            RC_CATEGORY.videoDateEntry,
            "latch_cleared_before_recovery_redirect",
            {
              session_id: sessionId,
              source,
              target: String(target),
            },
          );
          clearDateEntryTransition(sessionId);
          vdbgRedirect(target, "ready_gate_not_ready_recover_to_tabs", {
            source,
            sessionId,
            userId: user.id,
          });
          router.replace(target);
        }
        return true;
      }
      if (
        !canAttemptDaily &&
        (recovery.action === "go_lobby" || recovery.action === "go_home")
      ) {
        const fallbackEventId = vs?.event_id ?? eventId;
        if (fallbackEventId) {
          const target = eventLobbyHref(fallbackEventId as string);
          rcBreadcrumb(
            RC_CATEGORY.videoDateEntry,
            "latch_cleared_before_recovery_redirect",
            {
              session_id: sessionId,
              source,
              target: String(target),
            },
          );
          clearDateEntryTransition(sessionId);
          vdbgRedirect(target, "ready_gate_not_ready_recover_to_lobby", {
            source,
            sessionId,
            userId: user.id,
            eventId: fallbackEventId,
          });
          router.replace(target);
        } else {
          const target = tabsRootHref();
          rcBreadcrumb(
            RC_CATEGORY.videoDateEntry,
            "latch_cleared_before_recovery_redirect",
            {
              session_id: sessionId,
              source,
              target: String(target),
            },
          );
          clearDateEntryTransition(sessionId);
          vdbgRedirect(target, "ready_gate_not_ready_recover_to_tabs", {
            source,
            sessionId,
            userId: user.id,
          });
          router.replace(target);
        }
        return true;
      }
      // Truth says startable (`navigate_date` / `canAttemptDaily=true`) yet the original op
      // failed — caller should bounded-retry rather than show the fatal banner. Emit the missing
      // breadcrumb so production logs distinguish this silent path from a successful redirect.
      rcBreadcrumb(
        RC_CATEGORY.videoDateEntry,
        "recover_not_startable_no_redirect",
        {
          session_id: sessionId,
          source,
          decision,
          can_attempt_daily: canAttemptDaily,
          vs_state: vs?.state ?? null,
          ready_gate_status: vs?.ready_gate_status ?? null,
          entry_started_at: Boolean(vs?.entry_started_at),
        },
      );
      return false;
    },
    [eventId, openNativePostDateSurveyFromTerminalTruth, sessionId, user?.id],
  );

  useEffect(() => {
    if (phaseRef.current !== "date") {
      timerDriftTrackingReadyRef.current = false;
      setLocalTimeLeft(serverTimeLeft);
      return;
    }

    if (timerDriftTrackingReadyRef.current && serverTimeLeft !== null) {
      const payload = buildVideoDateTimerDriftRecoveredPayload({
        platform: "native",
        sessionId,
        eventId: session?.event_id ?? eventId,
        previousTimeLeftSeconds: localTimeLeftRef.current,
        correctedTimeLeftSeconds: serverTimeLeft,
        recoverySource: "sync_reconnect",
        phase: phaseRef.current,
      });

      if (payload) {
        const recoveryKey = [
          payload.session_id,
          payload.drift_ms,
          payload.drift_bucket,
          payload.recovery_source,
          serverTimeLeft,
          session?.date_started_at ?? "",
          session?.date_extra_seconds ?? "",
        ].join(":");
        if (lastTimerDriftRecoveryKeyRef.current !== recoveryKey) {
          lastTimerDriftRecoveryKeyRef.current = recoveryKey;
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_TIMER_DRIFT_DETECTED, {
            ...payload,
            outcome: "no_op",
            reason_code: "client_server_timer_mismatch",
          });
          trackEvent(
            LobbyPostDateEvents.VIDEO_DATE_TIMER_DRIFT_RECOVERED,
            payload,
          );
          vdbg("timer_drift_recovered_by_server_truth", {
            sessionId: sessionId ?? null,
            eventId: payload.event_id ?? null,
            driftMs: payload.drift_ms,
            driftBucket: payload.drift_bucket,
            recoverySource: payload.recovery_source,
          });
        }
      }
    }

    setLocalTimeLeft(serverTimeLeft);
    if (serverTimeLeft !== null) {
      timerDriftTrackingReadyRef.current = true;
    }
  }, [
    eventId,
    serverTimeLeft,
    session?.date_extra_seconds,
    session?.date_started_at,
    session?.event_id,
    sessionId,
  ]);

  useEffect(() => {
    if (!session || !user?.id) return;
    const pid =
      user.id === session.participant_1_id
        ? session.participant_2_id
        : session.participant_1_id;
    if (pid) setPartnerId(pid);
    if (session.event_id) setEventId(session.event_id);
    setIsParticipant1(user.id === session.participant_1_id);
  }, [session, user?.id]);

  useEffect(() => {
    if (!sessionId || !user?.id || !localInDailyRoom) return;
    let cancelled = false;
    fetchPartnerProfile(sessionId, user.id, (path) =>
      avatarUrl(path, "avatar"),
    ).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setFullPartner(res.partner);
        setPartnerId(res.partnerId);
        setEventId(res.eventId);
        setIsParticipant1(res.isParticipant1);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, user?.id, localInDailyRoom]);

  /** Bounded wait for first remote peer; refetch truth and surface peer-missing choices without auto-rejoin. */
  useEffect(() => {
    if (
      !localInDailyRoom ||
      hasRemotePartner ||
      phase === "ended" ||
      !sessionId ||
      peerMissingTerminal ||
      isPartnerDisconnected
    ) {
      clearFirstConnectWatchdog();
      return;
    }
    if (!awaitingFirstConnect) {
      clearFirstConnectWatchdog();
      return;
    }

    clearFirstConnectWatchdog();
    firstConnectWatchdogRef.current = setTimeout(() => {
      firstConnectWatchdogRef.current = null;
      const call = callRef.current;
      if (!call) return;
      const participants = call.participants();
      const remotes = participants
        ? Object.values(participants).filter(
            (p) => !(p as unknown as { local?: boolean }).local,
          )
        : [];
      if (remotes.length > 0) return;

      peerMissingTruthRefreshCountRef.current += 1;
      const truthRefreshAttempt = peerMissingTruthRefreshCountRef.current;
      rcBreadcrumb(
        RC_CATEGORY.videoDateEntry,
        "peer_missing_terminal_watchdog_fire",
        {
          session_id: sessionId,
          room_name: roomNameRef.current ?? undefined,
          watchdog_ms: FIRST_CONNECT_TIMEOUT_MS,
          truth_refresh_attempt: truthRefreshAttempt,
        },
      );
      videoDateDailyDiagnostic("daily_no_remote_watchdog_truth_refetch_start", {
        session_id: sessionId,
        room_name: roomNameRef.current ?? null,
        truth_refresh_attempt: truthRefreshAttempt,
      });
      const markPeerMissingTerminal = () => {
        videoDateDailyDiagnostic("peer_missing_timeout", {
          session_id: sessionId,
          room_name: roomNameRef.current ?? null,
          truth_refresh_attempt: truthRefreshAttempt,
        });
        setPeerMissingTerminal(true);
        vdbg("prejoin_state_awaitingFirstConnect", {
          value: false,
          sessionId,
          userId: user?.id ?? null,
          step: "peer_missing_timeout",
        });
        setAwaitingFirstConnect(false);
        vdbg("prejoin_state_isConnecting", {
          value: false,
          sessionId,
          userId: user?.id ?? null,
          step: "peer_missing_timeout",
        });
        setIsConnecting(false);
        vdbg("prejoin_state_callError", {
          value: "They may need a little more time.",
          sessionId,
          userId: user?.id ?? null,
          step: "peer_missing_timeout",
        });
        setCallError("They may need a little more time.");
      };

      void refetchVideoSession()
        .then((truth) => {
          videoDateDailyDiagnostic("daily_no_remote_watchdog_truth_refetched", {
            session_id: sessionId,
            room_name: roomNameRef.current ?? null,
            ok: true,
            truth_refresh_attempt: truthRefreshAttempt,
          });
          const hasTerminalSurveyTruth = videoSessionHasPostDateSurveyTruth(
            truth ?? null,
          );
          const hasHistoricalRemoteSeenTruth =
            videoSessionHasEncounterExposureTruth(truth ?? null);
          if (hasTerminalSurveyTruth) {
            setPeerMissingTerminal(false);
            setCallError(null);
            setAwaitingFirstConnect(false);
            setIsConnecting(false);
            videoDateDailyDiagnostic("peer_missing_terminal_suppressed", {
              session_id: sessionId,
              room_name: roomNameRef.current ?? null,
              event_name: "peer_missing_suppressed_survey_truth",
              has_terminal_survey_truth: hasTerminalSurveyTruth,
              has_historical_remote_seen_truth: hasHistoricalRemoteSeenTruth,
              truth_refresh_attempt: truthRefreshAttempt,
            });
            void openNativePostDateSurveyFromTerminalTruth(
              "peer_missing_watchdog_survey_truth",
              truth ?? null,
            );
            return;
          }
          if (hasHistoricalRemoteSeenTruth) {
            setPeerMissingTerminal(false);
            setCallError(null);
            setAwaitingFirstConnect(false);
            setIsConnecting(false);
            videoDateDailyDiagnostic(
              "daily_no_remote_watchdog_historical_truth_suppressed",
              {
                session_id: sessionId,
                room_name: roomNameRef.current ?? null,
                truth_refresh_attempt: truthRefreshAttempt,
              },
            );
            return;
          }
          markPeerMissingTerminal();
        })
        .catch((error) => {
          videoDateDailyDiagnostic("daily_no_remote_watchdog_truth_refetched", {
            session_id: sessionId,
            room_name: roomNameRef.current ?? null,
            ok: false,
            truth_refresh_attempt: truthRefreshAttempt,
            error: error instanceof Error ? error.message : String(error),
          });
          markPeerMissingTerminal();
        });
    }, FIRST_CONNECT_TIMEOUT_MS);

    return () => clearFirstConnectWatchdog();
  }, [
    awaitingFirstConnect,
    hasRemotePartner,
    localInDailyRoom,
    phase,
    sessionId,
    peerMissingTerminal,
    isPartnerDisconnected,
    user?.id,
    eventId,
    refetchVideoSession,
    openNativePostDateSurveyFromTerminalTruth,
    clearFirstConnectWatchdog,
  ]);

  useEffect(() => {
    if (!sessionId || !localInDailyRoom) return;
    getOrSeedVibeQuestionState(sessionId).then(setVibeQuestionState);
  }, [sessionId, localInDailyRoom]);

  useEffect(() => {
    if (!sessionId || !localInDailyRoom) return;
    const channel = supabase
      .channel(`vibe-questions-${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "video_sessions",
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          const row = payload.new as {
            vibe_questions?: unknown;
            vibe_question_index?: unknown;
            vibe_question_anchor_at?: unknown;
          };
          const questions = normalizeVideoDateIceBreakerQuestions(
            row.vibe_questions,
          );
          if (!questions.length) return;
          setVibeQuestionState({
            questions,
            questionIndex: normalizeVideoDateIceBreakerIndex(
              row.vibe_question_index,
              questions.length,
            ),
            questionAnchorAt:
              typeof row.vibe_question_anchor_at === "string" &&
              row.vibe_question_anchor_at.trim()
                ? row.vibe_question_anchor_at
                : null,
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [localInDailyRoom, sessionId]);

  useEffect(() => {
    if (!vibeQuestionState.questions.length) return;
    const interval = setInterval(() => {
      setIceBreakerClockMs(Date.now());
    }, ICE_BREAKER_CLOCK_TICK_MS);
    return () => clearInterval(interval);
  }, [vibeQuestionState.questions.length]);

  useEffect(() => {
    return () => {
      clearFirstConnectWatchdog();
      clearEntryGraceState();
    };
  }, [clearFirstConnectWatchdog, clearEntryGraceState]);

  useEffect(() => {
    if (hasRemotePartner && (phase === "entry" || phase === "date")) {
      setShowIceBreaker(true);
    }
  }, [hasRemotePartner, phase, sessionId]);

  useEffect(() => {
    if (remoteParticipant && !remotePromotionLoggedRef.current) {
      remotePromotionLoggedRef.current = true;
      videoDateDailyDiagnostic("remote_participant_promoted_into_ui", {
        session_id: sessionId ?? "",
        room_name: roomNameRef.current ?? null,
        participant_id: dailyParticipantId(remoteParticipant) ?? "unknown",
      });
    }
    if (!remoteParticipant) {
      remotePromotionLoggedRef.current = false;
    }
  }, [remoteParticipant, sessionId]);

  const {
    markRemoteSeenOnServer,
  } = useNativeVideoDateRemoteSeen({
    activeNativeDailyCallIdentityRef,
    callRef,
    clearDailyAliveHeartbeatTimer,
    eventId,
    markRemoteSeenOnServerRef,
    openNativePostDateSurveyFromTerminalTruth,
    refetchVideoSession,
    remoteSeenActiveSessionRef,
    remoteSeenInFlightSessionRef,
    remoteSeenLastStampRef,
    remoteSeenRetryTimerRef,
    roomNameRef,
    sessionId,
    user,
  });

  useEffect(() => {
    const videoTrack = getTrack(localParticipant ?? undefined, "video");
    const trackId = videoTrack?.id ?? null;
    if (!trackId) {
      lastLocalMountedTrackIdRef.current = null;
      return;
    }
    if (lastLocalMountedTrackIdRef.current === trackId) return;
    lastLocalMountedTrackIdRef.current = trackId;
    videoDateDailyDiagnostic("local_track_mounted", {
      session_id: sessionId ?? "",
      room_name: roomNameRef.current ?? null,
      capture_profile: captureProfile,
      diagnostic_scope: "sender_capture",
      track_id: trackId,
      track_settings: summarizeVideoTrackSettings(videoTrack),
      frame_issue_hint:
        "compare_native_local_track_settings_with_remote_receiver_layout",
    });
  }, [captureProfile, localParticipant, sessionId]);

  useEffect(() => {
    const videoTrack = getTrack(remoteParticipant ?? undefined, "video");
    const trackId = videoTrack?.id ?? null;
    if (!trackId) {
      lastRemoteMountedTrackIdRef.current = null;
      return;
    }
    if (lastRemoteMountedTrackIdRef.current === trackId) return;
    lastRemoteMountedTrackIdRef.current = trackId;
    if (!firstPlayableRemoteTimedRef.current) {
      firstPlayableRemoteTimedRef.current = true;
      firstPlayableRemoteAtMsRef.current = Date.now();
      const bothReadyToFirstRemoteFrameMs =
        preparedEntryBothReadyToFirstRemoteFrameMs(
          activePreparedEntryCacheRef.current,
          firstPlayableRemoteAtMsRef.current,
        );
      endBootstrapTiming("first_playable_remote_media", {
        source: "remote_track_mounted",
        participant_id:
          dailyParticipantId(remoteParticipant ?? undefined) ?? "unknown",
        both_ready_to_first_remote_frame_ms: bothReadyToFirstRemoteFrameMs,
      });
      if (sessionId) {
        const latencyContext = recordReadyGateToDateLatencyCheckpoint({
          sessionId,
          platform: "native",
          eventId: eventId || null,
          sourceSurface: "video_date_daily",
          checkpoint: "first_remote_frame",
          entryAttemptId:
            activePreparedEntryCacheRef.current?.entryAttemptId ??
            activePreparedEntryCacheRef.current?.value.entry_attempt_id ??
            null,
          videoDateTraceId:
            activePreparedEntryCacheRef.current?.value.video_date_trace_id ??
            activePreparedEntryCacheRef.current?.entryAttemptId ??
            null,
          cachedPrepareEntry: activePreparedEntryCacheHitRef.current,
          providerVerifySkipped:
            activePreparedEntryCacheRef.current?.value
              .provider_verify_skipped ?? providerVerifySkippedRef.current,
        });
        trackEvent(
          LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
          buildReadyGateToDateLatencyPayload({
            context: latencyContext,
            checkpoint: "first_remote_frame",
            sourceAction: "remote_track_mounted",
            outcome: "success",
            durationMs: bothReadyToFirstRemoteFrameMs,
          }),
        );
      }
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_FIRST_REMOTE_FRAME, {
        platform: "native",
        session_id: sessionId ?? null,
        event_id: eventId || null,
        source_surface: "video_date_daily",
        source_action: "remote_track_mounted",
        source: "remote_track_mounted",
        bothReadyToFirstRemoteFrameMs,
        duration_ms: bothReadyToFirstRemoteFrameMs,
        latency_bucket: bucketVideoDateLatencyMs(bothReadyToFirstRemoteFrameMs),
        daily_prewarm_consumed: dailyPrewarmConsumedForJoinRef.current,
        prewarmed_join_in_flight: prewarmedJoinInFlightRef.current,
        prewarmed_already_joined: prewarmedAlreadyJoinedRef.current,
        provider_verify_skipped:
          activePreparedEntryCacheRef.current?.value.provider_verify_skipped ??
          providerVerifySkippedRef.current,
      });
    }
    markRemoteSeenOnServer("remote_track_mounted");
    videoDateDailyDiagnostic("remote_track_mounted", {
      session_id: sessionId ?? "",
      room_name: roomNameRef.current ?? null,
      participant_id:
        dailyParticipantId(remoteParticipant ?? undefined) ?? "unknown",
      capture_profile: captureProfile,
      diagnostic_scope: "receiver_layout",
      track_id: trackId,
      track_settings: summarizeVideoTrackSettings(videoTrack),
      receiver_object_fit: VIDEO_DATE_REMOTE_OBJECT_FIT,
      receiver_object_position: VIDEO_DATE_REMOTE_OBJECT_POSITION,
      frame_issue_hint:
        "remote_layout_contains_sender_frame_without_receiver_crop",
    });
  }, [
    captureProfile,
    remoteParticipant,
    sessionId,
    eventId,
    endBootstrapTiming,
    markRemoteSeenOnServer,
  ]);

  useEffect(() => {
    if (!hasRemotePartner || phase !== "entry") return;
    const start = 80;
    const duration = 10000;
    const startTime = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startTime;
      if (elapsed >= duration) {
        setBlurIntensity(0);
        if (!remoteReadableTrackedRef.current && sessionId) {
          remoteReadableTrackedRef.current = true;
          const readableContext = recordReadyGateToDateLatencyCheckpoint({
            sessionId,
            platform: "native",
            eventId: eventId || null,
            sourceSurface: "video_date_daily",
            checkpoint: "remote_readable",
          });
          const firstRemoteFrameToReadableMs =
            firstPlayableRemoteAtMsRef.current > 0
              ? Math.max(0, Date.now() - firstPlayableRemoteAtMsRef.current)
              : null;
          trackEvent(
            LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
            buildReadyGateToDateLatencyPayload({
              context: readableContext,
              checkpoint: "remote_readable",
              sourceAction: "progressive_blur_complete",
              outcome: "success",
              durationMs: firstRemoteFrameToReadableMs,
            }),
          );
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_REMOTE_READABLE, {
            platform: "native",
            session_id: sessionId,
            event_id: eventId || null,
            source_surface: "video_date_daily",
            source_action: "progressive_blur_complete",
            duration_ms: firstRemoteFrameToReadableMs,
            latency_bucket: bucketVideoDateLatencyMs(
              firstRemoteFrameToReadableMs,
            ),
          });
        }
        return;
      }
      setBlurIntensity(start - (start * elapsed) / duration);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [eventId, hasRemotePartner, phase, sessionId]);

  const refreshCredits = useCallback(() => {
    if (!user?.id) return;
    void fetchUserCredits(user.id).then(setCredits);
  }, [user?.id]);

  useEffect(() => {
    if (!localInDailyRoom) return;
    if (!localVideoReadyTrackedRef.current && sessionId) {
      localVideoReadyTrackedRef.current = true;
      const latencyContext = recordReadyGateToDateLatencyCheckpoint({
        sessionId,
        platform: "native",
        eventId: eventId || null,
        sourceSurface: "video_date_daily",
        checkpoint: "local_video_ready",
      });
      trackEvent(
        LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
        buildReadyGateToDateLatencyPayload({
          context: latencyContext,
          checkpoint: "local_video_ready",
          sourceAction: "local_daily_joined",
          outcome: "success",
        }),
      );
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_LOCAL_VIDEO_READY, {
        platform: "native",
        session_id: sessionId,
        event_id: eventId || null,
        source_surface: "video_date_daily",
        source_action: "local_daily_joined",
      });
    }
    refreshCredits();
  }, [eventId, localInDailyRoom, refreshCredits, sessionId]);

  useFocusEffect(
    useCallback(() => {
      refreshCredits();
    }, [refreshCredits]),
  );

  /** After background/foreground or navigation, re-read Daily participant state so toggles match the call. */
  useFocusEffect(
    useCallback(() => {
      const call = callRef.current;
      if (!call || !localInDailyRoom) return;
      const participants = call.participants();
      const local = participants?.local;
      if (local) {
        localParticipantRef.current = local;
        setLocalParticipant(local);
        applyLocalMediaUiFromParticipant(local, { setIsVideoOff, setIsMuted });
      }
      const remotes = participants
        ? Object.values(participants).filter(
            (p) => !(p as unknown as { local?: boolean }).local,
          )
        : [];
      if (remotes[0]) {
        const remote = remotes[0] as DailyParticipant;
        clearPartnerAwayAfterTransportGrace("focus_snapshot");
        remoteParticipantRef.current = remote;
        resetNativeRemoteRenderRecovery(remote, "focus_snapshot");
        setRemoteParticipant(remote);
        setPartnerEverJoined(true);
        setIsPartnerDisconnected(false);
      }
    }, [
      clearPartnerAwayAfterTransportGrace,
      localInDailyRoom,
      resetNativeRemoteRenderRecovery,
    ]),
  );

  useEffect(() => {
    if (!sessionId || !hasRemotePartner || phase !== "entry") return;
    if (entryAnalyticsRef.current) return;
    entryAnalyticsRef.current = true;
    trackEvent("video_date_started", {
      session_id: sessionId,
      phase: "entry",
    });
  }, [sessionId, hasRemotePartner, phase]);

  const {
    cleanupDailyAndLocalState,
    cleanupForAbortWithoutServerEnd,
    handleCallEnd,
    clearReconnectSyncTimer,
    handleEndAfterInCallReport,
    handleReportOnlySafetySuccess,
    handleServerEndedAfterInCallReport,
  } = useNativeVideoDateCallEndCleanup({
    activeNativeDailyCallIdentityRef,
    callRef,
    captureProfileRef,
    clearDailyAliveHeartbeatTimer,
    clearDailyTokenRefreshTimer,
    clearEntryGraceState,
    clearFirstConnectWatchdog,
    clearPartnerAwayAfterTransportGrace,
    confirmNativeTerminalPostDateRecovery,
    countdownCompletionKeyRef,
    dailyTokenExpiresAtRef,
    dailyTokenRecoveryInFlightRef,
    dateEstablishedRef,
    detachCallListeners,
    eventId,
    handleCallEndRef,
    lastNativeRemoteCameraSwitchHintIdRef,
    localParticipantRef,
    nativeCameraSwitchInFlightRef,
    parkSharedCallForWarmHandoff,
    partnerEverJoined,
    peerMissingTerminal,
    peerMissingTruthRefreshCountRef,
    phase,
    phaseRef,
    postEncounterPeerMissingSuppressedRef,
    reconnectSyncTimerRef,
    recoverNativeDailyTokenRef,
    refetchVideoSession,
    releaseSharedCallIfOwned,
    remoteParticipantRef,
    requestReconnectSyncRef,
    resetNativeRemoteRenderRecovery,
    roomNameRef,
    session,
    sessionId,
    setAwaitingFirstConnect,
    setCaptureProfile,
    setIsConnecting,
    setIsMuted,
    setIsPartnerDisconnected,
    setIsVideoOff,
    setLocalInDailyRoom,
    setLocalParticipant,
    setNetQualityTier,
    setPartnerEverJoined,
    setPeerMissingTerminal,
    setPreJoinFailed,
    setRemoteParticipant,
    setSafetySubmitOutcome,
    setShowFeedback,
    setShowInCallSafety,
    setShowProfileSheet,
    showFeedback,
    terminalSurveyHardStopRef,
    user,
    videoDateEndedRef,
  });

  useNativeVideoDateAppStateBackground({
    appStateAwaySessionRef,
    appStateBackgroundIntervalRef,
    appStateBackgroundStartedAtRef,
    appStateBackgroundTimerRef,
    appStateExpiredSessionRef,
    appStateRecoveredTimerRef,
    callRef,
    cleanupDailyAndLocalState,
    confirmNativeTerminalPostDateRecovery,
    eventId,
    hasStartedJoinRef,
    localInDailyRoomRef,
    phaseRef,
    refetchVideoSession,
    requestReconnectSyncRef,
    retryBroadcastGapRecovery,
    roomNameRef,
    sessionId,
    setJoinAttemptNonce,
    setNativeBackgroundGraceSeconds,
    setNativeBackgroundStatus,
  });

  useEffect(() => {
    if (!sessionId || phase === "ended") return;
    let cancelled = false;
    let inFlight = false;

    const stopLoop = (reason: string) => {
      clearReconnectSyncTimer();
      if (reconnectSyncWindowStartedAtRef.current !== null) {
        vdbg("sync_reconnect_loop_stop", {
          sessionId,
          phase: phaseRef.current,
          reason,
          totalSyncCount: reconnectSyncCountRef.current,
          elapsedMs: Date.now() - reconnectSyncWindowStartedAtRef.current,
        });
      }
      reconnectSyncWindowStartedAtRef.current = null;
    };

    const scheduleBackoff = (reason: string) => {
      if (cancelled || phaseRef.current === "ended") return;
      const startedAt = reconnectSyncWindowStartedAtRef.current ?? Date.now();
      reconnectSyncWindowStartedAtRef.current = startedAt;
      const delayMs = nextConvergenceDelayMs(
        Math.max(0, Date.now() - startedAt),
      );
      clearReconnectSyncTimer();
      vdbg("sync_reconnect_schedule", {
        sessionId,
        phase: phaseRef.current,
        reason,
        mode: "backoff",
        delayMs,
        totalSyncCount: reconnectSyncCountRef.current,
      });
      reconnectSyncTimerRef.current = setTimeout(() => {
        void runSync(reason, "backoff");
      }, delayMs);
    };

    const runSync = async (reason: string, mode: "immediate" | "backoff") => {
      if (cancelled || !sessionId || phaseRef.current === "ended") return;
      const canSyncReconnect =
        videoSessionRowIndicatesEntryOrDate(
          session
            ? {
                state: session.state ?? null,
                daily_room_name: session.daily_room_name ?? null,
                daily_room_url: session.daily_room_url ?? null,
                entry_started_at: session.entry_started_at,
              }
            : null,
        );
      if (!canSyncReconnect) {
        vdbg("sync_reconnect_skip", {
          sessionId,
          phase: phaseRef.current,
          reason,
          mode,
          skip: "server_truth_not_entry_or_date",
          serverState: session?.state ?? null,
          entryStartedAt: entryStartedAtIso,
        });
        return;
      }
      if (inFlight) {
        vdbg("sync_reconnect_skip", {
          sessionId,
          phase: phaseRef.current,
          reason,
          mode,
          skip: "in_flight",
        });
        return;
      }
      inFlight = true;
      reconnectSyncCountRef.current += 1;
      vdbg("sync_reconnect_fire", {
        sessionId,
        phase: phaseRef.current,
        reason,
        mode,
        totalSyncCount: reconnectSyncCountRef.current,
      });
      try {
        const r = await syncVideoDateReconnect(sessionId);
        if (cancelled) {
          vdbg("sync_reconnect_result", {
            sessionId,
            phase: phaseRef.current,
            reason,
            mode,
            outcome: "cancelled",
            resultKind: r
              ? "cancelled_after_result"
              : "cancelled_after_null_result",
          });
          return;
        }
        if (!r) {
          vdbg("sync_reconnect_result", {
            sessionId,
            phase: phaseRef.current,
            reason,
            mode,
            outcome: VIDEO_DATE_RECONNECT_SYNC_OUTCOMES.RPC_ERROR,
            syncHelperReturnedNullBecause: "supabase_rpc_reported_error",
          });
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_SYNC_RECONNECT_FAILED, {
            platform: "native",
            session_id: sessionId,
            event_id: eventId || null,
            reason,
            mode,
          });
          scheduleBackoff("rpc_error");
          return;
        }
        if (r.ended) {
          vdbg("sync_reconnect_result", {
            sessionId,
            phase: phaseRef.current,
            reason,
            mode,
            outcome: VIDEO_DATE_RECONNECT_SYNC_OUTCOMES.ENDED,
            endedReason: r.ended_reason ?? null,
          });
          // Any server-reported end from sync_reconnect (grace expiry, partner end, etc.) → same post-date path as web.
          if (!reconnectEndedHandledRef.current) {
            reconnectEndedHandledRef.current = true;
            const recoveredSurvey =
              await openNativePostDateSurveyFromTerminalTruth("sync_reconnect");
            if (recoveredSurvey) {
              void cleanupForAbortWithoutServerEnd();
            } else {
              void handleCallEndRef.current?.("server_end");
            }
          }
          setIsPartnerDisconnected(false);
          setIsTimerPaused(false);
          setReconnectionGrace(0);
          stopLoop("session_ended");
          return;
        }
        reconnectEndedHandledRef.current = false;
        const hasGrace = !!r.reconnect_grace_ends_at;
        const show = hasGrace && r.partner_marked_away;
        vdbg("sync_reconnect_result", {
          sessionId,
          phase: phaseRef.current,
          reason,
          mode,
          outcome: VIDEO_DATE_RECONNECT_SYNC_OUTCOMES.OK,
          hasGrace,
          partnerMarkedAway: r.partner_marked_away,
        });
        setIsPartnerDisconnected(show);
        setIsTimerPaused(show);
        if (hasGrace && r.reconnect_grace_ends_at) {
          setReconnectionGrace(
            Math.max(
              0,
              Math.ceil(
                (new Date(r.reconnect_grace_ends_at).getTime() - Date.now()) /
                  1000,
              ),
            ),
          );
          scheduleBackoff(
            show
              ? "reconnect_grace_active"
              : "grace_active_partner_not_marked_away",
          );
          return;
        }
        setReconnectionGrace(0);
        stopLoop("truth_stable_no_grace");
      } finally {
        inFlight = false;
      }
    };

    requestReconnectSyncRef.current = (reason: string) => {
      if (cancelled || !sessionId || phaseRef.current === "ended") return;
      if (reconnectSyncWindowStartedAtRef.current === null) {
        reconnectSyncWindowStartedAtRef.current = Date.now();
      }
      void runSync(reason, "immediate");
    };

    requestReconnectSyncRef.current("mount_or_phase_change");
    return () => {
      cancelled = true;
      clearReconnectSyncTimer();
      requestReconnectSyncRef.current = () => {};
    };
    // Reconnect polling is intentionally keyed to phase scalars; the full session object would restart active recovery loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sessionId,
    phase,
    session?.state,
    entryStartedAtIso,
    eventId,
    clearReconnectSyncTimer,
    cleanupForAbortWithoutServerEnd,
    openNativePostDateSurveyFromTerminalTruth,
  ]);

  useEffect(() => {
    reconnectSyncCountRef.current = 0;
    reconnectSyncWindowStartedAtRef.current = null;
    clearReconnectSyncTimer();
  }, [sessionId, clearReconnectSyncTimer]);

  useEffect(() => {
    const prev = prevLocalInDailyRef.current;
    prevLocalInDailyRef.current = localInDailyRoom;
    if (!localInDailyRoom) return;
    if (!partnerEverJoined) return;
    if (!prev && sessionId && phase !== "ended") {
      void markReconnectReturn(sessionId);
      requestReconnectSyncRef.current("daily_local_reconnected");
    }
  }, [localInDailyRoom, partnerEverJoined, sessionId, phase]);

  /** In-call / post-connect: end date, cleanup Daily, show PostDateSurvey (navigation from survey only). */
  const handleEndDateFromControls = useCallback(async () => {
    if (isEndDateConfirming) return;
    setIsEndDateConfirming(true);
    Alert.alert(
      "End this date?",
      "Stay if you tapped by accident. Ending will close the call for you.",
      [
        {
          text: "Stay",
          style: "cancel",
          onPress: () => setIsEndDateConfirming(false),
        },
        {
          text: "End date",
          style: "destructive",
          onPress: () => {
            void handleCallEnd("local_end").finally(() =>
              setIsEndDateConfirming(false),
            );
          },
        },
      ],
      { cancelable: true, onDismiss: () => setIsEndDateConfirming(false) },
    );
  }, [handleCallEnd, isEndDateConfirming]);

  /** Connecting or waiting for partner: exit without post-date survey (nothing to rate yet). */
  const handleAbortConnection = useCallback(
    async (opts?: { source?: "peer_missing" }) => {
      if (abortConnectionInFlightRef.current) return;
      abortConnectionInFlightRef.current = true;
      setIsAbortingConnection(true);
      try {
        if (opts?.source === "peer_missing" && sessionId) {
          trackEvent(
            LobbyPostDateEvents.VIDEO_DATE_PEER_MISSING_BACK_TO_LOBBY_TAP,
            {
              platform: "native",
              session_id: sessionId,
              event_id: eventId,
              room_name: roomNameRef.current ?? null,
            },
          );
          let truth: VideoSessionDateEntryTruth | null = null;
          let truthFetchFailed = false;
          try {
            truth = await fetchVideoSessionDateEntryTruth(sessionId, {
              throwOnError: true,
            });
          } catch (error) {
            truthFetchFailed = true;
            vdbg("native_peer_missing_abort_truth_failed", {
              sessionId,
              eventId,
              roomName: roomNameRef.current ?? null,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          const confirmedEncounter =
            dateEstablishedRef.current ||
            truth?.date_started_at ||
            truth?.state === "date" ||
            truth?.phase === "date" ||
            videoSessionHasEncounterExposureTruth(truth);
          if (confirmedEncounter) {
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_NO_REMOTE_USER_EXIT, {
              platform: "native",
              session_id: sessionId,
              event_id: eventId,
              room_name: roomNameRef.current ?? null,
              source_surface: "video_date_route",
              source_action: "peer_missing_back_to_lobby",
              outcome: "server_end_attempted",
              reason_code: "partner_absent_after_confirmed_encounter",
              server_end_attempted: true,
              truth_fetch_failed: truthFetchFailed,
            });
            await handleCallEnd(
              "local_end",
              "partner_absent_after_confirmed_encounter",
            );
            return;
          }
          if (
            truthFetchFailed ||
            shouldTerminalizeNativePeerMissingAbort(truth)
          ) {
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_NO_REMOTE_USER_EXIT, {
              platform: "native",
              session_id: sessionId,
              event_id: eventId,
              room_name: roomNameRef.current ?? null,
              source_surface: "video_date_route",
              source_action: "peer_missing_back_to_lobby",
              outcome: "server_end_attempted",
              reason_code: "partial_join_peer_timeout",
              server_end_attempted: true,
              truth_fetch_failed: truthFetchFailed,
            });
            await endVideoDate(sessionId, "partial_join_peer_timeout");
          } else {
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_NO_REMOTE_USER_EXIT, {
              platform: "native",
              session_id: sessionId,
              event_id: eventId,
              room_name: roomNameRef.current ?? null,
              source_surface: "video_date_route",
              source_action: "peer_missing_back_to_lobby",
              outcome: "server_end_attempted",
              reason_code: "pre_date_manual_end",
              server_end_attempted: true,
            });
            vdbg("native_peer_missing_abort_pre_date_cleanup", {
              sessionId,
              eventId,
              roomName: roomNameRef.current ?? null,
              state: truth?.state ?? null,
              phase: truth?.phase ?? null,
              endedAt: truth?.ended_at ?? null,
              dateStartedAt: truth?.date_started_at ?? null,
              participant1Joined: Boolean(truth?.participant_1_joined_at),
              participant2Joined: Boolean(truth?.participant_2_joined_at),
            });
            await endVideoDate(sessionId, "ended_from_client");
          }
        } else if (sessionId) {
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_NO_REMOTE_USER_EXIT, {
            platform: "native",
            session_id: sessionId,
            event_id: eventId,
            room_name: roomNameRef.current ?? null,
            source_surface: "video_date_route",
            source_action: "pre_connect_back_to_lobby",
            outcome: "server_end_attempted",
            reason_code: "pre_date_manual_end",
            server_end_attempted: true,
          });
          await endVideoDate(sessionId, "ended_from_client");
        }
        if (sessionId) suppressDateNavigationAfterManualExit(sessionId);
        await cleanupForAbortWithoutServerEnd();
        if (eventId) {
          const target = eventLobbyHref(eventId);
          vdbgRedirect(target, "abort_connection", {
            sessionId: sessionId ?? null,
            eventId,
          });
          router.replace(target);
        } else {
          const target = "/(tabs)/events";
          vdbgRedirect(target, "abort_connection", {
            sessionId: sessionId ?? null,
          });
          router.replace(target);
        }
      } finally {
        setIsAbortingConnection(false);
        abortConnectionInFlightRef.current = false;
      }
    },
    [cleanupForAbortWithoutServerEnd, eventId, handleCallEnd, sessionId],
  );

  const {
    claimNativeVideoDateSurface,
    handleSwitchDeviceHere,
    handleLeaveBlockedSurface,
  } = useNativeVideoDateSurfaceClaim({
    cleanupForAbortWithoutServerEnd,
    dateEntryPermissionEligible,
    eventId,
    hasStartedJoinRef,
    isConnecting,
    joining,
    localInDailyRoom,
    nativeSurfaceClientReady,
    phase,
    phaseRef,
    sessionId,
    setJoinAttemptNonce,
    setSurfaceClaimBlockedState,
    setSurfaceClaimTakeoverBusy,
    showFeedback,
    surfaceClaimBackoffUntilRef,
    surfaceClaimBlockedRef,
    surfaceClaimFailureCountRef,
    surfaceClaimInFlightPromiseRef,
    surfaceClaimInFlightRef,
    surfaceClaimTakeoverBusy,
    user,
    videoDateClientInstanceIdRef,
    videoDateSurfaceOwnerIdRef,
  });

  const handleEntryDecision = useCallback(
    async (action: "vibe" | "pass"): Promise<boolean> => {
      if (!sessionId || !user?.id) return false;
      if (entryDecisionInFlightRef.current) return false;
      entryDecisionInFlightRef.current = true;
      try {
        const result = await recordEntryDecision(
          sessionId,
          action,
          {
            actorUserId: user.id,
            phase: phaseRef.current,
          },
        );
        vdbg("entry_decision_ui_result", {
          sessionId,
          actorUserId: user.id,
          action,
          ok: result.ok,
          attempts: result.attempts,
          reason: result.ok ? null : result.reason,
          actorDecisionPersisted: result.actorDecisionPersisted,
          participant_1_liked: result.truth?.participant_1_liked ?? null,
          participant_2_liked: result.truth?.participant_2_liked ?? null,
          participant_1_decided_at:
            result.truth?.participant_1_decided_at ?? null,
          participant_2_decided_at:
            result.truth?.participant_2_decided_at ?? null,
          completeEntryTriggeredAfterPersistence: false,
          completeEntryTriggerReason: result.ok
            ? "decision_rpc_owns_transition"
            : "decision_not_persisted",
        });
        if (!result.ok) {
          void refetchVideoSession();
          const sessionEnded = entryDecisionFailureIndicatesSessionEnded({
            truth: result.truth,
            rpcPayload: result.rpcPayload,
          });
          if (sessionEnded) {
            clearEntryGraceState();
            vdbg("prejoin_state_callError", {
              value: null,
              sessionId,
              userId: user.id,
              step: "entry_decision_terminal",
            });
            setCallError(null);
            void handleCallEnd("server_end");
            return false;
          }
          vdbg("prejoin_state_callError", {
            value: result.userMessage,
            sessionId,
            userId: user.id,
            step: "entry_decision",
          });
          setCallError(result.userMessage);
          return false;
        }
        setCallError(null);
        const transitionedToDate =
          action === "vibe" &&
          (result.state === "date" ||
            result.truth.state === "date" ||
            result.truth.phase === "date" ||
            Boolean(result.truth.date_started_at));
        if (transitionedToDate) {
          clearEntryGraceState();
          setShowMutualToast(true);
        }
        // Immediately reconcile UI from server truth so that localEntryDecision
        // reflects the persisted decision even if the Realtime UPDATE arrives late
        // or the component remounts before it does.
        void refetchVideoSession();
        return true;
      } finally {
        entryDecisionInFlightRef.current = false;
      }
    },
    [
      sessionId,
      user?.id,
      refetchVideoSession,
      clearEntryGraceState,
      handleCallEnd,
    ],
  );

  const handleUserVibe = useCallback(
    () => handleEntryDecision("vibe"),
    [handleEntryDecision],
  );
  const handleUserPass = useCallback(
    () => handleEntryDecision("pass"),
    [handleEntryDecision],
  );

  const handleMutualToastComplete = useCallback(() => {
    clearEntryGraceState();
    setShowMutualToast(false);
    setLocalTimeLeft(
      remainingDatePhaseSeconds({
        dateStartedAtIso: session?.date_started_at,
        baseDateSeconds: DATE_SECONDS,
        dateExtraSeconds: session?.date_extra_seconds,
      }),
    );
  }, [
    clearEntryGraceState,
    session?.date_extra_seconds,
    session?.date_started_at,
  ]);

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
      if (!sessionId) return;
      const context = recordReadyGateToDateLatencyCheckpoint({
        sessionId,
        platform: "native",
        eventId: eventId || null,
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
    [eventId, sessionId],
  );

  const handleExtend = useCallback(
    async (
      minutes: number,
      type: "extra_time" | "extended_vibe",
    ): Promise<VideoDateExtendOutcome> => {
      if (!user?.id) {
        return {
          ok: false,
          userMessage: userMessageForExtensionSpendFailure("unauthorized"),
        };
      }
      if (extensionSpendInFlightRef.current) {
        return { ok: false, userMessage: "", silent: true };
      }
      extensionSpendInFlightRef.current = true;
      const retry =
        extensionSpendRetryRef.current?.type === type
          ? extensionSpendRetryRef.current
          : null;
      const idempotencyKey =
        retry?.key ??
        makeMutualExtensionIdempotencyKey(
          sessionId ?? "unknown-session",
          type,
        );
      extensionSpendRetryRef.current = {
        type,
        key: idempotencyKey,
        mutual: true,
      };
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_EXTENSION_ATTEMPTED, {
        platform: "native",
        session_id: sessionId,
        event_id: eventId,
        credit_type: type,
      });
      const extensionMode = "mutual_v2";
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
            extension_mutual: true,
            ...(extra ?? {}),
          },
        });
      };
      trackExtensionRefreshCheckpoint("extension_refresh_started", "success");
      setIsExtending(true);
      setExtendBanner(null);
      try {
        if (!sessionId) {
          extensionSpendRetryRef.current = null;
          const msg = userMessageForExtensionSpendFailure("session_not_found");
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_EXTENSION_FAILED, {
            platform: "native",
            session_id: sessionId,
            event_id: eventId,
            credit_type: type,
            reason: "session_not_found",
          });
          trackExtensionRefreshCheckpoint(
            "extension_refresh_failure",
            "failure",
            "session_not_found",
            {
              extension_awaiting_partner: false,
              extension_applied: false,
            },
          );
          setExtendBanner({ kind: "error", message: msg });
          return { ok: false, userMessage: msg };
        }
        const result = await spendVideoDateCreditExtension(
          sessionId,
          type,
          idempotencyKey,
        );
        if (result.ok) {
          extensionSpendRetryRef.current = null;
          if (result.awaitingPartner) {
            setPendingPartnerExtension(null);
            setExtendBanner({
              kind: "pending",
              message: "Request sent. The date extends if your match accepts.",
            });
            trackEvent("video_date_extension_requested", {
              platform: "native",
              session_id: sessionId,
              event_id: eventId,
              credit_type: type,
              request_expires_at: result.requestExpiresAt ?? null,
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
              mutual: result.mutual === true,
              minutesAdded: 0,
              secondsAdded: 0,
              dateExtraSeconds: session?.date_extra_seconds ?? 0,
              requestExpiresAt: result.requestExpiresAt ?? null,
            };
          }
          void fetchUserCredits(user.id).then(setCredits);
          trackEvent("video_date_extended", { session_id: sessionId });
          const addedSeconds = Math.max(
            0,
            Math.floor(result.addedSeconds || minutes * 60),
          );
          const nextExtra =
            typeof result.dateExtraSeconds === "number"
              ? Math.max(0, Math.floor(result.dateExtraSeconds))
              : Math.max(0, (session?.date_extra_seconds ?? 0) + addedSeconds);
          setPendingPartnerExtension(null);
          setLocalTimeLeft((prev) => {
            if (!session?.date_started_at) return (prev ?? 0) + addedSeconds;
            return remainingDatePhaseSeconds({
              dateStartedAtIso: session.date_started_at,
              baseDateSeconds: DATE_SECONDS,
              dateExtraSeconds: nextExtra,
            });
          });
          void refetchVideoSession();
          const minutesAdded = addedSeconds / 60;
          setExtendBanner({ kind: "success", minutes: minutesAdded });
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_EXTENSION_SUCCEEDED, {
            platform: "native",
            session_id: sessionId,
            event_id: eventId,
            credit_type: type,
            added_seconds: addedSeconds,
            date_extra_seconds: nextExtra,
            idempotent: result.idempotent === true,
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
          return {
            ok: true,
            mutual: result.mutual === true,
            minutesAdded,
            secondsAdded: addedSeconds,
            dateExtraSeconds: nextExtra,
          };
        }
        extensionSpendRetryRef.current = null;
        const msg = userMessageForExtensionSpendFailure(result.error);
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_EXTENSION_FAILED, {
          platform: "native",
          session_id: sessionId,
          event_id: eventId,
          credit_type: type,
          reason: result.error,
        });
        trackExtensionRefreshCheckpoint(
          "extension_refresh_failure",
          "failure",
          result.error,
          {
            extension_awaiting_partner: false,
            extension_applied: false,
          },
        );
        setExtendBanner({ kind: "error", message: msg });
        return { ok: false, userMessage: msg };
      } catch (error) {
        const msg = userMessageForExtensionSpendFailure("rpc_transport");
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_EXTENSION_FAILED, {
          platform: "native",
          session_id: sessionId,
          event_id: eventId,
          credit_type: type,
          reason: "exception",
          error_name: error instanceof Error ? error.name : "unknown",
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
        setExtendBanner({ kind: "error", message: msg });
        return { ok: false, userMessage: msg };
      } finally {
        extensionSpendInFlightRef.current = false;
        setIsExtending(false);
      }
    },
    [
      user?.id,
      sessionId,
      eventId,
      refetchVideoSession,
      session?.date_extra_seconds,
      session?.date_started_at,
      trackDailyPerformanceCheckpoint,
    ],
  );

  useEffect(() => {
    if (!extendBanner) return;
    const t = setTimeout(() => setExtendBanner(null), 2500);
    return () => clearTimeout(t);
  }, [extendBanner]);

  useEffect(() => {
    setPendingPartnerExtension(null);
  }, [sessionId]);

  useEffect(() => {
    if (!pendingPartnerExtension?.expiresAt) return;
    const expiresMs = new Date(pendingPartnerExtension.expiresAt).getTime();
    if (!Number.isFinite(expiresMs)) return;
    const delayMs = expiresMs - Date.now();
    if (delayMs <= 0) {
      setPendingPartnerExtension(null);
      return;
    }
    const timeout = setTimeout(() => {
      setPendingPartnerExtension((current) =>
        current?.expiresAt === pendingPartnerExtension.expiresAt
          ? null
          : current,
      );
    }, delayMs + 250);
    return () => clearTimeout(timeout);
  }, [pendingPartnerExtension?.expiresAt]);

  const requestPermissions = useCallback(async (): Promise<boolean> => {
    const permissionStartedAt = Date.now();
    if (sessionId) {
      const startedContext = recordReadyGateToDateLatencyCheckpoint({
        sessionId,
        platform: "native",
        eventId: eventId || null,
        sourceSurface: "video_date_daily",
        checkpoint: "permission_check_started",
        nowMs: permissionStartedAt,
      });
      trackEvent(
        LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
        buildReadyGateToDateLatencyPayload({
          context: startedContext,
          checkpoint: "permission_check_started",
          sourceAction: "permission_check_started",
          outcome: "success",
        }),
      );
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_PERMISSION_CHECK_STARTED, {
        platform: "native",
        session_id: sessionId,
        event_id: eventId || null,
        source_surface: "video_date_daily",
        source_action: "permission_check_started",
      });
    }
    const finishPermissionCheck = (ok: boolean, source: string) => {
      if (ok) setPermissionRecoveryAction(null);
      if (sessionId && ok) {
        const successContext = recordReadyGateToDateLatencyCheckpoint({
          sessionId,
          platform: "native",
          eventId: eventId || null,
          sourceSurface: "video_date_daily",
          checkpoint: "permission_check_success",
          permissionHandoffUsed: source === "ready_gate_permission_handoff",
        });
        const durationMs = Math.max(0, Date.now() - permissionStartedAt);
        trackEvent(
          LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
          buildReadyGateToDateLatencyPayload({
            context: successContext,
            checkpoint: "permission_check_success",
            sourceAction: source,
            outcome: "success",
            durationMs,
          }),
        );
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_PERMISSION_CHECK_SUCCESS, {
          platform: "native",
          session_id: sessionId,
          event_id: eventId || null,
          source_surface: "video_date_daily",
          source_action: source,
          duration_ms: durationMs,
          latency_bucket: bucketVideoDateLatencyMs(durationMs),
        });
      }
      return ok;
    };
    const trackPermissionDenied = (
      result: Awaited<
        ReturnType<typeof requestNativeCameraMicrophonePermissions>
      >,
    ) => {
      if (!sessionId) return;
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_MEDIA_PERMISSION_DENIED, {
        platform: "native",
        session_id: sessionId,
        event_id: eventId || null,
        source_surface: "video_date_daily",
        source_action: result.source,
        reason:
          result.mediaPermission.rawErrorName ??
          "native_media_permission_denied",
        permission_status: result.mediaPermission.status,
        permission_state: result.mediaPermission.permissionState,
        recovery_action: result.mediaPermission.recoveryAction,
        camera_status: result.cameraStatus,
        microphone_status: result.microphoneStatus,
        camera_can_ask_again: result.cameraCanAskAgain,
        microphone_can_ask_again: result.microphoneCanAskAgain,
      });
    };
    const permissionHandoff =
      sessionId && user?.id
        ? getVideoDatePermissionHandoff(sessionId, user.id)
        : null;
    if (permissionHandoff) {
      vdbg("prejoin_step_prejoin_permissions_before", {
        platform: Platform.OS,
        source: "ready_gate_permission_handoff_verify",
        handoffSource: permissionHandoff.source,
      });
      const result = await requestNativeCameraMicrophonePermissions({
        sessionId,
        userId: user?.id,
        setHandoff: false,
        sources: {
          androidExisting: "ready_gate_permission_handoff",
          androidRequest: "ready_gate_permission_handoff_request",
          nativeExisting: "ready_gate_permission_handoff",
          nativeRequest: "ready_gate_permission_handoff_request",
        },
      });
      vdbg("prejoin_state_hasPermission", {
        value: result.ok,
        source: result.ok ? "ready_gate_permission_handoff" : result.source,
        permissionStatus: result.mediaPermission.status,
      });
      setHasPermission(result.ok);
      setPermissionRecoveryAction(
        result.ok ? null : result.mediaPermission.recoveryAction,
      );
      vdbg("prejoin_step_prejoin_permissions_after", {
        platform: Platform.OS,
        cameraStatus: result.cameraStatus,
        microphoneStatus: result.microphoneStatus,
        cameraGranted: result.cameraStatus === "granted",
        microphoneGranted: result.microphoneStatus === "granted",
        cameraCanAskAgain: result.cameraCanAskAgain,
        microphoneCanAskAgain: result.microphoneCanAskAgain,
        ok: result.ok,
        source: result.ok ? "ready_gate_permission_handoff" : result.source,
        permissionStatus: result.mediaPermission.status,
        recoveryAction: result.mediaPermission.recoveryAction,
      });
      if (!result.ok) trackPermissionDenied(result);
      return finishPermissionCheck(
        result.ok,
        result.ok ? "ready_gate_permission_handoff" : result.source,
      );
    }
    vdbg("prejoin_step_prejoin_permissions_before", {
      platform: Platform.OS,
      source: "shared_native_media_permission_helper",
    });
    const result = await requestNativeCameraMicrophonePermissions({
      sessionId,
      userId: user?.id,
      sources: {
        androidExisting: "existing_grants",
        androidRequest: "request",
        nativeExisting: "existing_grants",
        nativeRequest: "request",
      },
    });
    vdbg("prejoin_state_hasPermission", {
      value: result.ok,
      source: result.source,
      permissionStatus: result.mediaPermission.status,
    });
    setHasPermission(result.ok);
    setPermissionRecoveryAction(
      result.ok ? null : result.mediaPermission.recoveryAction,
    );
    vdbg("prejoin_step_prejoin_permissions_after", {
      platform: Platform.OS,
      cameraStatus: result.cameraStatus,
      microphoneStatus: result.microphoneStatus,
      cameraGranted: result.cameraStatus === "granted",
      microphoneGranted: result.microphoneStatus === "granted",
      cameraCanAskAgain: result.cameraCanAskAgain,
      microphoneCanAskAgain: result.microphoneCanAskAgain,
      ok: result.ok,
      source: result.source,
      permissionStatus: result.mediaPermission.status,
      recoveryAction: result.mediaPermission.recoveryAction,
    });
    if (!result.ok) trackPermissionDenied(result);
    return finishPermissionCheck(result.ok, result.source);
  }, [eventId, sessionId, user?.id]);

  const handleRetryInitialConnect = useCallback(async () => {
    if (peerMissingTerminal && sessionId) {
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_PEER_MISSING_RETRY_TAP, {
        platform: "native",
        session_id: sessionId,
        event_id: eventId,
      });
    }
    clearFirstConnectWatchdog();
    const call = callRef.current;
    if (call) {
      detachCallListeners("retry_initial_connect");
      try {
        await call.leave();
      } catch (_error) {
        void _error;
      }
      try {
        await destroyNativeVideoDateDailyCall(call, "retry_initial_connect", {
          sessionId,
          userId: user?.id ?? null,
          roomName: roomNameRef.current ?? null,
        });
      } catch (_error) {
        void _error;
      }
      releaseSharedCallIfOwned(call, "retry_initial_connect");
      callRef.current = null;
    }
    vdbg("prejoin_state_awaitingFirstConnect", {
      value: false,
      sessionId: sessionId ?? null,
      userId: user?.id ?? null,
      step: "retry_initial_connect",
    });
    setAwaitingFirstConnect(false);
    setPeerMissingTerminal(false);
    vdbg("prejoin_state_preJoinFailed", {
      value: false,
      sessionId: sessionId ?? null,
      userId: user?.id ?? null,
      step: "retry_initial_connect",
    });
    setPreJoinFailed(false);
    vdbg("prejoin_state_callError", {
      value: null,
      sessionId: sessionId ?? null,
      userId: user?.id ?? null,
      step: "retry_initial_connect",
    });
    setCallError(null);
    remoteParticipantRef.current = null;
    lastNativeRemoteCameraSwitchHintIdRef.current = null;
    resetNativeRemoteRenderRecovery(null, "retry_initial_connect");
    setRemoteParticipant(null);
    vdbg("prejoin_state_localInDailyRoom", {
      value: false,
      sessionId: sessionId ?? null,
      userId: user?.id ?? null,
      step: "retry_initial_connect",
    });
    setLocalInDailyRoom(false);
    setPartnerEverJoined(false);
    peerMissingTruthRefreshCountRef.current = 0;
    vdbg("prejoin_state_isConnecting", {
      value: false,
      sessionId: sessionId ?? null,
      userId: user?.id ?? null,
      step: "retry_initial_connect",
    });
    setIsConnecting(false);
    vdbg("prejoin_state_joining", {
      value: false,
      sessionId: sessionId ?? null,
      userId: user?.id ?? null,
      step: "retry_initial_connect",
    });
    setJoining(false);
    hasStartedJoinRef.current = false;
    vdbg("prejoin_state_hasStartedJoinRef", {
      value: false,
      sessionId: sessionId ?? null,
      userId: user?.id ?? null,
      step: "retry_initial_connect",
    });
    vdbg("prejoin_state_joinAttemptNonce", {
      value: "increment",
      sessionId: sessionId ?? null,
      userId: user?.id ?? null,
      step: "retry_initial_connect",
    });
    setJoinAttemptNonce((n) => n + 1);
  }, [
    clearFirstConnectWatchdog,
    detachCallListeners,
    eventId,
    peerMissingTerminal,
    releaseSharedCallIfOwned,
    resetNativeRemoteRenderRecovery,
    sessionId,
    user?.id,
  ]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active" || !permissionSettingsOpenedRef.current) return;
      permissionSettingsOpenedRef.current = false;
      if (permissionRecoveryAction !== "open_settings" || !preJoinFailed)
        return;
      void handleRetryInitialConnect();
    });
    return () => sub.remove();
  }, [handleRetryInitialConnect, permissionRecoveryAction, preJoinFailed]);

  useNativeVideoDateStartCall({
    activeNativeDailyCallIdentityRef,
    activePreparedEntryCacheHitRef,
    activePreparedEntryCacheRef,
    authLoading,
    beginBootstrapTiming,
    bindCallListeners,
    boundCallRef,
    boundHandlersRef,
    callRef,
    captureProfile,
    captureProfileRef,
    claimNativeVideoDateSurface,
    cleanupTerminalDailyCall,
    clearDailyAliveHeartbeatTimer,
    clearDailyTokenRefreshTimer,
    clearFirstConnectWatchdog,
    clearPartnerAwayAfterTransportGrace,
    dailyJoinStartedAtMsRef,
    dailyPrewarmConsumedForJoinRef,
    dailyTokenExpiresAtRef,
    dailyTokenRecoveryInFlightRef,
    dailyTokenRefreshTimerRef,
    dateEntryPermissionEligible,
    detachCallListeners,
    endBootstrapTiming,
    eventId,
    firstRemoteParticipantTimedRef,
    hasStartedJoinRef,
    joinAttemptNonce,
    joining,
    lastNativeRemoteCameraSwitchHintIdRef,
    latestDateRouteEndedRef,
    latestDateRouteSessionIdRef,
    latestDateRouteUserIdRef,
    localParticipantRef,
    nativeSurfaceClientReady,
    observedNativePrejoinPipelineKeyRef,
    openNativePostDateSurveyFromTerminalTruth,
    pathname,
    phase,
    phaseRef,
    prejoinAttemptRef,
    prejoinAttemptSeqRef,
    preparedJoinRetryUsedRef,
    prewarmedAlreadyJoinedRef,
    prewarmedJoinInFlightRef,
    providerVerifySkippedRef,
    recoverFromNotStartableDateTruth,
    recoverNativeDailyTokenRef,
    refetchVideoSession,
    releaseSharedCallIfOwned,
    remoteParticipantRef,
    requestPermissions,
    requestReconnectSyncRef,
    resetNativeRemoteRenderRecovery,
    roomNameRef,
    session,
    sessionError,
    sessionId,
    sessionLoading,
    setAwaitingFirstConnect,
    setCallError,
    setCaptureProfile,
    setIsConnecting,
    setIsMuted,
    setIsPartnerDisconnected,
    setIsVideoOff,
    setJoinAttemptNonce,
    setJoining,
    setLocalInDailyRoom,
    setLocalParticipant,
    setPartnerEverJoined,
    setPreJoinFailed,
    setRemoteParticipant,
    startDailyAliveHeartbeat,
    user,
  });

  useEffect(() => {
    reconnectEndedHandledRef.current = false;
    loggedJourneyRef.current.clear();
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !user?.id || showFeedback) return;
    const isTerminalSession =
      phase === "ended" ||
      !!session?.ended_at ||
      session?.state === "ended" ||
      session?.phase === "ended";
    if (!isTerminalSession) return;
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await openNativePostDateSurveyFromTerminalTruth(
        "terminal_session_recovery",
        session,
      );
    })();
    return () => {
      cancelled = true;
    };
    // Terminal recovery intentionally follows selected session fields so survey recovery is not re-run for every session object refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sessionId,
    user?.id,
    showFeedback,
    phase,
    eventId,
    session?.event_id,
    session?.ended_at,
    session?.state,
    session?.phase,
    session?.ended_reason,
    session?.date_started_at,
    session?.participant_1_id,
    session?.participant_2_id,
    openNativePostDateSurveyFromTerminalTruth,
  ]);

  /** Partner/backend ended session (realtime): show survey when we had joined the room; tear down Daily if still up. */
  useEffect(() => {
    if (phase !== "ended" || !sessionId) return;
    clearEntryGraceState();
    void handleCallEnd("server_end");
  }, [phase, sessionId, handleCallEnd, clearEntryGraceState]);

  const completeEntryFromServerDeadline = useCallback(
    async (source: string, allowRetry = true) => {
      if (!sessionId || phaseRef.current !== "entry") return;
      if (entryCompletionInFlightRef.current) {
        vdbg("complete_entry_skip", {
          sessionId,
          source,
          reason: "in_flight",
        });
        return;
      }
      if (entryDecisionInFlightRef.current) {
        const ctaTelemetry = entryCtaLatestRef.current;
        vdbg("complete_entry_skip", {
          sessionId,
          source,
          reason: "local_decision_persistence_in_flight",
          retryScheduled: allowRetry,
          ctaTelemetry,
        });
        if (allowRetry) {
          if (entryCompletionRetryTimerRef.current) {
            clearTimeout(entryCompletionRetryTimerRef.current);
          }
          entryCompletionRetryTimerRef.current = setTimeout(() => {
            entryCompletionRetryTimerRef.current = null;
            void completeEntryFromServerDeadline(
              `${source}_after_decision_persistence`,
              false,
            );
          }, 900);
        }
        return;
      }

      // Fairness guard: if the server deadline fires before the local user has had at
      // least MIN_DECISION_WINDOW_AFTER_MEDIA_MS of usable CTA time after first playable
      // remote media, defer the call by the remaining gap. This prevents expiry on slow
      // Daily joins where media arrives close to the 60 s server deadline.
      if (allowRetry && firstPlayableRemoteAtMsRef.current > 0) {
        const mediaAge = Date.now() - firstPlayableRemoteAtMsRef.current;
        const deferMs = MIN_DECISION_WINDOW_AFTER_MEDIA_MS - mediaAge;
        if (deferMs > 0) {
          vdbg("complete_entry_deferred_for_media_window", {
            sessionId,
            source,
            deferMs,
            mediaAgeMs: mediaAge,
          });
          if (entryCompletionRetryTimerRef.current) {
            clearTimeout(entryCompletionRetryTimerRef.current);
          }
          entryCompletionRetryTimerRef.current = setTimeout(() => {
            entryCompletionRetryTimerRef.current = null;
            void completeEntryFromServerDeadline(
              `${source}_after_media_window`,
              false,
            );
          }, deferMs + 200);
          return;
        }
      }

      entryCompletionInFlightRef.current = true;
      try {
        const ctaTelemetry = entryCtaLatestRef.current;
        vdbg("complete_entry_fire", {
          sessionId,
          source,
          trigger: "server_deadline",
          ctaTelemetry,
        });
        const result = await completeEntry(sessionId);
        if (phaseRef.current !== "entry") return;

        if (!result) {
          vdbg("complete_entry_uncertain", {
            sessionId,
            source,
            reason: "null_result",
            retryScheduled: allowRetry,
          });
          await refetchVideoSession();
          if (allowRetry && phaseRef.current === "entry") {
            if (entryCompletionRetryTimerRef.current) {
              clearTimeout(entryCompletionRetryTimerRef.current);
            }
            entryCompletionRetryTimerRef.current = setTimeout(() => {
              entryCompletionRetryTimerRef.current = null;
              void completeEntryFromServerDeadline(
                `${source}_retry`,
                false,
              );
            }, 1500);
          }
          return;
        }

        if (result.state === "date") {
          clearEntryGraceState();
          setShowMutualToast(true);
          return;
        }

        if (isVideoDateEntryPhase(result.state)) {
          clearEntryGraceState();
          const positiveExtensionSeconds =
            result.extended === true &&
            typeof result.seconds_remaining === "number" &&
            Number.isFinite(result.seconds_remaining) &&
            result.seconds_remaining > 0
              ? Math.ceil(result.seconds_remaining)
              : null;
          if (positiveExtensionSeconds !== null) {
            if (entryCompletionRetryTimerRef.current) {
              clearTimeout(entryCompletionRetryTimerRef.current);
              entryCompletionRetryTimerRef.current = null;
            }
            entryCompletionDeadlineKeyRef.current = null;
            setLocalTimeLeft(positiveExtensionSeconds);
            vdbg("complete_entry_extension_applied", {
              sessionId,
              source,
              seconds_remaining: positiveExtensionSeconds,
              extension_started_at: result.extension_started_at ?? null,
              reason: result.reason ?? null,
            });
            await refetchVideoSession();
            return;
          }
          vdbg("complete_entry_uncertain", {
            sessionId,
            source,
            reason: "entry_deadline_not_terminal",
            result,
          });
          await refetchVideoSession();
          if (allowRetry && phaseRef.current === "entry") {
            if (entryCompletionRetryTimerRef.current) {
              clearTimeout(entryCompletionRetryTimerRef.current);
            }
            entryCompletionRetryTimerRef.current = setTimeout(() => {
              entryCompletionRetryTimerRef.current = null;
              void completeEntryFromServerDeadline(
                `${source}_retry`,
                false,
              );
            }, 1500);
          }
          return;
        }

        if (result.state === "ended" || result.already_ended) {
          clearEntryGraceState();
          if (result.reason === LEGACY_VIDEO_DATE_ENTRY_TIMEOUT_REASON) {
            const notice = getVideoDateWarmupChoiceNotice({
              waitingForSelf: result.waiting_for_self,
              waitingForPartner: result.waiting_for_partner,
            });
            showWarmupChoiceNotice(notice);
            vdbg("complete_entry_timeout_copy", {
              sessionId,
              source,
              notice,
              waiting_for_self: result.waiting_for_self ?? null,
              waiting_for_partner: result.waiting_for_partner ?? null,
              local_decision_persisted: result.local_decision_persisted ?? null,
              partner_decision_persisted:
                result.partner_decision_persisted ?? null,
              ctaTelemetry: entryCtaLatestRef.current,
            });
          } else if (result.reason === LEGACY_VIDEO_DATE_ENTRY_GRACE_EXPIRED_REASON) {
            showWarmupChoiceNotice(getVideoDateWarmupChoiceNotice());
          }
          const recoveredSurvey =
            await openNativePostDateSurveyFromTerminalTruth(
              result.survey_required === true
                ? "complete_entry_survey_required"
                : "complete_entry_terminal",
            );
          if (recoveredSurvey) {
            void cleanupForAbortWithoutServerEnd();
            return;
          }
          void handleCallEnd("server_end");
          return;
        }

        vdbg("complete_entry_uncertain", {
          sessionId,
          source,
          reason: "unexpected_result",
          result,
        });
        await refetchVideoSession();
      } finally {
        entryCompletionInFlightRef.current = false;
      }
    },
    [
      clearEntryGraceState,
      cleanupForAbortWithoutServerEnd,
      handleCallEnd,
      openNativePostDateSurveyFromTerminalTruth,
      refetchVideoSession,
      sessionId,
      showWarmupChoiceNotice,
    ],
  );

  useEffect(() => {
    if (
      !sessionId ||
      phase !== "entry" ||
      showFeedback ||
      session?.ended_at
    ) {
      return;
    }

    const candidateTimeline = serverTimeline;
    const timelineForEntry =
      candidateTimeline !== null &&
      candidateTimeline.sessionId === sessionId &&
      candidateTimeline.phase === "entry"
        ? candidateTimeline
        : null;
    const timelineDeadlineMs = timelineForEntry
      ? timelineForEntry.phaseDeadlineAtMs
      : null;
    const legacyDeadlineMs = entryStartedAtIso
      ? startedAtCountdownDeadlineMs({
          startedAtIso: entryStartedAtIso,
          durationSeconds: ENTRY_SECONDS,
        })
      : null;
    const deadlineMs = timelineDeadlineMs ?? legacyDeadlineMs;
    if (!deadlineMs) return;
    const deadlineKey = `${sessionId}:${deadlineMs}`;
    const localNowMs = Date.now();
    const serverNowEstimateMs =
      timelineDeadlineMs !== null && timelineForEntry
        ? localNowMs + timelineForEntry.clockSkewMs
        : localNowMs;
    const delayMs = Math.max(0, deadlineMs - serverNowEstimateMs);
    const fire = () => {
      if (entryCompletionDeadlineKeyRef.current === deadlineKey) return;
      entryCompletionDeadlineKeyRef.current = deadlineKey;
      void completeEntryFromServerDeadline("entry_server_deadline");
    };

    const timer = setTimeout(fire, delayMs);
    return () => clearTimeout(timer);
  }, [
    completeEntryFromServerDeadline,
    phase,
    session?.ended_at,
    entryStartedAtIso,
    sessionId,
    serverTimeline,
    showFeedback,
  ]);

  useEffect(() => {
    if (phase === "date") {
      clearEntryGraceState();
    }
  }, [phase, clearEntryGraceState]);

  // Authoritative visible countdown: recompute from server-owned phase timestamps every tick.
  useEffect(() => {
    if (showFeedback || phase === "ended") return;
    const candidateTimeline = serverTimeline;
    const timelineForCountdown =
      candidateTimeline !== null &&
      candidateTimeline.sessionId === sessionId &&
      candidateTimeline.phase === phase &&
      (phase === "entry" || phase === "date") &&
      candidateTimeline.phaseDeadlineAtMs !== null
        ? candidateTimeline
        : null;
    const hasAuthoritativeStart = timelineForCountdown
      ? true
      : phase === "entry"
        ? Boolean(entryStartedAtIso)
        : phase === "date"
          ? Boolean(session?.date_started_at)
          : false;
    if (!hasAuthoritativeStart) return;

    let completionFired = false;
    const tick = () => {
      const countdown = timelineForCountdown
        ? resolveVideoDateTimelineCountdown(timelineForCountdown)
        : resolveVideoDatePhaseCountdown({
            phase,
            entryStartedAtIso,
            dateStartedAtIso: session?.date_started_at,
            entryDurationSeconds: ENTRY_SECONDS,
            dateDurationSeconds: DATE_SECONDS,
            dateExtraSeconds: session?.date_extra_seconds,
          });
      const next = countdown.remainingSeconds ?? 0;
      setLocalTimeLeft(next);

      if (next > 0 || completionFired) return;
      const completionKey = `${sessionId ?? "unknown-session"}:${phase}:${countdown.deadlineMs ?? "no-deadline"}`;
      if (countdownCompletionKeyRef.current === completionKey) return;
      completionFired = true;
      countdownCompletionKeyRef.current = completionKey;

      if (phaseRef.current === "date") {
        void handleCallEnd("local_end", "date_timeout");
      } else if (phaseRef.current === "entry") {
        vdbg("entry_visible_countdown_elapsed", {
          sessionId: sessionId ?? null,
          trigger: "complete_entry",
        });
        void completeEntryFromServerDeadline(
          "entry_visible_countdown_elapsed",
        );
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [
    showFeedback,
    phase,
    sessionId,
    handleCallEnd,
    completeEntryFromServerDeadline,
    serverTimeline,
    session?.date_extra_seconds,
    session?.date_started_at,
    entryStartedAtIso,
  ]);

  const {
    toggleMute,
    toggleVideo,
    handleFlipCamera,
  } = useNativeVideoDateCameraControls({
    callRef,
    eventId,
    isFlippingCamera,
    isMuted,
    isVideoOff,
    joinAttemptNonce,
    localParticipant,
    localParticipantRef,
    nativeCameraSwitchInFlightRef,
    sessionId,
    setCanFlipCamera,
    setIsFlippingCamera,
    setIsMuted,
    setIsVideoOff,
  });

  const totalTime =
    phase === "entry"
      ? ENTRY_SECONDS
      : effectiveDateDurationSeconds(DATE_SECONDS, session?.date_extra_seconds);
  const displayTimeLeft = localTimeLeft ?? totalTime;
  const entryTimerStarted =
    phase !== "entry" || Boolean(entryStartedAtIso);
  const entryDeadlineUrgent =
    phase === "entry" && entryTimerStarted && displayTimeLeft <= 10;

  useEffect(() => {
    if (!sessionId || showFeedback || netQualityTier === "good")
      return;
    const key = `${sessionId}:${netQualityTier}`;
    if (resilienceModeTrackedKeyRef.current === key) return;
    resilienceModeTrackedKeyRef.current = key;
    trackEvent("video_date_resilience_low_quality_mode", {
      platform: "native",
      session_id: sessionId,
      event_id: eventId || null,
      network_tier: netQualityTier,
      adaptation: "ui_and_daily_capability_checked",
    });
  }, [eventId, netQualityTier, sessionId, showFeedback]);

  useEffect(() => {
    if (!sessionId || showFeedback) return;
    if (!localInDailyRoom) {
      resilienceDailyAdaptationKeyRef.current = null;
      return;
    }
    const mode = netQualityTier === "poor" ? "audio_priority" : "standard";
    if (mode === "standard" && resilienceDailyAdaptationKeyRef.current === null)
      return;
    const key = `${sessionId}:${mode}`;
    if (resilienceDailyAdaptationKeyRef.current === key) return;

    const call =
      callRef.current as unknown as DailyReceiveSettingsCapable | null;
    const payload = {
      platform: "native",
      session_id: sessionId,
      event_id: eventId || null,
      network_tier: netQualityTier,
      adaptation: mode,
    };

    if (!call || typeof call.updateReceiveSettings !== "function") {
      resilienceDailyAdaptationKeyRef.current = key;
      trackEvent("video_date_resilience_daily_adaptation", {
        ...payload,
        capability_available: false,
        outcome: "unsupported",
      });
      return;
    }

    const receiveSettings =
      mode === "audio_priority"
        ? { "*": { video: { layer: 0 } } }
        : { "*": "inherit" };
    resilienceDailyAdaptationKeyRef.current = key;
    void call
      .updateReceiveSettings(receiveSettings)
      .then(() => {
        trackEvent("video_date_resilience_daily_adaptation", {
          ...payload,
          capability_available: true,
          outcome: "applied",
        });
      })
      .catch((error) => {
        trackEvent("video_date_resilience_daily_adaptation", {
          ...payload,
          capability_available: true,
          outcome: "failed",
          reason:
            error instanceof Error ? error.message.slice(0, 120) : "unknown",
        });
      });
  }, [
    eventId,
    localInDailyRoom,
    netQualityTier,
    sessionId,
    showFeedback,
  ]);

  useEffect(() => {
    if (!sessionId || !entryTimerStarted || phase !== "entry") return;
    const key = `${sessionId}:warmup_timer_started`;
    if (warmupTimerStartedTrackedRef.current === key) return;
    warmupTimerStartedTrackedRef.current = key;
    const latencyContext = recordReadyGateToDateLatencyCheckpoint({
      sessionId,
      platform: "native",
      eventId: eventId || null,
      sourceSurface: "video_date_route",
      checkpoint: "warmup_timer_started",
    });
    trackEvent(
      LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
      buildReadyGateToDateLatencyPayload({
        context: latencyContext,
        checkpoint: "warmup_timer_started",
        sourceAction: "server_entry_started_at",
        outcome: "success",
      }),
    );
    trackEvent(LobbyPostDateEvents.VIDEO_DATE_WARMUP_TIMER_STARTED, {
      platform: "native",
      session_id: sessionId,
      event_id: eventId || null,
      source_surface: "video_date_route",
      source_action: "server_entry_started_at",
      entry_started_at: entryStartedAtIso,
    });
  }, [
    eventId,
    entryTimerStarted,
    phase,
    entryStartedAtIso,
    sessionId,
  ]);

  useEffect(() => {
    if (!entryDeadlineUrgent) {
      lastChanceBlinkOpacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(lastChanceBlinkOpacity, {
          toValue: 0.42,
          duration: 360,
          useNativeDriver: true,
        }),
        Animated.timing(lastChanceBlinkOpacity, {
          toValue: 1,
          duration: 360,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      lastChanceBlinkOpacity.setValue(1);
    };
  }, [entryDeadlineUrgent, lastChanceBlinkOpacity]);

  /** Local user is in Daily but server has no join stamp for the peer yet — distinct from reconnect / ambiguous absence. */
  const peerNotOpenedVideoDateYet = useMemo(
    () =>
      !!session &&
      !sessionLoading &&
      localInDailyRoom &&
      !hasRemotePartner &&
      !partnerEverJoined &&
      !peerMissingTerminal &&
      !isPartnerDisconnected &&
      peerServerJoinedAt == null,
    [
      session,
      sessionLoading,
      localInDailyRoom,
      hasRemotePartner,
      partnerEverJoined,
      peerMissingTerminal,
      isPartnerDisconnected,
      peerServerJoinedAt,
    ],
  );

  const postJoinStage: VideoDatePostJoinStage = useMemo(() => {
    if (sessionLoading || !sessionId) return "initial_loading";
    if (phase === "ended") return "ended";
    if (peerMissingTerminal) return "peer_missing_timeout";
    if (preJoinFailed && !localInDailyRoom) return "fatal_join_error";
    if (
      localInDailyRoom &&
      partnerEverJoined &&
      isPartnerDisconnected &&
      !hasRemotePartner
    )
      return "reconnecting";
    if (localInDailyRoom && hasRemotePartner) return "active_call";
    if (
      localInDailyRoom &&
      !hasRemotePartner &&
      !partnerEverJoined &&
      !peerMissingTerminal &&
      !isPartnerDisconnected
    )
      return "waiting_for_peer";
    if (joining || isConnecting) return "joining_daily";
    return "joining_daily";
  }, [
    sessionLoading,
    sessionId,
    phase,
    peerMissingTerminal,
    preJoinFailed,
    localInDailyRoom,
    joining,
    isConnecting,
    partnerEverJoined,
    isPartnerDisconnected,
    hasRemotePartner,
  ]);

  useEffect(() => {
    const prev = lastLoggedPostJoinStageRef.current;
    if (prev === postJoinStage) return;
    videoDateDailyDiagnostic("post_join_stage_transition", {
      session_id: sessionId ?? "",
      from: prev ?? "none",
      to: postJoinStage,
    });
    if (postJoinStage === "active_call") {
      videoDateDailyDiagnostic("active_call_entered", {
        session_id: sessionId ?? "",
        room_name: roomNameRef.current ?? null,
      });
    }
    if (postJoinStage === "reconnecting") {
      videoDateDailyDiagnostic("reconnecting_entered", {
        session_id: sessionId ?? "",
      });
      if (dailyReconnectPerformanceStartedAtRef.current === null) {
        dailyReconnectPerformanceStartedAtRef.current = Date.now();
        dailyReconnectPerformanceSourceRef.current =
          "post_join_stage_reconnecting";
        trackDailyPerformanceCheckpoint({
          checkpoint: "daily_reconnect_started",
          sourceAction: "daily_reconnect_started",
          outcome: "success",
          extra: {
            daily_performance_segment: "daily_reconnect",
            reconnect_source: "post_join_stage_reconnecting",
          },
        });
      }
    }
    if (prev === "reconnecting" && postJoinStage === "active_call") {
      videoDateDailyDiagnostic("reconnecting_exited", {
        session_id: sessionId ?? "",
      });
      const startedAt = dailyReconnectPerformanceStartedAtRef.current;
      if (startedAt !== null) {
        const durationMs = Math.max(0, Date.now() - startedAt);
        const reconnectSource =
          dailyReconnectPerformanceSourceRef.current ??
          "post_join_stage_reconnecting";
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
      }
    }
    if (
      prev === "reconnecting" &&
      (postJoinStage === "peer_missing_timeout" ||
        postJoinStage === "fatal_join_error" ||
        postJoinStage === "ended")
    ) {
      const startedAt = dailyReconnectPerformanceStartedAtRef.current;
      if (startedAt !== null) {
        const durationMs = Math.max(0, Date.now() - startedAt);
        const reconnectSource =
          dailyReconnectPerformanceSourceRef.current ??
          "post_join_stage_reconnecting";
        dailyReconnectPerformanceStartedAtRef.current = null;
        dailyReconnectPerformanceSourceRef.current = null;
        trackDailyPerformanceCheckpoint({
          checkpoint: "daily_reconnect_failure",
          sourceAction: "daily_reconnect_failure",
          outcome: "failure",
          reasonCode: postJoinStage,
          durationMs,
          extra: {
            daily_performance_segment: "daily_reconnect",
            daily_reconnect_ms: durationMs,
            reconnect_source: reconnectSource,
          },
        });
      }
    }
    lastLoggedPostJoinStageRef.current = postJoinStage;
  }, [postJoinStage, sessionId, trackDailyPerformanceCheckpoint]);

  const showOpeningRoomTopPill =
    !showFeedback && (joining || isConnecting) && !localInDailyRoom;
  const showTopBarWaitingPill =
    showOpeningRoomTopPill ||
    (!showFeedback &&
      localInDailyRoom &&
      !hasRemotePartner &&
      !partnerEverJoined &&
      !peerMissingTerminal &&
      !isPartnerDisconnected);
  const showJoiningOverlay =
    (joining || isConnecting) &&
    !localInDailyRoom &&
    !showFeedback &&
    !preJoinFailed &&
    !peerMissingTerminal;
  const showPeerWaitOverlay =
    !showFeedback &&
    localInDailyRoom &&
    !hasRemotePartner &&
    !partnerEverJoined &&
    !peerMissingTerminal &&
    !isPartnerDisconnected;

  const hasEntryPeerEvidence =
    hasRemotePartner || (peerServerJoinedAt != null && !isPartnerDisconnected);

  // Show the Vibe/Pass CTA during the hard-deadline entry, using server
  // join evidence as a fallback when Daily participant/track state jitters.
  const showEntryChrome =
    !showFeedback &&
    phase === "entry" &&
    entryTimerStarted &&
    hasEntryPeerEvidence &&
    !peerMissingTerminal;
  const showDatePhaseChrome =
    !showFeedback && phase === "date" && hasRemotePartner;
  const suppressPartnerControlsAfterSafety =
    safetySubmitOutcome?.alsoBlock === true ||
    safetySubmitOutcome?.ended === true;
  const canOpenInCallSafety = Boolean(
    partnerId &&
    sessionId &&
    !showFeedback &&
    phase !== "ended" &&
    !suppressPartnerControlsAfterSafety,
  );
  const entryUiState = useMemo(
    () => resolveVideoDateEntryUiState(session, user?.id),
    [session, user?.id],
  );
  const localEntryDecision = entryUiState.localDecision;
  const localEntryHasDecided = entryUiState.localHasDecided;
  const partnerEntryHasDecided = entryUiState.partnerHasDecided;

  useEffect(() => {
    const key = `${sessionId ?? "none"}:${entryStartedAtIso ?? "no-start"}`;
    if (
      !showEntryChrome ||
      !entryDeadlineUrgent ||
      localEntryDecision !== null ||
      entryFinalTenNudgeKeyRef.current === key
    ) {
      return;
    }

    entryFinalTenNudgeKeyRef.current = key;
    vdbg("entry_final_10s_nudge", {
      sessionId: sessionId ?? null,
      remainingSeconds: displayTimeLeft,
    });
    AccessibilityInfo.announceForAccessibility(
      "Choose Vibe or Pass before warm up ends.",
    );
    void Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Warning,
    ).catch(() => {
      /* Haptics must never affect the call path. */
    });
  }, [
    displayTimeLeft,
    entryDeadlineUrgent,
    localEntryDecision,
    entryStartedAtIso,
    sessionId,
    showEntryChrome,
  ]);

  const remoteVideoTrack = remoteParticipant
    ? getTrack(remoteParticipant, "video")
    : null;
  const remoteAudioTrack = remoteParticipant
    ? getTrack(remoteParticipant, "audio")
    : null;
  const remoteMediaViewKey = `${nativeRemoteRenderTrackKey(remoteParticipant ?? undefined) ?? "no-remote"}:${remoteMediaRenderNonce}`;
  const localVideoTrack = localParticipant
    ? getTrack(localParticipant, "video")
    : null;

  useEffect(() => {
    const now = Date.now();
    const localDecisionLabel: EntryCtaTelemetrySnapshot["local_decision"] =
      localEntryDecision === true
        ? "vibe"
        : localEntryDecision === false
          ? "pass"
          : "none";
    const current = entryCtaImpressionRef.current;
    const firstPlayableRemoteSeen = firstPlayableRemoteAtMsRef.current > 0;
    const ctaVisibleMs = current
      ? Math.max(0, now - current.shownAtMs)
      : entryCtaLastVisibleMsRef.current;
    entryCtaLatestRef.current = {
      cta_visible: showEntryChrome,
      cta_visible_ms: ctaVisibleMs,
      cta_last_time_left: current?.lastTimeLeft ?? displayTimeLeft ?? null,
      has_remote_partner: hasRemotePartner,
      peer_server_joined: peerServerJoinedAt != null,
      partner_ever_joined: partnerEverJoined,
      is_partner_disconnected: isPartnerDisconnected,
      peer_missing_terminal: peerMissingTerminal,
      remote_video_mounted: Boolean(remoteVideoTrack),
      remote_audio_mounted: Boolean(remoteAudioTrack),
      first_playable_remote_seen: firstPlayableRemoteSeen,
      first_playable_remote_age_ms: firstPlayableRemoteSeen
        ? Math.max(0, now - firstPlayableRemoteAtMsRef.current)
        : null,
      local_decision: localDecisionLabel,
    };

    const key = `${sessionId ?? "none"}:${entryStartedAtIso ?? "no-start"}`;
    const logHidden = (
      reason: string,
      impression: {
        key: string;
        shownAtMs: number;
        lastTimeLeft: number | null;
      },
    ) => {
      const visibleMs = Math.max(0, now - impression.shownAtMs);
      entryCtaLastVisibleMsRef.current = visibleMs;
      vdbg("entry_cta_hidden", {
        sessionId: sessionId ?? null,
        reason,
        visibleMs,
        lastTimeLeft: impression.lastTimeLeft,
        hasRemotePartner,
        peerServerJoined: peerServerJoinedAt != null,
        partnerEverJoined,
        isPartnerDisconnected,
        peerMissingTerminal,
        remoteVideoMounted: Boolean(remoteVideoTrack),
        remoteAudioMounted: Boolean(remoteAudioTrack),
        localDecision: localDecisionLabel,
      });
      trackEvent("video_date_entry_cta_hidden", {
        platform: "native",
        session_id: sessionId ?? null,
        event_id: eventId || null,
        reason,
        visible_ms: visibleMs,
        last_time_left: impression.lastTimeLeft,
        has_remote_partner: hasRemotePartner,
        peer_server_joined: peerServerJoinedAt != null,
        remote_video_mounted: Boolean(remoteVideoTrack),
        remote_audio_mounted: Boolean(remoteAudioTrack),
        local_decision: localDecisionLabel,
      });
    };

    if (showEntryChrome && sessionId) {
      if (!current || current.key !== key) {
        if (current) logHidden("replaced_by_new_entry_key", current);
        entryCtaImpressionRef.current = {
          key,
          shownAtMs: now,
          lastTimeLeft: displayTimeLeft ?? null,
        };
        entryCtaLastVisibleMsRef.current = 0;
        vdbg("entry_cta_visible", {
          sessionId,
          remainingSeconds: displayTimeLeft,
          hasRemotePartner,
          peerServerJoined: peerServerJoinedAt != null,
          partnerEverJoined,
          remoteVideoMounted: Boolean(remoteVideoTrack),
          remoteAudioMounted: Boolean(remoteAudioTrack),
          firstPlayableRemoteSeen,
          localDecision: localDecisionLabel,
        });
        trackEvent("video_date_entry_cta_visible", {
          platform: "native",
          session_id: sessionId,
          event_id: eventId || null,
          remaining_seconds: displayTimeLeft,
          has_remote_partner: hasRemotePartner,
          peer_server_joined: peerServerJoinedAt != null,
          remote_video_mounted: Boolean(remoteVideoTrack),
          remote_audio_mounted: Boolean(remoteAudioTrack),
          first_playable_remote_seen: firstPlayableRemoteSeen,
          local_decision: localDecisionLabel,
        });
      } else {
        current.lastTimeLeft = displayTimeLeft ?? current.lastTimeLeft;
      }
      return;
    }

    if (current) {
      logHidden(
        showFeedback
          ? "feedback_opened"
          : phase !== "entry"
            ? `phase_${phase}`
            : "cta_condition_false",
        current,
      );
      entryCtaImpressionRef.current = null;
    }
  }, [
    displayTimeLeft,
    eventId,
    hasRemotePartner,
    isPartnerDisconnected,
    localEntryDecision,
    partnerEverJoined,
    peerMissingTerminal,
    peerServerJoinedAt,
    phase,
    remoteAudioTrack,
    remoteVideoTrack,
    entryStartedAtIso,
    sessionId,
    showFeedback,
    showEntryChrome,
  ]);

  const effectiveIceBreakerClockMs = useMemo(() => {
    if (!iceBreakerManualPause) return iceBreakerClockMs;
    const pauseMs = Math.max(
      0,
      iceBreakerManualPause.untilMs - iceBreakerManualPause.startedAtMs,
    );
    if (iceBreakerClockMs < iceBreakerManualPause.untilMs)
      return iceBreakerManualPause.startedAtMs;
    return iceBreakerClockMs - pauseMs;
  }, [iceBreakerClockMs, iceBreakerManualPause]);

  const currentQuestionIndex = resolveVideoDateIceBreakerIndex(
    vibeQuestionState.questions.length,
    vibeQuestionState.questionIndex,
    vibeQuestionState.questionAnchorAt,
    effectiveIceBreakerClockMs,
  );
  const currentQuestion =
    vibeQuestionState.questions[currentQuestionIndex] ??
    vibeQuestionState.questions[0] ??
    "";
  const handleControlsLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.ceil(event.nativeEvent.layout.height);
    if (nextHeight <= 0) return;
    setControlsStackHeight((previous) =>
      Math.abs(previous - nextHeight) > 1 ? nextHeight : previous,
    );
  }, []);
  const measuredControlsStackHeight = Math.max(
    DATE_CONTROLS_STACK_HEIGHT,
    controlsStackHeight,
  );
  const entryBottomOffset =
    insets.bottom +
    measuredControlsStackHeight +
    FLOATING_CHROME_GAP -
    ENTRY_CTA_DOCK_TIGHTEN_OFFSET;
  const advanceIceBreaker = useCallback(() => {
    if (!sessionId || !vibeQuestionState.questions.length) return;
    const pauseStartedAtMs = Date.now();
    setIceBreakerManualPause({
      startedAtMs: pauseStartedAtMs,
      untilMs: pauseStartedAtMs + VIDEO_DATE_ICE_BREAKER_MANUAL_PAUSE_MS,
    });
    const optimisticIndex = normalizeVideoDateIceBreakerIndex(
      currentQuestionIndex + 1,
      vibeQuestionState.questions.length,
    );
    setVibeQuestionState((prev) => ({
      ...prev,
      questionIndex: optimisticIndex,
      questionAnchorAt: new Date().toISOString(),
    }));
    void advanceVibeQuestion(sessionId).then((next) => {
      if (next) setVibeQuestionState(next);
    });
  }, [currentQuestionIndex, sessionId, vibeQuestionState.questions.length]);
  const dismissIceBreakerTemporarily = useCallback(() => {
    setShowIceBreaker(false);
  }, []);
  const showFloatingIceBreaker = shouldShowVideoDateIceBreaker({
    baseVisible:
      showIceBreaker &&
      Boolean(currentQuestion) &&
      !showFeedback &&
      !showMutualToast &&
      hasRemotePartner &&
      !isPartnerDisconnected &&
      !peerMissingTerminal &&
      nativeBackgroundStatus === "none" &&
      !showJoiningOverlay &&
      !showPeerWaitOverlay &&
      (phase === "entry" || phase === "date"),
    phase,
    localHasDecided: localEntryHasDecided,
  });
  const showCollapsedIceBreaker = shouldShowVideoDateIceBreaker({
    baseVisible:
      !showIceBreaker &&
      Boolean(currentQuestion) &&
      !showFeedback &&
      !showMutualToast &&
      hasRemotePartner &&
      !isPartnerDisconnected &&
      !peerMissingTerminal &&
      nativeBackgroundStatus === "none" &&
      !showJoiningOverlay &&
      !showPeerWaitOverlay &&
      (phase === "entry" || phase === "date"),
    phase,
    localHasDecided: localEntryHasDecided,
  });
  const iceBreakerBottomOffset = showEntryChrome
    ? entryBottomOffset + ENTRY_CTA_STACK_HEIGHT + FLOATING_CHROME_GAP
    : Math.max(
        insets.bottom + measuredControlsStackHeight + FLOATING_CHROME_GAP,
        DATE_PHASE_ICE_BREAKER_MIN_BOTTOM,
      );

  useEffect(() => {
    topChromeAnim.setValue(0.92);
    controlsAnim.setValue(0.94);
    Animated.parallel([
      Animated.timing(topChromeAnim, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(controlsAnim, {
        toValue: 1,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [phase, postJoinStage, topChromeAnim, controlsAnim]);

  const handlePeerMissingKeepWaiting = useCallback(() => {
    if (sessionId) {
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_PEER_MISSING_KEEP_WAITING_TAP, {
        platform: "native",
        session_id: sessionId,
        event_id: eventId,
      });
    }
    setPeerMissingTerminal(false);
    vdbg("prejoin_state_callError", {
      value: null,
      sessionId: sessionId ?? null,
      userId: user?.id ?? null,
      step: "peer_missing_keep_waiting",
    });
    setCallError(null);
    vdbg("prejoin_state_awaitingFirstConnect", {
      value: true,
      sessionId: sessionId ?? null,
      userId: user?.id ?? null,
      step: "peer_missing_keep_waiting",
    });
    setAwaitingFirstConnect(true);
    videoDateDailyDiagnostic("peer_missing_keep_waiting", {
      session_id: sessionId ?? "",
    });
  }, [eventId, sessionId, user?.id]);

  useEffect(() => {
    peerMissingTerminalImpressionRef.current = false;
  }, [sessionId]);

  useEffect(() => {
    if (!peerMissingTerminal || !sessionId) return;
    if (peerMissingTerminalImpressionRef.current) return;
    peerMissingTerminalImpressionRef.current = true;
    trackEvent(
      LobbyPostDateEvents.VIDEO_DATE_PEER_MISSING_TERMINAL_IMPRESSION,
      {
        platform: "native",
        session_id: sessionId,
        event_id: eventId,
      },
    );
  }, [eventId, peerMissingTerminal, sessionId]);

  const handleSurveySubmit = useCallback(
    (liked: boolean) =>
      submitVerdictAndCheckMutual(sessionId!, user!.id, partnerId, liked),
    [sessionId, user, partnerId],
  );

  const handleSurveyMutualMatch = useCallback(() => {
    if (eventId) {
      const target = eventLobbyHref(eventId);
      vdbgRedirect(target, "survey_mutual_match", {
        sessionId: sessionId ?? null,
        eventId,
      });
      router.replace(target);
    } else {
      const target = "/(tabs)/matches";
      vdbgRedirect(target, "survey_mutual_match", {
        sessionId: sessionId ?? null,
      });
      router.replace(target);
    }
  }, [eventId, sessionId]);

  /** "Start Chatting" from celebration — chat route is keyed by partner profile id. */
  const handleSurveyStartChatting = useCallback(
    (otherProfileId?: string) => {
      if (otherProfileId) {
        const target = `/chat/${otherProfileId}` as const;
        vdbgRedirect(target, "survey_start_chatting", {
          sessionId: sessionId ?? null,
          otherProfileId,
        });
        router.replace(target);
      } else {
        handleSurveyMutualMatch();
      }
    },
    [handleSurveyMutualMatch, sessionId],
  );

  const handleSurveyDone = useCallback(() => {
    if (eventId && user?.id) updateParticipantStatus(eventId, "browsing");
    if (eventId) {
      const target = eventLobbyHrefPostSurveyComplete(eventId);
      vdbgRedirect(target, "survey_done", {
        sessionId: sessionId ?? null,
        eventId,
      });
      router.replace(target);
    } else {
      const target = "/(tabs)/events";
      vdbgRedirect(target, "survey_done", { sessionId: sessionId ?? null });
      router.replace(target);
    }
  }, [eventId, sessionId, user?.id]);

  const surveyPartnerId =
    partnerId ||
    (session && user?.id
      ? user.id === session.participant_1_id
        ? session.participant_2_id
        : session.participant_1_id
      : "");
  const surveyEventId = eventId || session?.event_id || undefined;
  const profileSheetPartner = useMemo<PartnerProfileData | null>(() => {
    if (fullPartner) return fullPartner;
    if (!basicPartner) return null;
    return {
      name: basicPartner.name || "Your date",
      age: basicPartner.age ?? 0,
      avatarUrl: basicPartner.avatar_url ?? null,
      photos: basicPartner.avatar_url ? [basicPartner.avatar_url] : [],
      about_me: null,
      job: null,
      location: null,
      heightCm: null,
      tags: [],
      prompts: [],
    };
  }, [basicPartner, fullPartner]);
  const profileSheetPartnerId = partnerId || basicPartner?.id || "";

  if (showFeedback && sessionId && user?.id) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <PostDateSurvey
          sessionId={sessionId}
          userId={user.id}
          partnerId={surveyPartnerId}
          partnerName={fullPartner?.name ?? basicPartner?.name ?? "Your date"}
          partnerImage={
            fullPartner?.avatarUrl ?? fullPartner?.photos?.[0] ?? null
          }
          eventId={surveyEventId}
          onSubmitVerdict={handleSurveySubmit}
          onMutualMatch={handleSurveyMutualMatch}
          onStartChatting={handleSurveyStartChatting}
          onDone={handleSurveyDone}
        />
        {warmupChoiceNotice ? (
          <WarmupChoiceNoticeBanner
            notice={warmupChoiceNotice}
            theme={theme}
            top={insets.top + 12}
          />
        ) : null}
      </View>
    );
  }

  if (sessionLoading || !sessionId) {
    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: "#050507",
            justifyContent: "center",
            alignItems: "center",
            padding: spacing.lg,
          },
        ]}
      >
        <View
          style={{
            position: "absolute",
            top: insets.top + 20,
            left: 20,
            right: 20,
            flexDirection: "row",
            justifyContent: "space-between",
          }}
        >
          <Text
            style={{
              color: "rgba(255,255,255,0.62)",
              fontSize: 12,
              fontWeight: "600",
            }}
          >
            Vibely Video Date
          </Text>
          <Text style={{ color: "rgba(255,255,255,0.52)", fontSize: 12 }}>
            Opening room
          </Text>
        </View>
        <View
          style={{
            width: 104,
            height: 104,
            borderRadius: 52,
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.12)",
            backgroundColor: "rgba(255,255,255,0.04)",
            justifyContent: "center",
            alignItems: "center",
            marginBottom: 18,
          }}
        >
          <ActivityIndicator size="large" color={theme.tint} />
        </View>
        <Text style={[styles.message, { color: "#fff", fontWeight: "700" }]}>
          Opening your date
        </Text>
        <Text
          style={{
            color: "rgba(255,255,255,0.56)",
            marginTop: 6,
            textAlign: "center",
          }}
        >
          Preparing camera, room, and timing together.
        </Text>
        <View
          style={{
            position: "absolute",
            left: 20,
            right: 20,
            bottom: insets.bottom + 28,
            height: 92,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.10)",
            backgroundColor: "rgba(255,255,255,0.035)",
          }}
        />
      </View>
    );
  }

  if (sessionError) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <Text style={[styles.error, { color: theme.danger }]}>
          {sessionError}
        </Text>
        <Pressable
          style={[styles.button, { backgroundColor: theme.tint }]}
          onPress={() => {
            vdbgRedirect("back", "session_error_back_button", {
              sessionId: sessionId ?? null,
              error: sessionError,
            });
            router.back();
          }}
        >
          <Text style={styles.buttonText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  if (phase === "ended" && !isConnecting && !localInDailyRoom) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <Text style={[styles.message, { color: theme.text }]}>Date ended</Text>
        <Pressable
          style={[styles.button, { backgroundColor: theme.tint }]}
          onPress={() => {
            if (eventId) {
              const target = eventLobbyHref(eventId);
              vdbgRedirect(target, "ended_continue", {
                sessionId: sessionId ?? null,
                eventId,
              });
              router.replace(target);
            } else {
              const target = "/(tabs)/events";
              vdbgRedirect(target, "ended_continue", {
                sessionId: sessionId ?? null,
              });
              router.replace(target);
            }
          }}
        >
          <Text style={styles.buttonText}>Continue</Text>
        </Pressable>
      </View>
    );
  }

  const partnerName = fullPartner?.name ?? basicPartner?.name ?? "Your date";
  const partnerFirstName = partnerName.trim().split(/\s+/)[0] || partnerName;
  const partnerAge = fullPartner?.age ?? basicPartner?.age ?? 0;
  const partnerAvatarUri =
    fullPartner?.avatarUrl ??
    fullPartner?.photos?.[0] ??
    basicPartner?.avatar_url ??
    null;
  const partnerInitial = partnerFirstName.slice(0, 1).toUpperCase() || "V";

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <LiveSurfaceOfflineStrip />
      {surfaceClaimBlocked && !showFeedback ? (
        <View style={styles.initialTimeoutWrap}>
          <View
            style={[
              styles.initialTimeoutCard,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          >
            <Text style={[styles.initialTimeoutTitle, { color: theme.text }]}>
              You are already in this call on another device
            </Text>
            <Text
              style={[
                styles.initialTimeoutSub,
                { color: theme.mutedForeground },
              ]}
            >
              Switch here only if you want this device to take over the live
              call.
            </Text>
            <View style={styles.initialTimeoutActions}>
              <Pressable
                onPress={() => void handleSwitchDeviceHere()}
                disabled={surfaceClaimTakeoverBusy}
                style={({ pressed }) => [
                  styles.initialRetryBtn,
                  { backgroundColor: theme.tint },
                  pressed && styles.initialBtnPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Switch here"
              >
                <Text style={styles.initialRetryText}>
                  {surfaceClaimTakeoverBusy ? "Switching..." : "Switch here"}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void handleLeaveBlockedSurface()}
                style={({ pressed }) => [
                  styles.initialBackBtn,
                  { borderColor: theme.border },
                  pressed && styles.initialBtnPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Back to lobby"
              >
                <Text style={[styles.initialBackText, { color: theme.text }]}>
                  Back to lobby
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
      <View style={styles.remoteContainer}>
        {remoteParticipant ? (
          <>
            {(remoteVideoTrack || remoteAudioTrack) && (
              // Remote date video must preserve the full encoded camera frame.
              // DailyMediaView defaults to cover, so keep this explicit.
              <DailyMediaView
                key={remoteMediaViewKey}
                videoTrack={remoteVideoTrack}
                audioTrack={remoteAudioTrack}
                mirror={false}
                objectFit="contain"
                zOrder={0}
                style={StyleSheet.absoluteFill}
              />
            )}
            {!remoteVideoTrack && (
              <View
                style={[
                  StyleSheet.absoluteFill,
                  styles.placeholderRemote,
                  { backgroundColor: theme.muted },
                ]}
              >
                <Text
                  style={[
                    styles.placeholderText,
                    { color: theme.mutedForeground },
                  ]}
                >
                  {partnerName} — camera off
                </Text>
              </View>
            )}
            {phase === "entry" && blurIntensity > 0 && (
              <BlurView
                intensity={blurIntensity}
                style={StyleSheet.absoluteFill}
                tint="dark"
              />
            )}
          </>
        ) : (
          <View
            style={[
              StyleSheet.absoluteFill,
              styles.placeholderRemote,
              { backgroundColor: theme.muted },
            ]}
          >
            <Text
              style={[styles.placeholderText, { color: theme.mutedForeground }]}
            >
              {showPeerWaitOverlay || showJoiningOverlay
                ? "…"
                : peerMissingTerminal
                  ? "—"
                  : peerNotOpenedVideoDateYet
                    ? `${partnerName} hasn't joined this screen yet`
                    : `${partnerName} will appear here`}
            </Text>
          </View>
        )}
      </View>
      <View pointerEvents="none" style={styles.remoteGlassWash} />

      <View
        style={[
          styles.localPip,
          { borderColor: theme.tint, top: insets.top + 86 },
        ]}
      >
        {localParticipant && localVideoTrack ? (
          <>
            {/* Self-view PIP intentionally crops to a stable portrait tile; remote date video must contain. */}
            <DailyMediaView
              videoTrack={localVideoTrack}
              audioTrack={null}
              mirror={true}
              objectFit="cover"
              zOrder={1}
              style={styles.localVideo}
            />
          </>
        ) : (
          <View
            style={[
              styles.localVideo,
              styles.placeholderLocal,
              { backgroundColor: theme.surface },
            ]}
          >
            <Ionicons
              name={localParticipant ? "videocam-off" : "person-outline"}
              size={28}
              color={theme.mutedForeground}
            />
          </View>
        )}
        {isMuted && (
          <View style={[styles.muteBadge, { backgroundColor: theme.danger }]}>
            <Ionicons name="mic-off" size={12} color="#fff" />
          </View>
        )}
        {canFlipCamera && !isVideoOff && localVideoTrack ? (
          <Pressable
            onPress={() => void handleFlipCamera()}
            disabled={isFlippingCamera}
            hitSlop={8}
            style={({ pressed }) => [
              styles.flipCameraBadge,
              {
                backgroundColor: "rgba(0,0,0,0.48)",
                borderColor: theme.glassBorder,
                opacity: pressed || isFlippingCamera ? 0.72 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Switch camera"
          >
            <Ionicons name="camera-reverse" size={16} color="#fff" />
          </Pressable>
        ) : null}
        <View pointerEvents="none" style={styles.localPipHandle} />
      </View>

      {showJoiningOverlay && (
        <ConnectionOverlay
          mode="joining"
          onLeave={handleAbortConnection}
          isLeaving={isAbortingConnection}
          partnerName={partnerFirstName}
          partnerAvatarUri={partnerAvatarUri}
        />
      )}
      {showPeerWaitOverlay && (
        <ConnectionOverlay
          mode="waiting_peer"
          onLeave={handleAbortConnection}
          isLeaving={isAbortingConnection}
          waitingPeerTitle={
            peerNotOpenedVideoDateYet
              ? "They haven't opened the date yet"
              : undefined
          }
          waitingPeerSubtitle={
            peerNotOpenedVideoDateYet
              ? "Hang tight — your timer starts once they open this date on their phone."
              : undefined
          }
        />
      )}

      {!showFeedback && preJoinFailed && !localInDailyRoom && (
        <View style={styles.initialTimeoutWrap}>
          <View
            style={[
              styles.initialTimeoutCard,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          >
            <Text style={[styles.initialTimeoutTitle, { color: theme.text }]}>
              Could not start your date
            </Text>
            <Text
              style={[
                styles.initialTimeoutSub,
                { color: theme.mutedForeground },
              ]}
            >
              {callError ?? "Please retry, or head back to the lobby."}
            </Text>
            <View style={styles.initialTimeoutActions}>
              <Pressable
                onPress={() => {
                  if (permissionRecoveryAction === "open_settings") {
                    permissionSettingsOpenedRef.current = true;
                    void openPermissionSettings(
                      "video_date_initial_connect",
                    ).then((opened) => {
                      if (!opened) {
                        permissionSettingsOpenedRef.current = false;
                        void handleRetryInitialConnect();
                      }
                    });
                    return;
                  }
                  void handleRetryInitialConnect();
                }}
                style={({ pressed }) => [
                  styles.initialRetryBtn,
                  { backgroundColor: theme.tint },
                  pressed && styles.initialBtnPressed,
                ]}
              >
                <Text style={styles.initialRetryText}>
                  {permissionRecoveryAction === "open_settings"
                    ? "Open Settings"
                    : "Retry"}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void handleAbortConnection()}
                disabled={isAbortingConnection}
                style={({ pressed }) => [
                  styles.initialBackBtn,
                  { borderColor: theme.border },
                  pressed && styles.initialBtnPressed,
                ]}
              >
                <Text style={[styles.initialBackText, { color: theme.text }]}>
                  {isAbortingConnection ? "Leaving..." : "Back to lobby"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {!showFeedback && peerMissingTerminal && (
        <View style={styles.initialTimeoutWrap}>
          <View
            style={[
              styles.initialTimeoutCard,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          >
            <Text style={[styles.initialTimeoutTitle, { color: theme.text }]}>
              They may need a little more time.
            </Text>
            <Text
              style={[
                styles.initialTimeoutSub,
                { color: theme.mutedForeground },
              ]}
            >
              You can try reconnecting, keep waiting a little longer, or head
              back to the lobby.
            </Text>
            <View style={styles.initialTimeoutActions}>
              <Pressable
                onPress={() => void handleRetryInitialConnect()}
                style={({ pressed }) => [
                  styles.initialRetryBtn,
                  { backgroundColor: theme.tint },
                  pressed && styles.initialBtnPressed,
                ]}
              >
                <Text style={styles.initialRetryText}>Try reconnecting</Text>
              </Pressable>
              <Pressable
                onPress={() => void handlePeerMissingKeepWaiting()}
                style={({ pressed }) => [
                  styles.initialBackBtn,
                  { borderColor: theme.border },
                  pressed && styles.initialBtnPressed,
                ]}
              >
                <Text style={[styles.initialBackText, { color: theme.text }]}>
                  Keep waiting
                </Text>
              </Pressable>
              <Pressable
                onPress={() =>
                  void handleAbortConnection({ source: "peer_missing" })
                }
                disabled={isAbortingConnection}
                style={({ pressed }) => [
                  styles.initialBackBtn,
                  { borderColor: theme.border },
                  pressed && styles.initialBtnPressed,
                ]}
              >
                <Text style={[styles.initialBackText, { color: theme.text }]}>
                  {isAbortingConnection ? "Leaving..." : "Back to lobby"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {isPartnerDisconnected && partnerEverJoined && (
        <ReconnectionOverlay
          isVisible
          partnerName={partnerName}
          graceTimeLeft={reconnectionGrace}
          mode="partner_away"
          networkTier={netQualityTier}
          backdropImageUrl={partnerAvatarUri}
        />
      )}

      {nativeBackgroundStatus !== "none" && (
        <View
          style={[
            styles.nativeBackgroundBanner,
            {
              backgroundColor:
                nativeBackgroundStatus === "recovered"
                  ? theme.tintSoft
                  : theme.glassSurface,
              borderColor:
                nativeBackgroundStatus === "recovered"
                  ? theme.tint
                  : theme.glassBorder,
            },
          ]}
          accessibilityLiveRegion="polite"
        >
          <Text style={[styles.nativeBackgroundTitle, { color: theme.text }]}>
            {nativeBackgroundStatus === "recovered"
              ? "Reconnected"
              : "Pausing your date"}
          </Text>
          <Text
            style={[
              styles.nativeBackgroundText,
              { color: theme.mutedForeground },
            ]}
          >
            {nativeBackgroundStatus === "recovered"
              ? "You are back in the room."
              : `We paused your call while Vibely is backgrounded. Return within ${nativeBackgroundGraceSeconds}s to reconnect.`}
          </Text>
        </View>
      )}

      {showMutualToast && (
        <MutualVibeToast onComplete={handleMutualToastComplete} />
      )}

      <Animated.View
        style={[
          styles.topBar,
          {
            top: insets.top + 12,
            opacity: topChromeAnim,
            transform: [
              {
                translateY: topChromeAnim.interpolate({
                  inputRange: [0.92, 1],
                  outputRange: [-8, 0],
                }),
              },
            ],
          },
        ]}
      >
        {showTopBarWaitingPill ? (
          <View style={styles.topBarFullWidth}>
            <View style={styles.waitingTimerPill}>
              <Text style={[styles.waitingTimerText, { color: theme.text }]}>
                {showOpeningRoomTopPill
                  ? "Opening the room..."
                  : peerNotOpenedVideoDateYet
                    ? "They're stepping into the room"
                    : "Holding the room softly..."}
              </Text>
            </View>
          </View>
        ) : hasRemotePartner ? (
          <View style={styles.topChromeRow}>
            <Pressable
              onPress={() => setShowProfileSheet(true)}
              disabled={!partnerId}
              style={({ pressed }) => [
                styles.partnerChip,
                {
                  backgroundColor: theme.glassSurface,
                  borderColor: theme.glassBorder,
                  opacity: pressed ? 0.88 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`View ${partnerName}'s profile`}
            >
              <View style={[styles.partnerAvatar, { borderColor: theme.tint }]}>
                {partnerAvatarUri ? (
                  <Image
                    source={{ uri: partnerAvatarUri }}
                    style={styles.partnerAvatarImage}
                    resizeMode="cover"
                  />
                ) : (
                  <Text
                    style={[styles.partnerAvatarInitial, { color: theme.text }]}
                  >
                    {partnerInitial}
                  </Text>
                )}
              </View>
              <View style={styles.partnerChipCopy}>
                <Text
                  style={[styles.partnerChipName, { color: theme.text }]}
                  numberOfLines={1}
                >
                  {partnerFirstName}
                  {partnerAge > 0 ? (
                    <Text
                      style={[
                        styles.partnerChipAge,
                        { color: theme.mutedForeground },
                      ]}
                    >
                      {" "}
                      {partnerAge}
                    </Text>
                  ) : null}
                </Text>
                <View style={styles.partnerStatusRow}>
                  <View
                    style={[styles.liveDot, { backgroundColor: theme.success }]}
                  />
                  <Text
                    style={[styles.partnerStatusText, { color: theme.success }]}
                  >
                    {phase === "entry"
                      ? entryTimerStarted
                        ? "Warm up"
                        : "Settling in"
                      : "Live"}
                  </Text>
                </View>
              </View>
            </Pressable>

            <View style={styles.timerCluster}>
              {netQualityTier !== "good" ? (
                <Text
                  style={[
                    styles.netHint,
                    {
                      color:
                        netQualityTier === "poor" ? theme.danger : "#f59e0b",
                    },
                  ]}
                  numberOfLines={1}
                >
                  {netQualityTier === "poor"
                    ? "Connection is fragile"
                    : "Connection is settling"}
                </Text>
              ) : null}
              <View style={styles.stageTimerRow}>
                <View
                  style={[
                    styles.stagePill,
                    {
                      borderColor: theme.glassBorder,
                      backgroundColor: theme.tintSoft,
                    },
                  ]}
                >
                  <Animated.Text
                    style={[
                      styles.stagePillText,
                      {
                        color: entryDeadlineUrgent
                          ? theme.neonPink
                          : theme.tint,
                        opacity: entryDeadlineUrgent
                          ? lastChanceBlinkOpacity
                          : 1,
                      },
                    ]}
                  >
                    {phase === "entry"
                      ? entryTimerStarted
                        ? "Warm up"
                        : "Settling in"
                      : "Live"}
                  </Animated.Text>
                </View>
                {entryTimerStarted ? (
                  <EntryPhaseTimer
                    timeLeft={Math.max(0, displayTimeLeft)}
                    totalTime={totalTime}
                    phase={phase}
                  />
                ) : null}
              </View>
            </View>
          </View>
        ) : null}
      </Animated.View>

      {showFloatingIceBreaker ? (
        <View
          pointerEvents="box-none"
          style={[styles.iceBreakerFloat, { bottom: iceBreakerBottomOffset }]}
        >
          <IceBreakerCard
            question={currentQuestion}
            onDismiss={dismissIceBreakerTemporarily}
            onShuffle={advanceIceBreaker}
          />
        </View>
      ) : null}

      {showCollapsedIceBreaker ? (
        <View
          pointerEvents="box-none"
          style={[styles.iceBreakerFloat, { bottom: iceBreakerBottomOffset }]}
        >
          <Pressable
            onPress={() => setShowIceBreaker(true)}
            style={({ pressed }) => [
              styles.iceBreakerCollapsed,
              {
                backgroundColor: theme.glassSurface,
                borderColor: theme.glassBorder,
                opacity: pressed ? 0.84 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Show ice-breaker question"
          >
            <Ionicons name="sparkles" size={15} color={theme.tint} />
            <Text
              style={[styles.iceBreakerCollapsedText, { color: theme.tint }]}
              numberOfLines={1}
              ellipsizeMode="tail"
              adjustsFontSizeToFit
              minimumFontScale={0.88}
            >
              Icebreaker
            </Text>
          </Pressable>
        </View>
      ) : null}

      {showEntryChrome && (
        <View
          style={[
            styles.entryBottomStack,
            { bottom: entryBottomOffset },
          ]}
        >
          <VibeCheckButton
            timeLeft={displayTimeLeft}
            decision={localEntryDecision}
            localHasDecided={localEntryHasDecided}
            partnerHasDecided={partnerEntryHasDecided}
            onVibe={handleUserVibe}
            onPass={handleUserPass}
          />
        </View>
      )}

      {showDatePhaseChrome && (
        <Animated.View
          style={styles.keepTheVibeWrap}
          accessibilityLiveRegion="polite"
        >
          <KeepTheVibe
            extraTimeCredits={credits.extraTime}
            extendedVibeCredits={credits.extendedVibe}
            onExtend={handleExtend}
            pendingPartnerRequestType={pendingPartnerExtension?.type ?? null}
            isExtending={isExtending}
            onGetCredits={() => router.push("/settings/credits")}
            analyticsSessionId={sessionId}
            analyticsEventId={eventId}
          />
        </Animated.View>
      )}

      {warmupChoiceNotice ? (
        <WarmupChoiceNoticeBanner
          notice={warmupChoiceNotice}
          theme={theme}
          top={insets.top + 64}
        />
      ) : null}

      {callError ? (
        <View style={[styles.errorBar, { backgroundColor: theme.danger }]}>
          <Text style={styles.errorBarText}>{callError}</Text>
        </View>
      ) : null}

      {extendBanner?.kind === "success" ? (
        <View
          style={[
            styles.extendBanner,
            { backgroundColor: theme.tintSoft, borderColor: theme.tint },
          ]}
          accessibilityLiveRegion="polite"
        >
          <Text style={[styles.extendBannerText, { color: theme.text }]}>
            {extendBanner.minutes == null
              ? "Extra time added!"
              : `${
                  Number.isInteger(extendBanner.minutes)
                    ? String(extendBanner.minutes)
                    : extendBanner.minutes.toFixed(1)
                } extra ${extendBanner.minutes === 1 ? "minute" : "minutes"} added!`}
          </Text>
        </View>
      ) : null}
      {extendBanner?.kind === "pending" ? (
        <View
          style={[
            styles.extendBanner,
            { backgroundColor: theme.tintSoft, borderColor: theme.tint },
          ]}
          accessibilityLiveRegion="polite"
        >
          <Text style={[styles.extendBannerText, { color: theme.text }]}>
            {extendBanner.message}
          </Text>
        </View>
      ) : null}
      {extendBanner?.kind === "error" ? (
        <View
          style={[
            styles.extendBanner,
            { backgroundColor: theme.dangerSoft, borderColor: theme.danger },
          ]}
          accessibilityLiveRegion="assertive"
        >
          <Text style={[styles.extendBannerText, { color: theme.text }]}>
            {extendBanner.message}
          </Text>
        </View>
      ) : null}

      <Animated.View
        onLayout={handleControlsLayout}
        style={[
          styles.controlsBar,
          {
            bottom: insets.bottom,
            opacity: controlsAnim,
            transform: [
              {
                translateY: controlsAnim.interpolate({
                  inputRange: [0.94, 1],
                  outputRange: [10, 0],
                }),
              },
            ],
          },
        ]}
      >
        <VideoDateControls
          isMuted={isMuted}
          isVideoOff={isVideoOff}
          onToggleMute={toggleMute}
          onToggleVideo={toggleVideo}
          onLeave={handleEndDateFromControls}
          isLeaving={isEndDateConfirming}
          onViewProfile={
            suppressPartnerControlsAfterSafety || !profileSheetPartner
              ? undefined
              : () => setShowProfileSheet(true)
          }
          onSafety={
            canOpenInCallSafety ? () => setShowInCallSafety(true) : undefined
          }
        />
      </Animated.View>

      <InCallSafetySheet
        visible={showInCallSafety}
        onClose={() => setShowInCallSafety(false)}
        reportedUserId={partnerId || null}
        sessionId={sessionId ?? null}
        onReportOnlySuccess={handleReportOnlySafetySuccess}
        onEndAfterReport={handleEndAfterInCallReport}
        onServerEndedAfterReport={handleServerEndedAfterInCallReport}
      />

      {profileSheetPartner ? (
        <PartnerProfileSheet
          isOpen={showProfileSheet}
          onClose={() => setShowProfileSheet(false)}
          partner={profileSheetPartner}
          partnerProfileId={profileSheetPartnerId}
        />
      ) : null}

      <View style={StyleSheet.absoluteFill} pointerEvents="box-none" />
    </View>
  );
}
