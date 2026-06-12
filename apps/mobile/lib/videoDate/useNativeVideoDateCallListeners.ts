import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
} from "react";
import {
  useAuth,
} from "@/context/AuthContext";
import {
  trackEvent,
} from "@/lib/analytics";
import {
  type ActiveNativeDailyCallIdentity,
  type DailyCallObject,
  destroyNativeVideoDateDailyCall,
  readNativeDailyProviderSessionId,
} from "@/lib/daily/nativeDailyCallSingleton";
import {
  applyLocalMediaUiFromParticipant,
  dailyParticipantId,
  dailyParticipantSessionId,
  NATIVE_CAMERA_SWITCH_FRESH_FRAME_TIMEOUT_MS,
  NATIVE_CAMERA_SWITCH_RENDER_WATCH_TTL_MS,
  type NativeCameraSwitchRenderWatch,
  nativeRemoteRenderTrackKey,
} from "@/lib/daily/nativeDailyMediaHelpers";
import {
  RC_CATEGORY,
  rcBreadcrumb,
} from "@/lib/nativeRcDiagnostics";
import {
  vdbg,
} from "@/lib/vdbg";
import {
  useNativeDailyAliveHeartbeat,
} from "@/lib/videoDate/useNativeDailyAliveHeartbeat";
import {
  addVideoDateBreadcrumb,
  type DailyTokenRefreshSourceAction,
  NATIVE_DAILY_TRANSPORT_RECONNECT_GRACE_MS,
  networkTierFromDailyEvent,
  videoDateDailyDiagnostic,
} from "@/lib/videoDate/videoDateScreenShared";
import {
  markReconnectPartnerAway,
  useVideoDateSession,
} from "@/lib/videoDateApi";
import {
  emitNativeVideoDateClientStuckState,
} from "@/lib/videoDateClientStuckObservability";
import {
  LobbyPostDateEvents,
} from "@clientShared/analytics/lobbyToPostDateJourney";
import {
  parseVideoDateCameraSwitchRenderHint,
} from "@clientShared/matching/videoDateCameraSwitchRenderHint";
import {
  getVideoDateEntryOwner,
  updateVideoDateDailyOwnerState,
} from "@clientShared/matching/videoDateEntryOwner";
import {
  shouldRefreshDailyTokenBeforeReconnect,
} from "@clientShared/matching/videoDatePhase4";
import {
  isVideoDateDailyMeetingEnded,
} from "@clientShared/matching/videoDatePublicApi";
import {
  adviseVideoDateTokenRecovery,
} from "@clientShared/matching/videoDateRecoveryAdvisor";
import {
  buildReadyGateToDateLatencyPayload,
  recordReadyGateToDateLatencyCheckpoint,
} from "@clientShared/observability/videoDateOperatorMetrics";
import {
  type DailyParticipant,
} from "@daily-co/react-native-daily-js";
import * as Sentry from "@sentry/react-native";
import { getPreparedVideoDateEntry } from "@/lib/videoDatePrepareEntry";
import type { NativeRemoteRenderAttemptEntry } from "@/lib/daily/nativeDailyMediaHelpers";

/**
 * Daily event listener binding concern of the native Video Date screen: detach/terminal-cleanup/bind for the shared Daily call listeners.
 *
 * Video Date rebuild PR 8.5 extraction; body verbatim from
 * `apps/mobile/app/date/[id].tsx`. Deps are destructured to their original
 * names so closure semantics and contract pins hold.
 */
