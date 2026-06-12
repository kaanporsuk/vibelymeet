import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useEffect,
} from "react";
import {
  useAuth,
} from "@/context/AuthContext";
import {
  eventLobbyHref,
  tabsRootHref,
} from "@/lib/activeSessionRoutes";
import {
  trackEvent,
} from "@/lib/analytics";
import {
  type ActiveNativeDailyCallIdentity,
  type DailyCallObject,
  destroyNativeVideoDateDailyCall,
  NATIVE_DAILY_CALL_SINGLETON_IDLE_MS,
  NATIVE_VIDEO_DATE_DAILY_GUARD_CREATE_MAX_ATTEMPTS,
  NATIVE_VIDEO_DATE_DAILY_GUARD_CREATE_RETRY_BASE_MS,
  nativeDailyCallSingletonState,
  type NativePrejoinPipelineEntry,
  nativePrejoinPipelineKey,
  type PrejoinAttemptState,
  readNativeDailyProviderSessionId,
  safeNativeDailyMeetingState,
  type SharedDailyCallEntry,
  summarizeSharedDailyError,
} from "@/lib/daily/nativeDailyCallSingleton";
import {
  applyLocalMediaUiFromParticipant,
  dailyParticipantId,
  ensureNativeFrontCameraIntent,
} from "@/lib/daily/nativeDailyMediaHelpers";
import {
  RC_CATEGORY,
  rcBreadcrumb,
} from "@/lib/nativeRcDiagnostics";
import {
  supabase,
} from "@/lib/supabase";
import {
  vdbg,
  vdbgRedirect,
} from "@/lib/vdbg";
import {
  useNativeDailyAliveHeartbeat,
} from "@/lib/videoDate/useNativeDailyAliveHeartbeat";
import {
  addVideoDateBreadcrumb,
  dailyRoomTokenRetryDelayMs,
  type DailyTokenRefreshFailureState,
  type DailyTokenRefreshSourceAction,
  NATIVE_PREPARE_DATE_ENTRY_RETRY_DELAYS_MS,
  type NativeTerminalSurveySessionRow,
  PREJOIN_STEP_TIMEOUT_MS,
  READY_GATE_RACE_RETRY_BACKOFFS_MS,
  refetchTruthAndCheckStartable,
  sleepNativeRuntimeRecovery,
  userMessageForTokenFailure,
  videoDateDailyDiagnostic,
} from "@/lib/videoDate/videoDateScreenShared";
import {
  fetchVideoSessionDateEntryTruth,
  fetchVideoSessionDateEntryTruthCoalesced,
  type GetDailyRoomTokenResult,
  getDailyRoomTokenWithTimeout,
  useVideoDateSession,
  VideoDateRequestTimeoutError,
} from "@/lib/videoDateApi";
import {
  emitNativeVideoDateClientStuckState,
} from "@/lib/videoDateClientStuckObservability";
import {
  createVideoDateDailyCallObjectGuarded,
  isVideoDateCameraConstraintError as isNativeVideoDateCameraConstraintError,
  type NativeVideoDateCaptureProfile,
  type VideoDateDailyCallObject,
} from "@/lib/videoDateDailyMediaConfig";
import {
  consumeNativeVideoDateDailyPrewarm,
  markNativeVideoDateDailyPrewarmFallback,
} from "@/lib/videoDateDailyPrewarm";
import {
  videoDateLaunchBreadcrumb,
} from "@/lib/videoDateLaunchTrace";
import {
  clearDateEntryTransition,
} from "@/lib/videoDateNavigationIntents";
import {
  consumePreparedVideoDateEntry,
  getPreparedVideoDateEntry,
  preparedEntryPrepareToJoinStartMs,
  prepareVideoDateEntry,
  rejectPreparedVideoDateEntry,
} from "@/lib/videoDatePrepareEntry";
import {
  refreshVideoDateToken,
} from "@/lib/videoDateTokenRefresh";
import {
  LobbyPostDateEvents,
} from "@clientShared/analytics/lobbyToPostDateJourney";
import {
  videoSessionRowIndicatesEntryOrDate,
} from "@clientShared/matching/activeSession";
import {
  markDailyJoinedWithBackoff,
} from "@clientShared/matching/dailyJoinedConfirmation";
import {
  classifyDailyRoomTokenFailureClass,
} from "@clientShared/matching/dailyRoomFailure";
import {
  getVideoDateEntryOwner,
  updateVideoDateDailyOwnerState,
  updateVideoDateEntryOwnerState,
} from "@clientShared/matching/videoDateEntryOwner";
import {
  videoDateEntryStartedAtIso,
} from "@clientShared/matching/videoDateEntryTiming";
import {
  videoDateLifecycleRpcCode,
  videoDateLifecycleRpcIndicatesTerminalStop,
  videoDateLifecycleRpcIndicatesTerminalSurvey,
  videoDateLifecycleRpcRetryable,
} from "@clientShared/matching/videoDateLifecycleRpc";
import {
  type PrejoinAttemptStep,
  shouldPreservePrejoinAttemptOnCleanup,
} from "@clientShared/matching/videoDatePrejoinAttempt";
import {
  isVideoDateTokenRefreshRateLimited,
  isVideoDateTokenRefreshTerminal,
  videoDateTokenRefreshRetryAfterMs,
} from "@clientShared/matching/videoDatePublicApi";
import {
  adviseVideoDateTokenRecovery,
  adviseVideoSessionTruthRecovery,
} from "@clientShared/matching/videoDateRecoveryAdvisor";
import {
  bucketVideoDateLatencyMs,
  buildReadyGateToDateLatencyPayload,
  recordReadyGateToDateLatencyCheckpoint,
} from "@clientShared/observability/videoDateOperatorMetrics";
import {
  type DailyParticipant,
} from "@daily-co/react-native-daily-js";
import * as Sentry from "@sentry/react-native";
import {
  router,
} from "expo-router";
import type { NativeVideoDateCallListenersApi } from "./useNativeVideoDateCallListeners";
import type { NativeVideoDateSurfaceClaimApi } from "./useNativeVideoDateSurfaceClaim";

/**
 * Start-call concern of the native Video Date screen: the single prejoin->token->join->bind orchestration effect. Kept as ONE effect by design (PR 7.5 precedent): its handlers capture attempt-locals; splitting that capture is the incident class to avoid.
 *
 * Video Date rebuild PR 8.5 extraction; body verbatim from
 * `apps/mobile/app/date/[id].tsx`. Deps are destructured to their original
 * names so closure semantics and contract pins hold.
 */

export interface NativeVideoDateStartCallDeps {
  activeNativeDailyCallIdentityRef: MutableRefObject<ActiveNativeDailyCallIdentity | null>;
  activePreparedEntryCacheHitRef: MutableRefObject<boolean | null>;
  activePreparedEntryCacheRef: MutableRefObject<ReturnType<typeof getPreparedVideoDateEntry> | null>;
  authLoading: boolean;
  beginBootstrapTiming: (step: string, data?: Record<string, unknown>) => void;
  bindCallListeners: NativeVideoDateCallListenersApi["bindCallListeners"];
  boundCallRef: MutableRefObject<DailyCallObject | null>;
  boundHandlersRef: MutableRefObject<{ onParticipantJoined: (event: { participant?: DailyParticipant }) => void; onParticipantUpdated: (event: { participant?: DailyParticipant }) => void; onParticipantLeft: (event: { participant?: DailyParticipant }) => void; onLeftMeeting: () => void; onAppMessage: (event: { data?: unknown; fromId?: string }) => void; onError: (event: unknown) => void; onNetworkQualityChange?: (event: unknown) => void; } | null>;
  callRef: MutableRefObject<DailyCallObject | null>;
  captureProfile: NativeVideoDateCaptureProfile;
  captureProfileRef: MutableRefObject<NativeVideoDateCaptureProfile>;
  claimNativeVideoDateSurface: NativeVideoDateSurfaceClaimApi["claimNativeVideoDateSurface"];
  cleanupTerminalDailyCall: NativeVideoDateCallListenersApi["cleanupTerminalDailyCall"];
  clearDailyAliveHeartbeatTimer: ReturnType<typeof useNativeDailyAliveHeartbeat>["clearDailyAliveHeartbeatTimer"];
  clearDailyTokenRefreshTimer: () => void;
  clearFirstConnectWatchdog: () => void;
  clearPartnerAwayAfterTransportGrace: (reason: string) => void;
  dailyJoinStartedAtMsRef: MutableRefObject<number | null>;
  dailyPrewarmConsumedForJoinRef: MutableRefObject<boolean>;
  dailyTokenExpiresAtRef: MutableRefObject<string | null>;
  dailyTokenRecoveryInFlightRef: MutableRefObject<boolean>;
  dailyTokenRefreshTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  dateEntryPermissionEligible: boolean;
  detachCallListeners: NativeVideoDateCallListenersApi["detachCallListeners"];
  endBootstrapTiming: (step: string, data?: Record<string, unknown>) => void;
  eventId: string;
  firstRemoteParticipantTimedRef: MutableRefObject<boolean>;
  hasStartedJoinRef: MutableRefObject<boolean>;
  joinAttemptNonce: number;
  joining: boolean;
  lastNativeRemoteCameraSwitchHintIdRef: MutableRefObject<string | null>;
  latestDateRouteEndedRef: MutableRefObject<boolean>;
  latestDateRouteSessionIdRef: MutableRefObject<string | null>;
  latestDateRouteUserIdRef: MutableRefObject<string | null>;
  localParticipantRef: MutableRefObject<DailyParticipant | null>;
  nativeSurfaceClientReady: boolean;
  observedNativePrejoinPipelineKeyRef: MutableRefObject<string | null>;
  openNativePostDateSurveyFromTerminalTruth: ( source: string, sessionOverride?: NativeTerminalSurveySessionRow | null, ) => Promise<boolean>;
  pathname: string;
  phase: ReturnType<typeof useVideoDateSession>["phase"];
  phaseRef: MutableRefObject<ReturnType<typeof useVideoDateSession>["phase"]>;
  prejoinAttemptRef: MutableRefObject<PrejoinAttemptState | null>;
  prejoinAttemptSeqRef: MutableRefObject<number>;
  preparedJoinRetryUsedRef: MutableRefObject<boolean>;
  prewarmedAlreadyJoinedRef: MutableRefObject<boolean>;
  prewarmedJoinInFlightRef: MutableRefObject<boolean>;
  providerVerifySkippedRef: MutableRefObject<boolean | null>;
  recoverFromNotStartableDateTruth: (source: "prepare_date_entry") => Promise<boolean>;
  recoverNativeDailyTokenRef: MutableRefObject<(sourceAction: DailyTokenRefreshSourceAction, cause?: unknown) => Promise<boolean>>;
  refetchVideoSession: ReturnType<typeof useVideoDateSession>["refetch"];
  releaseSharedCallIfOwned: (call: DailyCallObject | null, reason: string) => void;
  remoteParticipantRef: MutableRefObject<DailyParticipant | null>;
  requestPermissions: () => Promise<boolean>;
  requestReconnectSyncRef: MutableRefObject<(reason: string) => void>;
  resetNativeRemoteRenderRecovery: (participant: DailyParticipant | null | undefined, reason: string) => void;
  roomNameRef: MutableRefObject<string | null>;
  session: ReturnType<typeof useVideoDateSession>["session"];
  sessionError: ReturnType<typeof useVideoDateSession>["error"];
  sessionId: string;
  sessionLoading: ReturnType<typeof useVideoDateSession>["loading"];
  setAwaitingFirstConnect: Dispatch<SetStateAction<boolean>>;
  setCallError: Dispatch<SetStateAction<string | null>>;
  setCaptureProfile: Dispatch<SetStateAction<NativeVideoDateCaptureProfile>>;
  setIsConnecting: Dispatch<SetStateAction<boolean>>;
  setIsMuted: Dispatch<SetStateAction<boolean>>;
  setIsPartnerDisconnected: Dispatch<SetStateAction<boolean>>;
  setIsVideoOff: Dispatch<SetStateAction<boolean>>;
  setJoinAttemptNonce: Dispatch<SetStateAction<number>>;
  setJoining: Dispatch<SetStateAction<boolean>>;
  setLocalInDailyRoom: Dispatch<SetStateAction<boolean>>;
  setLocalParticipant: Dispatch<SetStateAction<DailyParticipant | null>>;
  setPartnerEverJoined: Dispatch<SetStateAction<boolean>>;
  setPreJoinFailed: Dispatch<SetStateAction<boolean>>;
  setRemoteParticipant: Dispatch<SetStateAction<DailyParticipant | null>>;
  startDailyAliveHeartbeat: ReturnType<typeof useNativeDailyAliveHeartbeat>["startDailyAliveHeartbeat"];
  user: ReturnType<typeof useAuth>["user"];
}

