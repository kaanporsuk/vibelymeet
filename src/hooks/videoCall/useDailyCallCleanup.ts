import { useCallback } from "react";
import { vdbg } from "@/lib/vdbg";
import { supabase } from "@/integrations/supabase/client";
import {
  isTerminalDailyMeetingState,
  registerWebVideoDateDailyCleanup,
} from "@/lib/dailyCallInstance";
import {
  createRemotePlaybackState,
  readDailyProviderSessionId,
  safeMeetingState,
  WEB_DAILY_CALL_LIVE_REMOUNT_IDLE_MS,
} from "@/lib/daily/webDailyMediaHelpers";
import {
  hasReusableWebDailyCallSingleton,
  parkWebDailyCallSingleton,
} from "@/lib/daily/webDailyCallSingleton";
import type { VideoCallSharedRuntime } from "./videoCallRuntime";
import type { DailyAliveHeartbeatApi } from "./useDailyAliveHeartbeat";
import type { RemoteRenderPipelineApi } from "./useRemoteRenderPipeline";
import type { VideoDateMediaPreflightApi } from "./useVideoDateMediaPreflight";

/**
 * Call-object cleanup concern of the web Video Date call (Video Date
 * rebuild PR 7.5 extraction; bodies verbatim from src/hooks/useVideoCall.ts).
 *
 * Owns reconnect-grace timer teardown and cleanupCallObject, including the
 * live same-session remount parking decision (heartbeat-transfer parking
 * must not arm idle destruction for a live joined/joining call).
 */

type UseDailyCallCleanupDeps = VideoCallSharedRuntime &
  Pick<
    DailyAliveHeartbeatApi,
    | "clearDailyAliveHeartbeatTimer"
    | "clearDailyEventListeners"
    | "clearDailyTokenRefreshTimer"
  > &
  Pick<
    RemoteRenderPipelineApi,
    | "clearFirstRemoteWatchdog"
    | "clearRemoteRenderValidation"
    | "resetRemoteRenderRecoveryAttempts"
  > &
  Pick<VideoDateMediaPreflightApi, "releaseAppAcquiredMedia">;