export interface NativeVideoDateCallListenersDeps {
  activeNativeDailyCallIdentityRef: MutableRefObject<ActiveNativeDailyCallIdentity | null>;
  activeNativeRemoteCameraSwitchRenderWatchRef: MutableRefObject<NativeCameraSwitchRenderWatch | null>;
  activePreparedEntryCacheHitRef: MutableRefObject<boolean | null>;
  activePreparedEntryCacheRef: MutableRefObject<ReturnType<typeof getPreparedVideoDateEntry> | null>;
  boundCallRef: MutableRefObject<DailyCallObject | null>;
  boundHandlersRef: MutableRefObject<{ onParticipantJoined: (event: { participant?: DailyParticipant }) => void; onParticipantUpdated: (event: { participant?: DailyParticipant }) => void; onParticipantLeft: (event: { participant?: DailyParticipant }) => void; onLeftMeeting: () => void; onAppMessage: (event: { data?: unknown; fromId?: string }) => void; onError: (event: unknown) => void; onNetworkQualityChange?: (event: unknown) => void; } | null>;
  callRef: MutableRefObject<DailyCallObject | null>;
  clearDailyAliveHeartbeatTimer: ReturnType<typeof useNativeDailyAliveHeartbeat>["clearDailyAliveHeartbeatTimer"];
  clearDailyTokenRefreshTimer: () => void;
  clearFirstConnectWatchdog: () => void;
  clearNativeRemoteRenderRemount: (reason: string) => void;
  clearPartnerAwayAfterTransportGrace: (reason: string) => void;
  dailyTokenExpiresAtRef: MutableRefObject<string | null>;
  dailyTokenRecoveryInFlightRef: MutableRefObject<boolean>;
  endBootstrapTiming: (step: string, data?: Record<string, unknown>) => void;
  eventId: string;
  firstIceConnectedLoggedRef: MutableRefObject<boolean>;
  firstRemoteParticipantTimedRef: MutableRefObject<boolean>;
  hasStartedJoinRef: MutableRefObject<boolean>;
  lastNativeRemoteCameraSwitchHintIdRef: MutableRefObject<string | null>;
  lastNativeRemoteRenderTrackKeyRef: MutableRefObject<string | null>;
  localInDailyRoomRef: MutableRefObject<boolean>;
  localParticipantRef: MutableRefObject<DailyParticipant | null>;
  nativeCameraSwitchInFlightRef: MutableRefObject<boolean>;
  nativeRemoteRenderDiagnostics: (participant: DailyParticipant | null | undefined) => Record<string, unknown>;
  nativeRemoteRenderScopedAttemptsRef: MutableRefObject<Map<string, NativeRemoteRenderAttemptEntry>>;
  nativeRemoteRenderTrackAttemptsRef: MutableRefObject<Map<string, NativeRemoteRenderAttemptEntry>>;
  partnerAwayAfterTransportGraceTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  partnerEverJoinedRef: MutableRefObject<boolean>;
  phaseRef: MutableRefObject<ReturnType<typeof useVideoDateSession>["phase"]>;
  recoverNativeDailyTokenRef: MutableRefObject<(sourceAction: DailyTokenRefreshSourceAction, cause?: unknown) => Promise<boolean>>;
  refetchVideoSession: ReturnType<typeof useVideoDateSession>["refetch"];
  releaseSharedCallIfOwned: (call: DailyCallObject | null, reason: string) => void;
  remoteParticipantRef: MutableRefObject<DailyParticipant | null>;
  requestReconnectSyncRef: MutableRefObject<(reason: string) => void>;
  resetNativeRemoteRenderRecovery: (participant: DailyParticipant | null | undefined, reason: string) => void;
  roomNameRef: MutableRefObject<string | null>;
  scheduleNativeCameraSwitchFreshnessWatch: (participant: DailyParticipant | null | undefined, switchId: string) => void;
  scheduleNativeRemoteRenderRemount: ( participant: DailyParticipant | null | undefined, source: string, recoveryScope?: string, ) => void;
  sessionId: string;
  setAwaitingFirstConnect: Dispatch<SetStateAction<boolean>>;
  setCallError: Dispatch<SetStateAction<string | null>>;
  setIsConnecting: Dispatch<SetStateAction<boolean>>;
  setIsMuted: Dispatch<SetStateAction<boolean>>;
  setIsPartnerDisconnected: Dispatch<SetStateAction<boolean>>;
  setIsVideoOff: Dispatch<SetStateAction<boolean>>;
  setJoining: Dispatch<SetStateAction<boolean>>;
  setLocalInDailyRoom: Dispatch<SetStateAction<boolean>>;
  setLocalParticipant: Dispatch<SetStateAction<DailyParticipant | null>>;
  setNetQualityTier: Dispatch<SetStateAction<"good" | "fair" | "poor">>;
  setPartnerEverJoined: Dispatch<SetStateAction<boolean>>;
  setRemoteParticipant: Dispatch<SetStateAction<DailyParticipant | null>>;
  user: ReturnType<typeof useAuth>["user"];
}

