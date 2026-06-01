/**
 * Global match call controller for 1:1 voice/video calls via Daily.co and match_calls.
 * Native now mirrors the web lifecycle model:
 * - app-level incoming listener
 * - INSERT + UPDATE reconciliation from backend state
 * - single server-owned answer transition
 * - overlays mounted once at the app root instead of inside chat screens
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Daily, { type DailyParticipant } from '@daily-co/react-native-daily-js';
import { Alert, AppState, type AppStateStatus } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { IncomingCallOverlay } from '@/components/chat/IncomingCallOverlay';
import { ActiveCallOverlay } from '@/components/chat/ActiveCallOverlay';
import { fetchUserProfile } from '@/lib/fetchUserProfile';
import {
  MATCH_CALL_EDGE_CODES,
  messageForMatchCallEdgeCode,
} from '@clientShared/chat/matchCallEdgeCodes';
import { logMatchCallDiag } from '@clientShared/chat/matchCallDiag';
import { resolveNativeCameraSwitchCommit } from '@clientShared/chat/nativeCameraSwitchCommit';
import {
  createMatchCall,
  answerMatchCall,
  joinMatchCall,
  transitionMatchCall,
  updateMatchCallStatus,
  deleteMatchCallRoom,
  type MatchCallEndReason,
  type MatchCallTransitionAction,
} from '@/lib/matchCallApi';
import { openPermissionSettings } from '@/lib/permissionSettings';

type MatchCallType = 'voice' | 'video';
type MatchCallStatus = 'ringing' | 'active' | 'ended' | 'missed' | 'declined';
type MatchCallPhase = 'idle' | 'ringing' | 'in_call';

type MatchCallRow = {
  id: string;
  match_id: string;
  caller_id: string;
  callee_id: string;
  call_type: string;
  daily_room_name: string;
  daily_room_url: string;
  status: MatchCallStatus;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  created_at: string;
  ended_reason?: MatchCallEndReason | null;
  ended_by_user_id?: string | null;
};

export type NativeLastCallOutcome = {
  callId: string;
  reason: MatchCallEndReason;
  endedByMe: boolean;
  endedByPartner: boolean;
  partnerName: string;
  callType: MatchCallType;
  role: 'caller' | 'callee';
};

const NATIVE_OUTCOME_LINGER_MS = 5_000;

type PartnerSummary = {
  userId: string | null;
  name: string;
  avatarUrl: string | null;
};

export type IncomingCallData = {
  callId: string;
  matchId: string;
  callerId: string;
  callerName: string;
  callerAvatarUri: string | null;
  callType: MatchCallType;
};

type StartCallParams = {
  matchId: string;
  type: MatchCallType;
  partnerUserId?: string | null;
  partnerName?: string | null;
  partnerAvatarUri?: string | null;
};

type UseMatchCallOptions = {
  matchId: string | null;
  currentUserId?: string | null | undefined;
  partnerUserId?: string | null;
  partnerName?: string | null;
  partnerAvatarUri?: string | null;
  onCallEnded?: () => void;
};

type MatchCallContextValue = {
  isRinging: boolean;
  isInCall: boolean;
  isReconnecting: boolean;
  callType: MatchCallType;
  callDuration: number;
  incomingCall: IncomingCallData | null;
  isMuted: boolean;
  isVideoOff: boolean;
  lastOutcome: NativeLastCallOutcome | null;
  localParticipant: DailyParticipant | null;
  remoteParticipant: DailyParticipant | null;
  activeMatchId: string | null;
  canFlipCamera: boolean;
  isFlippingCamera: boolean;
  startCall: (params: StartCallParams) => Promise<void>;
  acceptCall: () => Promise<void>;
  declineCall: () => Promise<void>;
  markIncomingCallMissed: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleMute: () => void;
  toggleVideo: () => void;
  flipCamera: () => Promise<void>;
  getTrack: (
    participant: DailyParticipant | undefined,
    kind: 'video' | 'audio'
  ) => import('@daily-co/react-native-webrtc').MediaStreamTrack | null;
};

const MATCH_CALL_HEARTBEAT_MS = 15_000;
const MATCH_CALL_REMOTE_RECONNECT_GRACE_MS = 30_000;
const NATIVE_MATCH_CALL_CAMERA_SWITCH_COMMIT_TIMEOUT_MS = 1_800;
const NATIVE_MATCH_CALL_CAMERA_SWITCH_COMMIT_POLL_MS = 80;

type MatchCallCleanupOptions = {
  deleteRoomName?: string | null;
  skipRoomDelete?: boolean;
  /** When true, `match_call_transition` was already applied (or DB row is already terminal). */
  skipServerTransition?: boolean;
  /** When true, only release the Daily SDK object and preserve the active call flow state. */
  preserveCallState?: boolean;
};

type NativeDailyCallObject = ReturnType<typeof Daily.createCallObject>;
type MatchCallPermissionSettingsTarget = 'microphone' | 'camera';

function readDailyMeetingState(callObject: Pick<NativeDailyCallObject, 'meetingState'>): string | null {
  try {
    return callObject.meetingState();
  } catch {
    return 'error';
  }
}

function isTerminalDailyMeetingState(state: string | null): boolean {
  return state === 'left-meeting' || state === 'error';
}

function isReusableDailyCallObject(callObject: NativeDailyCallObject): boolean {
  try {
    if (callObject.isDestroyed()) return false;
  } catch {
    return false;
  }

  return readDailyMeetingState(callObject) === 'joined-meeting';
}

function isBusyDailyMeetingState(state: string | null): boolean {
  return !isTerminalDailyMeetingState(state);
}

function dailyEventHasError(event: unknown): boolean {
  if (!event || typeof event !== 'object') return false;
  const payload = event as Record<string, unknown>;
  return typeof payload.errorMsg === 'string' || Boolean(payload.error);
}

function isDuplicateDailyCallObjectError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Duplicate DailyIframe instances|multiple call instances/i.test(message);
}

function resolveAbnormalTransitionForTeardown(
  callId: string,
  incoming: { callId: string } | null,
  phase: MatchCallPhase
): MatchCallTransitionAction | null {
  if (incoming?.callId === callId) {
    return 'mark_missed';
  }
  if (phase === 'ringing' || phase === 'in_call') {
    return 'end';
  }
  return null;
}

type MatchCallRealtimeChannel = {
  on: (
    type: 'postgres_changes',
    filter: {
      event: 'INSERT' | 'UPDATE';
      schema: 'public';
      table: 'match_calls';
      filter: string;
    },
    callback: (payload: { new: MatchCallRow | null; old: MatchCallRow | null }) => void,
  ) => MatchCallRealtimeChannel;
  subscribe: () => unknown;
};

type NativeMediaStreamTrack = import('@daily-co/react-native-webrtc').MediaStreamTrack;
type NativeDailyCameraFacingMode = 'user' | 'environment';
type NativeDailyCameraDevice = {
  deviceId?: string | number;
  id?: string | number;
  kind?: string;
  facing?: unknown;
  facingMode?: unknown;
  label?: string;
};
type NativeDailyCameraControls = {
  getCameraFacingMode?: () => Promise<NativeDailyCameraFacingMode | null>;
  cycleCamera?: () => Promise<{ device?: NativeDailyCameraDevice | null } | undefined>;
  setCamera?: (cameraDeviceId: string | number) => Promise<{ device?: NativeDailyCameraDevice | null } | undefined>;
  enumerateDevices?: () => Promise<{ devices?: NativeDailyCameraDevice[] } | NativeDailyCameraDevice[]>;
};
type NativeCameraSwitchCommitMethod = 'set_camera' | 'cycle_camera';
type NativeLocalCameraSnapshot = {
  trackId: string | null;
  deviceId: string | null;
  facingMode: NativeDailyCameraFacingMode | null;
  readyState: string | null;
  enabled: boolean | null;
};
type NativeCameraStateSource = 'empty' | 'track' | 'controls' | 'commit';
type NativeCameraState = {
  deviceId: string | number | null;
  deviceKey: string | null;
  facingMode: NativeDailyCameraFacingMode | null;
  source: NativeCameraStateSource;
};
type NativeCameraSwitchCommit = NativeLocalCameraSnapshot & {
  method: NativeCameraSwitchCommitMethod;
  latencyMs: number;
};
type NativeCameraSwitchCommitExpectation = {
  expectedDeviceKey?: string | null;
  expectedFacing?: NativeDailyCameraFacingMode | null;
  previousControlsFacing?: NativeDailyCameraFacingMode | null;
};

const MatchCallContext = createContext<MatchCallContextValue | null>(null);

const DEFAULT_PARTNER: PartnerSummary = {
  userId: null,
  name: 'Your match',
  avatarUrl: null,
};

function normalizeCallType(value: string | null | undefined): MatchCallType {
  return value === 'voice' ? 'voice' : 'video';
}

function secondsSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  const startedAtMs = new Date(iso).getTime();
  if (!Number.isFinite(startedAtMs)) return 0;
  return Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
}

function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

export function getTrack(
  participant: DailyParticipant | undefined,
  kind: 'video' | 'audio'
): NativeMediaStreamTrack | null {
  if (!participant) return null;
  const trackInfo = participant.tracks?.[kind];
  if (trackInfo && (trackInfo.state === 'off' || trackInfo.state === 'blocked')) {
    return null;
  }
  const p = participant as unknown as {
    tracks?: { video?: { persistentTrack?: unknown }; audio?: { persistentTrack?: unknown } };
    videoTrack?: unknown;
    audioTrack?: unknown;
  };
  if (p.tracks) {
    const track = kind === 'video' ? p.tracks.video?.persistentTrack : p.tracks.audio?.persistentTrack;
    if (track) return track as import('@daily-co/react-native-webrtc').MediaStreamTrack;
  }
  const deprecatedTrack = kind === 'video' ? p.videoTrack : p.audioTrack;
  return deprecatedTrack === false || deprecatedTrack === undefined
    ? null
    : (deprecatedTrack as NativeMediaStreamTrack);
}

