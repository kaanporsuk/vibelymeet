import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  Image,
  Dimensions,
  AppState,
  type AppStateStatus,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, usePathname, router, type Href } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Sentry from '@sentry/react-native';
import Colors from '@/constants/Colors';
import { GlassHeaderBar, Card, LoadingState, ErrorState, Skeleton, VibelyButton } from '@/components/ui';
import { spacing, radius, layout, shadows } from '@/constants/theme';
import { withAlpha } from '@/lib/colorUtils';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import {
  useEventDetails,
  useIsRegisteredForEvent,
  useEventDeck,
  swipe,
  drainMatchQueue,
  getQueuedMatchCount,
  getSuperVibeRemaining,
  type DeckProfile,
  type SwipeResult,
} from '@/lib/eventsApi';
import { avatarUrl, deckCardUrl } from '@/lib/imageUrl';
import { ReadyGateOverlay } from '@/components/lobby/ReadyGateOverlay';
import { EventEndedModal } from '@/components/events/EventEndedModal';
import { useEventStatus } from '@/lib/eventStatus';
import { useConnectivity } from '@/lib/useConnectivity';
import { useMysteryMatch } from '@/lib/useMysteryMatch';
import { supabase } from '@/lib/supabase';
import { trackEvent } from '@/lib/analytics';
import { LobbyPostDateEvents } from '@clientShared/analytics/lobbyToPostDateJourney';
import {
  bucketEventLobbyCount,
  buildLobbySwipeResultPayload,
  EventLobbyObservabilityEvents,
  getSwipeOutcome,
  getSwipeNotificationSuppressionReason,
  isDuplicateSwipeResult,
  resolveDeckEmptyReason,
} from '@clientShared/observability/eventLobbyObservability';
import { bucketVideoDateLatencyMs } from '@clientShared/observability/videoDateOperatorMetrics';
import { LiveSurfaceOfflineStrip } from '@/components/connectivity/LiveSurfaceOfflineStrip';
import { useVibelyDialog } from '@/components/VibelyDialog';
import { useQueryClient } from '@tanstack/react-query';
import { useAccountPauseStatus } from '@/hooks/useAccountPauseStatus';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { useActiveSession } from '@/lib/useActiveSession';
import { RC_CATEGORY, rcBreadcrumb } from '@/lib/nativeRcDiagnostics';
import { endAccountBreakForUser } from '@/lib/endAccountBreak';
import { isVdbgEnabled, vdbg } from '@/lib/vdbg';
import { navigateToDateSessionGuarded } from '@/lib/dateNavigationGuard';
import { clearDateEntryTransition, isDateEntryTransitionActive } from '@/lib/dateEntryTransitionLatch';
import { ensureVideoDateStartableBeforeNavigation } from '@/lib/videoDateEntryStartable';
import { prepareVideoDateEntry } from '@/lib/videoDatePrepareEntry';
import {
  persistReadyGateSuppressionV2,
  useNonBlockingVideoDateReadiness,
} from '@/lib/videoDateReadiness';
import { markNativeVideoDateLaunchIntent, videoDateLaunchBreadcrumb } from '@/lib/videoDateLaunchTrace';
import {
  canAttemptDailyRoomFromVideoSessionTruth,
  decideVideoSessionRouteFromTruth,
} from '@clientShared/matching/activeSession';
import { getMatchQueueDrainReasonCopy } from '@clientShared/matching/matchQueueDrainReasonCopy';
import {
  getPostDateLobbyContinuityDecision,
  secondsUntilPostDateEventEnd,
  type PostDateContinuityDecision,
} from '@clientShared/matching/postDateContinuity';
import { getRelationshipIntentDisplaySafe } from '@shared/profileContracts';
import { resolvePrimaryProfilePhotoPath } from '../../../../../shared/profilePhoto/resolvePrimaryProfilePhotoPath';
import {
  buildVideoDateDeckPrefetchTelemetryPayload,
  getVideoDateDeckPrefetchItems,
  getVideoDateDeckPrefetchSource,
} from '@clientShared/matching/videoDateDeckPrefetch';
import {
  getSwipeFailureUserMessage,
  videoSessionIdFromSwipePayload,
  videoSessionIdFromDrainPayload,
  shouldOpenReadyGateFromSwipePayload,
  shouldAdvanceLobbyDeckAfterSwipe,
  SWIPE_SESSION_CONFLICT_USER_MESSAGE,
  QUEUED_MATCH_TIMED_OUT_USER_MESSAGE,
  isVideoSessionQueuedTtlExpiryTransition,
} from '@shared/matching/videoSessionFlow';
import { shouldTopUpVideoDateDeck } from '@clientShared/matching/videoDateInstantExperience';
import {
  createVideoDateSessionChannel,
  resolveVideoDateSessionSeqDecision,
  type VideoDateSessionBroadcastEvent,
} from '@clientShared/matching/videoDateSessionChannel';
import { nextConvergenceDelayMs } from '@clientShared/matching/convergenceScheduling';
import { resolveEventLifecycle } from '@clientShared/eventLifecycle';
import { eventLobbyHref } from '@/lib/activeSessionRoutes';

const READY_GATE_ACTIVE_STATUSES = new Set(['ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed']);
const READY_GATE_MANUAL_EXIT_SUPPRESS_MS = 45_000;
const GENERIC_SWIPE_FAILURE_OUTCOMES = new Set([
  'unknown',
  'swipe_failed',
  'internal_error',
  'invalid_request',
  'unauthorized',
]);

/**
 * If the in-lobby Ready Gate overlay stops making progress (realtime gaps, missed transitions),
 * hand off to standalone `/ready/[id]`, which runs its own subscriptions + polling — reduces stuck-overlay risk.
 */
const READY_GATE_LOBBY_OVERLAY_STALL_FALLBACK_MS = 30_000;

function logVdbgSessionStage(message: string, sessionId: string, data?: Record<string, unknown>) {
  if (!isVdbgEnabled()) return;
  vdbg(message, { sessionId, ...(data ?? {}) });
  void supabase
    .from('video_sessions')
    .select('id, event_id, ready_gate_status, state, phase, handshake_started_at, ended_at, ready_gate_expires_at, daily_room_name, daily_room_url')
    .eq('id', sessionId)
    .maybeSingle()
    .then(({ data: row, error }) => {
      vdbg(`${message}_stage`, {
        sessionId,
        ...(data ?? {}),
        row: row ?? null,
        error: error ? { code: error.code, message: error.message } : null,
      });
    });
}

function getEventEndTime(event_date: string, duration_minutes?: number | null): Date {
  const start = new Date(event_date);
  const duration = duration_minutes ?? 60;
  return new Date(start.getTime() + duration * 60 * 1000);
}

function formatHeightCm(cm: number | null | undefined): string | null {
  if (cm == null || cm <= 0) return null;
  return `${cm} cm`;
}

function formatEventCountdown(endTimeMs: number | null, nowMs: number): string {
  if (endTimeMs == null) return '';
  const diff = Math.max(0, Math.floor((endTimeMs - nowMs) / 1000));
  if (diff <= 0) return 'Ended';
  const m = Math.floor(diff / 60);
  const s = diff % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function useCountdown(endTime: Date | null, enabled = true): string {
  const [timeRemaining, setTimeRemaining] = useState('');
  const endTimeMs = endTime?.getTime() ?? null;

  useEffect(() => {
    if (!enabled || endTimeMs == null) return;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      const next = formatEventCountdown(endTimeMs, Date.now());
      setTimeRemaining(next);
      if (next === 'Ended') {
        if (intervalId != null) {
          clearInterval(intervalId);
          intervalId = null;
        }
      }
    };
    tick();
    intervalId = setInterval(tick, 1000);
    return () => {
      if (intervalId != null) clearInterval(intervalId);
    };
  }, [enabled, endTimeMs]);
  return timeRemaining;
}