export function useNativeVideoDateCallListeners(deps: NativeVideoDateCallListenersDeps) {
  const {
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
  } = deps;

  const detachCallListeners = useCallback(
    (reason: string) => {
      const call = boundCallRef.current;
      const handlers = boundHandlersRef.current;
      if (!call || !handlers) return;
      const callAny = call as unknown as {
        off?: (event: string, handler: (...args: unknown[]) => void) => void;
      };
      callAny.off?.(
        "participant-joined",
        handlers.onParticipantJoined as (...args: unknown[]) => void,
      );
      callAny.off?.(
        "participant-updated",
        handlers.onParticipantUpdated as (...args: unknown[]) => void,
      );
      callAny.off?.(
        "participant-left",
        handlers.onParticipantLeft as (...args: unknown[]) => void,
      );
      callAny.off?.(
        "left-meeting",
        handlers.onLeftMeeting as (...args: unknown[]) => void,
      );
      callAny.off?.(
        "app-message",
        handlers.onAppMessage as (...args: unknown[]) => void,
      );
      callAny.off?.("error", handlers.onError as (...args: unknown[]) => void);
      if (handlers.onNetworkQualityChange) {
        callAny.off?.(
          "network-quality-change",
          handlers.onNetworkQualityChange as (...args: unknown[]) => void,
        );
      }
      vdbg("daily_call_listeners_detached", {
        reason,
        sessionId: sessionId ?? null,
        userId: user?.id ?? null,
      });
      boundCallRef.current = null;
      boundHandlersRef.current = null;
    },
    [sessionId, user?.id],
  );

  const cleanupTerminalDailyCall = useCallback(
    async (call: DailyCallObject | null, reason: string) => {
      if (!call) return;
      detachCallListeners(reason);
      clearPartnerAwayAfterTransportGrace(reason);
      clearDailyTokenRefreshTimer();
      clearDailyAliveHeartbeatTimer(`terminal_cleanup:${reason}`);
      activeNativeDailyCallIdentityRef.current = null;
      dailyTokenRecoveryInFlightRef.current = false;
      dailyTokenExpiresAtRef.current = null;
      recoverNativeDailyTokenRef.current = () => Promise.resolve(false);
      try {
        await call.leave();
      } catch (_error) {
        void _error;
      }
      try {
        await destroyNativeVideoDateDailyCall(call, reason, {
          sessionId,
          userId: user?.id ?? null,
          roomName: roomNameRef.current ?? null,
        });
      } catch (_error) {
        void _error;
      }
      releaseSharedCallIfOwned(call, reason);
      if (callRef.current === call) {
        callRef.current = null;
      }
      // Provider-terminal cleanup can be followed by active backend truth; allow prejoin to rebuild.
      hasStartedJoinRef.current = false;
      setJoining(false);
      localParticipantRef.current = null;
      remoteParticipantRef.current = null;
      nativeCameraSwitchInFlightRef.current = false;
      lastNativeRemoteCameraSwitchHintIdRef.current = null;
      activeNativeRemoteCameraSwitchRenderWatchRef.current = null;
      resetNativeRemoteRenderRecovery(null, reason);
      setLocalParticipant(null);
      setRemoteParticipant(null);
      setLocalInDailyRoom(false);
      setAwaitingFirstConnect(false);
      setIsConnecting(false);
      setIsPartnerDisconnected(false);
      setPartnerEverJoined(false);
      roomNameRef.current = null;
    },
    [
      clearDailyTokenRefreshTimer,
      clearDailyAliveHeartbeatTimer,
      clearPartnerAwayAfterTransportGrace,
      detachCallListeners,
      releaseSharedCallIfOwned,
      resetNativeRemoteRenderRecovery,
      sessionId,
      user?.id,
    ],
  );

  const bindCallListeners = useCallback(
    (call: DailyCallObject, roomName: string | null) => {
      if (boundCallRef.current === call && boundHandlersRef.current) {
        vdbg("daily_call_listeners_bind_skipped", {
          reason: "already_bound",
          sessionId: sessionId ?? null,
          userId: user?.id ?? null,
          roomName,
        });
        return;
      }
      detachCallListeners("rebind");
      const onParticipantJoined = (event: {
        participant?: DailyParticipant;
      }) => {
        const p = event?.participant;
        const isLocal = !!(p && (p as unknown as { local?: boolean }).local);
        videoDateDailyDiagnostic("daily_participant_joined", {
          session_id: sessionId ?? "",
          room_name: roomName,
          kind: isLocal ? "local" : "remote",
          participant_id: p ? (dailyParticipantId(p) ?? "unknown") : "none",
        });
        if (p && isLocal) {
          localParticipantRef.current = p;
          setLocalParticipant(p);
          applyLocalMediaUiFromParticipant(p, { setIsVideoOff, setIsMuted });
          return;
        }
        if (p && !isLocal) {
          clearPartnerAwayAfterTransportGrace("participant_joined");
          if (!firstRemoteParticipantTimedRef.current) {
            firstRemoteParticipantTimedRef.current = true;
            endBootstrapTiming("first_remote_participant", {
              source: "participant_joined",
              participant_id: dailyParticipantId(p) ?? "unknown",
              room_name: roomName,
            });
            const latencyContext = recordReadyGateToDateLatencyCheckpoint({
              sessionId: sessionId ?? "",
              platform: "native",
              eventId: eventId || null,
              sourceSurface: "video_date_daily",
              checkpoint: "remote_seen",
              entryAttemptId:
                activePreparedEntryCacheRef.current?.entryAttemptId ??
                activePreparedEntryCacheRef.current?.value.entry_attempt_id ??
                null,
              videoDateTraceId:
                activePreparedEntryCacheRef.current?.value
                  .video_date_trace_id ??
                activePreparedEntryCacheRef.current?.entryAttemptId ??
                null,
              cachedPrepareEntry: activePreparedEntryCacheHitRef.current,
              providerVerifySkipped:
                activePreparedEntryCacheRef.current?.value
                  .provider_verify_skipped ?? null,
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
              platform: "native",
              session_id: sessionId ?? null,
              event_id: eventId || null,
              source_surface: "video_date_daily",
              source_action: "participant_joined",
              source: "participant_joined",
              duration_ms: latencyPayload.bothReadyToRemoteSeenMs,
              latency_bucket: latencyPayload.latency_bucket,
            });
          }
          if (__DEV__)
            vdbg("first_remote_participant_seen", {
              sessionId: sessionId ?? null,
              userId: user?.id ?? null,
              source: "participant_joined",
            });
          Sentry.addBreadcrumb({
            category: "video-date",
            message: "Partner joined",
            level: "info",
          });
          rcBreadcrumb(
            RC_CATEGORY.videoDateEntry,
            "remote_participant_joined",
            {
              session_id: sessionId ?? null,
              user_id: user?.id ?? null,
              participant_id: dailyParticipantId(p) ?? "unknown",
              room_name: roomName,
            },
          );
          videoDateDailyDiagnostic("first_remote_observed", {
            session_id: sessionId ?? "",
            room_name: roomName,
            source: "participant_joined",
          });
          clearFirstConnectWatchdog();
          setAwaitingFirstConnect(false);
          setPartnerEverJoined(true);
          setIsPartnerDisconnected(false);
          setIsConnecting(false);
          remoteParticipantRef.current = p;
          resetNativeRemoteRenderRecovery(p, "participant_joined");
          setRemoteParticipant(p);
          requestReconnectSyncRef.current("daily_participant_joined");
        }
      };
      const onParticipantUpdated = (event: {
        participant?: DailyParticipant;
      }) => {
        if (!event?.participant) return;
        const p = event.participant;
        const isLocal = !!(p as unknown as { local?: boolean }).local;
        videoDateDailyDiagnostic("daily_participant_updated", {
          session_id: sessionId ?? "",
          room_name: roomName,
          kind: isLocal ? "local" : "remote",
          participant_id: dailyParticipantId(p) ?? "unknown",
        });
        if (isLocal) {
          localParticipantRef.current = p;
          setLocalParticipant(p);
          applyLocalMediaUiFromParticipant(p, { setIsVideoOff, setIsMuted });
        } else {
          clearPartnerAwayAfterTransportGrace("participant_updated");
          if (!firstRemoteParticipantTimedRef.current) {
            firstRemoteParticipantTimedRef.current = true;
            endBootstrapTiming("first_remote_participant", {
              source: "participant_updated",
              participant_id: dailyParticipantId(p) ?? "unknown",
              room_name: roomName,
            });
            const latencyContext = recordReadyGateToDateLatencyCheckpoint({
              sessionId: sessionId ?? "",
              platform: "native",
              eventId: eventId || null,
              sourceSurface: "video_date_daily",
              checkpoint: "remote_seen",
              entryAttemptId:
                activePreparedEntryCacheRef.current?.entryAttemptId ??
                activePreparedEntryCacheRef.current?.value.entry_attempt_id ??
                null,
              videoDateTraceId:
                activePreparedEntryCacheRef.current?.value
                  .video_date_trace_id ??
                activePreparedEntryCacheRef.current?.entryAttemptId ??
                null,
              cachedPrepareEntry: activePreparedEntryCacheHitRef.current,
              providerVerifySkipped:
                activePreparedEntryCacheRef.current?.value
                  .provider_verify_skipped ?? null,
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
              platform: "native",
              session_id: sessionId ?? null,
              event_id: eventId || null,
              source_surface: "video_date_daily",
              source_action: "participant_updated",
              source: "participant_updated",
              duration_ms: latencyPayload.bothReadyToRemoteSeenMs,
              latency_bucket: latencyPayload.latency_bucket,
            });
          }
          setPartnerEverJoined(true);
          setIsPartnerDisconnected(false);
          const nextTrackKey = nativeRemoteRenderTrackKey(p);
          const previousTrackKey = lastNativeRemoteRenderTrackKeyRef.current;
          remoteParticipantRef.current = p;
          if (
            nextTrackKey &&
            previousTrackKey &&
            nextTrackKey === previousTrackKey
          ) {
            scheduleNativeRemoteRenderRemount(
              p,
              "participant_updated_same_track",
            );
          } else {
            resetNativeRemoteRenderRecovery(
              p,
              "participant_updated_track_changed",
            );
          }
          setRemoteParticipant(p);
        }
      };
      const onParticipantLeft = (event: { participant?: DailyParticipant }) => {
        const p = event?.participant;
        const isLocal = !!(p && (p as unknown as { local?: boolean }).local);
        if (p && !isLocal) {
          videoDateDailyDiagnostic("daily_participant_left", {
            session_id: sessionId ?? "",
            room_name: roomName,
            kind: "remote",
            participant_id: dailyParticipantId(p) ?? "unknown",
          });
          Sentry.addBreadcrumb({
            category: "video-date",
            message: "Partner left",
            level: "info",
          });
          remoteParticipantRef.current = null;
          lastNativeRemoteCameraSwitchHintIdRef.current = null;
          activeNativeRemoteCameraSwitchRenderWatchRef.current = null;
          resetNativeRemoteRenderRecovery(null, "participant_left");
          setRemoteParticipant(null);
          if (
            !partnerEverJoinedRef.current ||
            !sessionId ||
            phaseRef.current === "ended"
          )
            return;
          setIsPartnerDisconnected(true);
          clearPartnerAwayAfterTransportGrace("participant_left_reschedule");
          videoDateDailyDiagnostic(
            "daily_participant_left_transport_grace_started",
            {
              session_id: sessionId,
              event_id: eventId || null,
              room_name: roomName,
              grace_ms: NATIVE_DAILY_TRANSPORT_RECONNECT_GRACE_MS,
            },
          );
          partnerAwayAfterTransportGraceTimerRef.current = setTimeout(() => {
            partnerAwayAfterTransportGraceTimerRef.current = null;
            if (
              !partnerEverJoinedRef.current ||
              !sessionId ||
              phaseRef.current === "ended" ||
              remoteParticipantRef.current
            ) {
              videoDateDailyDiagnostic(
                "daily_participant_left_transport_grace_suppressed",
                {
                  session_id: sessionId ?? "",
                  event_id: eventId || null,
                  room_name: roomName,
                  reason: remoteParticipantRef.current
                    ? "remote_returned"
                    : "session_inactive",
                },
              );
              return;
            }
            videoDateDailyDiagnostic(
              "daily_participant_left_transport_grace_expired",
              {
                session_id: sessionId,
                event_id: eventId || null,
                room_name: roomName,
                grace_ms: NATIVE_DAILY_TRANSPORT_RECONNECT_GRACE_MS,
              },
            );
            void markReconnectPartnerAway(
              sessionId,
              "daily_transport_grace_expired",
            );
            requestReconnectSyncRef.current("daily_transport_grace_expired");
          }, NATIVE_DAILY_TRANSPORT_RECONNECT_GRACE_MS);
          requestReconnectSyncRef.current(
            "daily_participant_left_transport_grace_started",
          );
          if (
            shouldRefreshDailyTokenBeforeReconnect(
              dailyTokenExpiresAtRef.current,
            ) &&
            !dailyTokenRecoveryInFlightRef.current
          ) {
            void recoverNativeDailyTokenRef.current(
              "daily_token_refresh_before_expiry",
              new Error("near_expiry_reconnect:daily_participant_left"),
            );
          }
        }
      };
      const onLeftMeeting = () => {
        const currentUserId = user?.id ?? null;
        const ownerBeforeLeft =
          sessionId && currentUserId
            ? getVideoDateEntryOwner(sessionId, currentUserId)
            : null;
        const providerSessionId = readNativeDailyProviderSessionId(call);
        if (sessionId && currentUserId && ownerBeforeLeft) {
          updateVideoDateDailyOwnerState({
            sessionId,
            userId: currentUserId,
            ownerId: ownerBeforeLeft.ownerId,
            roomName: roomNameRef.current,
            state: "lost",
            source: "daily_owner_provider_left_unexpected",
            entryAttemptId: ownerBeforeLeft.entryAttemptId ?? null,
            videoDateTraceId: ownerBeforeLeft.videoDateTraceId ?? null,
            providerSessionId,
          });
          void emitNativeVideoDateClientStuckState({
            sessionId,
            eventName: "daily_owner_provider_left_unexpected",
            payload: {
              source_surface: "video_date_daily",
              source_action: "daily_owner_provider_left_unexpected",
              room_name: roomNameRef.current ?? undefined,
              owner_id: ownerBeforeLeft.ownerId,
              owner_state: ownerBeforeLeft.state,
              provider_session_id: providerSessionId ?? undefined,
            },
          });
        }
        Sentry.addBreadcrumb({
          category: "video-date",
          message: "Call ended (left-meeting)",
          level: "info",
        });
        clearFirstConnectWatchdog();
        setAwaitingFirstConnect(false);
        setLocalInDailyRoom(false);
        setIsConnecting(false);
        localParticipantRef.current = null;
        remoteParticipantRef.current = null;
        nativeCameraSwitchInFlightRef.current = false;
        lastNativeRemoteCameraSwitchHintIdRef.current = null;
        activeNativeRemoteCameraSwitchRenderWatchRef.current = null;
        resetNativeRemoteRenderRecovery(null, "left_meeting");
        releaseSharedCallIfOwned(call, "left_meeting");
      };
      const onAppMessage = (event: { data?: unknown; fromId?: string }) => {
        const hint = parseVideoDateCameraSwitchRenderHint(event?.data);
        if (!hint) return;

        let localParticipantSessionId: string | null = null;
        try {
          localParticipantSessionId =
            dailyParticipantSessionId(
              call.participants()?.local as DailyParticipant | undefined,
            ) ?? null;
        } catch {
          localParticipantSessionId = null;
        }
        const fromId = typeof event?.fromId === "string" ? event.fromId : null;
        if (
          fromId &&
          localParticipantSessionId &&
          fromId === localParticipantSessionId
        ) {
          videoDateDailyDiagnostic("native_camera_switch_render_hint_ignored", {
            session_id: sessionId ?? "",
            event_id: eventId || null,
            room_name: roomName,
            switch_id: hint.switchId,
            source_platform: hint.sourcePlatform,
            reason: "self_origin",
          });
          return;
        }

        const remote = remoteParticipantRef.current;
        if (lastNativeRemoteCameraSwitchHintIdRef.current !== hint.switchId) {
          lastNativeRemoteCameraSwitchHintIdRef.current = hint.switchId;
          nativeRemoteRenderTrackAttemptsRef.current.clear();
          nativeRemoteRenderScopedAttemptsRef.current.clear();
        }
        activeNativeRemoteCameraSwitchRenderWatchRef.current = {
          switchId: hint.switchId,
          expiresAtMs: Date.now() + NATIVE_CAMERA_SWITCH_RENDER_WATCH_TTL_MS,
        };
        clearNativeRemoteRenderRemount("camera_switch_hint_received");
        videoDateDailyDiagnostic("native_camera_switch_render_hint_received", {
          ...nativeRemoteRenderDiagnostics(remote),
          room_name: roomName,
          from_id: fromId,
          switch_id: hint.switchId,
          source_platform: hint.sourcePlatform,
          facing_mode: hint.facingMode,
          commit_confirmed: hint.commitConfirmed,
          commit_method: hint.commitMethod,
          local_video_track_id: hint.localVideoTrackId,
          commit_latency_ms: hint.commitLatencyMs,
          sent_at_ms: hint.sentAtMs,
          watch_ttl_ms: NATIVE_CAMERA_SWITCH_RENDER_WATCH_TTL_MS,
          freshness_timeout_ms: NATIVE_CAMERA_SWITCH_FRESH_FRAME_TIMEOUT_MS,
        });
        // Do NOT remount <DailyMediaView /> on hint receipt. Daily uses
        // RTCRtpSender.replaceTrack() under the hood for camera flips, so the
        // receiver's underlying track keeps streaming. Forcing a remount
        // tears down the decoder pipeline and forces the receiver to wait
        // for the next periodic keyframe, which is the original "black
        // screen" symptom this fix exists to prevent. A conservative stats
        // freshness watcher escalates only after supported Daily stats fail
        // to show inbound remote video.
        scheduleNativeCameraSwitchFreshnessWatch(remote, hint.switchId);
      };
      const onError = (event: unknown) => {
        const msg =
          event && typeof event === "object" && "errorMsg" in event
            ? String((event as { errorMsg?: unknown }).errorMsg)
            : undefined;
        addVideoDateBreadcrumb("Daily call error", "error", {
          sessionId,
          errorMsg: msg,
        });
        if (isVideoDateDailyMeetingEnded(event)) {
          clearDailyTokenRefreshTimer();
          vdbg("daily_meeting_ended_truth_refetch", {
            sessionId,
            userId: user?.id ?? null,
            roomName,
            errorMsg: msg ?? null,
          });
          void refetchVideoSession();
          setCallError(
            "This video room has closed. Checking the latest date status...",
          );
          clearFirstConnectWatchdog();
          setAwaitingFirstConnect(false);
          setIsConnecting(false);
          setLocalInDailyRoom(false);
          void cleanupTerminalDailyCall(call, "daily_meeting_ended_event");
          return;
        }
        const sourceAction = (msg ?? "").toLowerCase().includes("eject")
          ? "daily_token_refresh_after_ejection"
          : "daily_token_refresh_after_auth_error";
        if (
          adviseVideoDateTokenRecovery({
            trigger:
              sourceAction === "daily_token_refresh_after_ejection"
                ? "ejection"
                : "auth_error",
            error: event,
            platform: "native",
            surface: "video_date",
          }).action === "refresh_token"
        ) {
          void recoverNativeDailyTokenRef.current(sourceAction, event);
          return;
        }
        setCallError("Connection error. Please try again.");
        clearFirstConnectWatchdog();
        setAwaitingFirstConnect(false);
        setIsConnecting(false);
        setLocalInDailyRoom(false);
        releaseSharedCallIfOwned(call, "daily_error_event");
      };
      const onNetworkQualityChange = (ev: unknown) => {
        if (
          !firstIceConnectedLoggedRef.current &&
          localInDailyRoomRef.current
        ) {
          firstIceConnectedLoggedRef.current = true;
          endBootstrapTiming("first_ice_connected", {
            source: "network_quality_change",
            room_name: roomName,
            proxy: true,
          });
        }
        setNetQualityTier(
          networkTierFromDailyEvent(
            ev as { threshold?: string; quality?: number },
          ),
        );
      };

      call.on("participant-joined", onParticipantJoined);
      call.on("participant-updated", onParticipantUpdated);
      call.on("participant-left", onParticipantLeft);
      call.on("left-meeting", onLeftMeeting);
      call.on("error", onError);
      const callAny = call as unknown as {
        on?: (event: string, handler: (...args: unknown[]) => void) => void;
      };
      try {
        callAny.on?.(
          "app-message",
          onAppMessage as (...args: unknown[]) => void,
        );
      } catch {
        /* SDK may omit this event on some builds */
      }
      try {
        call.on("network-quality-change", onNetworkQualityChange);
      } catch {
        /* SDK may omit this event on some builds */
      }
      boundCallRef.current = call;
      boundHandlersRef.current = {
        onParticipantJoined,
        onParticipantUpdated,
        onParticipantLeft,
        onLeftMeeting,
        onAppMessage,
        onError,
        onNetworkQualityChange,
      };
      vdbg("daily_call_listeners_bound", {
        sessionId: sessionId ?? null,
        userId: user?.id ?? null,
        roomName,
      });
    },
    [
      clearDailyTokenRefreshTimer,
      clearFirstConnectWatchdog,
      clearNativeRemoteRenderRemount,
      clearPartnerAwayAfterTransportGrace,
      cleanupTerminalDailyCall,
      detachCallListeners,
      releaseSharedCallIfOwned,
      endBootstrapTiming,
      eventId,
      nativeRemoteRenderDiagnostics,
      refetchVideoSession,
      resetNativeRemoteRenderRecovery,
      scheduleNativeCameraSwitchFreshnessWatch,
      scheduleNativeRemoteRenderRemount,
      sessionId,
      user?.id,
    ],
  );

  return {
    detachCallListeners,
    cleanupTerminalDailyCall,
    bindCallListeners,
  };
}

export type NativeVideoDateCallListenersApi = ReturnType<typeof useNativeVideoDateCallListeners>;
