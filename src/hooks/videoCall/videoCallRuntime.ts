import type {
  Dispatch,
  MutableRefObject,
  RefObject,
  SetStateAction,
} from "react";
import type { DailyCall, DailyParticipant } from "@daily-co/daily-js";
import type { PreparedVideoDateEntryCacheEntry } from "@clientShared/matching/videoDatePrepareEntry";
import type { VideoDateWebMediaCaptureProfile } from "@clientShared/matching/videoDateMediaContract";
import type {
  MediaPermissionResult,
} from "@clientShared/media/mediaPermissionResult";
import type {
  AppAcquiredVideoDateMedia,
  DailyReconnectState,
  PeerMissingState,
  RemoteCameraSwitchRenderWatch,
  RemotePlaybackState,
  VideoCallNetworkTier,
  VideoDateMediaPromptIntent,
} from "@/lib/daily/webDailyMediaHelpers";

/**
 * Shared wiring types for the decomposed `useVideoCall` hook family
 * (Video Date rebuild PR 7.5).
 *
 * The parent hook owns every piece of React state plus all refs shared by
 * two or more concern sub-hooks, and passes them down with their ORIGINAL
 * names. Sub-hooks destructure exactly what they use, so the extracted
 * bodies stay verbatim and every contract pin keeps matching.
 *
 * Sub-hook call order in the parent is part of the behavior contract:
 * heartbeat -> remoteSeen -> renderPipeline -> cameraSwitch -> preflight ->
 * cleanup -> startCall. Effects (and their unmount cleanups) run in that
 * order, which preserves the original single-file source order.
 */

export interface UseVideoCallOptions {
  roomId?: string;
  userId?: string;
  eventId?: string;
  videoSessionState?: string;
  localDecisionPersisted?: boolean;
  onCallEnded?: () => void;
  onPartnerJoined?: () => void;
  onPartnerLeft?: () => void;
  onPartnerTransientDisconnect?: () => void;
  onPartnerTransientRecover?: () => void;
  onTerminalSurveyTruth?: (source: string) => void;
  dailyCallSingletonEligible?: boolean;
}

export type VideoCallStartOptions = {
  internalRetry?: boolean;
  mediaPromptIntent?: VideoDateMediaPromptIntent;
  skipStartGate?: boolean;
};

export type ActiveDailyCallIdentity = {
  sessionId: string;
  userId: string;
  ownerId: string | null;
  callInstanceId: string;
  entryAttemptId: string | null;
  videoDateTraceId: string | null;
};

