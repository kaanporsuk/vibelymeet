/**
 * Video date screen: full Vibely experience — handshake (60s) with blur, vibe check,
 * mutual vibe → date (300s), controls, partner sheet, keep-the-vibe, reconnection, post-date survey.
 */

import 'react-native-get-random-values';
import * as Sentry from '@sentry/react-native';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  AccessibilityInfo,
  AppState,
  Easing,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Camera } from 'expo-camera';
import Daily, { DailyMediaView } from '@daily-co/react-native-daily-js';
import type { DailyParticipant } from '@daily-co/react-native-daily-js';
import { useAuth } from '@/context/AuthContext';
import {
  useVideoDateSession,
  getDailyRoomTokenWithTimeout,
  enterHandshakeWithTimeout,
  VideoDateRequestTimeoutError,
  type RoomTokenFailureCode,
  endVideoDate,
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
  spendVideoDateCreditExtension,
  HANDSHAKE_SECONDS,
  DATE_SECONDS,
  fetchVideoSessionDateEntryTruth,
  videoSessionIndicatesHandshakeOrDate,
  markVideoDateDailyJoined,
  type PartnerProfileData,
} from '@/lib/videoDateApi';
import {
  effectiveDateDurationSeconds,
  userMessageForExtensionSpendFailure,
  type VideoDateExtendOutcome,
} from '@clientShared/matching/videoDateExtensionSpend';
import { nextConvergenceDelayMs } from '@clientShared/matching/convergenceScheduling';
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
import { InCallSafetySheet } from '@/components/video-date/InCallSafetySheet';
import { supabase } from '@/lib/supabase';
import { spacing } from '@/constants/theme';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { trackEvent } from '@/lib/analytics';
import { LobbyPostDateEvents } from '@clientShared/analytics/lobbyToPostDateJourney';
import { LiveSurfaceOfflineStrip } from '@/components/connectivity/LiveSurfaceOfflineStrip';
import { avatarUrl } from '@/lib/imageUrl';
import {
  clearDateEntryTransition,
  isDateEntryTransitionActive,
  markVideoDateEntryPipelineStarted,
} from '@/lib/dateEntryTransitionLatch';
import {
  eventLobbyHref,
  eventLobbyHrefPostSurveyComplete,
  readyGateHref,
  tabsRootHref,
} from '@/lib/activeSessionRoutes';
import { RC_CATEGORY, rcBreadcrumb } from '@/lib/nativeRcDiagnostics';
import {
  getVideoDateJourneyEventName,
  type VideoDateJourneyEvent,
  VIDEO_DATE_RECONNECT_SYNC_OUTCOMES,
} from '@clientShared/matching/videoDateDiagnostics';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const FIRST_CONNECT_TIMEOUT_MS = 25000;
const PREJOIN_STEP_TIMEOUT_MS = 12000;
type DailyCallObject = ReturnType<typeof Daily.createCallObject>;
type SharedDailyCallEntry = { sessionId: string; call: DailyCallObject; roomName: string | null };
let sharedDailyCallEntry: SharedDailyCallEntry | null = null;

/** Post-join UX / instrumentation — single stage truth for Daily + peer presence (not server phase). */
export type VideoDatePostJoinStage =
  | 'initial_loading'
  | 'joining_daily'
  | 'waiting_for_peer'
  | 'active_call'
  | 'reconnecting'
  | 'peer_missing_timeout'
  | 'fatal_join_error'
  | 'ended';

function networkTierFromDailyEvent(ev: { threshold?: string; quality?: number } | undefined): 'good' | 'fair' | 'poor' {
  const q = typeof ev?.quality === 'number' ? ev.quality : 100;
  const th = ev?.threshold;
  if (th === 'low' || q < 30) return 'poor';
  if (q < 70) return 'fair';
  return 'good';
}

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