function sleepNativeMatchCallCameraSwitch(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeNativeCameraFacingMode(value: unknown): NativeDailyCameraFacingMode | null {
  return value === 'user' || value === 'environment' ? value : null;
}

function oppositeNativeCameraFacingMode(value: NativeDailyCameraFacingMode | null): NativeDailyCameraFacingMode | null {
  if (value === 'user') return 'environment';
  if (value === 'environment') return 'user';
  return null;
}

function nativeCameraDeviceId(device: NativeDailyCameraDevice | null | undefined): string | number | null {
  if (!device) return null;
  if (typeof device.deviceId === 'string' || typeof device.deviceId === 'number') return device.deviceId;
  if (typeof device.id === 'string' || typeof device.id === 'number') return device.id;
  return null;
}

function nativeCameraDeviceKey(device: NativeDailyCameraDevice | null | undefined): string | null {
  const id = nativeCameraDeviceId(device);
  return id == null ? null : String(id);
}

function nativeCameraFacingModeFromLabel(label: unknown): NativeDailyCameraFacingMode | null {
  if (typeof label !== 'string') return null;
  const normalized = label.toLowerCase();
  if (/\b(front|user|self|face)\b/.test(normalized)) return 'user';
  if (/\b(back|rear|environment|world)\b/.test(normalized)) return 'environment';
  return null;
}

function nativeCameraDeviceFacingMode(device: NativeDailyCameraDevice | null | undefined): NativeDailyCameraFacingMode | null {
  if (!device) return null;
  return (
    normalizeNativeCameraFacingMode(device.facingMode) ??
    normalizeNativeCameraFacingMode(device.facing) ??
    nativeCameraFacingModeFromLabel(device.label)
  );
}

function nativeCameraDevicesFromResult(
  result: { devices?: NativeDailyCameraDevice[] } | NativeDailyCameraDevice[] | undefined
): NativeDailyCameraDevice[] {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.devices)) return result.devices;
  return [];
}

function nativeVideoCameraDevices(devices: NativeDailyCameraDevice[]): NativeDailyCameraDevice[] {
  return devices.filter((device) => device.kind === undefined || device.kind === 'videoinput');
}

function nativeCameraSwitchResultDevice(
  result: { device?: NativeDailyCameraDevice | null } | undefined
): NativeDailyCameraDevice | null {
  return result?.device ?? null;
}

function emptyNativeCameraState(): NativeCameraState {
  return {
    deviceId: null,
    deviceKey: null,
    facingMode: null,
    source: 'empty',
  };
}

function nativeLocalCameraSnapshot(participant: DailyParticipant | null | undefined): NativeLocalCameraSnapshot {
  const videoTrack = getTrack(participant ?? undefined, 'video') as
    | (NativeMediaStreamTrack & {
        label?: string;
        getSettings?: () => { deviceId?: unknown; facingMode?: unknown };
      })
    | null;
  const settings = typeof videoTrack?.getSettings === 'function' ? videoTrack.getSettings() : null;
  const settingsDeviceId = settings?.deviceId;

  return {
    trackId: typeof videoTrack?.id === 'string' ? videoTrack.id : null,
    deviceId: typeof settingsDeviceId === 'string' ? settingsDeviceId : null,
    facingMode:
      normalizeNativeCameraFacingMode(settings?.facingMode) ??
      nativeCameraFacingModeFromLabel(videoTrack?.label),
    readyState: typeof videoTrack?.readyState === 'string' ? videoTrack.readyState : null,
    enabled: typeof videoTrack?.enabled === 'boolean' ? videoTrack.enabled : null,
  };
}

function nativeCameraStateFromSnapshot(
  snapshot: NativeLocalCameraSnapshot,
  source: NativeCameraStateSource = 'track'
): NativeCameraState {
  return {
    deviceId: snapshot.deviceId,
    deviceKey: snapshot.deviceId,
    facingMode: snapshot.facingMode,
    source,
  };
}

function nativeCameraStateFromDevice(
  device: NativeDailyCameraDevice | null | undefined,
  source: NativeCameraStateSource = 'commit'
): NativeCameraState {
  const deviceId = nativeCameraDeviceId(device);
  return {
    deviceId,
    deviceKey: deviceId == null ? null : String(deviceId),
    facingMode: nativeCameraDeviceFacingMode(device),
    source,
  };
}

function mergeNativeCameraState(
  preferred: NativeCameraState,
  fallback: NativeCameraState,
  source: NativeCameraStateSource = preferred.source
): NativeCameraState {
  return {
    deviceId: preferred.deviceId ?? fallback.deviceId,
    deviceKey: preferred.deviceKey ?? fallback.deviceKey,
    facingMode: preferred.facingMode ?? fallback.facingMode,
    source,
  };
}

function nativeCameraStateFromCommit(
  commit: NativeCameraSwitchCommit,
  fallbackDevice: NativeDailyCameraDevice | null | undefined
): NativeCameraState {
  const fallbackState = nativeCameraStateFromDevice(fallbackDevice, 'commit');
  const commitState: NativeCameraState = {
    deviceId: commit.deviceId,
    deviceKey: commit.deviceId,
    facingMode: commit.facingMode,
    source: 'commit',
  };
  const fallbackDeviceMatchesCommittedFacing = Boolean(
    fallbackState.deviceKey &&
      fallbackState.facingMode &&
      commit.facingMode &&
      fallbackState.facingMode === commit.facingMode
  );

  if (fallbackDeviceMatchesCommittedFacing) {
    return {
      deviceId: fallbackState.deviceId,
      deviceKey: fallbackState.deviceKey,
      facingMode: commit.facingMode,
      source: 'commit',
    };
  }

  return mergeNativeCameraState(
    commitState,
    fallbackState,
    'commit'
  );
}

function chooseNativeCameraDevice(
  devices: NativeDailyCameraDevice[],
  desiredFacing: NativeDailyCameraFacingMode | null,
  current: NativeCameraState
): NativeDailyCameraDevice | null {
  const usable = nativeVideoCameraDevices(devices);
  if (usable.length === 0) return null;
  const currentDeviceKey = current.deviceKey;
  const nonCurrentCandidates = currentDeviceKey != null
    ? usable.filter((device) => nativeCameraDeviceKey(device) !== currentDeviceKey)
    : usable;
  if (desiredFacing) {
    const desiredFacingMatches = usable.filter((device) => nativeCameraDeviceFacingMode(device) === desiredFacing);
    if (desiredFacingMatches.length > 0) {
      return (
        desiredFacingMatches.find((device) => nativeCameraDeviceKey(device) !== currentDeviceKey) ??
        desiredFacingMatches[0] ??
        null
      );
    }

    const unknownFacingFallback = nonCurrentCandidates.find((device) => nativeCameraDeviceFacingMode(device) == null);
    if (unknownFacingFallback) return unknownFacingFallback;

    if (current.facingMode) {
      return nonCurrentCandidates.find((device) => nativeCameraDeviceFacingMode(device) !== current.facingMode) ?? null;
    }

    return nonCurrentCandidates[0] ?? null;
  }
  return currentDeviceKey != null ? nonCurrentCandidates[0] ?? null : null;
}

function describeNativeCameraSwitchError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name || 'Error', message: error.message };
  return { name: 'unknown', message: String(error) };
}

function applyLocalMediaUiFromParticipant(
  participant: DailyParticipant,
  setIsVideoOff: (value: boolean) => void,
  setIsMuted: (value: boolean) => void
) {
  const videoState = participant.tracks?.video?.state;
  const audioState = participant.tracks?.audio?.state;
  if (videoState !== undefined) setIsVideoOff(videoState === 'off' || videoState === 'blocked');
  if (audioState !== undefined) setIsMuted(audioState === 'off' || audioState === 'blocked');
}

