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
import { BlurView } from 'expo-blur';
import Daily, { DailyMediaView } from '@daily-co/react-native-daily-js';
import type { DailyParticipant } from '@daily-co/react-native-daily-js';
import { useAuth } from '@/context/AuthContext';
import {
  useVideoDateSession,
  getDailyRoomToken,
  enterHandshake,
  endVideoDate,
  deleteDailyRoom,
  recordVibe,
  completeHandshake,
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
  const [reconnectionGrace, setReconnectionGrace] = useState(60);
  const [isPartnerDisconnected, setIsPartnerDisconnected] = useState(false);
  const [isTimerPaused, setIsTimerPaused] = useState(false);

  const callRef = useRef<ReturnType<typeof Daily.createCallObject> | null>(null);
  const roomNameRef = useRef<string | null>(null);
  const hasStartedJoinRef = useRef(false);
  const phaseRef = useRef(phase);
  const reconnectionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wasConnectedRef = useRef(false);
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

  useEffect(() => {
    if (!user?.id) return;
    fetchUserCredits(user.id).then(setCredits);
  }, [user?.id]);

  useEffect(() => {
    if (!sessionId || !isConnected || phase !== 'handshake') return;
    if (handshakeAnalyticsRef.current) return;
    handshakeAnalyticsRef.current = true;
    trackEvent('video_date_started', { session_id: sessionId, phase: 'handshake' });
  }, [sessionId, isConnected, phase]);

  useEffect(() => {
    if (eventId && user?.id) {
      if (phase === 'handshake') updateParticipantStatus(eventId, user.id, 'in_handshake');
      if (phase === 'date') updateParticipantStatus(eventId, user.id, 'in_date');
    }
  }, [eventId, user?.id, phase]);

  useEffect(() => {
    if (showFeedback && eventId && user?.id) {
      updateParticipantStatus(eventId, user.id, 'in_survey');
    }
  }, [showFeedback, eventId, user?.id]);

  const startReconnectionGrace = useCallback(() => {
    if (!wasConnectedRef.current) return;
    setIsPartnerDisconnected(true);
    setIsTimerPaused(true);
    setReconnectionGrace(60);
    if (reconnectionTimerRef.current) clearInterval(reconnectionTimerRef.current);
    reconnectionTimerRef.current = setInterval(() => {
      setReconnectionGrace((prev) => {
        if (prev <= 1) {
          if (reconnectionTimerRef.current) clearInterval(reconnectionTimerRef.current);
          reconnectionTimerRef.current = null;
          handleCallEnd();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => {
    if (isConnected && wasConnectedRef.current && isPartnerDisconnected) {
      setIsPartnerDisconnected(false);
      setIsTimerPaused(false);
      setReconnectionGrace(60);
      if (reconnectionTimerRef.current) {
        clearInterval(reconnectionTimerRef.current);
        reconnectionTimerRef.current = null;
      }
    }
    if (isConnected) wasConnectedRef.current = true;
  }, [isConnected, isPartnerDisconnected]);

  useEffect(() => {
    return () => {
      if (reconnectionTimerRef.current) clearInterval(reconnectionTimerRef.current);
    };
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
    if (sessionId) await endVideoDate(sessionId);
    if (eventId && user?.id) {
      try {
        await supabase.rpc('leave_matching_queue', { p_event_id: eventId, p_user_id: user.id });
      } catch {}
    }
    setLocalParticipant(null);
    setRemoteParticipant(null);
    setIsConnected(false);
    setIsConnecting(false);
  }, [sessionId, eventId, user?.id]);

  const handleCallEnd = useCallback(async () => {
    if (sessionId && !videoDateEndedRef.current) {
      videoDateEndedRef.current = true;
      trackEvent('video_date_ended', { session_id: sessionId });
    }
    Sentry.addBreadcrumb({ category: 'video-date', message: 'Call ended (user)', level: 'info', data: { sessionId } });
    setShowFeedback(true);
    if (eventId && user?.id) updateParticipantStatus(eventId, user.id, 'in_survey');
    await leaveAndCleanup();
  }, [leaveAndCleanup, eventId, user?.id, sessionId]);

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
    if (eventId && user?.id) updateParticipantStatus(eventId, user.id, 'in_date');
  }, [eventId, user?.id]);

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
    setHasPermission(true);
    return true;
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
          Sentry.addBreadcrumb({ category: 'video-date', message: 'Partner joined', level: 'info' });
          setIsConnected(true);
          setIsConnecting(false);
          setRemoteParticipant(event.participant);
        }
      });
      call.on('participant-updated', (event: { participant?: DailyParticipant }) => {
        if (!event?.participant) return;
        const p = event.participant;
        if ((p as unknown as { local?: boolean }).local) setLocalParticipant(p);
        else setRemoteParticipant(p);
      });
      call.on('participant-left', (event: { participant?: DailyParticipant }) => {
        if (event?.participant && !(event.participant as unknown as { local?: boolean }).local) {
          Sentry.addBreadcrumb({ category: 'video-date', message: 'Partner left', level: 'info' });
          setIsConnected(false);
          setRemoteParticipant(null);
          startReconnectionGrace();
        }
      });
      call.on('left-meeting', () => {
        Sentry.addBreadcrumb({ category: 'video-date', message: 'Call ended (left-meeting)', level: 'info' });
        setIsConnected(false);
        setIsConnecting(false);
      });
      call.on('error', () => {
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
        if (local) setLocalParticipant(local);
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
    };
  }, [
    sessionId,
    user?.id,
    session?.id,
    session?.ended_at,
    session?.handshake_started_at,
    sessionError,
    phase,
    requestPermissions,
    joining,
    startReconnectionGrace,
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
    call.setLocalAudio(!isMuted);
    setIsMuted(!isMuted);
  }, [isMuted]);

  const toggleVideo = useCallback(() => {
    const call = callRef.current;
    if (!call) return;
    call.setLocalVideo(!isVideoOff);
    setIsVideoOff(!isVideoOff);
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
    if (eventId && user?.id) updateParticipantStatus(eventId, user.id, 'browsing');
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

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <LiveSurfaceOfflineStrip />
      <View style={styles.remoteContainer}>
        {remoteParticipant ? (
          <>
            <DailyMediaView
              videoTrack={getTrack(remoteParticipant, 'video')}
              audioTrack={getTrack(remoteParticipant, 'audio')}
              mirror={false}
              zOrder={0}
              style={StyleSheet.absoluteFill}
            />
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
        {localParticipant ? (
          <DailyMediaView
            videoTrack={getTrack(localParticipant, 'video')}
            audioTrack={null}
            mirror={true}
            zOrder={1}
            style={styles.localVideo}
          />
        ) : (
          <View style={[styles.localVideo, styles.placeholderLocal, { backgroundColor: theme.surface }]}>
            <Text style={[styles.placeholderTextSmall, { color: theme.mutedForeground }]}>You</Text>
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

      {phase === 'date' && (credits.extraTime > 0 || credits.extendedVibe > 0) && (
        <View style={styles.keepTheVibeWrap}>
          <KeepTheVibe
            extraTimeCredits={credits.extraTime}
            extendedVibeCredits={credits.extendedVibe}
            onExtend={handleExtend}
            isExtending={isExtending}
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
