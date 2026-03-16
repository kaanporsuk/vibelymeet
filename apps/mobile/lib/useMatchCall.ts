/**
 * Match call hook: 1:1 voice/video calls via Daily.co and match_calls table.
 * Mirrors web src/hooks/useMatchCall.ts; uses @daily-co/react-native-daily-js.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import Daily, { type DailyParticipant } from '@daily-co/react-native-daily-js';
import { supabase } from '@/lib/supabase';
import {
  createMatchCall,
  answerMatchCall,
  updateMatchCallStatus,
  deleteMatchCallRoom,
} from '@/lib/matchCallApi';

export type IncomingCallData = {
  callId: string;
  callerId: string;
  callerName: string;
  callType: 'voice' | 'video';
};

type CallState = 'idle' | 'ringing' | 'in_call';

type UseMatchCallOptions = {
  matchId: string | null;
  currentUserId: string | null | undefined;
  onCallEnded?: () => void;
};

function getTrack(
  participant: DailyParticipant | undefined,
  kind: 'video' | 'audio'
): import('@daily-co/react-native-webrtc').MediaStreamTrack | null {
  if (!participant) return null;
  const p = participant as unknown as {
    tracks?: { video?: { persistentTrack?: unknown }; audio?: { persistentTrack?: unknown } };
    videoTrack?: unknown;
    audioTrack?: unknown;
  };
  if (p.tracks) {
    const t = kind === 'video' ? p.tracks.video?.persistentTrack : p.tracks.audio?.persistentTrack;
    if (t) return t as import('@daily-co/react-native-webrtc').MediaStreamTrack;
  }
  const dep = kind === 'video' ? p.videoTrack : p.audioTrack;
  return dep === false || dep === undefined ? null : (dep as import('@daily-co/react-native-webrtc').MediaStreamTrack);
}

export function useMatchCall({ matchId, currentUserId, onCallEnded }: UseMatchCallOptions) {
  const [callState, setCallState] = useState<CallState>('idle');
  const [callType, setCallType] = useState<'voice' | 'video'>('video');
  const [callDuration, setCallDuration] = useState(0);
  const [incomingCall, setIncomingCall] = useState<IncomingCallData | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [localParticipant, setLocalParticipant] = useState<DailyParticipant | null>(null);
  const [remoteParticipant, setRemoteParticipant] = useState<DailyParticipant | null>(null);

  const callObjectRef = useRef<ReturnType<typeof Daily.createCallObject> | null>(null);
  const roomNameRef = useRef<string | null>(null);
  const activeCallIdRef = useRef<string | null>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isRingingRef = useRef(false);

  const isRinging = callState === 'ringing';
  const isInCall = callState === 'in_call';

  useEffect(() => {
    isRingingRef.current = isRinging;
  }, [isRinging]);

  const startDurationTimer = useCallback(() => {
    setCallDuration(0);
    durationIntervalRef.current = setInterval(() => setCallDuration((p) => p + 1), 1000);
  }, []);

  const stopDurationTimer = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
  }, []);

  const endCall = useCallback(async () => {
    stopDurationTimer();
    const co = callObjectRef.current;
    if (co) {
      try {
        await co.leave();
        co.destroy();
      } catch {
        // ignore
      }
      callObjectRef.current = null;
    }
    const callId = activeCallIdRef.current;
    const roomName = roomNameRef.current;
    if (callId) {
      await updateMatchCallStatus(callId, 'ended', {
        ended_at: new Date().toISOString(),
        duration_seconds: callDuration,
      });
      activeCallIdRef.current = null;
    }
    if (roomName) {
      await deleteMatchCallRoom(roomName);
      roomNameRef.current = null;
    }
    setCallState('idle');
    setLocalParticipant(null);
    setRemoteParticipant(null);
    setIncomingCall(null);
    onCallEnded?.();
  }, [stopDurationTimer, callDuration, onCallEnded]);

  const setupCallEvents = useCallback(
    (callObject: ReturnType<typeof Daily.createCallObject>, type: 'voice' | 'video') => {
      callObject.on('participant-joined', (event: { participant?: DailyParticipant }) => {
        if (event?.participant && !(event.participant as unknown as { local?: boolean }).local) {
          setCallState('in_call');
          setRemoteParticipant(event.participant);
          startDurationTimer();
        }
      });
      callObject.on('participant-updated', (event: { participant?: DailyParticipant }) => {
        if (!event?.participant) return;
        const p = event.participant;
        if ((p as unknown as { local?: boolean }).local) setLocalParticipant(p);
        else setRemoteParticipant(p);
      });
      callObject.on('participant-left', (event: { participant?: DailyParticipant }) => {
        if (event?.participant && !(event.participant as unknown as { local?: boolean }).local) {
          endCall();
        }
      });
      callObject.on('error', () => {
        endCall();
      });
      callObject.on('left-meeting', () => {
        setCallState('idle');
        stopDurationTimer();
      });
    },
    [startDurationTimer, stopDurationTimer, endCall]
  );

  const startCall = useCallback(
    async (type: 'voice' | 'video') => {
      if (!matchId || !currentUserId) return;
      setCallType(type);
      setCallState('ringing');

      try {
        const result = await createMatchCall(matchId, type);
        if (!result) {
          setCallState('idle');
          return;
        }
        activeCallIdRef.current = result.call_id;
        roomNameRef.current = result.room_name;

        const co = Daily.createCallObject({
          audioSource: true,
          videoSource: type === 'video',
        });
        callObjectRef.current = co;
        setupCallEvents(co, type);

        await co.join({ url: result.room_url, token: result.token });
        const participants = co.participants();
        const local = participants?.local;
        if (local) setLocalParticipant(local);

        // Auto-miss after 30s if no one joined
        setTimeout(() => {
          if (!callObjectRef.current) return;
          const participantsMap = callObjectRef.current.participants();
          const remotes = participantsMap
            ? Object.values(participantsMap).filter((p) => !(p as unknown as { local?: boolean }).local)
            : [];
          if (remotes.length === 0 && isRingingRef.current) {
            if (activeCallIdRef.current) {
              updateMatchCallStatus(activeCallIdRef.current, 'missed', {
                ended_at: new Date().toISOString(),
              });
            }
            endCall();
          }
        }, 30000);
      } catch {
        setCallState('idle');
      }
    },
    [matchId, currentUserId, setupCallEvents, endCall]
  );

  const acceptCall = useCallback(async () => {
    if (!incomingCall) return;
    try {
      const result = await answerMatchCall(incomingCall.callId);
      if (!result) {
        setIncomingCall(null);
        return;
      }
      setCallType(incomingCall.callType);
      activeCallIdRef.current = incomingCall.callId;
      roomNameRef.current = result.room_name;

      const co = Daily.createCallObject({
        audioSource: true,
        videoSource: incomingCall.callType === 'video',
      });
      callObjectRef.current = co;
      setupCallEvents(co, incomingCall.callType);

      await co.join({ url: result.room_url, token: result.token });
      const local = co.participants()?.local;
      if (local) setLocalParticipant(local);

      await updateMatchCallStatus(incomingCall.callId, 'active', {
        started_at: new Date().toISOString(),
      });
      setIncomingCall(null);
      setCallState('in_call');
      startDurationTimer();
    } catch {
      setIncomingCall(null);
    }
  }, [incomingCall, setupCallEvents, startDurationTimer]);

  const declineCall = useCallback(async () => {
    if (!incomingCall) return;
    await updateMatchCallStatus(incomingCall.callId, 'declined', {
      ended_at: new Date().toISOString(),
    });
    setIncomingCall(null);
  }, [incomingCall]);

  const toggleMute = useCallback(() => {
    const co = callObjectRef.current;
    if (co) {
      co.setLocalAudio(!isMuted); // false = muted
      setIsMuted(!isMuted);
    }
  }, [isMuted]);

  const toggleVideo = useCallback(() => {
    const co = callObjectRef.current;
    if (co) {
      co.setLocalVideo(!isVideoOff); // false = video off
      setIsVideoOff(!isVideoOff);
    }
  }, [isVideoOff]);

  // Incoming call detection: postgres_changes on match_calls where callee_id = currentUserId
  useEffect(() => {
    if (!currentUserId || !matchId) return;
    const channel = supabase
      .channel(`match-calls-${currentUserId}-${matchId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'match_calls',
          filter: `callee_id=eq.${currentUserId}`,
        },
        async (payload) => {
          const call = payload.new as { id: string; match_id: string; caller_id: string; status: string; call_type: string };
          if (call.status !== 'ringing' || call.match_id !== matchId) return;
          const { data: profile } = await supabase
            .from('profiles')
            .select('name')
            .eq('id', call.caller_id)
            .maybeSingle();
          setIncomingCall({
            callId: call.id,
            callerId: call.caller_id,
            callerName: (profile as { name?: string } | null)?.name ?? 'Your match',
            callType: call.call_type === 'voice' ? 'voice' : 'video',
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId, matchId]);

  useEffect(() => {
    return () => {
      stopDurationTimer();
      const co = callObjectRef.current;
      if (co) {
        try {
          co.leave();
          co.destroy();
        } catch {
          // ignore
        }
      }
    };
  }, [stopDurationTimer]);

  return {
    callState,
    isRinging,
    isInCall,
    callType,
    callDuration,
    incomingCall,
    isMuted,
    isVideoOff,
    localParticipant,
    remoteParticipant,
    getTrack,
    startCall,
    acceptCall,
    declineCall,
    endCall,
    toggleMute,
    toggleVideo,
  };
}