export function MatchCallProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;

  const [callPhase, setCallPhase] = useState<MatchCallPhase>('idle');
  const [callType, setCallType] = useState<MatchCallType>('video');
  const [callDuration, setCallDuration] = useState(0);
  const [incomingCall, setIncomingCall] = useState<IncomingCallData | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [lastOutcome, setLastOutcome] = useState<NativeLastCallOutcome | null>(null);
  const [canFlipCamera, setCanFlipCamera] = useState(false);
  const [isFlippingCamera, setIsFlippingCamera] = useState(false);
  const flipCameraRef = useRef(false);
  const nativeCameraStateRef = useRef<NativeCameraState>(emptyNativeCameraState());
  const [activePartner, setActivePartner] = useState<PartnerSummary>(DEFAULT_PARTNER);
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [localParticipant, setLocalParticipant] = useState<DailyParticipant | null>(null);
  const [remoteParticipant, setRemoteParticipant] = useState<DailyParticipant | null>(null);

  const callObjectRef = useRef<NativeDailyCallObject | null>(null);
  const trackedCallIdRef = useRef<string | null>(null);
  const roomNameRef = useRef<string | null>(null);
  const outcomeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startCallAttemptRef = useRef(0);
  const startCallLockRef = useRef(false);
  const joiningCallIdRef = useRef<string | null>(null);
  const joinPromiseRef = useRef<Promise<void> | null>(null);
  const localCallCleanupPromiseRef = useRef<Promise<void> | null>(null);
  const preserveCallStateCleanupRef = useRef(false);
  const providerTeardownPromiseRef = useRef<Promise<void> | null>(null);
  const reconcileQueueRef = useRef(Promise.resolve());
  const reconcileSignatureByCallIdRef = useRef(new Map<string, string>());
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const remoteReconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const matchCallPermissionSettingsTargetRef = useRef<MatchCallPermissionSettingsTarget | null>(null);
  /** When true, a background/unload path already invoked `match_call_transition`; skip duplicate in `cleanupLocalCall`. */
  const documentUnloadRpcIssuedRef = useRef(false);

  const callPhaseRef = useLatestRef(callPhase);
  const callTypeRef = useLatestRef(callType);
  const incomingCallRef = useLatestRef(incomingCall);
  const activePartnerRef = useLatestRef(activePartner);
  const localParticipantRef = useLatestRef(localParticipant);
  const reconcileCallRowRef = useRef<(row: MatchCallRow) => Promise<void>>(async () => {});

  const clearRingingTimeout = useCallback(() => {
    if (ringingTimeoutRef.current) {
      clearTimeout(ringingTimeoutRef.current);
      ringingTimeoutRef.current = null;
    }
  }, []);

  const stopDurationTimer = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
  }, []);

  const startDurationTimer = useCallback((startedAt?: string | null) => {
    if (durationIntervalRef.current) return;
    setCallDuration(secondsSince(startedAt));
    durationIntervalRef.current = setInterval(() => {
      setCallDuration((previous) => previous + 1);
    }, 1000);
  }, []);

  const fetchPartnerSummary = useCallback(async (profileId: string, fallbackName = 'Your match') => {
    const data = await fetchUserProfile(profileId);

    return {
      userId: profileId,
      name: data?.name || fallbackName,
      avatarUrl: data?.avatar_url || null,
    } satisfies PartnerSummary;
  }, []);

  const transitionRpc = useCallback(async (callId: string, action: MatchCallTransitionAction) => {
    await transitionMatchCall(callId, action);
  }, []);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  }, []);

  const startHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) return;

    const beat = () => {
      const callId = trackedCallIdRef.current;
      if (!callId) return;
      void transitionMatchCall(callId, 'heartbeat').catch((err) => {
        logMatchCallDiag('heartbeat_failed', {
          call_id: callId,
          message: err instanceof Error ? err.message : String(err),
        });
      });
    };

    beat();
    heartbeatIntervalRef.current = setInterval(beat, MATCH_CALL_HEARTBEAT_MS);
  }, []);

  const clearRemoteReconnectGrace = useCallback(() => {
    if (remoteReconnectTimeoutRef.current) {
      clearTimeout(remoteReconnectTimeoutRef.current);
      remoteReconnectTimeoutRef.current = null;
    }
  }, []);

  const cleanupLocalCall = useCallback(
    async (options: MatchCallCleanupOptions = {}) => {
      if (localCallCleanupPromiseRef.current) {
        await localCallCleanupPromiseRef.current;
      }

      const cleanupPromise = Promise.resolve().then(async () => {
        const {
          deleteRoomName,
          skipRoomDelete = false,
          skipServerTransition = false,
          preserveCallState = false,
        } = options;
        const shouldAttemptAbnormalRpc =
          !preserveCallState &&
          !skipServerTransition &&
          !documentUnloadRpcIssuedRef.current &&
          trackedCallIdRef.current;

        if (shouldAttemptAbnormalRpc) {
          const callId = trackedCallIdRef.current!;
          const action = resolveAbnormalTransitionForTeardown(
            callId,
            incomingCallRef.current,
            callPhaseRef.current
          );
          if (action) {
            try {
              await transitionRpc(callId, action);
              logMatchCallDiag('abnormal_teardown_rpc_ok', {
                call_id: callId,
                action,
                phase: callPhaseRef.current,
              });
            } catch (err) {
              logMatchCallDiag('abnormal_teardown_rpc_failed', {
                call_id: callId,
                action,
                phase: callPhaseRef.current,
                message: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
        if (!preserveCallState) {
          documentUnloadRpcIssuedRef.current = false;
          clearRingingTimeout();
          stopDurationTimer();
        }

        clearRemoteReconnectGrace();
        stopHeartbeat();

        const callObject = callObjectRef.current;
        // Null the ref before awaiting leave/destroy, but keep a cleanup promise so
        // retries do not create a new Daily singleton until the old one is released.
        callObjectRef.current = null;
        if (preserveCallState) {
          preserveCallStateCleanupRef.current = true;
        }
        if (callObject) {
          try {
            try {
              await callObject.leave();
            } catch {
              // ignore
            }
            try {
              await callObject.destroy();
            } catch {
              // ignore
            }
          } finally {
            if (preserveCallState) {
              preserveCallStateCleanupRef.current = false;
            }
          }
        } else if (preserveCallState) {
          preserveCallStateCleanupRef.current = false;
        }

        const roomName = deleteRoomName ?? roomNameRef.current;
        if (!preserveCallState) {
          trackedCallIdRef.current = null;
          roomNameRef.current = null;
          startCallLockRef.current = false;
          joiningCallIdRef.current = null;
          joinPromiseRef.current = null;
          reconcileSignatureByCallIdRef.current.clear();
          setCallPhase('idle');
          setIncomingCall(null);
          setActiveMatchId(null);
          setActivePartner(DEFAULT_PARTNER);
          setCallDuration(0);
          setIsMuted(false);
          setIsVideoOff(false);
          setCanFlipCamera(false);
          setIsFlippingCamera(false);
          flipCameraRef.current = false;
          nativeCameraStateRef.current = emptyNativeCameraState();
          setLocalParticipant(null);
          setRemoteParticipant(null);
        }

        if (roomName && !skipRoomDelete) {
          await deleteMatchCallRoom(roomName);
        }
      });

      localCallCleanupPromiseRef.current = cleanupPromise;
      try {
        await cleanupPromise;
      } finally {
        if (localCallCleanupPromiseRef.current === cleanupPromise) {
          localCallCleanupPromiseRef.current = null;
        }
      }
    },
    [
      callPhaseRef,
      clearRemoteReconnectGrace,
      clearRingingTimeout,
      incomingCallRef,
      stopHeartbeat,
      stopDurationTimer,
      transitionRpc,
    ],
  );

  const runSingleJoinFlow = useCallback(async (callId: string, run: () => Promise<void>) => {
    if (
      callObjectRef.current &&
      trackedCallIdRef.current === callId &&
      isReusableDailyCallObject(callObjectRef.current)
    ) {
      return;
    }
    if (joinPromiseRef.current) {
      if (joiningCallIdRef.current === callId) {
        await joinPromiseRef.current;
      }
      return;
    }

    joiningCallIdRef.current = callId;
    const joinPromise = (async () => {
      try {
        await run();
      } finally {
        if (joiningCallIdRef.current === callId) {
          joiningCallIdRef.current = null;
          joinPromiseRef.current = null;
        }
      }
    })();
    joinPromiseRef.current = joinPromise;
    await joinPromise;
  }, []);

  const endCall = useCallback(
    async (reason?: MatchCallEndReason) => {
      const callId = trackedCallIdRef.current;
      const roomName = roomNameRef.current;

      if (callId) {
        try {
          await transitionMatchCall(callId, 'end', reason ?? null);
        } catch {
          // Realtime terminal update can still reconcile remote ownership.
        }
      }

      await cleanupLocalCall({ deleteRoomName: roomName, skipServerTransition: true });
    },
    [cleanupLocalCall],
  );

  const teardownForProviderError = useCallback(
    (source: string, event?: unknown) => {
      if (providerTeardownPromiseRef.current) {
        logMatchCallDiag('provider_teardown_deduped', { source });
        return;
      }

      logMatchCallDiag('provider_teardown_started', {
        source,
        message:
          event && typeof event === 'object' && 'errorMsg' in event
            ? String((event as { errorMsg?: unknown }).errorMsg ?? '')
            : null,
      });
      Alert.alert('Call connection error', 'Please try again.');
      const teardownPromise = Promise.resolve()
        .then(() => endCall('provider_error'))
        .finally(() => {
          providerTeardownPromiseRef.current = null;
        });
      providerTeardownPromiseRef.current = teardownPromise;
      void teardownPromise;
    },
    [endCall],
  );

  const waitForProviderTeardown = useCallback(async (source: string): Promise<boolean> => {
    const teardownPromise = providerTeardownPromiseRef.current;
    if (!teardownPromise) return false;

    logMatchCallDiag('provider_teardown_awaited_by_flow', { source });
    try {
      await teardownPromise;
    } catch {
      // The provider teardown path owns final local cleanup; callers should not
      // duplicate the same failure UX or transition if that cleanup itself fails.
    }
    return true;
  }, []);

  const hasBusyExternalDailyCall = useCallback((source: string): boolean => {
    try {
      const sdkCallObject = Daily.getCallInstance();
      if (!sdkCallObject || sdkCallObject === callObjectRef.current) return false;

      const meetingState = readDailyMeetingState(sdkCallObject);
      if (!isBusyDailyMeetingState(meetingState)) return false;

      logMatchCallDiag('external_daily_call_busy', {
        source,
        meeting_state: meetingState,
      });
      return true;
    } catch (err) {
      logMatchCallDiag('external_daily_call_busy_check_failed', {
        source,
        message: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }, []);

  const cleanupStaleCallObjectForFreshCreate = useCallback(
    async (callId: string, source: string): Promise<boolean> => {
      if (localCallCleanupPromiseRef.current) {
        logMatchCallDiag('fresh_create_waited_for_cleanup', { call_id: callId, source });
        await localCallCleanupPromiseRef.current;
      }

      const existingCallObject = callObjectRef.current;
      if (!existingCallObject) return false;

      const meetingState = readDailyMeetingState(existingCallObject);
      const sameCall = trackedCallIdRef.current === callId;
      if (sameCall && isReusableDailyCallObject(existingCallObject)) {
        logMatchCallDiag('fresh_create_reused_existing_call_object', {
          call_id: callId,
          source,
          meeting_state: meetingState,
        });
        return true;
      }

      logMatchCallDiag('fresh_create_cleaned_stale_call_object', {
        call_id: callId,
        source,
        tracked_call_id: trackedCallIdRef.current,
        meeting_state: meetingState,
      });
      await cleanupLocalCall({
        skipRoomDelete: true,
        skipServerTransition: true,
        preserveCallState: true,
      });
      return false;
    },
    [cleanupLocalCall],
  );

  const createFreshMatchCallObject = useCallback(
    async (callId: string, currentCallType: MatchCallType, source: string): Promise<NativeDailyCallObject | null> => {
      const shouldReuseExisting = await cleanupStaleCallObjectForFreshCreate(callId, source);
      if (shouldReuseExisting) return null;

      const options = {
        audioSource: true,
        videoSource: currentCallType === 'video',
      };

      try {
        return Daily.createCallObject(options);
      } catch (error) {
        if (!isDuplicateDailyCallObjectError(error)) throw error;

        logMatchCallDiag('fresh_create_recovered_duplicate_daily_instance', {
          call_id: callId,
          source,
          message: error instanceof Error ? error.message : String(error),
        });
        const sdkCallObject = Daily.getCallInstance();
        if (sdkCallObject) {
          const sdkMeetingState = readDailyMeetingState(sdkCallObject);
          if (isBusyDailyMeetingState(sdkMeetingState)) {
            logMatchCallDiag('fresh_create_duplicate_daily_instance_busy', {
              call_id: callId,
              source,
              meeting_state: sdkMeetingState,
            });
            throw error;
          }
          callObjectRef.current = sdkCallObject;
          await cleanupLocalCall({
            skipRoomDelete: true,
            skipServerTransition: true,
            preserveCallState: true,
          });
        } else if (localCallCleanupPromiseRef.current) {
          await localCallCleanupPromiseRef.current;
        } else {
          throw error;
        }
        return Daily.createCallObject(options);
      }
    },
    [cleanupLocalCall, cleanupStaleCallObjectForFreshCreate],
  );

  const setupCallEvents = useCallback(
    (callObject: NativeDailyCallObject) => {
      callObject.on('participant-joined', (event: { participant?: DailyParticipant }) => {
        if (!event?.participant || (event.participant as unknown as { local?: boolean }).local) return;
        clearRingingTimeout();
        clearRemoteReconnectGrace();
        setIsReconnecting(false);
        setCallPhase('in_call');
        setRemoteParticipant(event.participant);
        startDurationTimer();
        startHeartbeat();
      });

      callObject.on('participant-updated', (event: { participant?: DailyParticipant }) => {
        if (!event?.participant) return;
        const participant = event.participant;
        if ((participant as unknown as { local?: boolean }).local) {
          setLocalParticipant(participant);
          applyLocalMediaUiFromParticipant(participant, setIsVideoOff, setIsMuted);
        } else {
          setRemoteParticipant(participant);
        }
      });

      callObject.on('participant-left', (event: { participant?: DailyParticipant }) => {
        if (!event?.participant || (event.participant as unknown as { local?: boolean }).local) return;
        clearRemoteReconnectGrace();
        setIsReconnecting(true);
        remoteReconnectTimeoutRef.current = setTimeout(() => {
          remoteReconnectTimeoutRef.current = null;
          if (callPhaseRef.current !== 'in_call' || !trackedCallIdRef.current) return;
          setIsReconnecting(false);
          void endCall('connection_lost');
        }, MATCH_CALL_REMOTE_RECONNECT_GRACE_MS);
      });

      callObject.on('error', (event: unknown) => {
        teardownForProviderError('daily_error', event);
      });

      callObject.on('left-meeting', (event: unknown) => {
        if (preserveCallStateCleanupRef.current) return;
        clearRingingTimeout();
        stopDurationTimer();
        setCallPhase('idle');
        if (dailyEventHasError(event)) {
          teardownForProviderError('left_meeting_error', event);
        }
      });
    },
    [
      callPhaseRef,
      clearRemoteReconnectGrace,
      clearRingingTimeout,
      endCall,
      startDurationTimer,
      startHeartbeat,
      stopDurationTimer,
      teardownForProviderError,
    ],
  );

  const markIncomingCallMissed = useCallback(async () => {
    const callId = incomingCallRef.current?.callId ?? trackedCallIdRef.current;
    const roomName = roomNameRef.current;
    if (!callId) return;

    try {
      await updateMatchCallStatus(callId, 'missed');
    } catch {
      // ignore
    }

    await cleanupLocalCall({ deleteRoomName: roomName, skipServerTransition: true });
  }, [cleanupLocalCall, incomingCallRef]);

  const declineCall = useCallback(async () => {
    const callId = incomingCallRef.current?.callId ?? trackedCallIdRef.current;
    const roomName = roomNameRef.current;
    if (!callId) return;

    try {
      await updateMatchCallStatus(callId, 'declined');
    } catch {
      // ignore
    }

    await cleanupLocalCall({ deleteRoomName: roomName, skipServerTransition: true });
  }, [cleanupLocalCall, incomingCallRef]);

  const acceptCall = useCallback(async () => {
    const pendingIncoming = incomingCallRef.current;
    if (!pendingIncoming) return;

    if (await hasBusyExternalDailyCall('answer_call_preflight')) {
      Alert.alert('Call in progress', 'Finish your current call before answering.');
      return;
    }

    let answeredRoomName: string | null = roomNameRef.current;
    let receivedJoinToken = false;
    try {
      const result = await answerMatchCall(pendingIncoming.callId);
      if (!result.ok) {
        if (result.code === MATCH_CALL_EDGE_CODES.TOKEN_ISSUE_FAILED) {
          Alert.alert(
            'Connection issue',
            messageForMatchCallEdgeCode(result.code) ??
              'Could not connect — please try again in a moment.',
          );
        } else {
          Alert.alert(
            "Couldn't connect call",
            messageForMatchCallEdgeCode(result.code) ?? 'Please try again.',
          );
        }
        await cleanupLocalCall({ deleteRoomName: answeredRoomName, skipServerTransition: true });
        return;
      }

      const payload = result.data;
      receivedJoinToken = true;
      answeredRoomName = payload.room_name ?? roomNameRef.current;
      roomNameRef.current = answeredRoomName;
      trackedCallIdRef.current = pendingIncoming.callId;
      setCallType(pendingIncoming.callType);
      setCallPhase('in_call');
      setIncomingCall(null);
      startDurationTimer();

      await runSingleJoinFlow(pendingIncoming.callId, async () => {
        const callObject = await createFreshMatchCallObject(
          pendingIncoming.callId,
          pendingIncoming.callType,
          'answer_call',
        );
        if (!callObject) return;
        callObjectRef.current = callObject;
        setupCallEvents(callObject);

        await callObject.join({ url: payload.room_url, token: payload.token });

        try {
          await callObject.setLocalAudio(true);
        } catch (err) {
          logMatchCallDiag('set_local_audio_failed', {
            call_id: pendingIncoming.callId,
            message: err instanceof Error ? err.message : String(err),
          });
        }
        try {
          await callObject.setLocalVideo(pendingIncoming.callType === 'video');
        } catch (err) {
          logMatchCallDiag('set_local_video_failed', {
            call_id: pendingIncoming.callId,
            message: err instanceof Error ? err.message : String(err),
          });
        }

        const local = callObject.participants()?.local;
        if (local) {
          setLocalParticipant(local);
          applyLocalMediaUiFromParticipant(local, setIsVideoOff, setIsMuted);
        }
        await transitionMatchCall(pendingIncoming.callId, 'joined').catch((err) => {
          logMatchCallDiag('answer_joined_transition_failed', {
            call_id: pendingIncoming.callId,
            message: err instanceof Error ? err.message : String(err),
          });
        });
        startHeartbeat();
      });
    } catch {
      if (await waitForProviderTeardown('answer_call_catch')) return;

      if (receivedJoinToken) {
        try {
          await transitionMatchCall(pendingIncoming.callId, 'join_failed');
        } catch {
          // ignore
        }
      }

      await cleanupLocalCall({ deleteRoomName: answeredRoomName, skipServerTransition: true });
    }
  }, [
    cleanupLocalCall,
    createFreshMatchCallObject,
    hasBusyExternalDailyCall,
    incomingCallRef,
    runSingleJoinFlow,
    setupCallEvents,
    startDurationTimer,
    startHeartbeat,
    waitForProviderTeardown,
  ]);

  const startCall = useCallback(
    async ({ matchId, type, partnerUserId, partnerName, partnerAvatarUri }: StartCallParams) => {
      if (!matchId) return;
      if (startCallLockRef.current) return;
      if (trackedCallIdRef.current || incomingCallRef.current || callPhaseRef.current !== 'idle') return;
      startCallLockRef.current = true;
      if (await hasBusyExternalDailyCall('start_call_preflight')) {
        Alert.alert('Call in progress', 'Finish your current call before starting another one.');
        startCallLockRef.current = false;
        return;
      }

      logMatchCallDiag('start_call_invoked', { match_id: matchId, call_type: type });
      const startCallAttemptId = startCallAttemptRef.current + 1;
      startCallAttemptRef.current = startCallAttemptId;
      const isCurrentStartCallAttempt = () => startCallAttemptRef.current === startCallAttemptId;
      const invalidateStartCallAttempt = () => {
        if (startCallAttemptRef.current === startCallAttemptId) {
          startCallAttemptRef.current += 1;
        }
      };

      setCallType(type);
      setCallPhase('ringing');
      setActiveMatchId(matchId);
      setActivePartner({
        userId: partnerUserId ?? null,
        name: partnerName?.trim() || DEFAULT_PARTNER.name,
        avatarUrl: partnerAvatarUri ?? null,
      });

      let createdCallId: string | null = null;
      let createdRoomName: string | null = null;

      const startWatchdogId = setTimeout(() => {
        if (
          callPhaseRef.current === 'ringing' &&
          !trackedCallIdRef.current &&
          isCurrentStartCallAttempt()
        ) {
          invalidateStartCallAttempt();
          logMatchCallDiag('start_call_watchdog_fired', { match_id: matchId, call_type: type });
          Alert.alert("Couldn't start call", 'Please try again.');
          void cleanupLocalCall({ skipServerTransition: true });
        }
      }, 15_000);

      try {
        const result = await createMatchCall(matchId, type);
        logMatchCallDiag('start_call_edge_response', {
          match_id: matchId,
          ok: result.ok,
          code: result.ok ? null : (result.code ?? null),
          reused: result.ok ? Boolean(result.data.reused) : null,
          existing_call_type: result.ok ? result.data.existing_call_type ?? null : null,
          call_type_mismatch: result.ok ? Boolean(result.data.call_type_mismatch) : null,
        });
        if (!result.ok) {
          clearTimeout(startWatchdogId);
          if (!isCurrentStartCallAttempt()) {
            return;
          }
          // Backend redirected: there is an open incoming call from the partner. Bail out
          // of the create flow and let the IncomingCallOverlay drive the answer.
          if (result.code === 'INCOMING_CALL_AVAILABLE' && 'data' in result) {
            const incoming = result.data;
            invalidateStartCallAttempt();
            const incomingType: 'voice' | 'video' =
              incoming.existing_call_type === 'voice' || incoming.existing_call_type === 'video'
                ? incoming.existing_call_type
                : type;
            const incomingPartnerName = partnerName?.trim() || DEFAULT_PARTNER.name;
            trackedCallIdRef.current = incoming.call_id;
            roomNameRef.current = null;
            setCallType(incomingType);
            setActiveMatchId(incoming.match_id);
            setActivePartner({
              userId: partnerUserId ?? null,
              name: incomingPartnerName,
              avatarUrl: partnerAvatarUri ?? null,
            });
            setIncomingCall({
              callId: incoming.call_id,
              matchId: incoming.match_id,
              callerId: partnerUserId ?? '',
              callerName: incomingPartnerName,
              callerAvatarUri: partnerAvatarUri ?? null,
              callType: incomingType,
            });
            setCallPhase('idle');
            setCallDuration(0);
            clearRingingTimeout();
            stopDurationTimer();
            Alert.alert(
              'Incoming call',
              `${incomingPartnerName} is calling — answer or decline.`,
            );
            return;
          }
          const dup = result.code === MATCH_CALL_EDGE_CODES.DUPLICATE_ACTIVE_CALL;
          Alert.alert(
            dup ? 'Call in progress' : "Couldn't start call",
            messageForMatchCallEdgeCode(result.code) ??
              (dup ? 'A call is already in progress for this chat.' : 'Please try again.'),
          );
          await cleanupLocalCall();
          return;
        }

        const payload = result.data;
        const callId = payload.call_id;
        const roomName = payload.room_name;
        // Honour the existing call's modality when the backend reused an open row of a
        // different type. The UI mode-switches so the user sees the actual call.
        const effectiveType: 'voice' | 'video' =
          payload.call_type_mismatch &&
          (payload.existing_call_type === 'voice' || payload.existing_call_type === 'video')
            ? payload.existing_call_type
            : type;
        if (effectiveType !== type) {
          setCallType(effectiveType);
        }
        if (payload.reused && payload.status === 'active') {
          setCallPhase('in_call');
        }
        if (!isCurrentStartCallAttempt()) {
          logMatchCallDiag('start_call_stale_success_ignored', {
            call_id: callId,
            match_id: matchId,
          });
          clearTimeout(startWatchdogId);
          try {
            await transitionMatchCall(callId, 'join_failed');
          } catch {
            // ignore
          }
          if (roomName) {
            await deleteMatchCallRoom(roomName).catch(() => {});
          }
          return;
        }
        createdCallId = callId;
        createdRoomName = roomName;
        trackedCallIdRef.current = callId;
        roomNameRef.current = createdRoomName;
        clearTimeout(startWatchdogId);

        await runSingleJoinFlow(callId, async () => {
          const callObject = await createFreshMatchCallObject(
            callId,
            effectiveType,
            'start_call',
          );
          if (!callObject) return;
          callObjectRef.current = callObject;
          setupCallEvents(callObject);

          await callObject.join({ url: payload.room_url, token: payload.token });

          // Force-publish local media. Calling these explicitly guarantees the mic and
          // (for video calls) camera produce tracks the remote participant can subscribe
          // to. Without this, the call can look "connected" with no audio.
          try {
            await callObject.setLocalAudio(true);
          } catch (err) {
            logMatchCallDiag('set_local_audio_failed', {
              call_id: callId,
              message: err instanceof Error ? err.message : String(err),
            });
          }
          try {
            await callObject.setLocalVideo(effectiveType === 'video');
          } catch (err) {
            logMatchCallDiag('set_local_video_failed', {
              call_id: callId,
              message: err instanceof Error ? err.message : String(err),
            });
          }

          const local = callObject.participants()?.local;
          if (local) {
            setLocalParticipant(local);
            applyLocalMediaUiFromParticipant(local, setIsVideoOff, setIsMuted);
          }
          await transitionMatchCall(callId, 'joined').catch((err) => {
            logMatchCallDiag('start_joined_transition_failed', {
              call_id: callId,
              message: err instanceof Error ? err.message : String(err),
            });
          });
          startHeartbeat();
        });

        clearRingingTimeout();
        ringingTimeoutRef.current = setTimeout(() => {
          const currentTrackedCallId = trackedCallIdRef.current;
          if (!currentTrackedCallId || callPhaseRef.current !== 'ringing') return;
          void (async () => {
            try {
              await updateMatchCallStatus(currentTrackedCallId, 'missed');
            } catch {
              // ignore
            }
            await cleanupLocalCall({ deleteRoomName: roomNameRef.current, skipServerTransition: true });
          })();
        }, 30000);
      } catch (error) {
        clearTimeout(startWatchdogId);
        if (!isCurrentStartCallAttempt()) {
          return;
        }
        if (await waitForProviderTeardown('start_call_catch')) {
          return;
        }
        logMatchCallDiag('start_call_threw', {
          match_id: matchId,
          message: error instanceof Error ? error.message : String(error),
        });
        if (createdCallId) {
          try {
            await transitionMatchCall(createdCallId, 'join_failed');
          } catch {
            // ignore
          }
        }

        await cleanupLocalCall({ deleteRoomName: createdRoomName, skipServerTransition: true });
      } finally {
        startCallLockRef.current = false;
      }
    },
    [
      callPhaseRef,
      cleanupLocalCall,
      clearRingingTimeout,
      createFreshMatchCallObject,
      hasBusyExternalDailyCall,
      incomingCallRef,
      runSingleJoinFlow,
      setupCallEvents,
      startHeartbeat,
      stopDurationTimer,
      waitForProviderTeardown,
    ],
  );

  const openMatchCallPermissionSettings = useCallback((target: MatchCallPermissionSettingsTarget) => {
    matchCallPermissionSettingsTargetRef.current = target;
    const source = target === 'microphone' ? 'match_call_microphone' : 'match_call_camera';
    void openPermissionSettings(source).then((opened) => {
      if (!opened && matchCallPermissionSettingsTargetRef.current === target) {
        matchCallPermissionSettingsTargetRef.current = null;
      }
    });
  }, []);

  const retryMatchCallMediaAfterSettingsReturn = useCallback(async () => {
    const target = matchCallPermissionSettingsTargetRef.current;
    if (!target) return;
    matchCallPermissionSettingsTargetRef.current = null;

    const callObject = callObjectRef.current;
    if (!callObject || callPhaseRef.current !== 'in_call') return;

    try {
      if (target === 'microphone') {
        await callObject.setLocalAudio(true);
        setIsMuted(false);
      } else {
        if (callTypeRef.current !== 'video') return;
        await callObject.setLocalVideo(true);
        setIsVideoOff(false);
      }

      const local = callObject.participants().local;
      if (local) {
        applyLocalMediaUiFromParticipant(local, setIsVideoOff, setIsMuted);
        if (target === 'camera') {
          nativeCameraStateRef.current = nativeCameraStateFromSnapshot(nativeLocalCameraSnapshot(local));
        }
      }
      logMatchCallDiag('settings_return_media_retry_ok', { target });
    } catch (error) {
      logMatchCallDiag('settings_return_media_retry_failed', {
        target,
        message: error instanceof Error ? error.message : String(error),
      });
      Alert.alert(
        target === 'microphone' ? 'Microphone still off' : 'Camera still off',
        target === 'microphone'
          ? 'Allow microphone access in Settings, then return to the call.'
          : 'Allow camera access in Settings, then return to the call.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open Settings', onPress: () => openMatchCallPermissionSettings(target) },
        ],
      );
    }
  }, [callPhaseRef, callTypeRef, openMatchCallPermissionSettings]);

  const toggleMute = useCallback(() => {
    const callObject = callObjectRef.current;
    if (!callObject) return;
    const local = callObject.participants().local;
    if (local?.tracks?.audio?.state === 'blocked') {
      Alert.alert(
        'Microphone access needed',
        'Microphone access is off for Vibely. Re-enable it in Settings, then return to the call.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open Settings', onPress: () => openMatchCallPermissionSettings('microphone') },
        ],
      );
      return;
    }
    const nextMuted = !isMuted;
    void Promise.resolve()
      .then(() => callObject.setLocalAudio(!nextMuted))
      .then(() => setIsMuted(nextMuted))
      .catch(() => {
        Alert.alert('Microphone issue', 'Could not update your microphone. Try again in a moment.');
      });
  }, [isMuted, openMatchCallPermissionSettings]);

  const toggleVideo = useCallback(() => {
    const callObject = callObjectRef.current;
    if (!callObject) return;
    const local = callObject.participants().local;
    if (local?.tracks?.video?.state === 'blocked') {
      Alert.alert(
        'Camera access needed',
        'Camera access is off for Vibely. Re-enable it in Settings, then return to the call.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open Settings', onPress: () => openMatchCallPermissionSettings('camera') },
        ],
      );
      return;
    }
    const nextVideoOff = !isVideoOff;
    void Promise.resolve()
      .then(() => callObject.setLocalVideo(!nextVideoOff))
      .then(() => {
        setIsVideoOff(nextVideoOff);
        if (nextVideoOff) {
          nativeCameraStateRef.current = emptyNativeCameraState();
        }
      })
      .catch(() => {
        Alert.alert('Camera issue', 'Could not update your camera. Try again in a moment.');
      });
  }, [isVideoOff, openMatchCallPermissionSettings]);

  const readNativeLocalCameraSnapshot = useCallback(
    (callObject: ReturnType<typeof Daily.createCallObject> | null | undefined) => {
      let local = localParticipantRef.current;
      try {
        const callLocal = callObject?.participants?.()?.local;
        if (callLocal) {
          local = callLocal;
          localParticipantRef.current = callLocal;
        }
      } catch {
        // Keep the most recent participant snapshot from Daily events.
      }
      return nativeLocalCameraSnapshot(local);
    },
    [localParticipantRef],
  );

  const readNativeCameraFacingMode = useCallback(
    async (controls: NativeDailyCameraControls | null | undefined) => {
      try {
        return typeof controls?.getCameraFacingMode === 'function'
          ? normalizeNativeCameraFacingMode(await controls.getCameraFacingMode())
          : null;
      } catch {
        return null;
      }
    },
    [],
  );

  const resolveNativeCameraState = useCallback(
    async (
      controls: NativeDailyCameraControls | null | undefined,
      callObject: ReturnType<typeof Daily.createCallObject> | null | undefined,
      snapshot = readNativeLocalCameraSnapshot(callObject)
    ): Promise<NativeCameraState> => {
      const trackState = nativeCameraStateFromSnapshot(snapshot, 'track');
      const controlsFacing = await readNativeCameraFacingMode(controls);
      const controlsFacingConflictsWithTrack = Boolean(
        controlsFacing &&
          trackState.facingMode &&
          controlsFacing !== trackState.facingMode
      );
      const observedState: NativeCameraState = controlsFacing
        ? {
            ...trackState,
            facingMode: controlsFacingConflictsWithTrack ? controlsFacing : trackState.facingMode ?? controlsFacing,
            source: controlsFacingConflictsWithTrack || !trackState.facingMode ? 'controls' : 'track',
          }
        : trackState;
      const committedState = nativeCameraStateRef.current;
      const committedFacingConflictsWithObserved = Boolean(
        committedState.facingMode &&
          observedState.facingMode &&
          committedState.facingMode !== observedState.facingMode
      );

      if (committedFacingConflictsWithObserved) {
        return mergeNativeCameraState(observedState, committedState, observedState.source);
      }

      if (committedState.source === 'commit' && (committedState.deviceKey || committedState.facingMode)) {
        return mergeNativeCameraState(committedState, observedState, committedState.source);
      }

      return observedState;
    },
    [readNativeCameraFacingMode, readNativeLocalCameraSnapshot],
  );

  const waitForNativeCameraSwitchCommit = useCallback(
    async (
      controls: NativeDailyCameraControls,
      callObject: ReturnType<typeof Daily.createCallObject>,
      before: NativeLocalCameraSnapshot,
      baseline: NativeCameraState,
      method: NativeCameraSwitchCommitMethod,
      expectation: NativeCameraSwitchCommitExpectation = {}
    ): Promise<NativeCameraSwitchCommit | null> => {
      const startedAtMs = Date.now();
      const baselineDeviceKey = baseline.deviceKey;
      const beforeDeviceKey = before.deviceId == null ? null : String(before.deviceId);
      const expectedDeviceKey = expectation.expectedDeviceKey ?? null;
      const expectedFacing = expectation.expectedFacing ?? null;
      const previousControlsFacing = expectation.previousControlsFacing ?? null;

      while (Date.now() - startedAtMs <= NATIVE_MATCH_CALL_CAMERA_SWITCH_COMMIT_TIMEOUT_MS) {
        const controlsFacing = await readNativeCameraFacingMode(controls);
        const snapshot = readNativeLocalCameraSnapshot(callObject);
        const snapshotFacing = snapshot.facingMode;
        const snapshotDeviceKey = snapshot.deviceId == null ? null : String(snapshot.deviceId);
        const commitResolution = resolveNativeCameraSwitchCommit({
          baselineDeviceKey,
          baselineFacingMode: baseline.facingMode,
          beforeDeviceKey,
          beforeFacingMode: before.facingMode,
          beforeTrackId: before.trackId,
          previousControlsFacing,
          expectedDeviceKey,
          expectedFacing,
          snapshotDeviceKey,
          snapshotFacingMode: snapshotFacing,
          snapshotTrackId: snapshot.trackId,
          controlsFacing,
          readyState: snapshot.readyState,
          enabled: snapshot.enabled,
        });

        if (commitResolution.shouldCommit) {
          return {
            ...snapshot,
            facingMode: commitResolution.committedFacing,
            method,
            latencyMs: Date.now() - startedAtMs,
          };
        }

        await sleepNativeMatchCallCameraSwitch(NATIVE_MATCH_CALL_CAMERA_SWITCH_COMMIT_POLL_MS);
      }
      return null;
    },
    [readNativeCameraFacingMode, readNativeLocalCameraSnapshot],
  );

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      const callObject = callObjectRef.current;
      const controls = callObject as unknown as NativeDailyCameraControls | null;
      const supportsSwitch =
        !!controls && (typeof controls.cycleCamera === 'function' || typeof controls.setCamera === 'function');
      const localCamera = readNativeLocalCameraSnapshot(callObject);
      const hasLiveLocalCamera =
        localCamera.readyState === 'live' && localCamera.enabled !== false;

      if (callPhase !== 'in_call' || callType !== 'video' || isVideoOff || !supportsSwitch || !hasLiveLocalCamera) {
        if (callPhase !== 'in_call' || callType !== 'video' || isVideoOff || !hasLiveLocalCamera) {
          nativeCameraStateRef.current = emptyNativeCameraState();
        }
        if (!cancelled) setCanFlipCamera(false);
        return;
      }

      if (typeof controls.enumerateDevices === 'function') {
        try {
          const currentCamera = await resolveNativeCameraState(controls, callObject, localCamera);
          const devices = nativeVideoCameraDevices(nativeCameraDevicesFromResult(await controls.enumerateDevices()));
          const deterministicTarget =
            typeof controls.setCamera === 'function'
              ? chooseNativeCameraDevice(
                  devices,
                  oppositeNativeCameraFacingMode(currentCamera.facingMode),
                  currentCamera,
                )
              : null;
          const canFlip =
            devices.length > 1 &&
            (typeof controls.cycleCamera === 'function' || nativeCameraDeviceId(deterministicTarget) != null);
          logMatchCallDiag('camera_flip_capability', {
            platform: 'native',
            video_input_count: devices.length,
            can_flip: canFlip,
            has_cycle_camera: typeof controls.cycleCamera === 'function',
            has_set_camera: typeof controls.setCamera === 'function',
            current_camera_source: currentCamera.source,
            current_device_key: currentCamera.deviceKey,
            current_facing_mode: currentCamera.facingMode,
          });
          if (!cancelled) setCanFlipCamera(canFlip);
          return;
        } catch (err) {
          logMatchCallDiag('camera_flip_capability_enumerate_failed', {
            platform: 'native',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const canFlip = typeof controls.cycleCamera === 'function';
      logMatchCallDiag('camera_flip_capability_fallback', {
        platform: 'native',
        can_flip: canFlip,
        has_cycle_camera: typeof controls.cycleCamera === 'function',
        has_set_camera: typeof controls.setCamera === 'function',
      });
      if (!cancelled) setCanFlipCamera(canFlip);
    };

    void refresh();

    return () => {
      cancelled = true;
    };
  }, [callPhase, callType, isVideoOff, localParticipant, readNativeLocalCameraSnapshot, resolveNativeCameraState]);

  /**
   * Switch between the device's front and rear cameras without leaving the Daily room.
   * Prefer deterministic enumerateDevices + setCamera, then fall back to cycleCamera.
   * The UI only treats the action as successful after Daily exposes a live committed
   * local video track/device/facing-mode change.
   */
  const flipCamera = useCallback(async () => {
    const callObject = callObjectRef.current;
    const controls = callObject as unknown as NativeDailyCameraControls | null;
    if (!callObject || callPhase !== 'in_call' || callType !== 'video' || isVideoOff) return;
    if (flipCameraRef.current) return;
    if (!controls || (typeof controls.setCamera !== 'function' && typeof controls.cycleCamera !== 'function')) {
      setCanFlipCamera(false);
      Alert.alert("Couldn't switch camera", 'Camera switching is not available on this device.');
      return;
    }

    flipCameraRef.current = true;
    setIsFlippingCamera(true);
    try {
      const before = readNativeLocalCameraSnapshot(callObject);
      if (before.readyState !== 'live' || before.enabled === false || !before.trackId) {
        setCanFlipCamera(false);
        Alert.alert("Couldn't switch camera", 'Turn your camera on before switching cameras.');
        return;
      }
      const beforeControlsFacing = await readNativeCameraFacingMode(controls);
      const currentCamera = await resolveNativeCameraState(controls, callObject, before);
      const previousControlsFacing =
        currentCamera.source === 'controls' ? currentCamera.facingMode : beforeControlsFacing;
      const desiredFacing = oppositeNativeCameraFacingMode(currentCamera.facingMode);
      let commit: NativeCameraSwitchCommit | null = null;
      let committedDevice: NativeDailyCameraDevice | null = null;
      let availableVideoDeviceCount: number | null = null;

      logMatchCallDiag('flip_camera_start', {
        platform: 'native',
        current_camera_source: currentCamera.source,
        current_device_key: currentCamera.deviceKey,
        current_facing_mode: currentCamera.facingMode,
        desired_facing_mode: desiredFacing,
        before_device_id: before.deviceId,
        before_facing_mode: before.facingMode,
        before_controls_facing_mode: beforeControlsFacing,
      });

      if (typeof controls.enumerateDevices === 'function' && typeof controls.setCamera === 'function') {
        try {
          const devices = nativeVideoCameraDevices(nativeCameraDevicesFromResult(await controls.enumerateDevices()));
          availableVideoDeviceCount = devices.length;
          const targetDevice = chooseNativeCameraDevice(devices, desiredFacing, currentCamera);
          const targetDeviceId = nativeCameraDeviceId(targetDevice);
          const targetDeviceKey = nativeCameraDeviceKey(targetDevice);
          const targetFacing = nativeCameraDeviceFacingMode(targetDevice);
          const targetCanImproveFacing = Boolean(
            desiredFacing &&
              targetFacing === desiredFacing &&
              currentCamera.facingMode !== desiredFacing
          );
          if (
            targetDeviceId != null &&
            (!currentCamera.deviceKey || targetDeviceKey !== currentCamera.deviceKey || targetCanImproveFacing)
          ) {
            logMatchCallDiag('flip_camera_set_camera_target', {
              platform: 'native',
              desired_facing_mode: desiredFacing,
              current_device_key: currentCamera.deviceKey,
              current_facing_mode: currentCamera.facingMode,
              target_device_key: targetDeviceKey,
              target_facing_mode: targetFacing,
              target_can_improve_facing: targetCanImproveFacing,
              video_input_count: devices.length,
            });
            const result = await controls.setCamera(targetDeviceId);
            const resultDevice = nativeCameraSwitchResultDevice(result);
            const expectedDeviceKey = targetDeviceKey ?? nativeCameraDeviceKey(resultDevice);
            const expectedFacing =
              targetFacing ??
              nativeCameraDeviceFacingMode(resultDevice) ??
              desiredFacing;
            commit = await waitForNativeCameraSwitchCommit(
              controls,
              callObject,
              before,
              currentCamera,
              'set_camera',
              {
                expectedDeviceKey,
                expectedFacing,
                previousControlsFacing,
              },
            );
            if (commit) committedDevice = resultDevice ?? targetDevice;
          } else {
            logMatchCallDiag('flip_camera_set_camera_no_target', {
              platform: 'native',
              desired_facing_mode: desiredFacing,
              current_device_key: currentCamera.deviceKey,
              current_facing_mode: currentCamera.facingMode,
              target_device_key: targetDeviceKey,
              target_facing_mode: targetFacing,
              video_input_count: devices.length,
              before_device_id: before.deviceId,
              before_facing_mode: before.facingMode,
              before_controls_facing_mode: beforeControlsFacing,
            });
          }
        } catch (err) {
          logMatchCallDiag('flip_camera_set_camera_failed_fallback', {
            platform: 'native',
            desired_facing_mode: desiredFacing,
            error: describeNativeCameraSwitchError(err),
          });
        }
      }

      if (!commit && typeof controls.cycleCamera === 'function') {
        try {
          const result = await controls.cycleCamera();
          const resultDevice = nativeCameraSwitchResultDevice(result);
          const expectedDeviceKey = nativeCameraDeviceKey(resultDevice);
          commit = await waitForNativeCameraSwitchCommit(
            controls,
            callObject,
            before,
            currentCamera,
            'cycle_camera',
            {
              expectedDeviceKey,
              expectedFacing: nativeCameraDeviceFacingMode(resultDevice) ?? desiredFacing,
              previousControlsFacing,
            },
          );
          if (commit) committedDevice = resultDevice;
        } catch (err) {
          logMatchCallDiag('flip_camera_cycle_failed', {
            platform: 'native',
            desired_facing_mode: desiredFacing,
            error: describeNativeCameraSwitchError(err),
          });
        }
      }

      if (!commit) {
        const after = readNativeLocalCameraSnapshot(callObject);
        if (availableVideoDeviceCount != null && availableVideoDeviceCount < 2) {
          setCanFlipCamera(false);
        }
        logMatchCallDiag('flip_camera_commit_failed', {
          platform: 'native',
          current_camera_source: currentCamera.source,
          current_device_key: currentCamera.deviceKey,
          current_facing_mode: currentCamera.facingMode,
          desired_facing_mode: desiredFacing,
          video_input_count: availableVideoDeviceCount,
          same_device_after: Boolean(
            currentCamera.deviceKey &&
              after.deviceId &&
              currentCamera.deviceKey === String(after.deviceId)
          ),
          same_facing_after: Boolean(
            currentCamera.facingMode &&
              after.facingMode &&
              currentCamera.facingMode === after.facingMode
          ),
          before,
          after,
        });
        Alert.alert("Couldn't switch camera", 'No additional camera was available.');
        return;
      }

      const committedState = nativeCameraStateFromCommit(commit, committedDevice);
      nativeCameraStateRef.current = committedState;
      setCanFlipCamera(true);
      logMatchCallDiag('flip_camera_committed', {
        platform: 'native',
        method: commit.method,
        current_camera_source: currentCamera.source,
        previous_device_key: currentCamera.deviceKey,
        previous_facing_mode: currentCamera.facingMode,
        committed_device_key: committedState.deviceKey,
        committed_facing_mode: committedState.facingMode,
        facing_mode: commit.facingMode,
        local_video_track_id: commit.trackId,
        local_video_device_id: commit.deviceId,
        commit_latency_ms: commit.latencyMs,
      });
    } catch (err) {
      logMatchCallDiag('flip_camera_failed', {
        platform: 'native',
        error: describeNativeCameraSwitchError(err),
      });
      Alert.alert("Couldn't switch camera", 'Please try again.');
    } finally {
      setIsFlippingCamera(false);
      flipCameraRef.current = false;
    }
  }, [
    callPhase,
    callType,
    isVideoOff,
    readNativeCameraFacingMode,
    readNativeLocalCameraSnapshot,
    resolveNativeCameraState,
    waitForNativeCameraSwitchCommit,
  ]);

  const adoptIncomingCall = useCallback(
    async (row: MatchCallRow) => {
      const existingIncoming = incomingCallRef.current;
      if (existingIncoming?.callId === row.id) {
        trackedCallIdRef.current = row.id;
        roomNameRef.current = row.daily_room_name ?? roomNameRef.current;
        return;
      }

      const trackedCallId = trackedCallIdRef.current;
      if (trackedCallId && trackedCallId !== row.id) {
        try {
          await updateMatchCallStatus(row.id, 'declined');
        } catch {
          // Busy-line handling is best-effort.
        }
        return;
      }

      const partner = await fetchPartnerSummary(row.caller_id);
      trackedCallIdRef.current = row.id;
      roomNameRef.current = row.daily_room_name ?? null;
      setCallType(normalizeCallType(row.call_type));
      setActiveMatchId(row.match_id);
      setActivePartner(partner);
      setIncomingCall({
        callId: row.id,
        matchId: row.match_id,
        callerId: row.caller_id,
        callerName: partner.name,
        callerAvatarUri: partner.avatarUrl,
        callType: normalizeCallType(row.call_type),
      });
      setCallPhase('idle');
      setCallDuration(0);
      clearRingingTimeout();
      stopDurationTimer();
    },
    [clearRingingTimeout, fetchPartnerSummary, incomingCallRef, stopDurationTimer],
  );

  const joinActiveCall = useCallback(
    async (row: MatchCallRow) => {
      if (!currentUserId) return;

      if (!callObjectRef.current && await hasBusyExternalDailyCall('active_rejoin_preflight')) {
        Alert.alert('Call in progress', 'Finish your current call before joining.');
        return;
      }

      trackedCallIdRef.current = row.id;
      roomNameRef.current = row.daily_room_name ?? null;
      const nextCallType = normalizeCallType(row.call_type);
      setCallType(nextCallType);
      setActiveMatchId(row.match_id);
      setIncomingCall(null);
      clearRingingTimeout();

      const partnerId = row.caller_id === currentUserId ? row.callee_id : row.caller_id;
      if (!activePartnerRef.current.userId) {
        const partner = await fetchPartnerSummary(partnerId);
        setActivePartner(partner);
      }

      if (callObjectRef.current) {
        setCallPhase('in_call');
        startDurationTimer(row.started_at);
        startHeartbeat();
        return;
      }

      try {
        const result = await joinMatchCall(row.id);
        if (!result.ok) {
          Alert.alert(
            "Couldn't rejoin call",
            messageForMatchCallEdgeCode(result.code) ?? 'Please try again.',
          );
          await cleanupLocalCall({
            deleteRoomName: row.daily_room_name ?? roomNameRef.current,
            skipRoomDelete: true,
            skipServerTransition: true,
          });
          return;
        }

        const payload = result.data;
        await runSingleJoinFlow(row.id, async () => {
          const callObject = await createFreshMatchCallObject(
            row.id,
            nextCallType,
            'rejoin_call',
          );
          if (!callObject) return;
          callObjectRef.current = callObject;
          setupCallEvents(callObject);
          setCallPhase('in_call');
          startDurationTimer(row.started_at);

          await callObject.join({ url: payload.room_url, token: payload.token });

          try {
            await callObject.setLocalAudio(true);
          } catch (err) {
            logMatchCallDiag('set_local_audio_failed', {
              call_id: row.id,
              message: err instanceof Error ? err.message : String(err),
            });
          }
          try {
            await callObject.setLocalVideo(nextCallType === 'video');
          } catch (err) {
            logMatchCallDiag('set_local_video_failed', {
              call_id: row.id,
              message: err instanceof Error ? err.message : String(err),
            });
          }

          const local = callObject.participants()?.local;
          if (local) {
            setLocalParticipant(local);
            applyLocalMediaUiFromParticipant(local, setIsVideoOff, setIsMuted);
          }
          await transitionMatchCall(row.id, 'joined').catch((err) => {
            logMatchCallDiag('active_rejoin_joined_transition_failed', {
              call_id: row.id,
              message: err instanceof Error ? err.message : String(err),
            });
          });
          startHeartbeat();
        });
      } catch (err) {
        if (await waitForProviderTeardown('active_rejoin_catch')) return;

        logMatchCallDiag('active_rejoin_failed', {
          call_id: row.id,
          message: err instanceof Error ? err.message : String(err),
        });
        try {
          await transitionMatchCall(row.id, 'join_failed');
        } catch {
          // ignore
        }
        await cleanupLocalCall({
          deleteRoomName: row.daily_room_name ?? roomNameRef.current,
          skipServerTransition: true,
        });
      }
    },
    [
      activePartnerRef,
      cleanupLocalCall,
      clearRingingTimeout,
      createFreshMatchCallObject,
      currentUserId,
      fetchPartnerSummary,
      hasBusyExternalDailyCall,
      runSingleJoinFlow,
      setupCallEvents,
      startDurationTimer,
      startHeartbeat,
      waitForProviderTeardown,
    ],
  );

  const reconcileCallRow = useCallback(
    async (row: MatchCallRow) => {
      if (!currentUserId) return;

      const trackedCallId = trackedCallIdRef.current;
      const isTrackedRow = trackedCallId === row.id || incomingCallRef.current?.callId === row.id;

      if (
        row.status === 'active' &&
        !isTrackedRow &&
        (row.caller_id === currentUserId || row.callee_id === currentUserId)
      ) {
        await joinActiveCall(row);
        return;
      }

      if (row.status === 'ringing' && row.callee_id === currentUserId) {
        await adoptIncomingCall(row);
        return;
      }

      if (row.status === 'ringing' && row.caller_id === currentUserId) {
        trackedCallIdRef.current = row.id;
        roomNameRef.current = row.daily_room_name ?? null;
        setCallType(normalizeCallType(row.call_type));
        setActiveMatchId(row.match_id);
        setCallPhase('ringing');
        if (!activePartnerRef.current.userId) {
          const partner = await fetchPartnerSummary(row.callee_id);
          setActivePartner(partner);
        }
        logMatchCallDiag('reconcile_outbound_ring_restore', {
          call_id: row.id,
          match_id: row.match_id,
        });
        return;
      }

      if (!isTrackedRow) return;

      roomNameRef.current = row.daily_room_name ?? roomNameRef.current;
      setCallType(normalizeCallType(row.call_type));

      if (!activePartnerRef.current.userId) {
        const partnerId = row.caller_id === currentUserId ? row.callee_id : row.caller_id;
        const partner = await fetchPartnerSummary(partnerId);
        setActivePartner(partner);
      }

      switch (row.status) {
        case 'ringing':
          if (row.caller_id === currentUserId) {
            setCallPhase('ringing');
            setActiveMatchId(row.match_id);
          }
          break;
        case 'active':
          if (!callObjectRef.current && !(joiningCallIdRef.current === row.id && joinPromiseRef.current)) {
            await joinActiveCall(row);
          } else {
            clearRingingTimeout();
            setIncomingCall(null);
            setActiveMatchId(row.match_id);
            setCallPhase('in_call');
            startDurationTimer(row.started_at);
            startHeartbeat();
          }
          break;
        case 'declined':
        case 'missed':
        case 'ended': {
          const reason = (row.ended_reason ?? null) as MatchCallEndReason | null;
          if (reason) {
            const isCaller = row.caller_id === currentUserId;
            const endedByMe = !!row.ended_by_user_id && row.ended_by_user_id === currentUserId;
            const endedByPartner =
              !!row.ended_by_user_id && row.ended_by_user_id !== currentUserId;
            const partnerName = activePartnerRef.current.name || 'Your match';
            const outcome: NativeLastCallOutcome = {
              callId: row.id,
              reason,
              endedByMe,
              endedByPartner,
              partnerName,
              callType: (row.call_type === 'voice' ? 'voice' : 'video') as MatchCallType,
              role: isCaller ? 'caller' : 'callee',
            };
            setLastOutcome(outcome);
            if (outcomeTimeoutRef.current) clearTimeout(outcomeTimeoutRef.current);
            outcomeTimeoutRef.current = setTimeout(() => {
              setLastOutcome((prev) => (prev?.callId === outcome.callId ? null : prev));
              outcomeTimeoutRef.current = null;
            }, NATIVE_OUTCOME_LINGER_MS);
          }
          await cleanupLocalCall({
            deleteRoomName: row.daily_room_name ?? roomNameRef.current,
            skipServerTransition: true,
          });
          break;
        }
      }
    },
    [
      activePartnerRef,
      adoptIncomingCall,
      cleanupLocalCall,
      clearRingingTimeout,
      currentUserId,
      fetchPartnerSummary,
      incomingCallRef,
      joinActiveCall,
      startDurationTimer,
      startHeartbeat,
    ],
  );

  useEffect(() => {
    reconcileCallRowRef.current = reconcileCallRow;
  }, [reconcileCallRow]);

  const queueReconcileCallRow = useCallback((row: MatchCallRow) => {
    const signature = `${row.status}:${row.started_at ?? ''}:${row.ended_at ?? ''}:${row.daily_room_name ?? ''}:${row.ended_reason ?? ''}:${row.ended_by_user_id ?? ''}`;
    if (reconcileSignatureByCallIdRef.current.get(row.id) === signature) {
      return;
    }
    reconcileSignatureByCallIdRef.current.set(row.id, signature);
    reconcileQueueRef.current = reconcileQueueRef.current
      .then(async () => {
        await reconcileCallRowRef.current(row);
      })
      .catch((err) => {
        logMatchCallDiag('reconcile_queue_failed', {
          call_id: row.id,
          message: err instanceof Error ? err.message : String(err),
        });
      });
  }, []);

  useEffect(() => {
    if (!currentUserId) {
      void cleanupLocalCall();
      return;
    }

    let cancelled = false;

    const handlePayload = (payload: { new: MatchCallRow | null; old: MatchCallRow | null }) => {
      const row = payload.new ?? payload.old;
      if (!row || cancelled) return;
      queueReconcileCallRow(row);
    };

    const channel = supabase.channel(`match-calls-global-${currentUserId}`);
    const realtimeChannel = channel as unknown as MatchCallRealtimeChannel;

    realtimeChannel
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'match_calls',
          filter: `callee_id=eq.${currentUserId}`,
        },
        handlePayload,
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'match_calls',
          filter: `callee_id=eq.${currentUserId}`,
        },
        handlePayload,
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'match_calls',
          filter: `caller_id=eq.${currentUserId}`,
        },
        handlePayload,
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'match_calls',
          filter: `caller_id=eq.${currentUserId}`,
        },
        handlePayload,
      )
      .subscribe();

    void (async () => {
      const sel =
        'id, match_id, caller_id, callee_id, call_type, daily_room_name, daily_room_url, status, started_at, ended_at, duration_seconds, created_at, ended_reason, ended_by_user_id';

      const { data: calleeOpen } = await supabase
        .from('match_calls')
        .select(sel)
        .eq('callee_id', currentUserId)
        .in('status', ['ringing', 'active'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (cancelled) return;
      let row = calleeOpen?.[0] as MatchCallRow | undefined;

      if (!row) {
        const { data: callerOpen } = await supabase
          .from('match_calls')
          .select(sel)
          .eq('caller_id', currentUserId)
          .in('status', ['ringing', 'active'])
          .order('created_at', { ascending: false })
          .limit(1);
        if (cancelled) return;
        row = callerOpen?.[0] as MatchCallRow | undefined;
      }

      if (row) {
        queueReconcileCallRow(row);
      }
    })();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [cleanupLocalCall, currentUserId, queueReconcileCallRow]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        void retryMatchCallMediaAfterSettingsReturn();
        return;
      }
      if (next !== 'background') return;
      const callId = trackedCallIdRef.current;
      if (!callId) return;
      if (callPhaseRef.current === 'in_call') {
        logMatchCallDiag('background_heartbeat_rpc', { call_id: callId });
        void transitionMatchCall(callId, 'heartbeat').catch(() => {});
        return;
      }
      if (documentUnloadRpcIssuedRef.current) return;
      const action = resolveAbnormalTransitionForTeardown(
        callId,
        incomingCallRef.current,
        callPhaseRef.current
      );
      if (!action) return;
      documentUnloadRpcIssuedRef.current = true;
      logMatchCallDiag('background_teardown_rpc', { call_id: callId, action });
      void (async () => {
        try {
          await transitionMatchCall(callId, action);
        } catch {
          // best-effort
        }
      })();
    });
    return () => sub.remove();
  }, [callPhaseRef, incomingCallRef, retryMatchCallMediaAfterSettingsReturn]);

  useEffect(() => {
    return () => {
      void cleanupLocalCall();
    };
  }, [cleanupLocalCall]);

  const contextValue = useMemo<MatchCallContextValue>(
    () => ({
      isRinging: callPhase === 'ringing',
      isInCall: callPhase === 'in_call',
      isReconnecting,
      callType,
      callDuration,
      incomingCall,
      isMuted,
      isVideoOff,
      lastOutcome,
      localParticipant,
      remoteParticipant,
      activeMatchId,
      canFlipCamera,
      isFlippingCamera,
      startCall,
      acceptCall,
      declineCall,
      markIncomingCallMissed,
      endCall,
      toggleMute,
      toggleVideo,
      flipCamera,
      getTrack,
    }),
    [
      acceptCall,
      activeMatchId,
      callDuration,
      callPhase,
      callType,
      canFlipCamera,
      declineCall,
      endCall,
      flipCamera,
      incomingCall,
      isFlippingCamera,
      isMuted,
      isReconnecting,
      isVideoOff,
      lastOutcome,
      localParticipant,
      markIncomingCallMissed,
      remoteParticipant,
      startCall,
      toggleMute,
      toggleVideo,
    ],
  );

  return (
    <MatchCallContext.Provider value={contextValue}>
      {children}

      {incomingCall ? (
        <IncomingCallOverlay
          incomingCall={incomingCall}
          callerAvatarUri={incomingCall.callerAvatarUri}
          onAnswer={() => {
            void acceptCall();
          }}
          onDecline={() => {
            void declineCall();
          }}
          onTimeout={markIncomingCallMissed}
        />
      ) : null}

      <ActiveCallOverlay
        visible={(callPhase === 'ringing' || callPhase === 'in_call') && !incomingCall}
        isRinging={callPhase === 'ringing'}
        isInCall={callPhase === 'in_call'}
        callType={callType}
        isMuted={isMuted}
        isVideoOff={isVideoOff}
        callDuration={callDuration}
        partnerName={activePartner.name}
        partnerAvatarUri={activePartner.avatarUrl}
        localParticipant={localParticipant}
        remoteParticipant={remoteParticipant}
        getTrack={getTrack}
        canFlipCamera={canFlipCamera}
        isFlippingCamera={isFlippingCamera}
        onToggleMute={toggleMute}
        onToggleVideo={toggleVideo}
        onFlipCamera={flipCamera}
        onEndCall={() => {
          void endCall();
        }}
      />
    </MatchCallContext.Provider>
  );
}

export function useMatchCall({
  matchId,
  partnerUserId,
  partnerName,
  partnerAvatarUri,
  onCallEnded,
}: UseMatchCallOptions) {
  const context = useContext(MatchCallContext);
  if (!context) {
    throw new Error('useMatchCall must be used within a MatchCallProvider');
  }

  const wasBoundToThreadRef = useRef(false);

  const boundToThisThread = Boolean(
    matchId
      && (context.activeMatchId === matchId || context.incomingCall?.matchId === matchId),
  );

  useEffect(() => {
    if (wasBoundToThreadRef.current && !boundToThisThread) {
      onCallEnded?.();
    }
    wasBoundToThreadRef.current = boundToThisThread;
  }, [boundToThisThread, onCallEnded]);

  const startCall = useCallback(
    async (type: MatchCallType) => {
      if (!matchId) return;
      await context.startCall({
        matchId,
        type,
        partnerUserId,
        partnerName,
        partnerAvatarUri,
      });
    },
    [context, matchId, partnerAvatarUri, partnerName, partnerUserId],
  );

  return {
    ...context,
    startCall,
  };
}