export type VideoCallSharedRuntime = {
  options: UseVideoCallOptions | undefined;

  isConnecting: boolean;
  isConnected: boolean;
  isVideoOff: boolean;
  isFlippingCamera: boolean;
  localStream: MediaStream | null;
  networkTier: VideoCallNetworkTier;
  dailyMeetingState: string | null;
  captureProfile: VideoDateWebMediaCaptureProfile;

  setIsConnecting: Dispatch<SetStateAction<boolean>>;
  setIsConnected: Dispatch<SetStateAction<boolean>>;
  setCanFlipCamera: Dispatch<SetStateAction<boolean>>;
  setIsFlippingCamera: Dispatch<SetStateAction<boolean>>;
  setHasPermission: Dispatch<SetStateAction<boolean | null>>;
  setLocalStream: Dispatch<SetStateAction<MediaStream | null>>;
  setNetworkTier: Dispatch<SetStateAction<VideoCallNetworkTier>>;
  setRemotePlayback: Dispatch<SetStateAction<RemotePlaybackState>>;
  setPeerMissing: Dispatch<SetStateAction<PeerMissingState>>;
  setDailyReconnectState: Dispatch<SetStateAction<DailyReconnectState>>;
  setDailyMeetingState: Dispatch<SetStateAction<string | null>>;
  setLocalInDailyRoom: Dispatch<SetStateAction<boolean>>;
  setReconnectGraceTimeLeft: Dispatch<SetStateAction<number>>;
  setMediaPermissionError: Dispatch<SetStateAction<string | null>>;
  setMediaPermissionResult: Dispatch<SetStateAction<MediaPermissionResult | null>>;
  setCaptureProfile: Dispatch<SetStateAction<VideoDateWebMediaCaptureProfile>>;

  localVideoRef: RefObject<HTMLVideoElement>;
  remoteVideoRef: RefObject<HTMLVideoElement>;
  callObjectRef: MutableRefObject<DailyCall | null>;
  roomNameRef: MutableRefObject<string | null>;
  optionsRef: MutableRefObject<UseVideoCallOptions | undefined>;
  firstRemoteObservedRef: MutableRefObject<boolean>;
  localVideoReadyTrackedRef: MutableRefObject<boolean>;
  remoteFirstFrameTrackedRef: MutableRefObject<boolean>;
  activeDailyCallIdentityRef: MutableRefObject<ActiveDailyCallIdentity | null>;
  lastLocalTrackIdsRef: MutableRefObject<string>;
  lastLocalStreamRef: MutableRefObject<MediaStream | null>;
  lastRemoteTrackIdsRef: MutableRefObject<string>;
  lastRemoteStreamRef: MutableRefObject<MediaStream | null>;
  lastLocalMountedTrackKeyRef: MutableRefObject<string>;
  lastRemoteMountedTrackKeyRef: MutableRefObject<string>;
  firstRemoteWatchdogRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  lastRemoteRenderParticipantIdRef: MutableRefObject<string | null>;
  activeCallSessionIdRef: MutableRefObject<string | null>;
  latestLocalParticipantRef: MutableRefObject<DailyParticipant | undefined>;
  latestRemoteParticipantRef: MutableRefObject<DailyParticipant | undefined>;
  cameraSwitchInFlightRef: MutableRefObject<boolean>;
  lastRemoteCameraSwitchHintIdRef: MutableRefObject<string | null>;
  activeRemoteCameraSwitchRenderWatchRef: MutableRefObject<RemoteCameraSwitchRenderWatch | null>;
  reconnectGraceTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  reconnectGraceTickerRef: MutableRefObject<ReturnType<typeof setInterval> | null>;
  reconnectRecoveryResetTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  reconnectGraceActiveRef: MutableRefObject<boolean>;
  reconnectPartnerAwayTriggeredRef: MutableRefObject<boolean>;
  reconnectSyncRequestedRef: MutableRefObject<boolean>;
  playbackBlockedRef: MutableRefObject<boolean>;
  captureProfileRef: MutableRefObject<VideoDateWebMediaCaptureProfile>;
  activePreparedEntryCacheRef: MutableRefObject<PreparedVideoDateEntryCacheEntry | null>;
  activePreparedEntryCacheHitRef: MutableRefObject<boolean | null>;
  dailyJoinStartedAtMsRef: MutableRefObject<number | null>;
  appAcquiredMediaRef: MutableRefObject<AppAcquiredVideoDateMedia | null>;
  lastMediaHandoffUsedRef: MutableRefObject<boolean>;
  lastMediaHandoffMissReasonRef: MutableRefObject<string | null>;
  lastDailyPrewarmConsumedRef: MutableRefObject<boolean>;
  lastPrewarmedJoinInFlightRef: MutableRefObject<boolean>;
  lastPrewarmedAlreadyJoinedRef: MutableRefObject<boolean>;
  lastProviderVerifySkippedRef: MutableRefObject<boolean | null>;
  dailyListenerGenerationRef: MutableRefObject<number>;
  dailyEventListenerCleanupsRef: MutableRefObject<Array<() => void>>;
  dailyTokenRefreshTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  dailyTokenRecoveryInFlightRef: MutableRefObject<boolean>;

  /**
   * Same-session Daily continuity latch (parent-owned). Protects live
   * same-session remount parking; see PR #1240 heartbeat-transfer notes.
   */
  latchSameSessionDailyContinuity: (sessionId: string, source: string) => void;
  clearSameSessionDailyContinuity: (
    sessionId: string | null,
    source: string,
  ) => void;
  hasSameSessionDailyContinuity: (sessionId: string | null) => boolean;
};