export function useNativeVideoDateStartCall(deps: NativeVideoDateStartCallDeps) {
  const {
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
  } = deps;

  useEffect(() => {
    const userId = user?.id ?? null;
    const currentPhase = phaseRef.current;
    const waitingForNativeSurfaceClientIdentity = !nativeSurfaceClientReady;
    const initialGuard = {
      hasSessionId: Boolean(sessionId),
      hasUserId: Boolean(userId),
      hasSession: Boolean(session),
      sessionEnded: Boolean(session?.ended_at),
      waitingForNativeSurfaceClientIdentity,
      nativeSurfaceClientReady,
      joining,
      hasCall: Boolean(callRef.current),
      hasStartedJoin: hasStartedJoinRef.current,
      sessionError: sessionError ?? null,
      phase: currentPhase,
      dateEntryPermissionEligible,
    };
    rcBreadcrumb(RC_CATEGORY.videoDateEntry, "date_prejoin_effect_started", {
      session_id: sessionId ?? null,
      user_id: userId,
      has_session_id: Boolean(sessionId),
      auth_loading: authLoading,
      session_loading: sessionLoading,
      auth_hydrated: !authLoading,
      session_hydrated: !sessionLoading,
      current_phase: currentPhase,
      pathname: pathname ?? null,
    });
    vdbg("prejoin_step_prejoin_effect_fired", {
      sessionId: sessionId ?? null,
      userId,
      ...initialGuard,
    });
    if (
      !sessionId ||
      !user?.id ||
      !session ||
      session.ended_at ||
      !dateEntryPermissionEligible ||
      waitingForNativeSurfaceClientIdentity ||
      (joining && hasStartedJoinRef.current) ||
      callRef.current ||
      hasStartedJoinRef.current
    ) {
      const existingCall = callRef.current;
      if (
        existingCall &&
        sessionId &&
        user?.id &&
        session &&
        !session.ended_at &&
        (boundCallRef.current !== existingCall || !boundHandlersRef.current)
      ) {
        bindCallListeners(existingCall, roomNameRef.current);
      }
      vdbg("prejoin_step_prejoin_truth_skipped_or_started", {
        sessionId: sessionId ?? null,
        userId,
        started: false,
        reason: "initial_guard",
        ...initialGuard,
      });
      return;
    }
    if (sessionError || currentPhase === "ended") {
      vdbg("prejoin_step_prejoin_truth_skipped_or_started", {
        sessionId,
        userId,
        started: false,
        reason: "session_error_or_ended_phase",
        sessionError: sessionError ?? null,
        phase: currentPhase,
      });
      return;
    }

    const prejoinPipelineKey = nativePrejoinPipelineKey(sessionId, user.id);
    const activePrejoinPipeline =
      nativeDailyCallSingletonState.sharedNativePrejoinPipelineEntry?.key === prejoinPipelineKey
        ? nativeDailyCallSingletonState.sharedNativePrejoinPipelineEntry
        : null;
    if (activePrejoinPipeline) {
      const observerKey = `${activePrejoinPipeline.key}:${activePrejoinPipeline.attemptId}:${activePrejoinPipeline.startedAtMs}`;
      vdbg("native_prejoin_pipeline_reuse_in_flight", {
        sessionId,
        userId: user.id,
        ownerAttemptId: activePrejoinPipeline.attemptId,
        ageMs: Date.now() - activePrejoinPipeline.startedAtMs,
        hasCall: Boolean(callRef.current),
        hasSharedCall: Boolean(nativeDailyCallSingletonState.sharedDailyCallEntry?.sessionId === sessionId),
      });
      setJoining(true);
      setIsConnecting(true);
      if (observedNativePrejoinPipelineKeyRef.current !== observerKey) {
        observedNativePrejoinPipelineKeyRef.current = observerKey;
        void activePrejoinPipeline.promise?.finally(() => {
          const sameSessionAndUser =
            latestDateRouteSessionIdRef.current === sessionId &&
            latestDateRouteUserIdRef.current === user.id &&
            !latestDateRouteEndedRef.current;
          if (!sameSessionAndUser) return;
          vdbg("native_prejoin_pipeline_reuse_retry_after_release", {
            sessionId,
            userId: user.id,
            ownerAttemptId: activePrejoinPipeline.attemptId,
          });
          setJoinAttemptNonce((n) => n + 1);
        });
      }
      return;
    }

    const attemptId = prejoinAttemptSeqRef.current + 1;
    prejoinAttemptSeqRef.current = attemptId;
    dailyPrewarmConsumedForJoinRef.current = false;
    prewarmedAlreadyJoinedRef.current = false;
    prewarmedJoinInFlightRef.current = false;
    providerVerifySkippedRef.current = null;
    clearDailyTokenRefreshTimer();
    dailyTokenRecoveryInFlightRef.current = false;
    const attemptState: PrejoinAttemptState = {
      attemptId,
      sessionId,
      userId: user.id,
      currentStep: "effect_started",
      cancellationReason: null,
      roomAcquisitionStarted: false,
      completed: false,
    };
    prejoinAttemptRef.current = attemptState;
    const prejoinLogContext = () => ({
      attemptId,
      currentStep: attemptState.currentStep,
      cancellationReason: attemptState.cancellationReason,
      hasCall: Boolean(callRef.current),
      roomAcquisitionStarted: attemptState.roomAcquisitionStarted,
    });
    const setPrejoinStep = (step: PrejoinAttemptStep) => {
      attemptState.currentStep = step;
      if (step === "daily_room") attemptState.roomAcquisitionStarted = true;
      return step;
    };
    const requestPrejoinRetryAfterCancellation = (reason: string) => {
      attemptState.completed = true;
      hasStartedJoinRef.current = false;
      vdbg("prejoin_state_hasStartedJoinRef", {
        value: false,
        sessionId,
        userId: user.id,
        step: attemptState.currentStep,
        reason,
        ...prejoinLogContext(),
      });
      vdbg("prejoin_state_joinAttemptNonce", {
        value: "increment",
        sessionId,
        userId: user.id,
        step: attemptState.currentStep,
        reason,
        ...prejoinLogContext(),
      });
      setJoinAttemptNonce((n) => n + 1);
    };

    const prejoinPipelineEntry: NativePrejoinPipelineEntry = {
      key: prejoinPipelineKey,
      sessionId,
      userId: user.id,
      attemptId,
      startedAtMs: Date.now(),
      promise: null,
    };
    nativeDailyCallSingletonState.sharedNativePrejoinPipelineEntry = prejoinPipelineEntry;
    observedNativePrejoinPipelineKeyRef.current = `${prejoinPipelineEntry.key}:${attemptId}:${prejoinPipelineEntry.startedAtMs}`;
    vdbg("native_prejoin_pipeline_started", {
      sessionId,
      userId: user.id,
      attemptId,
    });

    hasStartedJoinRef.current = true;
    vdbg("prejoin_state_hasStartedJoinRef", {
      value: true,
      sessionId,
      userId: user.id,
      ...prejoinLogContext(),
    });
    let cancelled = false;
    let prejoinCompleted = false;
    let currentStep: PrejoinAttemptStep = "effect_started";
    const prejoinPipelineStart = Date.now();
    let prejoinSegment = prejoinPipelineStart;
    const prejoinMark = (step: string) => {
      const t = Date.now();
      videoDateLaunchBreadcrumb(`prejoin_${step}`, {
        session_id: sessionId,
        user_id: user.id,
        duration_ms: t - prejoinSegment,
      });
      prejoinSegment = t;
    };
    const run = async () => {
      currentStep = setPrejoinStep("initial_state");
      vdbg("prejoin_state_joining", {
        value: true,
        sessionId,
        userId: user.id,
        step: currentStep,
        ...prejoinLogContext(),
      });
      setJoining(true);
      vdbg("prejoin_state_callError", {
        value: null,
        sessionId,
        userId: user.id,
        step: currentStep,
      });
      setCallError(null);
      vdbg("prejoin_state_preJoinFailed", {
        value: false,
        sessionId,
        userId: user.id,
        step: currentStep,
      });
      setPreJoinFailed(false);
      vdbg("prejoin_state_awaitingFirstConnect", {
        value: false,
        sessionId,
        userId: user.id,
        step: currentStep,
      });
      setAwaitingFirstConnect(false);
      clearFirstConnectWatchdog();
      const destroySharedCallForRetry = async (
        entry: SharedDailyCallEntry,
        reason: string,
      ) => {
        entry.state = "leaving";
        entry.joinPromise = null;
        vdbg("daily_call_singleton_destroy_for_retry", {
          reason,
          sessionId,
          userId: user.id,
          roomName: entry.roomName,
          captureProfile: entry.captureProfile,
          lastError: entry.lastError,
        });
        try {
          await entry.call.leave();
        } catch {
          /* best effort */
        }
        try {
          await destroyNativeVideoDateDailyCall(entry.call, reason, {
            sessionId,
            userId: user.id,
            roomName: entry.roomName,
          });
        } catch {
          /* best effort */
        }
        if (callRef.current === entry.call) callRef.current = null;
        detachCallListeners(reason);
        releaseSharedCallIfOwned(entry.call, reason);
      };
      const hydrateJoinedSharedCall = (
        entry: SharedDailyCallEntry,
        participants: ReturnType<DailyCallObject["participants"]>,
        source: string,
      ): boolean => {
        const local = participants?.local ?? null;
        if (!local) return false;
        entry.state = "joined";
        entry.joinPromise = null;
        entry.lastError = null;
        callRef.current = entry.call;
        roomNameRef.current = entry.roomName;
        captureProfileRef.current = entry.captureProfile;
        setCaptureProfile(entry.captureProfile);
        bindCallListeners(entry.call, entry.roomName);
        const remotes = Object.values(participants).filter(
          (p) => !(p as unknown as { local?: boolean }).local,
        );
        vdbg("daily_call_singleton_reuse_same_session", {
          sessionId,
          userId: user.id,
          roomName: entry.roomName,
          captureProfile: entry.captureProfile,
          remoteCount: remotes.length,
          hasLocalParticipant: true,
          source,
          state: entry.state,
        });
        setLocalInDailyRoom(true);
        localParticipantRef.current = local as DailyParticipant;
        setLocalParticipant(local as DailyParticipant | null);
        applyLocalMediaUiFromParticipant(local as DailyParticipant, {
          setIsVideoOff,
          setIsMuted,
        });
        if (remotes.length > 0) {
          const remote = remotes[0] as DailyParticipant;
          clearPartnerAwayAfterTransportGrace("shared_call_snapshot");
          remoteParticipantRef.current = remote;
          resetNativeRemoteRenderRecovery(remote, "shared_call_snapshot");
          setRemoteParticipant(remote);
          setPartnerEverJoined(true);
          setIsPartnerDisconnected(false);
          setAwaitingFirstConnect(false);
        } else {
          remoteParticipantRef.current = null;
          lastNativeRemoteCameraSwitchHintIdRef.current = null;
          resetNativeRemoteRenderRecovery(
            null,
            "shared_call_snapshot_no_remote",
          );
          setRemoteParticipant(null);
          setAwaitingFirstConnect(true);
        }
        setIsConnecting(false);
        setJoining(false);
        prejoinCompleted = true;
        prejoinMark(
          source === "join_promise_resolved"
            ? "singleton_join_promise_resolved"
            : "singleton_reuse_short_circuit",
        );
        videoDateLaunchBreadcrumb("prejoin_pipeline_total", {
          session_id: sessionId,
          user_id: user.id,
          duration_ms: Date.now() - prejoinPipelineStart,
        });
        return true;
      };
      const sharedCallCandidate = nativeDailyCallSingletonState.sharedDailyCallEntry;
      if (sharedCallCandidate && sharedCallCandidate.userId !== user.id) {
        vdbg("daily_call_singleton_owner_mismatch_destroy", {
          sessionId: sharedCallCandidate.sessionId,
          entryUserId: sharedCallCandidate.userId,
          currentUserId: user.id,
          state: sharedCallCandidate.state,
        });
        await destroySharedCallForRetry(sharedCallCandidate, "owner_mismatch");
      }
      const sharedCall = nativeDailyCallSingletonState.sharedDailyCallEntry;
      if (sharedCall && sharedCall.sessionId === sessionId) {
        const canReuseIdleSharedCall = sharedCall.state === "idle";
        if (canReuseIdleSharedCall) {
          vdbg("daily_call_singleton_reuse_same_session_idle_deferred", {
            sessionId,
            userId: user.id,
            roomName: sharedCall.roomName,
            captureProfile: sharedCall.captureProfile,
            idleAgeMs: sharedCall.parkedAtMs
              ? Math.max(0, Date.now() - sharedCall.parkedAtMs)
              : null,
          });
        } else {
          const reusedCall = sharedCall.call;
          let participants: ReturnType<DailyCallObject["participants"]> | null =
            null;
          try {
            participants = reusedCall.participants();
          } catch (error) {
            sharedCall.state = "failed";
            sharedCall.lastError = summarizeSharedDailyError(error);
            participants = null;
          }

          if (
            participants &&
            hydrateJoinedSharedCall(
              sharedCall,
              participants,
              "already_joined_snapshot",
            )
          ) {
            return;
          }

          const canAwaitSharedJoin =
            Boolean(sharedCall.joinPromise) &&
            (sharedCall.state === "creating" || sharedCall.state === "joining");
          if (canAwaitSharedJoin && sharedCall.joinPromise) {
            callRef.current = reusedCall;
            roomNameRef.current = sharedCall.roomName;
            captureProfileRef.current = sharedCall.captureProfile;
            setCaptureProfile(sharedCall.captureProfile);
            bindCallListeners(reusedCall, sharedCall.roomName);
            setIsConnecting(true);
            setJoining(true);
            vdbg("daily_call_singleton_reuse_join_in_flight", {
              sessionId,
              userId: user.id,
              roomName: sharedCall.roomName,
              captureProfile: sharedCall.captureProfile,
              state: sharedCall.state,
              joinStartedAtMs: sharedCall.joinStartedAtMs,
              ageMs: Date.now() - sharedCall.createdAtMs,
            });
            try {
              await sharedCall.joinPromise;
              let joinedParticipants: ReturnType<
                DailyCallObject["participants"]
              > | null = null;
              try {
                joinedParticipants = reusedCall.participants();
              } catch (error) {
                sharedCall.state = "failed";
                sharedCall.lastError = summarizeSharedDailyError(error);
                releaseSharedCallIfOwned(
                  reusedCall,
                  "reuse_join_promise_participants_failed",
                );
              }
              if (
                joinedParticipants &&
                hydrateJoinedSharedCall(
                  sharedCall,
                  joinedParticipants,
                  "join_promise_resolved",
                )
              ) {
                return;
              }
              await destroySharedCallForRetry(
                sharedCall,
                "reuse_join_promise_resolved_without_local",
              );
            } catch (error) {
              sharedCall.state = "failed";
              sharedCall.joinPromise = null;
              sharedCall.lastError = summarizeSharedDailyError(error);
              vdbg("daily_call_singleton_reuse_join_in_flight_failed", {
                sessionId,
                userId: user.id,
                roomName: sharedCall.roomName,
                error: sharedCall.lastError,
              });
              await destroySharedCallForRetry(
                sharedCall,
                "reuse_join_in_flight_failed",
              );
            }
          } else if (
            sharedCall.state === "joining" ||
            sharedCall.state === "creating"
          ) {
            callRef.current = reusedCall;
            roomNameRef.current = sharedCall.roomName;
            captureProfileRef.current = sharedCall.captureProfile;
            setCaptureProfile(sharedCall.captureProfile);
            bindCallListeners(reusedCall, sharedCall.roomName);
            setIsConnecting(true);
            setJoining(true);
            vdbg("daily_call_singleton_reuse_in_flight_without_promise", {
              sessionId,
              userId: user.id,
              roomName: sharedCall.roomName,
              state: sharedCall.state,
              ageMs: Date.now() - sharedCall.createdAtMs,
            });
            return;
          } else {
            await destroySharedCallForRetry(
              sharedCall,
              "reuse_probe_terminal_state_without_local",
            );
          }
        }
      }

      currentStep = setPrejoinStep("permissions");
      const ok = await requestPermissions();
      prejoinMark("permissions");
      if (!ok || cancelled) {
        vdbg("prejoin_step_prejoin_error", {
          sessionId,
          userId: user.id,
          step: currentStep,
          reason: cancelled
            ? "cancelled_after_permissions"
            : "permissions_denied",
          permissionsOk: ok,
          cancelled,
        });
        vdbg("prejoin_step_prejoin_daily_room_skipped", {
          sessionId,
          userId: user.id,
          reason: cancelled
            ? "cancelled_after_permissions"
            : "permissions_denied",
        });
        if (!ok && !cancelled) {
          vdbg("prejoin_state_callError", {
            value: "Camera and microphone access are needed to begin gently.",
            sessionId,
            userId: user.id,
            step: currentStep,
          });
          setCallError(
            "Camera and microphone access are needed to begin gently.",
          );
        }
        hasStartedJoinRef.current = false;
        vdbg("prejoin_state_hasStartedJoinRef", {
          value: false,
          sessionId,
          userId: user.id,
          step: currentStep,
        });
        vdbg("prejoin_state_joining", {
          value: false,
          sessionId,
          userId: user.id,
          step: currentStep,
        });
        setJoining(false);
        prejoinCompleted = !cancelled;
        return;
      }

      currentStep = setPrejoinStep("truth_fetch");
      vdbg("prejoin_step_prejoin_truth_skipped_or_started", {
        sessionId,
        userId: user.id,
        started: true,
        reason: null,
      });
      beginBootstrapTiming("truth_fetch", { source: "prejoin" });
      const truth0 = await fetchVideoSessionDateEntryTruthCoalesced(sessionId);
      endBootstrapTiming("truth_fetch", {
        source: "prejoin",
        has_truth: Boolean(truth0),
      });
      prejoinMark("truth0_coalesced");
      if (cancelled) {
        vdbg("prejoin_step_prejoin_error", {
          sessionId,
          userId: user.id,
          step: currentStep,
          reason: "cancelled_after_truth_fetch",
        });
        vdbg("prejoin_step_prejoin_daily_room_skipped", {
          sessionId,
          userId: user.id,
          reason: "cancelled_after_truth_fetch",
        });
        hasStartedJoinRef.current = false;
        vdbg("prejoin_state_hasStartedJoinRef", {
          value: false,
          sessionId,
          userId: user.id,
          step: currentStep,
        });
        vdbg("prejoin_state_joining", {
          value: false,
          sessionId,
          userId: user.id,
          step: currentStep,
        });
        setJoining(false);
        return;
      }
      vdbg("date_prejoin_truth_row", {
        sessionId,
        userId: user.id,
        row: truth0 ?? null,
      });
      if (!truth0) {
        vdbg("prejoin_step_prejoin_error", {
          sessionId,
          userId: user.id,
          step: currentStep,
          reason: "session_row_missing",
        });
        vdbg("prejoin_step_prejoin_daily_room_skipped", {
          sessionId,
          userId: user.id,
          reason: "session_row_missing",
        });
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, "prepare_date_entry_fail", {
          session_id: sessionId,
          user_id: user?.id ?? null,
          reason: "session_row_missing",
        });
        vdbg("prejoin_state_callError", {
          value: "We couldn't open this date. Go back and try again.",
          sessionId,
          userId: user.id,
          step: currentStep,
        });
        setCallError("We couldn't open this date. Go back and try again.");
        hasStartedJoinRef.current = false;
        vdbg("prejoin_state_hasStartedJoinRef", {
          value: false,
          sessionId,
          userId: user.id,
          step: currentStep,
        });
        vdbg("prejoin_state_joining", {
          value: false,
          sessionId,
          userId: user.id,
          step: currentStep,
        });
        setJoining(false);
        prejoinCompleted = true;
        return;
      }
      const truthRecovery0 = adviseVideoSessionTruthRecovery({
        sessionId,
        eventId,
        truth: truth0,
        platform: "native",
        surface: "video_date",
      });
      const truthDecision0 = truthRecovery0.routeDecision ?? "stay_lobby";
      if (truthRecovery0.action === "show_terminal") {
        vdbg("prejoin_step_prejoin_error", {
          sessionId,
          userId: user.id,
          step: currentStep,
          reason: "session_ended_prejoin",
          endedAt: truth0.ended_at ?? null,
        });
        vdbg("prejoin_step_prejoin_daily_room_skipped", {
          sessionId,
          userId: user.id,
          reason: "session_ended_prejoin",
          endedAt: truth0.ended_at ?? null,
        });
        if (truth0.event_id) {
          const target = eventLobbyHref(truth0.event_id as string);
          vdbgRedirect(target, "session_ended_prejoin", {
            sessionId,
            userId: user.id,
            eventId: truth0.event_id,
            endedAt: truth0.ended_at ?? null,
          });
          router.replace(target);
        } else {
          const target = tabsRootHref();
          vdbgRedirect(target, "session_ended_prejoin", {
            sessionId,
            userId: user.id,
            endedAt: truth0.ended_at ?? null,
          });
          router.replace(target);
        }
        hasStartedJoinRef.current = false;
        vdbg("prejoin_state_hasStartedJoinRef", {
          value: false,
          sessionId,
          userId: user.id,
          step: currentStep,
        });
        vdbg("prejoin_state_joining", {
          value: false,
          sessionId,
          userId: user.id,
          step: currentStep,
        });
        setJoining(false);
        prejoinCompleted = true;
        return;
      }

      currentStep = setPrejoinStep("prepare_entry_routeable");
      const hasEntryStarted = Boolean(videoDateEntryStartedAtIso(truth0));
      const alreadyInEntryOrDate =
        videoSessionRowIndicatesEntryOrDate(truth0);
      const preparedEntryRouteable = truthRecovery0.action === "go_date";
      rcBreadcrumb(RC_CATEGORY.videoDateEntry, "prepare_entry_routeable", {
        session_id: sessionId,
        user_id: user?.id ?? null,
        event_id: truth0.event_id,
        vs_state: truth0.state,
        vs_phase: truth0.phase,
        routeable: preparedEntryRouteable,
        already_entry_or_date: alreadyInEntryOrDate,
        entry_started_at: hasEntryStarted,
      });
      vdbg("prejoin_step_prejoin_prepare_entry_routeable", {
        sessionId,
        userId: user.id,
        hasEntryStarted,
        alreadyInEntryOrDate,
        truthDecision: truthDecision0,
        preparedEntryRouteable,
        state: truth0.state,
        phase: truth0.phase,
        endedAt: truth0.ended_at ?? null,
      });

      if (!preparedEntryRouteable) {
        const redirected =
          await recoverFromNotStartableDateTruth("prepare_date_entry");
        if (redirected) {
          hasStartedJoinRef.current = false;
          vdbg("prejoin_state_hasStartedJoinRef", {
            value: false,
            sessionId,
            userId: user.id,
            step: currentStep,
          });
          vdbg("prejoin_state_joining", {
            value: false,
            sessionId,
            userId: user.id,
            step: currentStep,
          });
          setJoining(false);
          prejoinCompleted = true;
          return;
        }
      }

      prejoinMark("prepare_entry_routeable");
      currentStep = setPrejoinStep("refetch_video_session");
      vdbg("prejoin_step_prejoin_refetch_before", {
        sessionId,
        userId: user.id,
        blocking: false,
      });
      videoDateLaunchBreadcrumb("prejoin_refetch_video_session_scheduled", {
        session_id: sessionId,
        user_id: user.id,
      });
      void refetchVideoSession();
      vdbg("prejoin_step_prejoin_refetch_after", {
        sessionId,
        userId: user.id,
        ok: true,
        blocking: false,
      });
      if (cancelled) {
        vdbg("prejoin_step_prejoin_cancelled", {
          sessionId,
          userId: user.id,
          step: currentStep,
          reason: "effect_cancelled_post_refetch",
          preserveStartedJoin: false,
          ...prejoinLogContext(),
        });
        vdbg("prejoin_step_prejoin_daily_room_cancelled", {
          sessionId,
          userId: user.id,
          reason: "effect_cancelled_post_refetch",
          preserveStartedJoin: false,
          ...prejoinLogContext(),
        });
        vdbg("prejoin_state_joining", {
          value: false,
          sessionId,
          userId: user.id,
          step: currentStep,
        });
        setJoining(false);
        requestPrejoinRetryAfterCancellation("effect_cancelled_post_refetch");
        return;
      }

      currentStep = setPrejoinStep("daily_room_truth_guard");
      let truth1 = await fetchVideoSessionDateEntryTruth(sessionId);
      prejoinMark("truth1_post_entry");
      vdbg("date_prejoin_truth_daily_room_guard", {
        sessionId,
        userId: user.id,
        row: truth1 ?? null,
      });
      const truthRecovery1 = adviseVideoSessionTruthRecovery({
        sessionId,
        eventId,
        truth: truth1,
        platform: "native",
        surface: "video_date",
      });
      if (truthRecovery1.action !== "go_date") {
        const redirected =
          await recoverFromNotStartableDateTruth("prepare_date_entry");
        if (redirected) {
          hasStartedJoinRef.current = false;
          vdbg("prejoin_state_hasStartedJoinRef", {
            value: false,
            sessionId,
            userId: user.id,
            step: currentStep,
          });
          vdbg("prejoin_state_joining", {
            value: false,
            sessionId,
            userId: user.id,
            step: currentStep,
          });
          setJoining(false);
          prejoinCompleted = true;
          return;
        }
        // Recover did not redirect — bounded refetch loop in case truth has caught up between
        // the in-screen guard and recovery's own refetch (cross-region / replica lag).
        rcBreadcrumb(
          RC_CATEGORY.videoDateEntry,
          "ready_gate_not_ready_retry_start",
          {
            session_id: sessionId,
            user_id: user.id,
            source: "daily_room_truth_guard",
          },
        );
        let truthGuardRecovered = false;
        for (let i = 0; i < READY_GATE_RACE_RETRY_BACKOFFS_MS.length; i++) {
          if (cancelled) break;
          const delay = READY_GATE_RACE_RETRY_BACKOFFS_MS[i];
          await new Promise<void>((resolve) => setTimeout(resolve, delay));
          if (cancelled) break;
          const { startable, truth: refreshed } =
            await refetchTruthAndCheckStartable(sessionId);
          if (startable) {
            truth1 = refreshed;
            rcBreadcrumb(
              RC_CATEGORY.videoDateEntry,
              "ready_gate_not_ready_retry_success",
              {
                session_id: sessionId,
                user_id: user.id,
                source: "daily_room_truth_guard",
                attempt: i + 1,
                backoff_ms: delay,
              },
            );
            truthGuardRecovered = true;
            break;
          }
        }
        if (!truthGuardRecovered) {
          rcBreadcrumb(
            RC_CATEGORY.videoDateEntry,
            "ready_gate_not_ready_retry_exhausted",
            {
              session_id: sessionId,
              user_id: user.id,
              source: "daily_room_truth_guard",
            },
          );
          rcBreadcrumb(
            RC_CATEGORY.videoDateEntry,
            "date_entry_final_ready_gate_banner",
            {
              session_id: sessionId,
              user_id: user.id,
              source: "daily_room_truth_guard",
            },
          );
          // Clear latch so the user can navigate away (back-button, app foreground hydration, etc.)
          // and so a future attempt is not silently suppressed by a stale latch.
          clearDateEntryTransition(sessionId);
          vdbg("prejoin_step_prejoin_daily_room_skipped", {
            sessionId,
            userId: user.id,
            reason: "client_daily_gate_not_startable",
            row: truth1 ?? null,
          });
          vdbg("prejoin_state_callError", {
            value:
              "Almost there — finish the Ready Gate with your match first.",
            sessionId,
            userId: user.id,
            step: currentStep,
          });
          setCallError(
            "Almost there — finish the Ready Gate with your match first.",
          );
          vdbg("prejoin_state_preJoinFailed", {
            value: true,
            sessionId,
            userId: user.id,
            step: currentStep,
          });
          setPreJoinFailed(true);
          hasStartedJoinRef.current = false;
          vdbg("prejoin_state_hasStartedJoinRef", {
            value: false,
            sessionId,
            userId: user.id,
            step: currentStep,
          });
          vdbg("prejoin_state_joining", {
            value: false,
            sessionId,
            userId: user.id,
            step: currentStep,
          });
          setJoining(false);
          prejoinCompleted = true;
          return;
        }
      }

      currentStep = setPrejoinStep("surface_claim");
      const surfaceClaim = await claimNativeVideoDateSurface(false);
      if (!surfaceClaim.canContinue || !surfaceClaim.confirmed) {
        clearDateEntryTransition(sessionId);
        vdbg("prejoin_step_prejoin_daily_room_skipped", {
          sessionId,
          userId: user.id,
          reason: surfaceClaim.canContinue
            ? "surface_claim_unconfirmed"
            : "surface_claim_conflict",
          ...prejoinLogContext(),
        });
        vdbg("prejoin_state_isConnecting", {
          value: false,
          sessionId,
          userId: user.id,
          step: currentStep,
        });
        setIsConnecting(false);
        hasStartedJoinRef.current = false;
        vdbg("prejoin_state_hasStartedJoinRef", {
          value: false,
          sessionId,
          userId: user.id,
          step: currentStep,
        });
        vdbg("prejoin_state_joining", {
          value: false,
          sessionId,
          userId: user.id,
          step: currentStep,
        });
        setJoining(false);
        prejoinCompleted = true;
        return;
      }

      currentStep = setPrejoinStep("daily_room_guard");
      vdbg("prejoin_step_prejoin_daily_room_guard", {
        sessionId,
        userId: user.id,
        cancelled,
        hasSessionId: Boolean(sessionId),
        hasTruthRow: Boolean(truth0),
        timeoutMs: PREJOIN_STEP_TIMEOUT_MS,
        willCallDailyRoom: !cancelled,
      });
      let tokenRes: GetDailyRoomTokenResult;
      let dailyTokenStartedAtMs = Date.now();
      let dailyRoomAttemptCount = 1;
      try {
        currentStep = setPrejoinStep("daily_room");
        dailyTokenStartedAtMs = Date.now();
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, "prepare_date_entry_start", {
          session_id: sessionId,
          user_id: user?.id ?? null,
          event_id: truth0.event_id,
          vs_state: truth0.state,
          vs_phase: truth0.phase,
        });
        videoDateDailyDiagnostic("token_fetch_start", {
          session_id: sessionId,
        });
        beginBootstrapTiming("daily_room_acquire", { source: "prejoin" });
        vdbg("prejoin_step_prejoin_daily_room_before", {
          sessionId,
          userId: user.id,
          timeoutMs: PREJOIN_STEP_TIMEOUT_MS,
        });
        const handoff = consumePreparedVideoDateEntry(sessionId, user.id);
        if (handoff.ok === true) {
          activePreparedEntryCacheRef.current = handoff.cacheEntry;
          activePreparedEntryCacheHitRef.current = true;
          tokenRes = {
            ok: true,
            data: {
              room_name: handoff.envelope.roomName,
              room_url: handoff.envelope.roomUrl,
              token: handoff.envelope.token,
              token_expires_at: handoff.envelope.tokenExpiresAt,
              entry_attempt_id: handoff.envelope.entryAttemptId,
              video_date_trace_id: handoff.envelope.videoDateTraceId,
              cached_prepare_entry: true,
              provider_verify_skipped:
                handoff.cacheEntry.value.provider_verify_skipped ?? null,
            },
          } satisfies GetDailyRoomTokenResult;
          vdbg("prejoin_step_prejoin_daily_room_handoff_used", {
            sessionId,
            userId: user.id,
            entryAttemptId: handoff.envelope.entryAttemptId,
            videoDateTraceId: handoff.envelope.videoDateTraceId,
          });
        } else {
          vdbg("prejoin_step_prejoin_daily_room_handoff_missed", {
            sessionId,
            userId: user.id,
            reason: handoff.reason,
          });
          tokenRes = await getDailyRoomTokenWithTimeout(
            sessionId,
            PREJOIN_STEP_TIMEOUT_MS,
            user.id,
          );
        }
        endBootstrapTiming("daily_room_acquire", {
          source: "prejoin",
          ok: tokenRes.ok,
          code: tokenRes.ok ? null : (tokenRes.code ?? null),
        });
        prejoinMark("daily_room_edge_invoke");
        vdbg("prejoin_step_prejoin_daily_room_after", {
          sessionId,
          userId: user.id,
          ok: tokenRes.ok,
          code: tokenRes.ok ? null : (tokenRes.code ?? null),
          httpStatus: tokenRes.ok ? null : (tokenRes.httpStatus ?? null),
          serverCode: tokenRes.ok ? null : (tokenRes.serverCode ?? null),
          roomName: tokenRes.ok ? tokenRes.data.room_name : null,
          hasToken: tokenRes.ok ? Boolean(tokenRes.data.token) : false,
        });
      } catch (error) {
        const timedOut = error instanceof VideoDateRequestTimeoutError;
        const tokenDurationMs = Date.now() - dailyTokenStartedAtMs;
        endBootstrapTiming("daily_room_acquire", {
          source: "prejoin",
          ok: false,
          timed_out: timedOut,
          exception: true,
        });
        vdbg("prejoin_step_prejoin_daily_room_after", {
          sessionId,
          userId: user.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          timedOut,
        });
        vdbg("prejoin_step_prejoin_error", {
          sessionId,
          userId: user.id,
          step: currentStep,
          reason: timedOut ? "daily_room_timeout" : "daily_room_exception",
        });
        videoDateDailyDiagnostic("token_fetch_failure", {
          session_id: sessionId,
          reason: timedOut ? "timeout" : "exception",
        });
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_FAILURE, {
          platform: "native",
          session_id: sessionId,
          event_id: eventId || null,
          source_surface: "video_date_daily",
          source_action: "daily_token_failure",
          reason_code: timedOut ? "timeout" : "exception",
          code: timedOut ? "timeout" : "exception",
          failure_class: classifyDailyRoomTokenFailureClass("network"),
          duration_ms: tokenDurationMs,
          latency_bucket: bucketVideoDateLatencyMs(tokenDurationMs),
          attempt_count: 1,
        });
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, "prepare_date_entry_fail", {
          session_id: sessionId,
          user_id: user?.id ?? null,
          reason: timedOut ? "timeout" : "exception",
        });
        if (!cancelled) {
          vdbg("prejoin_state_preJoinFailed", {
            value: true,
            sessionId,
            userId: user.id,
            step: currentStep,
          });
          setPreJoinFailed(true);
          vdbg("prejoin_state_callError", {
            value: timedOut
              ? "Still setting up your date. Please retry."
              : "Could not start video. Please try again.",
            sessionId,
            userId: user.id,
            step: currentStep,
          });
          setCallError(
            timedOut
              ? "Still setting up your date. Please retry."
              : "Could not start video. Please try again.",
          );
          vdbg("prejoin_state_isConnecting", {
            value: false,
            sessionId,
            userId: user.id,
            step: currentStep,
          });
          setIsConnecting(false);
        }
        hasStartedJoinRef.current = false;
        vdbg("prejoin_state_hasStartedJoinRef", {
          value: false,
          sessionId,
          userId: user.id,
          step: currentStep,
        });
        vdbg("prejoin_state_joining", {
          value: false,
          sessionId,
          userId: user.id,
          step: currentStep,
        });
        setJoining(false);
        prejoinCompleted = !cancelled;
        return;
      }
      if (cancelled) {
        vdbg("prejoin_step_prejoin_error", {
          sessionId,
          userId: user.id,
          step: currentStep,
          reason: "cancelled_after_daily_room",
          ...prejoinLogContext(),
        });
        vdbg("prejoin_step_prejoin_daily_room_skipped", {
          sessionId,
          userId: user.id,
          reason: "cancelled_after_daily_room",
          ...prejoinLogContext(),
        });
        vdbg("prejoin_state_joining", {
          value: false,
          sessionId,
          userId: user.id,
          step: currentStep,
        });
        setJoining(false);
        requestPrejoinRetryAfterCancellation(
          "daily_room_completed_after_cancellation",
        );
        return;
      }
      if (!tokenRes.ok) {
        if (tokenRes.code === "READY_GATE_NOT_READY") {
          const redirected =
            await recoverFromNotStartableDateTruth("prepare_date_entry");
          if (redirected) {
            hasStartedJoinRef.current = false;
            vdbg("prejoin_state_hasStartedJoinRef", {
              value: false,
              sessionId,
              userId: user.id,
              step: currentStep,
            });
            vdbg("prejoin_state_joining", {
              value: false,
              sessionId,
              userId: user.id,
              step: currentStep,
            });
            setJoining(false);
            prejoinCompleted = true;
            return;
          }
          // Recover did not redirect: truth says startable, but daily-room read on the server side
          // may have hit a stale snapshot. Bounded retry: refetch truth, retry prepare_date_entry.
          rcBreadcrumb(
            RC_CATEGORY.videoDateEntry,
            "ready_gate_not_ready_retry_start",
            {
              session_id: sessionId,
              user_id: user.id,
              source: "prepare_date_entry",
            },
          );
          let dailyRoomRecovered = false;
          for (let i = 0; i < READY_GATE_RACE_RETRY_BACKOFFS_MS.length; i++) {
            if (cancelled) break;
            const delay = READY_GATE_RACE_RETRY_BACKOFFS_MS[i];
            await new Promise<void>((resolve) => setTimeout(resolve, delay));
            if (cancelled) break;
            const { startable } =
              await refetchTruthAndCheckStartable(sessionId);
            if (!startable) continue;
            try {
              dailyRoomAttemptCount += 1;
              const retried = await getDailyRoomTokenWithTimeout(
                sessionId,
                PREJOIN_STEP_TIMEOUT_MS,
                user.id,
              );
              if (retried.ok) {
                tokenRes = retried;
                dailyRoomRecovered = true;
                rcBreadcrumb(
                  RC_CATEGORY.videoDateEntry,
                  "ready_gate_not_ready_retry_success",
                  {
                    session_id: sessionId,
                    user_id: user.id,
                    source: "prepare_date_entry",
                    attempt: i + 1,
                    backoff_ms: delay,
                  },
                );
                break;
              }
              if (retried.code !== "READY_GATE_NOT_READY") {
                tokenRes = retried;
                break;
              }
            } catch {
              // network/timeout — continue to next backoff
            }
          }
          if (!dailyRoomRecovered && !tokenRes.ok) {
            rcBreadcrumb(
              RC_CATEGORY.videoDateEntry,
              "ready_gate_not_ready_retry_exhausted",
              {
                session_id: sessionId,
                user_id: user.id,
                source: "prepare_date_entry",
              },
            );
          }
        }
      }
      if (
        !tokenRes.ok &&
        tokenRes.retryable &&
        tokenRes.code !== "READY_GATE_NOT_READY"
      ) {
        rcBreadcrumb(
          RC_CATEGORY.videoDateEntry,
          "prepare_date_entry_retryable_retry_start",
          {
            session_id: sessionId,
            user_id: user.id,
            code: String(tokenRes.code),
            retry_after_ms: tokenRes.retryAfterMs ?? null,
          },
        );
        for (
          let i = 0;
          i < NATIVE_PREPARE_DATE_ENTRY_RETRY_DELAYS_MS.length;
          i += 1
        ) {
          if (cancelled || tokenRes.ok || !tokenRes.retryable) break;
          const delay = dailyRoomTokenRetryDelayMs(
            tokenRes,
            NATIVE_PREPARE_DATE_ENTRY_RETRY_DELAYS_MS[i],
          );
          vdbg("prejoin_step_prejoin_daily_room_retry_scheduled", {
            sessionId,
            userId: user.id,
            attempt: dailyRoomAttemptCount,
            nextAttempt: dailyRoomAttemptCount + 1,
            code: tokenRes.code ?? null,
            httpStatus: tokenRes.httpStatus ?? null,
            retryAfterMs: tokenRes.retryAfterMs ?? null,
            delayMs: delay,
          });
          await new Promise<void>((resolve) => setTimeout(resolve, delay));
          if (cancelled) break;
          try {
            dailyRoomAttemptCount += 1;
            const retried = await getDailyRoomTokenWithTimeout(
              sessionId,
              PREJOIN_STEP_TIMEOUT_MS,
              user.id,
            );
            if (retried.ok) {
              tokenRes = retried;
              rcBreadcrumb(
                RC_CATEGORY.videoDateEntry,
                "prepare_date_entry_retryable_retry_success",
                {
                  session_id: sessionId,
                  user_id: user.id,
                  attempt: dailyRoomAttemptCount,
                },
              );
              break;
            }
            tokenRes = retried;
            if (!retried.retryable || retried.code === "READY_GATE_NOT_READY")
              break;
          } catch (error) {
            vdbg("prejoin_step_prejoin_daily_room_retry_error", {
              sessionId,
              userId: user.id,
              attempt: dailyRoomAttemptCount,
              error:
                error instanceof Error
                  ? { name: error.name, message: error.message }
                  : String(error),
            });
          }
        }
      }
      if (!tokenRes.ok) {
        const tokenDurationMs = Date.now() - dailyTokenStartedAtMs;
        vdbg("prejoin_step_prejoin_error", {
          sessionId,
          userId: user.id,
          step: currentStep,
          reason: "daily_room_not_ok",
          code: tokenRes.code ?? null,
          httpStatus: tokenRes.httpStatus ?? null,
          serverCode: tokenRes.serverCode ?? null,
          retryable: tokenRes.retryable,
          retryAfterMs: tokenRes.retryAfterMs ?? null,
          entryAttemptId: tokenRes.entry_attempt_id ?? null,
          videoDateTraceId:
            tokenRes.video_date_trace_id ?? tokenRes.entry_attempt_id ?? null,
          attemptCount: dailyRoomAttemptCount,
        });
        videoDateDailyDiagnostic("token_fetch_failure", {
          session_id: sessionId,
          code: String(tokenRes.code),
          http_status: tokenRes.httpStatus ?? null,
          server_code:
            tokenRes.serverCode != null ? String(tokenRes.serverCode) : null,
          retryable: tokenRes.retryable,
          retry_after_ms: tokenRes.retryAfterMs ?? null,
          entry_attempt_id: tokenRes.entry_attempt_id ?? null,
          video_date_trace_id:
            tokenRes.video_date_trace_id ?? tokenRes.entry_attempt_id ?? null,
        });
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_FAILURE, {
          platform: "native",
          session_id: sessionId,
          event_id: eventId || null,
          source_surface: "video_date_daily",
          source_action: "daily_token_failure",
          reason_code: String(tokenRes.code),
          code: String(tokenRes.code),
          failure_class: classifyDailyRoomTokenFailureClass(tokenRes.code),
          retryable: tokenRes.retryable,
          duration_ms: tokenDurationMs,
          latency_bucket: bucketVideoDateLatencyMs(tokenDurationMs),
          attempt_count: dailyRoomAttemptCount,
          entry_attempt_id: tokenRes.entry_attempt_id ?? null,
          video_date_trace_id:
            tokenRes.video_date_trace_id ?? tokenRes.entry_attempt_id ?? null,
        });
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, "prepare_date_entry_fail", {
          session_id: sessionId,
          code: String(tokenRes.code),
          http_status: tokenRes.httpStatus ?? null,
          retryable: tokenRes.retryable,
          retry_after_ms: tokenRes.retryAfterMs ?? null,
          attempt_count: dailyRoomAttemptCount,
          entry_attempt_id: tokenRes.entry_attempt_id ?? null,
          video_date_trace_id:
            tokenRes.video_date_trace_id ?? tokenRes.entry_attempt_id ?? null,
        });
        addVideoDateBreadcrumb("prepare_date_entry failed", "error", {
          sessionId,
          code: tokenRes.code,
          httpStatus: tokenRes.httpStatus,
          serverCode: tokenRes.serverCode,
        });
        Sentry.captureMessage("video_date_token_failed", {
          level: "warning",
          extra: {
            sessionId,
            code: tokenRes.code,
            httpStatus: tokenRes.httpStatus,
            serverCode: tokenRes.serverCode,
            retryable: tokenRes.retryable,
            retryAfterMs: tokenRes.retryAfterMs,
            attemptCount: dailyRoomAttemptCount,
          },
        });
        // Final fatal banner — always clear latch so user can navigate away. Without this, the
        // hydration / route-guard bounce remains suppressed and the user is pinned to /date.
        if (tokenRes.code === "READY_GATE_NOT_READY") {
          rcBreadcrumb(
            RC_CATEGORY.videoDateEntry,
            "date_entry_final_ready_gate_banner",
            {
              session_id: sessionId,
              user_id: user.id,
              source: "prepare_date_entry",
            },
          );
        }
        clearDateEntryTransition(sessionId);
        vdbg("prejoin_state_callError", {
          value: userMessageForTokenFailure(tokenRes.code),
          sessionId,
          userId: user.id,
          step: currentStep,
        });
        setCallError(userMessageForTokenFailure(tokenRes.code));
        hasStartedJoinRef.current = false;
        vdbg("prejoin_state_hasStartedJoinRef", {
          value: false,
          sessionId,
          userId: user.id,
          step: currentStep,
        });
        vdbg("prejoin_state_joining", {
          value: false,
          sessionId,
          userId: user.id,
          step: currentStep,
        });
        setJoining(false);
        prejoinCompleted = true;
        return;
      }

      let tokenResult = tokenRes.data;
      dailyTokenExpiresAtRef.current = tokenResult.token_expires_at ?? null;
      activePreparedEntryCacheRef.current =
        activePreparedEntryCacheRef.current ??
        getPreparedVideoDateEntry(sessionId, user.id);
      activePreparedEntryCacheHitRef.current =
        tokenResult.cached_prepare_entry === true;
      providerVerifySkippedRef.current =
        tokenResult.provider_verify_skipped ?? null;
      const entryAttemptId =
        tokenResult.entry_attempt_id ??
        activePreparedEntryCacheRef.current?.entryAttemptId ??
        null;
      const videoDateTraceId =
        tokenResult.video_date_trace_id ??
        activePreparedEntryCacheRef.current?.value.video_date_trace_id ??
        entryAttemptId;
      let lastDailyTokenRefreshFailure: DailyTokenRefreshFailureState | null =
        null;
      const getLastDailyTokenRefreshFailure =
        (): DailyTokenRefreshFailureState | null =>
          lastDailyTokenRefreshFailure;
      const tokenDurationMs = Date.now() - dailyTokenStartedAtMs;
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_SUCCESS, {
        platform: "native",
        session_id: sessionId,
        event_id: eventId || null,
        source_surface: "video_date_daily",
        source_action: "daily_token_success",
        duration_ms: tokenDurationMs,
        latency_bucket: bucketVideoDateLatencyMs(tokenDurationMs),
        attempt_count: dailyRoomAttemptCount,
        entry_attempt_id: entryAttemptId,
        video_date_trace_id: videoDateTraceId,
      });
      rcBreadcrumb(RC_CATEGORY.videoDateEntry, "prepare_date_entry_ok", {
        session_id: sessionId,
        user_id: user?.id ?? null,
        room_name: tokenResult.room_name,
        entry_attempt_id: entryAttemptId,
        video_date_trace_id: videoDateTraceId,
      });
      videoDateDailyDiagnostic("token_fetch_success", {
        session_id: sessionId,
        room_name: tokenResult.room_name,
        entry_attempt_id: entryAttemptId,
        video_date_trace_id: videoDateTraceId,
      });
      const refreshDailyTokenForJoin = async (
        sourceAction: DailyTokenRefreshSourceAction,
        cause?: unknown,
      ): Promise<boolean> => {
        lastDailyTokenRefreshFailure = null;
        const refreshStartedAtMs = Date.now();
        vdbg(sourceAction, {
          sessionId,
          userId: user.id,
          eventId: eventId || null,
          roomName: tokenResult.room_name,
          tokenExpiresAt: tokenResult.token_expires_at ?? null,
          cause:
            cause instanceof Error
              ? cause.message
              : cause
                ? String(cause)
                : null,
        });
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, sourceAction, {
          session_id: sessionId,
          user_id: user.id,
          room_name: tokenResult.room_name,
        });
        const refreshed = await refreshVideoDateToken(sessionId);
        let durationMs = Date.now() - refreshStartedAtMs;
        if (refreshed.ok === false) {
          const refreshFailure: DailyTokenRefreshFailureState = {
            kind: isVideoDateTokenRefreshTerminal(refreshed)
              ? "terminal"
              : isVideoDateTokenRefreshRateLimited(refreshed)
                ? "rate_limited"
                : "retryable",
            error: refreshed.error,
            retryAfterMs: videoDateTokenRefreshRetryAfterMs(refreshed),
            phase: refreshed.phase ?? null,
          };
          lastDailyTokenRefreshFailure = refreshFailure;
          if (refreshed.error === "room_not_ready") {
            const recoverNativeDateRouteRoomNotReadyWithPrepare = () =>
              prepareVideoDateEntry(sessionId, {
                eventId: eventId || null,
                userId: user.id,
                source: `${sourceAction}_native_date_route_room_recovery`,
                force: true,
              });
            vdbg("daily_token_refresh_prepare_entry_recovery_started", {
              sessionId,
              userId: user.id,
              eventId: eventId || null,
              sourceAction,
              roomName: tokenResult.room_name,
            });
            const prepared = await recoverNativeDateRouteRoomNotReadyWithPrepare();
            durationMs = Date.now() - refreshStartedAtMs;
            if (
              prepared.ok === true &&
              prepared.data.room_name === tokenResult.room_name &&
              prepared.data.room_url === tokenResult.room_url
            ) {
              activePreparedEntryCacheRef.current = prepared.cacheEntry;
              activePreparedEntryCacheHitRef.current = prepared.cached;
              providerVerifySkippedRef.current =
                prepared.data.provider_verify_skipped ?? null;
              tokenResult = {
                ...tokenResult,
                token: prepared.data.token,
                token_expires_at: prepared.data.token_expires_at ?? null,
                entry_attempt_id:
                  prepared.data.entry_attempt_id ??
                  tokenResult.entry_attempt_id ??
                  null,
                video_date_trace_id:
                  prepared.data.video_date_trace_id ??
                  prepared.data.entry_attempt_id ??
                  tokenResult.video_date_trace_id ??
                  null,
                cached_prepare_entry: prepared.cached,
                provider_verify_skipped:
                  prepared.data.provider_verify_skipped ??
                  tokenResult.provider_verify_skipped,
              };
              dailyTokenExpiresAtRef.current =
                tokenResult.token_expires_at ?? null;
              vdbg("daily_token_refresh_prepare_entry_recovery_success", {
                sessionId,
                userId: user.id,
                eventId: eventId || null,
                sourceAction,
                roomName: tokenResult.room_name,
                tokenExpiresAt: tokenResult.token_expires_at ?? null,
                durationMs,
              });
              trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_SUCCESS, {
                platform: "native",
                session_id: sessionId,
                event_id: eventId || null,
                source_surface: "video_date_daily",
                source_action: sourceAction,
                cached: prepared.cached,
                handoff_used: false,
                attempt: 2,
                attempt_count: 2,
                entry_attempt_id: prepared.data.entry_attempt_id ?? null,
                video_date_trace_id:
                  prepared.data.video_date_trace_id ??
                  prepared.data.entry_attempt_id ??
                  null,
                recovered_via_prepare_entry: true,
                provider_verify_reason:
                  prepared.data.provider_verify_reason ?? null,
                provider_verify_skipped:
                  prepared.data.provider_verify_skipped === true,
                duration_ms: durationMs,
                latency_bucket: bucketVideoDateLatencyMs(durationMs),
              });
              lastDailyTokenRefreshFailure = null;
              return true;
            }
            vdbg("daily_token_refresh_prepare_entry_recovery_failed", {
              sessionId,
              userId: user.id,
              eventId: eventId || null,
              sourceAction,
              reason: prepared.ok === true ? "room_mismatch" : prepared.code,
              previousRoomName: tokenResult.room_name,
              preparedRoomName:
                prepared.ok === true ? prepared.data.room_name : null,
              previousRoomUrl: tokenResult.room_url,
              preparedRoomUrl:
                prepared.ok === true ? prepared.data.room_url : null,
              durationMs,
            });
          }
          vdbg("daily_token_refresh_failed", {
            sessionId,
            userId: user.id,
            eventId: eventId || null,
            sourceAction,
            reason: refreshed.error,
            retryable: refreshed.retryable ?? null,
            retryAfterMs: refreshFailure.retryAfterMs,
            terminal: refreshFailure.kind === "terminal",
            durationMs,
          });
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_FAILURE, {
            platform: "native",
            session_id: sessionId,
            event_id: eventId || null,
            source_surface: "video_date_daily",
            source_action: sourceAction,
            code: refreshed.error,
            reason_code: refreshed.error,
            failure_class: classifyDailyRoomTokenFailureClass("network"),
            retryable: refreshed.retryable ?? true,
            duration_ms: durationMs,
            latency_bucket: bucketVideoDateLatencyMs(durationMs),
            attempt_count: 1,
          });
          return false;
        }
        if (
          refreshed.roomName !== tokenResult.room_name ||
          refreshed.roomUrl !== tokenResult.room_url
        ) {
          lastDailyTokenRefreshFailure = {
            kind: "terminal",
            error: "token_refresh_room_mismatch",
            retryAfterMs: null,
            phase: refreshed.phase ?? null,
          };
          vdbg("daily_token_refresh_room_mismatch", {
            sessionId,
            userId: user.id,
            eventId: eventId || null,
            previousRoomName: tokenResult.room_name,
            refreshedRoomName: refreshed.roomName,
            previousRoomUrl: tokenResult.room_url,
            refreshedRoomUrl: refreshed.roomUrl,
          });
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_FAILURE, {
            platform: "native",
            session_id: sessionId,
            event_id: eventId || null,
            source_surface: "video_date_daily",
            source_action: sourceAction,
            code: "token_refresh_room_mismatch",
            reason_code: "token_refresh_room_mismatch",
            failure_class: classifyDailyRoomTokenFailureClass("network"),
            retryable: true,
            duration_ms: durationMs,
            latency_bucket: bucketVideoDateLatencyMs(durationMs),
            attempt_count: 1,
          });
          return false;
        }
        tokenResult = {
          ...tokenResult,
          token: refreshed.token,
          token_expires_at: refreshed.tokenExpiresAtIso,
        };
        dailyTokenExpiresAtRef.current = tokenResult.token_expires_at ?? null;
        vdbg("daily_token_refresh_success", {
          sessionId,
          userId: user.id,
          eventId: eventId || null,
          sourceAction,
          roomName: tokenResult.room_name,
          tokenExpiresAt: tokenResult.token_expires_at ?? null,
          durationMs,
        });
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_SUCCESS, {
          platform: "native",
          session_id: sessionId,
          event_id: eventId || null,
          source_surface: "video_date_daily",
          source_action: sourceAction,
          cached: false,
          handoff_used: false,
          attempt: 1,
          attempt_count: 1,
          entry_attempt_id: entryAttemptId,
          video_date_trace_id: videoDateTraceId,
          duration_ms: durationMs,
          latency_bucket: bucketVideoDateLatencyMs(durationMs),
        });
        return true;
      };
      if (
        adviseVideoDateTokenRecovery({
          trigger: "before_join",
          tokenExpiresAtIso: tokenResult.token_expires_at,
          platform: "native",
          surface: "video_date",
        }).action === "refresh_token"
      ) {
        const refreshedBeforeJoin = await refreshDailyTokenForJoin(
          "daily_token_refresh_before_join",
        );
        const refreshFailure = getLastDailyTokenRefreshFailure();
        if (!refreshedBeforeJoin && refreshFailure?.kind === "terminal") {
          vdbg("prejoin_step_prejoin_daily_room_skipped", {
            sessionId,
            userId: user.id,
            reason: "daily_token_refresh_terminal_before_join",
            error: refreshFailure.error,
            phase: refreshFailure.phase,
          });
          setCallError(
            "This video room has closed. Checking the latest date status...",
          );
          void refetchVideoSession();
          hasStartedJoinRef.current = false;
          setJoining(false);
          setIsConnecting(false);
          prejoinCompleted = true;
          return;
        }
        if (!refreshedBeforeJoin && refreshFailure?.kind === "rate_limited") {
          vdbg("prejoin_step_prejoin_daily_room_skipped", {
            sessionId,
            userId: user.id,
            reason: "daily_token_refresh_rate_limited_before_join",
            error: refreshFailure.error,
            retryAfterMs: refreshFailure.retryAfterMs,
          });
          setCallError(
            "The video room is still opening. Try again in a moment.",
          );
          hasStartedJoinRef.current = false;
          setJoining(false);
          setIsConnecting(false);
          prejoinCompleted = true;
          return;
        }
      }

      let idleSingletonEntry =
        nativeDailyCallSingletonState.sharedDailyCallEntry &&
        nativeDailyCallSingletonState.sharedDailyCallEntry.state === "idle"
          ? nativeDailyCallSingletonState.sharedDailyCallEntry
          : null;
      if (idleSingletonEntry) {
        const idleAgeMs = idleSingletonEntry.parkedAtMs
          ? Math.max(0, Date.now() - idleSingletonEntry.parkedAtMs)
          : Number.POSITIVE_INFINITY;
        let rejectIdleReason: string | null = null;
        if (idleSingletonEntry.userId !== user.id) {
          rejectIdleReason = "idle_owner_mismatch";
        } else if (idleSingletonEntry.sessionId !== sessionId) {
          rejectIdleReason =
            "daily_call_singleton_reuse_cross_session_rejected";
        } else if (idleSingletonEntry.roomName !== tokenResult.room_name) {
          rejectIdleReason = "idle_room_mismatch";
        } else if (
          !idleSingletonEntry.idleDestroyDisabled &&
          (typeof NATIVE_DAILY_CALL_SINGLETON_IDLE_MS !== "number" ||
            !Number.isFinite(idleAgeMs) ||
            idleAgeMs >= NATIVE_DAILY_CALL_SINGLETON_IDLE_MS)
        ) {
          rejectIdleReason = "idle_expired";
        } else {
          try {
            idleSingletonEntry.call.participants();
          } catch {
            rejectIdleReason = "idle_call_unusable";
          }
        }
        if (rejectIdleReason) {
          vdbg("daily_call_singleton_idle_reuse_rejected", {
            reason: rejectIdleReason,
            previousSessionId: idleSingletonEntry.sessionId,
            nextSessionId: sessionId,
            previousRoomName: idleSingletonEntry.roomName,
            nextRoomName: tokenResult.room_name,
            entryUserId: idleSingletonEntry.userId,
            currentUserId: user.id,
            idleAgeMs: Number.isFinite(idleAgeMs) ? idleAgeMs : null,
            idleDestroyDisabled: idleSingletonEntry.idleDestroyDisabled,
          });
          await destroySharedCallForRetry(idleSingletonEntry, rejectIdleReason);
          idleSingletonEntry = null;
        }
      }
      if (idleSingletonEntry?.idleDestroyTimer) {
        clearTimeout(idleSingletonEntry.idleDestroyTimer);
        idleSingletonEntry.idleDestroyTimer = null;
      }

      if (
        nativeDailyCallSingletonState.sharedDailyCallEntry &&
        nativeDailyCallSingletonState.sharedDailyCallEntry.sessionId !== sessionId &&
        !idleSingletonEntry
      ) {
        vdbg("daily_call_singleton_destroy_previous_session", {
          previousSessionId: nativeDailyCallSingletonState.sharedDailyCallEntry.sessionId,
          nextSessionId: sessionId,
          roomName: nativeDailyCallSingletonState.sharedDailyCallEntry.roomName,
          state: nativeDailyCallSingletonState.sharedDailyCallEntry.state,
        });
        nativeDailyCallSingletonState.sharedDailyCallEntry.state = "leaving";
        try {
          await nativeDailyCallSingletonState.sharedDailyCallEntry.call.leave();
        } catch {
          /* best effort */
        }
        try {
          await destroyNativeVideoDateDailyCall(
            nativeDailyCallSingletonState.sharedDailyCallEntry.call,
            "daily_call_singleton_destroy_previous_session",
            {
              previousSessionId: nativeDailyCallSingletonState.sharedDailyCallEntry.sessionId,
              sessionId,
              userId: user.id,
              roomName: nativeDailyCallSingletonState.sharedDailyCallEntry.roomName,
            },
          );
        } catch {
          /* best effort */
        }
        nativeDailyCallSingletonState.sharedDailyCallEntry = null;
      } else if (idleSingletonEntry) {
        const singletonReuseEvent =
          idleSingletonEntry.sessionId === sessionId
            ? "daily_call_singleton_reuse_same_session_idle"
            : "daily_call_singleton_reuse_cross_session";
        vdbg(singletonReuseEvent, {
          previousSessionId: idleSingletonEntry.sessionId,
          nextSessionId: sessionId,
          previousRoomName: idleSingletonEntry.roomName,
          nextRoomName: tokenResult.room_name,
          idleAgeMs: idleSingletonEntry.parkedAtMs
            ? Math.max(0, Date.now() - idleSingletonEntry.parkedAtMs)
            : null,
          idleDestroyDisabled: idleSingletonEntry.idleDestroyDisabled,
        });
      }

      let callCaptureProfile: NativeVideoDateCaptureProfile =
        idleSingletonEntry?.captureProfile ?? "ideal";
      let dailyPrewarmConsumedForJoin = false;
      const prewarmedCall = idleSingletonEntry
        ? { ok: false as const, reason: "daily_call_singleton_reused" }
        : consumeNativeVideoDateDailyPrewarm({
            sessionId,
            userId: user.id,
            eventId: eventId || null,
            roomName: tokenResult.room_name,
            roomUrl: tokenResult.room_url,
            captureProfile: callCaptureProfile,
          });
      if (!prewarmedCall.ok) {
        vdbg("daily_prewarm_fallback", {
          sessionId,
          userId: user.id,
          eventId: eventId || null,
          reason: prewarmedCall.reason,
        });
      }
      const prewarmedAlreadyJoined =
        prewarmedCall.ok === true && prewarmedCall.entry.joined;
      const prewarmedJoinStartedAtMs =
        prewarmedCall.ok === true ? prewarmedCall.entry.joinStartedAtMs : null;
      const prewarmedJoinSource =
        prewarmedCall.ok === true ? prewarmedCall.entry.joinSource : null;
      const prewarmedJoinPromiseForShared =
        prewarmedCall.ok === true && prewarmedCall.entry.joinPromise
          ? prewarmedCall.entry.joinPromise.then((ok) => {
              if (!ok) throw new Error("daily_prewarm_join_failed");
            })
          : null;
      dailyPrewarmConsumedForJoinRef.current = prewarmedCall.ok === true;
      prewarmedAlreadyJoinedRef.current = prewarmedAlreadyJoined;
      prewarmedJoinInFlightRef.current = Boolean(
        prewarmedJoinPromiseForShared && !prewarmedAlreadyJoined,
      );
      let guardedCreateFailure: string | null = null;
      const installDailyCall = async (
        profile: NativeVideoDateCaptureProfile,
        existingCall?: VideoDateDailyCallObject | null,
        reuseKind: "none" | "prewarm" | "singleton" = existingCall
          ? "prewarm"
          : "none",
      ) => {
        let nextCall = existingCall ?? null;
        if (!nextCall) {
          for (
            let attempt = 1;
            attempt <= NATIVE_VIDEO_DATE_DAILY_GUARD_CREATE_MAX_ATTEMPTS;
            attempt += 1
          ) {
            const guarded = await createVideoDateDailyCallObjectGuarded(
              profile,
              {
                source: "native_video_date_start_call",
                currentCallObject: callRef.current,
                waitForCleanup: true,
                adoptMatchingExternalCall: true,
                videoDateSessionId: sessionId,
                videoDateRoomName: tokenResult.room_name,
                onDiagnostic: (eventName, payload) => {
                  vdbg(eventName, {
                    sessionId,
                    userId: user.id,
                    eventId: eventId || null,
                    roomName: tokenResult.room_name,
                    source: "native_video_date_start_call",
                    attempt,
                    ...payload,
                  });
                },
              },
            );
            if (guarded.ok === true) {
              nextCall = guarded.call;
              break;
            }
            guardedCreateFailure = guarded.reason;
            vdbg("native_daily_guard_create_blocked", {
              sessionId,
              userId: user.id,
              eventId: eventId || null,
              roomName: tokenResult.room_name,
              reason: guarded.reason,
              meetingState: guarded.meetingState ?? null,
              attempt,
              maxAttempts: NATIVE_VIDEO_DATE_DAILY_GUARD_CREATE_MAX_ATTEMPTS,
            });
            if (
              (guarded.reason === "external_call_busy" ||
                guarded.reason === "cleanup_pending") &&
              attempt < NATIVE_VIDEO_DATE_DAILY_GUARD_CREATE_MAX_ATTEMPTS
            ) {
              await sleepNativeRuntimeRecovery(
                Math.min(
                  1_200,
                  NATIVE_VIDEO_DATE_DAILY_GUARD_CREATE_RETRY_BASE_MS * attempt,
                ),
              );
              continue;
            }
            return null;
          }
          if (!nextCall) return null;
        }
        const reusedPrewarmed = reuseKind === "prewarm";
        dailyPrewarmConsumedForJoin = reusedPrewarmed;
        nativeDailyCallSingletonState.sharedDailyCallEntry = {
          sessionId,
          userId: user.id,
          call: nextCall,
          roomName: tokenResult.room_name,
          captureProfile: profile,
          state:
            reusedPrewarmed && prewarmedAlreadyJoined
              ? "joined"
              : reusedPrewarmed && prewarmedJoinPromiseForShared
                ? "joining"
                : "creating",
          joinPromise: reusedPrewarmed ? prewarmedJoinPromiseForShared : null,
          createdAtMs: Date.now(),
          joinStartedAtMs: reusedPrewarmed ? prewarmedJoinStartedAtMs : null,
          lastError: null,
          idleDestroyTimer: null,
          parkedAtMs: null,
          idleDestroyDisabled: false,
        };
        captureProfileRef.current = profile;
        setCaptureProfile(profile);
        vdbg("daily_call_singleton_create", {
          sessionId,
          userId: user.id,
          roomName: tokenResult.room_name,
          captureProfile: profile,
          reusedCallObject: Boolean(existingCall),
          dailyCallSingletonReused: reuseKind === "singleton",
          reusedJoinedCallObject: reusedPrewarmed && prewarmedAlreadyJoined,
          reusedJoinInFlight:
            reusedPrewarmed &&
            Boolean(prewarmedJoinPromiseForShared) &&
            !prewarmedAlreadyJoined,
          prewarmJoinSource: reusedPrewarmed ? prewarmedJoinSource : null,
        });
        videoDateDailyDiagnostic("daily_call_object_created", {
          session_id: sessionId,
          room_name: tokenResult.room_name,
          capture_profile: profile,
          reused_call_object: Boolean(existingCall),
          daily_call_singleton_reused: reuseKind === "singleton",
        });
        callRef.current = nextCall;
        roomNameRef.current = tokenResult.room_name;
        bindCallListeners(nextCall, tokenResult.room_name);
        return nextCall;
      };
      const installedCall = await installDailyCall(
        callCaptureProfile,
        idleSingletonEntry?.call ??
          (prewarmedCall.ok ? prewarmedCall.entry.call : null),
        idleSingletonEntry
          ? "singleton"
          : prewarmedCall.ok
            ? "prewarm"
            : "none",
      );
      if (!installedCall) {
        vdbg("prejoin_step_prejoin_error", {
          sessionId,
          userId: user.id,
          step: currentStep,
          reason: guardedCreateFailure ?? "native_daily_call_busy",
        });
        setCallError(
          "Still closing the previous video connection. Try again in a moment.",
        );
        setPreJoinFailed(true);
        setIsConnecting(false);
        setJoining(false);
        hasStartedJoinRef.current = false;
        prejoinCompleted = true;
        attemptState.completed = true;
        return;
      }
      let call = installedCall;
      const scheduleDailyTokenRefresh = (source: string) => {
        clearDailyTokenRefreshTimer();
        const tokenRecovery = adviseVideoDateTokenRecovery({
          trigger: "active_refresh_timer",
          tokenExpiresAtIso: tokenResult.token_expires_at,
          platform: "native",
          surface: "video_date",
        });
        const delayMs =
          tokenRecovery.action === "refresh_token"
            ? (tokenRecovery.retryAfterMs ?? 0)
            : null;
        if (delayMs == null) {
          vdbg("daily_token_refresh_schedule_skipped", {
            sessionId,
            userId: user.id,
            eventId: eventId || null,
            roomName: tokenResult.room_name,
            source,
            reason: tokenRecovery.reason,
          });
          return;
        }
        vdbg("daily_token_refresh_scheduled", {
          sessionId,
          userId: user.id,
          eventId: eventId || null,
          roomName: tokenResult.room_name,
          tokenExpiresAt: tokenResult.token_expires_at ?? null,
          delayMs,
          source,
        });
        dailyTokenRefreshTimerRef.current = setTimeout(() => {
          dailyTokenRefreshTimerRef.current = null;
          void recoverDailyTokenAndRejoin("daily_token_refresh_before_expiry");
        }, delayMs);
      };
      const recoverDailyTokenAndRejoin = async (
        sourceAction: DailyTokenRefreshSourceAction,
        cause?: unknown,
      ): Promise<boolean> => {
        if (dailyTokenRecoveryInFlightRef.current) return false;
        if (String(phaseRef.current) === "ended" || callRef.current !== call)
          return false;

        dailyTokenRecoveryInFlightRef.current = true;
        clearDailyTokenRefreshTimer();
        setIsConnecting(true);
        setCallError(null);
        vdbg("daily_token_rejoin_start", {
          sessionId,
          userId: user.id,
          eventId: eventId || null,
          roomName: tokenResult.room_name,
          sourceAction,
        });
        try {
          const refreshed = await refreshDailyTokenForJoin(sourceAction, cause);
          if (
            !refreshed ||
            callRef.current !== call ||
            String(phaseRef.current) === "ended"
          ) {
            const refreshFailure = getLastDailyTokenRefreshFailure();
            if (!refreshed && refreshFailure?.kind === "terminal") {
              vdbg("daily_token_refresh_terminal_truth", {
                sessionId,
                userId: user.id,
                eventId: eventId || null,
                roomName: tokenResult.room_name,
                sourceAction,
                error: refreshFailure.error,
                phase: refreshFailure.phase,
              });
              clearDailyTokenRefreshTimer();
              setCallError(
                "This video room has closed. Checking the latest date status...",
              );
              void cleanupTerminalDailyCall(
                call,
                "daily_token_refresh_terminal",
              );
              void refetchVideoSession();
            } else if (!refreshed && refreshFailure?.kind === "rate_limited") {
              const retryAfterMs = refreshFailure.retryAfterMs ?? 30_000;
              vdbg("daily_token_refresh_rate_limited", {
                sessionId,
                userId: user.id,
                eventId: eventId || null,
                roomName: tokenResult.room_name,
                sourceAction,
                error: refreshFailure.error,
                retryAfterMs,
              });
              dailyTokenRefreshTimerRef.current = setTimeout(() => {
                dailyTokenRefreshTimerRef.current = null;
                void recoverDailyTokenAndRejoin(sourceAction, cause);
              }, retryAfterMs);
              setCallError("Connection interrupted. Reconnecting...");
            }
            setIsConnecting(false);
            return false;
          }
          try {
            await call.leave();
          } catch (leaveError) {
            vdbg("daily_token_rejoin_leave_failed", {
              sessionId,
              userId: user.id,
              eventId: eventId || null,
              roomName: tokenResult.room_name,
              sourceAction,
              error:
                leaveError instanceof Error
                  ? { name: leaveError.name, message: leaveError.message }
                  : String(leaveError),
            });
          }
          await call.join({
            url: tokenResult.room_url,
            token: tokenResult.token,
          });
          if (
            nativeDailyCallSingletonState.sharedDailyCallEntry?.sessionId === sessionId &&
            nativeDailyCallSingletonState.sharedDailyCallEntry.call === call
          ) {
            nativeDailyCallSingletonState.sharedDailyCallEntry.state = "joined";
            nativeDailyCallSingletonState.sharedDailyCallEntry.joinPromise = null;
            nativeDailyCallSingletonState.sharedDailyCallEntry.lastError = null;
          }
          setLocalInDailyRoom(true);
          setAwaitingFirstConnect(false);
          setIsConnecting(false);
          setCallError(null);
          requestReconnectSyncRef.current("daily_token_rejoin");
          scheduleDailyTokenRefresh("daily_token_rejoin_success");
          vdbg("daily_token_rejoin_success", {
            sessionId,
            userId: user.id,
            eventId: eventId || null,
            roomName: tokenResult.room_name,
            sourceAction,
            tokenExpiresAt: tokenResult.token_expires_at ?? null,
          });
          return true;
        } catch (error) {
          vdbg("daily_token_rejoin_failed", {
            sessionId,
            userId: user.id,
            eventId: eventId || null,
            roomName: tokenResult.room_name,
            sourceAction,
            error:
              error instanceof Error
                ? { name: error.name, message: error.message }
                : String(error),
          });
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_FAILURE, {
            platform: "native",
            session_id: sessionId,
            event_id: eventId || null,
            source_surface: "video_date_daily",
            source_action: sourceAction,
            code: "daily_token_rejoin_failed",
            reason_code: "daily_token_rejoin_failed",
            failure_class: classifyDailyRoomTokenFailureClass("network"),
            retryable: true,
            attempt_count: 1,
          });
          setCallError("Connection interrupted. Reconnecting...");
          setIsConnecting(false);
          requestReconnectSyncRef.current("daily_token_rejoin_failed");
          return false;
        } finally {
          dailyTokenRecoveryInFlightRef.current = false;
        }
      };
      recoverNativeDailyTokenRef.current = recoverDailyTokenAndRejoin;
      let joinPromise: Promise<void> | null = null;
      const markSharedJoinInFlight = () => {
        if (!joinPromise) return;
        if (
          nativeDailyCallSingletonState.sharedDailyCallEntry?.sessionId !== sessionId ||
          nativeDailyCallSingletonState.sharedDailyCallEntry.call !== call
        )
          return;
        nativeDailyCallSingletonState.sharedDailyCallEntry.state = "joining";
        nativeDailyCallSingletonState.sharedDailyCallEntry.joinPromise = joinPromise;
        nativeDailyCallSingletonState.sharedDailyCallEntry.joinStartedAtMs =
          dailyJoinStartedAtMsRef.current ?? Date.now();
        nativeDailyCallSingletonState.sharedDailyCallEntry.lastError = null;
      };
      vdbg("prejoin_state_isConnecting", {
        value: true,
        sessionId,
        userId: user.id,
        step: "daily_call_object_created",
        roomName: tokenResult.room_name,
        captureProfile: callCaptureProfile,
      });
      setIsConnecting(true);

      try {
        currentStep = setPrejoinStep("daily_join");
        const dailyJoinStartedAtMs = Date.now();
        dailyJoinStartedAtMsRef.current = dailyJoinStartedAtMs;
        const dailyCallInstanceId = `${entryAttemptId ?? sessionId}:${prejoinAttemptRef.current?.attemptId ?? joinAttemptNonce}`;
        const entryOwner = getVideoDateEntryOwner(sessionId, user.id);
        updateVideoDateEntryOwnerState({
          sessionId,
          userId: user.id,
          ownerId: entryOwner?.ownerId ?? null,
          state: "joining",
          source: "daily_join_started",
          roomName: tokenResult.room_name,
          entryAttemptId: entryAttemptId ?? entryOwner?.entryAttemptId ?? null,
          videoDateTraceId:
            videoDateTraceId ?? entryOwner?.videoDateTraceId ?? null,
          callInstanceId: dailyCallInstanceId,
        });
        updateVideoDateDailyOwnerState({
          sessionId,
          userId: user.id,
          ownerId: entryOwner?.ownerId ?? null,
          roomName: tokenResult.room_name,
          state: "joining",
          source: "daily_join_started",
          entryAttemptId: entryAttemptId ?? entryOwner?.entryAttemptId ?? null,
          videoDateTraceId:
            videoDateTraceId ?? entryOwner?.videoDateTraceId ?? null,
          callInstanceId: dailyCallInstanceId,
        });
        const prepareToJoinStartMs = preparedEntryPrepareToJoinStartMs(
          activePreparedEntryCacheRef.current,
          dailyJoinStartedAtMs,
        );
        const joinStartLatencyContext = recordReadyGateToDateLatencyCheckpoint({
          sessionId,
          platform: "native",
          eventId: eventId || null,
          sourceSurface: "video_date_daily",
          checkpoint: "daily_join_started",
          nowMs: dailyJoinStartedAtMs,
          attemptCount: preparedJoinRetryUsedRef.current ? 2 : 1,
          entryAttemptId,
          videoDateTraceId,
          cachedPrepareEntry: activePreparedEntryCacheHitRef.current,
          providerVerifySkipped:
            activePreparedEntryCacheRef.current?.value
              .provider_verify_skipped ?? providerVerifySkippedRef.current,
        });
        trackEvent(
          LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
          buildReadyGateToDateLatencyPayload({
            context: joinStartLatencyContext,
            checkpoint: "daily_join_started",
            sourceAction: preparedJoinRetryUsedRef.current
              ? "daily_join_retry_started"
              : "daily_join_started",
            outcome: "success",
            attemptCount: preparedJoinRetryUsedRef.current ? 2 : 1,
          }),
        );
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, "daily_join_start", {
          session_id: sessionId,
          user_id: user?.id ?? null,
          room_name: tokenResult.room_name,
          capture_profile: callCaptureProfile,
          prepare_to_join_start_ms: prepareToJoinStartMs,
          entry_attempt_id: entryAttemptId,
          video_date_trace_id: videoDateTraceId,
        });
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_JOIN_STARTED, {
          platform: "native",
          session_id: sessionId,
          event_id: eventId || null,
          source_surface: "video_date_daily",
          source_action: preparedJoinRetryUsedRef.current
            ? "daily_join_retry_started"
            : "daily_join_started",
          capture_profile: callCaptureProfile,
          prepareToJoinStartMs,
          duration_ms: prepareToJoinStartMs,
          latency_bucket: bucketVideoDateLatencyMs(prepareToJoinStartMs),
          attempt_count: preparedJoinRetryUsedRef.current ? 2 : 1,
          cached_prepare_entry: activePreparedEntryCacheHitRef.current,
          entry_attempt_id: entryAttemptId,
          video_date_trace_id: videoDateTraceId,
          daily_prewarm_consumed: dailyPrewarmConsumedForJoin,
          prewarmed_join_in_flight: Boolean(
            prewarmedJoinPromiseForShared && !prewarmedAlreadyJoined,
          ),
          prewarmed_already_joined: prewarmedAlreadyJoined,
          provider_verify_skipped: tokenResult.provider_verify_skipped ?? null,
        });
        videoDateDailyDiagnostic("daily_call_join_start", {
          session_id: sessionId,
          room_name: tokenResult.room_name,
          capture_profile: callCaptureProfile,
          entry_attempt_id: entryAttemptId,
          video_date_trace_id: videoDateTraceId,
        });
        beginBootstrapTiming("daily_join", {
          room_name: tokenResult.room_name,
        });
        beginBootstrapTiming("first_ice_connected", {
          room_name: tokenResult.room_name,
        });
        beginBootstrapTiming("first_remote_participant", {
          room_name: tokenResult.room_name,
        });
        beginBootstrapTiming("first_playable_remote_media", {
          room_name: tokenResult.room_name,
        });
        addVideoDateBreadcrumb("Joining call", "info", { sessionId });
        vdbg("prejoin_step_prejoin_daily_join_before", {
          sessionId,
          userId: user.id,
          roomName: tokenResult.room_name,
          captureProfile: callCaptureProfile,
          hasRoomUrl: Boolean(tokenResult.room_url),
          hasToken: Boolean(tokenResult.token),
          entryAttemptId,
          videoDateTraceId,
        });
        const joinDailyCall = async () => {
          const joinCurrentCallWithToken = async () => {
            try {
              await call.join({
                url: tokenResult.room_url,
                token: tokenResult.token,
              });
            } catch (joinError) {
              if (
                adviseVideoDateTokenRecovery({
                  trigger: "auth_error",
                  error: joinError,
                  platform: "native",
                  surface: "video_date",
                }).action === "refresh_token"
              ) {
                const refreshed = await refreshDailyTokenForJoin(
                  "daily_token_refresh_join_retry",
                  joinError,
                );
                if (refreshed) {
                  await call.join({
                    url: tokenResult.room_url,
                    token: tokenResult.token,
                  });
                  return;
                }
              }
              throw joinError;
            }
          };
          try {
            if (dailyPrewarmConsumedForJoin && prewarmedAlreadyJoined) {
              vdbg("daily_join_skipped_prewarmed_already_joined", {
                sessionId,
                userId: user.id,
                roomName: tokenResult.room_name,
                joinSource: prewarmedJoinSource,
              });
              return;
            }
            if (dailyPrewarmConsumedForJoin && prewarmedJoinPromiseForShared) {
              await prewarmedJoinPromiseForShared;
              vdbg("daily_join_completed_by_prewarm_inflight", {
                sessionId,
                userId: user.id,
                roomName: tokenResult.room_name,
                joinSource: prewarmedJoinSource,
              });
              return;
            }
            await joinCurrentCallWithToken();
            return;
          } catch (joinError) {
            if (
              callCaptureProfile !== "ideal" ||
              !isNativeVideoDateCameraConstraintError(joinError)
            ) {
              throw joinError;
            }
            vdbg("daily_call_join_constraint_fallback", {
              sessionId,
              userId: user.id,
              roomName: tokenResult.room_name,
              fromCaptureProfile: callCaptureProfile,
              toCaptureProfile: "fallback",
              error:
                joinError instanceof Error
                  ? { name: joinError.name, message: joinError.message }
                  : String(joinError),
            });
            videoDateDailyDiagnostic("daily_call_join_constraint_fallback", {
              session_id: sessionId,
              room_name: tokenResult.room_name,
              from_capture_profile: callCaptureProfile,
              to_capture_profile: "fallback",
            });
            try {
              await call.leave();
            } catch {
              /* best effort */
            }
            try {
              await destroyNativeVideoDateDailyCall(
                call,
                "daily_join_constraint_fallback",
                {
                  sessionId,
                  userId: user.id,
                  roomName: tokenResult.room_name,
                },
              );
            } catch {
              /* best effort */
            }
            detachCallListeners("daily_join_constraint_fallback");
            releaseSharedCallIfOwned(call, "daily_join_constraint_fallback");
            callRef.current = null;
            callCaptureProfile = "fallback";
            const fallbackCall = await installDailyCall(callCaptureProfile);
            if (!fallbackCall) {
              throw new Error(
                guardedCreateFailure ??
                  "native_daily_create_failed_after_constraint_fallback",
              );
            }
            call = fallbackCall;
            markSharedJoinInFlight();
            await joinCurrentCallWithToken();
          }
        };
        joinPromise = joinDailyCall();
        markSharedJoinInFlight();
        await joinPromise;
        await ensureNativeFrontCameraIntent(call, {
          sessionId,
          roomName: tokenResult.room_name,
          captureProfile: callCaptureProfile,
        });
        if (
          nativeDailyCallSingletonState.sharedDailyCallEntry?.sessionId === sessionId &&
          nativeDailyCallSingletonState.sharedDailyCallEntry.call === call
        ) {
          nativeDailyCallSingletonState.sharedDailyCallEntry.state = "joined";
          nativeDailyCallSingletonState.sharedDailyCallEntry.joinPromise = null;
          nativeDailyCallSingletonState.sharedDailyCallEntry.lastError = null;
        }
        const joinDurationMs = Date.now() - dailyJoinStartedAtMs;
        endBootstrapTiming("daily_join", {
          ok: true,
          room_name: tokenResult.room_name,
        });
        prejoinMark("daily_join_completed");
        videoDateLaunchBreadcrumb("prejoin_pipeline_total", {
          session_id: sessionId,
          user_id: user.id,
          duration_ms: Date.now() - prejoinPipelineStart,
        });
        vdbg("prejoin_step_prejoin_daily_join_after", {
          sessionId,
          userId: user.id,
          ok: true,
          cancelled,
          roomName: tokenResult.room_name,
          captureProfile: callCaptureProfile,
          entryAttemptId,
          videoDateTraceId,
        });
        if (cancelled) {
          vdbg("prejoin_step_prejoin_daily_join_completed_after_cancellation", {
            sessionId,
            userId: user.id,
            roomName: tokenResult.room_name,
            ...prejoinLogContext(),
          });
        }
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, "daily_join_ok", {
          session_id: sessionId,
          user_id: user?.id ?? null,
          room_name: tokenResult.room_name,
          capture_profile: callCaptureProfile,
          join_duration_ms: joinDurationMs,
          entry_attempt_id: entryAttemptId,
          video_date_trace_id: videoDateTraceId,
        });
        const joinSuccessLatencyContext =
          recordReadyGateToDateLatencyCheckpoint({
            sessionId,
            platform: "native",
            eventId: eventId || null,
            sourceSurface: "video_date_daily",
            checkpoint: "daily_join_success",
            nowMs: Date.now(),
            attemptCount: preparedJoinRetryUsedRef.current ? 2 : 1,
            entryAttemptId,
            videoDateTraceId,
            cachedPrepareEntry: activePreparedEntryCacheHitRef.current,
            providerVerifySkipped:
              activePreparedEntryCacheRef.current?.value
                .provider_verify_skipped ?? providerVerifySkippedRef.current,
          });
        const joinSuccessPayload = buildReadyGateToDateLatencyPayload({
          context: joinSuccessLatencyContext,
          checkpoint: "daily_join_success",
          sourceAction: "daily_join_success",
          outcome: "success",
          attemptCount: preparedJoinRetryUsedRef.current ? 2 : 1,
        });
        trackEvent(
          LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
          joinSuccessPayload,
        );
        trackEvent(
          LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_COMPLETED,
          joinSuccessPayload,
        );
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_JOIN_SUCCESS, {
          platform: "native",
          session_id: sessionId,
          event_id: eventId || null,
          source_surface: "video_date_daily",
          source_action: "daily_join_success",
          capture_profile: callCaptureProfile,
          joinDurationMs,
          duration_ms: joinDurationMs,
          latency_bucket: bucketVideoDateLatencyMs(joinDurationMs),
          attempt_count: preparedJoinRetryUsedRef.current ? 2 : 1,
          bothReadyToDailyJoinMs: joinSuccessPayload.bothReadyToDailyJoinMs,
          prepareToJoinStartMs,
          cached_prepare_entry: activePreparedEntryCacheHitRef.current,
          entry_attempt_id: entryAttemptId,
          video_date_trace_id: videoDateTraceId,
          daily_prewarm_consumed: dailyPrewarmConsumedForJoin,
          prewarmed_join_in_flight: Boolean(
            prewarmedJoinPromiseForShared && !prewarmedAlreadyJoined,
          ),
          prewarmed_already_joined: prewarmedAlreadyJoined,
          provider_verify_skipped: tokenResult.provider_verify_skipped ?? null,
        });
        const participants = call.participants();
        const allIds = participants ? Object.keys(participants).length : 0;
        const remotes = participants
          ? Object.values(participants).filter(
              (p) => !(p as unknown as { local?: boolean }).local,
            )
          : [];
        videoDateDailyDiagnostic("daily_call_join_success", {
          session_id: sessionId,
          room_name: tokenResult.room_name,
          capture_profile: callCaptureProfile,
          participant_keys_count: allIds,
          remote_count: remotes.length,
        });
        vdbg("prejoin_state_localInDailyRoom", {
          value: true,
          sessionId,
          userId: user.id,
          step: currentStep,
          roomName: tokenResult.room_name,
        });
        setLocalInDailyRoom(true);
        scheduleDailyTokenRefresh("daily_join_success");
        activeNativeDailyCallIdentityRef.current = {
          sessionId,
          userId: user.id,
          ownerId: entryOwner?.ownerId ?? null,
          callInstanceId: dailyCallInstanceId,
          entryAttemptId: entryAttemptId ?? entryOwner?.entryAttemptId ?? null,
          videoDateTraceId:
            videoDateTraceId ?? entryOwner?.videoDateTraceId ?? null,
        };
        startDailyAliveHeartbeat({
          sessionId,
          userId: user.id,
          roomName: tokenResult.room_name,
          entryAttemptId,
          videoDateTraceId,
          callInstanceId: dailyCallInstanceId,
          source: "daily_join_success",
        });
        const buildProviderBackedDailyJoinedArgs = () => {
          const providerSessionId = readNativeDailyProviderSessionId(call);
          const meetingState = safeNativeDailyMeetingState(call);
          const providerBackedJoined =
            meetingState === "joined-meeting" && Boolean(providerSessionId);
          const entryOwner = getVideoDateEntryOwner(sessionId, user.id);
          const ownerState = providerBackedJoined
            ? "joined"
            : meetingState === "left-meeting" || meetingState === "error"
              ? "lost"
              : "joining";
          return {
            providerBackedJoined,
            providerSessionId,
            meetingState,
            ownerId: entryOwner?.ownerId ?? null,
            ownerState,
            args: {
              p_session_id: sessionId,
              p_owner_id: entryOwner?.ownerId ?? null,
              p_call_instance_id: dailyCallInstanceId,
              p_provider_session_id: providerSessionId,
              p_entry_attempt_id:
                entryAttemptId ?? entryOwner?.entryAttemptId ?? null,
              p_owner_state: ownerState,
            },
          };
        };
        const initialJoinedProof = buildProviderBackedDailyJoinedArgs();
        if (__DEV__) {
          vdbg("mark_video_date_daily_joined_before", {
            sessionId,
            userId: user.id,
            providerBackedJoined: initialJoinedProof.providerBackedJoined,
            providerSessionId: initialJoinedProof.providerSessionId,
            meetingState: initialJoinedProof.meetingState,
            ownerId: initialJoinedProof.ownerId,
            ownerState: initialJoinedProof.ownerState,
          });
        }
        void markDailyJoinedWithBackoff({
          confirm: async (attempt) => {
            const joinedProof = buildProviderBackedDailyJoinedArgs();
            if (!joinedProof.providerBackedJoined) {
              const retryable = joinedProof.ownerState !== "lost";
              const payload = {
                ok: false,
                error: "provider_presence_missing",
                retryable,
                provider_presence_required: true,
                provider_backed_current: false,
                provider_session_id: joinedProof.providerSessionId,
                owner_id: joinedProof.ownerId,
                owner_state: joinedProof.ownerState,
                meeting_state: joinedProof.meetingState,
              };
              if (__DEV__) {
                vdbg("mark_video_date_daily_joined_after", {
                  sessionId,
                  userId: user.id,
                  attempt,
                  ok: false,
                  code: "provider_presence_missing",
                  payload,
                  error: null,
                });
              }
              return {
                ok: false,
                code: "provider_presence_missing",
                retryable,
                payload,
              };
            }
            const { data: joinedData, error: joinedError } = await supabase.rpc(
              "mark_video_date_daily_joined",
              joinedProof.args,
            );
            const payload =
              joinedData &&
              typeof joinedData === "object" &&
              !Array.isArray(joinedData)
                ? (joinedData as Record<string, unknown>)
                : null;
            const ok = !joinedError && payload?.ok === true;
            const code =
              joinedError?.code ?? videoDateLifecycleRpcCode(payload) ?? null;
            const terminalSurvey =
              videoDateLifecycleRpcIndicatesTerminalSurvey(payload);
            const terminalStop =
              terminalSurvey ||
              videoDateLifecycleRpcIndicatesTerminalStop(payload);
            if (__DEV__) {
              vdbg("mark_video_date_daily_joined_after", {
                sessionId,
                userId: user.id,
                attempt,
                ok,
                code,
                providerBackedJoined: joinedProof.providerBackedJoined,
                providerSessionId: joinedProof.providerSessionId,
                meetingState: joinedProof.meetingState,
                ownerId: joinedProof.ownerId,
                ownerState: joinedProof.ownerState,
                error: joinedError
                  ? { code: joinedError.code, message: joinedError.message }
                  : null,
              });
            }
            if (terminalStop) {
              clearDailyAliveHeartbeatTimer("daily_joined_terminal_truth");
            }
            if (terminalSurvey) {
              void openNativePostDateSurveyFromTerminalTruth(
                "daily_joined_terminal_survey_truth",
              );
            }
            return {
              ok,
              code,
              retryable: joinedError
                ? true
                : videoDateLifecycleRpcRetryable(payload),
              error: joinedError ?? undefined,
              payload: joinedData ?? null,
            };
          },
          onAttemptResult: ({ attempt, ok, code, retryable, willRetry }) => {
            if (!ok && attempt === 1) {
              setCallError("Keeping your date state in sync...");
              trackEvent(
                LobbyPostDateEvents.MARK_VIDEO_DATE_DAILY_JOINED_FAILED,
                {
                  platform: "native",
                  session_id: sessionId,
                  event_id: eventId || null,
                  code,
                  retryable,
                  will_retry: willRetry,
                  entry_attempt_id: entryAttemptId,
                  video_date_trace_id: videoDateTraceId,
                },
              );
            }
            if (__DEV__ && attempt > 1) {
              vdbg("mark_video_date_daily_joined_retry_after_failure", {
                sessionId,
                userId: user.id,
                attempt,
                ok,
                code,
                retryable,
                willRetry,
              });
            }
          },
        }).then((result) => {
          if (!result.ok) {
            void emitNativeVideoDateClientStuckState({
              sessionId,
              eventName: "daily_join_confirmation_failed",
              payload: {
                source_surface: "video_date_daily",
                source_action: "mark_video_date_daily_joined",
                reason_code: result.code ?? "unknown",
                code: result.code ?? "unknown",
                retryable: result.retryable,
                exhausted: result.exhausted,
                attempt_count: result.attempts,
                entry_attempt_id: entryAttemptId ?? undefined,
                video_date_trace_id: videoDateTraceId ?? undefined,
              },
            });
          }
          if (result.ok) {
            setCallError(null);
            void refetchVideoSession();
          }
        });
        const local = participants?.local;
        if (local) {
          localParticipantRef.current = local;
          setLocalParticipant(local);
          applyLocalMediaUiFromParticipant(local, {
            setIsVideoOff,
            setIsMuted,
          });
        }
        vdbg("prejoin_state_isConnecting", {
          value: false,
          sessionId,
          userId: user.id,
          step: currentStep,
          roomName: tokenResult.room_name,
        });
        setIsConnecting(false);
        if (remotes.length > 0) {
          if (!firstRemoteParticipantTimedRef.current) {
            firstRemoteParticipantTimedRef.current = true;
            endBootstrapTiming("first_remote_participant", {
              source: "post_join_snapshot",
              participant_id:
                dailyParticipantId(remotes[0] as DailyParticipant) ?? "unknown",
              room_name: tokenResult.room_name,
            });
            const latencyContext = recordReadyGateToDateLatencyCheckpoint({
              sessionId,
              platform: "native",
              eventId: eventId || null,
              sourceSurface: "video_date_daily",
              checkpoint: "remote_seen",
              entryAttemptId,
              videoDateTraceId,
              cachedPrepareEntry: activePreparedEntryCacheHitRef.current,
              providerVerifySkipped:
                activePreparedEntryCacheRef.current?.value
                  .provider_verify_skipped ?? null,
            });
            const latencyPayload = buildReadyGateToDateLatencyPayload({
              context: latencyContext,
              checkpoint: "remote_seen",
              sourceAction: "post_join_snapshot",
              outcome: "success",
            });
            trackEvent(
              LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
              latencyPayload,
            );
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_REMOTE_SEEN, {
              platform: "native",
              session_id: sessionId,
              event_id: eventId || null,
              source_surface: "video_date_daily",
              source_action: "post_join_snapshot",
              source: "post_join_snapshot",
              duration_ms: latencyPayload.bothReadyToRemoteSeenMs,
              latency_bucket: latencyPayload.latency_bucket,
            });
          }
          clearFirstConnectWatchdog();
          vdbg("prejoin_state_awaitingFirstConnect", {
            value: false,
            sessionId,
            userId: user.id,
            step: currentStep,
            remoteCount: remotes.length,
          });
          setAwaitingFirstConnect(false);
          setPartnerEverJoined(true);
          const remote = remotes[0] as DailyParticipant;
          clearPartnerAwayAfterTransportGrace("post_join_snapshot");
          remoteParticipantRef.current = remote;
          resetNativeRemoteRenderRecovery(remote, "post_join_snapshot");
          setRemoteParticipant(remote);
          setIsPartnerDisconnected(false);
          videoDateDailyDiagnostic("first_remote_observed", {
            session_id: sessionId,
            room_name: tokenResult.room_name,
            source: "post_join_snapshot",
          });
          videoDateDailyDiagnostic(
            "remote_participant_promoted_from_post_join_snapshot",
            {
              session_id: sessionId,
              room_name: tokenResult.room_name,
              participant_id:
                dailyParticipantId(remotes[0] as DailyParticipant) ?? "unknown",
            },
          );
        } else {
          vdbg("prejoin_state_awaitingFirstConnect", {
            value: true,
            sessionId,
            userId: user.id,
            step: currentStep,
            remoteCount: remotes.length,
          });
          setAwaitingFirstConnect(true);
        }
      } catch (err) {
        if (
          nativeDailyCallSingletonState.sharedDailyCallEntry?.sessionId === sessionId &&
          nativeDailyCallSingletonState.sharedDailyCallEntry.call === call
        ) {
          nativeDailyCallSingletonState.sharedDailyCallEntry.state = "failed";
          nativeDailyCallSingletonState.sharedDailyCallEntry.joinPromise = null;
          nativeDailyCallSingletonState.sharedDailyCallEntry.lastError = summarizeSharedDailyError(err);
        }
        const preparedEntryAtFailure = activePreparedEntryCacheRef.current;
        endBootstrapTiming("daily_join", {
          ok: false,
          room_name: tokenResult.room_name,
          exception: true,
        });
        vdbg("prejoin_step_prejoin_daily_join_after", {
          sessionId,
          userId: user.id,
          ok: false,
          roomName: tokenResult.room_name,
          captureProfile: callCaptureProfile,
          error: err instanceof Error ? err.message : String(err),
          entryAttemptId:
            preparedEntryAtFailure?.entryAttemptId ?? entryAttemptId,
          videoDateTraceId:
            preparedEntryAtFailure?.value.video_date_trace_id ??
            videoDateTraceId,
        });
        vdbg("prejoin_step_prejoin_error", {
          sessionId,
          userId: user.id,
          step: currentStep,
          reason: "daily_join_exception",
        });
        videoDateDailyDiagnostic("daily_call_join_failure", {
          session_id: sessionId,
          room_name: tokenResult.room_name,
          capture_profile: callCaptureProfile,
        });
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, "daily_join_fail", {
          session_id: sessionId,
          user_id: user?.id ?? null,
          room_name: tokenResult.room_name,
          capture_profile: callCaptureProfile,
        });
        const failureContext = recordReadyGateToDateLatencyCheckpoint({
          sessionId,
          platform: "native",
          eventId: eventId || null,
          sourceSurface: "video_date_daily",
          checkpoint: "daily_join_failure",
          attemptCount: preparedJoinRetryUsedRef.current ? 2 : 1,
        });
        trackEvent(
          LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
          buildReadyGateToDateLatencyPayload({
            context: failureContext,
            checkpoint: "daily_join_failure",
            sourceAction: "daily_join_failure",
            outcome: "failure",
            reasonCode: "daily_join_failed",
            attemptCount: preparedJoinRetryUsedRef.current ? 2 : 1,
          }),
        );
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_JOIN_FAILURE, {
          platform: "native",
          session_id: sessionId,
          event_id: eventId || null,
          source_surface: "video_date_daily",
          source_action: "daily_join_failure",
          capture_profile: callCaptureProfile,
          reason: "daily_join_failed",
          reason_code: "daily_join_failed",
          entry_attempt_id:
            preparedEntryAtFailure?.entryAttemptId ?? entryAttemptId,
          video_date_trace_id:
            preparedEntryAtFailure?.value.video_date_trace_id ??
            videoDateTraceId,
        });
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_JOIN_FAILURE, {
          platform: "native",
          session_id: sessionId,
          event_id: eventId || null,
          source_surface: "video_date_daily",
          source_action: "daily_join_failure",
          capture_profile: callCaptureProfile,
          reason: "daily_join_failed",
          reason_code: "daily_join_failed",
          entry_attempt_id:
            preparedEntryAtFailure?.entryAttemptId ?? entryAttemptId,
          video_date_trace_id:
            preparedEntryAtFailure?.value.video_date_trace_id ??
            videoDateTraceId,
        });
        if (dailyPrewarmConsumedForJoin) {
          markNativeVideoDateDailyPrewarmFallback({
            sessionId,
            userId: user.id,
            eventId: eventId || null,
            reason: "daily_join_failed_after_prewarm_consumed",
          });
        }
        if (preparedEntryAtFailure && !preparedJoinRetryUsedRef.current) {
          preparedJoinRetryUsedRef.current = true;
          rejectPreparedVideoDateEntry(
            sessionId,
            user.id,
            "daily_join_failed",
            eventId || null,
          );
          try {
            await call.leave();
          } catch {
            /* best effort */
          }
          try {
            await destroyNativeVideoDateDailyCall(
              call,
              "daily_join_failed_prepare_retry",
              {
                sessionId,
                userId: user.id,
                roomName: tokenResult.room_name,
              },
            );
          } catch {
            /* best effort */
          }
          detachCallListeners("daily_join_failed_prepare_retry");
          releaseSharedCallIfOwned(call, "daily_join_failed_prepare_retry");
          callRef.current = null;
          activePreparedEntryCacheRef.current = null;
          activePreparedEntryCacheHitRef.current = null;
          dailyPrewarmConsumedForJoinRef.current = false;
          prewarmedAlreadyJoinedRef.current = false;
          prewarmedJoinInFlightRef.current = false;
          providerVerifySkippedRef.current = null;
          hasStartedJoinRef.current = false;
          setJoining(false);
          setIsConnecting(false);
          setJoinAttemptNonce((n) => n + 1);
          vdbg(
            "prejoin_step_prejoin_daily_join_retry_after_prepared_token_rejected",
            {
              sessionId,
              userId: user.id,
              roomName: tokenResult.room_name,
            },
          );
          return;
        }
        if (!cancelled) {
          Sentry.captureException(err, { extra: { sessionId } });
          vdbg("prejoin_state_callError", {
            value: "Failed to join. Please try again.",
            sessionId,
            userId: user.id,
            step: currentStep,
          });
          setCallError("Failed to join. Please try again.");
          vdbg("prejoin_state_preJoinFailed", {
            value: true,
            sessionId,
            userId: user.id,
            step: currentStep,
          });
          setPreJoinFailed(true);
          clearFirstConnectWatchdog();
          vdbg("prejoin_state_awaitingFirstConnect", {
            value: false,
            sessionId,
            userId: user.id,
            step: currentStep,
          });
          setAwaitingFirstConnect(false);
          vdbg("prejoin_state_isConnecting", {
            value: false,
            sessionId,
            userId: user.id,
            step: currentStep,
          });
          setIsConnecting(false);
          hasStartedJoinRef.current = false;
          vdbg("prejoin_state_hasStartedJoinRef", {
            value: false,
            sessionId,
            userId: user.id,
            step: currentStep,
          });
        }
        prejoinCompleted = !cancelled;
      }

      vdbg("prejoin_state_joining", {
        value: false,
        sessionId,
        userId: user.id,
        step: currentStep,
      });
      setJoining(false);
      prejoinCompleted = true;
      attemptState.completed = true;
    };

    const runPromise = run();
    prejoinPipelineEntry.promise = runPromise;
    void runPromise.finally(() => {
      if (nativeDailyCallSingletonState.sharedNativePrejoinPipelineEntry !== prejoinPipelineEntry) return;
      vdbg("native_prejoin_pipeline_release", {
        sessionId,
        userId: user.id,
        attemptId,
        completed: attemptState.completed,
        currentStep: attemptState.currentStep,
        cancellationReason: attemptState.cancellationReason,
        hasSharedCall: Boolean(nativeDailyCallSingletonState.sharedDailyCallEntry?.sessionId === sessionId),
      });
      nativeDailyCallSingletonState.sharedNativePrejoinPipelineEntry = null;
    });
    return () => {
      if (callRef.current) {
        vdbg("daily_call_listeners_preserved", {
          reason: "prejoin_effect_cleanup_live_call",
          sessionId,
          userId: user?.id ?? null,
          hasBoundCall: Boolean(boundCallRef.current),
          sameCall: boundCallRef.current === callRef.current,
        });
      } else {
        detachCallListeners("prejoin_effect_cleanup");
      }
      const cancellationReason = callRef.current
        ? "prejoin_effect_cleanup_live_call"
        : shouldPreservePrejoinAttemptOnCleanup(currentStep)
          ? "prejoin_effect_cleanup_preserve_in_flight"
          : "prejoin_effect_cleanup_without_call";
      attemptState.cancellationReason = cancellationReason;
      if (!prejoinCompleted) {
        vdbg("prejoin_step_prejoin_effect_cleanup", {
          sessionId,
          userId: user?.id ?? null,
          currentStep,
          attemptId,
          cancellationReason,
          hasCall: Boolean(callRef.current),
          hasStartedJoin: hasStartedJoinRef.current,
          roomAcquisitionStarted: attemptState.roomAcquisitionStarted,
        });
      }
      const sameSessionAndUser =
        latestDateRouteSessionIdRef.current === sessionId &&
        latestDateRouteUserIdRef.current === (user?.id ?? null) &&
        !latestDateRouteEndedRef.current;
      const preserveInFlight =
        sameSessionAndUser &&
        !callRef.current &&
        shouldPreservePrejoinAttemptOnCleanup(currentStep);
      if (preserveInFlight) {
        vdbg("prejoin_effect_cleanup_preserved_active_pipeline", {
          sessionId,
          userId: user?.id ?? null,
          currentStep,
          attemptId,
          cancellationReason,
          sameSessionAndUser,
          hasCall: false,
          hasStartedJoin: hasStartedJoinRef.current,
          roomAcquisitionStarted: attemptState.roomAcquisitionStarted,
        });
        return;
      }
      cancelled = true;
      if (!callRef.current) {
        if (shouldPreservePrejoinAttemptOnCleanup(currentStep)) {
          vdbg("prejoin_state_hasStartedJoinRef", {
            value: hasStartedJoinRef.current,
            sessionId,
            userId: user?.id ?? null,
            step: "cleanup_preserve_in_flight",
            ...prejoinLogContext(),
          });
        } else {
          hasStartedJoinRef.current = false;
          vdbg("prejoin_state_hasStartedJoinRef", {
            value: false,
            sessionId,
            userId: user?.id ?? null,
            step: "cleanup_without_call",
            ...prejoinLogContext(),
          });
        }
      }
    };
    // Prejoin owns a live Daily call pipeline; avoid restarting it for broad session/joining object identity churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    joinAttemptNonce,
    sessionId,
    user?.id,
    authLoading,
    sessionLoading,
    pathname,
    session?.id,
    session?.ended_at,
    dateEntryPermissionEligible,
    nativeSurfaceClientReady,
    sessionError,
    requestPermissions,
    clearFirstConnectWatchdog,
    clearDailyTokenRefreshTimer,
    startDailyAliveHeartbeat,
    clearPartnerAwayAfterTransportGrace,
    bindCallListeners,
    cleanupTerminalDailyCall,
    releaseSharedCallIfOwned,
    detachCallListeners,
    refetchVideoSession,
    recoverFromNotStartableDateTruth,
    claimNativeVideoDateSurface,
    resetNativeRemoteRenderRecovery,
    beginBootstrapTiming,
    endBootstrapTiming,
  ]);
}

export type NativeVideoDateStartCallApi = ReturnType<typeof useNativeVideoDateStartCall>;
