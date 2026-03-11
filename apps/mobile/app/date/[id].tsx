/**
 * Video date screen: join Daily room with backend token, show local/remote video, end via backend-owned flow.
 * Same contracts as web: daily-room (create_date_room), video_date_transition (enter_handshake, end), delete_room.
 */

import 'react-native-get-random-values'; // Must be before Daily
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import Daily, { DailyMediaView } from '@daily-co/react-native-daily-js';
import type { DailyParticipant } from '@daily-co/react-native-daily-js';
import { useAuth } from '@/context/AuthContext';
import {
  useVideoDateSession,
  getDailyRoomToken,
  enterHandshake,
  endVideoDate,
  deleteDailyRoom,
  HANDSHAKE_SECONDS,
  DATE_SECONDS,
} from '@/lib/videoDateApi';
import { avatarUrl } from '@/lib/imageUrl';
import { supabase } from '@/lib/supabase';

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

export default function VideoDateScreen() {
  const { id: sessionId } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { session, partner, phase, timeLeft, loading: sessionLoading, error: sessionError } = useVideoDateSession(
    sessionId ?? null,
    user?.id ?? null
  );

  const callRef = useRef<ReturnType<typeof Daily.createCallObject> | null>(null);
  const roomNameRef = useRef<string | null>(null);
  const hasStartedJoinRef = useRef(false);

  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const [localParticipant, setLocalParticipant] = useState<DailyParticipant | null>(null);
  const [remoteParticipant, setRemoteParticipant] = useState<DailyParticipant | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [joining, setJoining] = useState(false);

  const requestPermissions = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.CAMERA,
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      ]);
      const ok =
        granted[PermissionsAndroid.PERMISSIONS.CAMERA] === PermissionsAndroid.RESULTS.GRANTED &&
        granted[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED;
      setHasPermission(ok);
      return ok;
    }
    setHasPermission(true);
    return true;
  }, []);

  const leaveAndCleanup = useCallback(async () => {
    const call = callRef.current;
    if (call) {
      try {
        await call.leave();
        call.destroy();
      } catch {}
      callRef.current = null;
    }
    const roomName = roomNameRef.current;
    if (roomName) {
      await deleteDailyRoom(roomName);
      roomNameRef.current = null;
    }
    if (sessionId) {
      await endVideoDate(sessionId);
    }
    if (session?.event_id && user?.id) {
      try {
        await supabase.rpc('leave_matching_queue', {
          p_event_id: session.event_id,
          p_user_id: user.id,
        });
      } catch {}
    }
    setLocalParticipant(null);
    setRemoteParticipant(null);
    setIsConnected(false);
    setIsConnecting(false);
  }, [sessionId, session?.event_id, user?.id]);

  const handleEndCall = useCallback(async () => {
    await leaveAndCleanup();
    if (session?.event_id) {
      router.replace(`/event/${session.event_id}/lobby`);
    } else {
      router.replace('/(tabs)/events');
    }
  }, [leaveAndCleanup, session?.event_id]);

  // Start call when session is ready and we haven't joined yet
  useEffect(() => {
    if (!sessionId || !user?.id || !session || session.ended_at || joining || callRef.current || hasStartedJoinRef.current) return;
    if (sessionError || phase === 'ended') return;

    hasStartedJoinRef.current = true;
    let cancelled = false;
    const run = async () => {
      setJoining(true);
      setCallError(null);
      const ok = await requestPermissions();
      if (!ok || cancelled) {
        setCallError('Camera and microphone access are required for video dates.');
        setJoining(false);
        return;
      }

      const tokenResult = await getDailyRoomToken(sessionId);
      if (!tokenResult || cancelled) {
        setCallError('Could not start video. Please try again.');
        setJoining(false);
        return;
      }

      if (!session.handshake_started_at) {
        await enterHandshake(sessionId);
        if (cancelled) return;
      }

      const call = Daily.createCallObject();
      callRef.current = call;
      roomNameRef.current = tokenResult.room_name;
      setIsConnecting(true);

      call.on('participant-joined', (event: { participant?: DailyParticipant }) => {
        if (event?.participant && !(event.participant as unknown as { local?: boolean }).local) {
          setIsConnected(true);
          setIsConnecting(false);
          setRemoteParticipant(event.participant);
        }
      });

      call.on('participant-updated', (event: { participant?: DailyParticipant }) => {
        if (!event?.participant) return;
        const p = event.participant;
        if ((p as unknown as { local?: boolean }).local) {
          setLocalParticipant(p);
        } else {
          setRemoteParticipant(p);
        }
      });

      call.on('participant-left', (event: { participant?: DailyParticipant }) => {
        if (event?.participant && !(event.participant as unknown as { local?: boolean }).local) {
          setIsConnected(false);
          setRemoteParticipant(null);
        }
      });

      call.on('left-meeting', () => {
        setIsConnected(false);
        setIsConnecting(false);
      });

      call.on('error', () => {
        setCallError('Connection error. Please try again.');
        setIsConnecting(false);
        setIsConnected(false);
      });

      try {
        await call.join({ url: tokenResult.room_url, token: tokenResult.token });
        if (cancelled) return;
        const participants = call.participants();
        const local = participants?.local;
        if (local) setLocalParticipant(local);
        const remotes = participants ? Object.values(participants).filter((p) => !(p as unknown as { local?: boolean }).local) : [];
        if (remotes.length > 0) {
          setIsConnected(true);
          setIsConnecting(false);
          setRemoteParticipant(remotes[0] as DailyParticipant);
        }
      } catch (err) {
        if (!cancelled) {
          setCallError('Failed to join. Please try again.');
          setIsConnecting(false);
          hasStartedJoinRef.current = false;
        }
      }
      setJoining(false);
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [sessionId, user?.id, session?.id, session?.ended_at, session?.handshake_started_at, sessionError, phase, requestPermissions, joining]);

  // Realtime: session ended from backend (e.g. partner left) — leave Daily and cleanup
  useEffect(() => {
    if (phase === 'ended' && sessionId) {
      leaveAndCleanup();
    }
  }, [phase, sessionId, leaveAndCleanup]);

  // Unmount: leave call
  useEffect(() => {
    return () => {
      const call = callRef.current;
      if (call) {
        call.leave().catch(() => {});
        call.destroy();
      }
      if (roomNameRef.current) {
        deleteDailyRoom(roomNameRef.current);
      }
    };
  }, []);

  if (sessionLoading || !sessionId) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text style={styles.message}>Loading...</Text>
      </View>
    );
  }

  if (sessionError) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{sessionError}</Text>
        <Pressable style={styles.button} onPress={() => router.back()}>
          <Text style={styles.buttonText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  if (phase === 'ended' && !isConnecting && !isConnected) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>Date ended</Text>
        <Pressable style={styles.button} onPress={() => (session?.event_id ? router.replace(`/event/${session.event_id}/lobby`) : router.replace('/(tabs)/events'))}>
          <Text style={styles.buttonText}>Continue</Text>
        </Pressable>
      </View>
    );
  }

  const displayTime = timeLeft ?? (phase === 'date' ? DATE_SECONDS : HANDSHAKE_SECONDS);

  return (
    <View style={styles.container}>
      {/* Remote video (full screen) */}
      <View style={styles.remoteContainer}>
        {remoteParticipant ? (
          <DailyMediaView
            videoTrack={getTrack(remoteParticipant, 'video')}
            audioTrack={getTrack(remoteParticipant, 'audio')}
            mirror={false}
            zOrder={0}
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.placeholderRemote]}>
            <Text style={styles.placeholderText}>
              {isConnecting ? 'Waiting for your date...' : partner ? `${partner.name} will appear here` : 'Connecting...'}
            </Text>
          </View>
        )}
      </View>

      {/* Local video (pip) */}
      <View style={styles.localContainer}>
        {localParticipant ? (
          <DailyMediaView
            videoTrack={getTrack(localParticipant, 'video')}
            audioTrack={null}
            mirror={true}
            zOrder={1}
            style={styles.localVideo}
          />
        ) : (
          <View style={[styles.localVideo, styles.placeholderLocal]}>
            <Text style={styles.placeholderTextSmall}>You</Text>
          </View>
        )}
      </View>

      {/* Top bar: partner name + timer */}
      <View style={styles.topBar}>
        <Text style={styles.partnerName}>{partner?.name ?? 'Your date'}</Text>
        <Text style={styles.timer}>
          {phase === 'handshake' ? 'Handshake' : 'Date'} — {Math.floor(displayTime / 60)}:{(displayTime % 60).toString().padStart(2, '0')}
        </Text>
      </View>

      {/* Error banner */}
      {callError ? (
        <View style={styles.errorBar}>
          <Text style={styles.errorText}>{callError}</Text>
        </View>
      ) : null}

      {/* End button */}
      <View style={styles.controls}>
        <Pressable
          style={({ pressed }) => [styles.endButton, pressed && styles.endButtonPressed]}
          onPress={handleEndCall}
        >
          <Text style={styles.endButtonText}>End date</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  message: { fontSize: 18, marginBottom: 16 },
  error: { fontSize: 16, color: '#c00', textAlign: 'center', marginBottom: 16 },
  errorBar: { position: 'absolute', top: 100, left: 16, right: 16, backgroundColor: 'rgba(200,0,0,0.9)', padding: 12, borderRadius: 8 },
  errorText: { color: '#fff', textAlign: 'center' },
  button: { backgroundColor: '#0a7ea4', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8 },
  buttonText: { color: '#fff', fontSize: 16 },
  remoteContainer: { ...StyleSheet.absoluteFillObject },
  placeholderRemote: { backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  placeholderText: { color: '#888', fontSize: 16 },
  placeholderTextSmall: { color: '#888', fontSize: 12 },
  localContainer: { position: 'absolute', top: 120, right: 16, width: 100, height: 140, borderRadius: 8, overflow: 'hidden' },
  localVideo: { width: '100%', height: '100%' },
  placeholderLocal: { backgroundColor: '#2a2a2a', justifyContent: 'center', alignItems: 'center' },
  topBar: { position: 'absolute', top: 48, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  partnerName: { color: '#fff', fontSize: 18, fontWeight: '600' },
  timer: { color: 'rgba(255,255,255,0.9)', fontSize: 14 },
  controls: { position: 'absolute', bottom: 48, left: 0, right: 0, alignItems: 'center' },
  endButton: { backgroundColor: '#c00', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 12 },
  endButtonPressed: { opacity: 0.8 },
  endButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
