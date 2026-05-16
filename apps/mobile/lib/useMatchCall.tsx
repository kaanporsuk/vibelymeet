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
import {
  MATCH_CALL_EDGE_CODES,
  messageForMatchCallEdgeCode,
} from '@clientShared/chat/matchCallEdgeCodes';
import { logMatchCallDiag } from '@clientShared/chat/matchCallDiag';
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
};

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
type NativeCameraSwitchCommit = NativeLocalCameraSnapshot & {
  method: NativeCameraSwitchCommitMethod;
  latencyMs: number;
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

function chooseNativeCameraDevice(
  devices: NativeDailyCameraDevice[],
  desiredFacing: NativeDailyCameraFacingMode | null,
  before: NativeLocalCameraSnapshot
): NativeDailyCameraDevice | null {
  const usable = nativeVideoCameraDevices(devices);
  if (usable.length === 0) return null;
  const currentDeviceKey = before.deviceId == null ? null : String(before.deviceId);
  const candidates = currentDeviceKey != null
    ? usable.filter((device) => nativeCameraDeviceKey(device) !== currentDeviceKey)
    : usable;
  if (currentDeviceKey != null && candidates.length === 0) return null;
  if (desiredFacing) {
    const facingMatch = candidates.find((device) => nativeCameraDeviceFacingMode(device) === desiredFacing);
    if (facingMatch) return facingMatch;
    if (currentDeviceKey == null) return null;
  }
  return currentDeviceKey != null ? candidates[0] ?? null : null;
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
  const [activePartner, setActivePartner] = useState<PartnerSummary>(DEFAULT_PARTNER);
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [localParticipant, setLocalParticipant] = useState<DailyParticipant | null>(null);
  const [remoteParticipant, setRemoteParticipant] = useState<DailyParticipant | null>(null);

  const callObjectRef = useRef<ReturnType<typeof Daily.createCallObject> | null>(null);
  const trackedCallIdRef = useRef<string | null>(null);
  const roomNameRef = useRef<string | null>(null);
  const outcomeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startCallAttemptRef = useRef(0);
  const startCallLockRef = useRef(false);
  const joiningCallIdRef = useRef<string | null>(null);
  const joinPromiseRef = useRef<Promise<void> | null>(null);
  const reconcileQueueRef = useRef(Promise.resolve());
  const reconcileSignatureByCallIdRef = useRef(new Map<string, string>());
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const remoteReconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** When true, a background/unload path already invoked `match_call_transition`; skip duplicate in `cleanupLocalCall`. */
  const documentUnloadRpcIssuedRef = useRef(false);

  const callPhaseRef = useLatestRef(callPhase);
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
    const { data } = await supabase
      .from('profiles')
      .select('name, avatar_url')
      .eq('id', profileId)
      .maybeSingle();

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
    async ({ deleteRoomName, skipRoomDelete = false, skipServerTransition = false }: MatchCallCleanupOptions = {}) => {
      const shouldAttemptAbnormalRpc =
        !skipServerTransition && !documentUnloadRpcIssuedRef.current && trackedCallIdRef.current;

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
      documentUnloadRpcIssuedRef.current = false;

      clearRingingTimeout();
      clearRemoteReconnectGrace();
      stopHeartbeat();
      stopDurationTimer();

      const callObject = callObjectRef.current;
      // Null the ref BEFORE awaiting leave/destroy so any re-entrant call sees a clean
      // slate and skips its own create. Without this, leave()/destroy() race a new
      // createCallObject and the SDK warns about multiple call instances.
      callObjectRef.current = null;
      if (callObject) {
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
      }

      const roomName = deleteRoomName ?? roomNameRef.current;
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
      setLocalParticipant(null);
      setRemoteParticipant(null);

      if (roomName && !skipRoomDelete) {
        await deleteMatchCallRoom(roomName);
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
    if (callObjectRef.current && trackedCallIdRef.current === callId) {
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

  const setupCallEvents = useCallback(
    (callObject: ReturnType<typeof Daily.createCallObject>) => {
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

      callObject.on('error', () => {
        void endCall('provider_error');
      });

      callObject.on('left-meeting', () => {
        clearRingingTimeout();
        stopDurationTimer();
        setCallPhase('idle');
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
        if (callObjectRef.current) {
          logMatchCallDiag('answer_call_skipped_duplicate_join', {
            call_id: pendingIncoming.callId,
          });
          return;
        }
        const callObject = Daily.createCallObject({
          audioSource: true,
          videoSource: pendingIncoming.callType === 'video',
        });
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
    incomingCallRef,
    runSingleJoinFlow,
    setupCallEvents,
    startDurationTimer,
    startHeartbeat,
  ]);

  const startCall = useCallback(
    async ({ matchId, type, partnerUserId, partnerName, partnerAvatarUri }: StartCallParams) => {
      if (!matchId) return;
      if (startCallLockRef.current) return;
      if (trackedCallIdRef.current || incomingCallRef.current || callPhaseRef.current !== 'idle') return;
      startCallLockRef.current = true;

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
          if (callObjectRef.current) {
            logMatchCallDiag('start_call_skipped_duplicate_join', {
              call_id: callId,
              match_id: matchId,
            });
            return;
          }
          const callObject = Daily.createCallObject({
            audioSource: true,
            videoSource: effectiveType === 'video',
          });
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
      incomingCallRef,
      runSingleJoinFlow,
      setupCallEvents,
      startHeartbeat,
      stopDurationTimer,
    ],
  );

  const toggleMute = useCallback(() => {
    const callObject = callObjectRef.current;
    if (!callObject) return;
    const nextMuted = !isMuted;
    callObject.setLocalAudio(!nextMuted);
    setIsMuted(nextMuted);
  }, [isMuted]);

  const toggleVideo = useCallback(() => {
    const callObject = callObjectRef.current;
    if (!callObject) return;
    const nextVideoOff = !isVideoOff;
    callObject.setLocalVideo(!nextVideoOff);
    setIsVideoOff(nextVideoOff);
  }, [isVideoOff]);

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

  const waitForNativeCameraSwitchCommit = useCallback(
    async (
      controls: NativeDailyCameraControls,
      callObject: ReturnType<typeof Daily.createCallObject>,
      before: NativeLocalCameraSnapshot,
      method: NativeCameraSwitchCommitMethod,
      expectedFacing: NativeDailyCameraFacingMode | null
    ): Promise<NativeCameraSwitchCommit | null> => {
      const startedAtMs = Date.now();
      while (Date.now() - startedAtMs <= NATIVE_MATCH_CALL_CAMERA_SWITCH_COMMIT_TIMEOUT_MS) {
        let controlsFacing: NativeDailyCameraFacingMode | null = null;
        try {
          controlsFacing =
            typeof controls.getCameraFacingMode === 'function'
              ? normalizeNativeCameraFacingMode(await controls.getCameraFacingMode())
              : null;
        } catch {
          controlsFacing = null;
        }

        const snapshot = readNativeLocalCameraSnapshot(callObject);
        const committedFacing = controlsFacing ?? snapshot.facingMode;
        const trackChanged = Boolean(before.trackId && snapshot.trackId && snapshot.trackId !== before.trackId);
        const deviceChanged = Boolean(before.deviceId && snapshot.deviceId && snapshot.deviceId !== before.deviceId);
        const facingChanged = Boolean(before.facingMode && committedFacing && committedFacing !== before.facingMode);
        const expectedFacingMatched = Boolean(
          expectedFacing &&
            expectedFacing !== before.facingMode &&
            committedFacing === expectedFacing
        );
        const live = snapshot.readyState === 'live' && snapshot.enabled !== false;

        if (live && (trackChanged || deviceChanged || facingChanged || expectedFacingMatched)) {
          return {
            ...snapshot,
            facingMode: committedFacing,
            method,
            latencyMs: Date.now() - startedAtMs,
          };
        }

        await sleepNativeMatchCallCameraSwitch(NATIVE_MATCH_CALL_CAMERA_SWITCH_COMMIT_POLL_MS);
      }
      return null;
    },
    [readNativeLocalCameraSnapshot],
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
        if (!cancelled) setCanFlipCamera(false);
        return;
      }

      if (typeof controls.enumerateDevices === 'function') {
        try {
          const devices = nativeVideoCameraDevices(nativeCameraDevicesFromResult(await controls.enumerateDevices()));
          const deterministicTarget =
            typeof controls.setCamera === 'function'
              ? chooseNativeCameraDevice(
                  devices,
                  oppositeNativeCameraFacingMode(localCamera.facingMode),
                  localCamera,
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
  }, [callPhase, callType, isVideoOff, localParticipant, readNativeLocalCameraSnapshot]);

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

      let currentFacing = before.facingMode;
      if (typeof controls.getCameraFacingMode === 'function') {
        try {
          currentFacing = normalizeNativeCameraFacingMode(await controls.getCameraFacingMode()) ?? currentFacing;
        } catch {
          currentFacing = before.facingMode;
        }
      }
      const desiredFacing = oppositeNativeCameraFacingMode(currentFacing);
      let commit: NativeCameraSwitchCommit | null = null;
      let availableVideoDeviceCount: number | null = null;

      if (typeof controls.enumerateDevices === 'function' && typeof controls.setCamera === 'function') {
        try {
          const devices = nativeVideoCameraDevices(nativeCameraDevicesFromResult(await controls.enumerateDevices()));
          availableVideoDeviceCount = devices.length;
          const targetDevice = chooseNativeCameraDevice(devices, desiredFacing, before);
          const targetDeviceId = nativeCameraDeviceId(targetDevice);
          if (targetDeviceId != null) {
            const result = await controls.setCamera(targetDeviceId);
            const resultDevice = nativeCameraSwitchResultDevice(result);
            const expectedFacing =
              desiredFacing ??
              nativeCameraDeviceFacingMode(targetDevice) ??
              nativeCameraDeviceFacingMode(resultDevice);
            commit = await waitForNativeCameraSwitchCommit(
              controls,
              callObject,
              before,
              'set_camera',
              expectedFacing,
            );
          } else {
            logMatchCallDiag('flip_camera_set_camera_no_target', {
              platform: 'native',
              desired_facing_mode: desiredFacing,
              video_input_count: devices.length,
              before_device_id: before.deviceId,
              before_facing_mode: before.facingMode,
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
          commit = await waitForNativeCameraSwitchCommit(
            controls,
            callObject,
            before,
            'cycle_camera',
            nativeCameraDeviceFacingMode(resultDevice) ?? desiredFacing,
          );
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
          desired_facing_mode: desiredFacing,
          video_input_count: availableVideoDeviceCount,
          before,
          after,
        });
        Alert.alert("Couldn't switch camera", 'No additional camera was available.');
        return;
      }

      setCanFlipCamera(true);
      logMatchCallDiag('flip_camera_committed', {
        platform: 'native',
        method: commit.method,
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
    readNativeLocalCameraSnapshot,
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
          if (callObjectRef.current) {
            logMatchCallDiag('rejoin_skipped_duplicate_join', {
              call_id: row.id,
            });
            return;
          }
          const callObject = Daily.createCallObject({
            audioSource: true,
            videoSource: nextCallType === 'video',
          });
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
      currentUserId,
      fetchPartnerSummary,
      runSingleJoinFlow,
      setupCallEvents,
      startDurationTimer,
      startHeartbeat,
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
  }, [callPhaseRef, incomingCallRef]);

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
