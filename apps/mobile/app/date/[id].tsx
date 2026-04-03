/**
 * Video date screen: full Vibely experience — handshake (60s) with blur, vibe check,
 * mutual vibe → date (300s), controls, partner sheet, keep-the-vibe, reconnection, post-date survey.
 */

import 'react-native-get-random-values';
import * as Sentry from '@sentry/react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  Animated,
  Dimensions,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import { Camera } from 'expo-camera';
import Daily, { DailyMediaView } from '@daily-co/react-native-daily-js';
import type { DailyParticipant } from '@daily-co/react-native-daily-js';
import { useAuth } from '@/context/AuthContext';
import {
  useVideoDateSession,
  getDailyRoomToken,
  enterHandshake,
  type RoomTokenFailureCode,
  endVideoDate,
  deleteDailyRoom,
  recordVibe,
  completeHandshake,
  syncVideoDateReconnect,
  markReconnectPartnerAway,
  markReconnectReturn,
  updateParticipantStatus,
  fetchPartnerProfile,
  getOrSeedVibeQuestions,
  submitVerdictAndCheckMutual,
  fetchUserCredits,
  deductCredit,
  HANDSHAKE_SECONDS,
  DATE_SECONDS,
  type PartnerProfileData,
} from '@/lib/videoDateApi';
import { getImageUrl } from '@/lib/imageUrl';
import { HandshakeTimer } from '@/components/video-date/HandshakeTimer';
import { VibeCheckButton } from '@/components/video-date/VibeCheckButton';
import { IceBreakerCard } from '@/components/video-date/IceBreakerCard';
import { ConnectionOverlay } from '@/components/video-date/ConnectionOverlay';
import { VideoDateControls } from '@/components/video-date/VideoDateControls';
import { PartnerProfileSheet } from '@/components/video-date/PartnerProfileSheet';
import { KeepTheVibe } from '@/components/video-date/KeepTheVibe';
import { ReconnectionOverlay } from '@/components/video-date/ReconnectionOverlay';
import { MutualVibeToast } from '@/components/video-date/MutualVibeToast';
import { PostDateSurvey } from '@/components/video-date/PostDateSurvey';
import { supabase } from '@/lib/supabase';
import { spacing } from '@/constants/theme';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { trackEvent } from '@/lib/analytics';
import { LiveSurfaceOfflineStrip } from '@/components/connectivity/LiveSurfaceOfflineStrip';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

function userMessageForTokenFailure(code: RoomTokenFailureCode): string {
  switch (code) {
    case 'auth':
      return 'Please sign in again, then try once more.';
    case 'ready_gate_required':
      return 'Almost there — finish the Ready Gate with your match first.';
    case 'session_ended':
      return 'This date has already ended.';
    case 'not_found':
      return "We couldn't open this date. Go back and try again.";
    case 'forbidden':
      return "You don't have access to this date.";
    case 'network':
    case 'daily_provider':
    default:
      return 'Could not start video. Please try again.';
  }
}

function userMessageForHandshakeFailure(code?: string): string {
  if (code === 'READY_GATE_NOT_READY') {
    return 'Almost there — finish the Ready Gate with your match first.';
  }
  if (code === 'SESSION_ENDED') {
    return 'This date has already ended.';
  }
  return 'Could not start video. Please try again.';
}