export default function EventLobbyScreen() {
  const { eventId, pendingVideoSession, pendingMatch, postSurveyComplete } = useLocalSearchParams<{
    eventId: string;
    pendingVideoSession?: string;
    pendingMatch?: string;
    postSurveyComplete?: string | string[];
  }>();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  /** Supersedes stale `ready_gate_overlay` date-navigation rescue timers when a new attempt starts. */
  const dateNavRescueSeqRef = useRef(0);
  /** Same-session launch intent observed before `pathname` catches up to `/date/:id`. */
  const dateLaunchIntentSessionRef = useRef<string | null>(null);
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const pauseStatus = useAccountPauseStatus();
  const { show, dialog } = useVibelyDialog();
  const id = eventId ?? '';

  const { data: event, isLoading: eventLoading } = useEventDetails(id);
  const { data: regSnapshot, isLoading: regLoading } = useIsRegisteredForEvent(id, user?.id);
  const isConfirmedSeat = regSnapshot?.isConfirmed ?? false;
  const [lobbyClockMs, setLobbyClockMs] = useState(() => Date.now());
  const hasEvent = event != null;
  const eventDateValue = event?.event_date ?? null;
  const eventDurationMinutes = event?.duration_minutes ?? null;
  const eventArchivedAt = event?.archived_at ?? null;
  const eventEndedAt = event?.ended_at ?? null;
  const eventStatusRaw = event?.status ?? null;

  const eventEndTime = useMemo(
    () => (eventDateValue ? getEventEndTime(eventDateValue, eventDurationMinutes) : null),
    [eventDateValue, eventDurationMinutes]
  );
  const eventEndTimeMs = eventEndTime?.getTime() ?? null;
  const eventStatus = (eventStatusRaw ?? '').toLowerCase();
  const isEventArchived = Boolean(eventArchivedAt) || eventStatus === 'archived';
  const isEventCancelled = eventStatus === 'cancelled';
  const isEventDraft = eventStatus === 'draft';
  const resolvedEventLifecycle = useMemo(
    () =>
      eventDateValue
        ? resolveEventLifecycle({
            status: eventStatusRaw,
            event_date: eventDateValue,
            duration_minutes: eventDurationMinutes,
            ended_at: eventEndedAt,
            nowMs: lobbyClockMs,
          })
        : null,
    [eventDateValue, eventDurationMinutes, eventEndedAt, eventStatusRaw, lobbyClockMs]
  );
  const isEventEndedByTruth = resolvedEventLifecycle?.isEnded ?? false;
  const [serverInactiveEventReason, setServerInactiveEventReason] = useState<string | null>(null);
  const isEventInactiveByServer = serverInactiveEventReason != null;
  const lifecycleDebugKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!__DEV__ || !id || !eventDateValue || !resolvedEventLifecycle) return;
    const debugKey = [
      id,
      eventStatusRaw ?? '',
      eventDateValue,
      eventDurationMinutes ?? '',
      eventEndedAt ?? '',
      resolvedEventLifecycle.lifecycle,
    ].join('|');
    if (lifecycleDebugKeyRef.current === debugKey) return;
    lifecycleDebugKeyRef.current = debugKey;
    console.log('[EventLobby] event lifecycle resolved', {
      eventId: id,
      rawStatus: eventStatusRaw,
      event_date: eventDateValue,
      duration_minutes: eventDurationMinutes,
      ended_at: eventEndedAt,
      resolvedLifecycle: resolvedEventLifecycle.lifecycle,
    });
  }, [eventDateValue, eventDurationMinutes, eventEndedAt, eventStatusRaw, id, resolvedEventLifecycle]);

  const isLiveWindow = useMemo(() => {
    if (!eventDateValue || !eventEndTimeMs || !resolvedEventLifecycle) return false;
    if (
      isEventCancelled ||
      isEventArchived ||
      isEventDraft ||
      isEventEndedByTruth ||
      isEventInactiveByServer
    ) {
      return false;
    }
    return resolvedEventLifecycle.isLive;
  }, [
    eventDateValue,
    eventEndTimeMs,
    isEventArchived,
    isEventCancelled,
    isEventDraft,
    isEventEndedByTruth,
    isEventInactiveByServer,
    resolvedEventLifecycle,
  ]);

  const lobbySideEffectsEnabled = Boolean(
    id &&
      user?.id &&
      event &&
      !eventLoading &&
      !regLoading &&
      isConfirmedSeat &&
      !pauseStatus.isPaused &&
      isLiveWindow
  );
  const readinessV2 = useFeatureFlag('video_date.readiness_v2');
  const drainQueueV2 = useFeatureFlag('video_date.outbox_v2.drain_match_queue');
  const deckPrefetchPolishV2 = useFeatureFlag('video_date.deck_prefetch_polish_v2');
  const lobbyTimelineV2 = useFeatureFlag('video_date.lobby_timeline_v2');
  const videoDateReadiness = useNonBlockingVideoDateReadiness(
    id,
    readinessV2.enabled && lobbySideEffectsEnabled,
  );

  useEffect(() => {
    if (!eventDateValue) return;
    setLobbyClockMs(Date.now());
    if (
      lobbyTimelineV2.enabled &&
      typeof requestAnimationFrame === 'function' &&
      typeof cancelAnimationFrame === 'function'
    ) {
      let frameId: number | null = null;
      let lastSecond = -1;
      const loop = () => {
        const now = Date.now();
        const second = Math.floor(now / 1000);
        if (second !== lastSecond) {
          lastSecond = second;
          setLobbyClockMs(now);
        }
        if (eventEndTimeMs != null && now >= eventEndTimeMs) return;
        frameId = requestAnimationFrame(loop);
      };
      frameId = requestAnimationFrame(loop);
      return () => {
        if (frameId != null) cancelAnimationFrame(frameId);
      };
    }
    const interval = setInterval(() => setLobbyClockMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [eventDateValue, eventEndTimeMs, eventEndedAt, eventArchivedAt, eventStatusRaw, lobbyTimelineV2.enabled]);

  const deckQueryEnabled = lobbySideEffectsEnabled;
  const {
    data: profiles = [],
    isLoading: deckLoading,
    isError: deckError,
    error: deckErrorValue,
    refetch: refetchDeck,
  } = useEventDeck(
    id,
    user?.id ?? null,
    deckQueryEnabled
  );

  useFocusEffect(
    useCallback(() => {
      if (!id || !user?.id || !deckQueryEnabled) return;
      void queryClient.invalidateQueries({ queryKey: ['event-deck', id, user.id] });
    }, [id, user?.id, deckQueryEnabled, queryClient])
  );

  /** Mirrors web `sonner` completion toast after post-date survey (non-blocking). */
  const [postSurveyLobbyBanner, setPostSurveyLobbyBanner] = useState(false);
  const [postSurveyReturnContext, setPostSurveyReturnContext] = useState(false);
  const [postSurveyBridgeVisible, setPostSurveyBridgeVisible] = useState(false);
  /** Ready Gate forfeit / stale messages — matches web `toast` instead of blocking modal. */
  const [readyGateLobbyToast, setReadyGateLobbyToast] = useState<{ text: string; variant: 'info' | 'success' } | null>(
    null,
  );

  useEffect(() => {
    setPostSurveyReturnContext(false);
    setPostSurveyBridgeVisible(false);
    postSurveyRouteTrackedRef.current = null;
    deckLoadedTrackedRef.current = false;
    deckEmptyTrackedRef.current = false;
    deckErrorTrackedRef.current = false;
    deckPrefetchInFlightRef.current.clear();
    deckPrefetchLoadedRef.current.clear();
    deckPrefetchCacheHitTrackedRef.current.clear();
    lobbyBroadcastSessionSeqRef.current = null;
    setServerInactiveEventReason(null);
  }, [id]);

  useEffect(() => {
    const raw = Array.isArray(postSurveyComplete) ? postSurveyComplete[0] : postSurveyComplete;
    if (raw !== '1' || !id) return;
    setPostSurveyLobbyBanner(true);
    setPostSurveyReturnContext(true);
    setPostSurveyBridgeVisible(true);
    const pendingA = Array.isArray(pendingVideoSession) ? pendingVideoSession[0] : pendingVideoSession;
    const pendingB = Array.isArray(pendingMatch) ? pendingMatch[0] : pendingMatch;
    const nextParams = new URLSearchParams();
    if (pendingA) nextParams.set('pendingVideoSession', pendingA);
    if (pendingB) nextParams.set('pendingMatch', pendingB);
    const nextQuery = nextParams.toString();
    router.replace(`${eventLobbyHref(id)}${nextQuery ? `?${nextQuery}` : ''}` as Href);
    const tid = setTimeout(() => setPostSurveyLobbyBanner(false), 2000);
    return () => clearTimeout(tid);
  }, [id, pendingMatch, pendingVideoSession, postSurveyComplete]);

  useEffect(() => {
    if (!readyGateLobbyToast) return;
    const tid = setTimeout(() => setReadyGateLobbyToast(null), 2800);
    return () => clearTimeout(tid);
  }, [readyGateLobbyToast]);

  const onReadyGateLobbyMessage = useCallback((text: string, variant?: 'info' | 'success') => {
    setReadyGateLobbyToast({ text, variant: variant ?? 'info' });
  }, []);

  const sortedProfiles = useMemo(() => {
    // Server-dealt deck v2 is the only active source of deck exclusion truth.
    const filtered = [...profiles];
    filtered.sort((a, b) => {
      if (a.has_super_vibed && !b.has_super_vibed) return -1;
      if (!a.has_super_vibed && b.has_super_vibed) return 1;
      return 0;
    });
    return filtered;
  }, [profiles]);

  useEffect(() => {
    if (deckPrefetchPolishV2.enabled) return;
    for (const profile of sortedProfiles.slice(0, 3)) {
      const src = deckCardUrl(profile.primary_photo_path ?? profile.photos?.[0] ?? profile.avatar_url);
      if (src) void Image.prefetch(src);
    }
  }, [deckPrefetchPolishV2.enabled, sortedProfiles]);

  const deckPrefetchItems = useMemo(
    () =>
      getVideoDateDeckPrefetchItems(sortedProfiles)
        .map((item) => ({ ...item, url: deckCardUrl(item.source) }))
        .filter((item) => Boolean(item.url)),
    [sortedProfiles],
  );

  useEffect(() => {
    if (!deckPrefetchPolishV2.enabled) return;
    for (const item of deckPrefetchItems) {
      const src = item.url;
      if (!src) continue;
      if (deckPrefetchLoadedRef.current.has(src)) {
        const key = `${id}:${src}`;
        if (!deckPrefetchCacheHitTrackedRef.current.has(key)) {
          deckPrefetchCacheHitTrackedRef.current.add(key);
          trackEvent('video_date_deck_prefetch_cache_hit', {
            ...buildVideoDateDeckPrefetchTelemetryPayload({
              platform: 'native',
              eventId: id,
              profileId: item.profileId,
              rank: item.rank,
              sourceKind: item.sourceKind,
            }),
          });
        }
        continue;
      }
      if (deckPrefetchInFlightRef.current.has(src)) continue;
      deckPrefetchInFlightRef.current.add(src);
      trackEvent('video_date_deck_prefetch_cache_miss', {
        ...buildVideoDateDeckPrefetchTelemetryPayload({
          platform: 'native',
          eventId: id,
          profileId: item.profileId,
          rank: item.rank,
          sourceKind: item.sourceKind,
        }),
      });
      void Image.prefetch(src)
        .then((ok) => {
          if (ok) deckPrefetchLoadedRef.current.add(src);
          if (!ok) deckPrefetchInFlightRef.current.delete(src);
          trackEvent('video_date_deck_prefetch_result', {
            ...buildVideoDateDeckPrefetchTelemetryPayload({
              platform: 'native',
              eventId: id,
              profileId: item.profileId,
              rank: item.rank,
              sourceKind: item.sourceKind,
            }),
            outcome: ok ? 'success' : 'failure',
          });
        })
        .catch(() => {
          deckPrefetchInFlightRef.current.delete(src);
          trackEvent('video_date_deck_prefetch_result', {
            ...buildVideoDateDeckPrefetchTelemetryPayload({
              platform: 'native',
              eventId: id,
              profileId: item.profileId,
              rank: item.rank,
              sourceKind: item.sourceKind,
            }),
            outcome: 'failure',
          });
        });
    }
  }, [deckPrefetchItems, deckPrefetchPolishV2.enabled, id]);

  const [processing, setProcessing] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSessionPartnerName, setActiveSessionPartnerName] = useState<string | null>(null);
  const [activeSessionPartnerImage, setActiveSessionPartnerImage] = useState<string | null>(null);
  const [queuedMatchCount, setQueuedMatchCount] = useState(0);
  const [superVibeRemaining, setSuperVibeRemaining] = useState(3);
  const [showEventEndedModal, setShowEventEndedModal] = useState(false);
  const [endingBreak, setEndingBreak] = useState(false);
  const [userVibes, setUserVibes] = useState<string[]>([]);
  const lastOpenedSessionRef = useRef<string | null>(null);
  const readyGateManualExitSuppressUntilRef = useRef<Map<string, number>>(new Map());
  const postSurveyRouteTrackedRef = useRef<string | null>(null);
  const deckLoadedTrackedRef = useRef(false);
  const deckEmptyTrackedRef = useRef(false);
  const deckErrorTrackedRef = useRef(false);
  const deckPrefetchInFlightRef = useRef<Set<string>>(new Set());
  const deckPrefetchLoadedRef = useRef<Set<string>>(new Set());
  const deckPrefetchCacheHitTrackedRef = useRef<Set<string>>(new Set());
  const deckRefreshBurstTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lobbyRefreshBurstTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lobbyBroadcastSessionSeqRef = useRef<number | null>(null);
  /** Dedupe queued-TTL expiry dialog per `video_sessions.id` for this screen. */
  const queuedTtlExpiryNotifiedIdsRef = useRef<Set<string>>(new Set());
  /** Dedupe informational drain-reason toasts per user/event/reason for this screen. */
  const drainReasonNotifiedKeysRef = useRef<Set<string>>(new Set());
  const isActiveLobbyContextRef = useRef(false);
  const [isLobbyFocused, setIsLobbyFocused] = useState(false);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);

  const {
    activeSession: scopedSession,
    hydrated: sessionHydrated,
    refetch: refetchActiveSession,
  } = useActiveSession(user?.id, {
    eventId: id,
  });
  const lobbyBroadcastSessionId = scopedSession?.sessionId ?? activeSessionId;

  const navigateToDateSession = useCallback(
    (sessionIdToOpen: string, trigger: string, mode: 'replace' | 'push' = 'replace') => {
      void (async () => {
        const [startable, regRes] = await Promise.all([
          ensureVideoDateStartableBeforeNavigation({
            sessionId: sessionIdToOpen,
            source: `lobby_${trigger}`,
            userId: user?.id ?? null,
          }),
          user?.id
            ? supabase
                .from('event_registrations')
                .select('queue_status, current_room_id')
                .eq('event_id', id)
                .eq('profile_id', user.id)
                .eq('current_room_id', sessionIdToOpen)
                .maybeSingle()
            : Promise.resolve({ data: null as { queue_status?: string | null; current_room_id?: string | null } | null }),
        ]);
        const reg = regRes.data;
        const vs = startable.truth;
        const routedTo = startable.ok
          ? 'date'
          : startable.recommend === 'ready'
            ? 'ready'
            : startable.recommend === 'ended'
              ? 'ended'
              : 'lobby';
        const reason = startable.ok ? null : startable.reason;

        rcBreadcrumb(RC_CATEGORY.lobbyDateEntry, 'date_route_decision', {
          session_id: sessionIdToOpen,
          event_id: id,
          startable_ok: startable.ok,
          startable_reason: startable.ok ? startable.reason : startable.reason,
          reason,
          routed_to: routedTo,
          queue_status: reg?.queue_status ?? null,
          current_room_id: reg?.current_room_id ?? null,
          vs_state: vs?.state ?? null,
          vs_phase: vs?.phase ?? null,
          handshake_started_at: Boolean(vs?.handshake_started_at),
          ready_gate_status: vs?.ready_gate_status ?? null,
          ready_gate_expires_at: vs?.ready_gate_expires_at == null ? null : String(vs.ready_gate_expires_at),
        });
        vdbg('lobby_date_route_decision', {
          trigger,
          eventId: id,
          sessionId: sessionIdToOpen,
          startable_ok: startable.ok,
          startable_reason: startable.reason,
          routed_to: routedTo,
          queueStatus: reg?.queue_status ?? null,
          currentRoomId: reg?.current_room_id ?? null,
          vsState: vs?.state ?? null,
          vsPhase: vs?.phase ?? null,
          handshakeStartedAt: vs?.handshake_started_at ?? null,
          readyGateStatus: vs?.ready_gate_status ?? null,
          readyGateExpiresAt: vs?.ready_gate_expires_at ?? null,
        });

        if (!startable.ok) {
          // No /date entry is allowed unless backend truth confirms startability. Always clear the
          // entry latch on the recommended redirect so future attempts cannot be suppressed by a
          // stale latch from this aborted attempt.
          clearDateEntryTransition(sessionIdToOpen);
          if (startable.recommend === 'ready') {
            router.replace(startable.recommendHref);
            return;
          }
          // 'ended' / 'lobby' / 'tabs' — refetch active session so the lobby can settle, but if the
          // backend gave us a definitive terminal/lobby route, follow it.
          if (startable.recommend === 'ended') {
            router.replace(startable.recommendHref);
            return;
          }
          void refetchActiveSession();
          return;
        }

        if (user?.id) {
          const prepared = await prepareVideoDateEntry(sessionIdToOpen, {
            eventId: id,
            userId: user.id,
            source: `event_lobby_${trigger}`,
          });
          if (prepared.ok !== true) {
            clearDateEntryTransition(sessionIdToOpen);
            rcBreadcrumb(RC_CATEGORY.lobbyDateEntry, 'date_navigation_prepare_entry_failed', {
              session_id: sessionIdToOpen,
              event_id: id,
              trigger,
              code: prepared.code,
              retryable: prepared.retryable,
            });
            void refetchActiveSession();
            return;
          }
        }

        trackEvent(EventLobbyObservabilityEvents.DATE_ENTERED_FROM_LOBBY, {
          platform: 'native',
          event_id: id,
          session_id_present: true,
          source_surface: 'event_lobby',
          source_action: trigger,
        });

        if (trigger === 'ready_gate_overlay') {
          dateLaunchIntentSessionRef.current = sessionIdToOpen;
          setActiveSessionId((current) => (current === sessionIdToOpen ? null : current));
          setActiveSessionPartnerName(null);
          setActiveSessionPartnerImage(null);
        }

        const navigated = navigateToDateSessionGuarded({
          sessionId: sessionIdToOpen,
          pathname,
          mode,
          onSuppressed: ({ reason: suppressReason, target }) => {
            vdbg('lobby_navigate_to_date_suppressed', {
              trigger,
              eventId: id,
              target,
              sessionId: sessionIdToOpen,
              reason: suppressReason,
            });
          },
          onNavigate: ({ target, mode: resolvedMode }) => {
            logVdbgSessionStage('lobby_navigate_to_date', sessionIdToOpen, {
              trigger,
              eventId: id,
              target,
              mode: resolvedMode,
            });
          },
        });
        if (trigger === 'ready_gate_overlay' && navigated) {
          videoDateLaunchBreadcrumb('ready_lobby_overlay_navigate_to_date', {
            session_id: sessionIdToOpen,
            event_id: id,
          });
          markNativeVideoDateLaunchIntent('ready_lobby_overlay_both_ready');
        }
        if (trigger === 'ready_gate_overlay') {
          const rescueSeq = ++dateNavRescueSeqRef.current;
          const rescueSid = sessionIdToOpen;
          setTimeout(() => {
            if (rescueSeq !== dateNavRescueSeqRef.current) return;
            void (async () => {
              const p = pathnameRef.current ?? '';
              const onDate = p.match(/^\/date\/([^/]+)/)?.[1] === rescueSid;
              if (onDate) {
                rcBreadcrumb(RC_CATEGORY.lobbyDateEntry, 'date_navigation_rescue_skipped', {
                  session_id: rescueSid,
                  event_id: id,
                  reason: 'already_on_date_route',
                  pathname: p,
                });
                return;
              }
              if (
                dateLaunchIntentSessionRef.current === rescueSid ||
                isDateEntryTransitionActive(rescueSid)
              ) {
                rcBreadcrumb(RC_CATEGORY.lobbyDateEntry, 'date_navigation_rescue_skipped', {
                  session_id: rescueSid,
                  event_id: id,
                  reason: 'launch_already_in_progress',
                  pathname: p,
                  entry_transition_active: isDateEntryTransitionActive(rescueSid),
                });
                return;
              }
              rcBreadcrumb(RC_CATEGORY.lobbyDateEntry, 'date_navigation_rescue_attempt', {
                session_id: rescueSid,
                event_id: id,
                pathname: p,
              });
              const rescueStartable = await ensureVideoDateStartableBeforeNavigation({
                sessionId: rescueSid,
                source: 'ready_gate_overlay_rescue',
                userId: user?.id ?? null,
              });
              if (!rescueStartable.ok) {
                clearDateEntryTransition(rescueSid);
                rcBreadcrumb(RC_CATEGORY.lobbyDateEntry, 'date_navigation_rescue_failed', {
                  session_id: rescueSid,
                  event_id: id,
                  reason: rescueStartable.reason,
                  recommend: rescueStartable.recommend,
                });
                if (rescueStartable.recommend === 'ready' || rescueStartable.recommend === 'ended') {
                  router.replace(rescueStartable.recommendHref);
                }
                return;
              }
              const rescueNavigated = navigateToDateSessionGuarded({
                sessionId: rescueSid,
                pathname: pathnameRef.current,
                mode: 'replace',
                onSuppressed: ({ reason: suppressReason, target: t }) => {
                  vdbg('lobby_navigate_to_date_suppressed', {
                    trigger: 'ready_gate_overlay_rescue',
                    eventId: id,
                    target: t,
                    sessionId: rescueSid,
                    reason: suppressReason,
                  });
                },
                onNavigate: ({ target, mode: resolvedMode }) => {
                  logVdbgSessionStage('lobby_navigate_to_date', rescueSid, {
                    trigger: 'ready_gate_overlay_rescue',
                    eventId: id,
                    target,
                    mode: resolvedMode,
                  });
                },
              });
              rcBreadcrumb(
                RC_CATEGORY.lobbyDateEntry,
                rescueNavigated ? 'date_navigation_rescue_success' : 'date_navigation_rescue_failed',
                {
                  session_id: rescueSid,
                  event_id: id,
                  pathname: pathnameRef.current ?? null,
                  navigated: rescueNavigated,
                }
              );
            })();
          }, 1500);
        }
      })();
    },
    [id, pathname, refetchActiveSession, user?.id]
  );

  const sameEventActiveSession = useMemo(() => {
    if (!sessionHydrated || !id || !scopedSession || scopedSession.eventId !== id) return null;
    return scopedSession;
  }, [sessionHydrated, id, scopedSession]);

  /** Full-screen yield: server truth says handshake/date — do not show deck-empty underneath. */
  const yieldingToVideoDateUi = useMemo(
    () => Boolean(sameEventActiveSession?.kind === 'video'),
    [sameEventActiveSession]
  );

  /** Brief yield while hydrating Ready Gate overlay (`activeSessionId` catches up to `useActiveSession`). */
  const yieldingToReadyGateUi = useMemo(
    () =>
      Boolean(
        sameEventActiveSession?.kind === 'ready_gate' &&
          activeSessionId !== sameEventActiveSession.sessionId
      ),
    [sameEventActiveSession, activeSessionId]
  );

  /**
   * Queued match (or native `syncing` session) — replace plain deck-empty with sync messaging.
   */
  const showQueuedStyleConvergenceUi = useMemo(
    () =>
      Boolean(
        (queuedMatchCount > 0 || sameEventActiveSession?.kind === 'syncing') &&
          !activeSessionId &&
          !yieldingToVideoDateUi &&
          !yieldingToReadyGateUi
      ),
    [
      queuedMatchCount,
      sameEventActiveSession?.kind,
      activeSessionId,
      yieldingToVideoDateUi,
      yieldingToReadyGateUi,
    ]
  );

  /** Latest server vs overlay session ids for stall-fallback timeout (avoids stale closures). */
  const readyGateStallGuardRef = useRef({
    serverKind: null as string | null,
    serverSessionId: null as string | null,
    overlaySessionId: null as string | null,
  });
  readyGateStallGuardRef.current = {
    serverKind: sameEventActiveSession?.kind ?? null,
    serverSessionId:
      sameEventActiveSession?.kind === 'ready_gate' ? sameEventActiveSession.sessionId : null,
    overlaySessionId: activeSessionId,
  };

  const readyGateStallFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Dedupes `router.replace` if the timeout callback were ever re-entered before unmount. */
  const readyGateStallFallbackNavigatedSidRef = useRef<string | null>(null);

  useEffect(() => {
    readyGateStallFallbackNavigatedSidRef.current = null;
  }, [activeSessionId, sameEventActiveSession?.sessionId]);

  useEffect(() => {
    if (readyGateStallFallbackTimerRef.current != null) {
      clearTimeout(readyGateStallFallbackTimerRef.current);
      readyGateStallFallbackTimerRef.current = null;
    }

    if (
      !sessionHydrated ||
      sameEventActiveSession?.kind !== 'ready_gate' ||
      !activeSessionId ||
      activeSessionId !== sameEventActiveSession.sessionId
    ) {
      return;
    }

    const sid = activeSessionId;
    readyGateStallFallbackTimerRef.current = setTimeout(() => {
      readyGateStallFallbackTimerRef.current = null;
      const g = readyGateStallGuardRef.current;
      if (g.serverKind !== 'ready_gate' || g.serverSessionId !== sid || g.overlaySessionId !== sid) {
        return;
      }
      if (readyGateStallFallbackNavigatedSidRef.current === sid) {
        return;
      }
      readyGateStallFallbackNavigatedSidRef.current = sid;
      vdbg('ready_gate_stall_fallback_redirect', {
        sessionId: sid,
        eventId: id,
        target: `/ready/${sid}`,
        trigger: 'ready_gate_overlay_stall',
      });
      router.replace(`/ready/${sid}` as const);
    }, READY_GATE_LOBBY_OVERLAY_STALL_FALLBACK_MS);

    return () => {
      if (readyGateStallFallbackTimerRef.current != null) {
        clearTimeout(readyGateStallFallbackTimerRef.current);
        readyGateStallFallbackTimerRef.current = null;
      }
    };
  }, [
    sessionHydrated,
    activeSessionId,
    id,
    sameEventActiveSession?.kind,
    sameEventActiveSession?.sessionId,
  ]);

  useEventStatus(id, user?.id ?? undefined, lobbySideEffectsEnabled);

  useFocusEffect(
    useCallback(() => {
      setIsLobbyFocused(true);
      return () => setIsLobbyFocused(false);
    }, [])
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    isActiveLobbyContextRef.current = lobbySideEffectsEnabled && isLobbyFocused && appState === 'active';
  }, [appState, isLobbyFocused, lobbySideEffectsEnabled]);

  useEffect(() => {
    queuedTtlExpiryNotifiedIdsRef.current.clear();
    drainReasonNotifiedKeysRef.current.clear();
  }, [id, user?.id]);

  const showDrainReasonInfoOnce = useCallback(
    (payload: unknown) => {
      if (!id || !user?.id) return;
      if (!isActiveLobbyContextRef.current) return;
      const copy = getMatchQueueDrainReasonCopy(payload);
      if (!copy) return;
      const key = `${user.id}:${id}:${copy.reason}`;
      if (drainReasonNotifiedKeysRef.current.has(key)) return;
      drainReasonNotifiedKeysRef.current.add(key);
      setReadyGateLobbyToast({ text: copy.message, variant: 'info' });
    },
    [id, user?.id]
  );

  useEffect(() => {
    if (!id || !user?.id) return;
    if (!lobbySideEffectsEnabled || !isLobbyFocused || appState !== 'active') return;

    const stampForeground = async () => {
      try {
        await supabase.rpc('mark_lobby_foreground', { p_event_id: id });
      } catch (err) {
        if (__DEV__) console.warn('[lobby] mark_lobby_foreground failed:', err);
      }
    };

    void stampForeground();
    const intervalId = setInterval(() => {
      void stampForeground();
    }, 30000);

    return () => clearInterval(intervalId);
  }, [id, user?.id, lobbySideEffectsEnabled, isLobbyFocused, appState]);

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const { data } = await supabase
        .from('profile_vibes')
        .select('vibe_tags(label)')
        .eq('profile_id', user.id);
      if (!data) return;
      const labels = data
        .map((v) => {
          const raw = v.vibe_tags as { label: string } | { label: string }[] | null;
          const tag = Array.isArray(raw) ? raw[0] : raw;
          return tag?.label;
        })
        .filter(Boolean) as string[];
      setUserVibes(labels);
    })();
  }, [user?.id]);

  useEffect(() => {
    if (!id || !user?.id || !lobbySideEffectsEnabled) return;
    trackEvent(EventLobbyObservabilityEvents.LOBBY_ENTERED, {
      platform: 'native',
      event_id: id,
    });
  }, [id, user?.id, lobbySideEffectsEnabled]);

  const isReadyGateManualExitSuppressed = useCallback((sessionId: string): boolean => {
    const suppressUntil = readyGateManualExitSuppressUntilRef.current.get(sessionId);
    if (!suppressUntil) return false;
    if (suppressUntil <= Date.now()) {
      readyGateManualExitSuppressUntilRef.current.delete(sessionId);
      return false;
    }
    return true;
  }, []);

  const scheduleDeckRefresh = useCallback(
    (source: string, delayMs = 180) => {
      if (!id || !user?.id) return;
      if (deckRefreshBurstTimerRef.current) {
        vdbg('lobby_deck_refresh_coalesced', { eventId: id, source });
        return;
      }
      deckRefreshBurstTimerRef.current = setTimeout(() => {
        deckRefreshBurstTimerRef.current = null;
        void queryClient.invalidateQueries({ queryKey: ['event-deck', id, user.id] });
      }, delayMs);
    },
    [id, queryClient, user?.id],
  );

  const advanceDeckAfterSwipe = useCallback(
    (targetId: string): number => {
      const paintStartedAt = deckPrefetchPolishV2.enabled ? Date.now() : null;
      let remainingVisible = 0;
      let nextProfileAfterSwipe: DeckProfile | null = null;
      queryClient.setQueryData<DeckProfile[]>(
        ['event-deck', id, user?.id, 'deck_v2'],
        (current) => {
          if (!Array.isArray(current)) return current;
          const next = current.filter((profile) => profile.id !== targetId);
          remainingVisible = next.length;
          nextProfileAfterSwipe = next[0] ?? null;
          return next;
        },
      );
      if (remainingVisible === 0) {
        const fallbackNext = profiles.filter((profile) => profile.id !== targetId);
        remainingVisible = fallbackNext.length;
        nextProfileAfterSwipe = fallbackNext[0] ?? null;
      }
      const shouldTopUp = shouldTopUpVideoDateDeck(remainingVisible);
      if (deckPrefetchPolishV2.enabled) {
        trackEvent('video_date_deck_top_up_decision', {
          platform: 'native',
          event_id: id,
          remaining_visible: remainingVisible,
          should_top_up: shouldTopUp,
          reason: shouldTopUp ? 'threshold_reached' : 'buffer_sufficient',
        });
        if (paintStartedAt !== null) {
          const schedulePaint =
            typeof requestAnimationFrame === 'function'
              ? (callback: (time: number) => void) => requestAnimationFrame(callback)
              : (callback: (time: number) => void) => setTimeout(() => callback(Date.now()), 0) as unknown as number;
          schedulePaint(() => {
            const source = getVideoDateDeckPrefetchSource(nextProfileAfterSwipe);
            const src = source ? deckCardUrl(source.source) : null;
            trackEvent('video_date_deck_swipe_next_card_paint', {
              platform: 'native',
              event_id: id,
              duration_ms: Math.max(0, Date.now() - paintStartedAt),
              cache_hit: src ? deckPrefetchLoadedRef.current.has(src) : null,
              next_profile_present: Boolean(nextProfileAfterSwipe),
              remaining_visible: remainingVisible,
            });
          });
        }
      }
      if (shouldTopUp) {
        void queryClient.invalidateQueries({ queryKey: ['event-deck', id, user?.id] });
      }
      return remainingVisible;
    },
    [deckPrefetchPolishV2.enabled, id, profiles, queryClient, user?.id],
  );

  useEffect(() => {
    return () => {
      if (deckRefreshBurstTimerRef.current) {
        clearTimeout(deckRefreshBurstTimerRef.current);
        deckRefreshBurstTimerRef.current = null;
      }
      if (lobbyRefreshBurstTimerRef.current) {
        clearTimeout(lobbyRefreshBurstTimerRef.current);
        lobbyRefreshBurstTimerRef.current = null;
      }
    };
  }, []);

  const openReadyGateWithSession = useCallback(
    (sessionId: string, trigger = 'unknown') => {
      if (lastOpenedSessionRef.current === sessionId) return;
      if (isReadyGateManualExitSuppressed(sessionId)) {
        rcBreadcrumb(RC_CATEGORY.readyGate, 'ready_gate_open_suppressed_after_manual_exit', {
          session_id: sessionId,
          event_id: id,
          trigger,
        });
        return;
      }
      lastOpenedSessionRef.current = sessionId;
      scheduleDeckRefresh(`ready_gate_open_${trigger}`);
      logVdbgSessionStage('ready_gate_open', sessionId, {
        trigger,
        eventId: id,
      });
      setActiveSessionId(sessionId);
      setActiveSessionPartnerName(null);
      setActiveSessionPartnerImage(null);
      if (!user?.id) return;
      void (async () => {
        try {
          const { data: session } = await supabase
            .from('video_sessions')
            .select('participant_1_id, participant_2_id, event_id, ready_gate_status, state, phase, handshake_started_at, ended_at, ready_gate_expires_at, daily_room_name, daily_room_url')
            .eq('id', sessionId)
            .maybeSingle();
          vdbg('ready_gate_open_loaded_session', {
            sessionId,
            trigger,
            eventId: id,
            row: session ?? null,
          });
          if (!session) return;
          const decision = decideVideoSessionRouteFromTruth(session);
          const canAttemptDaily = canAttemptDailyRoomFromVideoSessionTruth(session);
          if (canAttemptDaily) {
            if (lastOpenedSessionRef.current !== sessionId) {
              vdbg('lobby_date_route_decision_suppressed_stale_ready_gate_open', {
                trigger: `ready_gate_open_${trigger}`,
                eventId: id,
                sessionId,
                activeSessionId: lastOpenedSessionRef.current,
              });
              return;
            }
            rcBreadcrumb(RC_CATEGORY.lobbyDateEntry, 'date_route_decision', {
              session_id: sessionId,
              event_id: id,
              decision,
              can_attempt_daily: canAttemptDaily,
              reason: null,
              ready_gate_status: session.ready_gate_status ?? null,
              ready_gate_expires_at:
                session.ready_gate_expires_at == null ? null : String(session.ready_gate_expires_at),
              vs_state: session.state ?? null,
              vs_phase: session.phase ?? null,
              routed_to: 'date',
              source: `ready_gate_open_${trigger}`,
            });
            vdbg('lobby_date_route_decision', {
              trigger: `ready_gate_open_${trigger}`,
              eventId: id,
              sessionId,
              decision,
              canAttemptDaily,
              readyGateStatus: session.ready_gate_status ?? null,
              readyGateExpiresAt: session.ready_gate_expires_at ?? null,
              vsState: session.state ?? null,
              vsPhase: session.phase ?? null,
              routed_to: 'date',
            });
            navigateToDateSession(sessionId, `ready_gate_open_${trigger}`, 'replace');
            return;
          }
          const partnerId = session.participant_1_id === user.id ? session.participant_2_id : session.participant_1_id;
          const { data: profile } = await supabase.rpc('get_profile_for_viewer', {
            p_target_id: partnerId,
          });
          if (lastOpenedSessionRef.current !== sessionId) return;
          const p = profile as { name?: string | null; avatar_url?: string | null; photos?: string[] | null } | null;
          if (p) {
            setActiveSessionPartnerName(p.name ?? null);
            const img = resolvePrimaryProfilePhotoPath({
              photos: p.photos ?? undefined,
              avatar_url: p.avatar_url ?? undefined,
            });
            setActiveSessionPartnerImage(img ? avatarUrl(img) : null);
          }
        } catch (error) {
          vdbg('ready_gate_open_background_enrichment_failed', {
            error: error instanceof Error ? error.message : String(error),
            eventId: id,
            sessionId,
            trigger,
          });
        }
      })();
    },
    [id, isReadyGateManualExitSuppressed, navigateToDateSession, scheduleDeckRefresh, user?.id]
  );

  const suppressReadyGateAfterManualExit = useCallback((sessionId: string) => {
    const suppressUntilMs = Date.now() + READY_GATE_MANUAL_EXIT_SUPPRESS_MS;
    readyGateManualExitSuppressUntilRef.current.set(sessionId, suppressUntilMs);
    if (readinessV2.enabled) {
      void persistReadyGateSuppressionV2(sessionId, suppressUntilMs);
    }
    if (lastOpenedSessionRef.current === sessionId) {
      lastOpenedSessionRef.current = null;
    }
    setActiveSessionId((current) => (current === sessionId ? null : current));
    setActiveSessionPartnerName(null);
    setActiveSessionPartnerImage(null);
  }, [readinessV2.enabled]);

  const refreshQueueAndSuperVibe = useCallback(async () => {
    if (!id || !user?.id || !lobbySideEffectsEnabled) {
      setQueuedMatchCount(0);
      return;
    }
    const [count, remaining] = await Promise.all([
      getQueuedMatchCount(id, user.id),
      getSuperVibeRemaining(id, user.id),
    ]);
    setQueuedMatchCount(count);
    setSuperVibeRemaining(remaining);
    void refetchActiveSession();
  }, [id, user?.id, lobbySideEffectsEnabled, refetchActiveSession]);

  const scheduleLobbyRefreshBurst = useCallback(
    (source: string, delayMs = 180) => {
      if (lobbyRefreshBurstTimerRef.current) {
        vdbg('lobby_refresh_burst_coalesced', { eventId: id, source });
        return;
      }
      lobbyRefreshBurstTimerRef.current = setTimeout(() => {
        lobbyRefreshBurstTimerRef.current = null;
        void refetchDeck();
        void refreshQueueAndSuperVibe();
      }, delayMs);
    },
    [id, refetchDeck, refreshQueueAndSuperVibe],
  );

  useEffect(() => {
    if (!id || !user?.id || !lobbySideEffectsEnabled || !isLobbyFocused || appState !== 'active') return;
    void refreshQueueAndSuperVibe();
  }, [id, user?.id, lobbySideEffectsEnabled, isLobbyFocused, appState, refreshQueueAndSuperVibe]);

  useEffect(() => {
    if (!sessionHydrated || !id) return;
    vdbg('lobby_mount_active_session', {
      eventId: id,
      hydrated: sessionHydrated,
      activeSessionExists: Boolean(sameEventActiveSession),
      activeSessionKind: sameEventActiveSession?.kind ?? null,
      activeSessionId: sameEventActiveSession?.sessionId ?? null,
      activeSessionQueueStatus: (sameEventActiveSession as { queueStatus?: unknown } | null)?.queueStatus ?? null,
    });
    if (sameEventActiveSession?.sessionId) {
      logVdbgSessionStage('lobby_mount_active_session_detail', sameEventActiveSession.sessionId, {
        eventId: id,
        activeSessionKind: sameEventActiveSession.kind,
        activeSessionQueueStatus: (sameEventActiveSession as { queueStatus?: unknown }).queueStatus ?? null,
      });
    }
    if (sameEventActiveSession?.kind === 'video') {
      navigateToDateSession(sameEventActiveSession.sessionId, 'active_session_hydration', 'replace');
      return;
    }
    if (sameEventActiveSession?.kind === 'ready_gate') {
      openReadyGateWithSession(sameEventActiveSession.sessionId, 'active_session_hydration');
    }
  }, [sessionHydrated, id, sameEventActiveSession, openReadyGateWithSession, navigateToDateSession]);

  /**
   * Queued mutual match: promotion may lag realtime. Re-run `drain_match_queue` with adaptive backoff
   * (same curve as reconnect sync) while queued/syncing and not already routing to date/Ready Gate.
   * Realtime on `event_registrations` / `video_sessions` + `queue_drain_initial` still drive fast paths.
   */
  useEffect(() => {
    if (!id || !user?.id) return;
    if (!lobbySideEffectsEnabled || !isLobbyFocused || appState !== 'active') return;
    if (queuedMatchCount <= 0 && sameEventActiveSession?.kind !== 'syncing') return;
    if (activeSessionId) return;
    if (sameEventActiveSession?.kind === 'video') return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();

    const tick = async () => {
      if (cancelled) return;
      const result = await drainMatchQueue(id, user.id, {
        drainMatchQueueV2: drainQueueV2.enabled,
        sourceAction: 'queue_drain_interval',
      });
      const promotedSessionId = videoSessionIdFromDrainPayload(result ?? undefined);
      if (result?.found && promotedSessionId) {
        openReadyGateWithSession(promotedSessionId, 'queue_drain_interval');
      } else {
        if (cancelled) return;
        showDrainReasonInfoOnce(result);
      }
      scheduleLobbyRefreshBurst('queue_drain_interval');
      if (cancelled) return;
      const elapsed = Date.now() - startedAt;
      const delay = nextConvergenceDelayMs(elapsed);
      timeoutId = setTimeout(() => {
        void tick();
      }, delay);
    };

    void tick();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [
    id,
    user?.id,
    isLobbyFocused,
    appState,
    lobbySideEffectsEnabled,
    queuedMatchCount,
    activeSessionId,
    sameEventActiveSession?.kind,
    openReadyGateWithSession,
    scheduleLobbyRefreshBurst,
    showDrainReasonInfoOnce,
    drainQueueV2.enabled,
  ]);

  useEffect(() => {
    if (!id || !user?.id || !lobbySideEffectsEnabled) return;
    let cancelled = false;
    const run = async () => {
      const result = await drainMatchQueue(id, user.id, {
        drainMatchQueueV2: drainQueueV2.enabled,
        sourceAction: 'queue_drain_initial',
      });
      const sessionId = videoSessionIdFromDrainPayload(result ?? undefined);
      if (result?.found && sessionId) {
        openReadyGateWithSession(sessionId, 'queue_drain_initial');
      } else {
        if (cancelled) return;
        showDrainReasonInfoOnce(result);
      }
      scheduleLobbyRefreshBurst('queue_drain_initial');
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [
    id,
    user?.id,
    lobbySideEffectsEnabled,
    openReadyGateWithSession,
    scheduleLobbyRefreshBurst,
    showDrainReasonInfoOnce,
    drainQueueV2.enabled,
  ]);

  useEffect(() => {
    if (!id) return;
    const a = Array.isArray(pendingVideoSession) ? pendingVideoSession[0] : pendingVideoSession;
    const b = Array.isArray(pendingMatch) ? pendingMatch[0] : pendingMatch;
    const pending = typeof a === 'string' && a ? a : typeof b === 'string' && b ? b : undefined;
    if (pending) {
      openReadyGateWithSession(pending, 'pending_deep_link');
    }
  }, [id, pendingVideoSession, pendingMatch, openReadyGateWithSession]);

  useEffect(() => {
    if (id && user?.id && lobbySideEffectsEnabled) scheduleLobbyRefreshBurst('lobby_side_effects_enabled', 0);
  }, [id, user?.id, lobbySideEffectsEnabled, scheduleLobbyRefreshBurst]);

  useEffect(() => {
    if (!user?.id || !id) return;
    const channel = supabase
      .channel(`lobby-reg-${id}-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'event_registrations', filter: `profile_id=eq.${user.id}` },
        async (payload) => {
          const newData = payload.new as Record<string, unknown>;
          if (newData.event_id !== id) return;
          const queueStatus = newData.queue_status as string | undefined;
          const currentRoomId = newData.current_room_id as string | null | undefined;
          if (
            (queueStatus === 'in_handshake' || queueStatus === 'in_date') &&
            currentRoomId
          ) {
            navigateToDateSession(currentRoomId, 'registration_realtime', 'replace');
            return;
          }
          if (queueStatus === 'in_ready_gate' && currentRoomId) {
            openReadyGateWithSession(currentRoomId, 'registration_realtime');
            return;
          }
          if (
            queueStatus === 'in_ready_gate' ||
            queueStatus === 'in_handshake' ||
            queueStatus === 'in_date' ||
            currentRoomId
          ) {
            const { data: latestReg } = await supabase
              .from('event_registrations')
              .select('queue_status, current_room_id')
              .eq('event_id', id)
              .eq('profile_id', user.id)
              .maybeSingle();
            if (
              (latestReg?.queue_status === 'in_handshake' || latestReg?.queue_status === 'in_date') &&
              latestReg.current_room_id
            ) {
              navigateToDateSession(latestReg.current_room_id, 'registration_realtime_refetch', 'replace');
              return;
            }
            if (latestReg?.queue_status === 'in_ready_gate' && latestReg.current_room_id) {
              openReadyGateWithSession(latestReg.current_room_id, 'registration_realtime_refetch');
            }
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, user?.id, openReadyGateWithSession, navigateToDateSession]);

  useEffect(() => {
    if (!user?.id || !id) return;
    if (lobbyTimelineV2.enabled && lobbyBroadcastSessionId) return;
    const handleVideoSessionUpdate = async (payload: {
      new: Record<string, unknown>;
      old?: Record<string, unknown> | null;
    }) => {
      const session = payload.new as Record<string, unknown>;
      if (session.event_id !== id) return;
      const old = payload.old as Record<string, unknown> | null;
      const isParticipant = session.participant_1_id === user.id || session.participant_2_id === user.id;
      if (!isParticipant) return;
      const sid = session.id as string;
      if (deckPrefetchPolishV2.enabled) {
        scheduleDeckRefresh('video_session_update_deck_invalidation', 0);
      }
      if (
        user.id &&
        isVideoSessionQueuedTtlExpiryTransition(old, session, user.id) &&
        !queuedTtlExpiryNotifiedIdsRef.current.has(sid)
      ) {
        queuedTtlExpiryNotifiedIdsRef.current.add(sid);
        show({
          title: 'Match window ended',
          message: QUEUED_MATCH_TIMED_OUT_USER_MESSAGE,
          variant: 'info',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
      }
      scheduleLobbyRefreshBurst('video_session_update');
      if (canAttemptDailyRoomFromVideoSessionTruth(session)) {
        navigateToDateSession(session.id as string, 'video_session_update_both_ready', 'replace');
        return;
      }
      const newStatus = session.ready_gate_status as string;
      const oldStatus = old?.ready_gate_status as string | undefined;
      const becameReadyGateActive =
        READY_GATE_ACTIVE_STATUSES.has(newStatus) &&
        (!oldStatus || !READY_GATE_ACTIVE_STATUSES.has(oldStatus));
      if (becameReadyGateActive) {
        openReadyGateWithSession(session.id as string, 'video_session_update');
        return;
      }
      // If this participant's session has already moved into provider-confirmed
      // video truth, route out of lobby even if ready-gate transitions were missed.
      if (decideVideoSessionRouteFromTruth(session) === 'navigate_date') {
        navigateToDateSession(session.id as string, 'video_session_update', 'replace');
      }
    };

    const handleVideoSessionInsert = async (payload: { new: Record<string, unknown> }) => {
      const session = payload.new as Record<string, unknown>;
      if (session.event_id !== id) return;
      const isParticipant = session.participant_1_id === user.id || session.participant_2_id === user.id;
      if (!isParticipant) return;
      if (deckPrefetchPolishV2.enabled) {
        scheduleDeckRefresh('video_session_insert_deck_invalidation', 0);
      }
      scheduleLobbyRefreshBurst('video_session_insert');
      const status = session.ready_gate_status as string;
      const sid = session.id as string;
      if (canAttemptDailyRoomFromVideoSessionTruth(session)) {
        navigateToDateSession(sid, 'video_session_insert_both_ready', 'replace');
        return;
      }
      if (status === 'queued') {
        const drainResult = await drainMatchQueue(id, user.id, {
          drainMatchQueueV2: drainQueueV2.enabled,
          sourceAction: 'video_session_insert_queue_drain',
        });
        const promotedId = videoSessionIdFromDrainPayload(drainResult ?? undefined);
        if (drainResult?.found && promotedId) {
          openReadyGateWithSession(promotedId, 'video_session_insert_queue_drain');
        } else {
          showDrainReasonInfoOnce(drainResult);
        }
        scheduleLobbyRefreshBurst('video_session_insert_queue_drain');
        return;
      }
      if (READY_GATE_ACTIVE_STATUSES.has(status)) {
        openReadyGateWithSession(sid, 'video_session_insert');
        return;
      }
      if (decideVideoSessionRouteFromTruth(session) === 'navigate_date') {
        navigateToDateSession(sid, 'video_session_insert', 'replace');
      }
    };

    const channel = supabase.channel(`lobby-video-${id}-${user.id}`);
    // Realtime cannot OR participant columns in one filter. Native lobby uses
    // participant-scoped bindings plus event validation and queue/refetch fallback.
    for (const filter of [`participant_1_id=eq.${user.id}`, `participant_2_id=eq.${user.id}`]) {
      channel
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'video_sessions', filter },
          handleVideoSessionUpdate
        )
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'video_sessions', filter },
          handleVideoSessionInsert
        );
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [
    id,
    user?.id,
    openReadyGateWithSession,
    scheduleLobbyRefreshBurst,
    show,
    showDrainReasonInfoOnce,
    navigateToDateSession,
    drainQueueV2.enabled,
    deckPrefetchPolishV2.enabled,
    lobbyBroadcastSessionId,
    lobbyTimelineV2.enabled,
    scheduleDeckRefresh,
  ]);

  const reconcileLobbyBroadcastEvent = useCallback(
    (event: VideoDateSessionBroadcastEvent) => {
      if (!id || !user?.id) return;
      const decision = resolveVideoDateSessionSeqDecision(lobbyBroadcastSessionSeqRef.current, event.sessionSeq);
      if (decision.action === 'invalid' || decision.action === 'duplicate') return;
      lobbyBroadcastSessionSeqRef.current = event.sessionSeq;
      scheduleLobbyRefreshBurst(`broadcast_${event.kind}`);
      if (deckPrefetchPolishV2.enabled) scheduleDeckRefresh(`broadcast_${event.kind}_deck_invalidation`, 0);
      if (event.kind === 'ready_gate_both_ready') {
        navigateToDateSession(event.sessionId, 'broadcast_ready_gate_both_ready', 'replace');
      }
    },
    [deckPrefetchPolishV2.enabled, id, navigateToDateSession, scheduleDeckRefresh, scheduleLobbyRefreshBurst, user?.id],
  );

  useEffect(() => {
    if (!id || !user?.id || !lobbyTimelineV2.enabled || !lobbyBroadcastSessionId) {
      lobbyBroadcastSessionSeqRef.current = null;
      return;
    }
    const subscription = createVideoDateSessionChannel(supabase, {
      sessionId: lobbyBroadcastSessionId,
      onEvent: reconcileLobbyBroadcastEvent,
      onInvalidPayload: () => {
        vdbg('lobby_session_broadcast_invalid_payload_ignored', { eventId: id, sessionId: lobbyBroadcastSessionId });
      },
      onStatusChange: (status, error) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          vdbg('lobby_session_broadcast_channel_degraded', {
            eventId: id,
            sessionId: lobbyBroadcastSessionId,
            status,
            error: error instanceof Error ? error.message : String(error ?? ''),
          });
          scheduleLobbyRefreshBurst('broadcast_channel_degraded');
        }
      },
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [
    id,
    lobbyBroadcastSessionId,
    lobbyTimelineV2.enabled,
    reconcileLobbyBroadcastEvent,
    scheduleLobbyRefreshBurst,
    user?.id,
  ]);

  const legacyTimeRemaining = useCountdown(eventEndTime, !lobbyTimelineV2.enabled);
  const timeRemaining = lobbyTimelineV2.enabled
    ? formatEventCountdown(eventEndTimeMs, lobbyClockMs)
    : legacyTimeRemaining;

  useEffect(() => {
    if (!hasEvent || !id) return;
    if (isEventEndedByTruth) {
      setShowEventEndedModal(true);
      return;
    }
    const channel = supabase
      .channel(`event-lifecycle-${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${id}` },
        (payload) => {
          const row = payload.new as { status?: string | null; archived_at?: string | null; ended_at?: string | null };
          const status = (row.status ?? '').toLowerCase();
          if (row.ended_at) setShowEventEndedModal(true);
          if (status === 'cancelled' || status === 'archived' || status === 'draft' || row.archived_at) {
            show({
              title: status === 'cancelled' ? 'This event was cancelled' : 'This event is not available',
              message: 'You’ll be taken back to the event page.',
              variant: 'warning',
              primaryAction: { label: 'OK', onPress: () => {} },
            });
            router.replace(`/(tabs)/events/${id}` as const);
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [hasEvent, id, isEventEndedByTruth, show]);

  useEffect(() => {
    if (!eventEndTime) return;
    const interval = setInterval(() => {
      if (Date.now() >= eventEndTime.getTime()) setShowEventEndedModal(true);
    }, 30000);
    return () => clearInterval(interval);
  }, [eventEndTime]);

  const mysteryMatchEnabled = lobbySideEffectsEnabled;
  const { findMysteryMatch, cancelSearch, isSearching, isWaiting } = useMysteryMatch({
    eventId: id,
    onMatchFound: (sessionId) => {
      openReadyGateWithSession(sessionId, 'mystery_match');
    },
    enabled: mysteryMatchEnabled,
  });

  const eventSubtitle = useMemo(() => {
    if (!event?.event_date) return 'Live room';
    const t = new Date(event.event_date).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    const place = event.location_name?.trim();
    return `${t} · ${place || 'Live room'}`;
  }, [event?.event_date, event?.location_name]);

  const showSwipeToast = useCallback(
    (result: string, options?: { openingReadyGate?: boolean }) => {
      switch (result) {
        case 'vibe_recorded':
        case 'swipe_recorded':
        case 'pass_recorded':
        case 'already_swiped':
        case 'swipe_already_recorded':
          break;
        case 'match':
          show({
            title: "It's a match!",
            message: 'Opening Ready Gate...',
            variant: 'success',
            primaryAction: { label: 'OK', onPress: () => {} },
          });
          break;
        case 'match_queued':
          show({
            title: "You're matched!",
            message:
              "We'll bring you to Ready Gate when your partner is free — keep browsing.",
            variant: 'success',
            primaryAction: { label: 'Got it', onPress: () => {} },
          });
          break;
        case 'super_vibe_sent':
          show({
            title: 'Super Vibe sent! ✨',
            variant: 'success',
            primaryAction: { label: 'OK', onPress: () => {} },
          });
          break;
        case 'limit_reached':
          show({
            title: 'Super Vibe limit',
            message: 'You’ve used all 3 Super Vibes for this event.',
            variant: 'warning',
            primaryAction: { label: 'OK', onPress: () => {} },
          });
          break;
        case 'already_super_vibed_recently':
          show({
            title: 'Already sent',
            message: 'You recently Super Vibed this person.',
            variant: 'info',
            primaryAction: { label: 'OK', onPress: () => {} },
          });
          break;
        case 'already_matched':
          if (options?.openingReadyGate) {
            show({
              title: 'Ready Gate is open',
              message: 'Taking you back to this match attempt.',
              variant: 'success',
              primaryAction: { label: 'OK', onPress: () => {} },
            });
          } else {
            show({
              title: "You're already matched",
              message: "We'll bring you to Ready Gate when this match is ready.",
              variant: 'info',
              primaryAction: { label: 'OK', onPress: () => {} },
            });
          }
          break;
        case 'participant_has_active_session_conflict':
          show({
            title: 'Match in progress',
            message: SWIPE_SESSION_CONFLICT_USER_MESSAGE,
            variant: 'info',
            primaryAction: { label: 'OK', onPress: () => {} },
          });
          break;
        case 'pair_already_met_this_event':
          show({
            title: 'Already met',
            message: 'You already met this person in this event. Keep browsing for new people.',
            variant: 'info',
            primaryAction: { label: 'OK', onPress: () => {} },
          });
          break;
        case 'event_not_active':
          show({
            title: 'Event not active',
            message: 'This event was cancelled or is no longer available for swipes.',
            variant: 'warning',
            primaryAction: { label: 'OK', onPress: () => {} },
          });
          break;
        case 'account_paused':
          show({
            title: 'Account paused',
            message: 'Resume your account before swiping in this event.',
            variant: 'info',
            primaryAction: { label: 'OK', onPress: () => {} },
          });
          break;
        case 'not_registered':
          show({
            title: 'Registration required',
            message: 'Only confirmed guests can swipe in this lobby.',
            variant: 'warning',
            primaryAction: { label: 'OK', onPress: () => {} },
          });
          break;
        case 'target_unavailable':
        case 'target_not_found':
          show({
            title: 'Not available',
            message: 'This person is no longer available in the lobby.',
            variant: 'info',
            primaryAction: { label: 'OK', onPress: () => {} },
          });
          break;
        case 'blocked':
        case 'reported':
          show({
            title: 'Not available',
            message: 'This person isn’t available for matching right now.',
            variant: 'warning',
            primaryAction: { label: 'OK', onPress: () => {} },
          });
          break;
        default:
          break;
      }
    },
    [show]
  );

  const isOffline = useConnectivity() === 'offline';
  const current = sortedProfiles[0] ?? null;
  const nextProfile = sortedProfiles[1] ?? null;
  const thirdProfile = sortedProfiles[2] ?? null;
  const hasCards = sortedProfiles.length > 0;
  const isEmpty = !hasCards || !current;
  const currentAvailabilityState = current?.availability_state ?? 'available';
  const currentIsSwipeable = currentAvailabilityState === 'available';
  const swipeActionsDisabled = processing || !currentIsSwipeable;

  const convergenceImpressionRef = useRef(false);
  const emptyStateImpressionRef = useRef(false);
  const mysteryCtaImpressionRef = useRef(false);

  const showConvergenceYieldUi = yieldingToVideoDateUi || yieldingToReadyGateUi;
  const baseEmptyEligible =
    deckQueryEnabled &&
    !deckLoading &&
    !deckError &&
    !showConvergenceYieldUi &&
    !showQueuedStyleConvergenceUi;
  const deckGateKind = useMemo(() => {
    if (!id) return 'missing_event';
    if (!user?.id) return 'missing_user';
    if (pauseStatus.isPaused) return 'account_paused';
    if (!hasEvent) return 'missing_event';
    if (!isConfirmedSeat) return regSnapshot?.isWaitlisted ? 'not_confirmed' : 'not_registered';
    if (isEventCancelled) return 'cancelled';
    if (isEventArchived) return 'archived';
    if (isEventDraft) return 'draft';
    if (isEventEndedByTruth) return 'ended';
    if (isEventInactiveByServer) return 'event_not_active';
    if (!isLiveWindow) return 'not_live';
    return 'live';
  }, [
    hasEvent,
    id,
    isConfirmedSeat,
    isEventArchived,
    isEventCancelled,
    isEventDraft,
    isEventEndedByTruth,
    isEventInactiveByServer,
    isLiveWindow,
    pauseStatus.isPaused,
    regSnapshot?.isWaitlisted,
    user?.id,
  ]);
  const deckEmptyReason = useMemo(
    () =>
      resolveDeckEmptyReason({
        deckEnabled: deckQueryEnabled,
        gateKind: deckGateKind,
        deckError,
        deckErrorValue,
        totalProfiles: profiles.length,
        visibleProfiles: sortedProfiles.length,
        deckEverLoaded: deckLoadedTrackedRef.current,
        queuedCount: queuedMatchCount,
        yieldingToReadyGate: yieldingToReadyGateUi,
        yieldingToVideoDate: yieldingToVideoDateUi,
        userPaused: pauseStatus.isPaused,
      }),
    [
      deckError,
      deckErrorValue,
      deckGateKind,
      deckQueryEnabled,
      pauseStatus.isPaused,
      profiles.length,
      queuedMatchCount,
      sortedProfiles.length,
      yieldingToReadyGateUi,
      yieldingToVideoDateUi,
    ],
  );
  const secondsUntilEventEnd = secondsUntilPostDateEventEnd(eventEndTime);
  const postSurveyContinuityDecision = useMemo(
    () =>
      getPostDateLobbyContinuityDecision({
        yieldingToVideoDate: yieldingToVideoDateUi,
        yieldingToReadyGate: yieldingToReadyGateUi,
        hasQueuedSession: showQueuedStyleConvergenceUi || queuedMatchCount > 0,
        deckLoading,
        deckHasCandidate: hasCards,
        deckError,
        eventLive: isLiveWindow,
        secondsUntilEventEnd,
      }),
    [
      deckError,
      deckLoading,
      hasCards,
      isLiveWindow,
      queuedMatchCount,
      secondsUntilEventEnd,
      showQueuedStyleConvergenceUi,
      yieldingToReadyGateUi,
      yieldingToVideoDateUi,
    ]
  );

  useEffect(() => {
    if (!id || !deckQueryEnabled || deckLoading || deckError || profiles.length === 0) {
      if (!deckQueryEnabled) deckLoadedTrackedRef.current = false;
      return;
    }
    if (deckLoadedTrackedRef.current) return;
    deckLoadedTrackedRef.current = true;
    trackEvent(EventLobbyObservabilityEvents.LOBBY_DECK_LOADED, {
      platform: 'native',
      event_id: id,
      deck_count_bucket: bucketEventLobbyCount(profiles.length),
      visible_count_bucket: bucketEventLobbyCount(sortedProfiles.length),
      has_visible_cards: sortedProfiles.length > 0,
      source_surface: 'event_lobby',
    });
  }, [deckError, deckLoading, deckQueryEnabled, id, profiles.length, sortedProfiles.length]);

  useEffect(() => {
    if (!id || !deckError) {
      deckErrorTrackedRef.current = false;
      return;
    }
    if (deckEmptyReason === 'event_not_active') {
      setServerInactiveEventReason('event_not_active');
      void queryClient.invalidateQueries({ queryKey: ['event-details', id] });
    }
    if (deckErrorTrackedRef.current) return;
    deckErrorTrackedRef.current = true;
    trackEvent(EventLobbyObservabilityEvents.LOBBY_DECK_ERROR, {
      platform: 'native',
      event_id: id,
      reason: deckEmptyReason,
      source_surface: 'event_lobby',
    });
    Sentry.addBreadcrumb({
      category: 'event-lobby',
      level: 'warning',
      message: EventLobbyObservabilityEvents.LOBBY_DECK_ERROR,
      data: { eventId: id, reason: deckEmptyReason },
    });
  }, [deckEmptyReason, deckError, id, queryClient]);

  useEffect(() => {
    if (!id || eventLoading || regLoading || deckLoading || deckError) {
      deckEmptyTrackedRef.current = false;
      return;
    }
    const shouldTrackEmpty = !deckQueryEnabled || isEmpty;
    if (!shouldTrackEmpty) {
      deckEmptyTrackedRef.current = false;
      return;
    }
    if (deckEmptyTrackedRef.current) return;
    deckEmptyTrackedRef.current = true;
    trackEvent(EventLobbyObservabilityEvents.LOBBY_DECK_EMPTY, {
      platform: 'native',
      event_id: id,
      reason: deckEmptyReason,
      deck_count_bucket: bucketEventLobbyCount(profiles.length),
      visible_count_bucket: bucketEventLobbyCount(sortedProfiles.length),
      source_surface: 'event_lobby',
    });
  }, [
    deckEmptyReason,
    deckError,
    deckLoading,
    deckQueryEnabled,
    eventLoading,
    id,
    isEmpty,
    profiles.length,
    regLoading,
    sortedProfiles.length,
  ]);

  useEffect(() => {
    if (!id || !showConvergenceYieldUi) {
      convergenceImpressionRef.current = false;
      return;
    }
    if (convergenceImpressionRef.current) return;
    convergenceImpressionRef.current = true;
    trackEvent(LobbyPostDateEvents.LOBBY_CONVERGENCE_IMPRESSION, {
      platform: 'native',
      event_id: id,
      source_surface: yieldingToVideoDateUi ? 'video_date' : 'ready_gate',
    });
  }, [id, showConvergenceYieldUi, yieldingToVideoDateUi]);

  useEffect(() => {
    if (!id || !baseEmptyEligible || !isEmpty) {
      emptyStateImpressionRef.current = false;
      return;
    }
    if (emptyStateImpressionRef.current) return;
    emptyStateImpressionRef.current = true;
    trackEvent(LobbyPostDateEvents.LOBBY_EMPTY_STATE_IMPRESSION, {
      platform: 'native',
      event_id: id,
    });
  }, [baseEmptyEligible, id, isEmpty]);

  useEffect(() => {
    const mysteryVisible =
      Boolean(id) &&
      baseEmptyEligible &&
      isEmpty &&
      mysteryMatchEnabled &&
      !isWaiting;
    if (!mysteryVisible) {
      mysteryCtaImpressionRef.current = false;
      return;
    }
    if (mysteryCtaImpressionRef.current) return;
    mysteryCtaImpressionRef.current = true;
    trackEvent(LobbyPostDateEvents.MYSTERY_MATCH_CTA_IMPRESSION, {
      platform: 'native',
      event_id: id,
    });
  }, [baseEmptyEligible, id, isEmpty, isWaiting, mysteryMatchEnabled]);

  useEffect(() => {
    if (!postSurveyBridgeVisible) return;
    if (deckLoading || !sessionHydrated) return;
    const tid = setTimeout(() => setPostSurveyBridgeVisible(false), 1200);
    return () => clearTimeout(tid);
  }, [deckLoading, postSurveyBridgeVisible, sessionHydrated]);

  useEffect(() => {
    if (!postSurveyReturnContext || !id) return;
    if (postSurveyBridgeVisible && postSurveyContinuityDecision.action === 'refreshing_deck') return;
    if (postSurveyRouteTrackedRef.current) return;
    postSurveyRouteTrackedRef.current = postSurveyContinuityDecision.action;
    const route =
      postSurveyContinuityDecision.action === 'ready_gate'
        ? 'event_lobby_ready_gate'
        : postSurveyContinuityDecision.action === 'video_date'
          ? 'date'
          : postSurveyContinuityDecision.action === 'fresh_deck'
            ? 'event_lobby_fresh_card'
            : postSurveyContinuityDecision.action === 'last_chance'
              ? hasCards
                ? 'event_lobby_last_chance_card'
                : 'event_lobby_last_chance_empty'
              : postSurveyContinuityDecision.action === 'event_ended'
                ? 'event_ended'
                : 'event_lobby_empty';
    trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_NEXT_ACTION_DECIDED, {
      platform: 'native',
      event_id: id,
      action: postSurveyContinuityDecision.action,
      source: 'lobby_post_survey_return',
      queued_count: queuedMatchCount,
      deck_count: sortedProfiles.length,
      seconds_until_event_end: secondsUntilEventEnd,
    });
    trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_ROUTE_TAKEN, {
      platform: 'native',
      event_id: id,
      action: postSurveyContinuityDecision.action,
      route,
      queued_count: queuedMatchCount,
      deck_count: sortedProfiles.length,
      seconds_until_event_end: secondsUntilEventEnd,
    });
  }, [
    hasCards,
    id,
    postSurveyBridgeVisible,
    postSurveyContinuityDecision.action,
    postSurveyReturnContext,
    queuedMatchCount,
    secondsUntilEventEnd,
    sortedProfiles.length,
  ]);

  if (eventLoading || (user?.id && regLoading)) {
    return (
      <>
        <View style={[styles.centered, { backgroundColor: theme.background }]}>
          <LoadingState title="Loading lobby..." message="Getting the lobby ready..." />
        </View>
        {dialog}
      </>
    );
  }

  if (!event) {
    return (
      <>
        <View style={[styles.centered, { backgroundColor: theme.background }]}>
          <ErrorState
            title="Event not found"
            message="This event may have been removed or hasn't started yet. Go back to find another."
            actionLabel="Go back"
            onActionPress={() => router.back()}
          />
        </View>
        {dialog}
      </>
    );
  }

  if (!user?.id) {
    return (
      <>
        <View style={[styles.centered, { backgroundColor: theme.background }]}>
          <ErrorState
            title="Sign in to view the lobby"
            message="You need to be signed in to discover who's here."
            actionLabel="Go back"
            onActionPress={() => router.back()}
          />
        </View>
        {dialog}
      </>
    );
  }

  const isEventEndedForLobby = isEventEndedByTruth;

  if (isEventCancelled || isEventArchived || isEventDraft) {
    const title = isEventCancelled
      ? 'This event was cancelled'
      : isEventArchived
        ? 'This event is archived'
        : 'This event is not available yet';
    return (
      <>
        <View style={[styles.centered, { backgroundColor: theme.background }]}>
          <ErrorState
            title={title}
            message="Head back to the event page for details and booking options."
            actionLabel="Back to event"
            onActionPress={() => router.replace(`/(tabs)/events/${id}` as const)}
          />
        </View>
        {dialog}
      </>
    );
  }

  if (isEventEndedForLobby) {
    return (
      <>
        <View style={[styles.centered, { backgroundColor: theme.background }]}>
          <ErrorState
            title="This event has ended"
            message="The live lobby is closed. Head back to the event for details."
            actionLabel="Back to event"
            onActionPress={() => router.replace(`/(tabs)/events/${id}` as const)}
          />
        </View>
        {dialog}
      </>
    );
  }

  if (isEventInactiveByServer) {
    return (
      <>
        <View style={[styles.centered, { backgroundColor: theme.background }]}>
          <ErrorState
            title="This lobby is closed"
            message="The backend says this event is no longer active. Head back to the event page for the latest status."
            actionLabel="Back to event"
            onActionPress={() => router.replace(`/(tabs)/events/${id}` as const)}
          />
        </View>
        {dialog}
      </>
    );
  }

  if (!isConfirmedSeat) {
    return (
      <>
        <View style={[styles.centered, { backgroundColor: theme.background }]}>
          <ErrorState
            title={regSnapshot?.isWaitlisted ? 'On the paid waitlist' : 'Register first'}
            message={
              regSnapshot?.isWaitlisted
                ? 'The event was full when your payment settled. We’ll let you in if a spot opens — the lobby is for confirmed guests only.'
                : 'Register for this event to view the lobby and meet people.'
            }
            actionLabel="Go back"
            onActionPress={() => router.back()}
          />
        </View>
        {dialog}
      </>
    );
  }

  if (!isLiveWindow) {
    return (
      <>
        <View style={[styles.centered, { backgroundColor: theme.background }]}>
          <ErrorState
            title={isEventEndedForLobby ? 'This event has ended' : "This event isn't live yet"}
            message={
              isEventEndedForLobby
                ? 'The live lobby is closed. Head back to the event for details.'
                : 'Join the lobby when your event starts — check the countdown on the event page.'
            }
            actionLabel="Back to event"
            onActionPress={() => router.replace(`/(tabs)/events/${id}` as const)}
          />
        </View>
        {dialog}
      </>
    );
  }

  const discoverSectionIntro = (
    <View style={styles.sectionIntro}>
      <Text style={[styles.sectionKicker, { color: theme.textSecondary }]}>Discover</Text>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>
        Swipe fast — vibes are live in this room
      </Text>
    </View>
  );

  const handleSwipe = async (swipeType: 'vibe' | 'pass' | 'super_vibe') => {
    if (!current || processing || !lobbySideEffectsEnabled) return;
    if (isOffline) {
      show({
        title: 'You’re offline',
        message: 'Reconnect to swipe and match in the lobby.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
      return;
    }
    if (swipeType !== 'pass' && readinessV2.enabled && !videoDateReadiness.canAttemptPairing) {
      show({
        title: 'Camera and mic needed',
        message: videoDateReadiness.reason ?? 'Enable camera and microphone access before pairing for a video date.',
        variant: 'info',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
      return;
    }
    if (!currentIsSwipeable) {
      show({
        title: 'Not available',
        message: 'This person is not available for a new match right now.',
        variant: 'info',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
      return;
    }
    setProcessing(true);
    const targetId = current.id;
    try {
      trackEvent(EventLobbyObservabilityEvents.LOBBY_SWIPE_SUBMITTED, {
        platform: 'native',
        event_id: id,
        swipe_type: swipeType,
        source_surface: 'event_lobby',
      });
      Sentry.addBreadcrumb({
        category: 'event-lobby',
        level: 'info',
        message: EventLobbyObservabilityEvents.LOBBY_SWIPE_SUBMITTED,
        data: { eventId: id, swipeType },
      });
      const result = await swipe(id, targetId, swipeType);
      if (!result) {
        trackEvent(EventLobbyObservabilityEvents.LOBBY_SWIPE_RESULT, {
          event_id: id,
          platform: 'native',
          swipe_type: swipeType,
          outcome: 'invoke_error',
          reason: 'network_error',
          session_id_present: false,
          notification_attempted: false,
          notification_suppressed_reason: 'network_error',
          duplicate: false,
        });
        show({
          title: 'Something went wrong',
          message: 'Check your connection and try again.',
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
        return;
      }

      const envelope = result as SwipeResult;
      const normalizedEnvelope = {
        ...envelope,
        result: envelope.result ?? envelope.outcome ?? envelope.error ?? null,
      } as SwipeResult;
      if (envelope.success === false) {
        const failureOutcome = getSwipeOutcome(normalizedEnvelope);
        trackEvent(
          EventLobbyObservabilityEvents.LOBBY_SWIPE_RESULT,
          buildLobbySwipeResultPayload({
            eventId: id,
            platform: 'native',
            swipeType,
            result: normalizedEnvelope,
          }),
        );
        if (failureOutcome === 'event_not_active') {
          const failureReason =
            'reason' in envelope && typeof envelope.reason === 'string'
              ? envelope.reason
              : envelope.error ?? 'event_not_active';
          setServerInactiveEventReason(failureReason);
          cancelSearch();
          void queryClient.invalidateQueries({ queryKey: ['event-details', id] });
        }
        showSwipeToast(failureOutcome);
        if (GENERIC_SWIPE_FAILURE_OUTCOMES.has(failureOutcome)) {
          show({
            title: 'Unable to swipe',
            message: getSwipeFailureUserMessage(normalizedEnvelope),
            variant: 'warning',
            primaryAction: { label: 'OK', onPress: () => {} },
          });
        }
        if (shouldAdvanceLobbyDeckAfterSwipe(failureOutcome)) {
          const remainingVisible = advanceDeckAfterSwipe(targetId);
          if (remainingVisible === 0) {
            scheduleDeckRefresh('swipe_failure_visible_deck_empty', 0);
          }
        }
        return;
      }

      const outcome = getSwipeOutcome(normalizedEnvelope);
      if (outcome === 'unknown') {
        trackEvent(EventLobbyObservabilityEvents.LOBBY_SWIPE_RESULT, {
          event_id: id,
          platform: 'native',
          swipe_type: swipeType,
          outcome: 'missing_result_code',
          reason: 'missing_result_code',
          session_id_present: false,
          notification_attempted: false,
          notification_suppressed_reason: 'missing_result_code',
          duplicate: false,
        });
        show({
          title: 'Something went wrong',
          message: 'Tap to try again, or refresh the deck.',
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
        return;
      }

      trackEvent('swipe', {
        event_id: id,
        swipe_type: swipeType,
        result: outcome,
      });
      const lobbySwipeResultPayload = buildLobbySwipeResultPayload({
        eventId: id,
        platform: 'native',
        swipeType,
        result: normalizedEnvelope,
      });
      trackEvent(EventLobbyObservabilityEvents.LOBBY_SWIPE_RESULT, lobbySwipeResultPayload);
      if (isDuplicateSwipeResult(normalizedEnvelope)) {
        trackEvent(EventLobbyObservabilityEvents.LOBBY_SWIPE_DUPLICATE_SUPPRESSED, {
          platform: 'native',
          event_id: id,
          swipe_type: swipeType,
          outcome,
          reason: getSwipeNotificationSuppressionReason(normalizedEnvelope) ?? 'already_swiped',
          source_surface: 'event_lobby',
        });
      }
      Sentry.addBreadcrumb({
        category: 'event-lobby',
        level: 'info',
        message: EventLobbyObservabilityEvents.LOBBY_SWIPE_RESULT,
        data: {
          eventId: id,
          swipeType,
          outcome,
          duplicate: lobbySwipeResultPayload.duplicate,
          sessionIdPresent: lobbySwipeResultPayload.session_id_present,
        },
      });

      const videoSessionId = videoSessionIdFromSwipePayload(normalizedEnvelope);
      const openingReadyGate = shouldOpenReadyGateFromSwipePayload(normalizedEnvelope);
      const conflictDetected =
        outcome === 'already_matched' || outcome === 'participant_has_active_session_conflict';
      const recoveryStartedAtMs = conflictDetected ? Date.now() : null;
      if (conflictDetected) {
        if (outcome === 'participant_has_active_session_conflict') {
          trackEvent(LobbyPostDateEvents.DUPLICATE_ACTIVE_SESSION_CONFLICT, {
            platform: 'native',
            event_id: id,
            session_id: videoSessionId ?? null,
            source_surface: 'event_lobby',
            source_action: 'swipe_result',
            reason_code: outcome,
            outcome: videoSessionId ? 'blocked' : 'failure',
          });
        }
        trackEvent(LobbyPostDateEvents.SIMULTANEOUS_SWIPE_CONFLICT_DETECTED, {
          platform: 'native',
          event_id: id,
          session_id: videoSessionId ?? null,
          source_surface: 'event_lobby',
          source_action: 'swipe_result',
          reason_code: outcome,
          outcome: videoSessionId ? 'blocked' : 'failure',
        });
        if (videoSessionId && openingReadyGate) {
          trackEvent(LobbyPostDateEvents.SIMULTANEOUS_SWIPE_RECOVERY_ATTEMPTED, {
            platform: 'native',
            event_id: id,
            session_id: videoSessionId,
            source_surface: 'event_lobby',
            source_action: 'open_existing_ready_gate_from_swipe',
            reason_code: outcome,
            attempt_count: 1,
            outcome: 'no_op',
          });
        } else {
          const recoveryDurationMs =
            recoveryStartedAtMs == null ? null : Math.max(0, Date.now() - recoveryStartedAtMs);
          trackEvent(LobbyPostDateEvents.SIMULTANEOUS_SWIPE_RECOVERY_FAILED, {
            platform: 'native',
            event_id: id,
            session_id: videoSessionId ?? null,
            source_surface: 'event_lobby',
            source_action: 'swipe_result_no_recoverable_session',
            reason_code: outcome,
            attempt_count: 1,
            duration_ms: recoveryDurationMs,
            latency_bucket: bucketVideoDateLatencyMs(recoveryDurationMs),
            outcome: 'failure',
          });
        }
      }
      if (openingReadyGate && videoSessionId) {
        if (isReadyGateManualExitSuppressed(videoSessionId)) {
          rcBreadcrumb(RC_CATEGORY.readyGate, 'swipe_ready_gate_open_suppressed_after_manual_exit', {
            session_id: videoSessionId,
            event_id: id,
          });
          return;
        }
        lastOpenedSessionRef.current = videoSessionId;
        logVdbgSessionStage('ready_gate_open', videoSessionId, {
          trigger: outcome === 'already_matched' ? 'swipe_already_matched' : 'swipe_match',
          eventId: id,
          swipeType,
          result: outcome,
        });
        setActiveSessionId(videoSessionId);
        setActiveSessionPartnerName(current?.name ?? null);
        const img = resolvePrimaryProfilePhotoPath({
          photos: current?.photos,
          avatar_url: current?.avatar_url,
        });
        setActiveSessionPartnerImage(img ? avatarUrl(img) : null);
        if (outcome === 'already_matched') {
          const recoveryDurationMs =
            recoveryStartedAtMs == null ? null : Math.max(0, Date.now() - recoveryStartedAtMs);
          trackEvent(LobbyPostDateEvents.SIMULTANEOUS_SWIPE_RECOVERY_SUCCEEDED, {
            platform: 'native',
            event_id: id,
            session_id: videoSessionId,
            source_surface: 'event_lobby',
            source_action: 'open_existing_ready_gate_from_swipe',
            reason_code: 'already_matched',
            attempt_count: 1,
            duration_ms: recoveryDurationMs,
            latency_bucket: bucketVideoDateLatencyMs(recoveryDurationMs),
            outcome: 'success',
          });
        }
        scheduleDeckRefresh('swipe_ready_gate_open');
      }

      showSwipeToast(outcome, { openingReadyGate });
      if (outcome === 'super_vibe_sent' || outcome === 'limit_reached' || outcome === 'match_queued') {
        scheduleLobbyRefreshBurst('swipe_result_counts');
      }
      if (outcome === 'match' || outcome === 'already_matched' || outcome === 'match_queued') {
        queryClient.invalidateQueries({ queryKey: ['profile-live-counts'] });
      }

      const shouldAdvanceDeck = shouldAdvanceLobbyDeckAfterSwipe(outcome);
      if (!shouldAdvanceDeck) {
        return;
      }

      const remainingVisible = advanceDeckAfterSwipe(targetId);
      if (remainingVisible === 0) {
        scheduleDeckRefresh('swipe_visible_deck_empty', 0);
      }
    } catch (error) {
      trackEvent(EventLobbyObservabilityEvents.LOBBY_SWIPE_RESULT, {
        event_id: id,
        platform: 'native',
        swipe_type: swipeType,
        outcome: 'client_exception',
        reason: 'client_exception',
        session_id_present: false,
        notification_attempted: false,
        notification_suppressed_reason: 'client_exception',
        duplicate: false,
      });
      Sentry.addBreadcrumb({
        category: 'event-lobby',
        level: 'error',
        message: 'lobby_swipe_exception',
        data: { eventId: id, swipeType, errorName: error instanceof Error ? error.name : 'unknown' },
      });
      show({
        title: 'Something went wrong',
        message: 'Tap the card to try again, or pull to refresh the deck.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <>
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <LinearGradient
        colors={['rgba(139, 92, 246, 0.2)', 'rgba(18, 18, 22, 0.92)', theme.background]}
        locations={[0, 0.32, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <GlassHeaderBar insets={insets} style={styles.headerBar}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backBtnRound, { borderColor: theme.glassBorder, backgroundColor: withAlpha(theme.text, 0.06) }, pressed && { opacity: 0.85 }]}
            accessibilityLabel="Back"
          >
            <Ionicons name="arrow-back" size={22} color={theme.text} />
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>
              {event.title}
            </Text>
            <Text style={[styles.headerSubtitle, { color: theme.textSecondary }]} numberOfLines={1}>
              {eventSubtitle}
            </Text>
            <View style={styles.headerLiveRow}>
              <View style={[styles.livePillStrong, { backgroundColor: withAlpha(theme.success, 0.18), borderColor: withAlpha(theme.success, 0.45) }]}>
                <View style={[styles.liveDot, { backgroundColor: theme.success }]} />
                <Text style={[styles.liveTextStrong, { color: '#86efac' }]}>Live now</Text>
              </View>
              {(queuedMatchCount > 0 || sameEventActiveSession?.kind === 'syncing') && !activeSessionId ? (
                <View
                  style={[styles.queuedBadge, { backgroundColor: withAlpha(theme.neonPink, 0.14), borderColor: withAlpha(theme.neonPink, 0.35) }]}
                  accessibilityLabel={
                    queuedMatchCount === 1
                      ? 'One mutual match is waiting in the queue before Ready Gate'
                      : `${queuedMatchCount} mutual matches waiting in the queue before Ready Gate`
                  }
                >
                  <Ionicons name="sparkles" size={11} color={theme.neonPink} />
                  <Text style={[styles.queuedBadgeText, { color: theme.neonPink }]}>
                    {queuedMatchCount === 1 ? '1 waiting in queue' : `${queuedMatchCount} waiting in queue`}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
          <View style={styles.headerRightCol}>
            <View style={[styles.countdownPill, { backgroundColor: withAlpha(theme.text, 0.06), borderColor: theme.glassBorder }]}>
              <Ionicons name="time-outline" size={14} color={theme.textSecondary} />
              <Text style={[styles.countdownText, { color: theme.text }]}>{timeRemaining || '—'}</Text>
            </View>
          </View>
        </View>
        {hasCards && !pauseStatus.isPaused ? (
          <View style={styles.deckProgressSection}>
            <View style={styles.deckProgressLabels}>
              <Text style={[styles.deckProgressLabel, { color: theme.textSecondary }]}>Deck</Text>
              <Text style={[styles.deckProgressCount, { color: theme.text }]}>
                {sortedProfiles.length > 0 ? 'Next card ready' : '—'}
              </Text>
            </View>
            <View style={[styles.deckProgressTrack, { backgroundColor: withAlpha(theme.text, 0.08) }]}>
              <LinearGradient
                colors={[theme.tint, theme.neonCyan]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={[styles.deckProgressFill, { width: '100%' }]}
              />
            </View>
          </View>
        ) : null}
      </GlassHeaderBar>

      <LiveSurfaceOfflineStrip />

      <View style={styles.body}>
        {pauseStatus.isPaused ? (
          <View style={styles.onBreakWrap}>
            <Ionicons name="moon-outline" size={64} color="rgba(245, 158, 11, 0.2)" />
            <Text style={[styles.onBreakTitle, { color: theme.text }]}>{"You're on a break"}</Text>
            <Text style={[styles.onBreakSubtitle, { color: theme.textSecondary }]}>
              {pauseStatus.isTimedBreak && pauseStatus.pausedUntil
                ? `Discovery is paused until ${pauseStatus.pausedUntil.toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}`
                : 'Discovery is paused'}
            </Text>
            <Text style={[styles.onBreakBody, { color: theme.textSecondary }]}>
              {
                "Other people can't see you right now, and you won't appear in anyone's deck. Your existing matches and chats are still active."
              }
            </Text>
            <VibelyButton
              label="End break & start discovering"
              loading={endingBreak}
              onPress={() => {
                if (!user?.id || endingBreak) return;
                setEndingBreak(true);
                void (async () => {
                  try {
                    const { error } = await endAccountBreakForUser(user.id);
                    if (error) {
                      show({
                        title: 'Couldn’t update',
                        message: error.message,
                        variant: 'warning',
                        primaryAction: { label: 'OK', onPress: () => {} },
                      });
                      return;
                    }
                    await queryClient.invalidateQueries({ queryKey: ['account-pause-status'] });
                    await queryClient.invalidateQueries({ queryKey: ['my-profile'] });
                    show({
                      title: 'Welcome back!',
                      message: "You're visible again.",
                      variant: 'success',
                      primaryAction: { label: 'OK', onPress: () => {} },
                    });
                  } finally {
                    setEndingBreak(false);
                  }
                })();
              }}
              variant="secondary"
              disabled={endingBreak}
              style={{
                marginTop: spacing.lg,
                borderColor: '#F59E0B',
                borderWidth: 1,
                backgroundColor: 'transparent',
              }}
              textStyle={{ color: '#F59E0B', fontWeight: '600' }}
            />
          </View>
        ) : (
          <>
        {yieldingToVideoDateUi || yieldingToReadyGateUi ? (
          <View style={styles.convergenceYieldWrap}>
            <LoadingState
              title={
                postSurveyReturnContext
                  ? postSurveyContinuityDecision.title
                  : yieldingToVideoDateUi
                    ? 'Joining your date...'
                    : 'Opening Ready Gate...'
              }
              message={
                postSurveyReturnContext
                  ? postSurveyContinuityDecision.message
                  : yieldingToVideoDateUi
                    ? 'Taking you to the same video session as your match.'
                    : 'Syncing with your match. Almost there.'
              }
            />
          </View>
        ) : deckError && !hasCards ? (
          <>
            {discoverSectionIntro}
            <View style={styles.centeredInner}>
            <ErrorState
              title="Couldn't load deck"
              message="We couldn't load people in this room. Check your connection and tap Retry."
              actionLabel="Retry"
              onActionPress={() => refetchDeck()}
            />
          </View>
          </>
        ) : deckLoading && !hasCards ? (
          <>
            {discoverSectionIntro}
            {postSurveyReturnContext ? (
              <PostSurveyLobbyBridge decision={postSurveyContinuityDecision} theme={theme} />
            ) : null}
            <View style={styles.deckSkeletonWrap}>
            <View style={[styles.deckSkeletonCard, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
              <View style={[styles.deckSkeletonImage, { backgroundColor: theme.muted }]} />
              <View style={styles.deckSkeletonBody}>
                <Skeleton width={160} height={24} borderRadius={8} backgroundColor={theme.muted} />
                <Skeleton width={120} height={14} borderRadius={6} backgroundColor={theme.muted} style={{ marginTop: spacing.md }} />
                <Skeleton width={200} height={12} borderRadius={6} backgroundColor={theme.muted} style={{ marginTop: spacing.sm }} />
              </View>
            </View>
          </View>
          </>
        ) : showQueuedStyleConvergenceUi ? (
          <View style={styles.emptyStateVerticalCenter}>
            {discoverSectionIntro}
            <Card variant="glass" style={[styles.emptyCard, { borderColor: theme.glassBorder }]}>
              <>
                <View
                  style={[
                    styles.emptyIconWrap,
                    { backgroundColor: withAlpha(theme.neonPink, 0.16) },
                  ]}
                >
                  <Ionicons name="sparkles" size={40} color={theme.neonPink} />
                </View>
                <Text style={[styles.emptyTitle, { color: theme.text }]}>
                  {postSurveyReturnContext ? postSurveyContinuityDecision.title : 'Your match is syncing'}
                </Text>
                  <Text style={[styles.emptyMessage, { color: theme.textSecondary }]}>
                    {postSurveyReturnContext
                      ? postSurveyContinuityDecision.message
                      : 'We’re opening Ready Gate as soon as you’re both available in this lobby. Stay here — we’ll bring you in automatically.'}
                  </Text>
                <View style={styles.emptyCheckingRow}>
                  <Ionicons name="sync" size={14} color={theme.tint} />
                  <Text style={[styles.emptySubline, { color: theme.tint }]}>
                    {postSurveyReturnContext ? 'Preparing Ready Gate...' : 'Looking for your video date...'}
                  </Text>
                </View>
              </>
            </Card>
          </View>
        ) : !hasCards || isEmpty ? (
          <View style={styles.emptyStateVerticalCenter}>
            {discoverSectionIntro}
            <Card variant="glass" style={[styles.emptyCard, { borderColor: theme.glassBorder }]}>
              {isWaiting ? (
                <>
                  <Text style={styles.emptyEmoji}>⏳</Text>
                  <Text style={[styles.emptyTitle, { color: theme.text }]}>Hang tight!</Text>
                  <Text style={[styles.emptyMessage, { color: theme.textSecondary }]}>
                    New people may join the event! We&apos;ll refresh your deck automatically.
                  </Text>
                  <View style={styles.emptyCheckingRow}>
                    <Ionicons name="sync" size={14} color={theme.tint} />
                    <Text style={[styles.emptySubline, { color: theme.tint }]}>Checking for new arrivals...</Text>
                  </View>
                  <Pressable
                    style={({ pressed }) => [styles.emptySecondaryBtn, pressed && { opacity: 0.8 }]}
                    onPress={cancelSearch}
                  >
                    <Text style={[styles.emptySecondaryLabel, { color: theme.textSecondary }]}>No thanks, I&apos;ll wait</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <View style={[styles.emptyIconWrap, { backgroundColor: theme.accentSoft }]}>
                    <Ionicons name="people-outline" size={40} color={theme.tint} />
                  </View>
                  <Text style={[styles.emptyTitle, { color: theme.text }]}>
                    {postSurveyReturnContext ? postSurveyContinuityDecision.title : "You've seen everyone for now"}
                  </Text>
                  <Text style={[styles.emptyMessage, { color: theme.textSecondary }]}>
                    {postSurveyReturnContext
                      ? postSurveyContinuityDecision.message
                      : 'More people may join the room — your deck refreshes every few seconds. Refresh any time. Mystery Match is an optional in-app shortcut for a random pairing while you wait (not available on web yet).'}
                  </Text>
                  <Pressable
                    style={({ pressed }) => [styles.emptyPrimaryBtn, { backgroundColor: theme.tint }, pressed && { opacity: 0.9 }]}
                    onPress={() => {
                      if (id) {
                        trackEvent(LobbyPostDateEvents.LOBBY_EMPTY_STATE_REFRESH_TAP, {
                          platform: 'native',
                          event_id: id,
                        });
                      }
                      cancelSearch();
                      refetchDeck();
                    }}
                  >
                    <Text style={styles.emptyPrimaryLabel}>Refresh now</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      styles.emptyMysteryBtn,
                      { borderColor: theme.border, backgroundColor: withAlpha(theme.text, 0.04) },
                      pressed && { opacity: 0.85 },
                      isSearching && { opacity: 0.6 },
                    ]}
                    onPress={() => {
                      if (id) {
                        trackEvent(LobbyPostDateEvents.MYSTERY_MATCH_CTA_TAP, {
                          platform: 'native',
                          event_id: id,
                        });
                      }
                      void findMysteryMatch();
                    }}
                    disabled={isSearching}
                  >
                    {isSearching ? (
                      <Text style={[styles.emptySecondaryLabel, { color: theme.text }]}>Finding match...</Text>
                    ) : (
                      <Text style={[styles.emptySecondaryLabel, { color: theme.text }]}>Mystery Match (optional)</Text>
                    )}
                  </Pressable>
                </>
              )}
            </Card>
          </View>
        ) : (
          <>
            {discoverSectionIntro}
            {postSurveyBridgeVisible ? (
              <PostSurveyLobbyBridge decision={postSurveyContinuityDecision} theme={theme} />
            ) : null}
            <View style={styles.deckContainer}>
              {thirdProfile && (
                <View style={[styles.stackCard, styles.stackCardBack3]} pointerEvents="none">
                  <LobbyProfileCard profile={thirdProfile} theme={theme} userVibes={userVibes} isBehind />
                </View>
              )}
              {nextProfile && (
                <View style={[styles.stackCard, styles.stackCardBack2]} pointerEvents="none">
                  <LobbyProfileCard profile={nextProfile} theme={theme} userVibes={userVibes} isBehind />
                </View>
              )}
              <View style={[styles.stackCard, styles.stackCardFront]}>
                <LobbyProfileCard profile={current} theme={theme} userVibes={userVibes} />
              </View>
            </View>

            <View style={styles.actions}>
              <Pressable
                style={[
                  styles.actionCircle,
                  styles.actionCirclePass,
                  { backgroundColor: withAlpha(theme.text, 0.06), borderColor: withAlpha(theme.text, 0.14) },
                  swipeActionsDisabled && styles.actionDisabled,
                ]}
                onPress={() => handleSwipe('pass')}
                disabled={swipeActionsDisabled}
                accessibilityLabel="Pass"
              >
                <Ionicons name="close" size={28} color="rgba(255,255,255,0.55)" />
              </Pressable>
              <Pressable
                style={[
                  styles.actionCircle,
                  styles.actionCircleSuper,
                  { backgroundColor: withAlpha(theme.neonYellow, 0.14), borderColor: withAlpha(theme.neonYellow, 0.55) },
                  swipeActionsDisabled && styles.actionDisabled,
                  superVibeRemaining <= 0 && styles.actionDisabled,
                ]}
                onPress={() => handleSwipe('super_vibe')}
                disabled={swipeActionsDisabled || superVibeRemaining <= 0}
                accessibilityLabel="Super vibe"
              >
                <Ionicons name="star" size={24} color={theme.neonYellow} />
                {superVibeRemaining > 0 && (
                  <View style={[styles.superVibeBadgeCount, { backgroundColor: theme.neonYellow }]}>
                    <Text style={styles.superVibeBadgeCountText}>{superVibeRemaining}</Text>
                  </View>
                )}
              </Pressable>
              <Pressable
                style={[
                  styles.actionCircle,
                  styles.actionCirclePrimary,
                  { overflow: 'hidden' },
                  swipeActionsDisabled && styles.actionDisabled,
                ]}
                onPress={() => handleSwipe('vibe')}
                disabled={swipeActionsDisabled}
                accessibilityLabel="Vibe"
              >
                <LinearGradient
                  colors={[theme.tint, theme.neonPink]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFillObject}
                />
                <Ionicons name="heart" size={28} color="#fff" style={{ zIndex: 1 }} />
              </Pressable>
            </View>
            <Text style={[styles.actionHint, { color: theme.textSecondary }]}>Pass · Super · Vibe</Text>
          </>
        )}
          </>
        )}
      </View>

      {sessionHydrated && activeSessionId && user?.id ? (
        <ReadyGateOverlay
          sessionId={activeSessionId}
          eventId={id}
          userId={user.id}
          partnerImageUri={activeSessionPartnerImage}
          onNavigateToDate={(sessionIdToOpen) => {
            rcBreadcrumb(RC_CATEGORY.lobbyDateEntry, 'navigate_to_video_date', { event_id: id, session_id: sessionIdToOpen });
            lastOpenedSessionRef.current = null;
            setActiveSessionId(null);
            setActiveSessionPartnerName(null);
            setActiveSessionPartnerImage(null);
            navigateToDateSession(sessionIdToOpen, 'ready_gate_overlay', 'replace');
          }}
          onManualExitConfirmed={suppressReadyGateAfterManualExit}
          onClose={() => {
            lastOpenedSessionRef.current = null;
            setActiveSessionId(null);
            setActiveSessionPartnerName(null);
            setActiveSessionPartnerImage(null);
            scheduleDeckRefresh('ready_gate_overlay_close');
            scheduleLobbyRefreshBurst('ready_gate_overlay_close');
          }}
          onLobbyUserMessage={onReadyGateLobbyMessage}
        />
      ) : null}

      <EventEndedModal isOpen={showEventEndedModal} />
      </View>
    </View>
    {postSurveyLobbyBanner ? (
      <View
        pointerEvents="none"
        style={[
          styles.lobbySuccessToast,
          {
            bottom:
              insets.bottom + spacing.lg + (readyGateLobbyToast ? 56 : 0),
            backgroundColor: theme.surface,
            borderColor: withAlpha(theme.success, 0.4),
          },
        ]}
      >
        <Text style={[styles.lobbySuccessToastText, { color: theme.text }]}>
          You&apos;re back in the lobby — keep browsing 💚
        </Text>
      </View>
    ) : null}
    {readyGateLobbyToast ? (
      <View
        pointerEvents="none"
        style={[
          styles.lobbyTransientToast,
          {
            bottom: insets.bottom + spacing.lg,
            backgroundColor: theme.surface,
            borderColor:
              readyGateLobbyToast.variant === 'success'
                ? withAlpha(theme.success, 0.4)
                : withAlpha('#f59e0b', 0.45),
          },
        ]}
      >
        <Text style={[styles.lobbyTransientToastText, { color: theme.text }]}>{readyGateLobbyToast.text}</Text>
      </View>
    ) : null}
    {dialog}
    </>
  );
}

function PostSurveyLobbyBridge({
  decision,
  theme,
}: {
  decision: PostDateContinuityDecision;
  theme: (typeof Colors)[keyof typeof Colors];
}) {
  const accent =
    decision.tone === 'last_chance'
      ? '#f59e0b'
      : decision.tone === 'ready'
        ? theme.success
        : theme.tint;

  return (
    <View
      style={[
        styles.postSurveyBridge,
        {
          borderColor: withAlpha(accent, 0.32),
          backgroundColor: withAlpha(accent, 0.1),
        },
      ]}
    >
      <View style={styles.postSurveyBridgeTitleRow}>
        <View style={[styles.postSurveyBridgeDot, { backgroundColor: accent }]} />
        <Text style={[styles.postSurveyBridgeTitle, { color: theme.text }]}>{decision.title}</Text>
      </View>
      <Text style={[styles.postSurveyBridgeMessage, { color: theme.textSecondary }]}>{decision.message}</Text>
    </View>
  );
}

function LobbyProfileCard({
  profile,
  theme,
  userVibes,
  isBehind = false,
}: {
  profile: DeckProfile;
  theme: (typeof Colors)[keyof typeof Colors];
  userVibes: string[];
  isBehind?: boolean;
}) {
  void userVibes;
  const photoVerified = profile.photo_verified === true;
  const premiumBadge = profile.premium_badge;

  const photo =
    profile.primary_photo_path ??
    resolvePrimaryProfilePhotoPath({
      photos: profile.photos,
      avatar_url: profile.avatar_url,
    });
  const uri = photo ? deckCardUrl(photo) : '';
  const availabilityState = profile.availability_state ?? 'available';
  const isUnavailable = availabilityState !== 'available';
  const showQueueBadge =
    isUnavailable || (profile.queue_status && !['browsing', 'idle'].includes(profile.queue_status));
  const queueBadgeLabel = isUnavailable ? 'Unavailable' : 'In session';
  const sharedCount = profile.shared_vibe_count;
  const heightLabel = formatHeightCm(profile.height_cm);
  const showTrustStrip =
    profile.has_met_before || profile.is_already_connected || photoVerified || sharedCount > 0;

  const intentRaw = profile.looking_for?.trim();
  const intentDisplay = intentRaw ? getRelationshipIntentDisplaySafe(intentRaw) : null;

  return (
    <View
      style={[
        styles.profileCardWrap,
        isBehind && styles.profileCardBehind,
        !isBehind && shadows.card,
        {
          borderColor: isBehind ? theme.glassBorder : withAlpha(theme.tint, 0.22),
          backgroundColor: theme.surfaceSubtle,
        },
      ]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={[styles.cardImage, { backgroundColor: theme.surfaceSubtle, transform: [{ scale: 1.02 }] }]}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.cardImage, { backgroundColor: '#141418' }, styles.cardImagePlaceholder]}>
          <LinearGradient
            colors={['rgba(139,92,246,0.25)', 'rgba(20,20,24,1)']}
            style={StyleSheet.absoluteFillObject}
          />
          <Ionicons name="person" size={52} color="rgba(255,255,255,0.35)" />
          <Text style={styles.missingPhotoLabel}>Photo soon</Text>
        </View>
      )}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(168,85,247,0.14)', 'transparent']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.cardNeonWash}
      />
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(0,0,0,0.42)', 'transparent']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.cardTopVignette}
      />
      <LinearGradient
        pointerEvents="none"
        colors={['transparent', 'rgba(0,0,0,0.5)', 'rgba(0,0,0,0.94)']}
        locations={[0, 0.35, 1]}
        style={styles.cardBottomGradient}
      />
      {profile.has_super_vibed && (
        <View style={[styles.superVibeBadge, { backgroundColor: withAlpha(theme.neonYellow, 0.18), borderColor: withAlpha(theme.neonYellow, 0.48) }]}>
          <Ionicons name="sparkles" size={14} color={theme.neonYellow} />
          <Text style={[styles.superVibeText, { color: theme.neonYellow }]} numberOfLines={1}>
            Wants to meet you
          </Text>
        </View>
      )}
      <View style={styles.cardTopRight}>
        {showQueueBadge ? (
          <View style={[styles.queueBadge, { backgroundColor: withAlpha(theme.text, 0.12), borderColor: withAlpha(theme.text, 0.2) }]}>
            <Text style={[styles.queueBadgeText, { color: 'rgba(255,255,255,0.78)' }]}>{queueBadgeLabel}</Text>
          </View>
        ) : null}
        {premiumBadge ? (
          <View style={[styles.queueBadge, { backgroundColor: withAlpha(theme.tint, 0.18), borderColor: withAlpha(theme.tint, 0.4) }]}>
            <Text style={[styles.queueBadgeText, { color: '#f5f3ff' }]}>
              {premiumBadge === 'vip' ? 'VIP' : 'Premium'}
            </Text>
          </View>
        ) : null}
      </View>
      {!isBehind && (
        <Pressable
          onPress={() => router.push(`/user/${profile.id}`)}
          style={styles.profileInfoBtn}
          accessibilityLabel="View full profile"
        >
          <Ionicons name="information-circle-outline" size={24} color="#fff" />
        </Pressable>
      )}
      <View style={styles.cardBody}>
        {showTrustStrip ? (
          <View style={styles.trustStrip}>
            {photoVerified ? (
              <View style={[styles.trustChip, { backgroundColor: withAlpha(theme.neonCyan, 0.22), borderColor: withAlpha(theme.neonCyan, 0.35) }]}>
                <Ionicons name="shield-checkmark" size={12} color="#a5f3fc" />
                <Text style={[styles.trustChipText, { color: '#cffafe' }]}>Verified</Text>
              </View>
            ) : null}
            {profile.has_met_before ? (
              <View style={[styles.trustChip, { backgroundColor: 'rgba(255,255,255,0.1)', borderColor: 'rgba(255,255,255,0.14)' }]}>
                <Ionicons name="hand-left-outline" size={12} color="rgba(255,255,255,0.85)" />
                <Text style={styles.trustChipText}>Met before</Text>
              </View>
            ) : null}
            {profile.is_already_connected ? (
              <View style={[styles.trustChip, { backgroundColor: theme.tintSoft, borderColor: withAlpha(theme.tint, 0.35) }]}>
                <Ionicons name="people-outline" size={12} color={theme.tint} />
                <Text style={[styles.trustChipText, { color: theme.tint }]}>Connected</Text>
              </View>
            ) : null}
            {sharedCount > 0 ? (
              <View style={[styles.trustChip, { backgroundColor: 'rgba(217,70,239,0.2)', borderColor: 'rgba(232,121,249,0.35)' }]}>
                <Ionicons name="sparkles" size={12} color="#f0abfc" />
                <Text style={[styles.trustChipText, { color: '#f5d0fe' }]}>
                  {sharedCount} shared
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
        <View style={styles.nameAgeRow}>
          <Text style={styles.cardName} numberOfLines={1}>
            {profile.name}
          </Text>
          {profile.age != null ? <Text style={styles.cardAge}>{profile.age}</Text> : null}
        </View>
        {profile.tagline ? (
          <Text style={styles.cardTagline} numberOfLines={1}>
            {profile.tagline}
          </Text>
        ) : null}
        {intentDisplay ? (
          <Text style={[styles.cardLookingFor, { borderLeftColor: withAlpha(theme.tint, 0.65) }]} numberOfLines={1}>
            {intentDisplay.emoji} {intentDisplay.label}
          </Text>
        ) : null}
        {(profile.job || profile.location || heightLabel) ? (
          <View style={styles.jobLocationRow}>
            {profile.job ? (
              <View style={styles.metaChip}>
                <Ionicons name="briefcase-outline" size={14} color="rgba(255,255,255,0.65)" />
                <Text style={styles.metaChipText} numberOfLines={1}>
                  {profile.job}
                </Text>
              </View>
            ) : null}
            {profile.location ? (
              <View style={styles.metaChip}>
                <Ionicons name="location-outline" size={14} color="rgba(255,255,255,0.65)" />
                <Text style={styles.metaChipText} numberOfLines={1}>
                  {profile.location}
                </Text>
              </View>
            ) : null}
            {heightLabel ? <Text style={styles.heightMeta}>{heightLabel}</Text> : null}
          </View>
        ) : null}
        {profile.about_me ? (
          <Text style={styles.cardBio} numberOfLines={2}>
            {profile.about_me}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  centeredInner: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg },
  /** Intro + empty card centered together in body (avoids card sitting low: intro was above a flex:1 centered region). */
  emptyStateVerticalCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  onBreakWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  onBreakTitle: { fontSize: 22, fontWeight: '700', marginTop: spacing.lg, textAlign: 'center' },
  onBreakSubtitle: { fontSize: 15, marginTop: spacing.sm, textAlign: 'center' },
  onBreakBody: { fontSize: 14, marginTop: spacing.md, lineHeight: 20, textAlign: 'center', maxWidth: 320 },
  headerBar: { marginBottom: 0 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  backBtn: { padding: spacing.xs },
  backBtnRound: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  headerCenter: { flex: 1, minWidth: 0, alignItems: 'center' },
  headerTitle: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  headerSubtitle: { fontSize: 11, marginTop: 2, textAlign: 'center', paddingHorizontal: spacing.xs },
  headerLiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  livePillStrong: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  liveTextStrong: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  headerRightCol: {
    minWidth: 56,
    alignItems: 'flex-end',
  },
  queuedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  queuedBadgeText: { fontSize: 10, fontWeight: '700' },
  countdownPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  countdownText: { fontSize: 11, fontWeight: '700' },
  deckProgressSection: { marginTop: spacing.md, gap: 6 },
  deckProgressLabels: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  deckProgressLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  deckProgressCount: { fontSize: 10, fontWeight: '700' },
  deckProgressTrack: {
    height: 4,
    borderRadius: 999,
    overflow: 'hidden',
  },
  deckProgressFill: {
    height: '100%',
    borderRadius: 999,
  },
  body: { flex: 1, padding: spacing.lg },
  /** Active-session truth (handshake/date/ready gate) — dominant over deck UI. */
  convergenceYieldWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    minHeight: 280,
  },
  sectionIntro: { marginBottom: spacing.md, alignItems: 'center' },
  sectionKicker: { fontSize: 10, fontWeight: '700', letterSpacing: 2.4, textTransform: 'uppercase' },
  sectionTitle: { fontSize: 14, fontWeight: '600', marginTop: 4, textAlign: 'center', paddingHorizontal: spacing.md },
  postSurveyBridge: {
    width: '100%',
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  postSurveyBridgeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  postSurveyBridgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  postSurveyBridgeTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    flex: 1,
  },
  postSurveyBridgeMessage: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.xs,
  },
  deckSkeletonWrap: {
    width: '100%',
    aspectRatio: 3 / 4,
    maxHeight: Dimensions.get('window').height * 0.55,
    marginBottom: spacing.lg,
  },
  deckSkeletonCard: {
    flex: 1,
    borderRadius: radius['2xl'],
    overflow: 'hidden',
    borderWidth: 1,
    position: 'relative',
  },
  deckSkeletonImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  deckSkeletonBody: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.lg,
  },
  emptyCard: { padding: spacing.xl, alignItems: 'center', maxWidth: 320 },
  emptyEmoji: { fontSize: 48, marginBottom: spacing.md },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  emptyTitle: { fontSize: 18, fontWeight: '600', marginBottom: spacing.sm, textAlign: 'center' },
  emptyMessage: { fontSize: 14, textAlign: 'center', marginBottom: spacing.md, paddingHorizontal: spacing.sm },
  emptySubline: { fontSize: 12, textAlign: 'center', marginBottom: spacing.lg },
  emptyPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    marginBottom: spacing.sm,
  },
  emptyPrimaryLabel: { color: '#fff', fontSize: 16, fontWeight: '600' },
  emptySecondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  emptySecondaryLabel: { fontSize: 14 },
  emptyCheckingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.md },
  emptyRefreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  emptyRefreshLabel: { fontSize: 14, fontWeight: '500' },
  emptyMysteryBtn: {
    alignSelf: 'stretch',
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  lobbySuccessToast: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 100,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
  },
  lobbySuccessToastText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  lobbyTransientToast: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 101,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 7,
  },
  lobbyTransientToastText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  deckContainer: {
    width: '100%',
    aspectRatio: 3 / 4,
    maxHeight: Math.min(Dimensions.get('window').height * 0.58, 520),
    marginBottom: spacing.md,
    position: 'relative',
  },
  stackCard: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius['2xl'],
    overflow: 'hidden',
  },
  stackCardFront: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 8,
  },
  stackCardBack3: {
    transform: [{ scale: 0.90 }, { translateY: 6 }],
    opacity: 0.25,
    pointerEvents: 'none',
  },
  stackCardBack2: {
    transform: [{ scale: 0.95 }, { translateY: 3 }],
    opacity: 0.55,
    pointerEvents: 'none',
  },
  profileCardWrap: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: radius['2xl'],
    borderWidth: 1,
  },
  profileCardBehind: { opacity: 0.96 },
  cardImage: { width: '100%', height: '100%', position: 'absolute' },
  cardImagePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  missingPhotoLabel: {
    position: 'absolute',
    bottom: '42%',
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.45)',
  },
  cardNeonWash: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: '55%',
  },
  cardTopVignette: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: '38%',
  },
  cardBottomGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '78%',
  },
  cardBody: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.lg,
    paddingTop: 36,
    gap: 6,
  },
  cardTopRight: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    zIndex: 11,
    alignItems: 'flex-end',
    gap: 6,
  },
  superVibeBadge: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    zIndex: 10,
  },
  superVibeText: { fontSize: 10, fontWeight: '700', flexShrink: 1, maxWidth: 140 },
  queueBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  profileInfoBtn: {
    position: 'absolute',
    bottom: 200,
    right: spacing.md,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 12,
  },
  queueBadgeText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  trustStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  trustChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  trustChipText: { fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.9)' },
  nameAgeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, flexWrap: 'wrap' },
  cardName: { fontSize: 26, fontWeight: '800', color: '#fff', flexShrink: 1 },
  cardAge: { fontSize: 19, fontWeight: '600', color: 'rgba(255,255,255,0.78)', marginBottom: 2 },
  cardTagline: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.82)' },
  cardLookingFor: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(196,181,253,0.95)',
    borderLeftWidth: 2,
    paddingLeft: 8,
    marginTop: 2,
  },
  jobLocationRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, columnGap: spacing.md },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '48%' },
  metaChipText: { fontSize: 12, color: 'rgba(255,255,255,0.58)' },
  heightMeta: { fontSize: 12, color: 'rgba(255,255,255,0.45)' },
  vibeTagsScroll: { maxHeight: 34 },
  vibeTagsContent: { flexDirection: 'row', gap: 6, paddingRight: spacing.md },
  vibeTagChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, borderWidth: 1 },
  vibeTagText: { fontSize: 11, color: 'rgba(255,255,255,0.95)', fontWeight: '600' },
  cardBio: { fontSize: 13, color: 'rgba(255,255,255,0.68)', lineHeight: 19, marginTop: 2 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 22,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  actionCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCirclePass: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 6,
  },
  actionCircleSuper: { width: 52, height: 52, borderRadius: 26, borderWidth: 2 },
  actionCirclePrimary: { borderWidth: 0 },
  actionDisabled: { opacity: 0.6 },
  actionHint: { fontSize: 10, fontWeight: '600', textAlign: 'center', letterSpacing: 0.8, marginBottom: spacing.sm },
  superVibeBadgeCount: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  superVibeBadgeCountText: { color: '#000', fontSize: 11, fontWeight: '700' },
});
