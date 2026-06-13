import { useState, useRef, useCallback, useEffect } from "react";
import DailyIframe, {
  DailyCall,
  DailyParticipant,
} from "@daily-co/daily-js";
import * as Sentry from "@sentry/react";
import { vdbg } from "@/lib/vdbg";
import { trackEvent } from "@/lib/analytics";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";
import type { PreparedVideoDateEntryCacheEntry } from "@clientShared/matching/videoDatePrepareEntry";
import {
  type VideoDateWebMediaCaptureProfile,
} from "@clientShared/matching/videoDateMediaContract";
import {
  type MediaPermissionResult,
} from "@clientShared/media/mediaPermissionResult";

import {
  AppAcquiredVideoDateMedia,
  createRemotePlaybackState,
  DailyReconnectState,
  describeMediaError,
  PeerMissingState,
  RemoteCameraSwitchRenderWatch,
  RemotePlaybackState,
  VideoCallNetworkTier,
} from "@/lib/daily/webDailyMediaHelpers";
import { useDailyAliveHeartbeat } from "./videoCall/useDailyAliveHeartbeat";
import { useVideoDateRemoteSeen } from "./videoCall/useVideoDateRemoteSeen";
import { useRemoteRenderPipeline } from "./videoCall/useRemoteRenderPipeline";
import { useWebCameraSwitch } from "./videoCall/useWebCameraSwitch";
import { useVideoDateMediaPreflight } from "./videoCall/useVideoDateMediaPreflight";
import { useDailyCallCleanup } from "./videoCall/useDailyCallCleanup";
import { useVideoDateStartCall } from "./videoCall/useVideoDateStartCall";
import type {
  ActiveDailyCallIdentity,
  UseVideoCallOptions,
  VideoCallSharedRuntime,
} from "./videoCall/videoCallRuntime";

export type {
  DailyReconnectState,
  PeerMissingState,
  RemotePlaybackState,
  VideoCallNetworkTier,
  VideoDateMediaPromptIntent,
} from "@/lib/daily/webDailyMediaHelpers";
export type {
  VideoCallStartFailure,
  VideoCallStartResult,
} from "@/lib/daily/webDailyCallSingleton";
export type { UseVideoCallOptions } from "./videoCall/videoCallRuntime";


