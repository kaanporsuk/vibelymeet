import {
  PreparedVideoDateEntryCacheEntry,
} from "@clientShared/matching/videoDatePrepareEntry";
import { useCallback, useRef } from "react";
import DailyIframe, {
  DailyCall,
  type DailyEvent,
  type DailyEventObject,
} from "@daily-co/daily-js";
import { toast } from "sonner";
import * as Sentry from "@sentry/react";
import { vdbg } from "@/lib/vdbg";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/analytics";
import {
  dailyVideoDateCallObjectOptions,
  dailyVideoDateCallObjectOptionsWithAppAcquiredMedia,
  videoDateWebMediaStreamConstraints,
} from "@/lib/dailyCallObjectConfig";
import {
  createDailyCallObjectGuarded,
  isTerminalDailyMeetingState,
} from "@/lib/dailyCallInstance";
import {
  consumeWebVideoDateDailyPrewarmWhenReady,
  hasLiveWebVideoDateDailyPrewarmAppMedia,
  hasPendingWebVideoDateDailyPrewarm,
  markWebVideoDateDailyPrewarmFallback,
  peekWebVideoDateDailyPrewarm,
} from "@/lib/videoDateDailyPrewarm";
import {
  consumePreparedVideoDateEntry,
  prepareVideoDateEntry,
  rejectPreparedVideoDateEntry,
} from "@/lib/videoDatePrepareEntry";
import { refreshVideoDateToken } from "@/lib/videoDateTokenRefresh";
import {
  isVideoDateDailyMeetingEnded,
  isVideoDateTokenRefreshRateLimited,
  isVideoDateTokenRefreshTerminal,
  videoDateTokenRefreshRetryAfterMs,
} from "@clientShared/matching/videoDatePublicApi";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";
import {
  buildReadyGateToDateLatencyPayload,
  bucketVideoDateLatencyMs,
  recordReadyGateToDateLatencyCheckpoint,
} from "@clientShared/observability/videoDateOperatorMetrics";
import { markDailyJoinedWithBackoff } from "@clientShared/matching/dailyJoinedConfirmation";
import {
  classifyDailyRoomTokenFailureClass,
  type DailyRoomFailureKind,
} from "@clientShared/matching/dailyRoomFailure";
import { shouldRefreshDailyTokenBeforeReconnect } from "@clientShared/matching/videoDatePhase4";
import {
  getVideoDateEntryOwner,
  updateVideoDateDailyOwnerState,
  updateVideoDateEntryOwnerState,
} from "@clientShared/matching/videoDateEntryOwner";
import { adviseVideoDateTokenRecovery } from "@clientShared/matching/videoDateRecoveryAdvisor";
import {
  VIDEO_DATE_WEB_CAPTURE_PROFILE_ORDER,
  isVideoDateCameraConstraintError,
  type VideoDateWebMediaCaptureProfile,
} from "@clientShared/matching/videoDateMediaContract";
import { classifyMediaPermissionErrorWithBrowserState } from "@clientShared/media/mediaPermissionResult";
import { parseVideoDateCameraSwitchRenderHint } from "@clientShared/matching/videoDateCameraSwitchRenderHint";
import { fetchVideoDateSessionRow } from "@/lib/videoDateSessionRow";
import {
  videoSessionHasEncounterExposureTruth,
  videoSessionHasPostDateSurveyTruth,
} from "@clientShared/matching/activeSession";
import {
  videoDateLifecycleRpcCode,
  videoDateLifecycleRpcIndicatesTerminalStop,
  videoDateLifecycleRpcIndicatesTerminalSurvey,
  videoDateLifecycleRpcRetryable,
} from "@clientShared/matching/videoDateLifecycleRpc";
import {
  buildStreamFromParticipant,
  createRemotePlaybackState,
  DAILY_TRANSPORT_RECONNECT_GRACE_MS,
  firstLiveTrack,
  FIRST_REMOTE_TIMEOUT_MS,
  getLiveVideoDateMediaTracks,
  getTrackIdsKey,
  isInvokeTimeoutError,
  LiveVideoDateMediaTracks,
  PREPARE_DATE_ENTRY_RETRY_DELAYS_MS,
  readDailyProviderSessionId,
  readRemoteRenderFrameState,
  REMOTE_CAMERA_SWITCH_FRESH_FRAME_TIMEOUT_MS,
  REMOTE_CAMERA_SWITCH_RENDER_WATCH_TTL_MS,
  requireLiveVideoDateMediaTracks,
  safeMeetingState,
  sleep,
  START_CALL_IN_FLIGHT_WAIT_POLL_MS,
  START_CALL_IN_FLIGHT_WAIT_TIMEOUT_MS,
  stopMediaStreamTracks,
  summarizeVideoTrackSettings,
  summarizeWebRuntime,
  tierFromNetworkQualityEvent,
  VideoDateMediaPromptIntent,
  VIDEO_DATE_PREJOIN_TIMEOUT_MS,
  waitForDailyMeetingState,
  WEB_DAILY_CALL_SINGLETON_JOIN_WAIT_MS,
  WEB_VIDEO_DATE_DAILY_GUARD_CREATE_MAX_ATTEMPTS,
  WEB_VIDEO_DATE_DAILY_GUARD_CREATE_RETRY_BASE_MS,
  withTimeout,
} from "@/lib/daily/webDailyMediaHelpers";
import {
  consumeWebDailyCallSingleton,
  getWebVideoDateStartGateEntry,
  hasReusableWebDailyCallSingleton,
  registerWebVideoDateStartGateEntry,
  VideoCallStartFailure,
  VideoCallStartResult,
} from "@/lib/daily/webDailyCallSingleton";
import type { VideoCallSharedRuntime } from "./videoCallRuntime";
import type { DailyAliveHeartbeatApi } from "./useDailyAliveHeartbeat";
import type { RemoteRenderPipelineApi } from "./useRemoteRenderPipeline";
import type { VideoDateMediaPreflightApi } from "./useVideoDateMediaPreflight";
import type { DailyCallCleanupApi } from "./useDailyCallCleanup";

/**
 * Start-call pipeline concern of the web Video Date call (Video Date
 * rebuild PR 7.5 extraction; bodies verbatim from src/hooks/useVideoCall.ts).
 *
 * Owns the per-session/user start gate, truth fetch, room acquisition,
 * token refresh/rejoin recovery, Daily call-object creation/singleton
 * reuse, the per-attempt Daily event listener wiring, join execution, and
 * provider-backed joined proof. `startCall` is intentionally one
 * per-attempt closure: its event handlers capture attempt-locals, and
 * splitting that capture is the regression class this rebuild avoids.
 */

type VideoCallStartOptions = {
  internalRetry?: boolean;
  mediaPromptIntent?: VideoDateMediaPromptIntent;
  skipStartGate?: boolean;
};

type VideoDateTruthRow = {
  id: string;
  event_id: string | null;
  ended_at: string | null;
  ended_reason?: string | null;
  state: string | null;
  phase: string | null;
  entry_started_at: string | null;
  date_started_at?: string | null;
  daily_room_name: string | null;
  daily_room_url?: string | null;
  ready_gate_status?: string | null;
  ready_gate_expires_at?: string | null;
  participant_1_joined_at?: string | null;
  participant_2_joined_at?: string | null;
  participant_1_remote_seen_at?: string | null;
  participant_2_remote_seen_at?: string | null;
};

type DailyRoomSuccessResponse = {
  room_name: string;
  room_url: string;
  token: string;
  token_expires_at?: string | null;
  entry_attempt_id?: string | null;
  video_date_trace_id?: string | null;
  reused_room?: boolean;
  provider_room_recreated?: boolean;
  provider_verify_skipped?: boolean;
};

type UseVideoDateStartCallDeps = VideoCallSharedRuntime &
  Pick<
    DailyAliveHeartbeatApi,
    | "clearDailyAliveHeartbeatTimer"
    | "clearDailyEventListeners"
    | "clearDailyTokenRefreshTimer"
    | "startDailyAliveHeartbeat"
  > &
  Pick<
    RemoteRenderPipelineApi,
    | "attachTracks"
    | "clearFirstRemoteWatchdog"
    | "clearRemoteRenderValidation"
    | "forceRemoteMediaReattach"
    | "logTrackMounted"
    | "needsTrackReattach"
    | "resetRemoteRenderRecoveryAttempts"
    | "resetRemoteRenderRecoveryForParticipant"
    | "scheduleRemoteRenderValidation"
  > &
  Pick<
    VideoDateMediaPreflightApi,
    "preflightMediaPermission" | "releaseAppAcquiredMedia"
  > &
  Pick<DailyCallCleanupApi, "cleanupCallObject" | "clearReconnectGraceTimers">;

