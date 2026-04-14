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
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { IncomingCallOverlay } from '@/components/chat/IncomingCallOverlay';
import { ActiveCallOverlay } from '@/components/chat/ActiveCallOverlay';
import {
  createMatchCall,
  answerMatchCall,
  updateMatchCallStatus,
  deleteMatchCallRoom,
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
};

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
  callType: MatchCallType;
  callDuration: number;
  incomingCall: IncomingCallData | null;
  isMuted: boolean;
  isVideoOff: boolean;
  localParticipant: DailyParticipant | null;
  remoteParticipant: DailyParticipant | null;
  activeMatchId: string | null;
  startCall: (params: StartCallParams) => Promise<void>;
  acceptCall: () => Promise<void>;
  declineCall: () => Promise<void>;
  markIncomingCallMissed: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleMute: () => void;
  toggleVideo: () => void;
  getTrack: (
    participant: DailyParticipant | undefined,
    kind: 'video' | 'audio'
  ) => import('@daily-co/react-native-webrtc').MediaStreamTrack | null;
};

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
): import('@daily-co/react-native-webrtc').MediaStreamTrack | null {
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
    : (deprecatedTrack as import('@daily-co/react-native-webrtc').MediaStreamTrack);
}

function applyLocalMediaUiFromParticipant(
  participant: DailyParticipant,
  setIsVideoOff: (value: boolean) => void,
  setIsMuted: (value: boolean) => void
) {
  const videoState = participant.tracks?.video?.state;
  const audioState = participant.tracks?.audio?.state;
  if (videoState !== undefined) setIsVideoOff(videoState === 'off');
  if (audioState !== undefined) setIsMuted(audioState === 'off');
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
  const [activePartner, setActivePartner] = useState<PartnerSummary>(DEFAULT_PARTNER);
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [localParticipant, setLocalParticipant] = useState<DailyParticipant | null>(null);
  const [remoteParticipant, setRemoteParticipant] = useState<DailyParticipant | null>(null);

  const callObjectRef = useRef<ReturnType<typeof Daily.createCallObject> | null>(null);
  const trackedCallIdRef = useRef<string | null>(null);
  const roomNameRef = useRef<string | null>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const callPhaseRef = useLatestRef(callPhase);
  const incomingCallRef = useLatestRef(incomingCall);
  const activePartnerRef = useLatestRef(activePartner);

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

  const cleanupLocalCall = useCallback(
    async ({ deleteRoomName }: { deleteRoomName?: string | null } = {}) => {
      clearRingingTimeout();
      stopDurationTimer();

      const callObject = callObjectRef.current;
      if (callObject) {
        try {
          await callObject.leave();
        } catch {
          // ignore
        }
        try {
          callObject.destroy();
        } catch {
          // ignore
        }
        callObjectRef.current = null;
      }

      const roomName = deleteRoomName ?? roomNameRef.current;
      trackedCallIdRef.current = null;
      roomNameRef.current = null;
      setCallPhase('idle');
      setIncomingCall(null);
      setActiveMatchId(null);
      setActivePartner(DEFAULT_PARTNER);
      setCallDuration(0);
      setIsMuted(false);
      setIsVideoOff(false);
      setLocalParticipant(null);
      setRemoteParticipant(null);

      if (roomName) {
        await deleteMatchCallRoom(roomName);
      }
    },
    [clearRingingTimeout, stopDurationTimer],
  );

  const endCall = useCallback(async () => {
    const callId = trackedCallIdRef.current;
    const roomName = roomNameRef.current;

    if (callId) {
      try {
        await updateMatchCallStatus(callId, 'ended');
      } catch {
        // Realtime terminal update can still reconcile remote ownership.
      }
    }

    await cleanupLocalCall({ deleteRoomName: roomName });
  }, [cleanupLocalCall]);

  const setupCallEvents = useCallback(
    (callObject: ReturnType<typeof Daily.createCallObject>) => {
      callObject.on('participant-joined', (event: { participant?: DailyParticipant }) => {
        if (!event?.participant || (event.participant as unknown as { local?: boolean }).local) return;
        clearRingingTimeout();
        setCallPhase('in_call');
        setRemoteParticipant(event.participant);
        startDurationTimer();
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
        void endCall();
      });

      callObject.on('error', () => {
        void endCall();
      });

      callObject.on('left-meeting', () => {
        clearRingingTimeout();
        stopDurationTimer();
        setCallPhase('idle');
      });
    },
    [clearRingingTimeout, endCall, startDurationTimer, stopDurationTimer],
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

    await cleanupLocalCall({ deleteRoomName: roomName });
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

    await cleanupLocalCall({ deleteRoomName: roomName });
  }, [cleanupLocalCall, incomingCallRef]);

  const acceptCall = useCallback(async () => {
    const pendingIncoming = incomingCallRef.current;
    if (!pendingIncoming) return;

    let answeredRoomName: string | null = roomNameRef.current;
    try {
      const result = await answerMatchCall(pendingIncoming.callId);
      if (!result) return;

      answeredRoomName = result.room_name ?? roomNameRef.current;
      roomNameRef.current = answeredRoomName;
      trackedCallIdRef.current = pendingIncoming.callId;
      setCallType(pendingIncoming.callType);
      setCallPhase('in_call');
      setIncomingCall(null);
      startDurationTimer();

      const callObject = Daily.createCallObject({
        audioSource: true,
        videoSource: pendingIncoming.callType === 'video',
      });
      callObjectRef.current = callObject;
      setupCallEvents(callObject);

      await callObject.join({ url: result.room_url, token: result.token });
      const local = callObject.participants()?.local;
      if (local) {
        setLocalParticipant(local);
        applyLocalMediaUiFromParticipant(local, setIsVideoOff, setIsMuted);
      }
    } catch {
      try {
        await updateMatchCallStatus(pendingIncoming.callId, 'ended');
      } catch {
        // ignore
      }

      await cleanupLocalCall({ deleteRoomName: answeredRoomName });
    }
  }, [cleanupLocalCall, incomingCallRef, setupCallEvents, startDurationTimer]);

  const startCall = useCallback(
    async ({ matchId, type, partnerUserId, partnerName, partnerAvatarUri }: StartCallParams) => {
      if (!matchId) return;
      if (trackedCallIdRef.current || incomingCallRef.current || callPhaseRef.current !== 'idle') return;

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

      try {
        const result = await createMatchCall(matchId, type);
        if (!result) {
          await cleanupLocalCall();
          return;
        }

        createdCallId = result.call_id;
        createdRoomName = result.room_name;
        trackedCallIdRef.current = createdCallId;
        roomNameRef.current = createdRoomName;

        const callObject = Daily.createCallObject({
          audioSource: true,
          videoSource: type === 'video',
        });
        callObjectRef.current = callObject;
        setupCallEvents(callObject);

        await callObject.join({ url: result.room_url, token: result.token });
        const local = callObject.participants()?.local;
        if (local) {
          setLocalParticipant(local);
          applyLocalMediaUiFromParticipant(local, setIsVideoOff, setIsMuted);
        }

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
            await cleanupLocalCall({ deleteRoomName: roomNameRef.current });
          })();
        }, 30000);
      } catch {
        if (createdCallId) {
          try {
            await updateMatchCallStatus(createdCallId, 'ended');
          } catch {
            // ignore
          }
        }

        await cleanupLocalCall({ deleteRoomName: createdRoomName });
      }
    },
    [callPhaseRef, cleanupLocalCall, clearRingingTimeout, incomingCallRef, setupCallEvents],
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

  const reconcileCallRow = useCallback(
    async (row: MatchCallRow) => {
      if (!currentUserId) return;

      const trackedCallId = trackedCallIdRef.current;
      const isTrackedRow = trackedCallId === row.id || incomingCallRef.current?.callId === row.id;

      if (row.status === 'ringing' && row.callee_id === currentUserId) {
        await adoptIncomingCall(row);
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
          clearRingingTimeout();
          setIncomingCall(null);
          setActiveMatchId(row.match_id);
          setCallPhase('in_call');
          startDurationTimer(row.started_at);
          break;
        case 'declined':
        case 'missed':
        case 'ended':
          await cleanupLocalCall({ deleteRoomName: row.daily_room_name ?? roomNameRef.current });
          break;
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
      startDurationTimer,
    ],
  );

  useEffect(() => {
    if (!currentUserId) {
      void cleanupLocalCall();
      return;
    }

    let cancelled = false;

    const handlePayload = (payload: { new: MatchCallRow | null; old: MatchCallRow | null }) => {
      const row = payload.new ?? payload.old;
      if (!row || cancelled) return;
      void reconcileCallRow(row);
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
      const { data } = await supabase
        .from('match_calls')
        .select(
          'id, match_id, caller_id, callee_id, call_type, daily_room_name, daily_room_url, status, started_at, ended_at, duration_seconds, created_at',
        )
        .eq('callee_id', currentUserId)
        .eq('status', 'ringing')
        .order('created_at', { ascending: false })
        .limit(1);

      if (cancelled) return;
      const row = data?.[0] as MatchCallRow | undefined;
      if (row) {
        await reconcileCallRow(row);
      }
    })();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [cleanupLocalCall, currentUserId, reconcileCallRow]);

  useEffect(() => {
    return () => {
      void cleanupLocalCall();
    };
  }, [cleanupLocalCall]);

  const contextValue = useMemo<MatchCallContextValue>(
    () => ({
      isRinging: callPhase === 'ringing',
      isInCall: callPhase === 'in_call',
      callType,
      callDuration,
      incomingCall,
      isMuted,
      isVideoOff,
      localParticipant,
      remoteParticipant,
      activeMatchId,
      startCall,
      acceptCall,
      declineCall,
      markIncomingCallMissed,
      endCall,
      toggleMute,
      toggleVideo,
      getTrack,
    }),
    [
      acceptCall,
      activeMatchId,
      callDuration,
      callPhase,
      callType,
      declineCall,
      endCall,
      incomingCall,
      isMuted,
      isVideoOff,
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
          onTimeout={() => {
            void markIncomingCallMissed();
          }}
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
        onToggleMute={toggleMute}
        onToggleVideo={toggleVideo}
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
