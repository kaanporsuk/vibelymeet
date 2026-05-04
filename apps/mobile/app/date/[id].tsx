/**
 * Video date screen: full Vibely experience — warm-up phase (60s) with blur, vibe check,
 * mutual vibe → date (300s), controls, partner sheet, keep-the-vibe, reconnection, post-date survey.
 */

import 'react-native-get-random-values';
import * as Sentry from '@sentry/react-native';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Image,
  Pressable,
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  Animated,
  Dimensions,
  AppState,
  Alert,
  Easing,
  AccessibilityInfo,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, router, usePathname } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Camera } from 'expo-camera';
import { DailyMediaView } from '@daily-co/react-native-daily-js';
import type { DailyParticipant } from '@daily-co/react-native-daily-js';
import { useAuth } from '@/context/AuthContext';
import {
  useVideoDateSession,
  getDailyRoomTokenWithTimeout,
  enterHandshakeWithTimeout,
  VideoDateRequestTimeoutError,
  type RoomTokenFailureCode,
  endVideoDate,
  recordHandshakeDecision,
  completeHandshake,
  syncVideoDateReconnect,
  markReconnectPartnerAway,
  signalVideoDateLeave,
  markReconnectReturn,
  updateParticipantStatus,
  fetchPartnerProfile,
  advanceVibeQuestion,
  getOrSeedVibeQuestionState,
  submitVerdictAndCheckMutual,
  fetchUserCredits,
  spendVideoDateCreditExtension,
  HANDSHAKE_SECONDS,
  DATE_SECONDS,
  fetchVideoSessionDateEntryTruth,
  fetchVideoSessionDateEntryTruthCoalesced,
  type PartnerProfileData,
  type VibeQuestionState,
} from '@/lib/videoDateApi';
import {
  effectiveDateDurationSeconds,
  remainingDatePhaseSeconds,
  userMessageForExtensionSpendFailure,
  type VideoDateExtendOutcome,
} from '@clientShared/matching/videoDateExtensionSpend';
import {
  resolveVideoDatePhaseCountdown,
  startedAtCountdownDeadlineMs,
} from '@clientShared/matching/videoDateCountdown';
import { nextConvergenceDelayMs } from '@clientShared/matching/convergenceScheduling';
import {
  canAttemptDailyRoomFromVideoSessionTruth,
  decideVideoSessionRouteFromTruth,
  getVideoSessionPartnerIdForUser,
  videoSessionHasEncounterExposureTruth,
  videoSessionHasPostDateSurveyTruth,
  videoSessionRowIndicatesHandshakeOrDate,
} from '@clientShared/matching/activeSession';
import { handshakeDecisionFailureIndicatesSessionEnded } from '@clientShared/matching/videoDateHandshakePersistence';
import { VibeCheckButton } from '@/components/video-date/VibeCheckButton';
import { IceBreakerCard } from '@/components/video-date/IceBreakerCard';
import { HandshakeTimer } from '@/components/video-date/HandshakeTimer';
import { ConnectionOverlay } from '@/components/video-date/ConnectionOverlay';
import { VideoDateControls } from '@/components/video-date/VideoDateControls';
import { PartnerProfileSheet } from '@/components/video-date/PartnerProfileSheet';
import { KeepTheVibe } from '@/components/video-date/KeepTheVibe';
import { ReconnectionOverlay } from '@/components/video-date/ReconnectionOverlay';
import { MutualVibeToast } from '@/components/video-date/MutualVibeToast';
import { PostDateSurvey } from '@/components/video-date/PostDateSurvey';
import { InCallSafetySheet } from '@/components/video-date/InCallSafetySheet';
import { supabase } from '@/lib/supabase';
import { isVdbgEnabled, vdbg, vdbgRedirect } from '@/lib/vdbg';
import { fonts, spacing } from '@/constants/theme';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { trackEvent } from '@/lib/analytics';
import { emitNativeVideoDateClientStuckState } from '@/lib/videoDateClientStuckObservability';
import { setSafeAudioMode } from '@/lib/safeAudioMode';
import {
  getPreparedVideoDateEntry,
  preparedEntryBothReadyToFirstRemoteFrameMs,
  preparedEntryPrepareToJoinStartMs,
  rejectPreparedVideoDateEntry,
} from '@/lib/videoDatePrepareEntry';
import { LobbyPostDateEvents } from '@clientShared/analytics/lobbyToPostDateJourney';
import { classifyDailyRoomTokenFailureClass } from '@clientShared/matching/dailyRoomFailure';
import {
  buildReadyGateToDateLatencyPayload,
  buildVideoDateTimerDriftRecoveredPayload,
  bucketVideoDateLatencyMs,
  recordReadyGateToDateLatencyCheckpoint,
} from '@clientShared/observability/videoDateOperatorMetrics';
import { LiveSurfaceOfflineStrip } from '@/components/connectivity/LiveSurfaceOfflineStrip';
import { avatarUrl } from '@/lib/imageUrl';
import {
  clearDateEntryTransition,
  isDateEntryTransitionActive,
  markVideoDateEntryPipelineStarted,
} from '@/lib/dateEntryTransitionLatch';
import {
  eventLobbyHref,
  eventLobbyHrefPendingVideoSession,
  eventLobbyHrefPostSurveyComplete,
  readyGateHref,
  tabsRootHref,
} from '@/lib/activeSessionRoutes';
import {
  consumeNativeVideoDateLaunchIntent,
  videoDateLaunchBreadcrumb,
  videoDateLaunchDurationMs,
} from '@/lib/videoDateLaunchTrace';
import { RC_CATEGORY, rcBreadcrumb } from '@/lib/nativeRcDiagnostics';
import { sanitizeNativeDiagnosticRecord } from '@/lib/nativeDiagnosticsPayload';
import {
  getVideoDateJourneyEventName,
  type VideoDateJourneyEvent,
  VIDEO_DATE_RECONNECT_SYNC_OUTCOMES,
} from '@clientShared/matching/videoDateDiagnostics';
import {
  shouldPreservePrejoinAttemptOnCleanup,
  type PrejoinAttemptStep,
} from '@clientShared/matching/videoDatePrejoinAttempt';
import { markDailyJoinedWithBackoff } from '@clientShared/matching/dailyJoinedConfirmation';
import {
  createVideoDateDailyCallObject,
  isVideoDateCameraConstraintError as isNativeVideoDateCameraConstraintError,
  type NativeVideoDateCaptureProfile,
  type VideoDateDailyCallObject,
} from '@/lib/videoDateDailyMediaConfig';
import {
  VIDEO_DATE_REMOTE_OBJECT_FIT,
  VIDEO_DATE_REMOTE_OBJECT_POSITION,
  videoDateAspectRatio,
} from '@clientShared/matching/videoDateMediaContract';
import {
  VIDEO_DATE_ICE_BREAKER_MANUAL_PAUSE_MS,
  normalizeVideoDateIceBreakerIndex,
  normalizeVideoDateIceBreakerQuestions,
  resolveVideoDateIceBreakerIndex,
} from '@clientShared/matching/videoDateIceBreakers';
import {
  getVideoDateWarmupChoiceNotice,
  type VideoDateWarmupChoiceNotice,
} from '@clientShared/matching/videoDateWarmupChoiceNotice';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const FIRST_CONNECT_TIMEOUT_MS = 25000;
const PREJOIN_STEP_TIMEOUT_MS = 12000;
const NATIVE_BACKGROUND_GRACE_MS = 12_000;
const NATIVE_BACKGROUND_GRACE_SECONDS = Math.ceil(NATIVE_BACKGROUND_GRACE_MS / 1000);
const NATIVE_BACKGROUND_RECOVERED_BANNER_MS = 2_500;
const ICE_BREAKER_CLOCK_TICK_MS = 1_000;
const DATE_CONTROLS_STACK_HEIGHT = 104;
const DATE_PHASE_ICE_BREAKER_MIN_BOTTOM = 148;
const HANDSHAKE_CTA_STACK_HEIGHT = 92;
const FLOATING_CHROME_GAP = 14;
// Minimum time (ms) the Vibe/Pass CTA must be visible after first playable remote
// media before the server deadline is allowed to call completeHandshake.
// Prevents expiry on slow Daily join where media arrives just before the 60 s mark.
const MIN_DECISION_WINDOW_AFTER_MEDIA_MS = 15_000;
type DailyCallObject = VideoDateDailyCallObject;
type SharedDailyCallEntryState = 'creating' | 'joining' | 'joined' | 'failed' | 'leaving';
type SharedDailyCallEntry = {
  sessionId: string;
  call: DailyCallObject;
  roomName: string | null;
  captureProfile: NativeVideoDateCaptureProfile;
  state: SharedDailyCallEntryState;
  joinPromise: Promise<void> | null;
  createdAtMs: number;
  joinStartedAtMs: number | null;
  lastError: string | null;
};
let sharedDailyCallEntry: SharedDailyCallEntry | null = null;
type NativePrejoinPipelineEntry = {
  key: string;
  sessionId: string;
  userId: string;
  attemptId: number;
  startedAtMs: number;
  promise: Promise<void> | null;
};
let sharedNativePrejoinPipelineEntry: NativePrejoinPipelineEntry | null = null;
function nativePrejoinPipelineKey(sessionId: string, userId: string): string {
  return `${sessionId}:${userId}`;
}
type NativeMediaStreamTrack = import('@daily-co/react-native-webrtc').MediaStreamTrack;
type NativeDailyCameraFacingMode = 'user' | 'environment';
type NativeDailyCameraControls = {
  getCameraFacingMode?: () => Promise<NativeDailyCameraFacingMode | null>;
  cycleCamera?: () => Promise<{ device: { facingMode: NativeDailyCameraFacingMode } | null }>;
};

function summarizeSharedDailyError(error: unknown): string {
  if (error instanceof Error) return `${error.name || 'Error'}: ${error.message}`;
  return String(error ?? 'unknown');
}