function getTrack(
  participant: DailyParticipant | undefined,
  kind: 'video' | 'audio'
): import('@daily-co/react-native-webrtc').MediaStreamTrack | null {
  if (!participant) return null;
  const trackInfo = participant.tracks?.[kind];
  // Do not feed DailyMediaView a "video off" track — persistentTrack can still show a stale last frame.
  if (
    trackInfo &&
    (trackInfo.state === 'off' || trackInfo.state === 'blocked')
  ) {
    return null;
  }
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

/** Sync UI toggles from Daily participant track state (source of truth after join / reconnect). */
function applyLocalMediaUiFromParticipant(p: DailyParticipant, setters: {
  setIsVideoOff: (v: boolean) => void;
  setIsMuted: (v: boolean) => void;
}) {
  const vState = p.tracks?.video?.state;
  const aState = p.tracks?.audio?.state;
  if (vState !== undefined) setters.setIsVideoOff(vState === 'off');
  if (aState !== undefined) setters.setIsMuted(aState === 'off');
}

function resolveAvatar(path: string | null): string {
  return getImageUrl(path) || '';
}

export default function VideoDateScreen() {
  const { id: sessionId } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];

  const { session, partner: basicPartner, phase, timeLeft: serverTimeLeft, loading: sessionLoading, error: sessionError } = useVideoDateSession(
    sessionId ?? null,
    user?.id ?? null
  );

  const [localTimeLeft, setLocalTimeLeft] = useState<number | null>(null);
  const [fullPartner, setFullPartner] = useState<PartnerProfileData | null>(null);
  const [partnerId, setPartnerId] = useState<string>('');
  const [eventId, setEventId] = useState<string>('');
  const [isParticipant1, setIsParticipant1] = useState(false);
  const [vibeQuestions, setVibeQuestions] = useState<string[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [showIceBreaker, setShowIceBreaker] = useState(true);
  const [showProfileSheet, setShowProfileSheet] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showMutualToast, setShowMutualToast] = useState(false);
  const [blurIntensity, setBlurIntensity] = useState(80);
  const [credits, setCredits] = useState({ extraTime: 0, extendedVibe: 0 });
  const [isExtending, setIsExtending] = useState(false);
  const [reconnectionGrace, setReconnectionGrace] = useState(0);
  const [isPartnerDisconnected, setIsPartnerDisconnected] = useState(false);
  const [isTimerPaused, setIsTimerPaused] = useState(false);

  const callRef = useRef<ReturnType<typeof Daily.createCallObject> | null>(null);
  const roomNameRef = useRef<string | null>(null);
  const hasStartedJoinRef = useRef(false);
  const phaseRef = useRef(phase);
  const hadConnectedOnceRef = useRef(false);
  const prevIsConnectedRef = useRef(false);
  const graceExpiredFiredRef = useRef(false);
  const handleCallEndRef = useRef<(() => Promise<void>) | null>(null);
  const handshakeAnalyticsRef = useRef(false);
  const videoDateEndedRef = useRef(false);

  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const [localParticipant, setLocalParticipant] = useState<DailyParticipant | null>(null);
  const [remoteParticipant, setRemoteParticipant] = useState<DailyParticipant | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [joining, setJoining] = useState(false);

  phaseRef.current = phase;

  useEffect(() => {
    setLocalTimeLeft(serverTimeLeft);
  }, [serverTimeLeft]);

  useEffect(() => {
    if (!sessionId || !user?.id) return;
    fetchPartnerProfile(sessionId, user.id, resolveAvatar).then((data) => {
      if (data) {
        setFullPartner(data.partner);
        setPartnerId(data.partnerId);
        setEventId(data.eventId);
        setIsParticipant1(data.isParticipant1);
      }
    });
  }, [sessionId, user?.id]);

  useEffect(() => {
    if (!sessionId) return;
    getOrSeedVibeQuestions(sessionId).then(setVibeQuestions);
  }, [sessionId]);

  useEffect(() => {
    if (!vibeQuestions.length) return;
    const interval = setInterval(() => {
      setCurrentQuestionIndex((prev) => (prev + 1) % vibeQuestions.length);
    }, 30000);
    return () => clearInterval(interval);
  }, [vibeQuestions.length]);

  useEffect(() => {
    if (!isConnected) return;
    const t = setTimeout(() => setShowIceBreaker(false), 30000);
    return () => clearTimeout(t);
  }, [isConnected]);

  useEffect(() => {
    if (!isConnected || phase !== 'handshake') return;
    const start = 80;
    const duration = 10000;
    const startTime = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startTime;
      if (elapsed >= duration) {
        setBlurIntensity(0);
        return;
      }
      setBlurIntensity(start - (start * elapsed) / duration);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [isConnected, phase]);

  const refreshCredits = useCallback(() => {
    if (!user?.id) return;
    void fetchUserCredits(user.id).then(setCredits);
  }, [user?.id]);

  useEffect(() => {
    refreshCredits();
  }, [refreshCredits]);

  useFocusEffect(
    useCallback(() => {
      refreshCredits();
    }, [refreshCredits])
  );

  /** After background/foreground or navigation, re-read Daily participant state so toggles match the call. */
  useFocusEffect(
    useCallback(() => {
      const call = callRef.current;
      if (!call || !isConnected) return;
      const participants = call.participants();
      const local = participants?.local;
      if (local) {
        setLocalParticipant(local);
        applyLocalMediaUiFromParticipant(local, { setIsVideoOff, setIsMuted });
      }
      const remotes = participants ? Object.values(participants).filter((p) => !(p as unknown as { local?: boolean }).local) : [];
      if (remotes[0]) setRemoteParticipant(remotes[0] as DailyParticipant);
    }, [isConnected])
  );

  useEffect(() => {
    if (!sessionId || !isConnected || phase !== 'handshake') return;
    if (handshakeAnalyticsRef.current) return;
    handshakeAnalyticsRef.current = true;
    trackEvent('video_date_started', { session_id: sessionId, phase: 'handshake' });
  }, [sessionId, isConnected, phase]);

  const onPartnerLeftReconnect = useCallback(() => {
    if (!hadConnectedOnceRef.current || !sessionId || phase === 'ended') return;
    setIsPartnerDisconnected(true);
    void markReconnectPartnerAway(sessionId);
  }, [sessionId, phase]);

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
    if (sessionId) await endVideoDate(sessionId);
    setLocalParticipant(null);
    setRemoteParticipant(null);
    setIsConnected(false);
    setIsConnecting(false);
    setIsMuted(false);
    setIsVideoOff(false);
  }, [sessionId, eventId, user?.id]);

  const handleCallEnd = useCallback(async () => {
    if (sessionId && !videoDateEndedRef.current) {
      videoDateEndedRef.current = true;
      trackEvent('video_date_ended', { session_id: sessionId });
    }
    Sentry.addBreadcrumb({ category: 'video-date', message: 'Call ended (user)', level: 'info', data: { sessionId } });
    setShowFeedback(true);
    await leaveAndCleanup();
  }, [leaveAndCleanup, eventId, user?.id, sessionId]);

  useEffect(() => {
    handleCallEndRef.current = handleCallEnd;
  }, [handleCallEnd]);

  useEffect(() => {
    if (!sessionId || phase === 'ended') return;
    let cancelled = false;
    const tick = async () => {
      const r = await syncVideoDateReconnect(sessionId);
      if (cancelled || !r) return;
      if (r.ended) {
        if (r.ended_reason === 'reconnect_grace_expired' && !graceExpiredFiredRef.current) {
          graceExpiredFiredRef.current = true;
          void handleCallEndRef.current?.();
        }
        setIsPartnerDisconnected(false);
        setIsTimerPaused(false);
        setReconnectionGrace(0);
        return;
      }
      graceExpiredFiredRef.current = false;
      const hasGrace = !!r.reconnect_grace_ends_at;
      const show = hasGrace && r.partner_marked_away;
      setIsPartnerDisconnected(show);
      setIsTimerPaused(show);
      if (hasGrace && r.reconnect_grace_ends_at) {
        setReconnectionGrace(
          Math.max(0, Math.ceil((new Date(r.reconnect_grace_ends_at).getTime() - Date.now()) / 1000)),
        );
      } else {
        setReconnectionGrace(0);
      }
    };
    void tick();
    const iv = setInterval(() => void tick(), 1000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [sessionId, phase]);

  useEffect(() => {
    const prev = prevIsConnectedRef.current;
    prevIsConnectedRef.current = isConnected;
    if (!isConnected) return;
    if (!hadConnectedOnceRef.current) {
      hadConnectedOnceRef.current = true;
      return;
    }
    if (!prev && sessionId && phase !== 'ended') {
      void markReconnectReturn(sessionId);
    }
  }, [isConnected, sessionId, phase]);

  const handleLeave = useCallback(async () => {
    await leaveAndCleanup();
    handleCallEnd();
    if (eventId) router.replace(`/event/${eventId}/lobby`);
    else router.replace('/(tabs)/events');
  }, [leaveAndCleanup, handleCallEnd, eventId]);

  const handleUserVibe = useCallback(async () => {
    if (!sessionId) return;
    await recordVibe(sessionId);
  }, [sessionId]);

  const handleMutualToastComplete = useCallback(() => {
    setShowMutualToast(false);
    setLocalTimeLeft(DATE_SECONDS);
  }, []);

  const handleExtend = useCallback(
    async (minutes: number, type: 'extra_time' | 'extended_vibe'): Promise<boolean> => {
      if (!user?.id) return false;
      setIsExtending(true);
      const ok = await deductCredit(user.id, type);
      if (ok) {
        if (sessionId) {
          trackEvent('video_date_extended', { session_id: sessionId });
          trackEvent('credit_used', { type, minutes });
        }
        setLocalTimeLeft((prev) => (prev ?? 0) + minutes * 60);
        setCredits((c) =>
          type === 'extra_time' ? { ...c, extraTime: Math.max(0, c.extraTime - 1) } : { ...c, extendedVibe: Math.max(0, c.extendedVibe - 1) }
        );
      }
      setIsExtending(false);
      return ok;
    },
    [user?.id, sessionId]
  );

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
    const cam = await Camera.requestCameraPermissionsAsync();
    const mic = await Camera.requestMicrophonePermissionsAsync();
    const ok = cam.status === 'granted' && mic.status === 'granted';
    setHasPermission(ok);
    return ok;
  }, []);

  useEffect(() => {
    if (
      !sessionId ||
      !user?.id ||
      !session ||
      session.ended_at ||
      joining ||
      callRef.current ||
      hasStartedJoinRef.current
    )
      return;
    if (sessionError || phase === 'ended') return;

    hasStartedJoinRef.current = true;
    let cancelled = false;
    const run = async () => {
      setJoining(true);
      setCallError(null);
      const ok = await requestPermissions();
      if (!ok || cancelled) {
        if (!ok && !cancelled) {
          setCallError('Camera and microphone access are required for video dates.');
        }
        hasStartedJoinRef.current = false;
        setJoining(false);
        return;
      }
      const tokenRes = await getDailyRoomToken(sessionId);
      if (cancelled) {
        hasStartedJoinRef.current = false;
        setJoining(false);
        return;
      }
      if (!tokenRes.ok) {
        Sentry.addBreadcrumb({
          category: 'video-date',
          message: 'create_date_room failed',
          level: 'error',
          data: {
            sessionId,
            code: tokenRes.code,
            httpStatus: tokenRes.httpStatus,
            serverCode: tokenRes.serverCode,
          },
        });
        Sentry.captureMessage('video_date_token_failed', {
          level: 'warning',
          extra: {
            sessionId,
            code: tokenRes.code,
            httpStatus: tokenRes.httpStatus,
            serverCode: tokenRes.serverCode,
          },
        });
        setCallError(userMessageForTokenFailure(tokenRes.code));
        hasStartedJoinRef.current = false;
        setJoining(false);
        return;
      }
      const tokenResult = tokenRes.data;
      if (!session.handshake_started_at) {
        const hs = await enterHandshake(sessionId);
        if (cancelled) {
          hasStartedJoinRef.current = false;
          setJoining(false);
          return;
        }
        if (!hs.ok) {
          Sentry.addBreadcrumb({
            category: 'video-date',
            message: 'enter_handshake failed',
            level: 'error',
            data: { sessionId, code: hs.code, message: hs.message },
          });
          Sentry.captureMessage('video_date_enter_handshake_failed', {
            level: 'warning',
            extra: { sessionId, code: hs.code, message: hs.message },
          });
          setCallError(userMessageForHandshakeFailure(hs.code));
          hasStartedJoinRef.current = false;
          setJoining(false);
          return;
        }
      }
      const call = Daily.createCallObject();
      callRef.current = call;
      roomNameRef.current = tokenResult.room_name;
      setIsConnecting(true);

      call.on('participant-joined', (event: { participant?: DailyParticipant }) => {
        if (event?.participant && !(event.participant as unknown as { local?: boolean }).local) {
          Sentry.addBreadcrumb({ category: 'video-date', message: 'Partner joined', level: 'info' });
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
          applyLocalMediaUiFromParticipant(p, { setIsVideoOff, setIsMuted });
        } else {
          setRemoteParticipant(p);
        }
      });
      call.on('participant-left', (event: { participant?: DailyParticipant }) => {
        if (event?.participant && !(event.participant as unknown as { local?: boolean }).local) {
          Sentry.addBreadcrumb({ category: 'video-date', message: 'Partner left', level: 'info' });
          setIsConnected(false);
          setRemoteParticipant(null);
          onPartnerLeftReconnect();
        }
      });
      call.on('left-meeting', () => {
        Sentry.addBreadcrumb({ category: 'video-date', message: 'Call ended (left-meeting)', level: 'info' });
        setIsConnected(false);
        setIsConnecting(false);
      });
      call.on('error', (event: unknown) => {
        const msg =
          event && typeof event === 'object' && 'errorMsg' in event
            ? String((event as { errorMsg?: unknown }).errorMsg)
            : undefined;
        Sentry.addBreadcrumb({
          category: 'video-date',
          message: 'Daily call error',
          level: 'error',
          data: { sessionId, errorMsg: msg },
        });
        setCallError('Connection error. Please try again.');
        setIsConnecting(false);
        setIsConnected(false);
      });

      try {
        Sentry.addBreadcrumb({ category: 'video-date', message: 'Joining call', level: 'info', data: { sessionId } });
        await call.join({ url: tokenResult.room_url, token: tokenResult.token });
        if (cancelled) return;
        const participants = call.participants();
        const local = participants?.local;
        if (local) {
          setLocalParticipant(local);
          applyLocalMediaUiFromParticipant(local, { setIsVideoOff, setIsMuted });
        }
        const remotes = participants ? Object.values(participants).filter((p) => !(p as unknown as { local?: boolean }).local) : [];
        if (remotes.length > 0) {
          setIsConnected(true);
          setIsConnecting(false);
          setRemoteParticipant(remotes[0] as DailyParticipant);
        }
      } catch (err) {
        if (!cancelled) {
          Sentry.captureException(err, { extra: { sessionId } });
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
      if (!callRef.current) {
        hasStartedJoinRef.current = false;
      }
    };
  }, [
    sessionId,
    user?.id,
    eventId,
    session?.id,
    session?.ended_at,
    session?.handshake_started_at,
    sessionError,
    phase,
    requestPermissions,
    onPartnerLeftReconnect,
  ]);

  useEffect(() => {
    if (phase === 'ended' && sessionId) leaveAndCleanup();
  }, [phase, sessionId, leaveAndCleanup]);

  useEffect(() => {
    if (
      localTimeLeft === null ||
      showFeedback ||
      !isConnected ||
      phase === 'ended' ||
      isTimerPaused
    )
      return;
    const interval = setInterval(() => {
      setLocalTimeLeft((prev) => {
        if (prev === null || prev <= 1) {
          if (phaseRef.current === 'handshake') {
            completeHandshake(sessionId!).then((result) => {
              if (result?.state === 'date') {
                setShowMutualToast(true);
              } else {
                leaveAndCleanup().then(handleCallEnd);
              }
            });
          } else {
            handleCallEnd();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [localTimeLeft !== null, showFeedback, isConnected, phase, isTimerPaused, sessionId, eventId, leaveAndCleanup, handleCallEnd]);

  const toggleMute = useCallback(() => {
    const call = callRef.current;
    if (!call) return;
    const nextMuted = !isMuted;
    // Daily: setLocalAudio(true) = mic on, false = mic off (same semantics as web useVideoCall / useMatchCall).
    call.setLocalAudio(!nextMuted);
    setIsMuted(nextMuted);
  }, [isMuted]);

  const toggleVideo = useCallback(() => {
    const call = callRef.current;
    if (!call) return;
    const nextVideoOff = !isVideoOff;
    call.setLocalVideo(!nextVideoOff);
    setIsVideoOff(nextVideoOff);
  }, [isVideoOff]);

  const totalTime = phase === 'handshake' ? HANDSHAKE_SECONDS : DATE_SECONDS;
  const displayTimeLeft = localTimeLeft ?? totalTime;
  const currentQuestion = vibeQuestions[currentQuestionIndex] ?? vibeQuestions[0] ?? '';

  const handleSurveySubmit = useCallback(
    (liked: boolean) =>
      submitVerdictAndCheckMutual(sessionId!, user!.id, partnerId, liked),
    [sessionId, user?.id, partnerId]
  );

  const handleSurveyMutualMatch = useCallback(() => {
    if (eventId) router.replace(`/event/${eventId}/lobby`);
    else router.replace('/(tabs)/matches');
  }, [eventId]);

  const handleSurveyDone = useCallback(() => {
    if (eventId && user?.id) updateParticipantStatus(eventId, 'browsing');
    if (eventId) router.replace(`/event/${eventId}/lobby`);
    else router.replace('/(tabs)/events');
  }, [eventId, user?.id]);

  if (sessionLoading || !sessionId) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.tint} />
        <Text style={[styles.message, { color: theme.text }]}>Loading...</Text>
      </View>
    );
  }

  if (sessionError) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <Text style={[styles.error, { color: theme.danger }]}>{sessionError}</Text>
        <Pressable style={[styles.button, { backgroundColor: theme.tint }]} onPress={() => router.back()}>
          <Text style={styles.buttonText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  if (phase === 'ended' && showFeedback) {
    return (
      <PostDateSurvey
        sessionId={sessionId}
        userId={user!.id}
        partnerId={partnerId}
        partnerName={fullPartner?.name ?? basicPartner?.name ?? 'Your date'}
        partnerImage={fullPartner?.avatarUrl ?? fullPartner?.photos?.[0] ?? null}
        eventId={eventId || undefined}
        onSubmitVerdict={handleSurveySubmit}
        onMutualMatch={handleSurveyMutualMatch}
        onDone={handleSurveyDone}
      />
    );
  }

  if (phase === 'ended' && !isConnecting && !isConnected) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <Text style={[styles.message, { color: theme.text }]}>Date ended</Text>
        <Pressable
          style={[styles.button, { backgroundColor: theme.tint }]}
          onPress={() => (eventId ? router.replace(`/event/${eventId}/lobby`) : router.replace('/(tabs)/events'))}
        >
          <Text style={styles.buttonText}>Continue</Text>
        </Pressable>
      </View>
    );
  }

  const partnerName = fullPartner?.name ?? basicPartner?.name ?? 'Your date';

  const remoteVideoTrack = remoteParticipant ? getTrack(remoteParticipant, 'video') : null;
  const remoteAudioTrack = remoteParticipant ? getTrack(remoteParticipant, 'audio') : null;
  const localVideoTrack = localParticipant ? getTrack(localParticipant, 'video') : null;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <LiveSurfaceOfflineStrip />
      <View style={styles.remoteContainer}>
        {remoteParticipant ? (
          <>
            <DailyMediaView
              videoTrack={remoteVideoTrack}
              audioTrack={remoteAudioTrack}
              mirror={false}
              zOrder={0}
              style={StyleSheet.absoluteFill}
            />
            {!remoteVideoTrack && (
              <View style={[StyleSheet.absoluteFill, styles.placeholderRemote, { backgroundColor: theme.muted }]}>
                <Text style={[styles.placeholderText, { color: theme.mutedForeground }]}>
                  {partnerName} — camera off
                </Text>
              </View>
            )}
            {phase === 'handshake' && blurIntensity > 0 && (
              <BlurView intensity={blurIntensity} style={StyleSheet.absoluteFill} tint="dark" />
            )}
          </>
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.placeholderRemote, { backgroundColor: theme.muted }]}>
            <Text style={[styles.placeholderText, { color: theme.mutedForeground }]}>
              {isConnecting ? 'Waiting for your date...' : `${partnerName} will appear here`}
            </Text>
          </View>
        )}
      </View>

      <View style={[styles.localPip, { borderColor: theme.tint }]}>
        {localParticipant && localVideoTrack ? (
          <DailyMediaView
            videoTrack={localVideoTrack}
            audioTrack={null}
            mirror={true}
            zOrder={1}
            style={styles.localVideo}
          />
        ) : (
          <View style={[styles.localVideo, styles.placeholderLocal, { backgroundColor: theme.surface }]}>
            <Text style={[styles.placeholderTextSmall, { color: theme.mutedForeground }]}>
              {localParticipant ? 'Camera off' : 'You'}
            </Text>
          </View>
        )}
        {isMuted && (
          <View style={[styles.muteBadge, { backgroundColor: theme.danger }]}>
            <Text style={styles.muteBadgeText}>🔇</Text>
          </View>
        )}
      </View>

      {isConnecting && <ConnectionOverlay isConnecting={isConnecting} onLeave={handleLeave} />}

      {isPartnerDisconnected && (
        <ReconnectionOverlay isVisible partnerName={partnerName} graceTimeLeft={reconnectionGrace} />
      )}

      {showMutualToast && <MutualVibeToast onComplete={handleMutualToastComplete} />}

      <View style={styles.topBar}>
        <Pressable onPress={() => setShowProfileSheet(true)} style={styles.partnerPill}>
          <Text style={[styles.partnerName, { color: theme.text }]}>{partnerName}</Text>
        </Pressable>
        <HandshakeTimer timeLeft={Math.max(0, displayTimeLeft)} totalTime={totalTime} phase={phase} />
      </View>

      {phase === 'handshake' && showIceBreaker && currentQuestion ? (
        <View style={styles.iceBreakerWrap}>
          <IceBreakerCard
            question={currentQuestion}
            onDismiss={() => setShowIceBreaker(false)}
            onShuffle={() => setCurrentQuestionIndex((prev) => (prev + 1) % Math.max(1, vibeQuestions.length))}
          />
        </View>
      ) : null}

      {phase === 'handshake' && (
        <View style={styles.vibeCheckWrap}>
          <VibeCheckButton timeLeft={displayTimeLeft} onVibe={handleUserVibe} />
        </View>
      )}

      {phase === 'date' && (
        <View style={styles.keepTheVibeWrap}>
          <KeepTheVibe
            extraTimeCredits={credits.extraTime}
            extendedVibeCredits={credits.extendedVibe}
            onExtend={handleExtend}
            isExtending={isExtending}
            onGetCredits={() => router.push('/settings/credits')}
          />
        </View>
      )}

      {callError ? (
        <View style={[styles.errorBar, { backgroundColor: theme.danger }]}>
          <Text style={styles.errorBarText}>{callError}</Text>
        </View>
      ) : null}

      <View style={styles.controlsBar}>
        <VideoDateControls
          isMuted={isMuted}
          isVideoOff={isVideoOff}
          onToggleMute={toggleMute}
          onToggleVideo={toggleVideo}
          onLeave={handleLeave}
          onViewProfile={() => setShowProfileSheet(true)}
          hasCredits={credits.extraTime > 0 || credits.extendedVibe > 0}
        />
      </View>

      {fullPartner && partnerId ? (
        <PartnerProfileSheet
          isOpen={showProfileSheet}
          onClose={() => setShowProfileSheet(false)}
          partner={fullPartner}
          partnerProfileId={partnerId}
        />
      ) : null}

      <View style={StyleSheet.absoluteFill} pointerEvents="box-none" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  message: { fontSize: 18, marginBottom: 16 },
  error: { fontSize: 16, textAlign: 'center', marginBottom: 16 },
  errorBar: { position: 'absolute', top: 100, left: 16, right: 16, padding: 12, borderRadius: 8 },
  errorBarText: { color: '#fff', textAlign: 'center' },
  button: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8 },
  buttonText: { color: '#fff', fontSize: 16 },
  remoteContainer: { ...StyleSheet.absoluteFillObject },
  placeholderRemote: { justifyContent: 'center', alignItems: 'center' },
  placeholderText: { color: '#888', fontSize: 16 },
  localPip: {
    position: 'absolute',
    top: 100,
    right: 16,
    width: 100,
    height: 140,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
  },
  localVideo: { width: '100%', height: '100%' },
  placeholderLocal: { justifyContent: 'center', alignItems: 'center' },
  placeholderTextSmall: { fontSize: 12 },
  muteBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  muteBadgeText: { fontSize: 12 },
  topBar: {
    position: 'absolute',
    top: 48,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  partnerPill: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.4)' },
  partnerName: { fontSize: 16, fontWeight: '600' },
  iceBreakerWrap: { position: 'absolute', bottom: 180, left: 16, right: 16 },
  vibeCheckWrap: { position: 'absolute', bottom: 160, left: 0, right: 0, alignItems: 'center' },
  keepTheVibeWrap: { position: 'absolute', top: 110, left: 16 },
  controlsBar: { position: 'absolute', bottom: 0, left: 0, right: 0 },
});