function isReadyGateRace(code?: string): boolean {
  return code === 'READY_GATE_NOT_READY';
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

function dailyParticipantId(p: DailyParticipant | undefined): string | undefined {
  if (!p) return undefined;
  const u = p as unknown as { user_id?: string; userId?: string; session_id?: string };
  return u.user_id ?? u.userId ?? u.session_id;
}

function videoDateDailyDiagnostic(
  message: string,
  data: Record<string, string | number | boolean | null | undefined>
) {
  Sentry.addBreadcrumb({
    category: 'video-date-daily',
    message,
    level: 'info',
    data: data as Record<string, unknown>,
  });
}

/** Same keys as {@link videoDateDailyDiagnostic}; use where room name is only on refs (e.g. AppState). */
function videoDateSessionDiagnostic(
  message: string,
  data: Record<string, string | number | boolean | null | undefined>
) {
  Sentry.addBreadcrumb({
    category: 'video-date-session',
    message,
    level: 'info',
    data: data as Record<string, unknown>,
  });
}

function vdbg(message: string, data?: Record<string, unknown>) {
  const payload = { ...(data ?? {}), ts: new Date().toISOString() };
  console.log(`[VDBG] ${message}`, payload);
  Sentry.addBreadcrumb({
    category: 'vdbg',
    message,
    level: 'info',
    data: payload,
  });
}

function vdbgRedirect(target: unknown, reason: string, data?: Record<string, unknown>) {
  vdbg('date_redirect', { target, reason, ...(data ?? {}) });
}

export default function VideoDateScreen() {
  const { id: sessionId } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();

  const {
    session,
    partner: basicPartner,
    phase,
    timeLeft: serverTimeLeft,
    loading: sessionLoading,
    error: sessionError,
    refetch: refetchVideoSession,
  } = useVideoDateSession(sessionId ?? null, user?.id ?? null);

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
  /** Ephemeral feedback after +2 / +5 min credit (web: sonner toasts). */
  const [extendBanner, setExtendBanner] = useState<
    { kind: 'success'; minutes: number } | { kind: 'error'; message: string } | null
  >(null);
  const [blurIntensity, setBlurIntensity] = useState(80);
  const [credits, setCredits] = useState({ extraTime: 0, extendedVibe: 0 });
  const [isExtending, setIsExtending] = useState(false);
  const [reconnectionGrace, setReconnectionGrace] = useState(0);
  const [isPartnerDisconnected, setIsPartnerDisconnected] = useState(false);
  const [isTimerPaused, setIsTimerPaused] = useState(false);
  const [showInCallSafety, setShowInCallSafety] = useState(false);
  const [netQualityTier, setNetQualityTier] = useState<'good' | 'fair' | 'poor'>('good');
  const [handshakeGraceExpiresAt, setHandshakeGraceExpiresAt] = useState<string | null>(null);
  const [handshakeGraceSecondsRemaining, setHandshakeGraceSecondsRemaining] = useState<number | null>(null);

  const callRef = useRef<ReturnType<typeof Daily.createCallObject> | null>(null);
  const roomNameRef = useRef<string | null>(null);
  const hasStartedJoinRef = useRef(false);
  const phaseRef = useRef(phase);
  const extensionSpendInFlightRef = useRef(false);
  /** True once we have ever observed a remote Daily participant (survives transient participant-left). */
  const [partnerEverJoined, setPartnerEverJoined] = useState(false);
  const prevLocalInDailyRef = useRef(false);
  /** True after local `call.join` succeeds until leave/cleanup. */
  const [localInDailyRoom, setLocalInDailyRoom] = useState(false);
  /** Terminal: bounded wait elapsed + auto-retry exhausted without remote. */
  const [peerMissingTerminal, setPeerMissingTerminal] = useState(false);
  /** At most one automatic leave/rejoin when no remote (per mount + session). */
  const noRemoteAutoRecoveryUsedRef = useRef(false);
  /** True after sync_reconnect reports ended (avoid calling handleCallEnd every poll tick). */
  const reconnectEndedHandledRef = useRef(false);
  const reconnectSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectSyncCountRef = useRef(0);
  const reconnectSyncWindowStartedAtRef = useRef<number | null>(null);
  const requestReconnectSyncRef = useRef<(reason: string) => void>(() => {});
  const handleCallEndRef = useRef<((source?: 'local_end' | 'server_end') => Promise<void>) | null>(null);
  const handshakeAnalyticsRef = useRef(false);
  const videoDateEndedRef = useRef(false);
  const dateEstablishedRef = useRef(false);
  const firstConnectWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepVibePulse = useRef(new Animated.Value(1)).current;
  const topChromeAnim = useRef(new Animated.Value(1)).current;
  const controlsAnim = useRef(new Animated.Value(1)).current;
  const phaseCueAnim = useRef(new Animated.Value(1)).current;
  /** Dedupe first-time remote presence in React state (covers participant-joined / participant-updated paths). */
  const remotePromotionLoggedRef = useRef(false);
  const lastLocalMountedTrackIdRef = useRef<string | null>(null);
  const lastRemoteMountedTrackIdRef = useRef<string | null>(null);
  const loggedJourneyRef = useRef<Set<string>>(new Set());
  const lastLoggedPostJoinStageRef = useRef<VideoDatePostJoinStage | null>(null);
  const handshakeGraceRetryTriggeredRef = useRef(false);
  const peerMissingTerminalImpressionRef = useRef(false);

  const [isConnecting, setIsConnecting] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const [localParticipant, setLocalParticipant] = useState<DailyParticipant | null>(null);
  const [remoteParticipant, setRemoteParticipant] = useState<DailyParticipant | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [joining, setJoining] = useState(false);
  const [awaitingFirstConnect, setAwaitingFirstConnect] = useState(false);
  const [preJoinFailed, setPreJoinFailed] = useState(false);
  const [joinAttemptNonce, setJoinAttemptNonce] = useState(0);

  const logJourney = useCallback(
    (event: VideoDateJourneyEvent, payload?: Record<string, unknown>, dedupeKey?: string) => {
      const key = dedupeKey ?? event;
      if (loggedJourneyRef.current.has(key)) return;
      loggedJourneyRef.current.add(key);
      trackEvent(getVideoDateJourneyEventName(event), {
        platform: 'native',
        session_id: sessionId ?? null,
        event_id: eventId || null,
        ...(payload ?? {}),
      });
      vdbg(`journey_${event}`, { sessionId: sessionId ?? null, eventId: eventId || null, ...(payload ?? {}) });
    },
    [sessionId, eventId]
  );

  const releaseSharedCallIfOwned = useCallback(
    (call: DailyCallObject | null, reason: string) => {
      if (!call) return;
      if (sharedDailyCallEntry?.call !== call) return;
      vdbg('daily_call_singleton_release', {
        reason,
        sessionId: sharedDailyCallEntry.sessionId,
        roomName: sharedDailyCallEntry.roomName,
      });
      sharedDailyCallEntry = null;
    },
    []
  );
  const clearFirstConnectWatchdog = useCallback(() => {
    if (firstConnectWatchdogRef.current) {
      clearTimeout(firstConnectWatchdogRef.current);
      firstConnectWatchdogRef.current = null;
    }
  }, []);
  const boundCallRef = useRef<DailyCallObject | null>(null);
  const boundHandlersRef = useRef<{
    onParticipantJoined: (event: { participant?: DailyParticipant }) => void;
    onParticipantUpdated: (event: { participant?: DailyParticipant }) => void;
    onParticipantLeft: (event: { participant?: DailyParticipant }) => void;
    onLeftMeeting: () => void;
    onError: (event: unknown) => void;
    onNetworkQualityChange?: (event: unknown) => void;
  } | null>(null);

  const detachCallListeners = useCallback((reason: string) => {
    const call = boundCallRef.current;
    const handlers = boundHandlersRef.current;
    if (!call || !handlers) return;
    const callAny = call as unknown as { off?: (event: string, handler: (...args: unknown[]) => void) => void };
    callAny.off?.('participant-joined', handlers.onParticipantJoined as (...args: unknown[]) => void);
    callAny.off?.('participant-updated', handlers.onParticipantUpdated as (...args: unknown[]) => void);
    callAny.off?.('participant-left', handlers.onParticipantLeft as (...args: unknown[]) => void);
    callAny.off?.('left-meeting', handlers.onLeftMeeting as (...args: unknown[]) => void);
    callAny.off?.('error', handlers.onError as (...args: unknown[]) => void);
    if (handlers.onNetworkQualityChange) {
      callAny.off?.('network-quality-change', handlers.onNetworkQualityChange as (...args: unknown[]) => void);
    }
    vdbg('daily_call_listeners_detached', {
      reason,
      sessionId: sessionId ?? null,
      userId: user?.id ?? null,
    });
    boundCallRef.current = null;
    boundHandlersRef.current = null;
  }, [sessionId, user?.id]);

  const bindCallListeners = useCallback(
    (call: DailyCallObject, roomName: string | null) => {
      if (boundCallRef.current === call && boundHandlersRef.current) {
        vdbg('daily_call_listeners_bind_skipped', {
          reason: 'already_bound',
          sessionId: sessionId ?? null,
          userId: user?.id ?? null,
          roomName,
        });
        return;
      }
      detachCallListeners('rebind');
      const onParticipantJoined = (event: { participant?: DailyParticipant }) => {
        const p = event?.participant;
        const isLocal = !!(p && (p as unknown as { local?: boolean }).local);
        videoDateDailyDiagnostic('daily_participant_joined', {
          session_id: sessionId ?? '',
          room_name: roomName,
          kind: isLocal ? 'local' : 'remote',
          participant_id: p ? dailyParticipantId(p) ?? 'unknown' : 'none',
        });
        if (p && !isLocal) {
          if (__DEV__) vdbg('first_remote_participant_seen', { sessionId: sessionId ?? null, userId: user?.id ?? null, source: 'participant_joined' });
          Sentry.addBreadcrumb({ category: 'video-date', message: 'Partner joined', level: 'info' });
          rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'remote_participant_joined', {
            session_id: sessionId ?? null,
            user_id: user?.id ?? null,
            participant_id: dailyParticipantId(p) ?? 'unknown',
            room_name: roomName,
          });
          videoDateDailyDiagnostic('first_remote_observed', {
            session_id: sessionId ?? '',
            room_name: roomName,
            source: 'participant_joined',
          });
          clearFirstConnectWatchdog();
          setAwaitingFirstConnect(false);
          setPartnerEverJoined(true);
          setIsConnecting(false);
          setRemoteParticipant(p);
          requestReconnectSyncRef.current('daily_participant_joined');
        }
      };
      const onParticipantUpdated = (event: { participant?: DailyParticipant }) => {
        if (!event?.participant) return;
        const p = event.participant;
        const isLocal = !!(p as unknown as { local?: boolean }).local;
        videoDateDailyDiagnostic('daily_participant_updated', {
          session_id: sessionId ?? '',
          room_name: roomName,
          kind: isLocal ? 'local' : 'remote',
          participant_id: dailyParticipantId(p) ?? 'unknown',
        });
        if (isLocal) {
          setLocalParticipant(p);
          applyLocalMediaUiFromParticipant(p, { setIsVideoOff, setIsMuted });
        } else {
          setPartnerEverJoined(true);
          setRemoteParticipant(p);
        }
      };
      const onParticipantLeft = (event: { participant?: DailyParticipant }) => {
        const p = event?.participant;
        const isLocal = !!(p && (p as unknown as { local?: boolean }).local);
        if (p && !isLocal) {
          videoDateDailyDiagnostic('daily_participant_left', {
            session_id: sessionId ?? '',
            room_name: roomName,
            kind: 'remote',
            participant_id: dailyParticipantId(p) ?? 'unknown',
          });
          Sentry.addBreadcrumb({ category: 'video-date', message: 'Partner left', level: 'info' });
          setRemoteParticipant(null);
          if (!partnerEverJoinedRef.current || !sessionId || phaseRef.current === 'ended') return;
          setIsPartnerDisconnected(true);
          void markReconnectPartnerAway(sessionId);
          requestReconnectSyncRef.current('daily_participant_left');
        }
      };
      const onLeftMeeting = () => {
        Sentry.addBreadcrumb({ category: 'video-date', message: 'Call ended (left-meeting)', level: 'info' });
        clearFirstConnectWatchdog();
        setAwaitingFirstConnect(false);
        setLocalInDailyRoom(false);
        setIsConnecting(false);
        releaseSharedCallIfOwned(call, 'left_meeting');
      };
      const onError = (event: unknown) => {
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
        clearFirstConnectWatchdog();
        setAwaitingFirstConnect(false);
        setIsConnecting(false);
        setLocalInDailyRoom(false);
        releaseSharedCallIfOwned(call, 'daily_error_event');
      };
      const onNetworkQualityChange = (ev: unknown) => {
        setNetQualityTier(networkTierFromDailyEvent(ev as { threshold?: string; quality?: number }));
      };

      call.on('participant-joined', onParticipantJoined);
      call.on('participant-updated', onParticipantUpdated);
      call.on('participant-left', onParticipantLeft);
      call.on('left-meeting', onLeftMeeting);
      call.on('error', onError);
      try {
        call.on('network-quality-change', onNetworkQualityChange);
      } catch {
        /* SDK may omit this event on some builds */
      }
      boundCallRef.current = call;
      boundHandlersRef.current = {
        onParticipantJoined,
        onParticipantUpdated,
        onParticipantLeft,
        onLeftMeeting,
        onError,
        onNetworkQualityChange,
      };
      vdbg('daily_call_listeners_bound', {
        sessionId: sessionId ?? null,
        userId: user?.id ?? null,
        roomName,
      });
    },
    [clearFirstConnectWatchdog, detachCallListeners, releaseSharedCallIfOwned, sessionId, user?.id]
  );

  phaseRef.current = phase;

  useEffect(() => {
    if (!sessionId) {
      dateEstablishedRef.current = false;
      return;
    }
    if (
      phase === 'date' ||
      session?.state === 'date' ||
      session?.phase === 'date' ||
      !!session?.date_started_at ||
      (localInDailyRoom && partnerEverJoined)
    ) {
      dateEstablishedRef.current = true;
    }
  }, [sessionId, phase, session?.state, session?.phase, session?.date_started_at, localInDailyRoom, partnerEverJoined]);

  const clearHandshakeGraceState = useCallback(() => {
    setHandshakeGraceExpiresAt(null);
    setHandshakeGraceSecondsRemaining(null);
    handshakeGraceRetryTriggeredRef.current = false;
  }, []);

  const hasRemotePartner = !!remoteParticipant;
  /** Remote participant's first Daily join stamp (null = they have not opened/joined this date yet). */
  const peerServerJoinedAt = useMemo(() => {
    if (!session || !user?.id) return null;
    return user.id === session.participant_1_id
      ? session.participant_2_joined_at ?? null
      : session.participant_1_joined_at ?? null;
  }, [session, user?.id]);

  const partnerEverJoinedRef = useRef(false);
  useEffect(() => {
    partnerEverJoinedRef.current = partnerEverJoined;
  }, [partnerEverJoined]);

  useEffect(() => {
    setPartnerEverJoined(false);
    hasStartedJoinRef.current = false;
    dateEstablishedRef.current = false;
    vdbg('prejoin_state_hasStartedJoinRef', {
      value: false,
      sessionId: sessionId ?? null,
      userId: user?.id ?? null,
      step: 'session_reset',
    });
    vdbg('prejoin_state_localInDailyRoom', {
      value: false,
      sessionId: sessionId ?? null,
      userId: user?.id ?? null,
      step: 'session_reset',
    });
    setLocalInDailyRoom(false);
    setPeerMissingTerminal(false);
    clearHandshakeGraceState();
    noRemoteAutoRecoveryUsedRef.current = false;
    lastLoggedPostJoinStageRef.current = null;
  }, [sessionId, clearHandshakeGraceState]);

  /** Latch + RC before paint so hydration cannot bounce `/date` → `/ready` during stale `in_ready_gate`. */
  useLayoutEffect(() => {
    if (!sessionId) return;
    markVideoDateEntryPipelineStarted(sessionId);
    rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'navigate_to_date_started', {
      session_id: sessionId,
      user_id: user?.id ?? null,
    });
  }, [sessionId, user?.id]);

  useEffect(() => {
    vdbg('date_mount', { sessionId: sessionId ?? null, userId: user?.id ?? null });
    logJourney('date_route_entered', { source: 'mount' }, 'date_route_entered');
    if (!sessionId || !user?.id) return;
    const userId = user.id;
    let cancelled = false;
    void supabase
      .from('video_sessions')
      .select('*')
      .eq('id', sessionId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        vdbg('date_mount_session_row', {
          sessionId,
          userId,
          row: data ?? null,
          error: error ? { code: error.code, message: error.message } : null,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, user?.id, logJourney]);

  // Ended + in_ready_gate: defense-in-depth vs `NativeSessionRouteHydration` (backend truth first).
  useEffect(() => {
    if (!sessionId || !user?.id) return;
    let cancelled = false;
    void (async () => {
      const vs = await fetchVideoSessionDateEntryTruth(sessionId);
      if (cancelled) return;
      vdbg('date_entry_truth_row', { sessionId, userId: user.id, row: vs ?? null });
      if (!vs) {
        vdbg('date_guard_blocked', { sessionId, userId: user.id, reason: 'missing_session_truth_row' });
        return;
      }
      const { data: reg } = await supabase
        .from('event_registrations')
        .select('queue_status')
        .eq('profile_id', user.id)
        .eq('current_room_id', sessionId)
        .maybeSingle();
      if (cancelled) return;
      if (vs.ended_at != null) {
        const { data: verdict } = await supabase
          .from('date_feedback')
          .select('id')
          .eq('session_id', sessionId)
          .eq('user_id', user.id)
          .maybeSingle();
        if (cancelled) return;
        const reconnectExpiredSurveyDue =
          (vs as { ended_reason?: string | null }).ended_reason === 'reconnect_grace_expired' &&
          Boolean((vs as { date_started_at?: string | null }).date_started_at) &&
          !verdict;
        if (reg?.queue_status === 'in_survey' || reconnectExpiredSurveyDue) {
          dateEstablishedRef.current = true;
          logJourney('date_route_recovered', { source: 'ended_route_guard' }, 'date_route_recovered');
          logJourney(
            'survey_recovered',
            { source: 'ended_route_guard', queue_status: reg?.queue_status ?? null, reconnectExpiredSurveyDue },
            'survey_recovered_ended_route_guard'
          );
          logJourney('survey_lost_prevented', { source: 'ended_route_guard' }, 'survey_lost_prevented');
          setShowFeedback(true);
          return;
        }
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'route_bounced_to_lobby', {
          session_id: sessionId,
          user_id: user.id,
          reason: 'session_ended',
          event_id: vs.event_id,
        });
        if (vs.event_id) {
          const target = eventLobbyHref(vs.event_id as string);
          vdbgRedirect(target, 'session_ended_route_guard', {
            sessionId,
            userId: user.id,
            eventId: vs.event_id,
            endedAt: vs.ended_at,
          });
          logJourney('date_route_bounced', { reason: 'session_ended_route_guard', target });
          router.replace(target);
        } else {
          const target = tabsRootHref();
          vdbgRedirect(target, 'session_ended_route_guard', {
            sessionId,
            userId: user.id,
            endedAt: vs.ended_at,
          });
          logJourney('date_route_bounced', { reason: 'session_ended_route_guard', target });
          router.replace(target);
        }
        return;
      }
      if (videoSessionIndicatesHandshakeOrDate(vs)) {
        return;
      }
      if (reg?.queue_status === 'in_ready_gate') {
        const rgStatus = vs.ready_gate_status ?? null;
        const rgExpiresRaw = vs.ready_gate_expires_at ?? null;
        const rgExpiresMs =
          rgExpiresRaw == null
            ? null
            : typeof rgExpiresRaw === 'number'
              ? rgExpiresRaw
              : Date.parse(String(rgExpiresRaw));
        const bothReady = rgStatus === 'both_ready';
        const bothReadyValid =
          bothReady && rgExpiresMs != null && Number.isFinite(rgExpiresMs) && rgExpiresMs > Date.now();
        const readyGateBranch = bothReadyValid
          ? 'both_ready_valid_staying'
          : bothReady
            ? 'both_ready_expired_redirecting'
            : 'no_both_ready_redirecting';
        vdbg('date_guard_ready_gate_branch', {
          sessionId,
          userId: user.id,
          branch: readyGateBranch,
          readyGateStatus: rgStatus,
          readyGateExpiresAt: rgExpiresRaw,
        });
        if (bothReadyValid) return;
        if (isDateEntryTransitionActive(sessionId)) return;
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'route_bounced_to_ready', {
          session_id: sessionId,
          user_id: user.id,
          queue_status: reg.queue_status,
          vs_state: vs.state,
          vs_phase: vs.phase,
          handshake_started_at: Boolean(vs.handshake_started_at),
        });
        const target = readyGateHref(sessionId);
        vdbgRedirect(target, 'in_ready_gate_without_date_entry_latch_or_handshake', {
          sessionId,
          userId: user.id,
          queueStatus: reg.queue_status,
          state: vs.state,
          phase: vs.phase,
          handshakeStarted: Boolean(vs.handshake_started_at),
          latchActive: isDateEntryTransitionActive(sessionId),
        });
        logJourney('date_route_bounced', {
          reason: 'in_ready_gate_without_date_entry_latch_or_handshake',
          target,
        });
        router.replace(target);
        return;
      }
      if (reg?.queue_status && reg.queue_status !== 'in_ready_gate') {
        clearDateEntryTransition(sessionId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, user?.id]);

  const recoverFromNotStartableDateTruth = useCallback(
    async (source: 'enter_handshake' | 'create_date_room') => {
      if (!sessionId || !user?.id) return false;
      const [vs, regRes] = await Promise.all([
        fetchVideoSessionDateEntryTruth(sessionId),
        supabase
          .from('event_registrations')
          .select('queue_status, current_room_id')
          .eq('profile_id', user.id)
          .eq('current_room_id', sessionId)
          .maybeSingle(),
      ]);
      const reg = regRes.data;
      const startable = videoSessionIndicatesHandshakeOrDate(vs);
      const rgStatus = vs?.ready_gate_status ?? null;
      const rgExpiresRaw = vs?.ready_gate_expires_at ?? null;
      const rgExpiresMs =
        rgExpiresRaw == null
          ? null
          : typeof rgExpiresRaw === 'number'
            ? rgExpiresRaw
            : Date.parse(String(rgExpiresRaw));
      const readyGateEligible =
        rgStatus === 'ready' ||
        rgStatus === 'ready_a' ||
        rgStatus === 'ready_b' ||
        rgStatus === 'snoozed' ||
        (rgStatus === 'both_ready' &&
          rgExpiresMs != null &&
          Number.isFinite(rgExpiresMs) &&
          rgExpiresMs > Date.now());
      const decision: 'navigate_date' | 'navigate_ready' | 'stay_lobby' = startable
        ? 'navigate_date'
        : readyGateEligible
          ? 'navigate_ready'
          : 'stay_lobby';
      const reason = startable ? null : 'video_truth_not_startable';
      rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'date_route_decision', {
        session_id: sessionId,
        user_id: user.id,
        decision,
        reason,
        source,
        queue_status: reg?.queue_status ?? null,
        current_room_id: reg?.current_room_id ?? null,
        vs_state: vs?.state ?? null,
        vs_phase: vs?.phase ?? null,
        handshake_started_at: Boolean(vs?.handshake_started_at),
        ready_gate_status: rgStatus,
        ready_gate_expires_at: rgExpiresRaw == null ? null : String(rgExpiresRaw),
      });
      vdbg('date_route_decision', {
        sessionId,
        userId: user.id,
        source,
        decision,
        reason,
        queueStatus: reg?.queue_status ?? null,
        currentRoomId: reg?.current_room_id ?? null,
        vsState: vs?.state ?? null,
        vsPhase: vs?.phase ?? null,
        handshakeStartedAt: vs?.handshake_started_at ?? null,
        readyGateStatus: rgStatus,
        readyGateExpiresAt: rgExpiresRaw,
      });
      if (decision === 'navigate_ready') {
        const target = readyGateHref(sessionId);
        vdbgRedirect(target, 'ready_gate_not_ready_recover_to_ready', { source, sessionId, userId: user.id });
        router.replace(target);
        return true;
      }
      if (decision === 'stay_lobby') {
        const fallbackEventId = vs?.event_id ?? eventId;
        if (fallbackEventId) {
          const target = eventLobbyHref(fallbackEventId as string);
          vdbgRedirect(target, 'ready_gate_not_ready_recover_to_lobby', {
            source,
            sessionId,
            userId: user.id,
            eventId: fallbackEventId,
          });
          router.replace(target);
        } else {
          const target = tabsRootHref();
          vdbgRedirect(target, 'ready_gate_not_ready_recover_to_tabs', {
            source,
            sessionId,
            userId: user.id,
          });
          router.replace(target);
        }
        return true;
      }
      return false;
    },
    [eventId, sessionId, user?.id]
  );

  useEffect(() => {
    setLocalTimeLeft(serverTimeLeft);
  }, [serverTimeLeft]);

  useEffect(() => {
    if (phase !== 'handshake') {
      clearHandshakeGraceState();
      return;
    }
    // Refresh/reconnect resilience: rebuild grace countdown from canonical session expiry.
    const graceExpiresAtRaw = session?.handshake_grace_expires_at ?? null;
    if (!graceExpiresAtRaw) {
      if ((localTimeLeft ?? 0) > 0) {
        clearHandshakeGraceState();
      }
      return;
    }
    if ((localTimeLeft ?? 0) > 0) {
      clearHandshakeGraceState();
      return;
    }
    const graceRemaining = Math.max(0, Math.ceil((new Date(graceExpiresAtRaw).getTime() - Date.now()) / 1000));
    if (graceRemaining > 0) {
      setHandshakeGraceExpiresAt(graceExpiresAtRaw);
      setHandshakeGraceSecondsRemaining(graceRemaining);
    } else {
      clearHandshakeGraceState();
    }
  }, [phase, session?.handshake_grace_expires_at, localTimeLeft, clearHandshakeGraceState]);

  useEffect(() => {
    if (!sessionId || !user?.id) return;
    let cancelled = false;
    fetchPartnerProfile(sessionId, user.id, (path) => avatarUrl(path, 'avatar')).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setFullPartner(res.partner);
        setPartnerId(res.partnerId);
        setEventId(res.eventId);
        setIsParticipant1(res.isParticipant1);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, user?.id]);

  /** Bounded wait for first remote peer; one automatic leave/rejoin; then peer_missing_timeout. */
  useEffect(() => {
    if (
      !localInDailyRoom ||
      hasRemotePartner ||
      phase === 'ended' ||
      !sessionId ||
      peerMissingTerminal ||
      isPartnerDisconnected
    ) {
      clearFirstConnectWatchdog();
      return;
    }
    if (!awaitingFirstConnect) {
      clearFirstConnectWatchdog();
      return;
    }

    clearFirstConnectWatchdog();
    firstConnectWatchdogRef.current = setTimeout(() => {
      const call = callRef.current;
      if (!call) return;
      const participants = call.participants();
      const remotes = participants
        ? Object.values(participants).filter((p) => !(p as unknown as { local?: boolean }).local)
        : [];
      if (remotes.length > 0) return;

      if (!noRemoteAutoRecoveryUsedRef.current) {
        noRemoteAutoRecoveryUsedRef.current = true;
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'no_remote_watchdog_recovery_start', {
          session_id: sessionId,
          room_name: roomNameRef.current ?? undefined,
        });
        videoDateDailyDiagnostic('no_remote_auto_recovery_start', {
          session_id: sessionId,
          room_name: roomNameRef.current ?? null,
        });
        void (async () => {
          try {
            await call.leave();
            call.destroy();
          } catch {
            /* ignore */
          }
          detachCallListeners('no_remote_auto_recovery');
          releaseSharedCallIfOwned(call, 'no_remote_auto_recovery');
          callRef.current = null;
          vdbg('prejoin_state_localInDailyRoom', {
            value: false,
            sessionId,
            userId: user?.id ?? null,
            step: 'no_remote_auto_recovery',
          });
          setLocalInDailyRoom(false);
          vdbg('prejoin_state_awaitingFirstConnect', {
            value: false,
            sessionId,
            userId: user?.id ?? null,
            step: 'no_remote_auto_recovery',
          });
          setAwaitingFirstConnect(false);
          vdbg('prejoin_state_isConnecting', {
            value: false,
            sessionId,
            userId: user?.id ?? null,
            step: 'no_remote_auto_recovery',
          });
          setIsConnecting(false);
          setRemoteParticipant(null);
          hasStartedJoinRef.current = false;
          vdbg('prejoin_state_hasStartedJoinRef', {
            value: false,
            sessionId,
            userId: user?.id ?? null,
            step: 'no_remote_auto_recovery',
          });
          vdbg('prejoin_state_joinAttemptNonce', {
            value: 'increment',
            sessionId,
            userId: user?.id ?? null,
            step: 'no_remote_auto_recovery',
          });
          setJoinAttemptNonce((n) => n + 1);
          videoDateDailyDiagnostic('no_remote_auto_recovery_complete', {
            session_id: sessionId,
            result: 'rejoin_scheduled',
          });
        })();
        return;
      }
      rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'peer_missing_terminal_watchdog_fire', {
        session_id: sessionId,
        room_name: roomNameRef.current ?? undefined,
        watchdog_ms: FIRST_CONNECT_TIMEOUT_MS,
      });
      videoDateDailyDiagnostic('peer_missing_timeout', { session_id: sessionId, room_name: roomNameRef.current ?? null });
      setPeerMissingTerminal(true);
      vdbg('prejoin_state_awaitingFirstConnect', {
        value: false,
        sessionId,
        userId: user?.id ?? null,
        step: 'peer_missing_timeout',
      });
      setAwaitingFirstConnect(false);
      vdbg('prejoin_state_isConnecting', {
        value: false,
        sessionId,
        userId: user?.id ?? null,
        step: 'peer_missing_timeout',
      });
      setIsConnecting(false);
      vdbg('prejoin_state_callError', {
        value: 'Your match has not joined this video room yet.',
        sessionId,
        userId: user?.id ?? null,
        step: 'peer_missing_timeout',
      });
      setCallError('Your match has not joined this video room yet.');
    }, FIRST_CONNECT_TIMEOUT_MS);

    return () => clearFirstConnectWatchdog();
  }, [
    awaitingFirstConnect,
    hasRemotePartner,
    localInDailyRoom,
    phase,
    sessionId,
    peerMissingTerminal,
    isPartnerDisconnected,
    clearFirstConnectWatchdog,
    releaseSharedCallIfOwned,
    detachCallListeners,
  ]);

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
    return () => {
      clearFirstConnectWatchdog();
      clearHandshakeGraceState();
    };
  }, [clearFirstConnectWatchdog, clearHandshakeGraceState]);

  useEffect(() => {
    if (!hasRemotePartner) return;
    const t = setTimeout(() => setShowIceBreaker(false), 30000);
    return () => clearTimeout(t);
  }, [hasRemotePartner]);

  useEffect(() => {
    if (remoteParticipant && !remotePromotionLoggedRef.current) {
      remotePromotionLoggedRef.current = true;
      videoDateDailyDiagnostic('remote_participant_promoted_into_ui', {
        session_id: sessionId ?? '',
        room_name: roomNameRef.current ?? null,
        participant_id: dailyParticipantId(remoteParticipant) ?? 'unknown',
      });
    }
    if (!remoteParticipant) {
      remotePromotionLoggedRef.current = false;
    }
  }, [remoteParticipant, sessionId]);

  useEffect(() => {
    const trackId = getTrack(localParticipant ?? undefined, 'video')?.id ?? null;
    if (!trackId) {
      lastLocalMountedTrackIdRef.current = null;
      return;
    }
    if (lastLocalMountedTrackIdRef.current === trackId) return;
    lastLocalMountedTrackIdRef.current = trackId;
    videoDateDailyDiagnostic('local_track_mounted', {
      session_id: sessionId ?? '',
      room_name: roomNameRef.current ?? null,
      track_id: trackId,
    });
  }, [localParticipant, sessionId]);

  useEffect(() => {
    const trackId = getTrack(remoteParticipant ?? undefined, 'video')?.id ?? null;
    if (!trackId) {
      lastRemoteMountedTrackIdRef.current = null;
      return;
    }
    if (lastRemoteMountedTrackIdRef.current === trackId) return;
    lastRemoteMountedTrackIdRef.current = trackId;
    videoDateDailyDiagnostic('remote_track_mounted', {
      session_id: sessionId ?? '',
      room_name: roomNameRef.current ?? null,
      participant_id: dailyParticipantId(remoteParticipant ?? undefined) ?? 'unknown',
      track_id: trackId,
    });
  }, [remoteParticipant, sessionId]);

  useEffect(() => {
    if (!hasRemotePartner || phase !== 'handshake') return;
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
  }, [hasRemotePartner, phase]);

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
      if (!call || !localInDailyRoom) return;
      const participants = call.participants();
      const local = participants?.local;
      if (local) {
        setLocalParticipant(local);
        applyLocalMediaUiFromParticipant(local, { setIsVideoOff, setIsMuted });
      }
      const remotes = participants ? Object.values(participants).filter((p) => !(p as unknown as { local?: boolean }).local) : [];
      if (remotes[0]) {
        setRemoteParticipant(remotes[0] as DailyParticipant);
        setPartnerEverJoined(true);
      }
    }, [localInDailyRoom])
  );

  useEffect(() => {
    if (!sessionId || !hasRemotePartner || phase !== 'handshake') return;
    if (handshakeAnalyticsRef.current) return;
    handshakeAnalyticsRef.current = true;
    trackEvent('video_date_started', { session_id: sessionId, phase: 'handshake' });
  }, [sessionId, hasRemotePartner, phase]);

  const onPartnerLeftReconnect = useCallback(() => {
    if (!partnerEverJoined || !sessionId || phase === 'ended') return;
    setIsPartnerDisconnected(true);
    void markReconnectPartnerAway(sessionId);
    requestReconnectSyncRef.current('partner_marked_away');
  }, [sessionId, phase, partnerEverJoined]);

  const cleanupDailyAndLocalState = useCallback(async () => {
    clearHandshakeGraceState();
    clearFirstConnectWatchdog();
    const call = callRef.current;
    if (call) {
      detachCallListeners('leave_and_cleanup');
      try {
        await call.leave();
        call.destroy();
      } catch (_error) {
        void _error;
      }
      releaseSharedCallIfOwned(call, 'leave_and_cleanup');
      callRef.current = null;
    }
    const roomName = roomNameRef.current;
    if (roomName) {
      vdbg('daily_room_delete_skipped', {
        action: 'delete_room',
        caller: 'native.leaveAndCleanup',
        reason: 'backend_cleanup_owns_video_date_rooms',
        sessionId: sessionId ?? null,
        userId: user?.id ?? null,
        eventId: eventId || null,
        roomName,
      });
      roomNameRef.current = null;
    }
    setLocalParticipant(null);
    setRemoteParticipant(null);
    vdbg('prejoin_state_localInDailyRoom', {
      value: false,
      sessionId: sessionId ?? null,
      userId: user?.id ?? null,
      step: 'leave_and_cleanup',
    });
    setLocalInDailyRoom(false);
    setPartnerEverJoined(false);
    setPeerMissingTerminal(false);
    noRemoteAutoRecoveryUsedRef.current = false;
    vdbg('prejoin_state_isConnecting', {
      value: false,
      sessionId: sessionId ?? null,
      userId: user?.id ?? null,
      step: 'leave_and_cleanup',
    });
    setIsConnecting(false);
    setIsMuted(false);
    setIsVideoOff(false);
    vdbg('prejoin_state_awaitingFirstConnect', {
      value: false,
      sessionId: sessionId ?? null,
      userId: user?.id ?? null,
      step: 'leave_and_cleanup',
    });
    setAwaitingFirstConnect(false);
    vdbg('prejoin_state_preJoinFailed', {
      value: false,
      sessionId: sessionId ?? null,
      userId: user?.id ?? null,
      step: 'leave_and_cleanup',
    });
    setPreJoinFailed(false);
    setNetQualityTier('good');
  }, [
    sessionId,
    eventId,
    user?.id,
    clearFirstConnectWatchdog,
    releaseSharedCallIfOwned,
    detachCallListeners,
    clearHandshakeGraceState,
  ]);

  const cleanupForAbortWithoutServerEnd = useCallback(async () => {
    await cleanupDailyAndLocalState();
  }, [cleanupDailyAndLocalState]);

  const cleanupForEstablishedDateEnd = useCallback(async () => {
    await cleanupDailyAndLocalState();
    if (sessionId) await endVideoDate(sessionId);
  }, [cleanupDailyAndLocalState, sessionId]);

  const handleCallEnd = useCallback(async (source: 'local_end' | 'server_end' = 'local_end') => {
    const dateWasEstablished = dateEstablishedRef.current;
    if (sessionId && !videoDateEndedRef.current) {
      videoDateEndedRef.current = true;
      trackEvent('video_date_ended', { session_id: sessionId });
    }
    Sentry.addBreadcrumb({
      category: 'video-date',
      message: 'Call ended (user)',
      level: 'info',
      data: { sessionId, source, dateWasEstablished },
    });
    if (dateWasEstablished) {
      logJourney('survey_opened', { source }, `survey_opened_${source}`);
      setShowFeedback(true);
      if (source === 'server_end') {
        await cleanupForAbortWithoutServerEnd();
      } else {
        await cleanupForEstablishedDateEnd();
      }
      return;
    }
    setShowFeedback(false);
    await cleanupForAbortWithoutServerEnd();
  }, [cleanupForAbortWithoutServerEnd, cleanupForEstablishedDateEnd, sessionId, logJourney]);

  useEffect(() => {
    handleCallEndRef.current = handleCallEnd;
  }, [handleCallEnd]);

  const clearReconnectSyncTimer = useCallback(() => {
    if (!reconnectSyncTimerRef.current) return;
    clearTimeout(reconnectSyncTimerRef.current);
    reconnectSyncTimerRef.current = null;
  }, []);

  const handleEndAfterInCallReport = useCallback(async () => {
    await handleCallEnd('local_end');
  }, [handleCallEnd]);

  /** Foreground/background: trigger immediate reconnect syncs on app lifecycle transitions. */
  useEffect(() => {
    if (!sessionId) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        videoDateSessionDiagnostic('app_foreground_refetch_start', {
          session_id: sessionId,
          room_name: roomNameRef.current ?? null,
        });
        void refetchVideoSession()
          .then(() => {
            videoDateSessionDiagnostic('app_foreground_refetch_end', {
              session_id: sessionId,
              room_name: roomNameRef.current ?? null,
            });
          })
          .catch(() => {
            videoDateSessionDiagnostic('app_foreground_refetch_end', {
              session_id: sessionId,
              room_name: roomNameRef.current ?? null,
              error: 1,
            });
          });
        requestReconnectSyncRef.current('app_foreground');
        return;
      }
      if (next === 'background' || next === 'inactive') {
        requestReconnectSyncRef.current('app_background');
      }
    });
    return () => sub.remove();
  }, [sessionId, refetchVideoSession]);

  useEffect(() => {
    if (!sessionId || phase === 'ended') return;
    let cancelled = false;
    let inFlight = false;

    const stopLoop = (reason: string) => {
      clearReconnectSyncTimer();
      if (reconnectSyncWindowStartedAtRef.current !== null) {
        vdbg('sync_reconnect_loop_stop', {
          sessionId,
          phase: phaseRef.current,
          reason,
          totalSyncCount: reconnectSyncCountRef.current,
          elapsedMs: Date.now() - reconnectSyncWindowStartedAtRef.current,
        });
      }
      reconnectSyncWindowStartedAtRef.current = null;
    };

    const scheduleBackoff = (reason: string) => {
      if (cancelled || phaseRef.current === 'ended') return;
      const startedAt = reconnectSyncWindowStartedAtRef.current ?? Date.now();
      reconnectSyncWindowStartedAtRef.current = startedAt;
      const delayMs = nextConvergenceDelayMs(Math.max(0, Date.now() - startedAt));
      clearReconnectSyncTimer();
      vdbg('sync_reconnect_schedule', {
        sessionId,
        phase: phaseRef.current,
        reason,
        mode: 'backoff',
        delayMs,
        totalSyncCount: reconnectSyncCountRef.current,
      });
      reconnectSyncTimerRef.current = setTimeout(() => {
        void runSync(reason, 'backoff');
      }, delayMs);
    };

    const runSync = async (reason: string, mode: 'immediate' | 'backoff') => {
      if (cancelled || !sessionId || phaseRef.current === 'ended') return;
      if (inFlight) {
        vdbg('sync_reconnect_skip', { sessionId, phase: phaseRef.current, reason, mode, skip: 'in_flight' });
        return;
      }
      inFlight = true;
      reconnectSyncCountRef.current += 1;
      vdbg('sync_reconnect_fire', {
        sessionId,
        phase: phaseRef.current,
        reason,
        mode,
        totalSyncCount: reconnectSyncCountRef.current,
      });
      try {
        const r = await syncVideoDateReconnect(sessionId);
        if (cancelled) {
          vdbg('sync_reconnect_result', {
            sessionId,
            phase: phaseRef.current,
            reason,
            mode,
            outcome: 'cancelled',
            resultKind: r ? 'cancelled_after_result' : 'cancelled_after_null_result',
          });
          return;
        }
        if (!r) {
          vdbg('sync_reconnect_result', {
            sessionId,
            phase: phaseRef.current,
            reason,
            mode,
            outcome: VIDEO_DATE_RECONNECT_SYNC_OUTCOMES.RPC_ERROR,
            resultKind: 'null_result',
          });
          scheduleBackoff('rpc_error');
          return;
        }
        if (r.ended) {
          vdbg('sync_reconnect_result', {
            sessionId,
            phase: phaseRef.current,
            reason,
            mode,
            outcome: VIDEO_DATE_RECONNECT_SYNC_OUTCOMES.ENDED,
            endedReason: r.ended_reason ?? null,
          });
          // Any server-reported end from sync_reconnect (grace expiry, partner end, etc.) → same post-date path as web.
          if (!reconnectEndedHandledRef.current && partnerEverJoinedRef.current) {
            reconnectEndedHandledRef.current = true;
            void handleCallEndRef.current?.('server_end');
          }
          setIsPartnerDisconnected(false);
          setIsTimerPaused(false);
          setReconnectionGrace(0);
          stopLoop('session_ended');
          return;
        }
        reconnectEndedHandledRef.current = false;
        const hasGrace = !!r.reconnect_grace_ends_at;
        const show = hasGrace && r.partner_marked_away;
        vdbg('sync_reconnect_result', {
          sessionId,
          phase: phaseRef.current,
          reason,
          mode,
          outcome: VIDEO_DATE_RECONNECT_SYNC_OUTCOMES.OK,
          hasGrace,
          partnerMarkedAway: r.partner_marked_away,
        });
        setIsPartnerDisconnected(show);
        setIsTimerPaused(show);
        if (hasGrace && r.reconnect_grace_ends_at) {
          setReconnectionGrace(
            Math.max(0, Math.ceil((new Date(r.reconnect_grace_ends_at).getTime() - Date.now()) / 1000)),
          );
          scheduleBackoff(show ? 'reconnect_grace_active' : 'grace_active_partner_not_marked_away');
          return;
        }
        setReconnectionGrace(0);
        stopLoop('truth_stable_no_grace');
      } finally {
        inFlight = false;
      }
    };

    requestReconnectSyncRef.current = (reason: string) => {
      if (cancelled || !sessionId || phaseRef.current === 'ended') return;
      if (reconnectSyncWindowStartedAtRef.current === null) {
        reconnectSyncWindowStartedAtRef.current = Date.now();
      }
      void runSync(reason, 'immediate');
    };

    requestReconnectSyncRef.current('mount_or_phase_change');
    return () => {
      cancelled = true;
      clearReconnectSyncTimer();
      requestReconnectSyncRef.current = () => {};
    };
  }, [sessionId, phase, clearReconnectSyncTimer]);

  useEffect(() => {
    reconnectSyncCountRef.current = 0;
    reconnectSyncWindowStartedAtRef.current = null;
    clearReconnectSyncTimer();
  }, [sessionId, clearReconnectSyncTimer]);

  useEffect(() => {
    const prev = prevLocalInDailyRef.current;
    prevLocalInDailyRef.current = localInDailyRoom;
    if (!localInDailyRoom) return;
    if (!partnerEverJoined) return;
    if (!prev && sessionId && phase !== 'ended') {
      void markReconnectReturn(sessionId);
      requestReconnectSyncRef.current('daily_local_reconnected');
    }
  }, [localInDailyRoom, partnerEverJoined, sessionId, phase]);

  /** In-call / post-connect: end date, cleanup Daily, show PostDateSurvey (navigation from survey only). */
  const handleEndDateFromControls = useCallback(async () => {
    await handleCallEnd('local_end');
  }, [handleCallEnd]);

  /** Connecting or waiting for partner: exit without post-date survey (nothing to rate yet). */
  const handleAbortConnection = useCallback(
    async (opts?: { source?: 'peer_missing' }) => {
    if (opts?.source === 'peer_missing' && sessionId) {
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_PEER_MISSING_BACK_TO_LOBBY_TAP, {
        platform: 'native',
        session_id: sessionId,
        event_id: eventId,
      });
    }
    await cleanupForAbortWithoutServerEnd();
    if (eventId) {
      const target = eventLobbyHref(eventId);
      vdbgRedirect(target, 'abort_connection', { sessionId: sessionId ?? null, eventId });
      router.replace(target);
    } else {
      const target = '/(tabs)/events';
      vdbgRedirect(target, 'abort_connection', { sessionId: sessionId ?? null });
      router.replace(target);
    }
  },
    [cleanupForAbortWithoutServerEnd, eventId, sessionId]
  );

  const handleUserVibe = useCallback(async (): Promise<boolean> => {
    if (!sessionId) return false;
    return await recordVibe(sessionId, {
      actorUserId: user?.id ?? null,
      phase: phaseRef.current,
    });
  }, [sessionId, user?.id]);

  const handleMutualToastComplete = useCallback(() => {
    clearHandshakeGraceState();
    setShowMutualToast(false);
    setLocalTimeLeft(effectiveDateDurationSeconds(DATE_SECONDS, session?.date_extra_seconds));
  }, [clearHandshakeGraceState, session?.date_extra_seconds]);

  const focusKeepTheVibeAddTime = useCallback(() => {
    void AccessibilityInfo.announceForAccessibility(
      'Add time using the plus two minute or plus five minute buttons at the top of the screen.'
    );
    keepVibePulse.setValue(1);
    Animated.sequence([
      Animated.timing(keepVibePulse, { toValue: 1.06, duration: 140, useNativeDriver: true }),
      Animated.timing(keepVibePulse, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
  }, [keepVibePulse]);

  const handleAddTimeShortcut = useCallback(() => {
    const has = credits.extraTime > 0 || credits.extendedVibe > 0;
    if (has) focusKeepTheVibeAddTime();
    else router.push('/settings/credits');
  }, [credits.extraTime, credits.extendedVibe, focusKeepTheVibeAddTime]);

  const handleExtend = useCallback(
    async (minutes: number, type: 'extra_time' | 'extended_vibe'): Promise<VideoDateExtendOutcome> => {
      if (!user?.id) {
        return { ok: false, userMessage: userMessageForExtensionSpendFailure('unauthorized') };
      }
      if (extensionSpendInFlightRef.current) {
        return { ok: false, userMessage: '', silent: true };
      }
      extensionSpendInFlightRef.current = true;
      setIsExtending(true);
      setExtendBanner(null);
      try {
        if (!sessionId) {
          const msg = userMessageForExtensionSpendFailure('session_not_found');
          setExtendBanner({ kind: 'error', message: msg });
          return { ok: false, userMessage: msg };
        }
        const result = await spendVideoDateCreditExtension(sessionId, type);
        void fetchUserCredits(user.id).then(setCredits);
        if (result.ok) {
          trackEvent('video_date_extended', { session_id: sessionId });
          setLocalTimeLeft((prev) => (prev ?? 0) + minutes * 60);
          void refetchVideoSession();
          setExtendBanner({ kind: 'success', minutes });
          return { ok: true, minutesAdded: minutes };
        }
        const msg = userMessageForExtensionSpendFailure(result.error);
        setExtendBanner({ kind: 'error', message: msg });
        return { ok: false, userMessage: msg };
      } finally {
        extensionSpendInFlightRef.current = false;
        setIsExtending(false);
      }
    },
    [user?.id, sessionId, refetchVideoSession]
  );

  useEffect(() => {
    if (!extendBanner) return;
    const t = setTimeout(() => setExtendBanner(null), 2500);
    return () => clearTimeout(t);
  }, [extendBanner]);

  const requestPermissions = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === 'android') {
      const camOk = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
      const micOk = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      vdbg('prejoin_step_prejoin_permissions_before', {
        platform: 'android',
        cameraGranted: camOk,
        microphoneGranted: micOk,
      });
      if (camOk && micOk) {
        vdbg('prejoin_state_hasPermission', { value: true, source: 'android_existing_grants' });
        setHasPermission(true);
        vdbg('prejoin_step_prejoin_permissions_after', {
          platform: 'android',
          cameraGranted: true,
          microphoneGranted: true,
          ok: true,
          source: 'existing_grants',
        });
        return true;
      }
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.CAMERA,
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      ]);
      const cameraGranted = granted[PermissionsAndroid.PERMISSIONS.CAMERA] === PermissionsAndroid.RESULTS.GRANTED;
      const microphoneGranted = granted[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED;
      const ok =
        cameraGranted &&
        microphoneGranted;
      vdbg('prejoin_state_hasPermission', { value: ok, source: 'android_request' });
      setHasPermission(ok);
      vdbg('prejoin_step_prejoin_permissions_after', {
        platform: 'android',
        cameraGranted,
        microphoneGranted,
        cameraResult: granted[PermissionsAndroid.PERMISSIONS.CAMERA],
        microphoneResult: granted[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO],
        ok,
        source: 'request',
      });
      return ok;
    }
    const camExisting = await Camera.getCameraPermissionsAsync();
    const micExisting = await Camera.getMicrophonePermissionsAsync();
    vdbg('prejoin_step_prejoin_permissions_before', {
      platform: Platform.OS,
      cameraStatus: camExisting.status,
      microphoneStatus: micExisting.status,
      cameraGranted: camExisting.status === 'granted',
      microphoneGranted: micExisting.status === 'granted',
    });
    if (camExisting.status === 'granted' && micExisting.status === 'granted') {
      vdbg('prejoin_state_hasPermission', { value: true, source: 'native_existing_grants' });
      setHasPermission(true);
      vdbg('prejoin_step_prejoin_permissions_after', {
        platform: Platform.OS,
        cameraStatus: camExisting.status,
        microphoneStatus: micExisting.status,
        cameraGranted: true,
        microphoneGranted: true,
        ok: true,
        source: 'existing_grants',
      });
      return true;
    }
    const cam = await Camera.requestCameraPermissionsAsync();
    const mic = await Camera.requestMicrophonePermissionsAsync();
    const ok = cam.status === 'granted' && mic.status === 'granted';
    vdbg('prejoin_state_hasPermission', { value: ok, source: 'native_request' });
    setHasPermission(ok);
    vdbg('prejoin_step_prejoin_permissions_after', {
      platform: Platform.OS,
      cameraStatus: cam.status,
      microphoneStatus: mic.status,
      cameraGranted: cam.status === 'granted',
      microphoneGranted: mic.status === 'granted',
      ok,
      source: 'request',
    });
    return ok;
  }, []);

  const handleRetryInitialConnect = useCallback(async () => {
    if (peerMissingTerminal && sessionId) {
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_PEER_MISSING_RETRY_TAP, {
        platform: 'native',
        session_id: sessionId,
        event_id: eventId,
      });
    }
    clearFirstConnectWatchdog();
    const call = callRef.current;
    if (call) {
      detachCallListeners('retry_initial_connect');
      try {
        await call.leave();
        call.destroy();
      } catch (_error) {
        void _error;
      }
      releaseSharedCallIfOwned(call, 'retry_initial_connect');
      callRef.current = null;
    }
    vdbg('prejoin_state_awaitingFirstConnect', {
      value: false,
      sessionId: sessionId ?? null,
      userId: user?.id ?? null,
      step: 'retry_initial_connect',
    });
    setAwaitingFirstConnect(false);
    setPeerMissingTerminal(false);
    vdbg('prejoin_state_preJoinFailed', {
      value: false,
      sessionId: sessionId ?? null,
      userId: user?.id ?? null,
      step: 'retry_initial_connect',
    });
    setPreJoinFailed(false);
    vdbg('prejoin_state_callError', {
      value: null,
      sessionId: sessionId ?? null,
      userId: user?.id ?? null,
      step: 'retry_initial_connect',
    });
    setCallError(null);
    setRemoteParticipant(null);
    vdbg('prejoin_state_localInDailyRoom', {
      value: false,
      sessionId: sessionId ?? null,
      userId: user?.id ?? null,
      step: 'retry_initial_connect',
    });
    setLocalInDailyRoom(false);
    setPartnerEverJoined(false);
    noRemoteAutoRecoveryUsedRef.current = false;
    vdbg('prejoin_state_isConnecting', {
      value: false,
      sessionId: sessionId ?? null,
      userId: user?.id ?? null,
      step: 'retry_initial_connect',
    });
    setIsConnecting(false);
    vdbg('prejoin_state_joining', {
      value: false,
      sessionId: sessionId ?? null,
      userId: user?.id ?? null,
      step: 'retry_initial_connect',
    });
    setJoining(false);
    hasStartedJoinRef.current = false;
    vdbg('prejoin_state_hasStartedJoinRef', {
      value: false,
      sessionId: sessionId ?? null,
      userId: user?.id ?? null,
      step: 'retry_initial_connect',
    });
    vdbg('prejoin_state_joinAttemptNonce', {
      value: 'increment',
      sessionId: sessionId ?? null,
      userId: user?.id ?? null,
      step: 'retry_initial_connect',
    });
    setJoinAttemptNonce((n) => n + 1);
  }, [
    clearFirstConnectWatchdog,
    detachCallListeners,
    eventId,
    peerMissingTerminal,
    releaseSharedCallIfOwned,
    sessionId,
  ]);

  useEffect(() => {
    const userId = user?.id ?? null;
    const currentPhase = phaseRef.current;
    const initialGuard = {
      hasSessionId: Boolean(sessionId),
      hasUserId: Boolean(userId),
      hasSession: Boolean(session),
      sessionEnded: Boolean(session?.ended_at),
      joining,
      hasCall: Boolean(callRef.current),
      hasStartedJoin: hasStartedJoinRef.current,
      sessionError: sessionError ?? null,
      phase: currentPhase,
    };
    vdbg('prejoin_step_prejoin_effect_fired', {
      sessionId: sessionId ?? null,
      userId,
      ...initialGuard,
    });
    if (
      !sessionId ||
      !user?.id ||
      !session ||
      session.ended_at ||
      (joining && hasStartedJoinRef.current) ||
      callRef.current ||
      hasStartedJoinRef.current
    ) {
      const existingCall = callRef.current;
      if (
        existingCall &&
        sessionId &&
        user?.id &&
        session &&
        !session.ended_at &&
        (boundCallRef.current !== existingCall || !boundHandlersRef.current)
      ) {
        bindCallListeners(existingCall, roomNameRef.current);
      }
      vdbg('prejoin_step_prejoin_truth_skipped_or_started', {
        sessionId: sessionId ?? null,
        userId,
        started: false,
        reason: 'initial_guard',
        ...initialGuard,
      });
      return;
    }
    if (sessionError || currentPhase === 'ended') {
      vdbg('prejoin_step_prejoin_truth_skipped_or_started', {
        sessionId,
        userId,
        started: false,
        reason: 'session_error_or_ended_phase',
        sessionError: sessionError ?? null,
        phase: currentPhase,
      });
      return;
    }

    hasStartedJoinRef.current = true;
    vdbg('prejoin_state_hasStartedJoinRef', { value: true, sessionId, userId: user.id });
    let cancelled = false;
    let prejoinCompleted = false;
    let currentStep = 'effect_started';
    const run = async () => {
      currentStep = 'initial_state';
      vdbg('prejoin_state_joining', { value: true, sessionId, userId: user.id, step: currentStep });
      setJoining(true);
      vdbg('prejoin_state_callError', { value: null, sessionId, userId: user.id, step: currentStep });
      setCallError(null);
      vdbg('prejoin_state_preJoinFailed', { value: false, sessionId, userId: user.id, step: currentStep });
      setPreJoinFailed(false);
      vdbg('prejoin_state_awaitingFirstConnect', { value: false, sessionId, userId: user.id, step: currentStep });
      setAwaitingFirstConnect(false);
      clearFirstConnectWatchdog();
      const sharedCall = sharedDailyCallEntry;
      if (sharedCall && sharedCall.sessionId === sessionId) {
        const reusedCall = sharedCall.call;
        let participants: ReturnType<DailyCallObject['participants']> | null = null;
        try {
          participants = reusedCall.participants();
        } catch {
          releaseSharedCallIfOwned(reusedCall, 'reuse_probe_failed');
          participants = null;
        }
        const local = participants?.local ?? null;
        if (!participants || !local) {
          releaseSharedCallIfOwned(reusedCall, 'reuse_probe_not_joined');
        } else {
          callRef.current = reusedCall;
          roomNameRef.current = sharedCall.roomName;
          bindCallListeners(reusedCall, sharedCall.roomName);
          const remotes = Object.values(participants).filter((p) => !(p as unknown as { local?: boolean }).local);
          vdbg('daily_call_singleton_reuse_same_session', {
            sessionId,
            userId: user.id,
            roomName: sharedCall.roomName,
            remoteCount: remotes.length,
            hasLocalParticipant: true,
          });
          setLocalInDailyRoom(true);
          setLocalParticipant(local as DailyParticipant | null);
          applyLocalMediaUiFromParticipant(local as DailyParticipant, { setIsVideoOff, setIsMuted });
          if (remotes.length > 0) {
            setRemoteParticipant(remotes[0] as DailyParticipant);
            setPartnerEverJoined(true);
            setAwaitingFirstConnect(false);
          } else {
            setRemoteParticipant(null);
            setAwaitingFirstConnect(true);
          }
          setIsConnecting(false);
          setJoining(false);
          prejoinCompleted = true;
          return;
        }
      }

      currentStep = 'permissions';
      const ok = await requestPermissions();
      if (!ok || cancelled) {
        vdbg('prejoin_step_prejoin_error', {
          sessionId,
          userId: user.id,
          step: currentStep,
          reason: cancelled ? 'cancelled_after_permissions' : 'permissions_denied',
          permissionsOk: ok,
          cancelled,
        });
        vdbg('prejoin_step_prejoin_daily_room_skipped', {
          sessionId,
          userId: user.id,
          reason: cancelled ? 'cancelled_after_permissions' : 'permissions_denied',
        });
        if (!ok && !cancelled) {
          vdbg('prejoin_state_callError', {
            value: 'Camera and microphone access are required for video dates.',
            sessionId,
            userId: user.id,
            step: currentStep,
          });
          setCallError('Camera and microphone access are required for video dates.');
        }
        hasStartedJoinRef.current = false;
        vdbg('prejoin_state_hasStartedJoinRef', { value: false, sessionId, userId: user.id, step: currentStep });
        vdbg('prejoin_state_joining', { value: false, sessionId, userId: user.id, step: currentStep });
        setJoining(false);
        prejoinCompleted = !cancelled;
        return;
      }

      currentStep = 'truth_fetch';
      vdbg('prejoin_step_prejoin_truth_skipped_or_started', {
        sessionId,
        userId: user.id,
        started: true,
        reason: null,
      });
      const truth0 = await fetchVideoSessionDateEntryTruth(sessionId);
      if (cancelled) {
        vdbg('prejoin_step_prejoin_error', {
          sessionId,
          userId: user.id,
          step: currentStep,
          reason: 'cancelled_after_truth_fetch',
        });
        vdbg('prejoin_step_prejoin_daily_room_skipped', {
          sessionId,
          userId: user.id,
          reason: 'cancelled_after_truth_fetch',
        });
        hasStartedJoinRef.current = false;
        vdbg('prejoin_state_hasStartedJoinRef', { value: false, sessionId, userId: user.id, step: currentStep });
        vdbg('prejoin_state_joining', { value: false, sessionId, userId: user.id, step: currentStep });
        setJoining(false);
        return;
      }
      vdbg('date_prejoin_truth_row', { sessionId, userId: user.id, row: truth0 ?? null });
      if (!truth0) {
        vdbg('prejoin_step_prejoin_error', {
          sessionId,
          userId: user.id,
          step: currentStep,
          reason: 'session_row_missing',
        });
        vdbg('prejoin_step_prejoin_daily_room_skipped', {
          sessionId,
          userId: user.id,
          reason: 'session_row_missing',
        });
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'enter_handshake_fail', {
          session_id: sessionId,
          user_id: user?.id ?? null,
          reason: 'session_row_missing',
        });
        vdbg('prejoin_state_callError', {
          value: "We couldn't open this date. Go back and try again.",
          sessionId,
          userId: user.id,
          step: currentStep,
        });
        setCallError("We couldn't open this date. Go back and try again.");
        hasStartedJoinRef.current = false;
        vdbg('prejoin_state_hasStartedJoinRef', { value: false, sessionId, userId: user.id, step: currentStep });
        vdbg('prejoin_state_joining', { value: false, sessionId, userId: user.id, step: currentStep });
        setJoining(false);
        prejoinCompleted = true;
        return;
      }
      if (truth0.ended_at) {
        vdbg('prejoin_step_prejoin_error', {
          sessionId,
          userId: user.id,
          step: currentStep,
          reason: 'session_ended_prejoin',
          endedAt: truth0.ended_at,
        });
        vdbg('prejoin_step_prejoin_daily_room_skipped', {
          sessionId,
          userId: user.id,
          reason: 'session_ended_prejoin',
          endedAt: truth0.ended_at,
        });
        if (truth0.event_id) {
          const target = eventLobbyHref(truth0.event_id as string);
          vdbgRedirect(target, 'session_ended_prejoin', {
            sessionId,
            userId: user.id,
            eventId: truth0.event_id,
            endedAt: truth0.ended_at,
          });
          router.replace(target);
        } else {
          const target = tabsRootHref();
          vdbgRedirect(target, 'session_ended_prejoin', {
            sessionId,
            userId: user.id,
            endedAt: truth0.ended_at,
          });
          router.replace(target);
        }
        hasStartedJoinRef.current = false;
        vdbg('prejoin_state_hasStartedJoinRef', { value: false, sessionId, userId: user.id, step: currentStep });
        vdbg('prejoin_state_joining', { value: false, sessionId, userId: user.id, step: currentStep });
        setJoining(false);
        prejoinCompleted = true;
        return;
      }

      currentStep = 'handshake_guard';
      const hasHandshakeStarted = !!truth0.handshake_started_at;
      const indicatesHandshakeOrDate = videoSessionIndicatesHandshakeOrDate(truth0);
      const handshakeAlready = hasHandshakeStarted;
      vdbg('prejoin_step_prejoin_handshake_guard', {
        sessionId,
        userId: user.id,
        hasHandshakeStarted,
        indicatesHandshakeOrDate,
        handshakeAlready,
        willCallEnterHandshake: !handshakeAlready,
        skipReason: handshakeAlready ? 'canonical_handshake_started_at' : 'not_started',
        state: truth0.state,
        phase: truth0.phase,
        endedAt: truth0.ended_at ?? null,
      });

      if (!handshakeAlready) {
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'enter_handshake_start', {
          session_id: sessionId,
          user_id: user?.id ?? null,
          event_id: truth0.event_id,
          vs_state: truth0.state,
          vs_phase: truth0.phase,
        });
        let hs;
        try {
          currentStep = 'enter_handshake';
          videoDateDailyDiagnostic('enter_handshake_start', { session_id: sessionId });
          vdbg('prejoin_step_prejoin_enter_handshake_before', {
            sessionId,
            userId: user.id,
            attempt: 1,
            timeoutMs: PREJOIN_STEP_TIMEOUT_MS,
          });
          hs = await enterHandshakeWithTimeout(sessionId, PREJOIN_STEP_TIMEOUT_MS);
          vdbg('prejoin_step_prejoin_enter_handshake_after', {
            sessionId,
            userId: user.id,
            attempt: 1,
            ok: hs.ok,
            code: hs.ok ? null : hs.code ?? null,
            message: hs.ok ? null : hs.message ?? null,
          });
          if (!hs.ok && isReadyGateRace(hs.code)) {
            await new Promise((resolve) => setTimeout(resolve, 700));
            vdbg('prejoin_step_prejoin_enter_handshake_before', {
              sessionId,
              userId: user.id,
              attempt: 2,
              timeoutMs: PREJOIN_STEP_TIMEOUT_MS,
              retryDelayMs: 700,
              previousCode: hs.code ?? null,
            });
            hs = await enterHandshakeWithTimeout(sessionId, PREJOIN_STEP_TIMEOUT_MS);
            vdbg('prejoin_step_prejoin_enter_handshake_after', {
              sessionId,
              userId: user.id,
              attempt: 2,
              ok: hs.ok,
              code: hs.ok ? null : hs.code ?? null,
              message: hs.ok ? null : hs.message ?? null,
            });
          }
        } catch (error) {
          const timedOut = error instanceof VideoDateRequestTimeoutError;
          vdbg('prejoin_step_prejoin_enter_handshake_after', {
            sessionId,
            userId: user.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            timedOut,
          });
          vdbg('prejoin_step_prejoin_error', {
            sessionId,
            userId: user.id,
            step: currentStep,
            reason: timedOut ? 'enter_handshake_timeout' : 'enter_handshake_exception',
          });
          vdbg('prejoin_step_prejoin_daily_room_skipped', {
            sessionId,
            userId: user.id,
            reason: timedOut ? 'enter_handshake_timeout' : 'enter_handshake_exception',
          });
          videoDateDailyDiagnostic('enter_handshake_failure', {
            session_id: sessionId,
            reason: timedOut ? 'timeout' : 'exception',
          });
          rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'enter_handshake_fail', {
            session_id: sessionId,
            user_id: user?.id ?? null,
            reason: timedOut ? 'timeout' : 'exception',
          });
          if (!cancelled) {
            vdbg('prejoin_state_callError', {
              value: timedOut
                ? 'Still setting up your date. Please retry.'
                : 'Could not start video. Please try again.',
              sessionId,
              userId: user.id,
              step: currentStep,
            });
            setCallError(
              timedOut
                ? 'Still setting up your date. Please retry.'
                : 'Could not start video. Please try again.'
            );
            vdbg('prejoin_state_preJoinFailed', { value: true, sessionId, userId: user.id, step: currentStep });
            setPreJoinFailed(true);
            vdbg('prejoin_state_isConnecting', { value: false, sessionId, userId: user.id, step: currentStep });
            setIsConnecting(false);
          }
          hasStartedJoinRef.current = false;
          vdbg('prejoin_state_hasStartedJoinRef', { value: false, sessionId, userId: user.id, step: currentStep });
          vdbg('prejoin_state_joining', { value: false, sessionId, userId: user.id, step: currentStep });
          setJoining(false);
          prejoinCompleted = !cancelled;
          return;
        }
        if (cancelled) {
          vdbg('prejoin_step_prejoin_error', {
            sessionId,
            userId: user.id,
            step: currentStep,
            reason: 'cancelled_after_enter_handshake',
          });
          vdbg('prejoin_step_prejoin_daily_room_skipped', {
            sessionId,
            userId: user.id,
            reason: 'cancelled_after_enter_handshake',
          });
          hasStartedJoinRef.current = false;
          vdbg('prejoin_state_hasStartedJoinRef', { value: false, sessionId, userId: user.id, step: currentStep });
          vdbg('prejoin_state_joining', { value: false, sessionId, userId: user.id, step: currentStep });
          setJoining(false);
          return;
        }
        if (!hs.ok) {
          if (isReadyGateRace(hs.code)) {
            const redirected = await recoverFromNotStartableDateTruth('enter_handshake');
            if (redirected) {
              hasStartedJoinRef.current = false;
              vdbg('prejoin_state_hasStartedJoinRef', { value: false, sessionId, userId: user.id, step: currentStep });
              vdbg('prejoin_state_joining', { value: false, sessionId, userId: user.id, step: currentStep });
              setJoining(false);
              prejoinCompleted = true;
              return;
            }
          }
          vdbg('prejoin_step_prejoin_error', {
            sessionId,
            userId: user.id,
            step: currentStep,
            reason: 'enter_handshake_not_ok',
            code: hs.code ?? null,
            message: hs.message ?? null,
          });
          vdbg('prejoin_step_prejoin_daily_room_skipped', {
            sessionId,
            userId: user.id,
            reason: 'enter_handshake_not_ok',
            code: hs.code ?? null,
          });
          videoDateDailyDiagnostic('enter_handshake_failure', {
            session_id: sessionId,
            code: hs.code != null ? String(hs.code) : 'unknown',
          });
          rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'enter_handshake_fail', {
            session_id: sessionId,
            user_id: user?.id ?? null,
            code: hs.code != null ? String(hs.code) : 'unknown',
          });
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
          vdbg('prejoin_state_callError', {
            value: userMessageForHandshakeFailure(hs.code),
            sessionId,
            userId: user.id,
            step: currentStep,
          });
          setCallError(userMessageForHandshakeFailure(hs.code));
          vdbg('prejoin_state_preJoinFailed', { value: true, sessionId, userId: user.id, step: currentStep });
          setPreJoinFailed(true);
          hasStartedJoinRef.current = false;
          vdbg('prejoin_state_hasStartedJoinRef', { value: false, sessionId, userId: user.id, step: currentStep });
          vdbg('prejoin_state_joining', { value: false, sessionId, userId: user.id, step: currentStep });
          setJoining(false);
          prejoinCompleted = true;
          return;
        }
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'enter_handshake_ok', {
          session_id: sessionId,
          user_id: user?.id ?? null,
          event_id: truth0.event_id,
          vs_state: truth0.state,
          vs_phase: truth0.phase,
        });
        videoDateDailyDiagnostic('enter_handshake_success', { session_id: sessionId });
      } else {
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'enter_handshake_skipped', {
          session_id: sessionId,
          user_id: user?.id ?? null,
          event_id: truth0.event_id,
          reason: 'handshake_already_started',
        });
        videoDateDailyDiagnostic('enter_handshake_skipped', {
          session_id: sessionId,
          note: 'handshake_already_started',
        });
        vdbg('prejoin_step_prejoin_enter_handshake_skipped', {
          sessionId,
          userId: user.id,
          reason: 'handshake_already_started',
          hasHandshakeStarted,
          indicatesHandshakeOrDate,
          state: truth0.state,
          phase: truth0.phase,
        });
      }

      currentStep = 'refetch_video_session';
      vdbg('prejoin_step_prejoin_refetch_before', { sessionId, userId: user.id });
      await refetchVideoSession();
      vdbg('prejoin_step_prejoin_refetch_after', { sessionId, userId: user.id, ok: true });
      if (cancelled) {
        vdbg('prejoin_step_prejoin_cancelled', {
          sessionId,
          userId: user.id,
          step: currentStep,
          reason: 'effect_cancelled_post_refetch',
          preserveStartedJoin: true,
        });
        vdbg('prejoin_step_prejoin_daily_room_cancelled', {
          sessionId,
          userId: user.id,
          reason: 'effect_cancelled_post_refetch',
          preserveStartedJoin: true,
        });
        vdbg('prejoin_state_joining', { value: false, sessionId, userId: user.id, step: currentStep });
        setJoining(false);
        return;
      }

      currentStep = 'daily_room_guard';
      vdbg('prejoin_step_prejoin_daily_room_guard', {
        sessionId,
        userId: user.id,
        cancelled,
        hasSessionId: Boolean(sessionId),
        hasTruthRow: Boolean(truth0),
        timeoutMs: PREJOIN_STEP_TIMEOUT_MS,
        willCallDailyRoom: !cancelled,
      });
      let tokenRes;
      try {
        currentStep = 'daily_room';
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'create_date_room_start', {
          session_id: sessionId,
          user_id: user?.id ?? null,
          event_id: truth0.event_id,
          vs_state: truth0.state,
          vs_phase: truth0.phase,
        });
        videoDateDailyDiagnostic('token_fetch_start', { session_id: sessionId });
        vdbg('prejoin_step_prejoin_daily_room_before', {
          sessionId,
          userId: user.id,
          timeoutMs: PREJOIN_STEP_TIMEOUT_MS,
        });
        tokenRes = await getDailyRoomTokenWithTimeout(sessionId, PREJOIN_STEP_TIMEOUT_MS);
        vdbg('prejoin_step_prejoin_daily_room_after', {
          sessionId,
          userId: user.id,
          ok: tokenRes.ok,
          code: tokenRes.ok ? null : tokenRes.code ?? null,
          httpStatus: tokenRes.ok ? null : tokenRes.httpStatus ?? null,
          serverCode: tokenRes.ok ? null : tokenRes.serverCode ?? null,
          roomName: tokenRes.ok ? tokenRes.data.room_name : null,
          hasToken: tokenRes.ok ? Boolean(tokenRes.data.token) : false,
        });
      } catch (error) {
        const timedOut = error instanceof VideoDateRequestTimeoutError;
        vdbg('prejoin_step_prejoin_daily_room_after', {
          sessionId,
          userId: user.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          timedOut,
        });
        vdbg('prejoin_step_prejoin_error', {
          sessionId,
          userId: user.id,
          step: currentStep,
          reason: timedOut ? 'daily_room_timeout' : 'daily_room_exception',
        });
        videoDateDailyDiagnostic('token_fetch_failure', {
          session_id: sessionId,
          reason: timedOut ? 'timeout' : 'exception',
        });
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'create_date_room_fail', {
          session_id: sessionId,
          user_id: user?.id ?? null,
          reason: timedOut ? 'timeout' : 'exception',
        });
        if (!cancelled) {
          vdbg('prejoin_state_preJoinFailed', { value: true, sessionId, userId: user.id, step: currentStep });
          setPreJoinFailed(true);
          vdbg('prejoin_state_callError', {
            value: timedOut
              ? 'Still setting up your date. Please retry.'
              : 'Could not start video. Please try again.',
            sessionId,
            userId: user.id,
            step: currentStep,
          });
          setCallError(
            timedOut
              ? 'Still setting up your date. Please retry.'
              : 'Could not start video. Please try again.'
          );
          vdbg('prejoin_state_isConnecting', { value: false, sessionId, userId: user.id, step: currentStep });
          setIsConnecting(false);
        }
        hasStartedJoinRef.current = false;
        vdbg('prejoin_state_hasStartedJoinRef', { value: false, sessionId, userId: user.id, step: currentStep });
        vdbg('prejoin_state_joining', { value: false, sessionId, userId: user.id, step: currentStep });
        setJoining(false);
        prejoinCompleted = !cancelled;
        return;
      }
      if (cancelled) {
        vdbg('prejoin_step_prejoin_error', {
          sessionId,
          userId: user.id,
          step: currentStep,
          reason: 'cancelled_after_daily_room',
        });
        vdbg('prejoin_step_prejoin_daily_room_skipped', {
          sessionId,
          userId: user.id,
          reason: 'cancelled_after_daily_room',
        });
        hasStartedJoinRef.current = false;
        vdbg('prejoin_state_hasStartedJoinRef', { value: false, sessionId, userId: user.id, step: currentStep });
        vdbg('prejoin_state_joining', { value: false, sessionId, userId: user.id, step: currentStep });
        setJoining(false);
        return;
      }
      if (!tokenRes.ok) {
        if (tokenRes.code === 'ready_gate_required') {
          const redirected = await recoverFromNotStartableDateTruth('create_date_room');
          if (redirected) {
            hasStartedJoinRef.current = false;
            vdbg('prejoin_state_hasStartedJoinRef', { value: false, sessionId, userId: user.id, step: currentStep });
            vdbg('prejoin_state_joining', { value: false, sessionId, userId: user.id, step: currentStep });
            setJoining(false);
            prejoinCompleted = true;
            return;
          }
        }
        vdbg('prejoin_step_prejoin_error', {
          sessionId,
          userId: user.id,
          step: currentStep,
          reason: 'daily_room_not_ok',
          code: tokenRes.code ?? null,
          httpStatus: tokenRes.httpStatus ?? null,
          serverCode: tokenRes.serverCode ?? null,
        });
        videoDateDailyDiagnostic('token_fetch_failure', {
          session_id: sessionId,
          code: String(tokenRes.code),
          http_status: tokenRes.httpStatus ?? null,
          server_code: tokenRes.serverCode != null ? String(tokenRes.serverCode) : null,
        });
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'create_date_room_fail', {
          session_id: sessionId,
          code: String(tokenRes.code),
          http_status: tokenRes.httpStatus ?? null,
        });
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
        vdbg('prejoin_state_callError', {
          value: userMessageForTokenFailure(tokenRes.code),
          sessionId,
          userId: user.id,
          step: currentStep,
        });
        setCallError(userMessageForTokenFailure(tokenRes.code));
        hasStartedJoinRef.current = false;
        vdbg('prejoin_state_hasStartedJoinRef', { value: false, sessionId, userId: user.id, step: currentStep });
        vdbg('prejoin_state_joining', { value: false, sessionId, userId: user.id, step: currentStep });
        setJoining(false);
        prejoinCompleted = true;
        return;
      }

      const tokenResult = tokenRes.data;
      rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'create_date_room_ok', {
        session_id: sessionId,
        user_id: user?.id ?? null,
        room_name: tokenResult.room_name,
      });
      videoDateDailyDiagnostic('token_fetch_success', {
        session_id: sessionId,
        room_name: tokenResult.room_name,
      });

      if (sharedDailyCallEntry && sharedDailyCallEntry.sessionId !== sessionId) {
        vdbg('daily_call_singleton_destroy_previous_session', {
          previousSessionId: sharedDailyCallEntry.sessionId,
          nextSessionId: sessionId,
          roomName: sharedDailyCallEntry.roomName,
        });
        try {
          await sharedDailyCallEntry.call.leave();
        } catch {
          /* best effort */
        }
        try {
          sharedDailyCallEntry.call.destroy();
        } catch {
          /* best effort */
        }
        sharedDailyCallEntry = null;
      }

      const call = Daily.createCallObject();
      sharedDailyCallEntry = {
        sessionId,
        call,
        roomName: tokenResult.room_name,
      };
      vdbg('daily_call_singleton_create', {
        sessionId,
        userId: user.id,
        roomName: tokenResult.room_name,
      });
      callRef.current = call;
      roomNameRef.current = tokenResult.room_name;
      vdbg('prejoin_state_isConnecting', {
        value: true,
        sessionId,
        userId: user.id,
        step: 'daily_call_object_created',
        roomName: tokenResult.room_name,
      });
      setIsConnecting(true);

      bindCallListeners(call, tokenResult.room_name);

      try {
        currentStep = 'daily_join';
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'daily_join_start', {
          session_id: sessionId,
          user_id: user?.id ?? null,
          room_name: tokenResult.room_name,
        });
        videoDateDailyDiagnostic('daily_call_join_start', {
          session_id: sessionId,
          room_name: tokenResult.room_name,
        });
        Sentry.addBreadcrumb({ category: 'video-date', message: 'Joining call', level: 'info', data: { sessionId } });
        vdbg('prejoin_step_prejoin_daily_join_before', {
          sessionId,
          userId: user.id,
          roomName: tokenResult.room_name,
          hasRoomUrl: Boolean(tokenResult.room_url),
          hasToken: Boolean(tokenResult.token),
        });
        await call.join({ url: tokenResult.room_url, token: tokenResult.token });
        vdbg('prejoin_step_prejoin_daily_join_after', {
          sessionId,
          userId: user.id,
          ok: true,
          cancelled,
          roomName: tokenResult.room_name,
        });
        if (cancelled) return;
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'daily_join_ok', {
          session_id: sessionId,
          user_id: user?.id ?? null,
          room_name: tokenResult.room_name,
        });
        const participants = call.participants();
        const allIds = participants
          ? Object.keys(participants).length
          : 0;
        const remotes = participants
          ? Object.values(participants).filter((p) => !(p as unknown as { local?: boolean }).local)
          : [];
        videoDateDailyDiagnostic('daily_call_join_success', {
          session_id: sessionId,
          room_name: tokenResult.room_name,
          participant_keys_count: allIds,
          remote_count: remotes.length,
        });
        vdbg('prejoin_state_localInDailyRoom', {
          value: true,
          sessionId,
          userId: user.id,
          step: currentStep,
          roomName: tokenResult.room_name,
        });
        setLocalInDailyRoom(true);
        if (__DEV__) {
          vdbg('mark_video_date_daily_joined_before', { sessionId, userId: user.id });
        }
        void markVideoDateDailyJoined(sessionId)
          .then((ok) => {
            if (__DEV__) {
              vdbg('mark_video_date_daily_joined_after', { sessionId, userId: user.id, ok });
            }
            if (ok) void refetchVideoSession();
          })
          .catch((err) => {
            if (__DEV__) {
              vdbg('mark_video_date_daily_joined_error', {
                sessionId,
                userId: user.id,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          });
        const local = participants?.local;
        if (local) {
          setLocalParticipant(local);
          applyLocalMediaUiFromParticipant(local, { setIsVideoOff, setIsMuted });
        }
        vdbg('prejoin_state_isConnecting', {
          value: false,
          sessionId,
          userId: user.id,
          step: currentStep,
          roomName: tokenResult.room_name,
        });
        setIsConnecting(false);
        if (remotes.length > 0) {
          clearFirstConnectWatchdog();
          vdbg('prejoin_state_awaitingFirstConnect', {
            value: false,
            sessionId,
            userId: user.id,
            step: currentStep,
            remoteCount: remotes.length,
          });
          setAwaitingFirstConnect(false);
          setPartnerEverJoined(true);
          setRemoteParticipant(remotes[0] as DailyParticipant);
          videoDateDailyDiagnostic('first_remote_observed', {
            session_id: sessionId,
            room_name: tokenResult.room_name,
            source: 'post_join_snapshot',
          });
          videoDateDailyDiagnostic('remote_participant_promoted_from_post_join_snapshot', {
            session_id: sessionId,
            room_name: tokenResult.room_name,
            participant_id: dailyParticipantId(remotes[0] as DailyParticipant) ?? 'unknown',
          });
        } else {
          vdbg('prejoin_state_awaitingFirstConnect', {
            value: true,
            sessionId,
            userId: user.id,
            step: currentStep,
            remoteCount: remotes.length,
          });
          setAwaitingFirstConnect(true);
        }
      } catch (err) {
        vdbg('prejoin_step_prejoin_daily_join_after', {
          sessionId,
          userId: user.id,
          ok: false,
          roomName: tokenResult.room_name,
          error: err instanceof Error ? err.message : String(err),
        });
        vdbg('prejoin_step_prejoin_error', {
          sessionId,
          userId: user.id,
          step: currentStep,
          reason: 'daily_join_exception',
        });
        videoDateDailyDiagnostic('daily_call_join_failure', {
          session_id: sessionId,
          room_name: tokenResult.room_name,
        });
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'daily_join_fail', {
          session_id: sessionId,
          user_id: user?.id ?? null,
          room_name: tokenResult.room_name,
        });
        if (!cancelled) {
          Sentry.captureException(err, { extra: { sessionId } });
          vdbg('prejoin_state_callError', {
            value: 'Failed to join. Please try again.',
            sessionId,
            userId: user.id,
            step: currentStep,
          });
          setCallError('Failed to join. Please try again.');
          vdbg('prejoin_state_preJoinFailed', { value: true, sessionId, userId: user.id, step: currentStep });
          setPreJoinFailed(true);
          clearFirstConnectWatchdog();
          vdbg('prejoin_state_awaitingFirstConnect', { value: false, sessionId, userId: user.id, step: currentStep });
          setAwaitingFirstConnect(false);
          vdbg('prejoin_state_isConnecting', { value: false, sessionId, userId: user.id, step: currentStep });
          setIsConnecting(false);
          hasStartedJoinRef.current = false;
          vdbg('prejoin_state_hasStartedJoinRef', { value: false, sessionId, userId: user.id, step: currentStep });
        }
        prejoinCompleted = !cancelled;
      }

      vdbg('prejoin_state_joining', { value: false, sessionId, userId: user.id, step: currentStep });
      setJoining(false);
      prejoinCompleted = true;
    };

    run();
    return () => {
      if (callRef.current) {
        vdbg('daily_call_listeners_preserved', {
          reason: 'prejoin_effect_cleanup_live_call',
          sessionId,
          userId: user?.id ?? null,
          hasBoundCall: Boolean(boundCallRef.current),
          sameCall: boundCallRef.current === callRef.current,
        });
      } else {
        detachCallListeners('prejoin_effect_cleanup');
      }
      if (!prejoinCompleted) {
        vdbg('prejoin_step_prejoin_effect_cleanup', {
          sessionId,
          userId: user?.id ?? null,
          currentStep,
          hasCall: Boolean(callRef.current),
          hasStartedJoin: hasStartedJoinRef.current,
        });
      }
      cancelled = true;
      if (!callRef.current) {
        hasStartedJoinRef.current = false;
        vdbg('prejoin_state_hasStartedJoinRef', {
          value: false,
          sessionId,
          userId: user?.id ?? null,
          step: 'cleanup_without_call',
        });
      }
    };
  }, [
    joinAttemptNonce,
    sessionId,
    user?.id,
    session?.id,
    session?.ended_at,
    sessionError,
    requestPermissions,
    clearFirstConnectWatchdog,
    bindCallListeners,
    releaseSharedCallIfOwned,
    detachCallListeners,
    refetchVideoSession,
    recoverFromNotStartableDateTruth,
  ]);

  useEffect(() => {
    reconnectEndedHandledRef.current = false;
    loggedJourneyRef.current.clear();
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !user?.id || showFeedback) return;
    const isTerminalSession =
      phase === 'ended' ||
      !!session?.ended_at ||
      session?.state === 'ended' ||
      session?.phase === 'ended';
    if (!isTerminalSession) return;
    let cancelled = false;
    void (async () => {
      const [{ data: reg }, { data: verdict }] = await Promise.all([
        supabase
          .from('event_registrations')
          .select('queue_status')
          .eq('profile_id', user.id)
          .eq('current_room_id', sessionId)
          .maybeSingle(),
        supabase
          .from('date_feedback')
          .select('id')
          .eq('session_id', sessionId)
          .eq('user_id', user.id)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      const reconnectExpiredSurveyDue =
        session?.ended_reason === 'reconnect_grace_expired' &&
        Boolean(session?.date_started_at) &&
        !verdict;
      if (reg?.queue_status === 'in_survey' || reconnectExpiredSurveyDue) {
        dateEstablishedRef.current = true;
        logJourney('date_route_recovered', { source: 'terminal_session_recovery' }, 'date_route_recovered');
        logJourney(
          'survey_recovered',
          { source: 'terminal_session_recovery', queue_status: reg?.queue_status ?? null, reconnectExpiredSurveyDue },
          'survey_recovered_terminal_session_recovery'
        );
        logJourney('survey_lost_prevented', { source: 'terminal_session_recovery' }, 'survey_lost_prevented');
        setShowFeedback(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, user?.id, showFeedback, phase, session?.ended_at, session?.state, session?.phase, logJourney]);

  /** Partner/backend ended session (realtime): show survey when we had joined the room; tear down Daily if still up. */
  useEffect(() => {
    if (phase !== 'ended' || !sessionId) return;
    clearHandshakeGraceState();
    if (!dateEstablishedRef.current) return;
    void handleCallEnd('server_end');
  }, [phase, sessionId, handleCallEnd, clearHandshakeGraceState]);

  useEffect(() => {
    if (phase === 'date') {
      clearHandshakeGraceState();
    }
  }, [phase, clearHandshakeGraceState]);

  useEffect(() => {
    if (
      localTimeLeft === null ||
      localTimeLeft <= 0 ||
      showFeedback ||
      !hasRemotePartner ||
      phase === 'ended' ||
      isTimerPaused ||
      // Pause base handshake timer while grace mode owns the countdown.
      (phase === 'handshake' && handshakeGraceSecondsRemaining !== null)
    )
      return;
    const interval = setInterval(() => {
      setLocalTimeLeft((prev) => {
        if (prev === null || prev <= 1) {
          if (phaseRef.current === 'handshake') {
            completeHandshake(sessionId!).then((result) => {
              if (phaseRef.current !== 'handshake') return;
              if (result?.state === 'date') {
                clearHandshakeGraceState();
                setShowMutualToast(true);
              } else if (result?.waiting_for_partner === true) {
                const graceExpiresAt =
                  typeof result.grace_expires_at === 'string'
                    ? result.grace_expires_at
                    : null;
                const serverSeconds =
                  typeof result.seconds_remaining === 'number' &&
                  Number.isFinite(result.seconds_remaining)
                    ? Math.max(0, Math.ceil(result.seconds_remaining))
                    : null;
                const derivedSeconds =
                  graceExpiresAt !== null
                    ? Math.max(0, Math.ceil((new Date(graceExpiresAt).getTime() - Date.now()) / 1000))
                    : null;
                setHandshakeGraceExpiresAt(graceExpiresAt);
                setHandshakeGraceSecondsRemaining(derivedSeconds ?? serverSeconds ?? 0);
                return;
              } else {
                clearHandshakeGraceState();
                handleCallEnd('local_end');
              }
            });
          } else {
            handleCallEnd('local_end');
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [
    localTimeLeft !== null,
    localTimeLeft,
    showFeedback,
    hasRemotePartner,
    phase,
    isTimerPaused,
    sessionId,
    handleCallEnd,
    handshakeGraceSecondsRemaining,
    clearHandshakeGraceState,
  ]);

  useEffect(() => {
    if (
      !sessionId ||
      phase !== 'handshake' ||
      showFeedback ||
      handshakeGraceSecondsRemaining === null ||
      handshakeGraceRetryTriggeredRef.current
    ) {
      return;
    }

    const interval = setInterval(() => {
      const derivedFromExpiry = handshakeGraceExpiresAt
        ? Math.max(0, Math.ceil((new Date(handshakeGraceExpiresAt).getTime() - Date.now()) / 1000))
        : null;
      const nextValue =
        derivedFromExpiry !== null
          ? derivedFromExpiry
          : Math.max(0, (handshakeGraceSecondsRemaining ?? 0) - 1);

      setHandshakeGraceSecondsRemaining(nextValue);

      if (nextValue <= 0 && !handshakeGraceRetryTriggeredRef.current) {
        if (phaseRef.current !== 'handshake') {
          clearHandshakeGraceState();
          return;
        }
        // One-shot guard prevents repeated force-retries in grace expiry race windows.
        handshakeGraceRetryTriggeredRef.current = true;
        void completeHandshake(sessionId).then((result) => {
          if (phaseRef.current !== 'handshake') return;
          if (result?.state === 'date') {
            clearHandshakeGraceState();
            setShowMutualToast(true);
            return;
          }
          if (result?.state === 'ended' || result?.already_ended) {
            clearHandshakeGraceState();
            void handleCallEnd('server_end');
          }
        });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [
    sessionId,
    phase,
    showFeedback,
    handshakeGraceExpiresAt,
    handshakeGraceSecondsRemaining,
    handleCallEnd,
    clearHandshakeGraceState,
  ]);

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

  const totalTime =
    phase === 'handshake'
      ? HANDSHAKE_SECONDS
      : effectiveDateDurationSeconds(DATE_SECONDS, session?.date_extra_seconds);
  const displayTimeLeft = localTimeLeft ?? totalTime;

  /** Local user is in Daily but server has no join stamp for the peer yet — distinct from reconnect / ambiguous absence. */
  const peerNotOpenedVideoDateYet = useMemo(
    () =>
      !!session &&
      !sessionLoading &&
      localInDailyRoom &&
      !hasRemotePartner &&
      !partnerEverJoined &&
      !peerMissingTerminal &&
      !isPartnerDisconnected &&
      peerServerJoinedAt == null,
    [
      session,
      sessionLoading,
      localInDailyRoom,
      hasRemotePartner,
      partnerEverJoined,
      peerMissingTerminal,
      isPartnerDisconnected,
      peerServerJoinedAt,
    ]
  );

  const postJoinStage: VideoDatePostJoinStage = useMemo(() => {
    if (sessionLoading || !sessionId) return 'initial_loading';
    if (phase === 'ended') return 'ended';
    if (peerMissingTerminal) return 'peer_missing_timeout';
    if (preJoinFailed && !localInDailyRoom) return 'fatal_join_error';
    if (joining || isConnecting) return 'joining_daily';
    if (localInDailyRoom && partnerEverJoined && isPartnerDisconnected && !hasRemotePartner) return 'reconnecting';
    if (localInDailyRoom && hasRemotePartner) return 'active_call';
    if (
      localInDailyRoom &&
      !hasRemotePartner &&
      !partnerEverJoined &&
      !peerMissingTerminal &&
      !isPartnerDisconnected
    )
      return 'waiting_for_peer';
    return 'joining_daily';
  }, [
    sessionLoading,
    sessionId,
    phase,
    peerMissingTerminal,
    preJoinFailed,
    localInDailyRoom,
    joining,
    isConnecting,
    partnerEverJoined,
    isPartnerDisconnected,
    hasRemotePartner,
  ]);

  useEffect(() => {
    const prev = lastLoggedPostJoinStageRef.current;
    if (prev === postJoinStage) return;
    videoDateDailyDiagnostic('post_join_stage_transition', {
      session_id: sessionId ?? '',
      from: prev ?? 'none',
      to: postJoinStage,
    });
    if (postJoinStage === 'active_call') {
      videoDateDailyDiagnostic('active_call_entered', {
        session_id: sessionId ?? '',
        room_name: roomNameRef.current ?? null,
      });
    }
    if (postJoinStage === 'reconnecting') {
      videoDateDailyDiagnostic('reconnecting_entered', { session_id: sessionId ?? '' });
    }
    if (prev === 'reconnecting' && postJoinStage === 'active_call') {
      videoDateDailyDiagnostic('reconnecting_exited', { session_id: sessionId ?? '' });
    }
    lastLoggedPostJoinStageRef.current = postJoinStage;
  }, [postJoinStage, sessionId]);

  const showTopBarWaitingPill =
    joining ||
    isConnecting ||
    (localInDailyRoom &&
      !hasRemotePartner &&
      !partnerEverJoined &&
      !peerMissingTerminal &&
      !isPartnerDisconnected);
  const showHandshakeGraceWait =
    phase === 'handshake' &&
    hasRemotePartner &&
    !peerMissingTerminal &&
    handshakeGraceSecondsRemaining !== null;

  const showJoiningOverlay = (joining || isConnecting) && !preJoinFailed && !peerMissingTerminal;
  const showPeerWaitOverlay =
    localInDailyRoom &&
    !hasRemotePartner &&
    !partnerEverJoined &&
    !peerMissingTerminal &&
    !isPartnerDisconnected &&
    !joining &&
    !isConnecting;

  const showHandshakeChrome =
    phase === 'handshake' &&
    hasRemotePartner &&
    !peerMissingTerminal &&
    handshakeGraceSecondsRemaining === null;
  const showDatePhaseChrome = phase === 'date' && hasRemotePartner;
  const phaseCueLabel = phase === 'handshake' ? 'HANDSHAKE' : phase === 'date' ? 'DATE LIVE' : null;

  const currentQuestion = vibeQuestions[currentQuestionIndex] ?? vibeQuestions[0] ?? '';
  const handshakeBottomOffset = insets.bottom + 96;

  useEffect(() => {
    topChromeAnim.setValue(0.92);
    controlsAnim.setValue(0.94);
    phaseCueAnim.setValue(0.9);
    Animated.parallel([
      Animated.timing(topChromeAnim, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(controlsAnim, {
        toValue: 1,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(phaseCueAnim, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [phase, postJoinStage, topChromeAnim, controlsAnim, phaseCueAnim]);

  const handlePeerMissingKeepWaiting = useCallback(() => {
    if (sessionId) {
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_PEER_MISSING_KEEP_WAITING_TAP, {
        platform: 'native',
        session_id: sessionId,
        event_id: eventId,
      });
    }
    setPeerMissingTerminal(false);
    vdbg('prejoin_state_callError', {
      value: null,
      sessionId: sessionId ?? null,
      userId: user?.id ?? null,
      step: 'peer_missing_keep_waiting',
    });
    setCallError(null);
    vdbg('prejoin_state_awaitingFirstConnect', {
      value: true,
      sessionId: sessionId ?? null,
      userId: user?.id ?? null,
      step: 'peer_missing_keep_waiting',
    });
    setAwaitingFirstConnect(true);
    videoDateDailyDiagnostic('peer_missing_keep_waiting', { session_id: sessionId ?? '' });
  }, [eventId, sessionId]);

  useEffect(() => {
    peerMissingTerminalImpressionRef.current = false;
  }, [sessionId]);

  useEffect(() => {
    if (!peerMissingTerminal || !sessionId) return;
    if (peerMissingTerminalImpressionRef.current) return;
    peerMissingTerminalImpressionRef.current = true;
    trackEvent(LobbyPostDateEvents.VIDEO_DATE_PEER_MISSING_TERMINAL_IMPRESSION, {
      platform: 'native',
      session_id: sessionId,
      event_id: eventId,
    });
  }, [eventId, peerMissingTerminal, sessionId]);

  const handleSurveySubmit = useCallback(
    (liked: boolean) =>
      submitVerdictAndCheckMutual(sessionId!, user!.id, partnerId, liked),
    [sessionId, user?.id, partnerId]
  );

  const handleSurveyMutualMatch = useCallback(() => {
    if (eventId) {
      const target = eventLobbyHref(eventId);
      vdbgRedirect(target, 'survey_mutual_match', { sessionId: sessionId ?? null, eventId });
      router.replace(target);
    } else {
      const target = '/(tabs)/matches';
      vdbgRedirect(target, 'survey_mutual_match', { sessionId: sessionId ?? null });
      router.replace(target);
    }
  }, [eventId, sessionId]);

  /** "Start Chatting" from celebration — chat route is keyed by partner profile id. */
  const handleSurveyStartChatting = useCallback((otherProfileId?: string) => {
    if (otherProfileId) {
      const target = `/chat/${otherProfileId}` as const;
      vdbgRedirect(target, 'survey_start_chatting', { sessionId: sessionId ?? null, otherProfileId });
      router.replace(target);
    } else {
      handleSurveyMutualMatch();
    }
  }, [handleSurveyMutualMatch, sessionId]);

  const handleSurveyDone = useCallback(() => {
    if (eventId && user?.id) updateParticipantStatus(eventId, 'browsing');
    if (eventId) {
      const target = eventLobbyHrefPostSurveyComplete(eventId);
      vdbgRedirect(target, 'survey_done', { sessionId: sessionId ?? null, eventId });
      router.replace(target);
    } else {
      const target = '/(tabs)/events';
      vdbgRedirect(target, 'survey_done', { sessionId: sessionId ?? null });
      router.replace(target);
    }
  }, [eventId, sessionId, user?.id]);

  if (sessionLoading || !sessionId) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.tint} />
        <Text style={[styles.message, { color: theme.text }]}>Joining your date...</Text>
      </View>
    );
  }

  if (sessionError) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <Text style={[styles.error, { color: theme.danger }]}>{sessionError}</Text>
        <Pressable
          style={[styles.button, { backgroundColor: theme.tint }]}
          onPress={() => {
            vdbgRedirect('back', 'session_error_back_button', { sessionId: sessionId ?? null, error: sessionError });
            router.back();
          }}
        >
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
        onStartChatting={handleSurveyStartChatting}
        onDone={handleSurveyDone}
      />
    );
  }

  if (phase === 'ended' && !isConnecting && !localInDailyRoom) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <Text style={[styles.message, { color: theme.text }]}>Date ended</Text>
        <Pressable
          style={[styles.button, { backgroundColor: theme.tint }]}
          onPress={() => {
            if (eventId) {
              const target = eventLobbyHref(eventId);
              vdbgRedirect(target, 'ended_continue', { sessionId: sessionId ?? null, eventId });
              router.replace(target);
            } else {
              const target = '/(tabs)/events';
              vdbgRedirect(target, 'ended_continue', { sessionId: sessionId ?? null });
              router.replace(target);
            }
          }}
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
              {showPeerWaitOverlay || showJoiningOverlay
                ? '…'
                : peerMissingTerminal
                  ? '—'
                  : peerNotOpenedVideoDateYet
                    ? `${partnerName} hasn't joined this screen yet`
                    : `${partnerName} will appear here`}
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

        {showJoiningOverlay && (
          <ConnectionOverlay mode="joining" onLeave={handleAbortConnection} />
        )}
        {showPeerWaitOverlay && (
          <ConnectionOverlay
            mode="waiting_peer"
            onLeave={handleAbortConnection}
            waitingPeerTitle={peerNotOpenedVideoDateYet ? "They haven't opened the date yet" : undefined}
            waitingPeerSubtitle={
              peerNotOpenedVideoDateYet
                ? 'Hang tight — your timer starts once they open this date on their phone.'
                : undefined
            }
          />
        )}

        {preJoinFailed && !localInDailyRoom && (
          <View style={styles.initialTimeoutWrap}>
            <View style={[styles.initialTimeoutCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.initialTimeoutTitle, { color: theme.text }]}>Could not start your date</Text>
              <Text style={[styles.initialTimeoutSub, { color: theme.mutedForeground }]}>
                {callError ?? 'Please retry, or head back to the lobby.'}
              </Text>
              <View style={styles.initialTimeoutActions}>
                <Pressable
                  onPress={() => void handleRetryInitialConnect()}
                  style={({ pressed }) => [styles.initialRetryBtn, { backgroundColor: theme.tint }, pressed && styles.initialBtnPressed]}
                >
                  <Text style={styles.initialRetryText}>Retry</Text>
                </Pressable>
                <Pressable
                  onPress={() => void handleAbortConnection()}
                  style={({ pressed }) => [styles.initialBackBtn, { borderColor: theme.border }, pressed && styles.initialBtnPressed]}
                >
                  <Text style={[styles.initialBackText, { color: theme.text }]}>Back to lobby</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}

        {peerMissingTerminal && (
          <View style={styles.initialTimeoutWrap}>
            <View style={[styles.initialTimeoutCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.initialTimeoutTitle, { color: theme.text }]}>
                Your match has not joined this video room yet.
              </Text>
              <Text style={[styles.initialTimeoutSub, { color: theme.mutedForeground }]}>
                We could not connect them in time. You can try again, keep waiting here, or go back to the lobby.
              </Text>
              <View style={styles.initialTimeoutActions}>
                <Pressable
                  onPress={() => void handleRetryInitialConnect()}
                  style={({ pressed }) => [styles.initialRetryBtn, { backgroundColor: theme.tint }, pressed && styles.initialBtnPressed]}
                >
                  <Text style={styles.initialRetryText}>Try again</Text>
                </Pressable>
                <Pressable
                  onPress={() => void handlePeerMissingKeepWaiting()}
                  style={({ pressed }) => [styles.initialBackBtn, { borderColor: theme.border }, pressed && styles.initialBtnPressed]}
                >
                  <Text style={[styles.initialBackText, { color: theme.text }]}>Keep waiting</Text>
                </Pressable>
                <Pressable
                  onPress={() => void handleAbortConnection({ source: 'peer_missing' })}
                  style={({ pressed }) => [styles.initialBackBtn, { borderColor: theme.border }, pressed && styles.initialBtnPressed]}
                >
                  <Text style={[styles.initialBackText, { color: theme.text }]}>Back to lobby</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}

      {isPartnerDisconnected && partnerEverJoined && (
        <ReconnectionOverlay isVisible partnerName={partnerName} graceTimeLeft={reconnectionGrace} />
      )}

      {showMutualToast && <MutualVibeToast onComplete={handleMutualToastComplete} />}

      <Animated.View
        style={[
          styles.topBar,
          {
            opacity: topChromeAnim,
            transform: [{ translateY: topChromeAnim.interpolate({ inputRange: [0.92, 1], outputRange: [-8, 0] }) }],
          },
        ]}
      >
        <Pressable onPress={() => setShowProfileSheet(true)} style={styles.partnerPill}>
          <Text style={[styles.partnerName, { color: theme.text }]}>{partnerName}</Text>
          {netQualityTier !== 'good' && hasRemotePartner ? (
            <Text
              style={[
                styles.netHint,
                { color: netQualityTier === 'poor' ? theme.danger : '#f59e0b' },
              ]}
            >
              {netQualityTier === 'poor' ? 'Poor connection' : 'Fair connection'}
            </Text>
          ) : null}
        </Pressable>
          {showTopBarWaitingPill ? (
            <View style={styles.waitingTimerPill}>
              <Text style={[styles.waitingTimerText, { color: theme.text }]}>
                {joining || isConnecting
                  ? 'Connecting...'
                  : peerNotOpenedVideoDateYet
                    ? "They haven't opened the date yet"
                    : 'Waiting for partner...'}
              </Text>
            </View>
          ) : showHandshakeGraceWait ? (
            <View style={styles.waitingTimerPill}>
              <Text style={[styles.waitingTimerText, { color: theme.text }]}>
                Waiting for your partner... {handshakeGraceSecondsRemaining}s
              </Text>
            </View>
          ) : hasRemotePartner ? (
            <HandshakeTimer timeLeft={Math.max(0, displayTimeLeft)} totalTime={totalTime} phase={phase} />
          ) : null}
      </Animated.View>

      {phaseCueLabel && hasRemotePartner ? (
        <Animated.View
          style={[
            styles.phaseCuePill,
            {
              opacity: phaseCueAnim,
              transform: [
                { translateY: phaseCueAnim.interpolate({ inputRange: [0.9, 1], outputRange: [-6, 0] }) },
                { scale: phaseCueAnim },
              ],
            },
          ]}
        >
          <Text style={styles.phaseCueText}>{phaseCueLabel}</Text>
        </Animated.View>
      ) : null}

      {showHandshakeChrome && (
        <View style={[styles.handshakeBottomStack, { bottom: handshakeBottomOffset }]}> 
          {showIceBreaker && currentQuestion ? (
            <IceBreakerCard
              question={currentQuestion}
              onDismiss={() => setShowIceBreaker(false)}
              onShuffle={() => setCurrentQuestionIndex((prev) => (prev + 1) % Math.max(1, vibeQuestions.length))}
            />
          ) : null}
          <VibeCheckButton timeLeft={displayTimeLeft} onVibe={handleUserVibe} />
        </View>
      )}

      {showDatePhaseChrome && (
        <Animated.View
          style={[styles.keepTheVibeWrap, { transform: [{ scale: keepVibePulse }] }]}
          accessibilityLiveRegion="polite"
        >
          <KeepTheVibe
            extraTimeCredits={credits.extraTime}
            extendedVibeCredits={credits.extendedVibe}
            onExtend={handleExtend}
            isExtending={isExtending}
            onGetCredits={() => router.push('/settings/credits')}
            analyticsSessionId={sessionId}
            analyticsEventId={eventId}
          />
        </Animated.View>
      )}

      {callError ? (
        <View style={[styles.errorBar, { backgroundColor: theme.danger }]}>
          <Text style={styles.errorBarText}>{callError}</Text>
        </View>
      ) : null}

      {extendBanner?.kind === 'success' && extendBanner.minutes != null ? (
        <View
          style={[
            styles.extendBanner,
            { backgroundColor: theme.tintSoft, borderColor: theme.tint },
          ]}
          accessibilityLiveRegion="polite"
        >
          <Text style={[styles.extendBannerText, { color: theme.text }]}>
            {extendBanner.minutes} extra minutes added!
          </Text>
        </View>
      ) : null}
      {extendBanner?.kind === 'error' ? (
        <View
          style={[
            styles.extendBanner,
            { backgroundColor: theme.dangerSoft, borderColor: theme.danger },
          ]}
          accessibilityLiveRegion="assertive"
        >
          <Text style={[styles.extendBannerText, { color: theme.text }]}>{extendBanner.message}</Text>
        </View>
      ) : null}

      <Animated.View
        style={[
          styles.controlsBar,
          {
            opacity: controlsAnim,
            transform: [{ translateY: controlsAnim.interpolate({ inputRange: [0.94, 1], outputRange: [10, 0] }) }],
          },
        ]}
      >
        <VideoDateControls
          isMuted={isMuted}
          isVideoOff={isVideoOff}
          onToggleMute={toggleMute}
          onToggleVideo={toggleVideo}
          onLeave={handleEndDateFromControls}
          onViewProfile={() => setShowProfileSheet(true)}
          onSafety={
            hasRemotePartner && partnerId && !showFeedback
              ? () => setShowInCallSafety(true)
              : undefined
          }
          onAddTime={phase === 'date' ? handleAddTimeShortcut : undefined}
          hasCredits={credits.extraTime > 0 || credits.extendedVibe > 0}
        />
      </Animated.View>

      <InCallSafetySheet
        visible={showInCallSafety}
        onClose={() => setShowInCallSafety(false)}
        reportedUserId={partnerId || null}
        onEndAfterReport={handleEndAfterInCallReport}
      />

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
  extendBanner: {
    position: 'absolute',
    top: 156,
    left: 16,
    right: 16,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  extendBannerText: { textAlign: 'center', fontSize: 14, fontWeight: '600' },
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
  waitingTimerPill: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.4)' },
  waitingTimerText: { fontSize: 12, fontWeight: '600' },
  phaseCuePill: {
    position: 'absolute',
    top: 92,
    right: 16,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  phaseCueText: { color: '#fff', fontSize: 10, letterSpacing: 0.4, fontWeight: '700' },
  initialTimeoutWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 55,
    paddingHorizontal: spacing.lg,
    backgroundColor: 'rgba(0,0,0,0.88)',
  },
  initialTimeoutCard: {
    width: '100%',
    maxWidth: 360,
    borderWidth: 1,
    borderRadius: 18,
    padding: spacing.lg,
    gap: spacing.md,
  },
  initialTimeoutTitle: { fontSize: 17, fontWeight: '700' },
  initialTimeoutSub: { fontSize: 14, lineHeight: 20 },
  initialTimeoutActions: { gap: spacing.sm },
  initialRetryBtn: { borderRadius: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  initialRetryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  initialBackBtn: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialBackText: { fontSize: 15, fontWeight: '600' },
  initialBtnPressed: { opacity: 0.85 },
  partnerPill: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.4)' },
  partnerName: { fontSize: 16, fontWeight: '600' },
  netHint: { fontSize: 11, marginTop: 2, fontWeight: '600' },
  handshakeBottomStack: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
    gap: spacing.sm,
  },
  keepTheVibeWrap: { position: 'absolute', top: 110, left: 16 },
  controlsBar: { position: 'absolute', bottom: 0, left: 0, right: 0 },
});