function makeExtensionIdempotencyKey(sessionId: string, type: 'extra_time' | 'extended_vibe'): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${sessionId}:${type}:${random}`;
}

type PrejoinAttemptState = {
  attemptId: number;
  sessionId: string;
  userId: string;
  currentStep: PrejoinAttemptStep;
  cancellationReason: string | null;
  roomAcquisitionStarted: boolean;
  enterHandshakeCompletedAfterCancellation: boolean;
  completed: boolean;
};

type DateTheme = (typeof Colors)[keyof typeof Colors];

type HandshakeCtaTelemetrySnapshot = {
  cta_visible: boolean;
  cta_visible_ms: number;
  cta_last_time_left: number | null;
  has_remote_partner: boolean;
  peer_server_joined: boolean;
  partner_ever_joined: boolean;
  is_partner_disconnected: boolean;
  peer_missing_terminal: boolean;
  remote_video_mounted: boolean;
  remote_audio_mounted: boolean;
  first_playable_remote_seen: boolean;
  first_playable_remote_age_ms: number | null;
  local_decision: 'vibe' | 'pass' | 'none';
};

function WarmupChoiceNoticeBanner({
  notice,
  theme,
  top,
}: {
  notice: VideoDateWarmupChoiceNotice;
  theme: DateTheme;
  top: number;
}) {
  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[
        styles.warmupChoiceNotice,
        {
          top,
          borderColor: 'rgba(139,92,246,0.32)',
          backgroundColor: 'rgba(20,20,24,0.93)',
        },
      ]}
    >
      <View style={[styles.warmupChoiceNoticeRail, { backgroundColor: theme.tint }]} />
      <View style={styles.warmupChoiceNoticeIcon}>
        <Ionicons name="time-outline" size={18} color={theme.neonCyan} />
      </View>
      <View style={styles.warmupChoiceNoticeCopy}>
        <Text style={[styles.warmupChoiceNoticeTitle, { color: theme.text }]} numberOfLines={2}>
          {notice.title}
        </Text>
        <Text style={[styles.warmupChoiceNoticeMessage, { color: theme.mutedForeground }]}>
          {notice.message}
        </Text>
      </View>
    </View>
  );
}

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
    case 'READY_GATE_NOT_READY':
      return 'Almost there — finish the Ready Gate with your match first.';
    case 'SESSION_ENDED':
      return 'This date has already ended.';
    case 'EVENT_NOT_ACTIVE':
      return 'This date link is no longer available.';
    case 'SESSION_NOT_FOUND':
    case 'ROOM_NOT_FOUND':
      return "We couldn't open this date. Go back and try again.";
    case 'DAILY_AUTH_FAILED':
    case 'DAILY_CREDENTIALS_INVALID':
      return 'Video provider authentication failed. Please try again later.';
    case 'DAILY_REQUEST_REJECTED':
      return "We couldn't prepare this video room. Please try again.";
    case 'BLOCKED_PAIR':
      return 'This call is no longer available.';
    case 'ACCESS_DENIED':
      return "You don't have access to this date.";
    case 'network':
    case 'DAILY_PROVIDER_ERROR':
    case 'DAILY_PROVIDER_UNAVAILABLE':
    case 'DAILY_RATE_LIMIT':
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
  if (code === 'EVENT_NOT_ACTIVE') {
    return 'This date link is no longer available.';
  }
  return 'Could not start video. Please try again.';
}

function isReadyGateRace(code?: string): boolean {
  return code === 'READY_GATE_NOT_READY';
}

/** Backoffs (ms) for bounded refetch loops on `READY_GATE_NOT_READY` — short enough that user
 *  perceives no extra latency, long enough to absorb cross-region replica lag. Two retries by
 *  design: longer windows are better handled by `recoverFromNotStartableDateTruth` redirecting. */
const READY_GATE_RACE_RETRY_BACKOFFS_MS = [220, 320];

/**
 * Refetch backend truth and check whether the session is now Daily-startable. Used by the prejoin
 * `READY_GATE_NOT_READY` retry loops — does not call any RPC, just a coalesced read.
 */
async function refetchTruthAndCheckStartable(
  sessionId: string
): Promise<{ startable: boolean; truth: Awaited<ReturnType<typeof fetchVideoSessionDateEntryTruth>> }> {
  const truth = await fetchVideoSessionDateEntryTruth(sessionId);
  const decision = decideVideoSessionRouteFromTruth(truth);
  const canAttemptDaily = canAttemptDailyRoomFromVideoSessionTruth(truth);
  return {
    startable: canAttemptDaily || decision === 'navigate_date',
    truth,
  };
}

function getTrack(
  participant: DailyParticipant | undefined,
  kind: 'video' | 'audio'
): NativeMediaStreamTrack | null {
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
    if (t) return t as NativeMediaStreamTrack;
  }
  const dep = kind === 'video' ? p.videoTrack : p.audioTrack;
  return dep === false || dep === undefined ? null : (dep as NativeMediaStreamTrack);
}

function summarizeVideoTrackSettings(track: NativeMediaStreamTrack | null | undefined) {
  if (!track || typeof track.getSettings !== 'function') return null;
  const settings = track.getSettings();
  return {
    width: typeof settings.width === 'number' ? settings.width : null,
    height: typeof settings.height === 'number' ? settings.height : null,
    aspectRatio: videoDateAspectRatio(settings.width, settings.height),
    frameRate: typeof settings.frameRate === 'number' ? settings.frameRate : null,
    facingMode: typeof settings.facingMode === 'string' ? settings.facingMode : null,
  };
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
  data: Record<string, unknown>
) {
  const safeData = sanitizeNativeDiagnosticRecord(data);
  Sentry.addBreadcrumb({
    category: 'video-date-daily',
    message,
    level: 'info',
    data: safeData as Record<string, unknown> | undefined,
  });
}

async function ensureNativeFrontCameraIntent(
  call: DailyCallObject,
  context: { sessionId: string; roomName: string | null; captureProfile: NativeVideoDateCaptureProfile }
) {
  const cameraControls = call as unknown as NativeDailyCameraControls;
  if (typeof cameraControls.getCameraFacingMode !== 'function') {
    videoDateDailyDiagnostic('front_camera_intent_unavailable', {
      session_id: context.sessionId,
      room_name: context.roomName,
      capture_profile: context.captureProfile,
      reason: 'unsupported_api',
    });
    return;
  }
  try {
    const facingMode = await cameraControls.getCameraFacingMode();
    if (facingMode !== 'environment') {
      videoDateDailyDiagnostic('front_camera_intent_checked', {
        session_id: context.sessionId,
        room_name: context.roomName,
        capture_profile: context.captureProfile,
        facing_mode: facingMode,
        action: 'none',
      });
      return;
    }
    if (typeof cameraControls.cycleCamera !== 'function') {
      videoDateDailyDiagnostic('front_camera_intent_unavailable', {
        session_id: context.sessionId,
        room_name: context.roomName,
        capture_profile: context.captureProfile,
        reason: 'cycle_camera_unsupported',
        facing_mode: facingMode,
      });
      return;
    }
    const result = await cameraControls.cycleCamera();
    videoDateDailyDiagnostic('front_camera_intent_checked', {
      session_id: context.sessionId,
      room_name: context.roomName,
      capture_profile: context.captureProfile,
      facing_mode: facingMode,
      action: 'cycle_camera',
      next_facing_mode: result?.device?.facingMode ?? null,
    });
  } catch (error) {
    videoDateDailyDiagnostic('front_camera_intent_failed', {
      session_id: context.sessionId,
      room_name: context.roomName,
      capture_profile: context.captureProfile,
      error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
    });
  }
}

/** Same keys as {@link videoDateDailyDiagnostic}; use where room name is only on refs (e.g. AppState). */
function videoDateSessionDiagnostic(
  message: string,
  data: Record<string, unknown>
) {
  const safeData = sanitizeNativeDiagnosticRecord(data);
  Sentry.addBreadcrumb({
    category: 'video-date-session',
    message,
    level: 'info',
    data: safeData as Record<string, unknown> | undefined,
  });
}

function addVideoDateBreadcrumb(
  message: string,
  level: 'info' | 'warning' | 'error',
  data?: Record<string, unknown>
) {
  const safeData = sanitizeNativeDiagnosticRecord(data);
  Sentry.addBreadcrumb({
    category: 'video-date',
    message,
    level,
    data: safeData as Record<string, unknown> | undefined,
  });
}

function shouldRecoverPendingPostDateSurvey(
  session: {
    participant_1_id?: string | null;
    participant_2_id?: string | null;
    ended_at?: string | null;
    ended_reason?: string | null;
    date_started_at?: string | null;
    participant_1_joined_at?: string | null;
    participant_2_joined_at?: string | null;
    state?: string | null;
    phase?: string | null;
  } | null,
  userId: string,
  verdict: unknown
): boolean {
  if (verdict) return false;
  if (!getVideoSessionPartnerIdForUser(session, userId)) return false;
  return videoSessionHasPostDateSurveyTruth(session);
}

type NativeTerminalSurveySessionRow = {
  id?: string | null;
  participant_1_id?: string | null;
  participant_2_id?: string | null;
  event_id?: string | null;
  daily_room_name?: string | null;
  daily_room_url?: string | null;
  ended_at?: string | null;
  ended_reason?: string | null;
  date_started_at?: string | null;
  participant_1_joined_at?: string | null;
  participant_2_joined_at?: string | null;
  state?: string | null;
  phase?: string | null;
};

const NATIVE_TERMINAL_SURVEY_SESSION_SELECT =
  'id, participant_1_id, participant_2_id, event_id, daily_room_name, daily_room_url, ended_at, ended_reason, date_started_at, participant_1_joined_at, participant_2_joined_at, state, phase';

export default function VideoDateScreen() {
  const { id: sessionId } = useLocalSearchParams<{ id: string }>();
  const pathname = usePathname();
  const { user, loading: authLoading } = useAuth();
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
  const [vibeQuestionState, setVibeQuestionState] = useState<VibeQuestionState>({
    questions: [],
    questionIndex: 0,
    questionAnchorAt: null,
  });
  const [iceBreakerClockMs, setIceBreakerClockMs] = useState(() => Date.now());
  const [iceBreakerManualPause, setIceBreakerManualPause] = useState<{
    startedAtMs: number;
    untilMs: number;
  } | null>(null);
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
  const [nativeBackgroundStatus, setNativeBackgroundStatus] = useState<'none' | 'grace' | 'recovered'>('none');
  const [nativeBackgroundGraceSeconds, setNativeBackgroundGraceSeconds] = useState(0);
  const [showInCallSafety, setShowInCallSafety] = useState(false);
  const [isEndDateConfirming, setIsEndDateConfirming] = useState(false);
  const [netQualityTier, setNetQualityTier] = useState<'good' | 'fair' | 'poor'>('good');
  const [dateEntryPermissionEligible, setDateEntryPermissionEligible] = useState(false);
  const [captureProfile, setCaptureProfile] = useState<NativeVideoDateCaptureProfile>('ideal');
  const [isAbortingConnection, setIsAbortingConnection] = useState(false);

  const callRef = useRef<DailyCallObject | null>(null);
  const captureProfileRef = useRef<NativeVideoDateCaptureProfile>('ideal');
  const roomNameRef = useRef<string | null>(null);
  const hasStartedJoinRef = useRef(false);
  const prejoinAttemptSeqRef = useRef(0);
  const prejoinAttemptRef = useRef<PrejoinAttemptState | null>(null);
  const observedNativePrejoinPipelineKeyRef = useRef<string | null>(null);
  const phaseRef = useRef(phase);
  const localTimeLeftRef = useRef<number | null>(null);
  const countdownCompletionKeyRef = useRef<string | null>(null);
  const timerDriftTrackingReadyRef = useRef(false);
  const lastTimerDriftRecoveryKeyRef = useRef<string | null>(null);
  const latestDateRouteSessionIdRef = useRef<string | null>(null);
  const latestDateRouteUserIdRef = useRef<string | null>(null);
  const latestDateRouteEndedRef = useRef(false);
  const extensionSpendInFlightRef = useRef(false);
  const extensionSpendRetryRef = useRef<{
    type: 'extra_time' | 'extended_vibe';
    key: string;
  } | null>(null);
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
  const enterHandshakeSucceededRef = useRef(false);
  const handleCallEndRef = useRef<((source?: 'local_end' | 'server_end') => Promise<void>) | null>(null);
  const handshakeAnalyticsRef = useRef(false);
  const videoDateEndedRef = useRef(false);
  const dateEstablishedRef = useRef(false);
  const firstConnectWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const topChromeAnim = useRef(new Animated.Value(1)).current;
  const controlsAnim = useRef(new Animated.Value(1)).current;
  /** Dedupe first-time remote presence in React state (covers participant-joined / participant-updated paths). */
  const remotePromotionLoggedRef = useRef(false);
  const lastLocalMountedTrackIdRef = useRef<string | null>(null);
  const lastRemoteMountedTrackIdRef = useRef<string | null>(null);
  const loggedJourneyRef = useRef<Set<string>>(new Set());
  const surveyOpenedRef = useRef(false);
  const lastLoggedPostJoinStageRef = useRef<VideoDatePostJoinStage | null>(null);
  /** Opacity heartbeat for the final 10 seconds of handshake. */
  const lastChanceBlinkOpacity = useRef(new Animated.Value(1)).current;
  const handshakeCompletionInFlightRef = useRef(false);
  const handshakeDecisionInFlightRef = useRef(false);
  const handshakeCompletionDeadlineKeyRef = useRef<string | null>(null);
  const handshakeCompletionRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handshakeCtaImpressionRef = useRef<{ key: string; shownAtMs: number; lastTimeLeft: number | null } | null>(null);
  const handshakeCtaLastVisibleMsRef = useRef(0);
  const handshakeCtaLatestRef = useRef<HandshakeCtaTelemetrySnapshot>({
    cta_visible: false,
    cta_visible_ms: 0,
    cta_last_time_left: null,
    has_remote_partner: false,
    peer_server_joined: false,
    partner_ever_joined: false,
    is_partner_disconnected: false,
    peer_missing_terminal: false,
    remote_video_mounted: false,
    remote_audio_mounted: false,
    first_playable_remote_seen: false,
    first_playable_remote_age_ms: null,
    local_decision: 'none',
  });
  const handshakeFinalTenNudgeKeyRef = useRef<string | null>(null);
  const peerMissingTerminalImpressionRef = useRef(false);
  const localInDailyRoomRef = useRef(false);
  const dailySdkUnresponsiveKeyRef = useRef<string | null>(null);
  const appStateBackgroundTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appStateBackgroundIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateRecoveredTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appStateAwaySessionRef = useRef<string | null>(null);
  const appStateExpiredSessionRef = useRef<string | null>(null);
  const appStateBackgroundStartedAtRef = useRef<number | null>(null);
  const bootstrapTimingsRef = useRef<Record<string, number>>({});
  const activePreparedEntryCacheRef = useRef<ReturnType<typeof getPreparedVideoDateEntry> | null>(null);
  const dailyJoinStartedAtMsRef = useRef<number | null>(null);
  const preparedJoinRetryUsedRef = useRef(false);
  const firstIceConnectedLoggedRef = useRef(false);
  const firstRemoteParticipantTimedRef = useRef(false);
  const firstPlayableRemoteTimedRef = useRef(false);
  const abortConnectionInFlightRef = useRef(false);
  const warmupChoiceNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Epoch ms when the first playable remote track was mounted; 0 = not yet. */
  const firstPlayableRemoteAtMsRef = useRef(0);

  const [isConnecting, setIsConnecting] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const [warmupChoiceNotice, setWarmupChoiceNotice] = useState<VideoDateWarmupChoiceNotice | null>(null);
  const [localParticipant, setLocalParticipant] = useState<DailyParticipant | null>(null);
  const [remoteParticipant, setRemoteParticipant] = useState<DailyParticipant | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [canFlipCamera, setCanFlipCamera] = useState(false);
  const [isFlippingCamera, setIsFlippingCamera] = useState(false);
  const [joining, setJoining] = useState(false);
  const [awaitingFirstConnect, setAwaitingFirstConnect] = useState(false);
  const [preJoinFailed, setPreJoinFailed] = useState(false);
  const [joinAttemptNonce, setJoinAttemptNonce] = useState(0);

  useEffect(() => {
    void setSafeAudioMode({
      playsInSilentModeIOS: true,
      allowsRecordingIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: false,
    });
    return () => {
      void setSafeAudioMode({
        playsInSilentModeIOS: false,
        allowsRecordingIOS: false,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
      });
    };
  }, []);

  const showWarmupChoiceNotice = useCallback((notice: VideoDateWarmupChoiceNotice) => {
    if (warmupChoiceNoticeTimerRef.current) {
      clearTimeout(warmupChoiceNoticeTimerRef.current);
      warmupChoiceNoticeTimerRef.current = null;
    }
    setWarmupChoiceNotice(notice);
    warmupChoiceNoticeTimerRef.current = setTimeout(() => {
      warmupChoiceNoticeTimerRef.current = null;
      setWarmupChoiceNotice(null);
    }, 5200);
  }, []);

  useEffect(() => {
    return () => {
      if (warmupChoiceNoticeTimerRef.current) {
        clearTimeout(warmupChoiceNoticeTimerRef.current);
        warmupChoiceNoticeTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    surveyOpenedRef.current = false;
    if (warmupChoiceNoticeTimerRef.current) {
      clearTimeout(warmupChoiceNoticeTimerRef.current);
      warmupChoiceNoticeTimerRef.current = null;
    }
    setWarmupChoiceNotice(null);
  }, [sessionId]);

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

  const openNativePostDateSurveyFromTerminalTruth = useCallback(
    async (source: string, sessionOverride?: NativeTerminalSurveySessionRow | null) => {
      if (!sessionId || !user?.id) return false;
      if (surveyOpenedRef.current) {
        vdbg('post_date_survey_open_already_active', {
          sessionId,
          userId: user.id,
          source,
        });
        return true;
      }
      const sessionRow =
        sessionOverride ??
        (
          await supabase
            .from('video_sessions')
            .select(NATIVE_TERMINAL_SURVEY_SESSION_SELECT)
            .eq('id', sessionId)
            .maybeSingle()
        ).data;

      if (!sessionRow) return false;
      const terminal =
        Boolean(sessionRow.ended_at) ||
        sessionRow.state === 'ended' ||
        sessionRow.phase === 'ended';
      if (!terminal) return false;

      const { data: verdict } = await supabase
        .from('date_feedback')
        .select('id')
        .eq('session_id', sessionId)
        .eq('user_id', user.id)
        .maybeSingle();

      const pendingPostDateSurveyDue = shouldRecoverPendingPostDateSurvey(
        sessionRow,
        user.id,
        verdict,
      );
      const reconnectExpiredSurveyDue =
        sessionRow.ended_reason === 'reconnect_grace_expired' &&
        videoSessionHasEncounterExposureTruth(sessionRow) &&
        !verdict;
      vdbg('terminal_post_date_survey_recovery_checked', {
        sessionId,
        userId: user.id,
        source,
        pendingPostDateSurveyDue,
        verdictId: verdict?.id ?? null,
        endedAt: sessionRow.ended_at ?? null,
        endedReason: sessionRow.ended_reason ?? null,
        state: sessionRow.state ?? null,
        phase: sessionRow.phase ?? null,
        participant1Joined: Boolean(sessionRow.participant_1_joined_at),
        participant2Joined: Boolean(sessionRow.participant_2_joined_at),
      });
      if (!pendingPostDateSurveyDue) return false;

      const recoveredPartnerId =
        user.id === sessionRow.participant_1_id ? sessionRow.participant_2_id : sessionRow.participant_1_id;
      if (recoveredPartnerId) setPartnerId(recoveredPartnerId);
      if (sessionRow.event_id) setEventId(sessionRow.event_id);
      setIsParticipant1(user.id === sessionRow.participant_1_id);
      dateEstablishedRef.current = true;
      logJourney('date_route_recovered', { source }, 'date_route_recovered');
      logJourney(
        'survey_recovered',
        {
          source,
          reconnectExpiredSurveyDue,
          pendingPostDateSurveyDue,
        },
        `survey_recovered_${source}`
      );
      logJourney('survey_lost_prevented', { source }, 'survey_lost_prevented');
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_SURVEY_RECOVERED, {
        platform: 'native',
        session_id: sessionId,
        event_id: sessionRow.event_id ?? eventId ?? null,
        source_surface: 'video_date_route',
        source_action: source,
        outcome: 'recovered',
        reason_code: source,
        reconnectExpiredSurveyDue,
        pendingPostDateSurveyDue,
      });
      surveyOpenedRef.current = true;
      setShowFeedback(true);
      return true;
    },
    [eventId, logJourney, sessionId, user?.id]
  );

  const beginBootstrapTiming = useCallback((step: string, data?: Record<string, unknown>) => {
    if (!isVdbgEnabled()) return;
    bootstrapTimingsRef.current[step] = Date.now();
    vdbg('date_bootstrap_timing_start', {
      sessionId: sessionId ?? null,
      userId: user?.id ?? null,
      step,
      ...(data ?? {}),
    });
  }, [sessionId, user?.id]);

  const endBootstrapTiming = useCallback((step: string, data?: Record<string, unknown>) => {
    if (!isVdbgEnabled()) return;
    const startedAt = bootstrapTimingsRef.current[step];
    vdbg('date_bootstrap_timing_end', {
      sessionId: sessionId ?? null,
      userId: user?.id ?? null,
      step,
      duration_ms: typeof startedAt === 'number' ? Math.max(0, Date.now() - startedAt) : null,
      ...(data ?? {}),
    });
  }, [sessionId, user?.id]);

  const releaseSharedCallIfOwned = useCallback(
    (call: DailyCallObject | null, reason: string) => {
      if (!call) return;
      if (sharedDailyCallEntry?.call !== call) return;
      vdbg('daily_call_singleton_release', {
        reason,
        sessionId: sharedDailyCallEntry.sessionId,
        roomName: sharedDailyCallEntry.roomName,
        state: sharedDailyCallEntry.state,
        joinInFlight: Boolean(sharedDailyCallEntry.joinPromise),
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

  useEffect(() => {
    localInDailyRoomRef.current = localInDailyRoom;
  }, [localInDailyRoom]);

  useEffect(() => {
    if (!isConnecting && !localInDailyRoom) {
      dailySdkUnresponsiveKeyRef.current = null;
      return;
    }

    const emitUnresponsive = (reason: string, meetingState: string | null, error?: unknown) => {
      const key = `${sessionId ?? 'unknown'}:${reason}:${meetingState ?? 'none'}`;
      if (dailySdkUnresponsiveKeyRef.current === key) return;
      dailySdkUnresponsiveKeyRef.current = key;
      const payload = {
        platform: 'native',
        session_id: sessionId ?? null,
        event_id: eventId || null,
        source_surface: 'video_date_daily',
        source_action: 'daily_sdk_heartbeat',
        reason,
        daily_meeting_state: meetingState,
        connected: localInDailyRoom,
        connecting: isConnecting,
      };
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_SDK_UNRESPONSIVE, payload);
      Sentry.captureMessage('video_date_daily_sdk_unresponsive', {
        level: 'warning',
        extra: {
          ...payload,
          error: error instanceof Error ? { name: error.name, message: error.message } : error ?? null,
        },
      });
    };

    const intervalId = setInterval(() => {
      const call = callRef.current as (DailyCallObject & { meetingState?: () => unknown }) | null;
      if (!call || typeof call.meetingState !== 'function') return;
      let meetingState: string | null = null;
      try {
        const state = call.meetingState();
        meetingState = typeof state === 'string' ? state : state == null ? null : String(state);
      } catch (error) {
        emitUnresponsive('meeting_state_throw', null, error);
        return;
      }
      if (meetingState === 'error' || (localInDailyRoom && meetingState === 'left-meeting')) {
        emitUnresponsive('unexpected_meeting_state', meetingState);
      }
    }, 5_000);

    return () => clearInterval(intervalId);
  }, [eventId, isConnecting, localInDailyRoom, sessionId]);

  useEffect(() => {
    setDateEntryPermissionEligible(false);
  }, [sessionId, user?.id]);

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
          if (!firstRemoteParticipantTimedRef.current) {
            firstRemoteParticipantTimedRef.current = true;
            endBootstrapTiming('first_remote_participant', {
              source: 'participant_joined',
              participant_id: dailyParticipantId(p) ?? 'unknown',
              room_name: roomName,
            });
            const latencyContext = recordReadyGateToDateLatencyCheckpoint({
              sessionId: sessionId ?? '',
              platform: 'native',
              eventId: eventId || null,
              sourceSurface: 'video_date_daily',
              checkpoint: 'remote_seen',
            });
            const latencyPayload = buildReadyGateToDateLatencyPayload({
              context: latencyContext,
              checkpoint: 'remote_seen',
              sourceAction: 'participant_joined',
              outcome: 'success',
            });
            trackEvent(LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT, latencyPayload);
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_REMOTE_SEEN, {
              platform: 'native',
              session_id: sessionId ?? null,
              event_id: eventId || null,
              source_surface: 'video_date_daily',
              source_action: 'participant_joined',
              source: 'participant_joined',
              duration_ms: latencyPayload.bothReadyToRemoteSeenMs,
              latency_bucket: latencyPayload.latency_bucket,
            });
          }
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
          if (!firstRemoteParticipantTimedRef.current) {
            firstRemoteParticipantTimedRef.current = true;
            endBootstrapTiming('first_remote_participant', {
              source: 'participant_updated',
              participant_id: dailyParticipantId(p) ?? 'unknown',
              room_name: roomName,
            });
            const latencyContext = recordReadyGateToDateLatencyCheckpoint({
              sessionId: sessionId ?? '',
              platform: 'native',
              eventId: eventId || null,
              sourceSurface: 'video_date_daily',
              checkpoint: 'remote_seen',
            });
            const latencyPayload = buildReadyGateToDateLatencyPayload({
              context: latencyContext,
              checkpoint: 'remote_seen',
              sourceAction: 'participant_updated',
              outcome: 'success',
            });
            trackEvent(LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT, latencyPayload);
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_REMOTE_SEEN, {
              platform: 'native',
              session_id: sessionId ?? null,
              event_id: eventId || null,
              source_surface: 'video_date_daily',
              source_action: 'participant_updated',
              source: 'participant_updated',
              duration_ms: latencyPayload.bothReadyToRemoteSeenMs,
              latency_bucket: latencyPayload.latency_bucket,
            });
          }
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
        addVideoDateBreadcrumb('Daily call error', 'error', { sessionId, errorMsg: msg });
        setCallError('Connection error. Please try again.');
        clearFirstConnectWatchdog();
        setAwaitingFirstConnect(false);
        setIsConnecting(false);
        setLocalInDailyRoom(false);
        releaseSharedCallIfOwned(call, 'daily_error_event');
      };
      const onNetworkQualityChange = (ev: unknown) => {
        if (!firstIceConnectedLoggedRef.current && localInDailyRoomRef.current) {
          firstIceConnectedLoggedRef.current = true;
          endBootstrapTiming('first_ice_connected', {
            source: 'network_quality_change',
            room_name: roomName,
            proxy: true,
          });
        }
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
    [clearFirstConnectWatchdog, detachCallListeners, releaseSharedCallIfOwned, endBootstrapTiming, eventId, sessionId, user?.id]
  );

  phaseRef.current = phase;
  latestDateRouteSessionIdRef.current = sessionId ?? null;
  latestDateRouteUserIdRef.current = user?.id ?? null;
  latestDateRouteEndedRef.current = Boolean(session?.ended_at || session?.state === 'ended' || phase === 'ended');

  useEffect(() => {
    localTimeLeftRef.current = localTimeLeft;
  }, [localTimeLeft]);

  useEffect(() => {
    if (phase !== 'date') {
      timerDriftTrackingReadyRef.current = false;
      lastTimerDriftRecoveryKeyRef.current = null;
    }
  }, [phase]);

  useEffect(() => {
    if (!sessionId) {
      dateEstablishedRef.current = false;
      return;
    }
    if (phase === 'date' || videoSessionHasEncounterExposureTruth(session)) {
      dateEstablishedRef.current = true;
    }
  }, [
    sessionId,
    phase,
    session,
    session?.state,
    session?.phase,
    session?.date_started_at,
    session?.participant_1_joined_at,
    session?.participant_2_joined_at,
  ]);

  const clearHandshakeGraceState = useCallback(() => {}, []);

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
    prejoinAttemptRef.current = null;
    observedNativePrejoinPipelineKeyRef.current = null;
    dateEstablishedRef.current = false;
    bootstrapTimingsRef.current = {};
    activePreparedEntryCacheRef.current = null;
    dailyJoinStartedAtMsRef.current = null;
    preparedJoinRetryUsedRef.current = false;
    firstIceConnectedLoggedRef.current = false;
    firstRemoteParticipantTimedRef.current = false;
    firstPlayableRemoteTimedRef.current = false;
    firstPlayableRemoteAtMsRef.current = 0;
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
    handshakeCompletionInFlightRef.current = false;
    handshakeCompletionDeadlineKeyRef.current = null;
    handshakeCtaImpressionRef.current = null;
    handshakeCtaLastVisibleMsRef.current = 0;
    handshakeFinalTenNudgeKeyRef.current = null;
    if (handshakeCompletionRetryTimerRef.current) {
      clearTimeout(handshakeCompletionRetryTimerRef.current);
      handshakeCompletionRetryTimerRef.current = null;
    }
    noRemoteAutoRecoveryUsedRef.current = false;
    lastLoggedPostJoinStageRef.current = null;
  }, [sessionId, user?.id, clearHandshakeGraceState]);

  /** Latch + RC before paint so hydration cannot bounce `/date` → `/ready` during stale `in_ready_gate`. */
  useLayoutEffect(() => {
    if (!sessionId) return;
    rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'date_screen_mount', {
      date_screen_param_session_id: sessionId,
      pathname: pathname ?? null,
      user_id: user?.id ?? null,
      ts_ms: Date.now(),
    });
    markVideoDateEntryPipelineStarted(sessionId);
    const launch = consumeNativeVideoDateLaunchIntent();
    if (launch) {
      videoDateLaunchBreadcrumb('date_route_layout_after_nav_intent', {
        session_id: sessionId,
        duration_ms_since_nav_intent: videoDateLaunchDurationMs(launch.t0Ms),
        nav_intent_source: launch.source,
      });
    }
    rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'navigate_to_date_started', {
      session_id: sessionId,
      user_id: user?.id ?? null,
    });
  }, [sessionId, user?.id, pathname]);

  useEffect(() => {
    vdbg('date_mount', { sessionId: sessionId ?? null, userId: user?.id ?? null });
    if (sessionId) {
      const latencyContext = recordReadyGateToDateLatencyCheckpoint({
        sessionId,
        platform: 'native',
        eventId: eventId || null,
        sourceSurface: 'video_date_route',
        checkpoint: 'date_route_entered',
      });
      trackEvent(
        LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
        buildReadyGateToDateLatencyPayload({
          context: latencyContext,
          checkpoint: 'date_route_entered',
          sourceAction: 'route_mount',
          outcome: 'success',
        }),
      );
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_ROUTE_ENTERED, {
        platform: 'native',
        session_id: sessionId,
        event_id: eventId || null,
        source_surface: 'video_date_route',
        source_action: 'route_mount',
      });
    }
    beginBootstrapTiming('date_route_entered', { source: 'mount' });
    endBootstrapTiming('date_route_entered', { source: 'mount' });
    logJourney('date_route_entered', { source: 'mount' }, 'date_route_entered');
    if (!sessionId || !user?.id) return;
    const userId = user.id;
    let cancelled = false;
    if (isVdbgEnabled() || __DEV__) {
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
    }
    return () => {
      cancelled = true;
    };
  }, [sessionId, user?.id, eventId, beginBootstrapTiming, endBootstrapTiming, logJourney]);

  // Ended + in_ready_gate: defense-in-depth vs `NativeSessionRouteHydration` (backend truth first).
  useEffect(() => {
    if (!sessionId || !user?.id) return;
    let cancelled = false;
    void (async () => {
      beginBootstrapTiming('truth_fetch', { source: 'route_guard' });
      const vs = await fetchVideoSessionDateEntryTruthCoalesced(sessionId);
      endBootstrapTiming('truth_fetch', { source: 'route_guard', has_truth: Boolean(vs) });
      if (cancelled) return;
      vdbg('date_entry_truth_row', { sessionId, userId: user.id, row: vs ?? null });
      if (!vs) {
        setDateEntryPermissionEligible(false);
        vdbg('date_guard_blocked', { sessionId, userId: user.id, reason: 'missing_session_truth_row' });
        return;
      }
      if (!getVideoSessionPartnerIdForUser(vs, user.id)) {
        setDateEntryPermissionEligible(false);
        vdbg('date_guard_blocked', { sessionId, userId: user.id, reason: 'not_participant' });
        return;
      }
      const regQuery = supabase
        .from('event_registrations')
        .select('queue_status')
        .eq('profile_id', user.id);
      if (vs.event_id) {
        regQuery.eq('event_id', vs.event_id as string);
      } else {
        regQuery.eq('current_room_id', sessionId);
      }
      const { data: reg } = await regQuery.maybeSingle();
      if (cancelled) return;
      const truthDecision = decideVideoSessionRouteFromTruth(vs);
      const canAttemptDaily = canAttemptDailyRoomFromVideoSessionTruth(vs);
      const routedTo =
        canAttemptDaily || truthDecision === 'navigate_date'
          ? 'date'
          : truthDecision === 'navigate_ready'
            ? 'ready'
            : truthDecision === 'ended'
              ? 'ended'
              : 'lobby';
      rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'date_route_decision', {
        session_id: sessionId,
        user_id: user.id,
        truth_decision: truthDecision,
        can_attempt_daily: canAttemptDaily,
        route_override: canAttemptDaily && truthDecision !== 'navigate_date' ? 'daily_startable' : null,
        final_route: routedTo,
        source: 'route_guard',
        queue_status: reg?.queue_status ?? null,
        vs_state: vs.state ?? null,
        vs_phase: vs.phase ?? null,
        ready_gate_status: vs.ready_gate_status ?? null,
        ready_gate_expires_at: vs.ready_gate_expires_at == null ? null : String(vs.ready_gate_expires_at),
      });
      vdbg('date_route_decision', {
        sessionId,
        userId: user.id,
        source: 'route_guard',
        truthDecision,
        canAttemptDaily,
        routeOverride: canAttemptDaily && truthDecision !== 'navigate_date' ? 'daily_startable' : null,
        finalRoute: routedTo,
        queueStatus: reg?.queue_status ?? null,
        vsState: vs.state ?? null,
        vsPhase: vs.phase ?? null,
        readyGateStatus: vs.ready_gate_status ?? null,
        readyGateExpiresAt: vs.ready_gate_expires_at ?? null,
      });
      if (truthDecision === 'ended') {
        setDateEntryPermissionEligible(false);
        const openedSurvey = await openNativePostDateSurveyFromTerminalTruth('ended_route_guard', vs);
        if (cancelled) return;
        if (openedSurvey) {
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
      if (canAttemptDaily || truthDecision === 'navigate_date') {
        setDateEntryPermissionEligible(true);
        return;
      }
	      if (truthDecision === 'navigate_ready') {
        setDateEntryPermissionEligible(false);
        vdbg('date_guard_ready_gate_branch', {
          sessionId,
          userId: user.id,
          branch: 'navigate_ready',
          canAttemptDaily,
          routed_to: 'ready',
          readyGateStatus: vs.ready_gate_status ?? null,
          readyGateExpiresAt: vs.ready_gate_expires_at ?? null,
        });
	        clearDateEntryTransition(sessionId);
	        rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'route_bounced_to_ready', {
          session_id: sessionId,
          user_id: user.id,
          queue_status: reg?.queue_status ?? null,
          vs_state: vs.state,
          vs_phase: vs.phase,
          handshake_started_at: Boolean(vs.handshake_started_at),
          ready_gate_status: vs.ready_gate_status ?? null,
          ready_gate_expires_at: vs.ready_gate_expires_at == null ? null : String(vs.ready_gate_expires_at),
          can_attempt_daily: canAttemptDaily,
          routed_to: 'ready',
        });
        const target = readyGateHref(sessionId);
	        vdbgRedirect(target, 'in_ready_gate_without_provider_prepared_truth', {
          sessionId,
          userId: user.id,
          queueStatus: reg?.queue_status ?? null,
          state: vs.state,
          phase: vs.phase,
          handshakeStarted: Boolean(vs.handshake_started_at),
          latchActive: isDateEntryTransitionActive(sessionId),
        });
	        logJourney('date_route_bounced', {
	          reason: 'in_ready_gate_without_provider_prepared_truth',
	          target,
	        });
        router.replace(target);
        return;
      }
      setDateEntryPermissionEligible(false);
      clearDateEntryTransition(sessionId);
      rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'route_bounced_to_lobby', {
        session_id: sessionId,
        user_id: user.id,
        reason: 'video_truth_not_startable',
        event_id: vs.event_id,
      });
      if (vs.event_id) {
        const target = eventLobbyHref(vs.event_id as string);
        vdbgRedirect(target, 'video_truth_not_startable_route_guard', {
          sessionId,
          userId: user.id,
          eventId: vs.event_id,
          state: vs.state,
          phase: vs.phase,
          readyGateStatus: vs.ready_gate_status ?? null,
        });
        logJourney('date_route_bounced', { reason: 'video_truth_not_startable_route_guard', target });
        router.replace(target);
        return;
      }
      const target = tabsRootHref();
      vdbgRedirect(target, 'video_truth_not_startable_route_guard', {
        sessionId,
        userId: user.id,
        state: vs.state,
        phase: vs.phase,
        readyGateStatus: vs.ready_gate_status ?? null,
      });
      logJourney('date_route_bounced', { reason: 'video_truth_not_startable_route_guard', target });
      router.replace(target);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    sessionId,
    user?.id,
    eventId,
    logJourney,
    beginBootstrapTiming,
    endBootstrapTiming,
    openNativePostDateSurveyFromTerminalTruth,
  ]);

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
      const decision = decideVideoSessionRouteFromTruth(vs);
      const canAttemptDaily = canAttemptDailyRoomFromVideoSessionTruth(vs);
      const reason =
        decision === 'navigate_date'
          ? null
          : decision === 'ended'
            ? 'session_ended'
            : canAttemptDaily
              ? 'video_truth_startable_after_refetch'
              : 'video_truth_not_startable';
      const routedTo =
        canAttemptDaily || decision === 'navigate_date'
          ? 'date'
          : decision === 'navigate_ready'
            ? 'ready'
            : decision === 'ended'
              ? 'ended'
              : 'lobby';
      rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'date_route_decision', {
        session_id: sessionId,
        user_id: user.id,
        decision,
        can_attempt_daily: canAttemptDaily,
        reason,
        routed_to: routedTo,
        source,
        queue_status: reg?.queue_status ?? null,
        current_room_id: reg?.current_room_id ?? null,
        vs_state: vs?.state ?? null,
        vs_phase: vs?.phase ?? null,
        handshake_started_at: Boolean(vs?.handshake_started_at),
        ready_gate_status: vs?.ready_gate_status ?? null,
        ready_gate_expires_at: vs?.ready_gate_expires_at == null ? null : String(vs.ready_gate_expires_at),
      });
      vdbg('date_route_decision', {
        sessionId,
        userId: user.id,
        source,
        decision,
        reason,
        canAttemptDaily,
        routed_to: routedTo,
        queueStatus: reg?.queue_status ?? null,
        currentRoomId: reg?.current_room_id ?? null,
        vsState: vs?.state ?? null,
        vsPhase: vs?.phase ?? null,
        handshakeStartedAt: vs?.handshake_started_at ?? null,
        readyGateStatus: vs?.ready_gate_status ?? null,
        readyGateExpiresAt: vs?.ready_gate_expires_at ?? null,
      });
      if (!canAttemptDaily && decision === 'navigate_ready') {
        const target = readyGateHref(sessionId);
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'latch_cleared_before_recovery_redirect', {
          session_id: sessionId,
          source,
          target: String(target),
        });
        clearDateEntryTransition(sessionId);
        vdbgRedirect(target, 'ready_gate_not_ready_recover_to_ready', { source, sessionId, userId: user.id });
        router.replace(target);
        return true;
      }
      if (decision === 'ended') {
        const openedSurvey = await openNativePostDateSurveyFromTerminalTruth(`${source}_ended_truth`, vs);
        if (openedSurvey) return true;
        const fallbackEventId = vs?.event_id ?? eventId;
        if (fallbackEventId) {
          const target = eventLobbyHref(fallbackEventId as string);
          rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'latch_cleared_before_recovery_redirect', {
            session_id: sessionId,
            source,
            target: String(target),
          });
          clearDateEntryTransition(sessionId);
          vdbgRedirect(target, 'ready_gate_not_ready_recover_to_lobby', {
            source,
            sessionId,
            userId: user.id,
            eventId: fallbackEventId,
          });
          router.replace(target);
        } else {
          const target = tabsRootHref();
          rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'latch_cleared_before_recovery_redirect', {
            session_id: sessionId,
            source,
            target: String(target),
          });
          clearDateEntryTransition(sessionId);
          vdbgRedirect(target, 'ready_gate_not_ready_recover_to_tabs', {
            source,
            sessionId,
            userId: user.id,
          });
          router.replace(target);
        }
        return true;
      }
      if (!canAttemptDaily && decision === 'stay_lobby') {
        const fallbackEventId = vs?.event_id ?? eventId;
        if (fallbackEventId) {
          const target = eventLobbyHref(fallbackEventId as string);
          rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'latch_cleared_before_recovery_redirect', {
            session_id: sessionId,
            source,
            target: String(target),
          });
          clearDateEntryTransition(sessionId);
          vdbgRedirect(target, 'ready_gate_not_ready_recover_to_lobby', {
            source,
            sessionId,
            userId: user.id,
            eventId: fallbackEventId,
          });
          router.replace(target);
        } else {
          const target = tabsRootHref();
          rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'latch_cleared_before_recovery_redirect', {
            session_id: sessionId,
            source,
            target: String(target),
          });
          clearDateEntryTransition(sessionId);
          vdbgRedirect(target, 'ready_gate_not_ready_recover_to_tabs', {
            source,
            sessionId,
            userId: user.id,
          });
          router.replace(target);
        }
        return true;
      }
      // Truth says startable (`navigate_date` / `canAttemptDaily=true`) yet the original op
      // failed — caller should bounded-retry rather than show the fatal banner. Emit the missing
      // breadcrumb so production logs distinguish this silent path from a successful redirect.
      rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'recover_not_startable_no_redirect', {
        session_id: sessionId,
        source,
        decision,
        can_attempt_daily: canAttemptDaily,
        vs_state: vs?.state ?? null,
        ready_gate_status: vs?.ready_gate_status ?? null,
        handshake_started_at: Boolean(vs?.handshake_started_at),
      });
      return false;
    },
    [eventId, openNativePostDateSurveyFromTerminalTruth, sessionId, user?.id]
  );

  useEffect(() => {
    if (phaseRef.current !== 'date') {
      timerDriftTrackingReadyRef.current = false;
      setLocalTimeLeft(serverTimeLeft);
      return;
    }

    if (timerDriftTrackingReadyRef.current && serverTimeLeft !== null) {
      const payload = buildVideoDateTimerDriftRecoveredPayload({
        platform: 'native',
        sessionId,
        eventId: session?.event_id ?? eventId,
        previousTimeLeftSeconds: localTimeLeftRef.current,
        correctedTimeLeftSeconds: serverTimeLeft,
        recoverySource: 'sync_reconnect',
        phase: phaseRef.current,
      });

      if (payload) {
        const recoveryKey = [
          payload.session_id,
          payload.drift_ms,
          payload.drift_bucket,
          payload.recovery_source,
          serverTimeLeft,
          session?.date_started_at ?? '',
          session?.date_extra_seconds ?? '',
        ].join(':');
        if (lastTimerDriftRecoveryKeyRef.current !== recoveryKey) {
          lastTimerDriftRecoveryKeyRef.current = recoveryKey;
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_TIMER_DRIFT_DETECTED, {
            ...payload,
            outcome: 'no_op',
            reason_code: 'client_server_timer_mismatch',
          });
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_TIMER_DRIFT_RECOVERED, payload);
          vdbg('timer_drift_recovered_by_server_truth', {
            sessionId: sessionId ?? null,
            eventId: payload.event_id ?? null,
            driftMs: payload.drift_ms,
            driftBucket: payload.drift_bucket,
            recoverySource: payload.recovery_source,
          });
        }
      }
    }

    setLocalTimeLeft(serverTimeLeft);
    if (serverTimeLeft !== null) {
      timerDriftTrackingReadyRef.current = true;
    }
  }, [eventId, serverTimeLeft, session?.date_extra_seconds, session?.date_started_at, session?.event_id, sessionId]);

  useEffect(() => {
    if (!session || !user?.id) return;
    const pid =
      user.id === session.participant_1_id ? session.participant_2_id : session.participant_1_id;
    if (pid) setPartnerId(pid);
    if (session.event_id) setEventId(session.event_id);
    setIsParticipant1(user.id === session.participant_1_id);
  }, [session, user?.id]);

  useEffect(() => {
    if (!sessionId || !user?.id || !localInDailyRoom) return;
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
  }, [sessionId, user?.id, localInDailyRoom]);

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
      void emitNativeVideoDateClientStuckState({
        sessionId,
        eventName: 'peer_missing_terminal',
        latencyMs: FIRST_CONNECT_TIMEOUT_MS,
        payload: {
          source_surface: 'video_date_daily',
          source_action: 'first_remote_watchdog',
          reason_code: 'peer_missing_timeout',
          watchdog_ms: FIRST_CONNECT_TIMEOUT_MS,
          auto_recovery_count: noRemoteAutoRecoveryUsedRef.current ? 1 : 0,
        },
      });
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
        value: 'They may need a little more time.',
        sessionId,
        userId: user?.id ?? null,
        step: 'peer_missing_timeout',
      });
      setCallError('They may need a little more time.');
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
    user?.id,
    clearFirstConnectWatchdog,
    releaseSharedCallIfOwned,
    detachCallListeners,
  ]);

  useEffect(() => {
    if (!sessionId || !localInDailyRoom) return;
    getOrSeedVibeQuestionState(sessionId).then(setVibeQuestionState);
  }, [sessionId, localInDailyRoom]);

  useEffect(() => {
    if (!sessionId || !localInDailyRoom) return;
    const channel = supabase
      .channel(`vibe-questions-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'video_sessions',
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          const row = payload.new as {
            vibe_questions?: unknown;
            vibe_question_index?: unknown;
            vibe_question_anchor_at?: unknown;
          };
          const questions = normalizeVideoDateIceBreakerQuestions(row.vibe_questions);
          if (!questions.length) return;
          setVibeQuestionState({
            questions,
            questionIndex: normalizeVideoDateIceBreakerIndex(row.vibe_question_index, questions.length),
            questionAnchorAt:
              typeof row.vibe_question_anchor_at === 'string' && row.vibe_question_anchor_at.trim()
                ? row.vibe_question_anchor_at
                : null,
          });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [localInDailyRoom, sessionId]);

  useEffect(() => {
    if (!vibeQuestionState.questions.length) return;
    const interval = setInterval(() => {
      setIceBreakerClockMs(Date.now());
    }, ICE_BREAKER_CLOCK_TICK_MS);
    return () => clearInterval(interval);
  }, [vibeQuestionState.questions.length]);

  useEffect(() => {
    return () => {
      clearFirstConnectWatchdog();
      clearHandshakeGraceState();
    };
  }, [clearFirstConnectWatchdog, clearHandshakeGraceState]);

  useEffect(() => {
    if (hasRemotePartner && (phase === 'handshake' || phase === 'date')) {
      setShowIceBreaker(true);
    }
  }, [hasRemotePartner, phase, sessionId]);

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
    const videoTrack = getTrack(localParticipant ?? undefined, 'video');
    const trackId = videoTrack?.id ?? null;
    if (!trackId) {
      lastLocalMountedTrackIdRef.current = null;
      return;
    }
    if (lastLocalMountedTrackIdRef.current === trackId) return;
    lastLocalMountedTrackIdRef.current = trackId;
    videoDateDailyDiagnostic('local_track_mounted', {
      session_id: sessionId ?? '',
      room_name: roomNameRef.current ?? null,
      capture_profile: captureProfile,
      diagnostic_scope: 'sender_capture',
      track_id: trackId,
      track_settings: summarizeVideoTrackSettings(videoTrack),
      frame_issue_hint: 'compare_native_local_track_settings_with_remote_receiver_layout',
    });
  }, [captureProfile, localParticipant, sessionId]);

  useEffect(() => {
    const videoTrack = getTrack(remoteParticipant ?? undefined, 'video');
    const trackId = videoTrack?.id ?? null;
    if (!trackId) {
      lastRemoteMountedTrackIdRef.current = null;
      return;
    }
    if (lastRemoteMountedTrackIdRef.current === trackId) return;
    lastRemoteMountedTrackIdRef.current = trackId;
    if (!firstPlayableRemoteTimedRef.current) {
      firstPlayableRemoteTimedRef.current = true;
      firstPlayableRemoteAtMsRef.current = Date.now();
      const bothReadyToFirstRemoteFrameMs = preparedEntryBothReadyToFirstRemoteFrameMs(
        activePreparedEntryCacheRef.current,
        firstPlayableRemoteAtMsRef.current,
      );
      endBootstrapTiming('first_playable_remote_media', {
        source: 'remote_track_mounted',
        participant_id: dailyParticipantId(remoteParticipant ?? undefined) ?? 'unknown',
        both_ready_to_first_remote_frame_ms: bothReadyToFirstRemoteFrameMs,
      });
      if (sessionId) {
        const latencyContext = recordReadyGateToDateLatencyCheckpoint({
          sessionId,
          platform: 'native',
          eventId: eventId || null,
          sourceSurface: 'video_date_daily',
          checkpoint: 'first_remote_frame',
        });
        trackEvent(
          LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
          buildReadyGateToDateLatencyPayload({
            context: latencyContext,
            checkpoint: 'first_remote_frame',
            sourceAction: 'remote_track_mounted',
            outcome: 'success',
            durationMs: bothReadyToFirstRemoteFrameMs,
          }),
        );
      }
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_FIRST_REMOTE_FRAME, {
        platform: 'native',
        session_id: sessionId ?? null,
        event_id: eventId || null,
        source_surface: 'video_date_daily',
        source_action: 'remote_track_mounted',
        source: 'remote_track_mounted',
        bothReadyToFirstRemoteFrameMs,
        duration_ms: bothReadyToFirstRemoteFrameMs,
        latency_bucket: bucketVideoDateLatencyMs(bothReadyToFirstRemoteFrameMs),
      });
    }
    videoDateDailyDiagnostic('remote_track_mounted', {
      session_id: sessionId ?? '',
      room_name: roomNameRef.current ?? null,
      participant_id: dailyParticipantId(remoteParticipant ?? undefined) ?? 'unknown',
      capture_profile: captureProfile,
      diagnostic_scope: 'receiver_layout',
      track_id: trackId,
      track_settings: summarizeVideoTrackSettings(videoTrack),
      receiver_object_fit: VIDEO_DATE_REMOTE_OBJECT_FIT,
      receiver_object_position: VIDEO_DATE_REMOTE_OBJECT_POSITION,
      frame_issue_hint: 'remote_layout_contains_sender_frame_without_receiver_crop',
    });
  }, [captureProfile, remoteParticipant, sessionId, eventId, endBootstrapTiming]);

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
    if (!localInDailyRoom) return;
    refreshCredits();
  }, [refreshCredits, localInDailyRoom]);

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
    captureProfileRef.current = 'ideal';
    setCaptureProfile('ideal');
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
    if (sessionId) {
      // Aborting the prejoin/Daily pipeline must release the date-entry latch — otherwise the
      // hydration / route-guard bounce stays suppressed for up to 180s and a re-entry into
      // the date stack pins the user with the stale latch.
      clearDateEntryTransition(sessionId);
    }
  }, [cleanupDailyAndLocalState, sessionId]);

  const fetchServerTerminalTruth = useCallback(async () => {
    if (!sessionId) return false;
    const sync = await syncVideoDateReconnect(sessionId);
    return sync?.ended === true;
  }, [sessionId]);

  const handleCallEnd = useCallback(async (source: 'local_end' | 'server_end' = 'local_end') => {
    const dateWasEstablished = dateEstablishedRef.current;
    if (sessionId && !videoDateEndedRef.current) {
      videoDateEndedRef.current = true;
      trackEvent('video_date_ended', { session_id: sessionId });
    }
    addVideoDateBreadcrumb('Call ended (user)', 'info', { sessionId, source, dateWasEstablished });
    if (source === 'server_end') {
      const recoveredSurvey = await openNativePostDateSurveyFromTerminalTruth(source);
      if (recoveredSurvey || dateWasEstablished) {
        logJourney('survey_opened', { source }, `survey_opened_${source}`);
        if (!recoveredSurvey) setShowFeedback(true);
      } else {
        setShowFeedback(false);
      }
      await cleanupForAbortWithoutServerEnd();
      return;
    }

    if (dateWasEstablished) {
      let terminalConfirmed = false;
      if (sessionId) {
        terminalConfirmed = await endVideoDate(sessionId);
      }
      if (!terminalConfirmed) {
        terminalConfirmed = await fetchServerTerminalTruth();
      }
      if (!terminalConfirmed) {
        setShowFeedback(false);
        await cleanupForAbortWithoutServerEnd();
        Alert.alert('Could not end date yet', 'Please try ending the date again in a moment.');
        return;
      }

      logJourney('survey_opened', { source: 'local_end_confirmed' }, 'survey_opened_local_end_confirmed');
      const recoveredSurvey = await openNativePostDateSurveyFromTerminalTruth('local_end_confirmed');
      if (!recoveredSurvey) setShowFeedback(true);
      await cleanupForAbortWithoutServerEnd();
      return;
    }
    setShowFeedback(false);
    await cleanupForAbortWithoutServerEnd();
  }, [
    cleanupForAbortWithoutServerEnd,
    sessionId,
    logJourney,
    fetchServerTerminalTruth,
    openNativePostDateSurveyFromTerminalTruth,
  ]);

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

  /** Foreground/background: make app backgrounding server-observable and bounded. */
  useEffect(() => {
    if (!sessionId) return;
    const clearBackgroundTimeout = () => {
      if (!appStateBackgroundTimerRef.current) return;
      clearTimeout(appStateBackgroundTimerRef.current);
      appStateBackgroundTimerRef.current = null;
    };
    const clearBackgroundInterval = () => {
      if (!appStateBackgroundIntervalRef.current) return;
      clearInterval(appStateBackgroundIntervalRef.current);
      appStateBackgroundIntervalRef.current = null;
    };
    const clearRecoveredBannerTimer = () => {
      if (!appStateRecoveredTimerRef.current) return;
      clearTimeout(appStateRecoveredTimerRef.current);
      appStateRecoveredTimerRef.current = null;
    };
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        clearBackgroundTimeout();
        clearBackgroundInterval();
        if (appStateAwaySessionRef.current === sessionId) {
          appStateAwaySessionRef.current = null;
          const backgroundElapsedMs =
            appStateBackgroundStartedAtRef.current == null
              ? 0
              : Date.now() - appStateBackgroundStartedAtRef.current;
          appStateBackgroundStartedAtRef.current = null;
          const timerAlreadyExpired = appStateExpiredSessionRef.current === sessionId;
          const expiredInBackground =
            timerAlreadyExpired || backgroundElapsedMs >= NATIVE_BACKGROUND_GRACE_MS;
          if (expiredInBackground) {
            appStateExpiredSessionRef.current = null;
            vdbg('native_background_foreground_after_expiry', {
              sessionId,
              eventId: eventId || null,
              backgroundElapsedMs,
            });
            setNativeBackgroundStatus('none');
            setNativeBackgroundGraceSeconds(0);
            if (!timerAlreadyExpired) {
              trackEvent(LobbyPostDateEvents.VIDEO_DATE_NATIVE_BACKGROUND_EXPIRED, {
                platform: 'native',
                session_id: sessionId,
                event_id: eventId || null,
                source: 'app_foreground_after_background_timeout',
                grace_ms: NATIVE_BACKGROUND_GRACE_MS,
                elapsed_ms: backgroundElapsedMs,
              });
              void emitNativeVideoDateClientStuckState({
                sessionId,
                eventName: 'native_background_expired',
                latencyMs: backgroundElapsedMs,
                payload: {
                  source_surface: 'video_date_native_background',
                  source_action: 'app_foreground_after_background_timeout',
                  reason_code: 'app_background_timeout',
                  source: 'app_foreground_after_background_timeout',
                  grace_ms: NATIVE_BACKGROUND_GRACE_MS,
                  elapsed_ms: backgroundElapsedMs,
                },
              });
            }
            void (async () => {
              await cleanupDailyAndLocalState();
              await endVideoDate(sessionId, 'app_background_timeout');
            })();
          } else {
            void markReconnectReturn(sessionId);
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_NATIVE_BACKGROUND_RECOVERED, {
              platform: 'native',
              session_id: sessionId,
              event_id: eventId || null,
              source: 'app_foreground',
            });
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_RECONNECT_RETURNED, {
              platform: 'native',
              session_id: sessionId,
              event_id: eventId || null,
              source: 'app_foreground',
            });
            vdbg('native_background_recovered', {
              sessionId,
              eventId: eventId || null,
              hasCall: Boolean(callRef.current),
            });
            setNativeBackgroundStatus('recovered');
            setNativeBackgroundGraceSeconds(0);
            clearRecoveredBannerTimer();
            appStateRecoveredTimerRef.current = setTimeout(() => {
              setNativeBackgroundStatus('none');
              appStateRecoveredTimerRef.current = null;
            }, NATIVE_BACKGROUND_RECOVERED_BANNER_MS);
            if (!callRef.current && phaseRef.current !== 'ended') {
              hasStartedJoinRef.current = false;
              setJoinAttemptNonce((n) => n + 1);
            }
          }
        }
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
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_FOREGROUND_RECONCILE_FAILED, {
              platform: 'native',
              session_id: sessionId,
              event_id: eventId || null,
              source: 'app_foreground',
              step: 'refetch_video_session',
            });
          });
        requestReconnectSyncRef.current('app_foreground');
        return;
      }
      if (next === 'background' || next === 'inactive') {
        if (
          localInDailyRoomRef.current &&
          phaseRef.current !== 'ended' &&
          appStateAwaySessionRef.current !== sessionId
        ) {
          appStateAwaySessionRef.current = sessionId;
          appStateBackgroundStartedAtRef.current = Date.now();
          setNativeBackgroundStatus('grace');
          setNativeBackgroundGraceSeconds(NATIVE_BACKGROUND_GRACE_SECONDS);
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_NATIVE_BACKGROUND_GRACE_STARTED, {
            platform: 'native',
            session_id: sessionId,
            event_id: eventId || null,
            source: 'app_background',
            grace_ms: NATIVE_BACKGROUND_GRACE_MS,
          });
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_RECONNECT_GRACE_STARTED, {
            platform: 'native',
            session_id: sessionId,
            event_id: eventId || null,
            source: 'app_background',
            grace_ms: NATIVE_BACKGROUND_GRACE_MS,
          });
          void emitNativeVideoDateClientStuckState({
            sessionId,
            eventName: 'native_background_recovery_started',
            latencyMs: NATIVE_BACKGROUND_GRACE_MS,
            payload: {
              source_surface: 'video_date_native_background',
              source_action: 'app_background',
              reason_code: 'app_background_grace_started',
              source: 'app_background',
              grace_ms: NATIVE_BACKGROUND_GRACE_MS,
            },
          });
          vdbg('native_background_grace_started', {
            sessionId,
            eventId: eventId || null,
            graceMs: NATIVE_BACKGROUND_GRACE_MS,
          });
          void (async () => {
            const ok = await signalVideoDateLeave(sessionId, 'app_background');
            if (!ok) {
              trackEvent(LobbyPostDateEvents.VIDEO_DATE_NATIVE_BACKGROUND_LEAVE_SIGNAL_FAILED, {
                platform: 'native',
                session_id: sessionId,
                event_id: eventId || null,
                source: 'app_background',
              });
              void emitNativeVideoDateClientStuckState({
                sessionId,
                eventName: 'native_background_recovery_failed',
                payload: {
                  source_surface: 'video_date_native_background',
                  source_action: 'signal_video_date_leave',
                  reason_code: 'leave_signal_failed',
                  source: 'app_background',
                },
              });
            }
            await cleanupDailyAndLocalState();
            hasStartedJoinRef.current = false;
          })();
          clearBackgroundTimeout();
          clearBackgroundInterval();
          appStateBackgroundIntervalRef.current = setInterval(() => {
            setNativeBackgroundGraceSeconds((prev) => Math.max(0, prev - 1));
          }, 1000);
          appStateBackgroundTimerRef.current = setTimeout(() => {
            if (appStateAwaySessionRef.current !== sessionId || phaseRef.current === 'ended') return;
            clearBackgroundInterval();
            appStateExpiredSessionRef.current = sessionId;
            appStateBackgroundStartedAtRef.current = null;
            setNativeBackgroundStatus('none');
            setNativeBackgroundGraceSeconds(0);
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_NATIVE_BACKGROUND_EXPIRED, {
              platform: 'native',
              session_id: sessionId,
              event_id: eventId || null,
              source: 'app_background_timeout',
              grace_ms: NATIVE_BACKGROUND_GRACE_MS,
            });
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_RECONNECT_EXPIRED, {
              platform: 'native',
              session_id: sessionId,
              event_id: eventId || null,
              source: 'app_background_timeout',
              grace_ms: NATIVE_BACKGROUND_GRACE_MS,
            });
            void emitNativeVideoDateClientStuckState({
              sessionId,
              eventName: 'native_background_expired',
              latencyMs: NATIVE_BACKGROUND_GRACE_MS,
              payload: {
                source_surface: 'video_date_native_background',
                source_action: 'app_background_timeout',
                reason_code: 'app_background_timeout',
                source: 'app_background_timeout',
                grace_ms: NATIVE_BACKGROUND_GRACE_MS,
              },
            });
            vdbg('native_background_grace_expired', {
              sessionId,
              eventId: eventId || null,
              graceMs: NATIVE_BACKGROUND_GRACE_MS,
            });
            void (async () => {
              await cleanupDailyAndLocalState();
              await endVideoDate(sessionId, 'app_background_timeout');
            })();
          }, NATIVE_BACKGROUND_GRACE_MS);
        }
        requestReconnectSyncRef.current('app_background');
      }
    });
    return () => {
      clearBackgroundTimeout();
      clearBackgroundInterval();
      clearRecoveredBannerTimer();
      appStateBackgroundStartedAtRef.current = null;
      sub.remove();
    };
  }, [cleanupDailyAndLocalState, eventId, sessionId, refetchVideoSession]);

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
      const canSyncReconnect =
        enterHandshakeSucceededRef.current ||
        videoSessionRowIndicatesHandshakeOrDate(
              session
            ? {
                state: session.state ?? null,
                daily_room_name: session.daily_room_name ?? null,
                daily_room_url: session.daily_room_url ?? null,
                handshake_started_at: session.handshake_started_at,
              }
            : null
        );
      if (!canSyncReconnect) {
        vdbg('sync_reconnect_skip', {
          sessionId,
          phase: phaseRef.current,
          reason,
          mode,
          skip: 'server_truth_not_handshake_or_date',
          serverState: session?.state ?? null,
          handshakeStartedAt: session?.handshake_started_at ?? null,
          enterHandshakeSucceeded: enterHandshakeSucceededRef.current,
        });
        return;
      }
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
            syncHelperReturnedNullBecause: 'supabase_rpc_reported_error',
          });
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_SYNC_RECONNECT_FAILED, {
            platform: 'native',
            session_id: sessionId,
            event_id: eventId || null,
            reason,
            mode,
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
          if (!reconnectEndedHandledRef.current) {
            reconnectEndedHandledRef.current = true;
            const recoveredSurvey = await openNativePostDateSurveyFromTerminalTruth('sync_reconnect');
            if (recoveredSurvey) {
              void cleanupForAbortWithoutServerEnd();
            } else {
              void handleCallEndRef.current?.('server_end');
            }
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
    // Reconnect polling is intentionally keyed to phase scalars; the full session object would restart active recovery loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sessionId,
    phase,
    session?.state,
    session?.handshake_started_at,
    eventId,
    clearReconnectSyncTimer,
    cleanupForAbortWithoutServerEnd,
    openNativePostDateSurveyFromTerminalTruth,
  ]);

  useEffect(() => {
    reconnectSyncCountRef.current = 0;
    reconnectSyncWindowStartedAtRef.current = null;
    enterHandshakeSucceededRef.current = false;
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
    if (isEndDateConfirming) return;
    Alert.alert('End this date?', 'Stay if you tapped by accident. Ending will close the call for you.', [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'End date',
        style: 'destructive',
        onPress: () => {
          if (isEndDateConfirming) return;
          setIsEndDateConfirming(true);
          void handleCallEnd('local_end').finally(() => setIsEndDateConfirming(false));
        },
      },
    ]);
  }, [handleCallEnd, isEndDateConfirming]);

  /** Connecting or waiting for partner: exit without post-date survey (nothing to rate yet). */
  const handleAbortConnection = useCallback(
    async (opts?: { source?: 'peer_missing' }) => {
      if (abortConnectionInFlightRef.current) return;
      abortConnectionInFlightRef.current = true;
      setIsAbortingConnection(true);
      try {
        if (opts?.source === 'peer_missing' && sessionId) {
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_PEER_MISSING_BACK_TO_LOBBY_TAP, {
            platform: 'native',
            session_id: sessionId,
            event_id: eventId,
          });
          await endVideoDate(sessionId, 'partial_join_peer_timeout');
        } else if (sessionId) {
          await endVideoDate(sessionId, 'ended_from_client');
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
      } finally {
        setIsAbortingConnection(false);
        abortConnectionInFlightRef.current = false;
      }
    },
    [cleanupForAbortWithoutServerEnd, eventId, sessionId]
  );

  const handleHandshakeDecision = useCallback(async (action: 'vibe' | 'pass'): Promise<boolean> => {
    if (!sessionId || !user?.id) return false;
    if (handshakeDecisionInFlightRef.current) return false;
    handshakeDecisionInFlightRef.current = true;
    try {
      const result = await recordHandshakeDecision(sessionId, action, {
        actorUserId: user.id,
        phase: phaseRef.current,
      });
      vdbg('handshake_decision_ui_result', {
        sessionId,
        actorUserId: user.id,
        action,
        ok: result.ok,
        attempts: result.attempts,
        reason: result.ok ? null : result.reason,
        actorDecisionPersisted: result.actorDecisionPersisted,
        participant_1_liked: result.truth?.participant_1_liked ?? null,
        participant_2_liked: result.truth?.participant_2_liked ?? null,
        participant_1_decided_at: result.truth?.participant_1_decided_at ?? null,
        participant_2_decided_at: result.truth?.participant_2_decided_at ?? null,
        completeHandshakeTriggeredAfterPersistence: false,
        completeHandshakeTriggerReason: result.ok ? 'decision_rpc_owns_transition' : 'decision_not_persisted',
      });
      if (!result.ok) {
        void refetchVideoSession();
        const sessionEnded = handshakeDecisionFailureIndicatesSessionEnded({
          truth: result.truth,
          rpcPayload: result.rpcPayload,
        });
        if (sessionEnded) {
          clearHandshakeGraceState();
          vdbg('prejoin_state_callError', {
            value: null,
            sessionId,
            userId: user.id,
            step: 'handshake_decision_terminal',
          });
          setCallError(null);
          void handleCallEnd('server_end');
          return false;
        }
        vdbg('prejoin_state_callError', {
          value: result.userMessage,
          sessionId,
          userId: user.id,
          step: 'handshake_decision',
        });
        setCallError(result.userMessage);
        return false;
      }
      setCallError(null);
      // Immediately reconcile UI from server truth so that localHandshakeDecision
      // reflects the persisted decision even if the Realtime UPDATE arrives late
      // or the component remounts before it does.
      void refetchVideoSession();
      return true;
    } finally {
      handshakeDecisionInFlightRef.current = false;
    }
  }, [sessionId, user?.id, refetchVideoSession, clearHandshakeGraceState, handleCallEnd]);

  const handleUserVibe = useCallback(() => handleHandshakeDecision('vibe'), [handleHandshakeDecision]);
  const handleUserPass = useCallback(() => handleHandshakeDecision('pass'), [handleHandshakeDecision]);

  const handleMutualToastComplete = useCallback(() => {
    clearHandshakeGraceState();
    setShowMutualToast(false);
    setLocalTimeLeft(
      remainingDatePhaseSeconds({
        dateStartedAtIso: session?.date_started_at,
        baseDateSeconds: DATE_SECONDS,
        dateExtraSeconds: session?.date_extra_seconds,
      }),
    );
  }, [clearHandshakeGraceState, session?.date_extra_seconds, session?.date_started_at]);

  const handleExtend = useCallback(
    async (minutes: number, type: 'extra_time' | 'extended_vibe'): Promise<VideoDateExtendOutcome> => {
      if (!user?.id) {
        return { ok: false, userMessage: userMessageForExtensionSpendFailure('unauthorized') };
      }
      if (extensionSpendInFlightRef.current) {
        return { ok: false, userMessage: '', silent: true };
      }
      extensionSpendInFlightRef.current = true;
      const retry =
        extensionSpendRetryRef.current?.type === type ? extensionSpendRetryRef.current : null;
      const idempotencyKey = retry?.key ?? makeExtensionIdempotencyKey(sessionId ?? 'unknown-session', type);
      extensionSpendRetryRef.current = { type, key: idempotencyKey };
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_EXTENSION_ATTEMPTED, {
        platform: 'native',
        session_id: sessionId,
        event_id: eventId,
        credit_type: type,
      });
      setIsExtending(true);
      setExtendBanner(null);
      try {
        if (!sessionId) {
          extensionSpendRetryRef.current = null;
          const msg = userMessageForExtensionSpendFailure('session_not_found');
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_EXTENSION_FAILED, {
            platform: 'native',
            session_id: sessionId,
            event_id: eventId,
            credit_type: type,
            reason: 'session_not_found',
          });
          setExtendBanner({ kind: 'error', message: msg });
          return { ok: false, userMessage: msg };
        }
        const result = await spendVideoDateCreditExtension(sessionId, type, idempotencyKey);
        void fetchUserCredits(user.id).then(setCredits);
        if (result.ok) {
          extensionSpendRetryRef.current = null;
          trackEvent('video_date_extended', { session_id: sessionId });
          const addedSeconds = Math.max(0, Math.floor(result.addedSeconds || minutes * 60));
          const nextExtra =
            typeof result.dateExtraSeconds === 'number'
              ? Math.max(0, Math.floor(result.dateExtraSeconds))
              : Math.max(0, (session?.date_extra_seconds ?? 0) + addedSeconds);
          setLocalTimeLeft((prev) => {
            if (!session?.date_started_at) return (prev ?? 0) + addedSeconds;
            return remainingDatePhaseSeconds({
              dateStartedAtIso: session.date_started_at,
              baseDateSeconds: DATE_SECONDS,
              dateExtraSeconds: nextExtra,
            });
          });
          void refetchVideoSession();
          const minutesAdded = addedSeconds / 60;
          setExtendBanner({ kind: 'success', minutes: minutesAdded });
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_EXTENSION_SUCCEEDED, {
            platform: 'native',
            session_id: sessionId,
            event_id: eventId,
            credit_type: type,
            added_seconds: addedSeconds,
            date_extra_seconds: nextExtra,
            idempotent: result.idempotent === true,
          });
          return {
            ok: true,
            minutesAdded,
            secondsAdded: addedSeconds,
            dateExtraSeconds: nextExtra,
          };
        }
        extensionSpendRetryRef.current = null;
        const msg = userMessageForExtensionSpendFailure(result.error);
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_EXTENSION_FAILED, {
          platform: 'native',
          session_id: sessionId,
          event_id: eventId,
          credit_type: type,
          reason: result.error,
        });
        setExtendBanner({ kind: 'error', message: msg });
        return { ok: false, userMessage: msg };
      } finally {
        extensionSpendInFlightRef.current = false;
        setIsExtending(false);
      }
    },
    [user?.id, sessionId, eventId, refetchVideoSession, session?.date_extra_seconds, session?.date_started_at]
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
    user?.id,
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
      dateEntryPermissionEligible,
    };
    rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'date_prejoin_effect_started', {
      session_id: sessionId ?? null,
      user_id: userId,
      has_session_id: Boolean(sessionId),
      auth_loading: authLoading,
      session_loading: sessionLoading,
      auth_hydrated: !authLoading,
      session_hydrated: !sessionLoading,
      current_phase: currentPhase,
      pathname: pathname ?? null,
    });
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
      !dateEntryPermissionEligible ||
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

    const prejoinPipelineKey = nativePrejoinPipelineKey(sessionId, user.id);
    const activePrejoinPipeline =
      sharedNativePrejoinPipelineEntry?.key === prejoinPipelineKey
        ? sharedNativePrejoinPipelineEntry
        : null;
    if (activePrejoinPipeline) {
      const observerKey = `${activePrejoinPipeline.key}:${activePrejoinPipeline.attemptId}:${activePrejoinPipeline.startedAtMs}`;
      vdbg('native_prejoin_pipeline_reuse_in_flight', {
        sessionId,
        userId: user.id,
        ownerAttemptId: activePrejoinPipeline.attemptId,
        ageMs: Date.now() - activePrejoinPipeline.startedAtMs,
        hasCall: Boolean(callRef.current),
        hasSharedCall: Boolean(sharedDailyCallEntry?.sessionId === sessionId),
      });
      setJoining(true);
      setIsConnecting(true);
      if (observedNativePrejoinPipelineKeyRef.current !== observerKey) {
        observedNativePrejoinPipelineKeyRef.current = observerKey;
        void activePrejoinPipeline.promise?.finally(() => {
          const sameSessionAndUser =
            latestDateRouteSessionIdRef.current === sessionId &&
            latestDateRouteUserIdRef.current === user.id &&
            !latestDateRouteEndedRef.current;
          if (!sameSessionAndUser) return;
          vdbg('native_prejoin_pipeline_reuse_retry_after_release', {
            sessionId,
            userId: user.id,
            ownerAttemptId: activePrejoinPipeline.attemptId,
          });
          setJoinAttemptNonce((n) => n + 1);
        });
      }
      return;
    }

    const attemptId = prejoinAttemptSeqRef.current + 1;
    prejoinAttemptSeqRef.current = attemptId;
    const attemptState: PrejoinAttemptState = {
      attemptId,
      sessionId,
      userId: user.id,
      currentStep: 'effect_started',
      cancellationReason: null,
      roomAcquisitionStarted: false,
      enterHandshakeCompletedAfterCancellation: false,
      completed: false,
    };
    prejoinAttemptRef.current = attemptState;
    const prejoinLogContext = () => ({
      attemptId,
      currentStep: attemptState.currentStep,
      cancellationReason: attemptState.cancellationReason,
      hasCall: Boolean(callRef.current),
      roomAcquisitionStarted: attemptState.roomAcquisitionStarted,
      enterHandshakeCompletedAfterCancellation: attemptState.enterHandshakeCompletedAfterCancellation,
    });
    const setPrejoinStep = (step: PrejoinAttemptStep) => {
      attemptState.currentStep = step;
      if (step === 'daily_room') attemptState.roomAcquisitionStarted = true;
      return step;
    };
    const requestPrejoinRetryAfterCancellation = (reason: string) => {
      attemptState.completed = true;
      hasStartedJoinRef.current = false;
      vdbg('prejoin_state_hasStartedJoinRef', {
        value: false,
        sessionId,
        userId: user.id,
        step: attemptState.currentStep,
        reason,
        ...prejoinLogContext(),
      });
      vdbg('prejoin_state_joinAttemptNonce', {
        value: 'increment',
        sessionId,
        userId: user.id,
        step: attemptState.currentStep,
        reason,
        ...prejoinLogContext(),
      });
      setJoinAttemptNonce((n) => n + 1);
    };

    const prejoinPipelineEntry: NativePrejoinPipelineEntry = {
      key: prejoinPipelineKey,
      sessionId,
      userId: user.id,
      attemptId,
      startedAtMs: Date.now(),
      promise: null,
    };
    sharedNativePrejoinPipelineEntry = prejoinPipelineEntry;
    observedNativePrejoinPipelineKeyRef.current = `${prejoinPipelineEntry.key}:${attemptId}:${prejoinPipelineEntry.startedAtMs}`;
    vdbg('native_prejoin_pipeline_started', {
      sessionId,
      userId: user.id,
      attemptId,
    });

    hasStartedJoinRef.current = true;
    vdbg('prejoin_state_hasStartedJoinRef', {
      value: true,
      sessionId,
      userId: user.id,
      ...prejoinLogContext(),
    });
    let cancelled = false;
    let prejoinCompleted = false;
    let currentStep: PrejoinAttemptStep = 'effect_started';
    const prejoinPipelineStart = Date.now();
    let prejoinSegment = prejoinPipelineStart;
    const prejoinMark = (step: string) => {
      const t = Date.now();
      videoDateLaunchBreadcrumb(`prejoin_${step}`, {
        session_id: sessionId,
        user_id: user.id,
        duration_ms: t - prejoinSegment,
      });
      prejoinSegment = t;
    };
    const run = async () => {
      currentStep = setPrejoinStep('initial_state');
      vdbg('prejoin_state_joining', { value: true, sessionId, userId: user.id, step: currentStep, ...prejoinLogContext() });
      setJoining(true);
      vdbg('prejoin_state_callError', { value: null, sessionId, userId: user.id, step: currentStep });
      setCallError(null);
      vdbg('prejoin_state_preJoinFailed', { value: false, sessionId, userId: user.id, step: currentStep });
      setPreJoinFailed(false);
      vdbg('prejoin_state_awaitingFirstConnect', { value: false, sessionId, userId: user.id, step: currentStep });
      setAwaitingFirstConnect(false);
      clearFirstConnectWatchdog();
      const destroySharedCallForRetry = async (entry: SharedDailyCallEntry, reason: string) => {
        entry.state = 'leaving';
        entry.joinPromise = null;
        vdbg('daily_call_singleton_destroy_for_retry', {
          reason,
          sessionId,
          userId: user.id,
          roomName: entry.roomName,
          captureProfile: entry.captureProfile,
          lastError: entry.lastError,
        });
        try {
          await entry.call.leave();
        } catch {
          /* best effort */
        }
        try {
          entry.call.destroy();
        } catch {
          /* best effort */
        }
        if (callRef.current === entry.call) callRef.current = null;
        detachCallListeners(reason);
        releaseSharedCallIfOwned(entry.call, reason);
      };
      const hydrateJoinedSharedCall = (
        entry: SharedDailyCallEntry,
        participants: ReturnType<DailyCallObject['participants']>,
        source: string
      ): boolean => {
        const local = participants?.local ?? null;
        if (!local) return false;
        entry.state = 'joined';
        entry.joinPromise = null;
        entry.lastError = null;
        callRef.current = entry.call;
        roomNameRef.current = entry.roomName;
        captureProfileRef.current = entry.captureProfile;
        setCaptureProfile(entry.captureProfile);
        bindCallListeners(entry.call, entry.roomName);
        const remotes = Object.values(participants).filter((p) => !(p as unknown as { local?: boolean }).local);
        vdbg('daily_call_singleton_reuse_same_session', {
          sessionId,
          userId: user.id,
          roomName: entry.roomName,
          captureProfile: entry.captureProfile,
          remoteCount: remotes.length,
          hasLocalParticipant: true,
          source,
          state: entry.state,
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
        prejoinMark(source === 'join_promise_resolved' ? 'singleton_join_promise_resolved' : 'singleton_reuse_short_circuit');
        videoDateLaunchBreadcrumb('prejoin_pipeline_total', {
          session_id: sessionId,
          user_id: user.id,
          duration_ms: Date.now() - prejoinPipelineStart,
        });
        return true;
      };
      const sharedCall = sharedDailyCallEntry;
      if (sharedCall && sharedCall.sessionId === sessionId) {
        const reusedCall = sharedCall.call;
        let participants: ReturnType<DailyCallObject['participants']> | null = null;
        try {
          participants = reusedCall.participants();
        } catch (error) {
          sharedCall.state = 'failed';
          sharedCall.lastError = summarizeSharedDailyError(error);
          participants = null;
        }

        if (participants && hydrateJoinedSharedCall(sharedCall, participants, 'already_joined_snapshot')) {
          return;
        }

        const canAwaitSharedJoin =
          Boolean(sharedCall.joinPromise) &&
          (sharedCall.state === 'creating' || sharedCall.state === 'joining');
        if (canAwaitSharedJoin && sharedCall.joinPromise) {
          callRef.current = reusedCall;
          roomNameRef.current = sharedCall.roomName;
          captureProfileRef.current = sharedCall.captureProfile;
          setCaptureProfile(sharedCall.captureProfile);
          bindCallListeners(reusedCall, sharedCall.roomName);
          setIsConnecting(true);
          setJoining(true);
          vdbg('daily_call_singleton_reuse_join_in_flight', {
            sessionId,
            userId: user.id,
            roomName: sharedCall.roomName,
            captureProfile: sharedCall.captureProfile,
            state: sharedCall.state,
            joinStartedAtMs: sharedCall.joinStartedAtMs,
            ageMs: Date.now() - sharedCall.createdAtMs,
          });
          try {
            await sharedCall.joinPromise;
            let joinedParticipants: ReturnType<DailyCallObject['participants']> | null = null;
            try {
              joinedParticipants = reusedCall.participants();
            } catch (error) {
              sharedCall.state = 'failed';
              sharedCall.lastError = summarizeSharedDailyError(error);
              releaseSharedCallIfOwned(reusedCall, 'reuse_join_promise_participants_failed');
            }
            if (joinedParticipants && hydrateJoinedSharedCall(sharedCall, joinedParticipants, 'join_promise_resolved')) {
              return;
            }
            await destroySharedCallForRetry(sharedCall, 'reuse_join_promise_resolved_without_local');
          } catch (error) {
            sharedCall.state = 'failed';
            sharedCall.joinPromise = null;
            sharedCall.lastError = summarizeSharedDailyError(error);
            vdbg('daily_call_singleton_reuse_join_in_flight_failed', {
              sessionId,
              userId: user.id,
              roomName: sharedCall.roomName,
              error: sharedCall.lastError,
            });
            await destroySharedCallForRetry(sharedCall, 'reuse_join_in_flight_failed');
          }
        } else if (sharedCall.state === 'joining' || sharedCall.state === 'creating') {
          callRef.current = reusedCall;
          roomNameRef.current = sharedCall.roomName;
          captureProfileRef.current = sharedCall.captureProfile;
          setCaptureProfile(sharedCall.captureProfile);
          bindCallListeners(reusedCall, sharedCall.roomName);
          setIsConnecting(true);
          setJoining(true);
          vdbg('daily_call_singleton_reuse_in_flight_without_promise', {
            sessionId,
            userId: user.id,
            roomName: sharedCall.roomName,
            state: sharedCall.state,
            ageMs: Date.now() - sharedCall.createdAtMs,
          });
          return;
        } else {
          await destroySharedCallForRetry(sharedCall, 'reuse_probe_terminal_state_without_local');
        }
      }

      currentStep = setPrejoinStep('permissions');
      const ok = await requestPermissions();
      prejoinMark('permissions');
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
            value: 'Camera and microphone access are needed to begin gently.',
            sessionId,
            userId: user.id,
            step: currentStep,
          });
          setCallError('Camera and microphone access are needed to begin gently.');
        }
        hasStartedJoinRef.current = false;
        vdbg('prejoin_state_hasStartedJoinRef', { value: false, sessionId, userId: user.id, step: currentStep });
        vdbg('prejoin_state_joining', { value: false, sessionId, userId: user.id, step: currentStep });
        setJoining(false);
        prejoinCompleted = !cancelled;
        return;
      }

      currentStep = setPrejoinStep('truth_fetch');
      vdbg('prejoin_step_prejoin_truth_skipped_or_started', {
        sessionId,
        userId: user.id,
        started: true,
        reason: null,
      });
      beginBootstrapTiming('truth_fetch', { source: 'prejoin' });
      const truth0 = await fetchVideoSessionDateEntryTruthCoalesced(sessionId);
      endBootstrapTiming('truth_fetch', { source: 'prejoin', has_truth: Boolean(truth0) });
      prejoinMark('truth0_coalesced');
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
      const truthDecision0 = decideVideoSessionRouteFromTruth(truth0);
      if (truthDecision0 === 'ended') {
        vdbg('prejoin_step_prejoin_error', {
          sessionId,
          userId: user.id,
          step: currentStep,
          reason: 'session_ended_prejoin',
          endedAt: truth0.ended_at ?? null,
        });
        vdbg('prejoin_step_prejoin_daily_room_skipped', {
          sessionId,
          userId: user.id,
          reason: 'session_ended_prejoin',
          endedAt: truth0.ended_at ?? null,
        });
        if (truth0.event_id) {
          const target = eventLobbyHref(truth0.event_id as string);
          vdbgRedirect(target, 'session_ended_prejoin', {
            sessionId,
            userId: user.id,
            eventId: truth0.event_id,
            endedAt: truth0.ended_at ?? null,
          });
          router.replace(target);
        } else {
          const target = tabsRootHref();
          vdbgRedirect(target, 'session_ended_prejoin', {
            sessionId,
            userId: user.id,
            endedAt: truth0.ended_at ?? null,
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

      currentStep = setPrejoinStep('handshake_guard');
      const hasHandshakeStarted = Boolean(truth0.handshake_started_at);
      const alreadyInHandshakeOrDate = videoSessionRowIndicatesHandshakeOrDate(truth0);
      const serverPrepareOwnsHandshake = true;
      const handshakeAlready = alreadyInHandshakeOrDate || serverPrepareOwnsHandshake;
      vdbg('prejoin_step_prejoin_handshake_guard', {
        sessionId,
        userId: user.id,
        hasHandshakeStarted,
        alreadyInHandshakeOrDate,
        truthDecision: truthDecision0,
        handshakeAlready,
        willCallEnterHandshake: false,
        skipReason: alreadyInHandshakeOrDate ? 'canonical_handshake_or_date' : 'prepare_date_entry_owns_handshake',
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
          currentStep = setPrejoinStep('enter_handshake');
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
          attemptState.enterHandshakeCompletedAfterCancellation = true;
          vdbg('prejoin_step_prejoin_error', {
            sessionId,
            userId: user.id,
            step: currentStep,
            reason: 'cancelled_after_enter_handshake',
            ...prejoinLogContext(),
          });
          vdbg('prejoin_step_prejoin_daily_room_skipped', {
            sessionId,
            userId: user.id,
            reason: 'cancelled_after_enter_handshake',
            ...prejoinLogContext(),
          });
          vdbg('prejoin_state_joining', { value: false, sessionId, userId: user.id, step: currentStep });
          setJoining(false);
          requestPrejoinRetryAfterCancellation('enter_handshake_completed_after_cancellation');
          return;
        }
        let handshakeRecoveredByRetry = false;
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
            // Recover did not redirect → truth says startable now (replica/snapshot caught up).
            // Bounded refetch loop: if any iteration confirms startability, the server has already
            // applied `enter_handshake` for this session (idempotent SQL), so we proceed without
            // banner. The next prejoin step (`daily_room_truth_guard`) will re-confirm before any
            // Daily call.
            rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'ready_gate_not_ready_retry_start', {
              session_id: sessionId,
              user_id: user.id,
              source: 'enter_handshake',
              code: hs.code ?? null,
            });
            for (let i = 0; i < READY_GATE_RACE_RETRY_BACKOFFS_MS.length; i++) {
              if (cancelled) break;
              const delay = READY_GATE_RACE_RETRY_BACKOFFS_MS[i];
              await new Promise<void>((resolve) => setTimeout(resolve, delay));
              if (cancelled) break;
              const { startable } = await refetchTruthAndCheckStartable(sessionId);
              if (startable) {
                rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'ready_gate_not_ready_retry_success', {
                  session_id: sessionId,
                  user_id: user.id,
                  source: 'enter_handshake',
                  attempt: i + 1,
                  backoff_ms: delay,
                });
                handshakeRecoveredByRetry = true;
                break;
              }
            }
            if (!handshakeRecoveredByRetry) {
              rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'ready_gate_not_ready_retry_exhausted', {
                session_id: sessionId,
                user_id: user.id,
                source: 'enter_handshake',
              });
            }
          }
          if (!handshakeRecoveredByRetry) {
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
            addVideoDateBreadcrumb('enter_handshake failed', 'error', { sessionId, code: hs.code, message: hs.message });
            Sentry.captureMessage('video_date_enter_handshake_failed', {
              level: 'warning',
              extra: { sessionId, code: hs.code, message: hs.message },
            });
            // Final fatal banner — always clear latch so user can navigate away
            // (NativeSessionRouteHydration and the in-screen route guard will no longer be
            // suppressed). RGNR is the case the bug investigation surfaced; other terminal codes
            // (SESSION_ENDED, RPC_ERROR) likewise leave the user on /date and need the same
            // escape hatch.
            if (isReadyGateRace(hs.code)) {
              rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'date_entry_final_ready_gate_banner', {
                session_id: sessionId,
                user_id: user.id,
                source: 'enter_handshake',
              });
            }
            clearDateEntryTransition(sessionId);
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
        }
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'enter_handshake_ok', {
          session_id: sessionId,
          user_id: user?.id ?? null,
          event_id: truth0.event_id,
          vs_state: truth0.state,
          vs_phase: truth0.phase,
          recovered_by_retry: handshakeRecoveredByRetry,
        });
        videoDateDailyDiagnostic('enter_handshake_success', { session_id: sessionId });
        enterHandshakeSucceededRef.current = true;
      } else {
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'enter_handshake_skipped', {
          session_id: sessionId,
          user_id: user?.id ?? null,
          event_id: truth0.event_id,
          reason: alreadyInHandshakeOrDate ? 'handshake_already_started' : 'prepare_date_entry_owns_handshake',
        });
        videoDateDailyDiagnostic('enter_handshake_skipped', {
          session_id: sessionId,
          note: alreadyInHandshakeOrDate ? 'handshake_already_started' : 'prepare_date_entry_owns_handshake',
        });
        vdbg('prejoin_step_prejoin_enter_handshake_skipped', {
          sessionId,
          userId: user.id,
          reason: alreadyInHandshakeOrDate ? 'handshake_already_started' : 'prepare_date_entry_owns_handshake',
          hasHandshakeStarted,
          alreadyInHandshakeOrDate,
          truthDecision: truthDecision0,
          state: truth0.state,
          phase: truth0.phase,
        });
        enterHandshakeSucceededRef.current = true;
      }

      prejoinMark('enter_handshake_or_skip');
      currentStep = setPrejoinStep('refetch_video_session');
      vdbg('prejoin_step_prejoin_refetch_before', { sessionId, userId: user.id, blocking: false });
      videoDateLaunchBreadcrumb('prejoin_refetch_video_session_scheduled', {
        session_id: sessionId,
        user_id: user.id,
      });
      void refetchVideoSession();
      vdbg('prejoin_step_prejoin_refetch_after', { sessionId, userId: user.id, ok: true, blocking: false });
      if (cancelled) {
        vdbg('prejoin_step_prejoin_cancelled', {
          sessionId,
          userId: user.id,
          step: currentStep,
          reason: 'effect_cancelled_post_refetch',
          preserveStartedJoin: false,
          ...prejoinLogContext(),
        });
        vdbg('prejoin_step_prejoin_daily_room_cancelled', {
          sessionId,
          userId: user.id,
          reason: 'effect_cancelled_post_refetch',
          preserveStartedJoin: false,
          ...prejoinLogContext(),
        });
        vdbg('prejoin_state_joining', { value: false, sessionId, userId: user.id, step: currentStep });
        setJoining(false);
        requestPrejoinRetryAfterCancellation('effect_cancelled_post_refetch');
        return;
      }

      currentStep = setPrejoinStep('daily_room_truth_guard');
      let truth1 = await fetchVideoSessionDateEntryTruth(sessionId);
      prejoinMark('truth1_post_handshake');
      vdbg('date_prejoin_truth_daily_room_guard', { sessionId, userId: user.id, row: truth1 ?? null });
      if (!canAttemptDailyRoomFromVideoSessionTruth(truth1)) {
        const redirected = await recoverFromNotStartableDateTruth('create_date_room');
        if (redirected) {
          hasStartedJoinRef.current = false;
          vdbg('prejoin_state_hasStartedJoinRef', { value: false, sessionId, userId: user.id, step: currentStep });
          vdbg('prejoin_state_joining', { value: false, sessionId, userId: user.id, step: currentStep });
          setJoining(false);
          prejoinCompleted = true;
          return;
        }
        // Recover did not redirect — bounded refetch loop in case truth has caught up between
        // the in-screen guard and recovery's own refetch (cross-region / replica lag).
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'ready_gate_not_ready_retry_start', {
          session_id: sessionId,
          user_id: user.id,
          source: 'daily_room_truth_guard',
        });
        let truthGuardRecovered = false;
        for (let i = 0; i < READY_GATE_RACE_RETRY_BACKOFFS_MS.length; i++) {
          if (cancelled) break;
          const delay = READY_GATE_RACE_RETRY_BACKOFFS_MS[i];
          await new Promise<void>((resolve) => setTimeout(resolve, delay));
          if (cancelled) break;
          const { startable, truth: refreshed } = await refetchTruthAndCheckStartable(sessionId);
          if (startable) {
            truth1 = refreshed;
            rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'ready_gate_not_ready_retry_success', {
              session_id: sessionId,
              user_id: user.id,
              source: 'daily_room_truth_guard',
              attempt: i + 1,
              backoff_ms: delay,
            });
            truthGuardRecovered = true;
            break;
          }
        }
        if (!truthGuardRecovered) {
          rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'ready_gate_not_ready_retry_exhausted', {
            session_id: sessionId,
            user_id: user.id,
            source: 'daily_room_truth_guard',
          });
          rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'date_entry_final_ready_gate_banner', {
            session_id: sessionId,
            user_id: user.id,
            source: 'daily_room_truth_guard',
          });
          // Clear latch so the user can navigate away (back-button, app foreground hydration, etc.)
          // and so a future attempt is not silently suppressed by a stale latch.
          clearDateEntryTransition(sessionId);
          vdbg('prejoin_step_prejoin_daily_room_skipped', {
            sessionId,
            userId: user.id,
            reason: 'client_daily_gate_not_startable',
            row: truth1 ?? null,
          });
          vdbg('prejoin_state_callError', {
            value: 'Almost there — finish the Ready Gate with your match first.',
            sessionId,
            userId: user.id,
            step: currentStep,
          });
          setCallError('Almost there — finish the Ready Gate with your match first.');
          vdbg('prejoin_state_preJoinFailed', { value: true, sessionId, userId: user.id, step: currentStep });
          setPreJoinFailed(true);
          hasStartedJoinRef.current = false;
          vdbg('prejoin_state_hasStartedJoinRef', { value: false, sessionId, userId: user.id, step: currentStep });
          vdbg('prejoin_state_joining', { value: false, sessionId, userId: user.id, step: currentStep });
          setJoining(false);
          prejoinCompleted = true;
          return;
        }
      }

      currentStep = setPrejoinStep('daily_room_guard');
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
      let dailyTokenStartedAtMs = Date.now();
      try {
        currentStep = setPrejoinStep('daily_room');
        dailyTokenStartedAtMs = Date.now();
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'create_date_room_start', {
          session_id: sessionId,
          user_id: user?.id ?? null,
          event_id: truth0.event_id,
          vs_state: truth0.state,
          vs_phase: truth0.phase,
        });
        videoDateDailyDiagnostic('token_fetch_start', { session_id: sessionId });
        beginBootstrapTiming('daily_room_acquire', { source: 'prejoin' });
        vdbg('prejoin_step_prejoin_daily_room_before', {
          sessionId,
          userId: user.id,
          timeoutMs: PREJOIN_STEP_TIMEOUT_MS,
        });
        tokenRes = await getDailyRoomTokenWithTimeout(sessionId, PREJOIN_STEP_TIMEOUT_MS);
        endBootstrapTiming('daily_room_acquire', {
          source: 'prejoin',
          ok: tokenRes.ok,
          code: tokenRes.ok ? null : tokenRes.code ?? null,
        });
        prejoinMark('daily_room_edge_invoke');
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
        const tokenDurationMs = Date.now() - dailyTokenStartedAtMs;
        endBootstrapTiming('daily_room_acquire', {
          source: 'prejoin',
          ok: false,
          timed_out: timedOut,
          exception: true,
        });
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
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_FAILURE, {
          platform: 'native',
          session_id: sessionId,
          event_id: eventId || null,
          source_surface: 'video_date_daily',
          source_action: 'daily_token_failure',
          reason_code: timedOut ? 'timeout' : 'exception',
          code: timedOut ? 'timeout' : 'exception',
          failure_class: classifyDailyRoomTokenFailureClass('network'),
          duration_ms: tokenDurationMs,
          latency_bucket: bucketVideoDateLatencyMs(tokenDurationMs),
          attempt_count: 1,
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
          ...prejoinLogContext(),
        });
        vdbg('prejoin_step_prejoin_daily_room_skipped', {
          sessionId,
          userId: user.id,
          reason: 'cancelled_after_daily_room',
          ...prejoinLogContext(),
        });
        vdbg('prejoin_state_joining', { value: false, sessionId, userId: user.id, step: currentStep });
        setJoining(false);
        requestPrejoinRetryAfterCancellation('daily_room_completed_after_cancellation');
        return;
      }
      if (!tokenRes.ok) {
        if (tokenRes.code === 'READY_GATE_NOT_READY') {
          const redirected = await recoverFromNotStartableDateTruth('create_date_room');
          if (redirected) {
            hasStartedJoinRef.current = false;
            vdbg('prejoin_state_hasStartedJoinRef', { value: false, sessionId, userId: user.id, step: currentStep });
            vdbg('prejoin_state_joining', { value: false, sessionId, userId: user.id, step: currentStep });
            setJoining(false);
            prejoinCompleted = true;
            return;
          }
          // Recover did not redirect: truth says startable, but daily-room read on the server side
          // may have hit a stale snapshot. Bounded retry — refetch truth, retry create_date_room.
          rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'ready_gate_not_ready_retry_start', {
            session_id: sessionId,
            user_id: user.id,
            source: 'create_date_room',
          });
          let dailyRoomRecovered = false;
          for (let i = 0; i < READY_GATE_RACE_RETRY_BACKOFFS_MS.length; i++) {
            if (cancelled) break;
            const delay = READY_GATE_RACE_RETRY_BACKOFFS_MS[i];
            await new Promise<void>((resolve) => setTimeout(resolve, delay));
            if (cancelled) break;
            const { startable } = await refetchTruthAndCheckStartable(sessionId);
            if (!startable) continue;
            try {
              const retried = await getDailyRoomTokenWithTimeout(sessionId, PREJOIN_STEP_TIMEOUT_MS);
              if (retried.ok) {
                tokenRes = retried;
                dailyRoomRecovered = true;
                rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'ready_gate_not_ready_retry_success', {
                  session_id: sessionId,
                  user_id: user.id,
                  source: 'create_date_room',
                  attempt: i + 1,
                  backoff_ms: delay,
                });
                break;
              }
              if (retried.code !== 'READY_GATE_NOT_READY') {
                tokenRes = retried;
                break;
              }
            } catch {
              // network/timeout — continue to next backoff
            }
          }
          if (!dailyRoomRecovered && !tokenRes.ok) {
            rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'ready_gate_not_ready_retry_exhausted', {
              session_id: sessionId,
              user_id: user.id,
              source: 'create_date_room',
            });
          }
        }
      }
      if (!tokenRes.ok) {
        const tokenDurationMs = Date.now() - dailyTokenStartedAtMs;
        vdbg('prejoin_step_prejoin_error', {
          sessionId,
          userId: user.id,
          step: currentStep,
          reason: 'daily_room_not_ok',
          code: tokenRes.code ?? null,
          httpStatus: tokenRes.httpStatus ?? null,
          serverCode: tokenRes.serverCode ?? null,
          entryAttemptId: tokenRes.entry_attempt_id ?? null,
          videoDateTraceId: tokenRes.video_date_trace_id ?? tokenRes.entry_attempt_id ?? null,
        });
        videoDateDailyDiagnostic('token_fetch_failure', {
          session_id: sessionId,
          code: String(tokenRes.code),
          http_status: tokenRes.httpStatus ?? null,
          server_code: tokenRes.serverCode != null ? String(tokenRes.serverCode) : null,
          entry_attempt_id: tokenRes.entry_attempt_id ?? null,
          video_date_trace_id: tokenRes.video_date_trace_id ?? tokenRes.entry_attempt_id ?? null,
        });
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_FAILURE, {
          platform: 'native',
          session_id: sessionId,
          event_id: eventId || null,
          source_surface: 'video_date_daily',
          source_action: 'daily_token_failure',
          reason_code: String(tokenRes.code),
          code: String(tokenRes.code),
          failure_class: classifyDailyRoomTokenFailureClass(tokenRes.code),
          retryable: tokenRes.code === 'READY_GATE_NOT_READY',
          duration_ms: tokenDurationMs,
          latency_bucket: bucketVideoDateLatencyMs(tokenDurationMs),
          attempt_count: 1,
          entry_attempt_id: tokenRes.entry_attempt_id ?? null,
          video_date_trace_id: tokenRes.video_date_trace_id ?? tokenRes.entry_attempt_id ?? null,
        });
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'create_date_room_fail', {
          session_id: sessionId,
          code: String(tokenRes.code),
          http_status: tokenRes.httpStatus ?? null,
          entry_attempt_id: tokenRes.entry_attempt_id ?? null,
          video_date_trace_id: tokenRes.video_date_trace_id ?? tokenRes.entry_attempt_id ?? null,
        });
        addVideoDateBreadcrumb('create_date_room failed', 'error', {
          sessionId,
          code: tokenRes.code,
          httpStatus: tokenRes.httpStatus,
          serverCode: tokenRes.serverCode,
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
        // Final fatal banner — always clear latch so user can navigate away. Without this, the
        // hydration / route-guard bounce remains suppressed and the user is pinned to /date.
        if (tokenRes.code === 'READY_GATE_NOT_READY') {
          rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'date_entry_final_ready_gate_banner', {
            session_id: sessionId,
            user_id: user.id,
            source: 'create_date_room',
          });
        }
        clearDateEntryTransition(sessionId);
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
      activePreparedEntryCacheRef.current = getPreparedVideoDateEntry(sessionId, user.id);
      const entryAttemptId = tokenResult.entry_attempt_id ?? activePreparedEntryCacheRef.current?.entryAttemptId ?? null;
      const videoDateTraceId =
        tokenResult.video_date_trace_id ??
        activePreparedEntryCacheRef.current?.value.video_date_trace_id ??
        entryAttemptId;
      const tokenDurationMs = Date.now() - dailyTokenStartedAtMs;
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_TOKEN_SUCCESS, {
        platform: 'native',
        session_id: sessionId,
        event_id: eventId || null,
        source_surface: 'video_date_daily',
        source_action: 'daily_token_success',
        duration_ms: tokenDurationMs,
        latency_bucket: bucketVideoDateLatencyMs(tokenDurationMs),
        attempt_count: 1,
        entry_attempt_id: entryAttemptId,
        video_date_trace_id: videoDateTraceId,
      });
      rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'create_date_room_ok', {
        session_id: sessionId,
        user_id: user?.id ?? null,
        room_name: tokenResult.room_name,
        entry_attempt_id: entryAttemptId,
        video_date_trace_id: videoDateTraceId,
      });
      videoDateDailyDiagnostic('token_fetch_success', {
        session_id: sessionId,
        room_name: tokenResult.room_name,
        entry_attempt_id: entryAttemptId,
        video_date_trace_id: videoDateTraceId,
      });

      if (sharedDailyCallEntry && sharedDailyCallEntry.sessionId !== sessionId) {
        vdbg('daily_call_singleton_destroy_previous_session', {
          previousSessionId: sharedDailyCallEntry.sessionId,
          nextSessionId: sessionId,
          roomName: sharedDailyCallEntry.roomName,
          state: sharedDailyCallEntry.state,
        });
        sharedDailyCallEntry.state = 'leaving';
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

      let callCaptureProfile: NativeVideoDateCaptureProfile = 'ideal';
      const installDailyCall = (profile: NativeVideoDateCaptureProfile) => {
        const nextCall = createVideoDateDailyCallObject(profile);
        sharedDailyCallEntry = {
          sessionId,
          call: nextCall,
          roomName: tokenResult.room_name,
          captureProfile: profile,
          state: 'creating',
          joinPromise: null,
          createdAtMs: Date.now(),
          joinStartedAtMs: null,
          lastError: null,
        };
        captureProfileRef.current = profile;
        setCaptureProfile(profile);
        vdbg('daily_call_singleton_create', {
          sessionId,
          userId: user.id,
          roomName: tokenResult.room_name,
          captureProfile: profile,
        });
        videoDateDailyDiagnostic('daily_call_object_created', {
          session_id: sessionId,
          room_name: tokenResult.room_name,
          capture_profile: profile,
        });
        callRef.current = nextCall;
        roomNameRef.current = tokenResult.room_name;
        bindCallListeners(nextCall, tokenResult.room_name);
        return nextCall;
      };
      let call = installDailyCall(callCaptureProfile);
      let joinPromise: Promise<void> | null = null;
      const markSharedJoinInFlight = () => {
        if (!joinPromise) return;
        if (sharedDailyCallEntry?.sessionId !== sessionId || sharedDailyCallEntry.call !== call) return;
        sharedDailyCallEntry.state = 'joining';
        sharedDailyCallEntry.joinPromise = joinPromise;
        sharedDailyCallEntry.joinStartedAtMs = dailyJoinStartedAtMsRef.current ?? Date.now();
        sharedDailyCallEntry.lastError = null;
      };
      vdbg('prejoin_state_isConnecting', {
        value: true,
        sessionId,
        userId: user.id,
        step: 'daily_call_object_created',
        roomName: tokenResult.room_name,
        captureProfile: callCaptureProfile,
      });
      setIsConnecting(true);

      try {
        currentStep = setPrejoinStep('daily_join');
        const dailyJoinStartedAtMs = Date.now();
        dailyJoinStartedAtMsRef.current = dailyJoinStartedAtMs;
        const prepareToJoinStartMs = preparedEntryPrepareToJoinStartMs(
          activePreparedEntryCacheRef.current,
          dailyJoinStartedAtMs,
        );
        const joinStartLatencyContext = recordReadyGateToDateLatencyCheckpoint({
          sessionId,
          platform: 'native',
          eventId: eventId || null,
          sourceSurface: 'video_date_daily',
          checkpoint: 'daily_join_started',
          nowMs: dailyJoinStartedAtMs,
          attemptCount: preparedJoinRetryUsedRef.current ? 2 : 1,
        });
        trackEvent(
          LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
          buildReadyGateToDateLatencyPayload({
            context: joinStartLatencyContext,
            checkpoint: 'daily_join_started',
            sourceAction: preparedJoinRetryUsedRef.current ? 'daily_join_retry_started' : 'daily_join_started',
            outcome: 'success',
            attemptCount: preparedJoinRetryUsedRef.current ? 2 : 1,
          }),
        );
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'daily_join_start', {
          session_id: sessionId,
          user_id: user?.id ?? null,
          room_name: tokenResult.room_name,
          capture_profile: callCaptureProfile,
          prepare_to_join_start_ms: prepareToJoinStartMs,
          entry_attempt_id: entryAttemptId,
          video_date_trace_id: videoDateTraceId,
        });
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_JOIN_STARTED, {
          platform: 'native',
          session_id: sessionId,
          event_id: eventId || null,
          source_surface: 'video_date_daily',
          source_action: preparedJoinRetryUsedRef.current ? 'daily_join_retry_started' : 'daily_join_started',
          capture_profile: callCaptureProfile,
          prepareToJoinStartMs,
          duration_ms: prepareToJoinStartMs,
          latency_bucket: bucketVideoDateLatencyMs(prepareToJoinStartMs),
          attempt_count: preparedJoinRetryUsedRef.current ? 2 : 1,
          cached_prepare_entry: Boolean(activePreparedEntryCacheRef.current),
          entry_attempt_id: entryAttemptId,
          video_date_trace_id: videoDateTraceId,
        });
        videoDateDailyDiagnostic('daily_call_join_start', {
          session_id: sessionId,
          room_name: tokenResult.room_name,
          capture_profile: callCaptureProfile,
          entry_attempt_id: entryAttemptId,
          video_date_trace_id: videoDateTraceId,
        });
        beginBootstrapTiming('daily_join', { room_name: tokenResult.room_name });
        beginBootstrapTiming('first_ice_connected', { room_name: tokenResult.room_name });
        beginBootstrapTiming('first_remote_participant', { room_name: tokenResult.room_name });
        beginBootstrapTiming('first_playable_remote_media', { room_name: tokenResult.room_name });
        addVideoDateBreadcrumb('Joining call', 'info', { sessionId });
        vdbg('prejoin_step_prejoin_daily_join_before', {
          sessionId,
          userId: user.id,
          roomName: tokenResult.room_name,
          captureProfile: callCaptureProfile,
          hasRoomUrl: Boolean(tokenResult.room_url),
          hasToken: Boolean(tokenResult.token),
          entryAttemptId,
          videoDateTraceId,
        });
        const joinDailyCall = async () => {
          try {
            await call.join({ url: tokenResult.room_url, token: tokenResult.token });
            return;
          } catch (joinError) {
            if (
              callCaptureProfile !== 'ideal' ||
              !isNativeVideoDateCameraConstraintError(joinError)
            ) {
              throw joinError;
            }
            vdbg('daily_call_join_constraint_fallback', {
              sessionId,
              userId: user.id,
              roomName: tokenResult.room_name,
              fromCaptureProfile: callCaptureProfile,
              toCaptureProfile: 'fallback',
              error:
                joinError instanceof Error
                  ? { name: joinError.name, message: joinError.message }
                  : String(joinError),
            });
            videoDateDailyDiagnostic('daily_call_join_constraint_fallback', {
              session_id: sessionId,
              room_name: tokenResult.room_name,
              from_capture_profile: callCaptureProfile,
              to_capture_profile: 'fallback',
            });
            try {
              await call.leave();
            } catch {
              /* best effort */
            }
            try {
              call.destroy();
            } catch {
              /* best effort */
            }
            detachCallListeners('daily_join_constraint_fallback');
            releaseSharedCallIfOwned(call, 'daily_join_constraint_fallback');
            callRef.current = null;
            callCaptureProfile = 'fallback';
            call = installDailyCall(callCaptureProfile);
            markSharedJoinInFlight();
            await call.join({ url: tokenResult.room_url, token: tokenResult.token });
          }
        };
        joinPromise = joinDailyCall();
        markSharedJoinInFlight();
        await joinPromise;
        await ensureNativeFrontCameraIntent(call, {
          sessionId,
          roomName: tokenResult.room_name,
          captureProfile: callCaptureProfile,
        });
        if (sharedDailyCallEntry?.sessionId === sessionId && sharedDailyCallEntry.call === call) {
          sharedDailyCallEntry.state = 'joined';
          sharedDailyCallEntry.joinPromise = null;
          sharedDailyCallEntry.lastError = null;
        }
        const joinDurationMs = Date.now() - dailyJoinStartedAtMs;
        endBootstrapTiming('daily_join', { ok: true, room_name: tokenResult.room_name });
        prejoinMark('daily_join_completed');
        videoDateLaunchBreadcrumb('prejoin_pipeline_total', {
          session_id: sessionId,
          user_id: user.id,
          duration_ms: Date.now() - prejoinPipelineStart,
        });
        vdbg('prejoin_step_prejoin_daily_join_after', {
          sessionId,
          userId: user.id,
          ok: true,
          cancelled,
          roomName: tokenResult.room_name,
          captureProfile: callCaptureProfile,
          entryAttemptId,
          videoDateTraceId,
        });
        if (cancelled) {
          vdbg('prejoin_step_prejoin_daily_join_completed_after_cancellation', {
            sessionId,
            userId: user.id,
            roomName: tokenResult.room_name,
            ...prejoinLogContext(),
          });
        }
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'daily_join_ok', {
          session_id: sessionId,
          user_id: user?.id ?? null,
          room_name: tokenResult.room_name,
          capture_profile: callCaptureProfile,
          join_duration_ms: joinDurationMs,
          entry_attempt_id: entryAttemptId,
          video_date_trace_id: videoDateTraceId,
        });
        const joinSuccessLatencyContext = recordReadyGateToDateLatencyCheckpoint({
          sessionId,
          platform: 'native',
          eventId: eventId || null,
          sourceSurface: 'video_date_daily',
          checkpoint: 'daily_join_success',
          nowMs: Date.now(),
          attemptCount: preparedJoinRetryUsedRef.current ? 2 : 1,
        });
        const joinSuccessPayload = buildReadyGateToDateLatencyPayload({
          context: joinSuccessLatencyContext,
          checkpoint: 'daily_join_success',
          sourceAction: 'daily_join_success',
          outcome: 'success',
          attemptCount: preparedJoinRetryUsedRef.current ? 2 : 1,
        });
        trackEvent(LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT, joinSuccessPayload);
        trackEvent(LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_COMPLETED, joinSuccessPayload);
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_JOIN_SUCCESS, {
          platform: 'native',
          session_id: sessionId,
          event_id: eventId || null,
          source_surface: 'video_date_daily',
          source_action: 'daily_join_success',
          capture_profile: callCaptureProfile,
          joinDurationMs,
          duration_ms: joinDurationMs,
          latency_bucket: bucketVideoDateLatencyMs(joinDurationMs),
          attempt_count: preparedJoinRetryUsedRef.current ? 2 : 1,
          bothReadyToDailyJoinMs: joinSuccessPayload.bothReadyToDailyJoinMs,
          prepareToJoinStartMs,
          cached_prepare_entry: Boolean(activePreparedEntryCacheRef.current),
          entry_attempt_id: entryAttemptId,
          video_date_trace_id: videoDateTraceId,
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
          capture_profile: callCaptureProfile,
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
        void markDailyJoinedWithBackoff({
          confirm: async (attempt) => {
            const { data: joinedData, error: joinedError } = await supabase.rpc('mark_video_date_daily_joined', {
              p_session_id: sessionId,
            });
            const payload = joinedData as { ok?: boolean; error?: string | null } | null;
            const ok = !joinedError && payload?.ok === true;
            const code = joinedError?.code ?? payload?.error ?? null;
            if (__DEV__) {
              vdbg('mark_video_date_daily_joined_after', {
                sessionId,
                userId: user.id,
                attempt,
                ok,
                code,
                error: joinedError ? { code: joinedError.code, message: joinedError.message } : null,
              });
            }
            return {
              ok,
              code,
              retryable: joinedError ? true : undefined,
              error: joinedError ?? undefined,
              payload: joinedData ?? null,
            };
          },
          onAttemptResult: ({ attempt, ok, code, retryable, willRetry }) => {
            if (!ok && attempt === 1) {
              setCallError("Keeping your date state in sync...");
              trackEvent(LobbyPostDateEvents.MARK_VIDEO_DATE_DAILY_JOINED_FAILED, {
                platform: 'native',
                session_id: sessionId,
                event_id: eventId || null,
                code,
                retryable,
                will_retry: willRetry,
                entry_attempt_id: entryAttemptId,
                video_date_trace_id: videoDateTraceId,
              });
            }
            if (__DEV__ && attempt > 1) {
              vdbg('mark_video_date_daily_joined_retry_after_failure', {
                sessionId,
                userId: user.id,
                attempt,
                ok,
                code,
                retryable,
                willRetry,
              });
            }
          },
        }).then((result) => {
          if (!result.ok) {
            void emitNativeVideoDateClientStuckState({
              sessionId,
              eventName: 'daily_join_confirmation_failed',
              payload: {
                source_surface: 'video_date_daily',
                source_action: 'mark_video_date_daily_joined',
                reason_code: result.code ?? 'unknown',
                code: result.code ?? 'unknown',
                retryable: result.retryable,
                exhausted: result.exhausted,
                attempt_count: result.attempts,
                entry_attempt_id: entryAttemptId ?? undefined,
                video_date_trace_id: videoDateTraceId ?? undefined,
              },
            });
          }
          if (result.ok) {
            setCallError(null);
            void refetchVideoSession();
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
          if (!firstRemoteParticipantTimedRef.current) {
            firstRemoteParticipantTimedRef.current = true;
            endBootstrapTiming('first_remote_participant', {
              source: 'post_join_snapshot',
              participant_id: dailyParticipantId(remotes[0] as DailyParticipant) ?? 'unknown',
              room_name: tokenResult.room_name,
            });
            const latencyContext = recordReadyGateToDateLatencyCheckpoint({
              sessionId,
              platform: 'native',
              eventId: eventId || null,
              sourceSurface: 'video_date_daily',
              checkpoint: 'remote_seen',
            });
            const latencyPayload = buildReadyGateToDateLatencyPayload({
              context: latencyContext,
              checkpoint: 'remote_seen',
              sourceAction: 'post_join_snapshot',
              outcome: 'success',
            });
            trackEvent(LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT, latencyPayload);
            trackEvent(LobbyPostDateEvents.VIDEO_DATE_REMOTE_SEEN, {
              platform: 'native',
              session_id: sessionId,
              event_id: eventId || null,
              source_surface: 'video_date_daily',
              source_action: 'post_join_snapshot',
              source: 'post_join_snapshot',
              duration_ms: latencyPayload.bothReadyToRemoteSeenMs,
              latency_bucket: latencyPayload.latency_bucket,
            });
          }
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
        if (sharedDailyCallEntry?.sessionId === sessionId && sharedDailyCallEntry.call === call) {
          sharedDailyCallEntry.state = 'failed';
          sharedDailyCallEntry.joinPromise = null;
          sharedDailyCallEntry.lastError = summarizeSharedDailyError(err);
        }
        const preparedEntryAtFailure = activePreparedEntryCacheRef.current;
        endBootstrapTiming('daily_join', {
          ok: false,
          room_name: tokenResult.room_name,
          exception: true,
        });
        vdbg('prejoin_step_prejoin_daily_join_after', {
          sessionId,
          userId: user.id,
          ok: false,
          roomName: tokenResult.room_name,
          captureProfile: callCaptureProfile,
          error: err instanceof Error ? err.message : String(err),
          entryAttemptId: preparedEntryAtFailure?.entryAttemptId ?? entryAttemptId,
          videoDateTraceId: preparedEntryAtFailure?.value.video_date_trace_id ?? videoDateTraceId,
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
          capture_profile: callCaptureProfile,
        });
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'daily_join_fail', {
          session_id: sessionId,
          user_id: user?.id ?? null,
          room_name: tokenResult.room_name,
          capture_profile: callCaptureProfile,
        });
        const failureContext = recordReadyGateToDateLatencyCheckpoint({
          sessionId,
          platform: 'native',
          eventId: eventId || null,
          sourceSurface: 'video_date_daily',
          checkpoint: 'daily_join_failure',
          attemptCount: preparedJoinRetryUsedRef.current ? 2 : 1,
        });
        trackEvent(
          LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
          buildReadyGateToDateLatencyPayload({
            context: failureContext,
            checkpoint: 'daily_join_failure',
            sourceAction: 'daily_join_failure',
            outcome: 'failure',
            reasonCode: 'daily_join_failed',
            attemptCount: preparedJoinRetryUsedRef.current ? 2 : 1,
          }),
        );
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_JOIN_FAILURE, {
          platform: 'native',
          session_id: sessionId,
          event_id: eventId || null,
          source_surface: 'video_date_daily',
          source_action: 'daily_join_failure',
          capture_profile: callCaptureProfile,
          reason: 'daily_join_failed',
          reason_code: 'daily_join_failed',
          entry_attempt_id: preparedEntryAtFailure?.entryAttemptId ?? entryAttemptId,
          video_date_trace_id: preparedEntryAtFailure?.value.video_date_trace_id ?? videoDateTraceId,
        });
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_DAILY_JOIN_FAILURE, {
          platform: 'native',
          session_id: sessionId,
          event_id: eventId || null,
          source_surface: 'video_date_daily',
          source_action: 'daily_join_failure',
          capture_profile: callCaptureProfile,
          reason: 'daily_join_failed',
          reason_code: 'daily_join_failed',
          entry_attempt_id: preparedEntryAtFailure?.entryAttemptId ?? entryAttemptId,
          video_date_trace_id: preparedEntryAtFailure?.value.video_date_trace_id ?? videoDateTraceId,
        });
        if (preparedEntryAtFailure && !preparedJoinRetryUsedRef.current) {
          preparedJoinRetryUsedRef.current = true;
          rejectPreparedVideoDateEntry(sessionId, user.id, 'daily_join_failed', eventId || null);
          try {
            await call.leave();
          } catch {
            /* best effort */
          }
          try {
            call.destroy();
          } catch {
            /* best effort */
          }
          detachCallListeners('daily_join_failed_prepare_retry');
          releaseSharedCallIfOwned(call, 'daily_join_failed_prepare_retry');
          callRef.current = null;
          activePreparedEntryCacheRef.current = null;
          hasStartedJoinRef.current = false;
          setJoining(false);
          setIsConnecting(false);
          setJoinAttemptNonce((n) => n + 1);
          vdbg('prejoin_step_prejoin_daily_join_retry_after_prepared_token_rejected', {
            sessionId,
            userId: user.id,
            roomName: tokenResult.room_name,
          });
          return;
        }
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
      attemptState.completed = true;
    };

    const runPromise = run();
    prejoinPipelineEntry.promise = runPromise;
    void runPromise.finally(() => {
      if (sharedNativePrejoinPipelineEntry !== prejoinPipelineEntry) return;
      vdbg('native_prejoin_pipeline_release', {
        sessionId,
        userId: user.id,
        attemptId,
        completed: attemptState.completed,
        currentStep: attemptState.currentStep,
        cancellationReason: attemptState.cancellationReason,
        hasSharedCall: Boolean(sharedDailyCallEntry?.sessionId === sessionId),
      });
      sharedNativePrejoinPipelineEntry = null;
    });
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
      const cancellationReason = callRef.current
        ? 'prejoin_effect_cleanup_live_call'
        : shouldPreservePrejoinAttemptOnCleanup(currentStep)
          ? 'prejoin_effect_cleanup_preserve_in_flight'
          : 'prejoin_effect_cleanup_without_call';
      attemptState.cancellationReason = cancellationReason;
      if (!prejoinCompleted) {
        vdbg('prejoin_step_prejoin_effect_cleanup', {
          sessionId,
          userId: user?.id ?? null,
          currentStep,
          attemptId,
          cancellationReason,
          hasCall: Boolean(callRef.current),
          hasStartedJoin: hasStartedJoinRef.current,
          roomAcquisitionStarted: attemptState.roomAcquisitionStarted,
          enterHandshakeCompletedAfterCancellation: attemptState.enterHandshakeCompletedAfterCancellation,
        });
      }
      const sameSessionAndUser =
        latestDateRouteSessionIdRef.current === sessionId &&
        latestDateRouteUserIdRef.current === (user?.id ?? null) &&
        !latestDateRouteEndedRef.current;
      const preserveInFlight =
        sameSessionAndUser &&
        !callRef.current &&
        shouldPreservePrejoinAttemptOnCleanup(currentStep);
      if (preserveInFlight) {
        vdbg('prejoin_effect_cleanup_preserved_active_pipeline', {
          sessionId,
          userId: user?.id ?? null,
          currentStep,
          attemptId,
          cancellationReason,
          sameSessionAndUser,
          hasCall: false,
          hasStartedJoin: hasStartedJoinRef.current,
          roomAcquisitionStarted: attemptState.roomAcquisitionStarted,
        });
        return;
      }
      cancelled = true;
      if (!callRef.current) {
        if (shouldPreservePrejoinAttemptOnCleanup(currentStep)) {
          vdbg('prejoin_state_hasStartedJoinRef', {
            value: hasStartedJoinRef.current,
            sessionId,
            userId: user?.id ?? null,
            step: 'cleanup_preserve_in_flight',
            ...prejoinLogContext(),
          });
        } else {
          hasStartedJoinRef.current = false;
          vdbg('prejoin_state_hasStartedJoinRef', {
            value: false,
            sessionId,
            userId: user?.id ?? null,
            step: 'cleanup_without_call',
            ...prejoinLogContext(),
          });
        }
      }
    };
    // Prejoin owns a live Daily call pipeline; avoid restarting it for broad session/joining object identity churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    joinAttemptNonce,
    sessionId,
    user?.id,
    authLoading,
    sessionLoading,
    pathname,
    session?.id,
    session?.ended_at,
    dateEntryPermissionEligible,
    sessionError,
    requestPermissions,
    clearFirstConnectWatchdog,
    bindCallListeners,
    releaseSharedCallIfOwned,
    detachCallListeners,
    refetchVideoSession,
    recoverFromNotStartableDateTruth,
    beginBootstrapTiming,
    endBootstrapTiming,
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
      if (cancelled) return;
      await openNativePostDateSurveyFromTerminalTruth('terminal_session_recovery', session);
    })();
    return () => {
      cancelled = true;
    };
    // Terminal recovery intentionally follows selected session fields so survey recovery is not re-run for every session object refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sessionId,
    user?.id,
    showFeedback,
    phase,
    eventId,
    session?.event_id,
    session?.ended_at,
    session?.state,
    session?.phase,
    session?.ended_reason,
    session?.date_started_at,
    session?.participant_1_id,
    session?.participant_2_id,
    openNativePostDateSurveyFromTerminalTruth,
  ]);

  /** Partner/backend ended session (realtime): show survey when we had joined the room; tear down Daily if still up. */
  useEffect(() => {
    if (phase !== 'ended' || !sessionId) return;
    clearHandshakeGraceState();
    void handleCallEnd('server_end');
  }, [phase, sessionId, handleCallEnd, clearHandshakeGraceState]);

  const completeHandshakeFromServerDeadline = useCallback(
    async (source: string, allowRetry = true) => {
      if (!sessionId || phaseRef.current !== 'handshake') return;
      if (handshakeCompletionInFlightRef.current) {
        vdbg('complete_handshake_skip', {
          sessionId,
          source,
          reason: 'in_flight',
        });
        return;
      }
      if (handshakeDecisionInFlightRef.current) {
        const ctaTelemetry = handshakeCtaLatestRef.current;
        vdbg('complete_handshake_skip', {
          sessionId,
          source,
          reason: 'local_decision_persistence_in_flight',
          retryScheduled: allowRetry,
          ctaTelemetry,
        });
        if (allowRetry) {
          if (handshakeCompletionRetryTimerRef.current) {
            clearTimeout(handshakeCompletionRetryTimerRef.current);
          }
          handshakeCompletionRetryTimerRef.current = setTimeout(() => {
            handshakeCompletionRetryTimerRef.current = null;
            void completeHandshakeFromServerDeadline(`${source}_after_decision_persistence`, false);
          }, 900);
        }
        return;
      }

      // Fairness guard: if the server deadline fires before the local user has had at
      // least MIN_DECISION_WINDOW_AFTER_MEDIA_MS of usable CTA time after first playable
      // remote media, defer the call by the remaining gap. This prevents expiry on slow
      // Daily joins where media arrives close to the 60 s server deadline.
      if (allowRetry && firstPlayableRemoteAtMsRef.current > 0) {
        const mediaAge = Date.now() - firstPlayableRemoteAtMsRef.current;
        const deferMs = MIN_DECISION_WINDOW_AFTER_MEDIA_MS - mediaAge;
        if (deferMs > 0) {
          vdbg('complete_handshake_deferred_for_media_window', {
            sessionId,
            source,
            deferMs,
            mediaAgeMs: mediaAge,
          });
          if (handshakeCompletionRetryTimerRef.current) {
            clearTimeout(handshakeCompletionRetryTimerRef.current);
          }
          handshakeCompletionRetryTimerRef.current = setTimeout(() => {
            handshakeCompletionRetryTimerRef.current = null;
            void completeHandshakeFromServerDeadline(`${source}_after_media_window`, false);
          }, deferMs + 200);
          return;
        }
      }

      handshakeCompletionInFlightRef.current = true;
      try {
        const ctaTelemetry = handshakeCtaLatestRef.current;
        vdbg('complete_handshake_fire', {
          sessionId,
          source,
          trigger: 'server_deadline',
          ctaTelemetry,
        });
        const result = await completeHandshake(sessionId);
        if (phaseRef.current !== 'handshake') return;

        if (!result) {
          vdbg('complete_handshake_uncertain', {
            sessionId,
            source,
            reason: 'null_result',
            retryScheduled: allowRetry,
          });
          await refetchVideoSession();
          if (allowRetry && phaseRef.current === 'handshake') {
            if (handshakeCompletionRetryTimerRef.current) {
              clearTimeout(handshakeCompletionRetryTimerRef.current);
            }
            handshakeCompletionRetryTimerRef.current = setTimeout(() => {
              handshakeCompletionRetryTimerRef.current = null;
              void completeHandshakeFromServerDeadline(`${source}_retry`, false);
            }, 1500);
          }
          return;
        }

        if (result.state === 'date') {
          clearHandshakeGraceState();
          setShowMutualToast(true);
          return;
        }

        if (result.state === 'handshake') {
          clearHandshakeGraceState();
          vdbg('complete_handshake_uncertain', {
            sessionId,
            source,
            reason: 'handshake_deadline_not_terminal',
            result,
          });
          await refetchVideoSession();
          if (allowRetry && phaseRef.current === 'handshake') {
            if (handshakeCompletionRetryTimerRef.current) {
              clearTimeout(handshakeCompletionRetryTimerRef.current);
            }
            handshakeCompletionRetryTimerRef.current = setTimeout(() => {
              handshakeCompletionRetryTimerRef.current = null;
              void completeHandshakeFromServerDeadline(`${source}_retry`, false);
            }, 1500);
          }
          return;
        }

        if (result.state === 'ended' || result.already_ended) {
          clearHandshakeGraceState();
          if (result.reason === 'handshake_timeout') {
            const notice = getVideoDateWarmupChoiceNotice({
              waitingForSelf: result.waiting_for_self,
              waitingForPartner: result.waiting_for_partner,
            });
            showWarmupChoiceNotice(notice);
            vdbg('complete_handshake_timeout_copy', {
              sessionId,
              source,
              notice,
              waiting_for_self: result.waiting_for_self ?? null,
              waiting_for_partner: result.waiting_for_partner ?? null,
              local_decision_persisted: result.local_decision_persisted ?? null,
              partner_decision_persisted: result.partner_decision_persisted ?? null,
              ctaTelemetry: handshakeCtaLatestRef.current,
            });
          } else if (result.reason === 'handshake_grace_expired') {
            showWarmupChoiceNotice(getVideoDateWarmupChoiceNotice());
          }
          const recoveredSurvey = await openNativePostDateSurveyFromTerminalTruth(
            result.survey_required === true
              ? 'complete_handshake_survey_required'
              : 'complete_handshake_terminal'
          );
          if (recoveredSurvey) {
            void cleanupForAbortWithoutServerEnd();
            return;
          }
          void handleCallEnd('server_end');
          return;
        }

        vdbg('complete_handshake_uncertain', {
          sessionId,
          source,
          reason: 'unexpected_result',
          result,
        });
        await refetchVideoSession();
      } finally {
        handshakeCompletionInFlightRef.current = false;
      }
    },
    [
      clearHandshakeGraceState,
      cleanupForAbortWithoutServerEnd,
      handleCallEnd,
      openNativePostDateSurveyFromTerminalTruth,
      refetchVideoSession,
      sessionId,
      showWarmupChoiceNotice,
    ]
  );

  useEffect(() => {
    if (
      !sessionId ||
      phase !== 'handshake' ||
      showFeedback ||
      session?.ended_at
    ) {
      return;
    }

    const handshakeStartedAt = session?.handshake_started_at ?? null;
    if (!handshakeStartedAt) return;

    const deadlineKey = `${sessionId}:${handshakeStartedAt}`;
    const deadlineMs = startedAtCountdownDeadlineMs({
      startedAtIso: handshakeStartedAt,
      durationSeconds: HANDSHAKE_SECONDS,
    });
    if (!deadlineMs) return;
    const delayMs = Math.max(0, deadlineMs - Date.now());
    const fire = () => {
      if (handshakeCompletionDeadlineKeyRef.current === deadlineKey) return;
      handshakeCompletionDeadlineKeyRef.current = deadlineKey;
      void completeHandshakeFromServerDeadline('handshake_server_deadline');
    };

    const timer = setTimeout(fire, delayMs);
    return () => clearTimeout(timer);
  }, [
    completeHandshakeFromServerDeadline,
    phase,
    session?.ended_at,
    session?.handshake_started_at,
    sessionId,
    showFeedback,
  ]);

  useEffect(() => {
    if (phase === 'date') {
      clearHandshakeGraceState();
    }
  }, [phase, clearHandshakeGraceState]);

  // Authoritative visible countdown: recompute from server-owned phase timestamps every tick.
  useEffect(() => {
    if (showFeedback || phase === 'ended') return;
    const hasAuthoritativeStart =
      phase === 'handshake'
        ? Boolean(session?.handshake_started_at)
        : phase === 'date'
          ? Boolean(session?.date_started_at)
          : false;
    if (!hasAuthoritativeStart) return;

    let completionFired = false;
    const tick = () => {
      const countdown = resolveVideoDatePhaseCountdown({
        phase,
        handshakeStartedAtIso: session?.handshake_started_at,
        dateStartedAtIso: session?.date_started_at,
        handshakeDurationSeconds: HANDSHAKE_SECONDS,
        dateDurationSeconds: DATE_SECONDS,
        dateExtraSeconds: session?.date_extra_seconds,
      });
      const next = countdown.remainingSeconds ?? 0;
      setLocalTimeLeft(next);

      if (next > 0 || completionFired) return;
      const completionKey = `${sessionId ?? 'unknown-session'}:${phase}:${countdown.deadlineMs ?? 'no-deadline'}`;
      if (countdownCompletionKeyRef.current === completionKey) return;
      completionFired = true;
      countdownCompletionKeyRef.current = completionKey;

      if (phaseRef.current === 'date') {
        void handleCallEnd('local_end');
      } else if (phaseRef.current === 'handshake') {
        vdbg('handshake_visible_countdown_elapsed', {
          sessionId: sessionId ?? null,
          trigger: 'complete_handshake',
        });
        void completeHandshakeFromServerDeadline('handshake_visible_countdown_elapsed');
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [
    showFeedback,
    phase,
    sessionId,
    handleCallEnd,
    completeHandshakeFromServerDeadline,
    session?.date_extra_seconds,
    session?.date_started_at,
    session?.handshake_started_at,
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

  useEffect(() => {
    const controls = callRef.current as unknown as NativeDailyCameraControls | null;
    setCanFlipCamera(Platform.OS !== 'web' && typeof controls?.cycleCamera === 'function');
  }, [localParticipant, joinAttemptNonce]);

  const handleFlipCamera = useCallback(async () => {
    const controls = callRef.current as unknown as NativeDailyCameraControls | null;
    if (!controls || typeof controls.cycleCamera !== 'function' || isFlippingCamera || isVideoOff) {
      if (!controls || typeof controls?.cycleCamera !== 'function') setCanFlipCamera(false);
      return;
    }

    setIsFlippingCamera(true);
    try {
      const result = await controls.cycleCamera();
      videoDateDailyDiagnostic('native_camera_flipped', {
        sessionId: sessionId ?? null,
        eventId: eventId || null,
        next_facing_mode: result?.device?.facingMode ?? null,
      });
    } catch (error) {
      setCanFlipCamera(false);
      videoDateDailyDiagnostic('native_camera_flip_failed', {
        sessionId: sessionId ?? null,
        eventId: eventId || null,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsFlippingCamera(false);
    }
  }, [eventId, isFlippingCamera, isVideoOff, sessionId]);

  const totalTime =
    phase === 'handshake'
      ? HANDSHAKE_SECONDS
      : effectiveDateDurationSeconds(DATE_SECONDS, session?.date_extra_seconds);
  const displayTimeLeft = localTimeLeft ?? totalTime;
  const handshakeTimerStarted =
    phase !== 'handshake' || Boolean(session?.handshake_started_at);
  const handshakeDeadlineUrgent =
    phase === 'handshake' && handshakeTimerStarted && displayTimeLeft <= 10;

  useEffect(() => {
    if (!handshakeDeadlineUrgent) {
      lastChanceBlinkOpacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(lastChanceBlinkOpacity, { toValue: 0.42, duration: 360, useNativeDriver: true }),
        Animated.timing(lastChanceBlinkOpacity, { toValue: 1, duration: 360, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => {
      loop.stop();
      lastChanceBlinkOpacity.setValue(1);
    };
  }, [handshakeDeadlineUrgent, lastChanceBlinkOpacity]);

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
    if (joining || isConnecting) return 'joining_daily';
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

  const showOpeningRoomTopPill = !showFeedback && (joining || isConnecting) && !localInDailyRoom;
  const showTopBarWaitingPill =
    showOpeningRoomTopPill ||
    (!showFeedback &&
      localInDailyRoom &&
      !hasRemotePartner &&
      !partnerEverJoined &&
      !peerMissingTerminal &&
      !isPartnerDisconnected);
  const showJoiningOverlay = (joining || isConnecting) && !localInDailyRoom && !showFeedback && !preJoinFailed && !peerMissingTerminal;
  const showPeerWaitOverlay =
    !showFeedback &&
    localInDailyRoom &&
    !hasRemotePartner &&
    !partnerEverJoined &&
    !peerMissingTerminal &&
    !isPartnerDisconnected;

  const hasHandshakePeerEvidence = hasRemotePartner || (peerServerJoinedAt != null && !isPartnerDisconnected);

  // Show the Vibe/Pass CTA during the hard-deadline handshake, using server
  // join evidence as a fallback when Daily participant/track state jitters.
  const showHandshakeChrome =
    !showFeedback &&
    phase === 'handshake' &&
    handshakeTimerStarted &&
    hasHandshakePeerEvidence &&
    !peerMissingTerminal;
  const showDatePhaseChrome = !showFeedback && phase === 'date' && hasRemotePartner;
  const localHandshakeDecision = useMemo<boolean | null>(() => {
    if (!session || !user?.id) return null;
    if (session.participant_1_id === user.id) {
      return session.participant_1_decided_at ? session.participant_1_liked ?? null : null;
    }
    if (session.participant_2_id === user.id) {
      return session.participant_2_decided_at ? session.participant_2_liked ?? null : null;
    }
    return null;
  }, [session, user?.id]);

  useEffect(() => {
    const key = `${sessionId ?? 'none'}:${session?.handshake_started_at ?? 'no-start'}`;
    if (
      !showHandshakeChrome ||
      !handshakeDeadlineUrgent ||
      localHandshakeDecision !== null ||
      handshakeFinalTenNudgeKeyRef.current === key
    ) {
      return;
    }

    handshakeFinalTenNudgeKeyRef.current = key;
    vdbg('handshake_final_10s_nudge', {
      sessionId: sessionId ?? null,
      remainingSeconds: displayTimeLeft,
    });
    AccessibilityInfo.announceForAccessibility('Choose Vibe or Pass before warm up ends.');
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {
      /* Haptics must never affect the call path. */
    });
  }, [
    displayTimeLeft,
    handshakeDeadlineUrgent,
    localHandshakeDecision,
    session?.handshake_started_at,
    sessionId,
    showHandshakeChrome,
  ]);

  const remoteVideoTrack = remoteParticipant ? getTrack(remoteParticipant, 'video') : null;
  const remoteAudioTrack = remoteParticipant ? getTrack(remoteParticipant, 'audio') : null;
  const localVideoTrack = localParticipant ? getTrack(localParticipant, 'video') : null;

  useEffect(() => {
    const now = Date.now();
    const localDecisionLabel: HandshakeCtaTelemetrySnapshot['local_decision'] =
      localHandshakeDecision === true ? 'vibe' : localHandshakeDecision === false ? 'pass' : 'none';
    const current = handshakeCtaImpressionRef.current;
    const firstPlayableRemoteSeen = firstPlayableRemoteAtMsRef.current > 0;
    const ctaVisibleMs = current ? Math.max(0, now - current.shownAtMs) : handshakeCtaLastVisibleMsRef.current;
    handshakeCtaLatestRef.current = {
      cta_visible: showHandshakeChrome,
      cta_visible_ms: ctaVisibleMs,
      cta_last_time_left: current?.lastTimeLeft ?? displayTimeLeft ?? null,
      has_remote_partner: hasRemotePartner,
      peer_server_joined: peerServerJoinedAt != null,
      partner_ever_joined: partnerEverJoined,
      is_partner_disconnected: isPartnerDisconnected,
      peer_missing_terminal: peerMissingTerminal,
      remote_video_mounted: Boolean(remoteVideoTrack),
      remote_audio_mounted: Boolean(remoteAudioTrack),
      first_playable_remote_seen: firstPlayableRemoteSeen,
      first_playable_remote_age_ms: firstPlayableRemoteSeen
        ? Math.max(0, now - firstPlayableRemoteAtMsRef.current)
        : null,
      local_decision: localDecisionLabel,
    };

    const key = `${sessionId ?? 'none'}:${session?.handshake_started_at ?? 'no-start'}`;
    const logHidden = (reason: string, impression: { key: string; shownAtMs: number; lastTimeLeft: number | null }) => {
      const visibleMs = Math.max(0, now - impression.shownAtMs);
      handshakeCtaLastVisibleMsRef.current = visibleMs;
      vdbg('handshake_cta_hidden', {
        sessionId: sessionId ?? null,
        reason,
        visibleMs,
        lastTimeLeft: impression.lastTimeLeft,
        hasRemotePartner,
        peerServerJoined: peerServerJoinedAt != null,
        partnerEverJoined,
        isPartnerDisconnected,
        peerMissingTerminal,
        remoteVideoMounted: Boolean(remoteVideoTrack),
        remoteAudioMounted: Boolean(remoteAudioTrack),
        localDecision: localDecisionLabel,
      });
      trackEvent('video_date_handshake_cta_hidden', {
        platform: 'native',
        session_id: sessionId ?? null,
        event_id: eventId || null,
        reason,
        visible_ms: visibleMs,
        last_time_left: impression.lastTimeLeft,
        has_remote_partner: hasRemotePartner,
        peer_server_joined: peerServerJoinedAt != null,
        remote_video_mounted: Boolean(remoteVideoTrack),
        remote_audio_mounted: Boolean(remoteAudioTrack),
        local_decision: localDecisionLabel,
      });
    };

    if (showHandshakeChrome && sessionId) {
      if (!current || current.key !== key) {
        if (current) logHidden('replaced_by_new_handshake_key', current);
        handshakeCtaImpressionRef.current = { key, shownAtMs: now, lastTimeLeft: displayTimeLeft ?? null };
        handshakeCtaLastVisibleMsRef.current = 0;
        vdbg('handshake_cta_visible', {
          sessionId,
          remainingSeconds: displayTimeLeft,
          hasRemotePartner,
          peerServerJoined: peerServerJoinedAt != null,
          partnerEverJoined,
          remoteVideoMounted: Boolean(remoteVideoTrack),
          remoteAudioMounted: Boolean(remoteAudioTrack),
          firstPlayableRemoteSeen,
          localDecision: localDecisionLabel,
        });
        trackEvent('video_date_handshake_cta_visible', {
          platform: 'native',
          session_id: sessionId,
          event_id: eventId || null,
          remaining_seconds: displayTimeLeft,
          has_remote_partner: hasRemotePartner,
          peer_server_joined: peerServerJoinedAt != null,
          remote_video_mounted: Boolean(remoteVideoTrack),
          remote_audio_mounted: Boolean(remoteAudioTrack),
          first_playable_remote_seen: firstPlayableRemoteSeen,
          local_decision: localDecisionLabel,
        });
      } else {
        current.lastTimeLeft = displayTimeLeft ?? current.lastTimeLeft;
      }
      return;
    }

    if (current) {
      logHidden(showFeedback ? 'feedback_opened' : phase !== 'handshake' ? `phase_${phase}` : 'cta_condition_false', current);
      handshakeCtaImpressionRef.current = null;
    }
  }, [
    displayTimeLeft,
    eventId,
    hasRemotePartner,
    isPartnerDisconnected,
    localHandshakeDecision,
    partnerEverJoined,
    peerMissingTerminal,
    peerServerJoinedAt,
    phase,
    remoteAudioTrack,
    remoteVideoTrack,
    session?.handshake_started_at,
    sessionId,
    showFeedback,
    showHandshakeChrome,
  ]);

  const effectiveIceBreakerClockMs = useMemo(() => {
    if (!iceBreakerManualPause) return iceBreakerClockMs;
    const pauseMs = Math.max(0, iceBreakerManualPause.untilMs - iceBreakerManualPause.startedAtMs);
    if (iceBreakerClockMs < iceBreakerManualPause.untilMs) return iceBreakerManualPause.startedAtMs;
    return iceBreakerClockMs - pauseMs;
  }, [iceBreakerClockMs, iceBreakerManualPause]);

  const currentQuestionIndex = resolveVideoDateIceBreakerIndex(
    vibeQuestionState.questions.length,
    vibeQuestionState.questionIndex,
    vibeQuestionState.questionAnchorAt,
    effectiveIceBreakerClockMs
  );
  const currentQuestion =
    vibeQuestionState.questions[currentQuestionIndex] ?? vibeQuestionState.questions[0] ?? '';
  const handshakeBottomOffset = insets.bottom + DATE_CONTROLS_STACK_HEIGHT + 18;
  const advanceIceBreaker = useCallback(() => {
    if (!sessionId || !vibeQuestionState.questions.length) return;
    const pauseStartedAtMs = Date.now();
    setIceBreakerManualPause({
      startedAtMs: pauseStartedAtMs,
      untilMs: pauseStartedAtMs + VIDEO_DATE_ICE_BREAKER_MANUAL_PAUSE_MS,
    });
    const optimisticIndex = normalizeVideoDateIceBreakerIndex(
      currentQuestionIndex + 1,
      vibeQuestionState.questions.length
    );
    setVibeQuestionState((prev) => ({
      ...prev,
      questionIndex: optimisticIndex,
      questionAnchorAt: new Date().toISOString(),
    }));
    void advanceVibeQuestion(sessionId).then((next) => {
      if (next) setVibeQuestionState(next);
    });
  }, [currentQuestionIndex, sessionId, vibeQuestionState.questions.length]);
  const dismissIceBreakerTemporarily = useCallback(() => {
    setShowIceBreaker(false);
  }, []);
  const showFloatingIceBreaker =
    showIceBreaker &&
    Boolean(currentQuestion) &&
    !showFeedback &&
    !showMutualToast &&
    hasRemotePartner &&
    !isPartnerDisconnected &&
    !peerMissingTerminal &&
    nativeBackgroundStatus === 'none' &&
    !showJoiningOverlay &&
    !showPeerWaitOverlay &&
    (phase === 'handshake' || phase === 'date');
  const showCollapsedIceBreaker =
    !showIceBreaker &&
    Boolean(currentQuestion) &&
    !showFeedback &&
    !showMutualToast &&
    hasRemotePartner &&
    !isPartnerDisconnected &&
    !peerMissingTerminal &&
    nativeBackgroundStatus === 'none' &&
    !showJoiningOverlay &&
    !showPeerWaitOverlay &&
    (phase === 'handshake' || phase === 'date');
  const iceBreakerBottomOffset = showHandshakeChrome
    ? handshakeBottomOffset + HANDSHAKE_CTA_STACK_HEIGHT + FLOATING_CHROME_GAP
    : Math.max(
        insets.bottom + DATE_CONTROLS_STACK_HEIGHT + FLOATING_CHROME_GAP,
        DATE_PHASE_ICE_BREAKER_MIN_BOTTOM
      );

  useEffect(() => {
    topChromeAnim.setValue(0.92);
    controlsAnim.setValue(0.94);
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
    ]).start();
  }, [phase, postJoinStage, topChromeAnim, controlsAnim]);

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
  }, [eventId, sessionId, user?.id]);

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
    [sessionId, user, partnerId]
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

  const handleSurveyQueuedVideoSessionReady = useCallback((videoSessionId: string) => {
    if (!eventId) return;
    const target = eventLobbyHrefPendingVideoSession(eventId, videoSessionId);
    vdbgRedirect(target, 'survey_queue_match_ready', {
      sessionId: sessionId ?? null,
      eventId,
      pendingVideoSession: videoSessionId,
    });
    router.replace(target);
  }, [eventId, sessionId]);

  const surveyPartnerId =
    partnerId ||
    (session && user?.id
      ? user.id === session.participant_1_id
        ? session.participant_2_id
        : session.participant_1_id
      : '');
  const surveyEventId = eventId || session?.event_id || undefined;

  if (showFeedback && sessionId && user?.id) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <PostDateSurvey
          sessionId={sessionId}
          userId={user.id}
          partnerId={surveyPartnerId}
          partnerName={fullPartner?.name ?? basicPartner?.name ?? 'Your date'}
          partnerImage={fullPartner?.avatarUrl ?? fullPartner?.photos?.[0] ?? null}
          eventId={surveyEventId}
          onSubmitVerdict={handleSurveySubmit}
          onMutualMatch={handleSurveyMutualMatch}
          onStartChatting={handleSurveyStartChatting}
          onQueuedVideoSessionReady={handleSurveyQueuedVideoSessionReady}
          onDone={handleSurveyDone}
        />
        {warmupChoiceNotice ? (
          <WarmupChoiceNoticeBanner
            notice={warmupChoiceNotice}
            theme={theme}
            top={insets.top + 12}
          />
        ) : null}
      </View>
    );
  }

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
  const partnerFirstName = partnerName.trim().split(/\s+/)[0] || partnerName;
  const partnerAge = fullPartner?.age ?? basicPartner?.age ?? 0;
  const partnerAvatarUri = fullPartner?.avatarUrl ?? fullPartner?.photos?.[0] ?? basicPartner?.avatar_url ?? null;
  const partnerInitial = partnerFirstName.slice(0, 1).toUpperCase() || 'V';

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <LiveSurfaceOfflineStrip />
      <View style={styles.remoteContainer}>
        {remoteParticipant ? (
          <>
            {(remoteVideoTrack || remoteAudioTrack) && (
              // Remote date video must preserve the full encoded camera frame.
              // DailyMediaView defaults to cover, so keep this explicit.
              <DailyMediaView
                videoTrack={remoteVideoTrack}
                audioTrack={remoteAudioTrack}
                mirror={false}
                objectFit="contain"
                zOrder={0}
                style={StyleSheet.absoluteFill}
              />
            )}
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
      <View pointerEvents="none" style={styles.remoteGlassWash} />

      <View style={[styles.localPip, { borderColor: theme.tint, top: insets.top + 86 }]}>
        {localParticipant && localVideoTrack ? (
          <>
            {/* Self-view PIP intentionally crops to a stable portrait tile; remote date video must contain. */}
            <DailyMediaView
              videoTrack={localVideoTrack}
              audioTrack={null}
              mirror={true}
              objectFit="cover"
              zOrder={1}
              style={styles.localVideo}
            />
          </>
        ) : (
          <View style={[styles.localVideo, styles.placeholderLocal, { backgroundColor: theme.surface }]}>
            <Ionicons
              name={localParticipant ? 'videocam-off' : 'person-outline'}
              size={28}
              color={theme.mutedForeground}
            />
          </View>
        )}
        {isMuted && (
          <View style={[styles.muteBadge, { backgroundColor: theme.danger }]}>
            <Ionicons name="mic-off" size={12} color="#fff" />
          </View>
        )}
        {canFlipCamera && !isVideoOff && localVideoTrack ? (
          <Pressable
            onPress={() => void handleFlipCamera()}
            disabled={isFlippingCamera}
            hitSlop={8}
            style={({ pressed }) => [
              styles.flipCameraBadge,
              {
                backgroundColor: 'rgba(0,0,0,0.48)',
                borderColor: theme.glassBorder,
                opacity: pressed || isFlippingCamera ? 0.72 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Switch camera"
          >
            <Ionicons name="camera-reverse" size={16} color="#fff" />
          </Pressable>
        ) : null}
        <View pointerEvents="none" style={styles.localPipHandle} />
      </View>

        {showJoiningOverlay && (
          <ConnectionOverlay mode="joining" onLeave={handleAbortConnection} isLeaving={isAbortingConnection} />
        )}
        {showPeerWaitOverlay && (
          <ConnectionOverlay
            mode="waiting_peer"
            onLeave={handleAbortConnection}
            isLeaving={isAbortingConnection}
            waitingPeerTitle={peerNotOpenedVideoDateYet ? "They haven't opened the date yet" : undefined}
            waitingPeerSubtitle={
              peerNotOpenedVideoDateYet
                ? 'Hang tight — your timer starts once they open this date on their phone.'
                : undefined
            }
          />
        )}

        {!showFeedback && preJoinFailed && !localInDailyRoom && (
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
                  disabled={isAbortingConnection}
                  style={({ pressed }) => [styles.initialBackBtn, { borderColor: theme.border }, pressed && styles.initialBtnPressed]}
                >
                  <Text style={[styles.initialBackText, { color: theme.text }]}>
                    {isAbortingConnection ? 'Leaving...' : 'Back to lobby'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}

        {!showFeedback && peerMissingTerminal && (
          <View style={styles.initialTimeoutWrap}>
            <View style={[styles.initialTimeoutCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.initialTimeoutTitle, { color: theme.text }]}>
                They may need a little more time.
              </Text>
              <Text style={[styles.initialTimeoutSub, { color: theme.mutedForeground }]}>
                You can try reconnecting, keep waiting a little longer, or head back to the lobby.
              </Text>
              <View style={styles.initialTimeoutActions}>
                <Pressable
                  onPress={() => void handleRetryInitialConnect()}
                  style={({ pressed }) => [styles.initialRetryBtn, { backgroundColor: theme.tint }, pressed && styles.initialBtnPressed]}
                >
                  <Text style={styles.initialRetryText}>Try reconnecting</Text>
                </Pressable>
                <Pressable
                  onPress={() => void handlePeerMissingKeepWaiting()}
                  style={({ pressed }) => [styles.initialBackBtn, { borderColor: theme.border }, pressed && styles.initialBtnPressed]}
                >
                  <Text style={[styles.initialBackText, { color: theme.text }]}>Keep waiting</Text>
                </Pressable>
                <Pressable
                  onPress={() => void handleAbortConnection({ source: 'peer_missing' })}
                  disabled={isAbortingConnection}
                  style={({ pressed }) => [styles.initialBackBtn, { borderColor: theme.border }, pressed && styles.initialBtnPressed]}
                >
                  <Text style={[styles.initialBackText, { color: theme.text }]}>
                    {isAbortingConnection ? 'Leaving...' : 'Back to lobby'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}

      {isPartnerDisconnected && partnerEverJoined && (
        <ReconnectionOverlay isVisible partnerName={partnerName} graceTimeLeft={reconnectionGrace} />
      )}

      {nativeBackgroundStatus !== 'none' && (
        <View
          style={[
            styles.nativeBackgroundBanner,
            {
              backgroundColor:
                nativeBackgroundStatus === 'recovered' ? theme.tintSoft : theme.glassSurface,
              borderColor: nativeBackgroundStatus === 'recovered' ? theme.tint : theme.glassBorder,
            },
          ]}
          accessibilityLiveRegion="polite"
        >
          <Text style={[styles.nativeBackgroundTitle, { color: theme.text }]}>
            {nativeBackgroundStatus === 'recovered' ? 'Reconnected' : 'Pausing your date'}
          </Text>
          <Text style={[styles.nativeBackgroundText, { color: theme.mutedForeground }]}>
            {nativeBackgroundStatus === 'recovered'
              ? 'You are back in the room.'
              : `We paused your call while Vibely is backgrounded. Return within ${nativeBackgroundGraceSeconds}s to reconnect.`}
          </Text>
        </View>
      )}

      {showMutualToast && <MutualVibeToast onComplete={handleMutualToastComplete} />}

      <Animated.View
        style={[
          styles.topBar,
          {
            top: insets.top + 12,
            opacity: topChromeAnim,
            transform: [{ translateY: topChromeAnim.interpolate({ inputRange: [0.92, 1], outputRange: [-8, 0] }) }],
          },
        ]}
      >
        {showTopBarWaitingPill ? (
          <View style={styles.topBarFullWidth}>
            <View style={styles.waitingTimerPill}>
              <Text style={[styles.waitingTimerText, { color: theme.text }]}>
                {showOpeningRoomTopPill
                  ? 'Opening the room...'
                  : peerNotOpenedVideoDateYet
                    ? "They're stepping into the room"
                    : 'Holding the room softly...'}
              </Text>
            </View>
          </View>
        ) : hasRemotePartner ? (
          <View style={styles.topChromeRow}>
            <Pressable
              onPress={() => setShowProfileSheet(true)}
              disabled={!partnerId}
              style={({ pressed }) => [
                styles.partnerChip,
                {
                  backgroundColor: theme.glassSurface,
                  borderColor: theme.glassBorder,
                  opacity: pressed ? 0.88 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`View ${partnerName}'s profile`}
            >
              <View style={[styles.partnerAvatar, { borderColor: theme.tint }]}>
                {partnerAvatarUri ? (
                  <Image source={{ uri: partnerAvatarUri }} style={styles.partnerAvatarImage} resizeMode="cover" />
                ) : (
                  <Text style={[styles.partnerAvatarInitial, { color: theme.text }]}>
                    {partnerInitial}
                  </Text>
                )}
              </View>
              <View style={styles.partnerChipCopy}>
                <Text style={[styles.partnerChipName, { color: theme.text }]} numberOfLines={1}>
                  {partnerFirstName}
                  {partnerAge > 0 ? (
                    <Text style={[styles.partnerChipAge, { color: theme.mutedForeground }]}> {partnerAge}</Text>
                  ) : null}
                </Text>
                <View style={styles.partnerStatusRow}>
                  <View style={[styles.liveDot, { backgroundColor: theme.success }]} />
                  <Text style={[styles.partnerStatusText, { color: theme.success }]}>
                    {phase === 'handshake' ? (handshakeTimerStarted ? 'Warm up' : 'Settling in') : 'Live'}
                  </Text>
                </View>
              </View>
            </Pressable>

            <View style={styles.timerCluster}>
              {netQualityTier !== 'good' ? (
                <Text
                  style={[
                    styles.netHint,
                    { color: netQualityTier === 'poor' ? theme.danger : '#f59e0b' },
                  ]}
                  numberOfLines={1}
                >
                  {netQualityTier === 'poor' ? 'Connection is fragile' : 'Connection is settling'}
                </Text>
              ) : null}
              <View style={styles.stageTimerRow}>
                <View style={[styles.stagePill, { borderColor: theme.glassBorder, backgroundColor: theme.tintSoft }]}>
                  <Animated.Text
                    style={[
                      styles.stagePillText,
                      {
                        color: handshakeDeadlineUrgent ? theme.neonPink : theme.tint,
                        opacity: handshakeDeadlineUrgent ? lastChanceBlinkOpacity : 1,
                      },
                    ]}
                  >
                    {phase === 'handshake'
                      ? handshakeTimerStarted
                        ? 'Warm up'
                        : 'Settling in'
                      : 'Live'}
                  </Animated.Text>
                </View>
                {handshakeTimerStarted ? (
                  <HandshakeTimer timeLeft={Math.max(0, displayTimeLeft)} totalTime={totalTime} phase={phase} />
                ) : null}
              </View>
            </View>
          </View>
        ) : null}
      </Animated.View>

      {showFloatingIceBreaker ? (
        <View pointerEvents="box-none" style={[styles.iceBreakerFloat, { bottom: iceBreakerBottomOffset }]}>
          <IceBreakerCard
            question={currentQuestion}
            onDismiss={dismissIceBreakerTemporarily}
            onShuffle={advanceIceBreaker}
          />
        </View>
      ) : null}

      {showCollapsedIceBreaker ? (
        <View pointerEvents="box-none" style={[styles.iceBreakerFloat, { bottom: iceBreakerBottomOffset }]}>
          <Pressable
            onPress={() => setShowIceBreaker(true)}
            style={({ pressed }) => [
              styles.iceBreakerCollapsed,
              {
                backgroundColor: theme.glassSurface,
                borderColor: theme.glassBorder,
                opacity: pressed ? 0.84 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Show ice-breaker question"
          >
            <Ionicons name="sparkles" size={15} color={theme.tint} />
            <Text style={[styles.iceBreakerCollapsedText, { color: theme.tint }]}>Icebreaker</Text>
          </Pressable>
        </View>
      ) : null}

      {showHandshakeChrome && (
        <View style={[styles.handshakeBottomStack, { bottom: handshakeBottomOffset }]}> 
          <VibeCheckButton
            timeLeft={displayTimeLeft}
            decision={localHandshakeDecision}
            onVibe={handleUserVibe}
            onPass={handleUserPass}
          />
        </View>
      )}

      {showDatePhaseChrome && (
        <Animated.View
          style={styles.keepTheVibeWrap}
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

      {warmupChoiceNotice ? (
        <WarmupChoiceNoticeBanner
          notice={warmupChoiceNotice}
          theme={theme}
          top={insets.top + 64}
        />
      ) : null}

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
            {Number.isInteger(extendBanner.minutes)
              ? String(extendBanner.minutes)
              : extendBanner.minutes.toFixed(1)} extra {extendBanner.minutes === 1 ? 'minute' : 'minutes'} added!
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
  warmupChoiceNotice: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 90,
    elevation: 20,
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 12,
    paddingLeft: 17,
    paddingRight: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    overflow: 'hidden',
    shadowColor: 'hsl(263, 70%, 66%)',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 22,
  },
  warmupChoiceNoticeRail: {
    position: 'absolute',
    left: 0,
    top: 12,
    bottom: 12,
    width: 4,
    borderRadius: 999,
  },
  warmupChoiceNoticeIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(139,92,246,0.24)',
    backgroundColor: 'rgba(139,92,246,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  warmupChoiceNoticeCopy: { flex: 1, marginLeft: 12 },
  warmupChoiceNoticeTitle: { fontSize: 14, lineHeight: 18, fontWeight: '700' },
  warmupChoiceNoticeMessage: { marginTop: 3, fontSize: 12, lineHeight: 17 },
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
  nativeBackgroundBanner: {
    position: 'absolute',
    top: 156,
    left: 16,
    right: 16,
    zIndex: 58,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  nativeBackgroundTitle: { textAlign: 'center', fontSize: 14, fontWeight: '700' },
  nativeBackgroundText: { marginTop: 3, textAlign: 'center', fontSize: 12, lineHeight: 17 },
  button: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8 },
  buttonText: { color: '#fff', fontSize: 16 },
  remoteContainer: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  remoteGlassWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  placeholderRemote: { justifyContent: 'center', alignItems: 'center' },
  placeholderText: { color: '#888', fontSize: 16 },
  localPip: {
    position: 'absolute',
    top: 108,
    right: 16,
    width: 112,
    height: 154,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1.5,
    backgroundColor: '#000',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.48,
    shadowRadius: 28,
    elevation: 10,
  },
  localVideo: { width: '100%', height: '100%' },
  placeholderLocal: { justifyContent: 'center', alignItems: 'center' },
  muteBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: 'hsl(0, 84%, 60%)',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 4,
  },
  flipCameraBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 4,
  },
  localPipHandle: {
    position: 'absolute',
    bottom: 8,
    left: '50%',
    width: 32,
    height: 4,
    marginLeft: -16,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.32)',
  },
  topBar: {
    position: 'absolute',
    top: 50,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  topBarFullWidth: { width: '100%', alignItems: 'center' },
  topChromeRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  partnerChip: {
    minHeight: 56,
    maxWidth: 172,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 7,
    paddingLeft: 8,
    paddingRight: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.36,
    shadowRadius: 24,
    elevation: 6,
  },
  partnerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  partnerAvatarImage: {
    width: '100%',
    height: '100%',
  },
  partnerAvatarInitial: {
    fontSize: 15,
    fontWeight: '800',
  },
  partnerChipCopy: {
    minWidth: 0,
    flexShrink: 1,
    gap: 3,
  },
  partnerChipName: {
    fontSize: 15,
    fontWeight: '800',
  },
  partnerChipAge: {
    fontSize: 15,
    fontWeight: '500',
  },
  partnerStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  partnerStatusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  timerCluster: {
    alignItems: 'flex-end',
    flexShrink: 0,
    gap: 5,
  },
  stageTimerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stagePill: {
    minHeight: 38,
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 9,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  stagePillText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  waitingTimerPill: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  waitingTimerText: { fontSize: 12, fontWeight: '700' },
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
  netHint: { fontSize: 11, fontWeight: '600' },
  handshakeBottomStack: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
    gap: spacing.sm,
  },
  iceBreakerFloat: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 26,
    alignItems: 'center',
  },
  iceBreakerCollapsed: {
    alignSelf: 'flex-start',
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.28,
    shadowRadius: 22,
    elevation: 6,
  },
  iceBreakerCollapsedText: {
    fontSize: 12,
    fontFamily: fonts.display,
  },
  keepTheVibeWrap: { position: 'absolute', top: 116, right: 16, alignItems: 'flex-end' },
  controlsBar: { position: 'absolute', bottom: 0, left: 0, right: 0 },
});