export function useVideoDateStartCall(deps: UseVideoDateStartCallDeps) {
  const {
    activeCallSessionIdRef,
    activeDailyCallIdentityRef,
    activePreparedEntryCacheHitRef,
    activePreparedEntryCacheRef,
    activeRemoteCameraSwitchRenderWatchRef,
    appAcquiredMediaRef,
    attachTracks,
    callObjectRef,
    captureProfileRef,
    cleanupCallObject,
    clearDailyAliveHeartbeatTimer,
    clearDailyEventListeners,
    clearDailyTokenRefreshTimer,
    clearFirstRemoteWatchdog,
    clearReconnectGraceTimers,
    clearRemoteRenderValidation,
    clearSameSessionDailyContinuity,
    dailyEventListenerCleanupsRef,
    dailyJoinStartedAtMsRef,
    dailyListenerGenerationRef,
    dailyMeetingState,
    dailyTokenRecoveryInFlightRef,
    dailyTokenRefreshTimerRef,
    firstRemoteObservedRef,
    firstRemoteWatchdogRef,
    forceRemoteMediaReattach,
    lastDailyPrewarmConsumedRef,
    lastLocalStreamRef,
    lastLocalTrackIdsRef,
    lastMediaHandoffMissReasonRef,
    lastMediaHandoffUsedRef,
    lastPrewarmedAlreadyJoinedRef,
    lastDailyPrewarmFallbackReasonRef,
    lastPrewarmedJoinInFlightRef,
    lastProviderVerifySkippedRef,
    lastRemoteCameraSwitchHintIdRef,
    lastRemoteRenderParticipantIdRef,
    lastRemoteStreamRef,
    lastRemoteTrackIdsRef,
    latchSameSessionDailyContinuity,
    latestLocalParticipantRef,
    latestRemoteParticipantRef,
    localVideoReadyTrackedRef,
    localVideoRef,
    logTrackMounted,
    needsTrackReattach,
    optionsRef,
    playbackBlockedRef,
    preflightMediaPermission,
    reconnectGraceActiveRef,
    reconnectGraceTickerRef,
    reconnectGraceTimeoutRef,
    reconnectPartnerAwayTriggeredRef,
    reconnectRecoveryResetTimeoutRef,
    reconnectSyncRequestedRef,
    releaseAppAcquiredMedia,
    remoteFirstFrameTrackedRef,
    remoteVideoRef,
    resetRemoteRenderRecoveryAttempts,
    resetRemoteRenderRecoveryForParticipant,
    roomNameRef,
    scheduleRemoteRenderValidation,
    setCaptureProfile,
    setDailyMeetingState,
    setDailyReconnectState,
    setHasPermission,
    setIsConnected,
    setIsConnecting,
    setLocalInDailyRoom,
    setLocalStream,
    setMediaPermissionError,
    setMediaPermissionResult,
    setNetworkTier,
    setPeerMissing,
    setReconnectGraceTimeLeft,
    setRemotePlayback,
    startDailyAliveHeartbeat,
  } = deps;

  const peerMissingTruthRefreshCountRef = useRef(0);
  const startAttemptNonceRef = useRef(0);
  const startCallInFlightSessionRef = useRef<string | null>(null);

  const fetchVideoDateTruth = useCallback(async (sessionId: string) => {
    const { data, error } = await fetchVideoDateSessionRow(sessionId, { fresh: true });
    return {
      truth: (data as VideoDateTruthRow | null) ?? null,
      error,
    };
  }, []);

  const acquireDateRoom = useCallback(
    async (
      sessionId: string,
      eventId: string | null,
      userId: string | null,
      truthRow: VideoDateTruthRow | null,
    ): Promise<
      | {
          ok: true;
          roomData: DailyRoomSuccessResponse;
          cacheEntry: PreparedVideoDateEntryCacheEntry;
          cached: boolean;
          preparedEntryUsed: boolean;
          preparedEntryMissReason: string | null;
        }
      | {
          ok: false;
          failure: VideoCallStartFailure;
          preparedEntryUsed: boolean;
          preparedEntryMissReason: string | null;
        }
    > => {
      let preparedEntryMissReason: string | null = userId
        ? null
        : "missing_user";
      if (userId) {
        const handoff = consumePreparedVideoDateEntry(sessionId, userId);
        if (handoff.ok === true) {
          const successfulRoomData: DailyRoomSuccessResponse = {
            room_name: handoff.envelope.roomName,
            room_url: handoff.envelope.roomUrl,
            token: handoff.envelope.token,
            token_expires_at: handoff.envelope.tokenExpiresAt,
            entry_attempt_id: handoff.envelope.entryAttemptId,
            video_date_trace_id: handoff.envelope.videoDateTraceId,
            reused_room: handoff.cacheEntry.value.reused_room,
            provider_room_recreated:
              handoff.cacheEntry.value.provider_room_recreated,
            provider_verify_skipped:
              handoff.cacheEntry.value.provider_verify_skipped,
          };
          const entryAttemptId =
            successfulRoomData.entry_attempt_id ??
            handoff.cacheEntry.entryAttemptId ??
            null;
          const videoDateTraceId =
            successfulRoomData.video_date_trace_id ?? entryAttemptId;
          vdbg("daily_room_handoff_used", {
            action: "prepare_date_entry",
            sessionId,
            eventId: truthRow?.event_id ?? eventId,
            userId,
            roomName: successfulRoomData.room_name,
            entryAttemptId,
            videoDateTraceId,
          });
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_SUCCESS, {
            platform: "web",
            session_id: sessionId,
            event_id: truthRow?.event_id ?? eventId,
            source_surface: "video_date_daily",
            source_action: "daily_token_handoff_used",
            cached: true,
            handoff_used: true,
            attempt: 1,
            attempt_count: 1,
            entry_attempt_id: entryAttemptId,
            video_date_trace_id: videoDateTraceId,
            duration_ms: 0,
            latency_bucket: bucketVideoDateLatencyMs(0),
          });
          return {
            ok: true,
            roomData: successfulRoomData,
            cacheEntry: handoff.cacheEntry,
            cached: true,
            preparedEntryUsed: true,
            preparedEntryMissReason: null,
          };
        }
        preparedEntryMissReason = handoff.reason;
        vdbg("daily_room_handoff_missed", {
          action: "prepare_date_entry",
          sessionId,
          eventId: truthRow?.event_id ?? eventId,
          userId,
          reason: handoff.reason,
        });
      }
      let lastFailure: VideoCallStartFailure | null = null;
      const recoverMissingPreparedEntryForDateRoute = (force: boolean) =>
        prepareVideoDateEntry(sessionId, {
          eventId: truthRow?.event_id ?? eventId,
          userId,
          source: "date_route_recover_missing_prepared_entry",
          force,
        });

      for (
        let attempt = 0;
        attempt <= PREPARE_DATE_ENTRY_RETRY_DELAYS_MS.length;
        attempt += 1
      ) {
        vdbg("daily_room_before", {
          action: "prepare_date_entry",
          args: { action: "prepare_date_entry", sessionId },
          eventId: truthRow?.event_id ?? eventId,
          userId,
          timeoutMs: VIDEO_DATE_PREJOIN_TIMEOUT_MS,
          attempt: attempt + 1,
        });
        let result: Awaited<ReturnType<typeof prepareVideoDateEntry>>;
        try {
          result = await withTimeout(
            "daily_room",
            recoverMissingPreparedEntryForDateRoute(attempt > 0),
            VIDEO_DATE_PREJOIN_TIMEOUT_MS,
          );
        } catch (error) {
          lastFailure = {
            kind: "network",
            retryable: true,
            serverCode: isInvokeTimeoutError(error)
              ? "PREPARE_ENTRY_TIMEOUT"
              : undefined,
          };
          vdbg("daily_room_after", {
            action: "prepare_date_entry",
            ok: false,
            sessionId,
            eventId: truthRow?.event_id ?? eventId,
            userId,
            classifiedCode: lastFailure.kind,
            retryable: lastFailure.retryable,
            attempt: attempt + 1,
            error:
              error instanceof Error
                ? { name: error.name, message: error.message }
                : String(error),
          });
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_FAILURE, {
            platform: "web",
            session_id: sessionId,
            event_id: truthRow?.event_id ?? eventId,
            source_surface: "video_date_daily",
            source_action: "daily_token_failure",
            code: lastFailure.kind,
            reason_code: lastFailure.kind,
            failure_class: classifyDailyRoomTokenFailureClass(lastFailure.kind),
            retryable: true,
            attempt: attempt + 1,
            attempt_count: attempt + 1,
          });
          const delayMs = PREPARE_DATE_ENTRY_RETRY_DELAYS_MS[attempt];
          if (delayMs == null) break;
          await sleep(delayMs);
          continue;
        }

        if (result.ok === true) {
          const successfulRoomData: DailyRoomSuccessResponse = {
            ...result.data,
            token: result.data.token,
            room_name: result.data.room_name,
            room_url: result.data.room_url,
            token_expires_at: result.data.token_expires_at ?? null,
          };
          const entryAttemptId =
            successfulRoomData.entry_attempt_id ??
            result.cacheEntry.entryAttemptId ??
            null;
          const videoDateTraceId =
            successfulRoomData.video_date_trace_id ?? entryAttemptId;
          vdbg("daily_room_after", {
            action: "prepare_date_entry",
            ok: true,
            sessionId,
            eventId: truthRow?.event_id ?? eventId,
            userId,
            roomName: successfulRoomData.room_name,
            hasToken: true,
            reusedRoom: successfulRoomData.reused_room ?? null,
            providerRoomRecreated:
              successfulRoomData.provider_room_recreated ?? null,
            providerVerifySkipped:
              successfulRoomData.provider_verify_skipped ?? null,
            cached: result.cached,
            attempt: attempt + 1,
            entryAttemptId,
            videoDateTraceId,
          });
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_SUCCESS, {
            platform: "web",
            session_id: sessionId,
            event_id: truthRow?.event_id ?? eventId,
            source_surface: "video_date_daily",
            source_action: "daily_token_success",
            reused_room: successfulRoomData.reused_room === true,
            provider_room_recreated:
              successfulRoomData.provider_room_recreated === true,
            provider_verify_skipped:
              successfulRoomData.provider_verify_skipped === true,
            cached: result.cached,
            attempt: attempt + 1,
            attempt_count: attempt + 1,
            entry_attempt_id: entryAttemptId,
            video_date_trace_id: videoDateTraceId,
            duration_ms: result.cacheEntry
              ? Math.max(
                  0,
                  result.cacheEntry.prepareFinishedAtMs -
                    result.cacheEntry.prepareStartedAtMs,
                )
              : null,
            latency_bucket: bucketVideoDateLatencyMs(
              result.cacheEntry
                ? Math.max(
                    0,
                    result.cacheEntry.prepareFinishedAtMs -
                      result.cacheEntry.prepareStartedAtMs,
                  )
                : null,
            ),
          });
          return {
            ok: true,
            roomData: successfulRoomData,
            cacheEntry: result.cacheEntry,
            cached: result.cached,
            preparedEntryUsed: false,
            preparedEntryMissReason,
          };
        }

        lastFailure = {
          kind: result.code as DailyRoomFailureKind,
          retryable: result.retryable,
          httpStatus: result.httpStatus,
          serverCode: result.code,
        };
        vdbg("daily_room_after", {
          action: "prepare_date_entry",
          ok: false,
          sessionId,
          eventId: truthRow?.event_id ?? eventId,
          userId,
          httpStatus: result.httpStatus ?? null,
          serverCode: result.code,
          classifiedCode: result.code,
          retryable: result.retryable,
          attempt: attempt + 1,
          entryAttemptId: result.entryAttemptId ?? null,
          videoDateTraceId: result.entryAttemptId ?? null,
        });
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_FAILURE, {
          platform: "web",
          session_id: sessionId,
          event_id: truthRow?.event_id ?? eventId,
          source_surface: "video_date_daily",
          source_action: "daily_token_failure",
          code: result.code,
          reason_code: result.code,
          failure_class: classifyDailyRoomTokenFailureClass(result.code),
          retryable: result.retryable,
          attempt: attempt + 1,
          attempt_count: attempt + 1,
          entry_attempt_id: result.entryAttemptId ?? null,
          video_date_trace_id: result.entryAttemptId ?? null,
        });

        if (!lastFailure?.retryable) {
          return {
            ok: false,
            failure: {
              kind: lastFailure?.kind ?? "unknown",
              retryable: false,
              httpStatus: lastFailure?.httpStatus,
              serverCode: lastFailure?.serverCode,
            },
            preparedEntryUsed: false,
            preparedEntryMissReason,
          };
        }

        const delayMs = PREPARE_DATE_ENTRY_RETRY_DELAYS_MS[attempt];
        if (delayMs == null) break;
        vdbg("daily_room_retry_scheduled", {
          action: "prepare_date_entry",
          sessionId,
          eventId: truthRow?.event_id ?? eventId,
          userId,
          attempt: attempt + 1,
          nextAttempt: attempt + 2,
          delayMs,
          classifiedCode: lastFailure.kind,
        });
        await sleep(delayMs);
      }

      return {
        ok: false,
        failure: {
          kind: lastFailure?.kind ?? "unknown",
          retryable: lastFailure?.retryable ?? false,
          httpStatus: lastFailure?.httpStatus,
          serverCode: lastFailure?.serverCode,
        },
        preparedEntryUsed: false,
        preparedEntryMissReason,
      };
    },
    [],
  );

  const waitForInFlightStartCall = useCallback(
    async (
      sessionId: string,
      eventId: string | null | undefined,
      userId: string | null | undefined,
    ): Promise<VideoCallStartResult> => {
      const startedAtMs = Date.now();
      while (
        startCallInFlightSessionRef.current === sessionId &&
        Date.now() - startedAtMs < START_CALL_IN_FLIGHT_WAIT_TIMEOUT_MS
      ) {
        await sleep(START_CALL_IN_FLIGHT_WAIT_POLL_MS);
      }

      const meetingState = safeMeetingState(callObjectRef.current);
      const reused =
        activeCallSessionIdRef.current === sessionId &&
        Boolean(callObjectRef.current) &&
        !isTerminalDailyMeetingState(meetingState);
      vdbg("daily_call_reuse_decision", {
        sessionId,
        eventId,
        userId,
        reusedCallObject: reused,
        reason: reused
          ? "start_call_in_flight_resolved_joined"
          : "start_call_in_flight_resolved_without_join",
        wait_ms: Date.now() - startedAtMs,
        roomName: roomNameRef.current,
        meetingState,
      });

      if (reused) {
        latchSameSessionDailyContinuity(
          sessionId,
          "start_call_in_flight_resolved_joined",
        );
        return { ok: true } as VideoCallStartResult;
      }
      return {
        ok: false,
        failure: { kind: "start_call_in_flight_failed", retryable: true },
      } as VideoCallStartResult;
    },
    [
      activeCallSessionIdRef,
      callObjectRef,
      latchSameSessionDailyContinuity,
      roomNameRef,
    ],
  );

  const startCall = useCallback(
    async (
      roomId?: string,
      opts?: VideoCallStartOptions,
    ): Promise<VideoCallStartResult> => {
      const sessionId = roomId || optionsRef.current?.roomId;
      const eventId = optionsRef.current?.eventId ?? null;
      const userId = optionsRef.current?.userId ?? null;
      const mediaPromptIntent = opts?.mediaPromptIntent ?? "auto";
      if (!sessionId) {
        toast.error("No session ID provided");
        return {
          ok: false,
          failure: { kind: "session_unavailable", retryable: false },
        } as VideoCallStartResult;
      }
      if (
        activeCallSessionIdRef.current === sessionId &&
        callObjectRef.current
      ) {
        const meetingState = safeMeetingState(callObjectRef.current);
        if (isTerminalDailyMeetingState(meetingState)) {
          vdbg("daily_call_reuse_decision", {
            sessionId,
            eventId,
            userId,
            reusedCallObject: false,
            reason: "existing_call_object_terminal_before_start",
            roomName: roomNameRef.current,
            meetingState,
          });
        } else {
          latchSameSessionDailyContinuity(
            sessionId,
            "start_call_existing_active_call",
          );
          setDailyMeetingState(meetingState);
          setLocalInDailyRoom(meetingState === "joined-meeting");
          vdbg("daily_call_reuse_decision", {
            sessionId,
            eventId,
            userId,
            reusedCallObject: true,
            reason: "existing_call_object_already_started",
            roomName: roomNameRef.current,
            meetingState,
          });
          return { ok: true } as VideoCallStartResult;
        }
      }
      if (!opts?.skipStartGate) {
        const activeGate = getWebVideoDateStartGateEntry(sessionId, userId);
        if (activeGate) {
          activeGate.observeCount += 1;
          vdbg("daily_call_start_gate_joined", {
            sessionId,
            eventId,
            userId,
            observeCount: activeGate.observeCount,
            waitMs: Date.now() - activeGate.startedAtMs,
          });
          const activeGateResult = await activeGate.promise;
          if (activeGateResult.ok !== true) {
            return activeGateResult;
          }
          const meetingState = safeMeetingState(callObjectRef.current);
          if (
            activeCallSessionIdRef.current === sessionId &&
            callObjectRef.current &&
            !isTerminalDailyMeetingState(meetingState)
          ) {
            return activeGateResult;
          }
          vdbg("daily_call_start_gate_adopt_current_owner", {
            sessionId,
            eventId,
            userId,
            observeCount: activeGate.observeCount,
            waitMs: Date.now() - activeGate.startedAtMs,
            localMeetingState: meetingState,
          });
          return startCall(sessionId, {
            ...opts,
            internalRetry: true,
            skipStartGate: true,
          });
        }

        const gatedPromise: Promise<VideoCallStartResult> = startCall(
          sessionId,
          {
            ...opts,
            skipStartGate: true,
          },
        );
        const registeredGate = registerWebVideoDateStartGateEntry(
          sessionId,
          userId,
          gatedPromise,
        );
        vdbg("daily_call_start_gate_registered", {
          sessionId,
          eventId,
          userId,
          observeCount: registeredGate.observeCount,
        });
        return gatedPromise;
      }
      if (
        !opts?.internalRetry &&
        startCallInFlightSessionRef.current === sessionId
      ) {
        vdbg("daily_call_reuse_decision", {
          sessionId,
          eventId,
          userId,
          reusedCallObject: true,
          reason: "start_call_already_in_flight",
          roomName: roomNameRef.current,
        });
        return waitForInFlightStartCall(sessionId, eventId, userId);
      }
      startCallInFlightSessionRef.current = sessionId;
      latchSameSessionDailyContinuity(sessionId, "start_call_requested");

      setIsConnecting(true);
      setIsConnected(false);
      setDailyMeetingState("joining-meeting");
      setLocalInDailyRoom(false);
      setHasPermission(null);
      setMediaPermissionResult(null);
      setMediaPermissionError(null);
      setRemotePlayback(createRemotePlaybackState());
      setPeerMissing({ terminal: false });
      firstRemoteObservedRef.current = false;
      remoteFirstFrameTrackedRef.current = false;
      playbackBlockedRef.current = false;
      activePreparedEntryCacheHitRef.current = null;
      lastMediaHandoffUsedRef.current = false;
      lastMediaHandoffMissReasonRef.current = null;
      lastDailyPrewarmConsumedRef.current = false;
      lastDailyPrewarmFallbackReasonRef.current = null;
      lastPrewarmedJoinInFlightRef.current = false;
      lastPrewarmedAlreadyJoinedRef.current = false;
      lastProviderVerifySkippedRef.current = null;
      clearDailyTokenRefreshTimer();
      dailyTokenRecoveryInFlightRef.current = false;
      clearFirstRemoteWatchdog();
      startAttemptNonceRef.current += 1;
      const startNonce = startAttemptNonceRef.current;
      let dailyPrewarmConsumedForJoin = false;
      if (!opts?.internalRetry) {
        peerMissingTruthRefreshCountRef.current = 0;
      }

      try {
        if (callObjectRef.current) {
          const meetingState = safeMeetingState(callObjectRef.current);
          const sameActiveSession =
            activeCallSessionIdRef.current === sessionId;
          if (sameActiveSession && !isTerminalDailyMeetingState(meetingState)) {
            latchSameSessionDailyContinuity(
              sessionId,
              "start_call_same_session_reuse",
            );
            setDailyMeetingState(meetingState);
            setLocalInDailyRoom(meetingState === "joined-meeting");
            vdbg("daily_call_reuse_decision", {
              sessionId,
              eventId,
              userId,
              reusedCallObject: true,
              reason: "same_session_call_still_active",
              previousRoomName: roomNameRef.current,
              meetingState,
            });
            return { ok: true } as VideoCallStartResult;
          }
          vdbg("daily_call_reuse_decision", {
            sessionId,
            eventId,
            userId,
            reusedCallObject: false,
            reason: sameActiveSession
              ? "existing_same_session_terminal_rebuilt_before_start"
              : "existing_call_object_rebuilt_before_start",
            previousRoomName: roomNameRef.current,
            meetingState,
          });
          await cleanupCallObject("startCall", "existing_call_object_rebuild");
        } else {
          vdbg("daily_call_reuse_decision", {
            sessionId,
            eventId,
            userId,
            reusedCallObject: false,
            reason: "fresh_call_object_required",
          });
        }

        const { truth: initialTruthRow, error: truthError } =
          await fetchVideoDateTruth(sessionId);
        const truthRow = initialTruthRow;
        vdbg("date_prejoin_truth_row", {
          sessionId,
          eventId: truthRow?.event_id ?? eventId,
          userId,
          row: truthRow ?? null,
          error: truthError
            ? { code: truthError.code, message: truthError.message }
            : null,
        });

        if (truthError || !truthRow) {
          setIsConnecting(false);
          return {
            ok: false,
            failure: { kind: "session_unavailable", retryable: false },
          } as VideoCallStartResult;
        }

        if (truthRow.ended_at) {
          clearSameSessionDailyContinuity(
            sessionId,
            "truth_ended_before_start",
          );
          setIsConnecting(false);
          return {
            ok: false,
            failure: { kind: "SESSION_ENDED", retryable: false },
          } as VideoCallStartResult;
        }
        latchSameSessionDailyContinuity(sessionId, "date_entry_truth_active");

        vdbg("video_date_transition_skipped", {
          action: "prepare_entry_routeable",
          sessionId,
          userId,
          eventId: truthRow.event_id ?? eventId,
          reason: "prepare_date_entry_owns_reconnect_and_entry",
          state: truthRow.state,
          phase: truthRow.phase,
          entryStarted: Boolean(truthRow.entry_started_at),
        });

        let captureProfileForCall = captureProfileRef.current;
        const hasReusableDailySingletonBeforeRoom = userId
          ? hasReusableWebDailyCallSingleton({
              userId,
              nextSessionId: sessionId,
            })
          : false;
        const prewarmPeekBeforeRoom = hasReusableDailySingletonBeforeRoom
          ? { ok: false as const, reason: "daily_call_singleton_reused" }
          : userId
            ? peekWebVideoDateDailyPrewarm({
                sessionId,
                userId,
              })
            : { ok: false as const, reason: "missing_user" };
        const prewarmPendingBeforeRoom =
          !hasReusableDailySingletonBeforeRoom && userId
            ? hasPendingWebVideoDateDailyPrewarm({ sessionId, userId })
            : false;
        if (prewarmPeekBeforeRoom.ok === true) {
          captureProfileForCall = prewarmPeekBeforeRoom.entry.captureProfile;
          captureProfileRef.current = prewarmPeekBeforeRoom.entry.captureProfile;
          setCaptureProfile(prewarmPeekBeforeRoom.entry.captureProfile);
        }
        const prewarmAppAcquiredMediaBeforeRoom =
          prewarmPeekBeforeRoom.ok === true &&
          hasLiveWebVideoDateDailyPrewarmAppMedia(
            prewarmPeekBeforeRoom.entry.appAcquiredMedia,
          );
        const reusableDailyPrewarmBeforeRoom =
          prewarmAppAcquiredMediaBeforeRoom;
        const runMediaPreflightBeforeRoom =
          !hasReusableDailySingletonBeforeRoom &&
          !reusableDailyPrewarmBeforeRoom;
        if (runMediaPreflightBeforeRoom) {
          const mediaAllowedBeforeRoom = await preflightMediaPermission(
            sessionId,
            truthRow.event_id ?? eventId,
            userId,
            mediaPromptIntent,
          );
          if (!mediaAllowedBeforeRoom) {
            setIsConnecting(false);
            return {
              ok: false,
              failure: { kind: "media_permission_denied", retryable: true },
            } as VideoCallStartResult;
          }
        } else {
          setHasPermission(true);
          setMediaPermissionResult(null);
          setMediaPermissionError(null);
          vdbg("daily_media_permission_preflight_skipped_before_room", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            source: hasReusableDailySingletonBeforeRoom
              ? "daily_call_singleton"
              : "daily_prewarm_live_app_media",
            prewarmAppAcquiredMedia: prewarmAppAcquiredMediaBeforeRoom,
            prewarmPending: prewarmPendingBeforeRoom,
          });
        }

        const roomResult = await acquireDateRoom(
          sessionId,
          truthRow.event_id ?? eventId,
          userId,
          truthRow,
        );
        if (roomResult.ok === false) {
          releaseAppAcquiredMedia(
            runMediaPreflightBeforeRoom
              ? "daily_room_failed_after_media_preflight"
              : "daily_room_failed_before_media_preflight",
          );
          setIsConnecting(false);
          return {
            ok: false,
            failure: roomResult.failure,
          } as VideoCallStartResult;
        }
        let roomData = roomResult.roomData;
        activePreparedEntryCacheRef.current = roomResult.cacheEntry;
        activePreparedEntryCacheHitRef.current = roomResult.cached;
        lastProviderVerifySkippedRef.current =
          roomData.provider_verify_skipped ?? null;
        const entryAttemptId =
          roomData.entry_attempt_id ??
          roomResult.cacheEntry.entryAttemptId ??
          null;
        const videoDateTraceId = roomData.video_date_trace_id ?? entryAttemptId;
        type DailyTokenRefreshSourceAction =
          | "daily_token_refresh_before_join"
          | "daily_token_refresh_join_retry"
          | "daily_token_refresh_before_expiry"
          | "daily_token_refresh_after_ejection"
          | "daily_token_refresh_after_auth_error";
        type DailyTokenRefreshFailureState = {
          kind: "terminal" | "rate_limited" | "retryable";
          error: string;
          retryAfterMs: number | null;
          phase: string | null;
        };
        let lastDailyTokenRefreshFailure: DailyTokenRefreshFailureState | null =
          null;
        const getLastDailyTokenRefreshFailure =
          (): DailyTokenRefreshFailureState | null =>
            lastDailyTokenRefreshFailure;
        const refreshDailyTokenForJoin = async (
          sourceAction: DailyTokenRefreshSourceAction,
          cause?: unknown,
        ): Promise<boolean> => {
          lastDailyTokenRefreshFailure = null;
          const refreshStartedAtMs = Date.now();
          vdbg(sourceAction, {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            roomName: roomData.room_name,
            tokenExpiresAt: roomData.token_expires_at ?? null,
            cause:
              cause instanceof Error
                ? cause.message
                : cause
                  ? String(cause)
                  : null,
          });
          const refresh = await refreshVideoDateToken(sessionId);
          let durationMs = Date.now() - refreshStartedAtMs;
          if (refresh.ok === false) {
            const refreshFailure: DailyTokenRefreshFailureState = {
              kind: isVideoDateTokenRefreshTerminal(refresh)
                ? "terminal"
                : isVideoDateTokenRefreshRateLimited(refresh)
                  ? "rate_limited"
                  : "retryable",
              error: refresh.error,
              retryAfterMs: videoDateTokenRefreshRetryAfterMs(refresh),
              phase: refresh.phase ?? null,
            };
            lastDailyTokenRefreshFailure = refreshFailure;
            if (refresh.error === "room_not_ready") {
              const recoverRoomNotReadyForDateRoute = () =>
                prepareVideoDateEntry(sessionId, {
                  eventId: truthRow.event_id ?? eventId,
                  userId,
                  source: `${sourceAction}_date_route_room_recovery`,
                  force: true,
                });
              vdbg("daily_token_refresh_prepare_entry_recovery_started", {
                sessionId,
                eventId: truthRow.event_id ?? eventId,
                userId,
                sourceAction,
                roomName: roomData.room_name,
              });
              const prepared = await recoverRoomNotReadyForDateRoute();
              durationMs = Date.now() - refreshStartedAtMs;
              if (
                prepared.ok === true &&
                prepared.data.room_name === roomData.room_name &&
                prepared.data.room_url === roomData.room_url
              ) {
                activePreparedEntryCacheRef.current = prepared.cacheEntry;
                activePreparedEntryCacheHitRef.current = prepared.cached;
                lastProviderVerifySkippedRef.current =
                  prepared.data.provider_verify_skipped ?? null;
                roomData = {
                  ...roomData,
                  token: prepared.data.token,
                  token_expires_at: prepared.data.token_expires_at ?? null,
                  entry_attempt_id:
                    prepared.data.entry_attempt_id ??
                    roomData.entry_attempt_id ??
                    null,
                  video_date_trace_id:
                    prepared.data.video_date_trace_id ??
                    prepared.data.entry_attempt_id ??
                    roomData.video_date_trace_id ??
                    null,
                  provider_room_recreated:
                    prepared.data.provider_room_recreated ??
                    roomData.provider_room_recreated,
                  provider_verify_skipped:
                    prepared.data.provider_verify_skipped ??
                    roomData.provider_verify_skipped,
                };
                vdbg("daily_token_refresh_prepare_entry_recovery_success", {
                  sessionId,
                  eventId: truthRow.event_id ?? eventId,
                  userId,
                  sourceAction,
                  roomName: roomData.room_name,
                  tokenExpiresAt: roomData.token_expires_at ?? null,
                  durationMs,
                });
                trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_SUCCESS, {
                  platform: "web",
                  session_id: sessionId,
                  event_id: truthRow.event_id ?? eventId,
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
                eventId: truthRow.event_id ?? eventId,
                userId,
                sourceAction,
                reason: prepared.ok === true ? "room_mismatch" : prepared.code,
                previousRoomName: roomData.room_name,
                preparedRoomName:
                  prepared.ok === true ? prepared.data.room_name : null,
                previousRoomUrl: roomData.room_url,
                preparedRoomUrl:
                  prepared.ok === true ? prepared.data.room_url : null,
                durationMs,
              });
            }
            vdbg("daily_token_refresh_failed", {
              sessionId,
              eventId: truthRow.event_id ?? eventId,
              userId,
              sourceAction,
              reason: refresh.error,
              retryable: refresh.retryable ?? null,
              retryAfterMs: refreshFailure.retryAfterMs,
              terminal: refreshFailure.kind === "terminal",
              durationMs,
            });
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_FAILURE, {
              platform: "web",
              session_id: sessionId,
              event_id: truthRow.event_id ?? eventId,
              source_surface: "video_date_daily",
              source_action: sourceAction,
              code: refresh.error,
              reason_code: refresh.error,
              failure_class: classifyDailyRoomTokenFailureClass("network"),
              retryable: refresh.retryable ?? true,
              duration_ms: durationMs,
              latency_bucket: bucketVideoDateLatencyMs(durationMs),
              attempt_count: 1,
            });
            return false;
          }

          if (
            refresh.roomName !== roomData.room_name ||
            refresh.roomUrl !== roomData.room_url
          ) {
            lastDailyTokenRefreshFailure = {
              kind: "terminal",
              error: "token_refresh_room_mismatch",
              retryAfterMs: null,
              phase: refresh.phase ?? null,
            };
            vdbg("daily_token_refresh_room_mismatch", {
              sessionId,
              eventId: truthRow.event_id ?? eventId,
              userId,
              previousRoomName: roomData.room_name,
              refreshedRoomName: refresh.roomName,
              previousRoomUrl: roomData.room_url,
              refreshedRoomUrl: refresh.roomUrl,
            });
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_FAILURE, {
              platform: "web",
              session_id: sessionId,
              event_id: truthRow.event_id ?? eventId,
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

          roomData = {
            ...roomData,
            token: refresh.token,
            token_expires_at: refresh.tokenExpiresAtIso,
          };
          vdbg("daily_token_refresh_success", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            sourceAction,
            roomName: roomData.room_name,
            tokenExpiresAt: roomData.token_expires_at ?? null,
            durationMs,
          });
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_SUCCESS, {
            platform: "web",
            session_id: sessionId,
            event_id: truthRow.event_id ?? eventId,
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
            tokenExpiresAtIso: roomData.token_expires_at,
            platform: "web",
            surface: "video_date",
          }).action === "refresh_token"
        ) {
          const refreshedBeforeJoin = await refreshDailyTokenForJoin(
            "daily_token_refresh_before_join",
          );
          const refreshFailure = getLastDailyTokenRefreshFailure();
          if (!refreshedBeforeJoin && refreshFailure?.kind === "terminal") {
            releaseAppAcquiredMedia("daily_token_refresh_terminal_before_join");
            setIsConnecting(false);
            return {
              ok: false,
              failure: {
                kind: "SESSION_ENDED",
                retryable: false,
                serverCode: refreshFailure.error,
              },
            } as VideoCallStartResult;
          }
          if (!refreshedBeforeJoin && refreshFailure?.kind === "rate_limited") {
            releaseAppAcquiredMedia(
              "daily_token_refresh_rate_limited_before_join",
            );
            setIsConnecting(false);
            return {
              ok: false,
              failure: {
                kind: "DAILY_RATE_LIMIT",
                retryable: true,
                serverCode: refreshFailure.error,
              },
            } as VideoCallStartResult;
          }
        }

        roomNameRef.current = roomData.room_name;

        const singletonCall = userId
          ? consumeWebDailyCallSingleton({
              userId,
              nextSessionId: sessionId,
              nextRoomName: roomData.room_name,
            })
          : { ok: false as const, reason: "missing_user" };
        if (singletonCall.ok === true) {
          captureProfileForCall = singletonCall.entry.captureProfile;
          captureProfileRef.current = singletonCall.entry.captureProfile;
          setCaptureProfile(singletonCall.entry.captureProfile);
        }
        const singletonAlreadyJoined =
          singletonCall.ok === true &&
          singletonCall.meetingState === "joined-meeting";
        const singletonJoinInFlight =
          singletonCall.ok === true &&
          singletonCall.meetingState === "joining-meeting";
        const prewarmPeek = singletonCall.ok
          ? { ok: false as const, reason: "daily_call_singleton_reused" }
          : userId
            ? peekWebVideoDateDailyPrewarm({
                sessionId,
                userId,
                roomName: roomData.room_name,
                roomUrl: roomData.room_url,
              })
            : { ok: false as const, reason: "missing_user" };
        if (prewarmPeek.ok === true) {
          captureProfileForCall = prewarmPeek.entry.captureProfile;
          captureProfileRef.current = prewarmPeek.entry.captureProfile;
          setCaptureProfile(prewarmPeek.entry.captureProfile);
        }
        const consumePrewarmBeforeMediaPreflight =
          prewarmPeek.ok === true || prewarmPendingBeforeRoom;
        let prewarmedCall = singletonCall.ok
          ? { ok: false as const, reason: "daily_call_singleton_reused" }
          : userId && consumePrewarmBeforeMediaPreflight
            ? await consumeWebVideoDateDailyPrewarmWhenReady({
                sessionId,
                userId,
                eventId: truthRow.event_id ?? eventId,
                roomName: roomData.room_name,
                roomUrl: roomData.room_url,
                captureProfile: captureProfileForCall,
              })
            : {
                ok: false as const,
                reason:
                  prewarmPeek.ok === true
                    ? "daily_prewarm_deferred_until_media_preflight"
                    : prewarmPeek.reason,
              };
        if (
          prewarmedCall.ok === false &&
          prewarmedCall.reason !== "daily_prewarm_deferred_until_media_preflight"
        ) {
          vdbg("daily_prewarm_fallback", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            reason: prewarmedCall.reason,
            dailyCallSingletonReused: singletonCall.ok === true,
          });
        }
        let prewarmAppAcquiredMedia =
          prewarmedCall.ok === true
            ? prewarmedCall.entry.appAcquiredMedia
            : null;
        const adoptPrewarmAppAcquiredMedia = () => {
          if (!prewarmAppAcquiredMedia) return false;
          if (
            !hasLiveWebVideoDateDailyPrewarmAppMedia(prewarmAppAcquiredMedia)
          ) {
            vdbg("daily_prewarm_app_acquired_media_not_live", {
              sessionId,
              eventId: truthRow.event_id ?? eventId,
              userId,
              roomName: roomData.room_name,
              captureProfile: prewarmAppAcquiredMedia.captureProfile,
              source: prewarmAppAcquiredMedia.source,
            });
            prewarmAppAcquiredMedia = null;
            return false;
          }
          const existingMedia = appAcquiredMediaRef.current;
          if (
            existingMedia &&
            existingMedia.stream !== prewarmAppAcquiredMedia.stream
          ) {
            releaseAppAcquiredMedia(
              "prewarmed_app_acquired_media_replaced_route_media",
            );
          }
          appAcquiredMediaRef.current = {
            stream: prewarmAppAcquiredMedia.stream,
            captureProfile: prewarmAppAcquiredMedia.captureProfile,
            acquiredAtMs: prewarmAppAcquiredMedia.acquiredAtMs,
            consumedByDaily: true,
          };
          vdbg("daily_prewarm_app_acquired_media_consumed", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            roomName: roomData.room_name,
            captureProfile: prewarmAppAcquiredMedia.captureProfile,
            source: prewarmAppAcquiredMedia.source,
            videoTrack: summarizeVideoTrackSettings(
              firstLiveTrack(prewarmAppAcquiredMedia.stream.getVideoTracks()),
            ),
          });
          return true;
        };
        adoptPrewarmAppAcquiredMedia();
        const prewarmHasLiveAppAcquiredMedia =
          hasLiveWebVideoDateDailyPrewarmAppMedia(prewarmAppAcquiredMedia);
        const skipMediaPreflightForReusableDailyMedia =
          singletonCall.ok === true ||
          prewarmHasLiveAppAcquiredMedia;
        if (skipMediaPreflightForReusableDailyMedia) {
          setHasPermission(true);
          setMediaPermissionResult(null);
          setMediaPermissionError(null);
          vdbg("daily_media_permission_preflight_skipped_for_reused_daily_media", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            source:
              singletonCall.ok === true
                ? "daily_call_singleton"
                : "daily_prewarm_app_acquired_media",
            roomName: roomData.room_name,
            prewarmAppAcquiredMedia: prewarmHasLiveAppAcquiredMedia,
            dailyPrewarmConsumed: prewarmedCall.ok === true,
          });
        }
        if (
          prewarmedCall.ok === false &&
          prewarmedCall.reason === "daily_prewarm_deferred_until_media_preflight" &&
          userId
        ) {
          prewarmedCall = await consumeWebVideoDateDailyPrewarmWhenReady({
            sessionId,
            userId,
            eventId: truthRow.event_id ?? eventId,
            roomName: roomData.room_name,
            roomUrl: roomData.room_url,
            captureProfile: captureProfileForCall,
          });
          if (prewarmedCall.ok === false) {
            vdbg("daily_prewarm_fallback", {
              sessionId,
              eventId: truthRow.event_id ?? eventId,
              userId,
              reason: prewarmedCall.reason,
              dailyCallSingletonReused: false,
            });
          } else {
            prewarmAppAcquiredMedia = prewarmedCall.entry.appAcquiredMedia;
            adoptPrewarmAppAcquiredMedia();
          }
        }
        if (prewarmedCall.ok === true) {
          captureProfileForCall = prewarmedCall.entry.captureProfile;
          captureProfileRef.current = prewarmedCall.entry.captureProfile;
          setCaptureProfile(prewarmedCall.entry.captureProfile);
        }
        if (
          singletonCall.ok === false &&
          prewarmedCall.ok === false &&
          !appAcquiredMediaRef.current &&
          typeof navigator !== "undefined" &&
          navigator.mediaDevices?.getUserMedia
        ) {
          let stream: MediaStream | null = null;
          let nextCaptureProfile: VideoDateWebMediaCaptureProfile =
            captureProfileForCall;
          try {
            for (const profile of VIDEO_DATE_WEB_CAPTURE_PROFILE_ORDER) {
              try {
                stream = await navigator.mediaDevices.getUserMedia(
                  videoDateWebMediaStreamConstraints(profile),
                );
                nextCaptureProfile = profile;
                break;
              } catch (profileError) {
                if (
                  !isVideoDateCameraConstraintError(profileError) ||
                  profile === "fallback"
                ) {
                  throw profileError;
                }
                vdbg("daily_media_permission_handoff_capture_fallback", {
                  sessionId,
                  eventId: truthRow.event_id ?? eventId,
                  userId,
                  attemptedProfile: profile,
                  reason: prewarmedCall.reason,
                  error:
                    profileError instanceof Error
                      ? {
                          name: profileError.name,
                          message: profileError.message,
                        }
                      : String(profileError),
                });
              }
            }
            if (stream) {
              let mediaTracks: LiveVideoDateMediaTracks;
              try {
                mediaTracks = requireLiveVideoDateMediaTracks(
                  stream,
                  "Video Date handoff capture",
                );
              } catch (error) {
                stopMediaStreamTracks(stream);
                stream = null;
                throw error;
              }
              const { videoTrack, audioTrack } = mediaTracks;
              const videoTrackSettings =
                summarizeVideoTrackSettings(videoTrack);
              captureProfileForCall = nextCaptureProfile;
              captureProfileRef.current = nextCaptureProfile;
              setCaptureProfile(nextCaptureProfile);
              appAcquiredMediaRef.current = {
                stream,
                captureProfile: nextCaptureProfile,
                acquiredAtMs: Date.now(),
                consumedByDaily: false,
              };
              trackEvent(
                LobbyPostDateEvents.VIDEO_DATE_SENDER_CAPTURE_DIAGNOSTIC,
                {
                  platform: "web",
                  session_id: sessionId,
                  event_id: truthRow.event_id ?? eventId,
                  source_surface: "video_date_daily",
                  source_action: "daily_create_without_prewarm",
                  diagnostic_scope: "sender_capture",
                  capture_profile: nextCaptureProfile,
                  app_acquired_media: true,
                  media_handoff_miss_reason:
                    lastMediaHandoffMissReasonRef.current,
                  audio_track_present: Boolean(audioTrack),
                  video_track_present: Boolean(videoTrack),
                  video_track_width: videoTrackSettings?.width ?? null,
                  video_track_height: videoTrackSettings?.height ?? null,
                  video_track_aspect_ratio:
                    videoTrackSettings?.aspectRatio ?? null,
                  video_track_frame_rate: videoTrackSettings?.frameRate ?? null,
                  video_track_facing_mode:
                    videoTrackSettings?.facingMode ?? null,
                  ...summarizeWebRuntime(),
                },
              );
              vdbg("daily_app_acquired_media_after_prewarm_miss", {
                sessionId,
                eventId: truthRow.event_id ?? eventId,
                userId,
                captureProfile: nextCaptureProfile,
                prewarmFallbackReason: prewarmedCall.reason,
                videoTrack: videoTrackSettings,
              });
            }
          } catch (error) {
            if (stream) stopMediaStreamTracks(stream);
            vdbg("daily_app_acquired_media_after_prewarm_miss_failed", {
              sessionId,
              eventId: truthRow.event_id ?? eventId,
              userId,
              reason: prewarmedCall.reason,
              error:
                error instanceof Error
                  ? { name: error.name, message: error.message }
                  : String(error),
            });
          }
        }
        let prewarmedAlreadyJoined = false;
        let prewarmedJoinPromise: Promise<boolean> | null = null;
        const refreshPrewarmJoinState = () => {
          prewarmedAlreadyJoined =
            prewarmedCall.ok === true && prewarmedCall.entry.joined;
          prewarmedJoinPromise =
            prewarmedCall.ok === true ? prewarmedCall.entry.joinPromise : null;
          lastDailyPrewarmConsumedRef.current = prewarmedCall.ok === true;
          lastDailyPrewarmFallbackReasonRef.current =
            prewarmedCall.ok === true ? null : prewarmedCall.reason;
          lastPrewarmedAlreadyJoinedRef.current =
            prewarmedAlreadyJoined || singletonAlreadyJoined;
          lastPrewarmedJoinInFlightRef.current =
            Boolean(prewarmedJoinPromise && !prewarmedAlreadyJoined) ||
            singletonJoinInFlight;
        };
        refreshPrewarmJoinState();
        const acquiredMedia = appAcquiredMediaRef.current;
        const appAcquiredMediaForCall =
          acquiredMedia &&
          acquiredMedia.captureProfile === captureProfileForCall
            ? (getLiveVideoDateMediaTracks(acquiredMedia.stream) ?? undefined)
            : undefined;
        if (
          acquiredMedia &&
          acquiredMedia.captureProfile !== captureProfileForCall
        ) {
          releaseAppAcquiredMedia(
            "capture_profile_changed_before_daily_create",
          );
        } else if (acquiredMedia && !appAcquiredMediaForCall) {
          releaseAppAcquiredMedia("app_acquired_media_missing_required_track");
        }
        const hasAppAcquiredMediaTracks = Boolean(appAcquiredMediaForCall);
        let guardedCreateFailure:
          | "external_call_busy"
          | "cleanup_pending"
          | null = null;
        let guardedCreateMeetingState: string | null = null;
        const callObject =
          singletonCall.ok === true
            ? singletonCall.entry.call
            : prewarmedCall.ok === true
              ? prewarmedCall.entry.call
              : await (async () => {
                  const factoryOptions =
                    hasAppAcquiredMediaTracks && appAcquiredMediaForCall
                      ? dailyVideoDateCallObjectOptionsWithAppAcquiredMedia(
                          captureProfileForCall,
                          appAcquiredMediaForCall,
                        )
                      : dailyVideoDateCallObjectOptions(captureProfileForCall);
                  for (
                    let attempt = 1;
                    attempt <= WEB_VIDEO_DATE_DAILY_GUARD_CREATE_MAX_ATTEMPTS;
                    attempt += 1
                  ) {
                    const guarded = await createDailyCallObjectGuarded(
                      DailyIframe,
                      factoryOptions,
                      {
                        source: "video_date_start_call",
                        currentCallObject: callObjectRef.current,
                        waitForCleanup: true,
                        adoptMatchingExternalCall: true,
                        videoDateSessionId: sessionId,
                        videoDateRoomName: roomData.room_name,
                        onDiagnostic: (eventName, payload) => {
                          vdbg(eventName, {
                            sessionId,
                            eventId: truthRow.event_id ?? eventId,
                            userId,
                            roomName: roomData.room_name,
                            source: "video_date_start_call",
                            attempt,
                            ...payload,
                          });
                        },
                      },
                    );
                    if (guarded.ok === true) return guarded.call;
                    if (
                      guarded.reason === "external_call_busy" ||
                      guarded.reason === "cleanup_pending"
                    ) {
                      const recoveredPrewarm = userId
                        ? await consumeWebVideoDateDailyPrewarmWhenReady({
                            sessionId,
                            userId,
                            eventId: truthRow.event_id ?? eventId,
                            roomName: roomData.room_name,
                            roomUrl: roomData.room_url,
                            captureProfile: captureProfileForCall,
                          })
                        : { ok: false as const, reason: "missing_user" };
                      if (recoveredPrewarm.ok === true) {
                        prewarmedCall = recoveredPrewarm;
                        captureProfileForCall =
                          recoveredPrewarm.entry.captureProfile;
                        captureProfileRef.current =
                          recoveredPrewarm.entry.captureProfile;
                        setCaptureProfile(recoveredPrewarm.entry.captureProfile);
                        prewarmAppAcquiredMedia =
                          recoveredPrewarm.entry.appAcquiredMedia;
                        adoptPrewarmAppAcquiredMedia();
                        refreshPrewarmJoinState();
                        vdbg("daily_prewarm_reconsumed_after_guard_blocked", {
                          sessionId,
                          eventId: truthRow.event_id ?? eventId,
                          userId,
                          roomName: roomData.room_name,
                          guardReason: guarded.reason,
                          meetingState: guarded.meetingState ?? null,
                          attempt,
                          prewarmedAlreadyJoined,
                          prewarmedJoinInFlight: Boolean(
                            prewarmedJoinPromise && !prewarmedAlreadyJoined,
                          ),
                        });
                        return recoveredPrewarm.entry.call;
                      }
                      guardedCreateFailure = guarded.reason;
                      guardedCreateMeetingState = guarded.meetingState ?? null;
                      vdbg("daily_guard_create_blocked", {
                        sessionId,
                        eventId: truthRow.event_id ?? eventId,
                        userId,
                        roomName: roomData.room_name,
                        reason: guarded.reason,
                        meetingState: guarded.meetingState ?? null,
                        prewarmRecoveryReason: recoveredPrewarm.reason,
                        attempt,
                        maxAttempts:
                          WEB_VIDEO_DATE_DAILY_GUARD_CREATE_MAX_ATTEMPTS,
                      });
                      if (
                        attempt < WEB_VIDEO_DATE_DAILY_GUARD_CREATE_MAX_ATTEMPTS
                      ) {
                        await sleep(
                          Math.min(
                            1_200,
                            WEB_VIDEO_DATE_DAILY_GUARD_CREATE_RETRY_BASE_MS *
                              attempt,
                          ),
                        );
                        continue;
                      }
                      return null;
                    }
                    throw guarded.error instanceof Error
                      ? guarded.error
                      : new Error("daily_create_failed");
                  }
                  return null;
                })();
        if (!callObject) {
          releaseAppAcquiredMedia("daily_guard_create_blocked");
          setIsConnecting(false);
          setDailyMeetingState(null);
          setLocalInDailyRoom(false);
          return {
            ok: false,
            failure: {
              kind: "daily_call_busy",
              retryable: true,
              serverCode: guardedCreateFailure ?? "external_call_busy",
            },
          } as VideoCallStartResult;
        }
        if (singletonCall.ok === true) {
          const singletonAppAcquiredMedia =
            singletonCall.entry.appAcquiredMedia;
          if (
            appAcquiredMediaRef.current &&
            (!singletonAppAcquiredMedia ||
              appAcquiredMediaRef.current.stream !==
                singletonAppAcquiredMedia.stream)
          ) {
            releaseAppAcquiredMedia("singleton_call_reused");
          }
          if (singletonAppAcquiredMedia) {
            appAcquiredMediaRef.current = singletonAppAcquiredMedia;
          }
        } else if (
          prewarmedCall.ok === true &&
          appAcquiredMediaRef.current &&
          !prewarmAppAcquiredMedia
        ) {
          releaseAppAcquiredMedia("prewarmed_call_reused");
        } else if (hasAppAcquiredMediaTracks && appAcquiredMediaRef.current) {
          appAcquiredMediaRef.current.consumedByDaily = true;
          vdbg("daily_call_object_app_acquired_media_used", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            roomName: roomData.room_name,
            captureProfile: captureProfileForCall,
            audioTrackId: appAcquiredMediaForCall?.audioTrack?.id ?? null,
            videoTrackId: appAcquiredMediaForCall?.videoTrack?.id ?? null,
            videoTrack: summarizeVideoTrackSettings(
              appAcquiredMediaForCall?.videoTrack,
            ),
          });
        }
        dailyPrewarmConsumedForJoin = prewarmedCall.ok === true;
        callObjectRef.current = callObject;
        latchSameSessionDailyContinuity(
          sessionId,
          "daily_call_object_attached",
        );
        setDailyMeetingState(safeMeetingState(callObject) ?? "new");
        vdbg("daily_call_object_created", {
          sessionId,
          eventId: truthRow.event_id ?? eventId,
          userId,
          roomName: roomData.room_name,
          captureProfile: captureProfileForCall,
          entryAttemptId,
          videoDateTraceId,
          reusedCallObject:
            singletonCall.ok === true || prewarmedCall.ok === true,
          dailyCallSingletonReused: singletonCall.ok === true,
          dailyCallSingletonPreviousSessionId:
            singletonCall.ok === true
              ? singletonCall.entry.previousSessionId
              : null,
          dailyCallSingletonParkingMode:
            singletonCall.ok === true ? singletonCall.entry.parkingMode : null,
          reusedJoinedCallObject:
            prewarmedAlreadyJoined || singletonAlreadyJoined,
          reusedJoinInFlight:
            Boolean(prewarmedJoinPromise && !prewarmedAlreadyJoined) ||
            singletonJoinInFlight,
          appAcquiredMediaUsed:
            singletonCall.ok === false &&
            hasAppAcquiredMediaTracks &&
            prewarmedCall.ok === false,
          prewarmFallbackReason:
            prewarmedCall.ok === false ? prewarmedCall.reason : null,
        });

        const getRemoteParticipantCount = () => {
          const activeCall = callObjectRef.current;
          if (!activeCall) return 0;
          try {
            return Object.values(activeCall.participants()).filter(
              (p) => !p.local,
            ).length;
          } catch {
            return 0;
          }
        };

        const getMeetingState = () => {
          const activeCall = callObjectRef.current as
            | (DailyCall & { meetingState?: () => unknown })
            | null;
          if (!activeCall || typeof activeCall.meetingState !== "function")
            return null;
          try {
            const state = activeCall.meetingState();
            return typeof state === "string" ? state : String(state);
          } catch {
            return null;
          }
        };

        const logTransportState = (
          message: string,
          extra?: Record<string, unknown>,
        ) => {
          vdbg(message, {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            roomName: roomData.room_name,
            localParticipantId:
              latestLocalParticipantRef.current?.session_id ?? null,
            entryAttemptId,
            videoDateTraceId,
            remoteParticipantCount: getRemoteParticipantCount(),
            dailyMeetingState: getMeetingState(),
            videoSessionState: optionsRef.current?.videoSessionState ?? null,
            localJoined: activeCallSessionIdRef.current === sessionId,
            localDecisionPersisted:
              optionsRef.current?.localDecisionPersisted ?? null,
            reconnectState: reconnectGraceActiveRef.current
              ? "interrupted"
              : "connected",
            ...extra,
          });
        };
        clearDailyEventListeners("before_bind_daily_listeners");
        const listenerGeneration = ++dailyListenerGenerationRef.current;
        const isCurrentDailyListener = () =>
          dailyListenerGenerationRef.current === listenerGeneration &&
          callObjectRef.current === callObject;
        const bindDailyEvent = <T extends DailyEvent>(
          eventName: T,
          handler: (event: DailyEventObject<T>) => void,
        ) => {
          callObject.on(eventName, handler);
          dailyEventListenerCleanupsRef.current.push(() => {
            callObject.off(eventName, handler);
          });
        };

        const syncReconnectOnce = async (reason: string) => {
          if (!isCurrentDailyListener()) return;
          if (reconnectSyncRequestedRef.current) return;
          reconnectSyncRequestedRef.current = true;
          const args = { p_session_id: sessionId, p_action: "sync_reconnect" };
          vdbg("video_date_transition_before", {
            action: "sync_reconnect",
            args,
            reason,
          });
          const { data, error } = await supabase.rpc(
            "video_date_transition",
            args,
          );
          const payload =
            data && typeof data === "object" && !Array.isArray(data)
              ? (data as Record<string, unknown>)
              : null;
          const failsoftRejected = payload?.success === false;
          const terminalSurvey =
            videoDateLifecycleRpcIndicatesTerminalSurvey(payload);
          const terminalStop =
            terminalSurvey ||
            videoDateLifecycleRpcIndicatesTerminalStop(payload);
          vdbg("video_date_transition_after", {
            action: "sync_reconnect",
            ok: !error && !failsoftRejected,
            payload: data ?? null,
            error: error ? { code: error.code, message: error.message } : null,
            reason,
          });
          if (terminalStop) {
            clearDailyAliveHeartbeatTimer("sync_reconnect_terminal_truth");
          }
          if (terminalSurvey) {
            optionsRef.current?.onTerminalSurveyTruth?.(
              "sync_reconnect_terminal_survey_truth",
            );
            return;
          }
          if (error || failsoftRejected) {
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_SYNC_RECONNECT_FAILED, {
              platform: "web",
              session_id: sessionId,
              event_id: truthRow.event_id ?? eventId,
              reason,
              code: error?.code ?? videoDateLifecycleRpcCode(payload),
              retryable: error
                ? true
                : videoDateLifecycleRpcRetryable(payload) === true,
            });
          }
        };

        const clearReconnectGrace = (reason: string, recovered: boolean) => {
          if (!isCurrentDailyListener()) return;
          if (!reconnectGraceActiveRef.current) return;
          clearReconnectGraceTimers();
          reconnectGraceActiveRef.current = false;
          reconnectSyncRequestedRef.current = false;
          setReconnectGraceTimeLeft(0);
          logTransportState("reconnect_grace_cleared", { reason, recovered });
          if (recovered) {
            setDailyReconnectState("recovered");
            logTransportState("daily_transport_recovered", { reason });
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_RECONNECT_RETURNED, {
              platform: "web",
              session_id: sessionId,
              event_id: truthRow.event_id ?? eventId,
              reason,
            });
            trackEvent(
              LobbyPostDateEvents.VIDEO_DATE_RECONNECT_GRACE_RECOVERED,
              {
                platform: "web",
                session_id: sessionId,
                event_id: truthRow.event_id ?? eventId,
                reason,
              },
            );
            optionsRef.current?.onPartnerTransientRecover?.();
            if (reconnectRecoveryResetTimeoutRef.current) {
              clearTimeout(reconnectRecoveryResetTimeoutRef.current);
            }
            reconnectRecoveryResetTimeoutRef.current = setTimeout(() => {
              reconnectRecoveryResetTimeoutRef.current = null;
              if (!reconnectGraceActiveRef.current) {
                setDailyReconnectState("connected");
              }
            }, 1200);
          } else {
            setDailyReconnectState("connected");
          }
        };

        const startReconnectGrace = (reason: string) => {
          if (!isCurrentDailyListener()) return;
          if (reconnectGraceActiveRef.current) {
            logTransportState("daily_transport_reconnecting", {
              reason,
              duplicate: true,
            });
            return;
          }
          reconnectGraceActiveRef.current = true;
          reconnectSyncRequestedRef.current = false;
          const deadlineMs = Date.now() + DAILY_TRANSPORT_RECONNECT_GRACE_MS;
          const remainingSeconds = () =>
            Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));
          const expireGrace = () => {
            if (!reconnectGraceActiveRef.current) return;
            clearReconnectGraceTimers();
            reconnectGraceActiveRef.current = false;
            reconnectSyncRequestedRef.current = false;
            setReconnectGraceTimeLeft(0);
            setDailyReconnectState("failed_after_grace");
            logTransportState("reconnect_grace_expired", { reason });
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_RECONNECT_EXPIRED, {
              platform: "web",
              session_id: sessionId,
              event_id: truthRow.event_id ?? eventId,
              reason,
            });
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_RECONNECT_GRACE_EXPIRED, {
              platform: "web",
              session_id: sessionId,
              event_id: truthRow.event_id ?? eventId,
              reason,
            });
            if (!reconnectPartnerAwayTriggeredRef.current) {
              reconnectPartnerAwayTriggeredRef.current = true;
              optionsRef.current?.onPartnerLeft?.();
            }
          };
          setDailyReconnectState("interrupted");
          setReconnectGraceTimeLeft(remainingSeconds());
          logTransportState("daily_transport_disconnected", { reason });
          logTransportState("reconnect_grace_started", {
            reason,
            graceMs: DAILY_TRANSPORT_RECONNECT_GRACE_MS,
          });
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_RECONNECT_GRACE_STARTED, {
            platform: "web",
            session_id: sessionId,
            event_id: truthRow.event_id ?? eventId,
            reason,
          });
          optionsRef.current?.onPartnerTransientDisconnect?.();
          void syncReconnectOnce(reason);
          if (
            !reason.startsWith("daily_token") &&
            shouldRefreshDailyTokenBeforeReconnect(roomData.token_expires_at) &&
            !dailyTokenRecoveryInFlightRef.current
          ) {
            void recoverDailyTokenAndRejoin(
              "daily_token_refresh_before_expiry",
              new Error(`near_expiry_reconnect:${reason}`),
            );
          }

          reconnectGraceTickerRef.current = setInterval(() => {
            const next = remainingSeconds();
            setReconnectGraceTimeLeft(next);
            if (next <= 0) expireGrace();
          }, 1000);

          reconnectGraceTimeoutRef.current = setTimeout(
            expireGrace,
            DAILY_TRANSPORT_RECONNECT_GRACE_MS,
          );
        };

        const recoverTransport = (reason: string) => {
          if (!isCurrentDailyListener()) return;
          if (!reconnectGraceActiveRef.current) {
            reconnectSyncRequestedRef.current = false;
            setReconnectGraceTimeLeft(0);
            setDailyReconnectState("connected");
            return;
          }
          setDailyReconnectState("partner_reconnecting");
          clearReconnectGrace(reason, true);
          if (reconnectPartnerAwayTriggeredRef.current) {
            reconnectPartnerAwayTriggeredRef.current = false;
            const returnArgs = {
              p_session_id: sessionId,
              p_action: "mark_reconnect_return",
            };
            vdbg("video_date_transition_before", {
              action: "mark_reconnect_return",
              args: returnArgs,
              reason,
            });
            void supabase
              .rpc("video_date_transition", returnArgs)
              .then(({ data, error }) => {
                const payload =
                  data && typeof data === "object" && !Array.isArray(data)
                    ? (data as Record<string, unknown>)
                    : null;
                const failsoftRejected = payload?.success === false;
                const terminalSurvey =
                  videoDateLifecycleRpcIndicatesTerminalSurvey(payload);
                const terminalStop =
                  terminalSurvey ||
                  videoDateLifecycleRpcIndicatesTerminalStop(payload);
                vdbg("video_date_transition_after", {
                  action: "mark_reconnect_return",
                  ok: !error && !failsoftRejected,
                  payload: data ?? null,
                  error: error
                    ? { code: error.code, message: error.message }
                    : null,
                  reason,
                });
                if (terminalStop) {
                  clearDailyAliveHeartbeatTimer(
                    "mark_reconnect_return_terminal_truth",
                  );
                }
                if (terminalSurvey) {
                  optionsRef.current?.onTerminalSurveyTruth?.(
                    "mark_reconnect_return_terminal_survey_truth",
                  );
                }
              });
          }
          void syncReconnectOnce(`${reason}_recovered`);
        };

        const scheduleDailyTokenRefresh = (source: string) => {
          clearDailyTokenRefreshTimer();
          const tokenRecovery = adviseVideoDateTokenRecovery({
            trigger: "active_refresh_timer",
            tokenExpiresAtIso: roomData.token_expires_at,
            platform: "web",
            surface: "video_date",
          });
          const delayMs =
            tokenRecovery.action === "refresh_token"
              ? (tokenRecovery.retryAfterMs ?? 0)
              : null;
          if (delayMs == null) {
            vdbg("daily_token_refresh_schedule_skipped", {
              sessionId,
              eventId: truthRow.event_id ?? eventId,
              userId,
              roomName: roomData.room_name,
              source,
              reason: tokenRecovery.reason,
            });
            return;
          }
          vdbg("daily_token_refresh_scheduled", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            roomName: roomData.room_name,
            tokenExpiresAt: roomData.token_expires_at ?? null,
            delayMs,
            source,
          });
          dailyTokenRefreshTimerRef.current = setTimeout(() => {
            dailyTokenRefreshTimerRef.current = null;
            void recoverDailyTokenAndRejoin(
              "daily_token_refresh_before_expiry",
            );
          }, delayMs);
        };

        const recoverDailyTokenAndRejoin = async (
          sourceAction: DailyTokenRefreshSourceAction,
          cause?: unknown,
        ): Promise<boolean> => {
          if (!isCurrentDailyListener()) return false;
          if (dailyTokenRecoveryInFlightRef.current) return false;
          const activeCall = callObjectRef.current;
          if (
            !activeCall ||
            activeCall !== callObject ||
            activeCallSessionIdRef.current !== sessionId
          ) {
            return false;
          }

          dailyTokenRecoveryInFlightRef.current = true;
          clearDailyTokenRefreshTimer();
          setIsConnecting(true);
          vdbg("daily_token_rejoin_start", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            roomName: roomData.room_name,
            sourceAction,
          });
          try {
            const refreshed = await refreshDailyTokenForJoin(
              sourceAction,
              cause,
            );
            if (!refreshed) {
              if (
                isCurrentDailyListener() &&
                callObjectRef.current === activeCall
              ) {
                setIsConnecting(false);
                const refreshFailure = getLastDailyTokenRefreshFailure();
                if (refreshFailure?.kind === "terminal") {
                  clearDailyTokenRefreshTimer();
                  setIsConnected(false);
                  setPeerMissing({ terminal: false });
                  logTransportState("daily_token_refresh_terminal_truth", {
                    sourceAction,
                    error: refreshFailure.error,
                    phase: refreshFailure.phase,
                  });
                  void cleanupCallObject(
                    "daily_token_refresh",
                    "daily_token_refresh_terminal",
                  );
                  void fetchVideoDateTruth(sessionId).then(({ truth }) => {
                    vdbg("daily_token_refresh_terminal_truth_refetched", {
                      sessionId,
                      eventId: truthRow.event_id ?? eventId,
                      userId,
                      sourceAction,
                      truth: truth ?? null,
                    });
                  });
                } else if (refreshFailure?.kind === "rate_limited") {
                  const retryAfterMs = refreshFailure.retryAfterMs ?? 30_000;
                  logTransportState("daily_token_refresh_rate_limited", {
                    sourceAction,
                    error: refreshFailure.error,
                    retryAfterMs,
                  });
                  dailyTokenRefreshTimerRef.current = setTimeout(() => {
                    dailyTokenRefreshTimerRef.current = null;
                    void recoverDailyTokenAndRejoin(sourceAction, cause);
                  }, retryAfterMs);
                  startReconnectGrace("daily_token_refresh_rate_limited");
                } else {
                  startReconnectGrace("daily_token_refresh_failed");
                }
              }
              return false;
            }
            if (
              !isCurrentDailyListener() ||
              callObjectRef.current !== activeCall
            ) {
              return false;
            }
            try {
              await activeCall.leave();
            } catch (leaveError) {
              vdbg("daily_token_rejoin_leave_failed", {
                sessionId,
                eventId: truthRow.event_id ?? eventId,
                userId,
                roomName: roomData.room_name,
                sourceAction,
                error:
                  leaveError instanceof Error
                    ? { name: leaveError.name, message: leaveError.message }
                    : String(leaveError),
              });
            }
            setDailyMeetingState("joining-meeting");
            setLocalInDailyRoom(false);
            await activeCall.join({
              url: roomData.room_url,
              token: roomData.token,
            });
            activeCallSessionIdRef.current = sessionId;
            setDailyMeetingState(
              safeMeetingState(activeCall) ?? "joined-meeting",
            );
            setLocalInDailyRoom(true);
            setIsConnected(true);
            setIsConnecting(false);
            recoverTransport("daily_token_rejoin");
            scheduleDailyTokenRefresh("daily_token_rejoin_success");
            vdbg("daily_token_rejoin_success", {
              sessionId,
              eventId: truthRow.event_id ?? eventId,
              userId,
              roomName: roomData.room_name,
              sourceAction,
              tokenExpiresAt: roomData.token_expires_at ?? null,
            });
            return true;
          } catch (error) {
            vdbg("daily_token_rejoin_failed", {
              sessionId,
              eventId: truthRow.event_id ?? eventId,
              userId,
              roomName: roomData.room_name,
              sourceAction,
              error:
                error instanceof Error
                  ? { name: error.name, message: error.message }
                  : String(error),
            });
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_FAILURE, {
              platform: "web",
              session_id: sessionId,
              event_id: truthRow.event_id ?? eventId,
              source_surface: "video_date_daily",
              source_action: sourceAction,
              code: "daily_token_rejoin_failed",
              reason_code: "daily_token_rejoin_failed",
              failure_class: classifyDailyRoomTokenFailureClass("network"),
              retryable: true,
              attempt_count: 1,
            });
            if (isCurrentDailyListener()) {
              setIsConnecting(false);
              startReconnectGrace("daily_token_rejoin_failed");
            }
            return false;
          } finally {
            dailyTokenRecoveryInFlightRef.current = false;
          }
        };

        bindDailyEvent("participant-joined", (event) => {
          if (!isCurrentDailyListener()) return;
          if (event && !event.participant?.local) {
            recoverTransport("participant_joined");
            latestRemoteParticipantRef.current = event.participant;
            resetRemoteRenderRecoveryForParticipant(event.participant);
            if (!firstRemoteObservedRef.current) {
              firstRemoteObservedRef.current = true;
              clearFirstRemoteWatchdog();
              vdbg("first_remote_participant_seen", {
                sessionId,
                eventId: truthRow.event_id ?? eventId,
                userId,
                roomName: roomData.room_name,
                source: "participant_joined",
              });
              const latencyContext = recordReadyGateToDateLatencyCheckpoint({
                sessionId,
                platform: "web",
                eventId: truthRow.event_id ?? eventId,
                sourceSurface: "video_date_daily",
                checkpoint: "remote_seen",
                entryAttemptId,
                videoDateTraceId,
                cachedPrepareEntry: roomResult.cached,
                providerVerifySkipped: roomData.provider_verify_skipped ?? null,
              });
              const latencyPayload = buildReadyGateToDateLatencyPayload({
                context: latencyContext,
                checkpoint: "remote_seen",
                sourceAction: "participant_joined",
                outcome: "success",
              });
              trackEvent(
                LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
                latencyPayload,
              );
              trackEvent(LobbyPostDateEvents.VIDEO_DATE_REMOTE_SEEN, {
                platform: "web",
                session_id: sessionId,
                event_id: truthRow.event_id ?? eventId,
                source_surface: "video_date_daily",
                source_action: "participant_joined",
                source: "participant_joined",
                duration_ms: latencyPayload.bothReadyToRemoteSeenMs,
                latency_bucket: latencyPayload.latency_bucket,
              });
            }
            setIsConnected(true);
            setIsConnecting(false);
            setPeerMissing({ terminal: false });
            toast.success("You're both here. Starting gently.");
            optionsRef.current?.onPartnerJoined?.();
            attachTracks(event.participant, remoteVideoRef.current, false);
          }
        });

        bindDailyEvent("participant-updated", (event) => {
          if (!isCurrentDailyListener()) return;
          if (!event?.participant) return;
          if (event.participant.local) {
            setDailyMeetingState(safeMeetingState(callObject));
            setLocalInDailyRoom(
              safeMeetingState(callObject) === "joined-meeting",
            );
            latestLocalParticipantRef.current = event.participant;
            const localKey = getTrackIdsKey(event.participant, false);
            const localKeyChanged = localKey !== lastLocalTrackIdsRef.current;
            if (localKeyChanged) {
              const newStream = buildStreamFromParticipant(event.participant, {
                includeAudio: false,
              });
              lastLocalTrackIdsRef.current = localKey;
              lastLocalStreamRef.current = newStream;
              setLocalStream(newStream);
              vdbg("daily_local_tracks_changed", {
                sessionId,
                eventId: truthRow.event_id ?? eventId,
                userId,
                key: localKey,
              });
            }
            if (
              localVideoRef.current &&
              (localKeyChanged ||
                needsTrackReattach(
                  localVideoRef.current,
                  event.participant,
                  true,
                ))
            ) {
              attachTracks(event.participant, localVideoRef.current, true);
              logTrackMounted("participant_updated", {
                isLocal: true,
                participant: event.participant,
                roomName: roomData.room_name ?? null,
              });
            }
          } else {
            recoverTransport("participant_updated");
            latestRemoteParticipantRef.current = event.participant;
            resetRemoteRenderRecoveryForParticipant(event.participant);
            if (!firstRemoteObservedRef.current) {
              firstRemoteObservedRef.current = true;
              clearFirstRemoteWatchdog();
              vdbg("first_remote_participant_seen", {
                sessionId,
                eventId: truthRow.event_id ?? eventId,
                userId,
                roomName: roomData.room_name,
                source: "participant_updated",
              });
              const latencyContext = recordReadyGateToDateLatencyCheckpoint({
                sessionId,
                platform: "web",
                eventId: truthRow.event_id ?? eventId,
                sourceSurface: "video_date_daily",
                checkpoint: "remote_seen",
                entryAttemptId,
                videoDateTraceId,
                cachedPrepareEntry: roomResult.cached,
                providerVerifySkipped: roomData.provider_verify_skipped ?? null,
              });
              const latencyPayload = buildReadyGateToDateLatencyPayload({
                context: latencyContext,
                checkpoint: "remote_seen",
                sourceAction: "participant_updated",
                outcome: "success",
              });
              trackEvent(
                LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
                latencyPayload,
              );
              trackEvent(LobbyPostDateEvents.VIDEO_DATE_REMOTE_SEEN, {
                platform: "web",
                session_id: sessionId,
                event_id: truthRow.event_id ?? eventId,
                source_surface: "video_date_daily",
                source_action: "participant_updated",
                source: "participant_updated",
                duration_ms: latencyPayload.bothReadyToRemoteSeenMs,
                latency_bucket: latencyPayload.latency_bucket,
              });
            }
            const remoteKey = getTrackIdsKey(event.participant, true);
            const remoteKeyChanged =
              remoteKey !== lastRemoteTrackIdsRef.current;
            let remoteRenderValidationSource = remoteKeyChanged
              ? "participant_updated_track_changed"
              : "participant_updated_same_track";
            const cameraSwitchRenderWatch =
              activeRemoteCameraSwitchRenderWatchRef.current;
            const cameraSwitchRenderWatchActive = Boolean(
              cameraSwitchRenderWatch &&
              cameraSwitchRenderWatch.expiresAtMs > Date.now(),
            );
            if (cameraSwitchRenderWatch && !cameraSwitchRenderWatchActive) {
              activeRemoteCameraSwitchRenderWatchRef.current = null;
            }
            if (remoteKeyChanged) {
              lastRemoteTrackIdsRef.current = remoteKey;
              resetRemoteRenderRecoveryAttempts();
              if (remoteVideoRef.current) {
                attachTracks(event.participant, remoteVideoRef.current, false);
                logTrackMounted("participant_updated", {
                  isLocal: false,
                  participant: event.participant,
                  roomName: roomData.room_name ?? null,
                });
              }
              lastRemoteStreamRef.current = null;
              vdbg("daily_remote_tracks_changed", {
                sessionId,
                eventId: truthRow.event_id ?? eventId,
                userId,
                key: remoteKey,
              });
            } else if (
              remoteVideoRef.current &&
              needsTrackReattach(
                remoteVideoRef.current,
                event.participant,
                false,
              )
            ) {
              remoteRenderValidationSource = "participant_updated_reattach";
              attachTracks(event.participant, remoteVideoRef.current, false);
              logTrackMounted("participant_updated_reattach", {
                isLocal: false,
                participant: event.participant,
                roomName: roomData.room_name ?? null,
              });
            }
            const sameTrackCameraSwitchCandidate =
              !remoteKeyChanged &&
              remoteRenderValidationSource === "participant_updated_same_track";
            const useFreshFrameGuard =
              cameraSwitchRenderWatchActive || sameTrackCameraSwitchCandidate;
            const freshFrameGuardBaseline = useFreshFrameGuard
              ? readRemoteRenderFrameState(remoteVideoRef.current)
              : null;
            if (
              cameraSwitchRenderWatchActive &&
              !remoteKeyChanged &&
              remoteKey
            ) {
              // Hint receiver already armed the freshness watcher for this
              // switchId. Don't double-arm and do NOT tear down srcObject;
              // the persistentTrack is still live and decoding the new camera
              // frames as soon as the next keyframe arrives.
              vdbg("daily_camera_switch_render_watch_participant_update", {
                sessionId,
                eventId: truthRow.event_id ?? eventId,
                userId,
                switchId: cameraSwitchRenderWatch?.switchId ?? null,
                remoteRenderValidationSource,
                remoteKey,
                freshFrameBaseline: freshFrameGuardBaseline,
              });
            } else {
              scheduleRemoteRenderValidation(
                event.participant,
                cameraSwitchRenderWatchActive
                  ? `${remoteRenderValidationSource}_camera_switch_watch`
                  : remoteRenderValidationSource,
                roomData.room_name ?? null,
                cameraSwitchRenderWatchActive
                  ? "camera_switch_hint"
                  : remoteRenderValidationSource,
                useFreshFrameGuard
                  ? {
                      requireFreshFrame: true,
                      freshFrameBaseline: freshFrameGuardBaseline,
                      freshFrameTimeoutMs:
                        REMOTE_CAMERA_SWITCH_FRESH_FRAME_TIMEOUT_MS,
                    }
                  : undefined,
              );
            }
          }
        });

        bindDailyEvent("participant-left", (event) => {
          if (!isCurrentDailyListener()) return;
          if (event && !event.participant?.local) {
            clearRemoteRenderValidation({ cancelReattach: true });
            resetRemoteRenderRecoveryAttempts();
            lastRemoteRenderParticipantIdRef.current = null;
            lastRemoteCameraSwitchHintIdRef.current = null;
            activeRemoteCameraSwitchRenderWatchRef.current = null;
            setIsConnected(false);
            if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
            setRemotePlayback(createRemotePlaybackState());
            if (!reconnectGraceActiveRef.current) {
              startReconnectGrace("participant_left");
            }
            setDailyReconnectState("partner_left_grace");
            logTransportState(
              "daily_partner_left_deferred_until_transport_grace",
              {
                reason: "participant_left",
                graceMs: DAILY_TRANSPORT_RECONNECT_GRACE_MS,
              },
            );
            if (reconnectGraceActiveRef.current) {
              logTransportState("daily_transport_reconnecting", {
                reason: "participant_left_during_grace",
              });
            }
          }
        });

        bindDailyEvent("error", (event) => {
          if (!isCurrentDailyListener()) return;
          setDailyMeetingState(safeMeetingState(callObject) ?? "error");
          console.error("[Daily] Fatal error:", event);
          const errorMsg =
            event && typeof event === "object" && "errorMsg" in event
              ? String((event as { errorMsg?: unknown }).errorMsg)
              : undefined;
          vdbg("daily_call_error", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            roomName: roomData.room_name,
            errorMsg: errorMsg ?? null,
          });
          if (isVideoDateDailyMeetingEnded(event)) {
            clearDailyTokenRefreshTimer();
            logTransportState("daily_meeting_ended_truth_refetch", {
              errorMsg: errorMsg ?? null,
            });
            void cleanupCallObject("daily_error", "daily_meeting_ended_event");
            void fetchVideoDateTruth(sessionId).then(({ truth, error }) => {
              vdbg("daily_meeting_ended_truth_refetched", {
                sessionId,
                eventId: truthRow.event_id ?? eventId,
                userId,
                truth: truth ?? null,
                error: error
                  ? { code: error.code, message: error.message }
                  : null,
              });
            });
            setIsConnecting(false);
            setIsConnected(false);
            return;
          }
          const sourceAction = (errorMsg ?? "").toLowerCase().includes("eject")
            ? "daily_token_refresh_after_ejection"
            : "daily_token_refresh_after_auth_error";
          if (
            adviseVideoDateTokenRecovery({
              trigger:
                sourceAction === "daily_token_refresh_after_ejection"
                  ? "ejection"
                  : "auth_error",
              error: event,
              platform: "web",
              surface: "video_date",
            }).action === "refresh_token"
          ) {
            void recoverDailyTokenAndRejoin(sourceAction, event);
            return;
          }
          const lowered = (errorMsg ?? "").toLowerCase();
          if (lowered.includes("stale")) {
            logTransportState("daily_ws_stale", { errorMsg: errorMsg ?? null });
            startReconnectGrace("daily_ws_stale");
            return;
          }
          if (lowered.includes("reconnect") || lowered.includes("transport")) {
            startReconnectGrace("daily_transport_error");
            return;
          }
          toast.error("Connection error. Please try again.");
          setIsConnecting(false);
          setIsConnected(false);
        });

        bindDailyEvent("left-meeting", () => {
          if (!isCurrentDailyListener()) return;
          const ownerBeforeLeft = userId
            ? getVideoDateEntryOwner(sessionId, userId)
            : null;
          const providerSessionId = readDailyProviderSessionId(callObject);
          if (
            userId &&
            ownerBeforeLeft &&
            activeCallSessionIdRef.current === sessionId
          ) {
            updateVideoDateDailyOwnerState({
              sessionId,
              userId,
              ownerId: ownerBeforeLeft.ownerId,
              roomName: roomData.room_name,
              state: "lost",
              source: "daily_owner_provider_left_unexpected",
              entryAttemptId: ownerBeforeLeft.entryAttemptId ?? null,
              videoDateTraceId: ownerBeforeLeft.videoDateTraceId ?? null,
              providerSessionId,
            });
          }
          setDailyMeetingState("left-meeting");
          setLocalInDailyRoom(false);
          clearReconnectGrace("left_meeting", false);
          clearRemoteRenderValidation({ cancelReattach: true });
          resetRemoteRenderRecoveryAttempts();
          lastRemoteRenderParticipantIdRef.current = null;
          lastRemoteCameraSwitchHintIdRef.current = null;
          activeRemoteCameraSwitchRenderWatchRef.current = null;
          vdbg("daily_call_left_meeting", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            roomName: roomData.room_name,
          });
          setIsConnected(false);
          setIsConnecting(false);
          setRemotePlayback((prev) => ({
            ...prev,
            participantPresent: false,
            mediaAttached: false,
            playSucceeded: false,
            firstFrameRendered: false,
          }));
        });

        bindDailyEvent(
          "network-connection",
          (event: { event?: string } | undefined) => {
            if (!isCurrentDailyListener()) return;
            if (event?.event === "interrupted") {
              logTransportState("daily_network_interrupted", {
                networkEvent: event.event,
              });
              startReconnectGrace("network_interrupted");
              return;
            }
            if (event?.event === "reconnecting") {
              startReconnectGrace("network_reconnecting");
              setDailyReconnectState("partner_reconnecting");
              logTransportState("daily_transport_reconnecting", {
                networkEvent: event.event,
              });
              return;
            }
            if (
              event?.event === "reconnected" ||
              event?.event === "connected"
            ) {
              recoverTransport(`network_${event.event}`);
            }
          },
        );

        bindDailyEvent("nonfatal-error", (event) => {
          if (!isCurrentDailyListener()) return;
          logTransportState("daily_nonfatal_error", {
            event:
              event && typeof event === "object"
                ? JSON.parse(JSON.stringify(event))
                : String(event),
          });
          if (
            adviseVideoDateTokenRecovery({
              trigger: "auth_error",
              error: event,
              platform: "web",
              surface: "video_date",
            }).action === "refresh_token"
          ) {
            void recoverDailyTokenAndRejoin(
              "daily_token_refresh_after_auth_error",
              event,
            );
          }
        });

        bindDailyEvent("app-message", (event) => {
          if (!isCurrentDailyListener()) return;
          const hint = parseVideoDateCameraSwitchRenderHint(
            event && typeof event === "object" && "data" in event
              ? (event as { data?: unknown }).data
              : undefined,
          );
          logTransportState("daily_app_message", {
            hasData: Boolean(
              event && typeof event === "object" && "data" in (event as object),
            ),
            isCameraSwitchRenderHint: Boolean(hint),
          });
          if (!hint) return;

          const fromId =
            event && typeof event === "object" && "fromId" in event
              ? String((event as { fromId?: unknown }).fromId ?? "")
              : "";
          const localSessionId =
            latestLocalParticipantRef.current?.session_id ??
            callObject.participants().local?.session_id ??
            "";
          if (fromId && localSessionId && fromId === localSessionId) {
            vdbg("daily_camera_switch_render_hint_ignored", {
              sessionId,
              eventId: truthRow.event_id ?? eventId,
              userId,
              switchId: hint.switchId,
              sourcePlatform: hint.sourcePlatform,
              reason: "self_origin",
            });
            return;
          }

          const participant = latestRemoteParticipantRef.current;
          const isNewCameraSwitchHint =
            lastRemoteCameraSwitchHintIdRef.current !== hint.switchId;
          const freshFrameBaseline = readRemoteRenderFrameState(
            remoteVideoRef.current,
          );
          activeRemoteCameraSwitchRenderWatchRef.current = {
            switchId: hint.switchId,
            expiresAtMs: Date.now() + REMOTE_CAMERA_SWITCH_RENDER_WATCH_TTL_MS,
          };
          if (isNewCameraSwitchHint) {
            lastRemoteCameraSwitchHintIdRef.current = hint.switchId;
            resetRemoteRenderRecoveryAttempts();
          }
          vdbg("daily_camera_switch_render_hint_received", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            switchId: hint.switchId,
            sourcePlatform: hint.sourcePlatform,
            facingMode: hint.facingMode,
            commitConfirmed: hint.commitConfirmed,
            commitMethod: hint.commitMethod,
            localVideoTrackId: hint.localVideoTrackId,
            commitLatencyMs: hint.commitLatencyMs,
            fromId: fromId || null,
            hasRemoteParticipant: Boolean(participant),
            isNewCameraSwitchHint,
            freshFrameBaseline,
          });
          vdbg("daily_camera_switch_render_watch_started", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            switchId: hint.switchId,
            sourcePlatform: hint.sourcePlatform,
            facingMode: hint.facingMode,
            isNewCameraSwitchHint,
            freshFrameBaseline,
            watchTtlMs: REMOTE_CAMERA_SWITCH_RENDER_WATCH_TTL_MS,
            freshFrameTimeoutMs: REMOTE_CAMERA_SWITCH_FRESH_FRAME_TIMEOUT_MS,
          });
          // Daily's cycleCamera / setCamera (and replaceTrack on the wire) keep
          // the receiver's persistentTrack live; only the underlying camera
          // source changes. Tearing down `srcObject` and rebinding the same
          // track destroys the decoder pipeline and forces the receiver to
          // wait for the next periodic keyframe (multi-second on Safari /
          // cellular), which is exactly the "black screen" symptom this fix
          // exists to prevent. So: do NOT call forceRemoteMediaReattach on
          // hint receipt. Arm the freshness watcher instead, with a longer
          // timeout that covers a natural keyframe interval. If frames still
          // don't arrive after the watchdog, the validator escalates to one
          // last-resort reattach via its existing timeout path.
          scheduleRemoteRenderValidation(
            participant,
            "app_message_camera_switch_hint",
            roomData.room_name ?? null,
            "camera_switch_hint",
            {
              requireFreshFrame: true,
              freshFrameBaseline,
              freshFrameTimeoutMs: REMOTE_CAMERA_SWITCH_FRESH_FRAME_TIMEOUT_MS,
            },
          );
        });

        bindDailyEvent(
          "network-quality-change",
          (event: { threshold?: string; quality?: number }) => {
            if (!isCurrentDailyListener()) return;
            setNetworkTier(tierFromNetworkQualityEvent(event));
          },
        );

        bindDailyEvent("camera-error", (event) => {
          if (!isCurrentDailyListener()) return;
          const rawErrorMsg =
            event && typeof event === "object" && "errorMsg" in event
              ? (event as { errorMsg?: unknown }).errorMsg
              : undefined;
          const errorMsg =
            typeof rawErrorMsg === "string"
              ? rawErrorMsg
              : rawErrorMsg &&
                  typeof rawErrorMsg === "object" &&
                  "errorMsg" in rawErrorMsg
                ? String((rawErrorMsg as { errorMsg?: unknown }).errorMsg ?? "")
                : undefined;
          const rawError =
            event && typeof event === "object" && "error" in event
              ? (event as { error?: unknown }).error
              : undefined;
          vdbg("daily_camera_error", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            errorMsg: errorMsg ?? null,
            error: rawError ?? null,
          });
          setHasPermission(false);
          void classifyMediaPermissionErrorWithBrowserState(
            rawError ??
              new Error(
                errorMsg ?? "Camera or microphone permission was denied.",
              ),
            "camera_microphone",
          ).then(setMediaPermissionResult);
          setMediaPermissionError(
            errorMsg ?? "Camera or microphone permission was denied.",
          );
          trackEvent(LobbyPostDateEvents.CAMERA_PERMISSION_DENIED, {
            platform: "web",
            session_id: sessionId,
            event_id: truthRow.event_id ?? eventId,
          });
          Sentry.captureMessage("daily_camera_error", {
            level: "error",
            extra: {
              errorName:
                rawError && typeof rawError === "object" && "name" in rawError
                  ? String((rawError as { name?: unknown }).name ?? "")
                  : null,
              errorMessage: errorMsg ?? null,
              meetingState: safeMeetingState(callObject),
              sessionId,
              eventId: truthRow.event_id ?? eventId ?? null,
            },
          });
        });

        bindDailyEvent("track-stopped", (event) => {
          if (!isCurrentDailyListener()) return;
          if (!event?.participant?.local) return;
          vdbg("daily_local_track_stopped", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            trackKind: event?.track?.kind ?? null,
            participantSessionId: event?.participant?.session_id ?? null,
          });
        });

        const dailyJoinStartedAtMs = Date.now();
        dailyJoinStartedAtMsRef.current = dailyJoinStartedAtMs;
        latchSameSessionDailyContinuity(sessionId, "daily_join_started");
        const dailyCallInstanceId = `${entryAttemptId ?? sessionId}:${startAttemptNonceRef.current}`;
        const entryOwner = userId
          ? getVideoDateEntryOwner(sessionId, userId)
          : null;
        if (userId) {
          updateVideoDateEntryOwnerState({
            sessionId,
            userId,
            ownerId: entryOwner?.ownerId ?? null,
            state: "joining",
            source: "daily_join_started",
            roomName: roomData.room_name,
            entryAttemptId:
              entryAttemptId ?? entryOwner?.entryAttemptId ?? null,
            videoDateTraceId:
              videoDateTraceId ?? entryOwner?.videoDateTraceId ?? null,
            callInstanceId: dailyCallInstanceId,
          });
          updateVideoDateDailyOwnerState({
            sessionId,
            userId,
            ownerId: entryOwner?.ownerId ?? null,
            roomName: roomData.room_name,
            state: "joining",
            source: "daily_join_started",
            entryAttemptId:
              entryAttemptId ?? entryOwner?.entryAttemptId ?? null,
            videoDateTraceId:
              videoDateTraceId ?? entryOwner?.videoDateTraceId ?? null,
            callInstanceId: dailyCallInstanceId,
          });
        }
        const prepareToJoinStartMs = Math.max(
          0,
          dailyJoinStartedAtMs - roomResult.cacheEntry.prepareFinishedAtMs,
        );
        const joinStartLatencyContext = recordReadyGateToDateLatencyCheckpoint({
          sessionId,
          platform: "web",
          eventId: truthRow.event_id ?? eventId,
          sourceSurface: "video_date_daily",
          checkpoint: "daily_join_started",
          nowMs: dailyJoinStartedAtMs,
          attemptCount: opts?.internalRetry ? 2 : 1,
          entryAttemptId,
          videoDateTraceId,
          cachedPrepareEntry: roomResult.cached,
          providerVerifySkipped: roomData.provider_verify_skipped ?? null,
          mediaHandoffUsed: lastMediaHandoffUsedRef.current,
          mediaHandoffMissReason: lastMediaHandoffMissReasonRef.current,
          preparedEntryUsed: roomResult.preparedEntryUsed,
          preparedEntryMissReason: roomResult.preparedEntryMissReason,
          dailyPrewarmConsumed: prewarmedCall.ok === true,
          dailyPrewarmFallbackReason:
            prewarmedCall.ok === true ? null : prewarmedCall.reason,
          joinAlreadyInFlight:
            Boolean(prewarmedJoinPromise && !prewarmedAlreadyJoined) ||
            singletonJoinInFlight,
          alreadyJoined: prewarmedAlreadyJoined || singletonAlreadyJoined,
        });
        trackEvent(
          LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
          buildReadyGateToDateLatencyPayload({
            context: joinStartLatencyContext,
            checkpoint: "daily_join_started",
            sourceAction: opts?.internalRetry
              ? "daily_join_retry_started"
              : "daily_join_started",
            outcome: "success",
            attemptCount: opts?.internalRetry ? 2 : 1,
          }),
        );
        vdbg("daily_join_start", {
          sessionId,
          eventId: truthRow.event_id ?? eventId,
          userId,
          roomName: roomData.room_name,
          hasToken: Boolean(roomData.token),
          captureProfile: captureProfileForCall,
          prepareToJoinStartMs,
          cachedPrepareEntry: roomResult.cached,
          entryAttemptId,
          videoDateTraceId,
        });
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_JOIN_STARTED, {
          platform: "web",
          session_id: sessionId,
          event_id: truthRow.event_id ?? eventId,
          source_surface: "video_date_daily",
          source_action: opts?.internalRetry
            ? "daily_join_retry_started"
            : "daily_join_started",
          capture_profile: captureProfileForCall,
          prepareToJoinStartMs,
          duration_ms: prepareToJoinStartMs,
          latency_bucket: bucketVideoDateLatencyMs(prepareToJoinStartMs),
          attempt_count: opts?.internalRetry ? 2 : 1,
          cached_prepare_entry: roomResult.cached,
          entry_attempt_id: entryAttemptId,
          video_date_trace_id: videoDateTraceId,
          media_handoff_used: lastMediaHandoffUsedRef.current,
          media_handoff_miss_reason: lastMediaHandoffMissReasonRef.current,
          prepared_entry_used: roomResult.preparedEntryUsed,
          prepared_entry_miss_reason: roomResult.preparedEntryMissReason,
          daily_prewarm_consumed: prewarmedCall.ok === true,
          daily_prewarm_fallback_reason:
            prewarmedCall.ok === true ? null : prewarmedCall.reason,
          prewarmed_join_in_flight:
            Boolean(prewarmedJoinPromise && !prewarmedAlreadyJoined) ||
            singletonJoinInFlight,
          prewarmed_already_joined:
            prewarmedAlreadyJoined || singletonAlreadyJoined,
          daily_call_singleton_reused: singletonCall.ok === true,
          provider_verify_skipped: roomData.provider_verify_skipped ?? null,
        });
        if (singletonAlreadyJoined) {
          vdbg("daily_join_skipped_singleton_already_joined", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            roomName: roomData.room_name,
            parkingMode:
              singletonCall.ok === true
                ? singletonCall.entry.parkingMode
                : null,
          });
        } else if (singletonJoinInFlight) {
          const singletonJoinOk = await waitForDailyMeetingState(
            callObject,
            "joined-meeting",
            WEB_DAILY_CALL_SINGLETON_JOIN_WAIT_MS,
          );
          if (!singletonJoinOk)
            throw new Error("daily_singleton_join_wait_failed");
          vdbg("daily_join_completed_by_singleton_inflight", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            roomName: roomData.room_name,
            parkingMode:
              singletonCall.ok === true
                ? singletonCall.entry.parkingMode
                : null,
          });
        } else if (prewarmedAlreadyJoined) {
          vdbg("daily_join_skipped_prewarmed_already_joined", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            roomName: roomData.room_name,
            joinSource:
              prewarmedCall.ok === true ? prewarmedCall.entry.joinSource : null,
          });
        } else if (prewarmedJoinPromise) {
          const prewarmedJoinOk = await prewarmedJoinPromise;
          if (!prewarmedJoinOk) throw new Error("daily_prewarm_join_failed");
          vdbg("daily_join_completed_by_prewarm_inflight", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            roomName: roomData.room_name,
            joinSource:
              prewarmedCall.ok === true ? prewarmedCall.entry.joinSource : null,
          });
        } else {
          setDailyMeetingState("joining-meeting");
          try {
            await callObject.join({
              url: roomData.room_url,
              token: roomData.token,
            });
          } catch (joinError) {
            if (
              adviseVideoDateTokenRecovery({
                trigger: "auth_error",
                error: joinError,
                platform: "web",
                surface: "video_date",
              }).action === "refresh_token"
            ) {
              const refreshed = await refreshDailyTokenForJoin(
                "daily_token_refresh_join_retry",
                joinError,
              );
              if (refreshed) {
                await callObject.join({
                  url: roomData.room_url,
                  token: roomData.token,
                });
              } else {
                throw joinError;
              }
            } else {
              throw joinError;
            }
          }
        }
        const joinDurationMs = Date.now() - dailyJoinStartedAtMs;
        setHasPermission(true);
        activeCallSessionIdRef.current = sessionId;
        activeDailyCallIdentityRef.current = userId
          ? {
              sessionId,
              userId,
              ownerId: entryOwner?.ownerId ?? null,
              callInstanceId: dailyCallInstanceId,
              entryAttemptId:
                entryAttemptId ?? entryOwner?.entryAttemptId ?? null,
              videoDateTraceId:
                videoDateTraceId ?? entryOwner?.videoDateTraceId ?? null,
            }
          : null;
        latchSameSessionDailyContinuity(sessionId, "daily_join_success");
        setDailyMeetingState(safeMeetingState(callObject) ?? "joined-meeting");
        setLocalInDailyRoom(true);
        scheduleDailyTokenRefresh("daily_join_success");
        if (userId) {
          startDailyAliveHeartbeat({
            sessionId,
            userId,
            roomName: roomData.room_name,
            entryAttemptId,
            videoDateTraceId,
            callInstanceId: dailyCallInstanceId,
            source: "daily_join_success",
          });
        }
        vdbg("daily_join_success", {
          sessionId,
          eventId: truthRow.event_id ?? eventId,
          userId,
          roomName: roomData.room_name,
          captureProfile: captureProfileForCall,
          joinDurationMs,
          entryAttemptId,
          videoDateTraceId,
          callInstanceId: dailyCallInstanceId,
        });
        const joinSuccessLatencyContext =
          recordReadyGateToDateLatencyCheckpoint({
            sessionId,
            platform: "web",
            eventId: truthRow.event_id ?? eventId,
            sourceSurface: "video_date_daily",
            checkpoint: "daily_join_success",
            nowMs: Date.now(),
            attemptCount: opts?.internalRetry ? 2 : 1,
            entryAttemptId,
            videoDateTraceId,
            cachedPrepareEntry: roomResult.cached,
            providerVerifySkipped: roomData.provider_verify_skipped ?? null,
            mediaHandoffUsed: lastMediaHandoffUsedRef.current,
            mediaHandoffMissReason: lastMediaHandoffMissReasonRef.current,
            preparedEntryUsed: roomResult.preparedEntryUsed,
            preparedEntryMissReason: roomResult.preparedEntryMissReason,
            dailyPrewarmConsumed: prewarmedCall.ok === true,
            dailyPrewarmFallbackReason:
              prewarmedCall.ok === true ? null : prewarmedCall.reason,
            joinAlreadyInFlight:
              Boolean(prewarmedJoinPromise && !prewarmedAlreadyJoined) ||
              singletonJoinInFlight,
            alreadyJoined: prewarmedAlreadyJoined || singletonAlreadyJoined,
          });
        const joinSuccessPayload = buildReadyGateToDateLatencyPayload({
          context: joinSuccessLatencyContext,
          checkpoint: "daily_join_success",
          sourceAction: "daily_join_success",
          outcome: "success",
          durationMs:
            joinSuccessLatencyContext.readyGateOpenedAtMs == null
              ? joinDurationMs
              : undefined,
          attemptCount: opts?.internalRetry ? 2 : 1,
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
          platform: "web",
          session_id: sessionId,
          event_id: truthRow.event_id ?? eventId,
          source_surface: "video_date_daily",
          source_action: "daily_join_success",
          capture_profile: captureProfileForCall,
          joinDurationMs,
          duration_ms: joinDurationMs,
          latency_bucket: bucketVideoDateLatencyMs(joinDurationMs),
          attempt_count: opts?.internalRetry ? 2 : 1,
          bothReadyToDailyJoinMs: joinSuccessPayload.bothReadyToDailyJoinMs,
          prepareToJoinStartMs,
          cached_prepare_entry: roomResult.cached,
          entry_attempt_id: entryAttemptId,
          video_date_trace_id: videoDateTraceId,
          media_handoff_used: lastMediaHandoffUsedRef.current,
          media_handoff_miss_reason: lastMediaHandoffMissReasonRef.current,
          prepared_entry_used: roomResult.preparedEntryUsed,
          prepared_entry_miss_reason: roomResult.preparedEntryMissReason,
          daily_prewarm_consumed: prewarmedCall.ok === true,
          daily_prewarm_fallback_reason:
            prewarmedCall.ok === true ? null : prewarmedCall.reason,
          prewarmed_join_in_flight:
            Boolean(prewarmedJoinPromise && !prewarmedAlreadyJoined) ||
            singletonJoinInFlight,
          prewarmed_already_joined:
            prewarmedAlreadyJoined || singletonAlreadyJoined,
          daily_call_singleton_reused: singletonCall.ok === true,
          provider_verify_skipped: roomData.provider_verify_skipped ?? null,
        });
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_JOINED, {
          platform: "web",
          session_id: sessionId,
          event_id: truthRow.event_id ?? eventId,
          capture_profile: captureProfileForCall,
          entry_attempt_id: entryAttemptId,
          video_date_trace_id: videoDateTraceId,
          media_handoff_used: lastMediaHandoffUsedRef.current,
          media_handoff_miss_reason: lastMediaHandoffMissReasonRef.current,
          prepared_entry_used: roomResult.preparedEntryUsed,
          prepared_entry_miss_reason: roomResult.preparedEntryMissReason,
          daily_prewarm_consumed: prewarmedCall.ok === true,
          daily_prewarm_fallback_reason:
            prewarmedCall.ok === true ? null : prewarmedCall.reason,
        });

        const buildProviderBackedDailyJoinedArgs = () => {
          const providerSessionId = readDailyProviderSessionId(callObject);
          const meetingState = safeMeetingState(callObject);
          const providerBackedJoined =
            meetingState === "joined-meeting" && Boolean(providerSessionId);
          const entryOwner = userId
            ? getVideoDateEntryOwner(sessionId, userId)
            : null;
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
        vdbg("mark_video_date_daily_joined_before", {
          args: initialJoinedProof.args,
          sessionId,
          eventId: truthRow.event_id ?? eventId,
          userId,
          providerBackedJoined: initialJoinedProof.providerBackedJoined,
          providerSessionId: initialJoinedProof.providerSessionId,
          meetingState: initialJoinedProof.meetingState,
          ownerId: initialJoinedProof.ownerId,
          ownerState: initialJoinedProof.ownerState,
        });
        void markDailyJoinedWithBackoff({
          sleep,
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
              vdbg("mark_video_date_daily_joined_after", {
                sessionId,
                eventId: truthRow.event_id ?? eventId,
                userId,
                roomName: roomData.room_name,
                attempt,
                ok: false,
                payload,
                error: null,
              });
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
            vdbg("mark_video_date_daily_joined_after", {
              sessionId,
              eventId: truthRow.event_id ?? eventId,
              userId,
              roomName: roomData.room_name,
              attempt,
              ok,
              payload: joinedData ?? null,
              error: joinedError
                ? { code: joinedError.code, message: joinedError.message }
                : null,
              providerBackedJoined: joinedProof.providerBackedJoined,
              providerSessionId: joinedProof.providerSessionId,
              meetingState: joinedProof.meetingState,
              ownerId: joinedProof.ownerId,
              ownerState: joinedProof.ownerState,
            });
            if (terminalStop) {
              clearDailyAliveHeartbeatTimer("daily_joined_terminal_truth");
            }
            if (terminalSurvey) {
              optionsRef.current?.onTerminalSurveyTruth?.(
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
              trackEvent(
                LobbyPostDateEvents.MARK_VIDEO_DATE_DAILY_JOINED_FAILED,
                {
                  platform: "web",
                  session_id: sessionId,
                  event_id: truthRow.event_id ?? eventId,
                  code,
                  retryable,
                  will_retry: willRetry,
                  entry_attempt_id: entryAttemptId,
                  video_date_trace_id: videoDateTraceId,
                },
              );
              toast.info("Keeping your date state in sync...", {
                duration: 3000,
              });
            }
            if (attempt > 1) {
              vdbg("mark_video_date_daily_joined_retry_after_failure", {
                sessionId,
                eventId: truthRow.event_id ?? eventId,
                userId,
                attempt,
                ok,
                code,
                retryable,
                willRetry,
              });
            }
          },
        });

        const localParticipant = callObject.participants().local;
        if (localParticipant) {
          latestLocalParticipantRef.current = localParticipant;
          const localKey = getTrackIdsKey(localParticipant, false);
          if (localKey !== lastLocalTrackIdsRef.current) {
            const newStream = buildStreamFromParticipant(localParticipant, {
              includeAudio: false,
            });
            lastLocalTrackIdsRef.current = localKey;
            lastLocalStreamRef.current = newStream;
            setLocalStream(newStream);
            vdbg("daily_local_tracks_changed", {
              sessionId,
              eventId: truthRow.event_id ?? eventId,
              userId,
              key: localKey,
            });
          }
          if (localVideoRef.current) {
            attachTracks(localParticipant, localVideoRef.current, true);
            logTrackMounted("post_join_snapshot", {
              isLocal: true,
              participant: localParticipant,
              roomName: roomData.room_name ?? null,
            });
          }
          if (!localVideoReadyTrackedRef.current) {
            localVideoReadyTrackedRef.current = true;
            const localVideoContext = recordReadyGateToDateLatencyCheckpoint({
              sessionId,
              platform: "web",
              eventId: truthRow.event_id ?? eventId,
              sourceSurface: "video_date_daily",
              checkpoint: "local_video_ready",
            });
            trackEvent(
              LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
              buildReadyGateToDateLatencyPayload({
                context: localVideoContext,
                checkpoint: "local_video_ready",
                sourceAction: "post_join_snapshot",
                outcome: "success",
              }),
            );
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_LOCAL_VIDEO_READY, {
              platform: "web",
              session_id: sessionId,
              event_id: truthRow.event_id ?? eventId,
              source_surface: "video_date_daily",
              source_action: "post_join_snapshot",
            });
          }
        }

        const participants = callObject.participants();
        const remoteParticipants = Object.values(participants).filter(
          (p) => !p.local,
        );
        if (remoteParticipants.length > 0) {
          latestRemoteParticipantRef.current = remoteParticipants[0];
          resetRemoteRenderRecoveryForParticipant(remoteParticipants[0]);
          if (!firstRemoteObservedRef.current) {
            firstRemoteObservedRef.current = true;
            clearFirstRemoteWatchdog();
            vdbg("first_remote_participant_seen", {
              sessionId,
              eventId: truthRow.event_id ?? eventId,
              userId,
              roomName: roomData.room_name,
              source: "post_join_snapshot",
            });
            const latencyContext = recordReadyGateToDateLatencyCheckpoint({
              sessionId,
              platform: "web",
              eventId: truthRow.event_id ?? eventId,
              sourceSurface: "video_date_daily",
              checkpoint: "remote_seen",
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
              platform: "web",
              session_id: sessionId,
              event_id: truthRow.event_id ?? eventId,
              source_surface: "video_date_daily",
              source_action: "post_join_snapshot",
              source: "post_join_snapshot",
              duration_ms: latencyPayload.bothReadyToRemoteSeenMs,
              latency_bucket: latencyPayload.latency_bucket,
            });
          }
          setIsConnected(true);
          setIsConnecting(false);
          setPeerMissing({ terminal: false });
          toast.success("You're both here. Starting gently.");
          optionsRef.current?.onPartnerJoined?.();
          attachTracks(remoteParticipants[0], remoteVideoRef.current, false);
          logTrackMounted("post_join_snapshot", {
            isLocal: false,
            participant: remoteParticipants[0],
            roomName: roomData.room_name ?? null,
          });
        } else {
          vdbg("daily_no_remote_watchdog_start", {
            sessionId,
            eventId: truthRow.event_id ?? eventId,
            userId,
            roomName: roomData.room_name,
            timeoutMs: FIRST_REMOTE_TIMEOUT_MS,
            truthRefreshCount: peerMissingTruthRefreshCountRef.current,
          });
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_NO_REMOTE_WAIT_STARTED, {
            platform: "web",
            session_id: sessionId,
            event_id: truthRow.event_id ?? eventId,
            timeout_ms: FIRST_REMOTE_TIMEOUT_MS,
            truth_refresh_count: peerMissingTruthRefreshCountRef.current,
          });
          firstRemoteWatchdogRef.current = setTimeout(() => {
            firstRemoteWatchdogRef.current = null;
            if (
              startAttemptNonceRef.current !== startNonce ||
              !callObjectRef.current ||
              firstRemoteObservedRef.current
            ) {
              return;
            }
            peerMissingTruthRefreshCountRef.current += 1;
            const truthRefreshAttempt = peerMissingTruthRefreshCountRef.current;
            vdbg("daily_no_remote_watchdog_timeout", {
              sessionId,
              eventId: truthRow.event_id ?? eventId,
              userId,
              roomName: roomData.room_name,
              truthRefreshAttempt,
            });
            void fetchVideoDateTruth(sessionId).then(({ truth, error }) => {
              if (
                startAttemptNonceRef.current !== startNonce ||
                !callObjectRef.current ||
                firstRemoteObservedRef.current
              ) {
                return;
              }
              vdbg("daily_no_remote_watchdog_truth_refetched", {
                sessionId,
                eventId: truthRow.event_id ?? eventId,
                userId,
                roomName: roomData.room_name,
                truth: truth ?? null,
                error: error
                  ? { code: error.code, message: error.message }
                  : null,
                truthRefreshAttempt,
              });
              const hasTerminalSurveyTruth =
                videoSessionHasPostDateSurveyTruth(truth);
              const hasHistoricalRemoteSeenTruth =
                videoSessionHasEncounterExposureTruth(truth);
              if (hasTerminalSurveyTruth) {
                setPeerMissing({ terminal: false });
                setIsConnected(false);
                setIsConnecting(false);
                vdbg("daily_no_remote_watchdog_terminal_suppressed", {
                  sessionId,
                  eventId: truthRow.event_id ?? eventId,
                  userId,
                  roomName: roomData.room_name,
                  suppressedEventName: "peer_missing_suppressed_survey_truth",
                  hasTerminalSurveyTruth,
                  hasHistoricalRemoteSeenTruth,
                  truthRefreshAttempt,
                });
                optionsRef.current?.onTerminalSurveyTruth?.(
                  "peer_missing_watchdog_survey_truth",
                );
                return;
              }
              if (hasHistoricalRemoteSeenTruth) {
                setPeerMissing({ terminal: false });
                setIsConnecting(false);
                vdbg("daily_no_remote_watchdog_historical_truth_suppressed", {
                  sessionId,
                  eventId: truthRow.event_id ?? eventId,
                  userId,
                  roomName: roomData.room_name,
                  truthRefreshAttempt,
                });
                toast.info("Keeping your date in sync...");
                return;
              }
              setIsConnecting(false);
              setIsConnected(false);
              setPeerMissing({ terminal: true });
              trackEvent(
                LobbyPostDateEvents.VIDEO_DATE_NO_REMOTE_RECOVERY_FAILED,
                {
                  platform: "web",
                  session_id: sessionId,
                  event_id: truthRow.event_id ?? eventId,
                  truth_refresh_attempt: truthRefreshAttempt,
                },
              );
              toast.info(
                "They're not in the room yet. We'll keep this gentle.",
              );
            });
          }, FIRST_REMOTE_TIMEOUT_MS);
        }

        return { ok: true } as VideoCallStartResult;
      } catch (error) {
        console.error("[Daily] Failed to start call:", error);
        const preparedEntryAtFailure = activePreparedEntryCacheRef.current;
        vdbg("daily_join_failure", {
          sessionId,
          eventId,
          userId,
          roomName: roomNameRef.current,
          captureProfile: captureProfileRef.current,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : String(error),
          entryAttemptId: preparedEntryAtFailure?.entryAttemptId ?? null,
          videoDateTraceId:
            preparedEntryAtFailure?.value.video_date_trace_id ??
            preparedEntryAtFailure?.entryAttemptId ??
            null,
        });
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_JOIN_FAILURE, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId,
          source_surface: "video_date_daily",
          source_action: "daily_join_failure",
          capture_profile: captureProfileRef.current,
          reason: "daily_join_failed",
          reason_code: "daily_join_failed",
          entry_attempt_id: preparedEntryAtFailure?.entryAttemptId ?? null,
          video_date_trace_id:
            preparedEntryAtFailure?.value.video_date_trace_id ??
            preparedEntryAtFailure?.entryAttemptId ??
            null,
        });
        const failureContext = recordReadyGateToDateLatencyCheckpoint({
          sessionId,
          platform: "web",
          eventId,
          sourceSurface: "video_date_daily",
          checkpoint: "daily_join_failure",
          attemptCount: opts?.internalRetry ? 2 : 1,
        });
        trackEvent(
          LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
          buildReadyGateToDateLatencyPayload({
            context: failureContext,
            checkpoint: "daily_join_failure",
            sourceAction: "daily_join_failure",
            outcome: "failure",
            reasonCode: "daily_join_failed",
            attemptCount: opts?.internalRetry ? 2 : 1,
          }),
        );
        if (dailyPrewarmConsumedForJoin && userId) {
          markWebVideoDateDailyPrewarmFallback({
            sessionId,
            userId,
            eventId,
            reason: "daily_join_failed_after_prewarm_consumed",
          });
        }
        await cleanupCallObject("startCall", "start_failure");
        if (preparedEntryAtFailure && userId && !opts?.internalRetry) {
          rejectPreparedVideoDateEntry(
            sessionId,
            userId,
            "daily_join_failed",
            eventId,
          );
          vdbg("daily_join_failure_prepare_retry", {
            sessionId,
            eventId,
            userId,
            roomName: preparedEntryAtFailure.value.room_name,
            reason: "prepared_token_rejected_before_retry",
          });
          return await startCall(sessionId, {
            internalRetry: true,
            mediaPromptIntent,
            skipStartGate: true,
          });
        }
        setHasPermission(false);
        toast.error("Video is temporarily unavailable. Please try again.");
        setIsConnecting(false);
        return {
          ok: false,
          failure: { kind: "daily_join_failed", retryable: true },
        } as VideoCallStartResult;
      } finally {
        if (startCallInFlightSessionRef.current === sessionId) {
          startCallInFlightSessionRef.current = null;
        }
      }
    },
    [
      acquireDateRoom,
      activeCallSessionIdRef,
      activeDailyCallIdentityRef,
      activePreparedEntryCacheHitRef,
      activePreparedEntryCacheRef,
      activeRemoteCameraSwitchRenderWatchRef,
      appAcquiredMediaRef,
      attachTracks,
      callObjectRef,
      captureProfileRef,
      clearSameSessionDailyContinuity,
      cleanupCallObject,
      clearDailyAliveHeartbeatTimer,
      clearDailyEventListeners,
      clearDailyTokenRefreshTimer,
      clearFirstRemoteWatchdog,
      clearReconnectGraceTimers,
      dailyEventListenerCleanupsRef,
      dailyJoinStartedAtMsRef,
      dailyListenerGenerationRef,
      dailyTokenRecoveryInFlightRef,
      dailyTokenRefreshTimerRef,
      fetchVideoDateTruth,
      firstRemoteObservedRef,
      firstRemoteWatchdogRef,
      lastDailyPrewarmConsumedRef,
      lastDailyPrewarmFallbackReasonRef,
      lastLocalStreamRef,
      lastLocalTrackIdsRef,
      lastMediaHandoffMissReasonRef,
      lastMediaHandoffUsedRef,
      lastPrewarmedAlreadyJoinedRef,
      lastPrewarmedJoinInFlightRef,
      lastProviderVerifySkippedRef,
      lastRemoteCameraSwitchHintIdRef,
      lastRemoteRenderParticipantIdRef,
      lastRemoteStreamRef,
      lastRemoteTrackIdsRef,
      latchSameSessionDailyContinuity,
      latestLocalParticipantRef,
      latestRemoteParticipantRef,
      localVideoReadyTrackedRef,
      localVideoRef,
      logTrackMounted,
      needsTrackReattach,
      optionsRef,
      playbackBlockedRef,
      preflightMediaPermission,
      reconnectGraceActiveRef,
      reconnectGraceTickerRef,
      reconnectGraceTimeoutRef,
      reconnectPartnerAwayTriggeredRef,
      reconnectRecoveryResetTimeoutRef,
      reconnectSyncRequestedRef,
      releaseAppAcquiredMedia,
      remoteFirstFrameTrackedRef,
      remoteVideoRef,
      resetRemoteRenderRecoveryAttempts,
      resetRemoteRenderRecoveryForParticipant,
      roomNameRef,
      scheduleRemoteRenderValidation,
      setCaptureProfile,
      setDailyMeetingState,
      setDailyReconnectState,
      setHasPermission,
      setIsConnected,
      setIsConnecting,
      setLocalInDailyRoom,
      setLocalStream,
      setMediaPermissionError,
      setMediaPermissionResult,
      setNetworkTier,
      setPeerMissing,
      setReconnectGraceTimeLeft,
      setRemotePlayback,
      startDailyAliveHeartbeat,
      clearRemoteRenderValidation,
      waitForInFlightStartCall,
    ],
  );
  return {
    startCall,
  };
}

export type VideoDateStartCallApi = ReturnType<typeof useVideoDateStartCall>;