export function useDailyCallCleanup(deps: UseDailyCallCleanupDeps) {
  const {
    activeCallSessionIdRef,
    activeDailyCallIdentityRef,
    activePreparedEntryCacheHitRef,
    activePreparedEntryCacheRef,
    activeRemoteCameraSwitchRenderWatchRef,
    appAcquiredMediaRef,
    callObjectRef,
    cameraSwitchInFlightRef,
    captureProfileRef,
    clearDailyAliveHeartbeatTimer,
    clearDailyEventListeners,
    clearDailyTokenRefreshTimer,
    clearFirstRemoteWatchdog,
    clearRemoteRenderValidation,
    clearSameSessionDailyContinuity,
    dailyJoinStartedAtMsRef,
    dailyListenerGenerationRef,
    dailyTokenRecoveryInFlightRef,
    firstRemoteObservedRef,
    hasSameSessionDailyContinuity,
    lastDailyPrewarmConsumedRef,
    lastLocalMountedTrackKeyRef,
    lastLocalStreamRef,
    lastLocalTrackIdsRef,
    lastMediaHandoffMissReasonRef,
    lastMediaHandoffUsedRef,
    lastPrewarmedAlreadyJoinedRef,
    lastPrewarmedJoinInFlightRef,
    lastProviderVerifySkippedRef,
    lastRemoteCameraSwitchHintIdRef,
    lastRemoteMountedTrackKeyRef,
    lastRemoteRenderParticipantIdRef,
    lastRemoteStreamRef,
    lastRemoteTrackIdsRef,
    latestLocalParticipantRef,
    latestRemoteParticipantRef,
    localVideoReadyTrackedRef,
    localVideoRef,
    optionsRef,
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
    roomNameRef,
    setDailyMeetingState,
    setDailyReconnectState,
    setHasPermission,
    setIsConnected,
    setIsConnecting,
    setLocalInDailyRoom,
    setLocalStream,
    setNetworkTier,
    setPeerMissing,
    setReconnectGraceTimeLeft,
    setRemotePlayback,
  } = deps;

  const clearReconnectGraceTimers = useCallback(() => {
    if (reconnectGraceTimeoutRef.current) {
      clearTimeout(reconnectGraceTimeoutRef.current);
      reconnectGraceTimeoutRef.current = null;
    }
    if (reconnectGraceTickerRef.current) {
      clearInterval(reconnectGraceTickerRef.current);
      reconnectGraceTickerRef.current = null;
    }
    if (reconnectRecoveryResetTimeoutRef.current) {
      clearTimeout(reconnectRecoveryResetTimeoutRef.current);
      reconnectRecoveryResetTimeoutRef.current = null;
    }
  }, []);

  const cleanupCallObject = useCallback(
    (caller: string, reason: string) => {
      const cleanupPromise = (async () => {
        const callObject = callObjectRef.current;
        const roomName = roomNameRef.current;
        const sessionId = optionsRef.current?.roomId ?? null;
        const eventId = optionsRef.current?.eventId ?? null;
        const userId = optionsRef.current?.userId ?? null;
        const meetingStateBeforeCleanup = safeMeetingState(callObject);
        const phaseBeforeCleanup =
          optionsRef.current?.videoSessionState ?? null;
        const sameSessionDailyContinuity =
          Boolean(optionsRef.current?.dailyCallSingletonEligible) ||
          hasSameSessionDailyContinuity(sessionId);
        const shouldParkLiveSingleton =
          sameSessionDailyContinuity &&
          Boolean(callObject) &&
          Boolean(userId) &&
          caller === "useVideoCall.unmount" &&
          reason === "component_unmount" &&
          phaseBeforeCleanup !== "ended" &&
          !isTerminalDailyMeetingState(meetingStateBeforeCleanup);
        let callLeftSuccessfully = false;
        let parkedSingleton = false;

        vdbg("daily_call_cleanup_start", {
          caller,
          reason,
          sessionId,
          eventId,
          roomName,
          hasCallObject: Boolean(callObject),
          dailyCallSingletonEligible: Boolean(
            optionsRef.current?.dailyCallSingletonEligible,
          ),
          sameSessionDailyContinuity,
          sameSessionDailyContinuityLatched:
            hasSameSessionDailyContinuity(sessionId),
          willParkSingleton: shouldParkLiveSingleton,
          singletonParkingMode: shouldParkLiveSingleton
            ? "live_same_session_remount"
            : null,
          meetingState: meetingStateBeforeCleanup,
        });

        if (callObject) {
          dailyListenerGenerationRef.current += 1;
          clearDailyTokenRefreshTimer();
          dailyTokenRecoveryInFlightRef.current = false;
          clearDailyEventListeners("daily_call_cleanup");
          if (shouldParkLiveSingleton && userId) {
            parkWebDailyCallSingleton({
              call: callObject,
              userId,
              captureProfile: captureProfileRef.current,
              appAcquiredMedia: appAcquiredMediaRef.current,
              previousSessionId: sessionId,
              previousRoomName: roomName,
              reason,
              stopHeartbeat: clearDailyAliveHeartbeatTimer,
            });
            parkedSingleton = true;
            vdbg(
              "daily_call_live_remount_leave_destroy_skipped_for_singleton",
              {
                caller,
                reason,
                sessionId,
                eventId,
                roomName,
                meetingState: meetingStateBeforeCleanup,
              },
            );
            vdbg("daily_call_live_remount_detach_only", {
              caller,
              reason,
              sessionId,
              eventId,
              roomName,
              meetingState: meetingStateBeforeCleanup,
              heartbeat_transferred: true,
              call_ref_preserved: true,
            });
          } else {
            try {
              vdbg("daily_call_leave_before", {
                caller,
                reason,
                sessionId,
                eventId,
                roomName,
              });
              await callObject.leave();
              callLeftSuccessfully = true;
              vdbg("daily_call_leave_after", {
                caller,
                reason,
                sessionId,
                eventId,
                roomName,
                ok: true,
              });
            } catch (error) {
              vdbg("daily_call_leave_after", {
                caller,
                reason,
                sessionId,
                eventId,
                roomName,
                ok: false,
                error:
                  error instanceof Error
                    ? { name: error.name, message: error.message }
                    : String(error),
              });
            }

            try {
              await Promise.resolve(callObject.destroy());
              vdbg("daily_call_destroy", {
                caller,
                reason,
                sessionId,
                eventId,
                roomName,
                ok: true,
              });
            } catch (error) {
              vdbg("daily_call_destroy", {
                caller,
                reason,
                sessionId,
                eventId,
                roomName,
                ok: false,
                error:
                  error instanceof Error
                    ? { name: error.name, message: error.message }
                    : String(error),
              });
            }
          }
        }
        if (!parkedSingleton) {
          activeDailyCallIdentityRef.current = null;
          clearDailyAliveHeartbeatTimer(`daily_call_cleanup:${reason}`);
        } else {
          vdbg("daily_call_live_remount_heartbeat_preserved", {
            caller,
            reason,
            sessionId,
            eventId,
            roomName,
            meetingState: meetingStateBeforeCleanup,
            activeIdentityPreserved: Boolean(
              activeDailyCallIdentityRef.current,
            ),
          });
        }
        if (!parkedSingleton) {
          activeCallSessionIdRef.current = null;
          clearSameSessionDailyContinuity(
            sessionId,
            `daily_call_cleanup:${reason}`,
          );
        }
        if (!parkedSingleton) {
          callObjectRef.current = null;
        }
        clearDailyTokenRefreshTimer();
        dailyTokenRecoveryInFlightRef.current = false;

        if (localVideoRef.current) localVideoRef.current.srcObject = null;
        if (!parkedSingleton) {
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
          setLocalStream(null);
          setHasPermission(null);
          setIsConnected(false);
          setIsConnecting(false);
          setDailyMeetingState(null);
          setLocalInDailyRoom(false);
          setNetworkTier("good");
          setRemotePlayback(createRemotePlaybackState());
          setPeerMissing({ terminal: false });
          clearRemoteRenderValidation({ cancelReattach: true });
          clearReconnectGraceTimers();
          reconnectGraceActiveRef.current = false;
          reconnectPartnerAwayTriggeredRef.current = false;
          reconnectSyncRequestedRef.current = false;
          resetRemoteRenderRecoveryAttempts();
          lastRemoteRenderParticipantIdRef.current = null;
          activePreparedEntryCacheRef.current = null;
          activePreparedEntryCacheHitRef.current = null;
          dailyJoinStartedAtMsRef.current = null;
          lastMediaHandoffUsedRef.current = false;
          lastMediaHandoffMissReasonRef.current = null;
          lastDailyPrewarmConsumedRef.current = false;
          lastPrewarmedJoinInFlightRef.current = false;
          lastPrewarmedAlreadyJoinedRef.current = false;
          lastProviderVerifySkippedRef.current = null;
          localVideoReadyTrackedRef.current = false;
          remoteFirstFrameTrackedRef.current = false;
          setDailyReconnectState("connected");
          setReconnectGraceTimeLeft(0);
          firstRemoteObservedRef.current = false;
          clearFirstRemoteWatchdog();
          lastLocalTrackIdsRef.current = "";
          lastLocalStreamRef.current = null;
          lastRemoteTrackIdsRef.current = "";
          lastRemoteStreamRef.current = null;
          lastLocalMountedTrackKeyRef.current = "";
          lastRemoteMountedTrackKeyRef.current = "";
          latestLocalParticipantRef.current = undefined;
          latestRemoteParticipantRef.current = undefined;
          cameraSwitchInFlightRef.current = false;
          lastRemoteCameraSwitchHintIdRef.current = null;
          activeRemoteCameraSwitchRenderWatchRef.current = null;
        }
        if (!parkedSingleton) {
          releaseAppAcquiredMedia("daily_call_cleanup");
        } else {
          appAcquiredMediaRef.current = null;
        }
      })();

      return registerWebVideoDateDailyCleanup(cleanupPromise, {
        source: caller,
        reason,
        onDiagnostic: (eventName, payload) => {
          vdbg(eventName, {
            caller,
            reason,
            ...payload,
          });
        },
      });
    },
    [
      clearDailyEventListeners,
      clearDailyAliveHeartbeatTimer,
      clearDailyTokenRefreshTimer,
      clearSameSessionDailyContinuity,
      clearFirstRemoteWatchdog,
      clearReconnectGraceTimers,
      clearRemoteRenderValidation,
      hasSameSessionDailyContinuity,
      releaseAppAcquiredMedia,
      resetRemoteRenderRecoveryAttempts,
    ],
  );
  return {
    clearReconnectGraceTimers,
    cleanupCallObject,
  };
}

export type DailyCallCleanupApi = ReturnType<typeof useDailyCallCleanup>;