export const useVideoCall = (options?: UseVideoCallOptions) => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [canFlipCamera, setCanFlipCamera] = useState(false);
  const [isFlippingCamera, setIsFlippingCamera] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [networkTier, setNetworkTier] = useState<VideoCallNetworkTier>("good");
  const [remotePlayback, setRemotePlayback] = useState<RemotePlaybackState>(
    () => createRemotePlaybackState(),
  );
  const [peerMissing, setPeerMissing] = useState<PeerMissingState>({
    terminal: false,
  });
  const [dailyReconnectState, setDailyReconnectState] =
    useState<DailyReconnectState>("connected");
  const [dailyMeetingState, setDailyMeetingState] = useState<string | null>(
    null,
  );
  const [localInDailyRoom, setLocalInDailyRoom] = useState(false);
  const [reconnectGraceTimeLeft, setReconnectGraceTimeLeft] = useState(0);
  const [mediaPermissionError, setMediaPermissionError] = useState<
    string | null
  >(null);
  const [mediaPermissionResult, setMediaPermissionResult] =
    useState<MediaPermissionResult | null>(null);
  const [captureProfile, setCaptureProfile] =
    useState<VideoDateWebMediaCaptureProfile>("ideal");

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const callObjectRef = useRef<DailyCall | null>(null);
  const roomNameRef = useRef<string | null>(null);
  const optionsRef = useRef(options);
  const firstRemoteObservedRef = useRef(false);
  const localVideoReadyTrackedRef = useRef(false);
  const remoteFirstFrameTrackedRef = useRef(false);
  const activeDailyCallIdentityRef = useRef<ActiveDailyCallIdentity | null>(
    null,
  );
  const lastLocalTrackIdsRef = useRef<string>("");
  const lastLocalStreamRef = useRef<MediaStream | null>(null);
  const lastRemoteTrackIdsRef = useRef<string>("");
  const lastRemoteStreamRef = useRef<MediaStream | null>(null);
  const lastLocalMountedTrackKeyRef = useRef<string>("");
  const lastRemoteMountedTrackKeyRef = useRef<string>("");
  const firstRemoteWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const lastRemoteRenderParticipantIdRef = useRef<string | null>(null);
  const activeCallSessionIdRef = useRef<string | null>(null);
  const sameSessionDailyContinuityLatchedRef = useRef<{
    sessionId: string;
    latchedAtMs: number;
    source: string;
  } | null>(null);
  const latestLocalParticipantRef = useRef<DailyParticipant | undefined>(
    undefined,
  );
  const latestRemoteParticipantRef = useRef<DailyParticipant | undefined>(
    undefined,
  );
  const cameraSwitchInFlightRef = useRef(false);
  const lastRemoteCameraSwitchHintIdRef = useRef<string | null>(null);
  const activeRemoteCameraSwitchRenderWatchRef =
    useRef<RemoteCameraSwitchRenderWatch | null>(null);
  const reconnectGraceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const reconnectGraceTickerRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const reconnectRecoveryResetTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const reconnectGraceActiveRef = useRef(false);
  const reconnectPartnerAwayTriggeredRef = useRef(false);
  const reconnectSyncRequestedRef = useRef(false);
  const playbackBlockedRef = useRef(false);
  const captureProfileRef = useRef<VideoDateWebMediaCaptureProfile>("ideal");
  const activePreparedEntryCacheRef =
    useRef<PreparedVideoDateEntryCacheEntry | null>(null);
  const activePreparedEntryCacheHitRef = useRef<boolean | null>(null);
  const dailyJoinStartedAtMsRef = useRef<number | null>(null);
  const appAcquiredMediaRef = useRef<AppAcquiredVideoDateMedia | null>(null);
  const lastMediaHandoffUsedRef = useRef(false);
  const lastMediaHandoffMissReasonRef = useRef<string | null>(null);
  const lastDailyPrewarmConsumedRef = useRef(false);
  const lastDailyPrewarmFallbackReasonRef = useRef<string | null>(null);
  const lastPrewarmedJoinInFlightRef = useRef(false);
  const lastPrewarmedAlreadyJoinedRef = useRef(false);
  const lastProviderVerifySkippedRef = useRef<boolean | null>(null);
  const dailyListenerGenerationRef = useRef(0);
  const dailyEventListenerCleanupsRef = useRef<Array<() => void>>([]);
  const dailyTokenRefreshTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const dailyTokenRecoveryInFlightRef = useRef(false);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const latchSameSessionDailyContinuity = useCallback(
    (sessionId: string, source: string) => {
      const existing = sameSessionDailyContinuityLatchedRef.current;
      if (existing?.sessionId === sessionId) return;
      sameSessionDailyContinuityLatchedRef.current = {
        sessionId,
        latchedAtMs: Date.now(),
        source,
      };
      vdbg("daily_call_same_session_continuity_latched", {
        sessionId,
        source,
      });
    },
    [],
  );

  const clearSameSessionDailyContinuity = useCallback(
    (sessionId: string | null, source: string) => {
      const existing = sameSessionDailyContinuityLatchedRef.current;
      if (!existing) return;
      if (sessionId && existing.sessionId !== sessionId) return;
      sameSessionDailyContinuityLatchedRef.current = null;
      vdbg("daily_call_same_session_continuity_cleared", {
        sessionId: sessionId ?? existing.sessionId,
        source,
        previousSource: existing.source,
        ageMs: Math.max(0, Date.now() - existing.latchedAtMs),
      });
    },
    [],
  );

  const hasSameSessionDailyContinuity = useCallback(
    (sessionId: string | null) => {
      if (!sessionId) return false;
      return (
        sameSessionDailyContinuityLatchedRef.current?.sessionId === sessionId
      );
    },
    [],
  );

  const sharedRuntime: VideoCallSharedRuntime = {
    options,
    isConnecting,
    isConnected,
    isVideoOff,
    isFlippingCamera,
    localStream,
    networkTier,
    dailyMeetingState,
    captureProfile,
    setIsConnecting,
    setIsConnected,
    setCanFlipCamera,
    setIsFlippingCamera,
    setHasPermission,
    setLocalStream,
    setNetworkTier,
    setRemotePlayback,
    setPeerMissing,
    setDailyReconnectState,
    setDailyMeetingState,
    setLocalInDailyRoom,
    setReconnectGraceTimeLeft,
    setMediaPermissionError,
    setMediaPermissionResult,
    setCaptureProfile,
    localVideoRef,
    remoteVideoRef,
    callObjectRef,
    roomNameRef,
    optionsRef,
    firstRemoteObservedRef,
    localVideoReadyTrackedRef,
    remoteFirstFrameTrackedRef,
    activeDailyCallIdentityRef,
    lastLocalTrackIdsRef,
    lastLocalStreamRef,
    lastRemoteTrackIdsRef,
    lastRemoteStreamRef,
    lastLocalMountedTrackKeyRef,
    lastRemoteMountedTrackKeyRef,
    firstRemoteWatchdogRef,
    lastRemoteRenderParticipantIdRef,
    activeCallSessionIdRef,
    latestLocalParticipantRef,
    latestRemoteParticipantRef,
    cameraSwitchInFlightRef,
    lastRemoteCameraSwitchHintIdRef,
    activeRemoteCameraSwitchRenderWatchRef,
    reconnectGraceTimeoutRef,
    reconnectGraceTickerRef,
    reconnectRecoveryResetTimeoutRef,
    reconnectGraceActiveRef,
    reconnectPartnerAwayTriggeredRef,
    reconnectSyncRequestedRef,
    playbackBlockedRef,
    captureProfileRef,
    activePreparedEntryCacheRef,
    activePreparedEntryCacheHitRef,
    dailyJoinStartedAtMsRef,
    appAcquiredMediaRef,
    lastMediaHandoffUsedRef,
    lastMediaHandoffMissReasonRef,
    lastDailyPrewarmConsumedRef,
    lastDailyPrewarmFallbackReasonRef,
    lastPrewarmedJoinInFlightRef,
    lastPrewarmedAlreadyJoinedRef,
    lastProviderVerifySkippedRef,
    dailyListenerGenerationRef,
    dailyEventListenerCleanupsRef,
    dailyTokenRefreshTimerRef,
    dailyTokenRecoveryInFlightRef,
    latchSameSessionDailyContinuity,
    clearSameSessionDailyContinuity,
    hasSameSessionDailyContinuity,
  };

  const heartbeat = useDailyAliveHeartbeat(sharedRuntime);
  const {
    clearDailyEventListeners,
    clearDailyTokenRefreshTimer,
    clearDailyAliveHeartbeatTimer,
    startDailyAliveHeartbeat,
  } = heartbeat;

  const remoteSeen = useVideoDateRemoteSeen({
    ...sharedRuntime,
    ...heartbeat,
  });
  const { markRemoteFirstFrameRendered } = remoteSeen;


  const renderPipeline = useRemoteRenderPipeline({
    ...sharedRuntime,
    ...remoteSeen,
  });
  const {
    attachTracks,
    needsTrackReattach,
    logTrackMounted,
    clearFirstRemoteWatchdog,
    remoteRenderDiagnostics,
    resetRemoteRenderRecoveryAttempts,
    clearRemoteRenderValidation,
    resetRemoteRenderRecoveryForParticipant,
    forceRemoteMediaReattach,
    scheduleRemoteRenderValidation,
  } = renderPipeline;


  const cameraSwitch = useWebCameraSwitch(sharedRuntime);
  const { flipCamera } = cameraSwitch;


  const preflight = useVideoDateMediaPreflight(sharedRuntime);
  const { releaseAppAcquiredMedia, preflightMediaPermission } = preflight;


  const callCleanup = useDailyCallCleanup({
    ...sharedRuntime,
    ...heartbeat,
    ...renderPipeline,
    ...preflight,
  });
  const { clearReconnectGraceTimers, cleanupCallObject } = callCleanup;


  const startCallPipeline = useVideoDateStartCall({
    ...sharedRuntime,
    ...heartbeat,
    ...renderPipeline,
    ...preflight,
    ...callCleanup,
  });
  const { startCall } = startCallPipeline;



  const retryRemotePlayback = useCallback(() => {
    const participant = latestRemoteParticipantRef.current;
    const videoEl = remoteVideoRef.current;
    trackEvent(LobbyPostDateEvents.VIDEO_DATE_PLAYBACK_RETRY, {
      platform: "web",
      session_id: optionsRef.current?.roomId ?? null,
      event_id: optionsRef.current?.eventId ?? null,
    });
    setRemotePlayback((prev) => ({
      ...prev,
      playRejected: false,
      error: undefined,
      retryCount: prev.retryCount + 1,
    }));

    if (!participant || !videoEl) {
      vdbg("daily_remote_video_play_retry_skipped", {
        sessionId: optionsRef.current?.roomId ?? null,
        eventId: optionsRef.current?.eventId ?? null,
        userId: optionsRef.current?.userId ?? null,
        hasParticipant: Boolean(participant),
        hasVideoElement: Boolean(videoEl),
      });
      return;
    }

    vdbg("daily_remote_video_play_retry", {
      sessionId: optionsRef.current?.roomId ?? null,
      eventId: optionsRef.current?.eventId ?? null,
      userId: optionsRef.current?.userId ?? null,
      participantSessionId: participant.session_id ?? null,
    });
    attachTracks(participant, videoEl, false);
    videoEl.defaultMuted = false;
    videoEl.muted = false;
    const audiblePlay = videoEl.play();
    if (audiblePlay && typeof audiblePlay.then === "function") {
      void audiblePlay
        .then(() => {
          const recoveredFromBlock = playbackBlockedRef.current;
          playbackBlockedRef.current = false;
          setRemotePlayback((prev) => ({
            ...prev,
            playSucceeded: true,
            playRejected: false,
            error: undefined,
          }));
          if (recoveredFromBlock) {
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_PLAYBACK_RECOVERED, {
              platform: "web",
              session_id: optionsRef.current?.roomId ?? null,
              event_id: optionsRef.current?.eventId ?? null,
              source_action: "remote_playback_retry_gesture",
            });
          }
        })
        .catch((error: unknown) => {
          playbackBlockedRef.current = true;
          videoEl.defaultMuted = true;
          videoEl.muted = true;
          void videoEl.play().catch(() => undefined);
          setRemotePlayback((prev) => ({
            ...prev,
            playSucceeded: false,
            playRejected: true,
            error: describeMediaError(error) || "Remote video paused. Tap to resume.",
          }));
          vdbg("daily_remote_video_play_retry_rejected", {
            sessionId: optionsRef.current?.roomId ?? null,
            eventId: optionsRef.current?.eventId ?? null,
            userId: optionsRef.current?.userId ?? null,
            participantSessionId: participant.session_id ?? null,
            error:
              error instanceof Error
                ? { name: error.name, message: error.message }
                : String(error),
          });
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_PLAYBACK_BLOCKED, {
            platform: "web",
            session_id: optionsRef.current?.roomId ?? null,
            event_id: optionsRef.current?.eventId ?? null,
            reason:
              error instanceof Error ? error.name : "retry_play_rejected",
            source_action: "remote_playback_retry_gesture",
          });
        });
    }
  }, [attachTracks]);

  const clearPeerMissing = useCallback(() => {
    setPeerMissing({ terminal: false });
  }, []);

  const clearMediaPermissionError = useCallback(() => {
    setMediaPermissionResult(null);
    setMediaPermissionError(null);
  }, []);

  const endCall = useCallback(
    async (reason = "manual_end") => {
      const roomName = roomNameRef.current;
      const sessionId = optionsRef.current?.roomId ?? null;
      const eventId = optionsRef.current?.eventId ?? null;
      const userId = optionsRef.current?.userId ?? null;
      await cleanupCallObject("endCall", reason);

      if (roomName) {
        vdbg("daily_room_delete_skipped", {
          action: "delete_room",
          caller: "useVideoCall.endCall",
          reason: "backend_cleanup_owns_video_date_rooms",
          endReason: reason,
          sessionId,
          eventId,
          userId,
          roomName,
        });
        roomNameRef.current = null;
      }
      activeDailyCallIdentityRef.current = null;

      optionsRef.current?.onCallEnded?.();
    },
    [cleanupCallObject],
  );

  const toggleMute = useCallback(() => {
    const co = callObjectRef.current;
    if (co) {
      const newMuted = !isMuted;
      co.setLocalAudio(!newMuted);
      setIsMuted(newMuted);
    }
  }, [isMuted]);

  const toggleVideo = useCallback(() => {
    const co = callObjectRef.current;
    if (co) {
      const newOff = !isVideoOff;
      co.setLocalVideo(!newOff);
      setIsVideoOff(newOff);
    }
  }, [isVideoOff]);



  const cleanupCallObjectRef = useRef(cleanupCallObject);
  useEffect(() => {
    cleanupCallObjectRef.current = cleanupCallObject;
  }, [cleanupCallObject]);

  useEffect(() => {
    return () => {
      void cleanupCallObjectRef.current(
        "useVideoCall.unmount",
        "component_unmount",
      );
    };
  }, []);

  /** Stable getter for the canonical room name after startCall succeeds. */
  const getRoomName = useCallback(() => roomNameRef.current, []);

  return {
    isConnecting,
    isConnected,
    isMuted,
    isVideoOff,
    hasPermission,
    mediaPermissionError,
    mediaPermissionResult,
    networkTier,
    remotePlayback,
    peerMissing,
    dailyReconnectState,
    dailyMeetingState,
    localInDailyRoom,
    reconnectGraceTimeLeft,
    captureProfile,
    localVideoRef,
    remoteVideoRef,
    localStream,
    canFlipCamera,
    isFlippingCamera,
    startCall,
    endCall,
    retryRemotePlayback,
    clearPeerMissing,
    clearMediaPermissionError,
    toggleMute,
    toggleVideo,
    flipCamera,
    getRoomName,
  };
};
