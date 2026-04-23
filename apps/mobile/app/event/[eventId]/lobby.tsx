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
import { useLocalSearchParams, usePathname, router } from 'expo-router';
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
import { useIsOffline } from '@/lib/useNetworkStatus';
import { useMysteryMatch } from '@/lib/useMysteryMatch';
import { supabase } from '@/lib/supabase';
import { trackEvent } from '@/lib/analytics';
import { LobbyPostDateEvents } from '@clientShared/analytics/lobbyToPostDateJourney';
import { LiveSurfaceOfflineStrip } from '@/components/connectivity/LiveSurfaceOfflineStrip';
import { useVibelyDialog } from '@/components/VibelyDialog';
import { useQueryClient } from '@tanstack/react-query';
import { useAccountPauseStatus } from '@/hooks/useAccountPauseStatus';
import { useActiveSession } from '@/lib/useActiveSession';
import { RC_CATEGORY, rcBreadcrumb } from '@/lib/nativeRcDiagnostics';
import { endAccountBreakForUser } from '@/lib/endAccountBreak';
import { isVdbgEnabled, vdbg } from '@/lib/vdbg';
import { markVideoDateEntryPipelineStarted } from '@/lib/dateEntryTransitionLatch';
import { navigateToDateSessionGuarded } from '@/lib/dateNavigationGuard';
import {
  fetchVideoSessionDateEntryTruth,
  videoSessionIndicatesHandshakeOrDate,
} from '@/lib/videoDateApi';
import { getRelationshipIntentDisplaySafe } from '@shared/profileContracts';
import { resolvePrimaryProfilePhotoPath } from '../../../../../shared/profilePhoto/resolvePrimaryProfilePhotoPath';
import {
  videoSessionIdFromSwipePayload,
  videoSessionIdFromDrainPayload,
  shouldAdvanceLobbyDeckAfterSwipe,
  SWIPE_SESSION_CONFLICT_USER_MESSAGE,
  QUEUED_MATCH_TIMED_OUT_USER_MESSAGE,
  isVideoSessionQueuedTtlExpiryTransition,
} from '@shared/matching/videoSessionFlow';
import { nextConvergenceDelayMs } from '@clientShared/matching/convergenceScheduling';
import { eventLobbyHref } from '@/lib/activeSessionRoutes';

const READY_GATE_ACTIVE_STATUSES = new Set(['ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed']);

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
    .select('id, event_id, ready_gate_status, state, phase, handshake_started_at, ended_at, ready_gate_expires_at, daily_room_name')
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

function useCountdown(endTime: Date | null): string {
  const [timeRemaining, setTimeRemaining] = useState('');
  useEffect(() => {
    if (!endTime) return;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      const diff = Math.max(0, Math.floor((endTime.getTime() - Date.now()) / 1000));
      if (diff <= 0) {
        setTimeRemaining('Ended');
        if (intervalId != null) {
          clearInterval(intervalId);
          intervalId = null;
        }
        return;
      }
      const m = Math.floor(diff / 60);
      const s = diff % 60;
      setTimeRemaining(`${m}:${String(s).padStart(2, '0')}`);
    };
    tick();
    intervalId = setInterval(tick, 1000);
    return () => {
      if (intervalId != null) clearInterval(intervalId);
    };
  }, [endTime?.getTime()]);
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

  const eventEndTime = useMemo(
    () => (event ? getEventEndTime(event.event_date, event.duration_minutes) : null),
    [event?.event_date, event?.duration_minutes]
  );

  const isLiveWindow = useMemo(() => {
    if (!event || !eventEndTime) return false;
    const now = Date.now();
    const start = new Date(event.event_date).getTime();
    return now >= start && now < eventEndTime.getTime();
  }, [event, eventEndTime]);

  const deckQueryEnabled = Boolean(id && user?.id && !pauseStatus.isPaused && isLiveWindow);
  const { data: profiles = [], isLoading: deckLoading, isError: deckError, refetch: refetchDeck } = useEventDeck(
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

  const seenProfileIdsRef = useRef<Set<string>>(new Set());
  const [deckNonce, setDeckNonce] = useState(0);
  /** Mirrors web `sonner` completion toast after post-date survey (non-blocking). */
  const [postSurveyLobbyBanner, setPostSurveyLobbyBanner] = useState(false);
  /** Ready Gate forfeit / stale messages — matches web `toast` instead of blocking modal. */
  const [readyGateLobbyToast, setReadyGateLobbyToast] = useState<{ text: string; variant: 'info' | 'success' } | null>(
    null,
  );

  useEffect(() => {
    seenProfileIdsRef.current = new Set();
    setDeckNonce((n) => n + 1);
  }, [id]);

  useEffect(() => {
    const raw = Array.isArray(postSurveyComplete) ? postSurveyComplete[0] : postSurveyComplete;
    if (raw !== '1' || !id) return;
    setPostSurveyLobbyBanner(true);
    router.replace(eventLobbyHref(id));
    const tid = setTimeout(() => setPostSurveyLobbyBanner(false), 2000);
    return () => clearTimeout(tid);
  }, [id, postSurveyComplete]);

  useEffect(() => {
    if (!readyGateLobbyToast) return;
    const tid = setTimeout(() => setReadyGateLobbyToast(null), 2800);
    return () => clearTimeout(tid);
  }, [readyGateLobbyToast]);

  const onReadyGateLobbyMessage = useCallback((text: string, variant?: 'info' | 'success') => {
    setReadyGateLobbyToast({ text, variant: variant ?? 'info' });
  }, []);

  const sortedProfiles = useMemo(() => {
    const filtered = profiles.filter((p) => !seenProfileIdsRef.current.has(p.id));
    filtered.sort((a, b) => {
      if (a.has_super_vibed && !b.has_super_vibed) return -1;
      if (!a.has_super_vibed && b.has_super_vibed) return 1;
      return 0;
    });
    return filtered;
  }, [profiles, deckNonce]);

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
  /** Dedupe queued-TTL expiry dialog per `video_sessions.id` for this screen. */
  const queuedTtlExpiryNotifiedIdsRef = useRef<Set<string>>(new Set());
  const [isLobbyFocused, setIsLobbyFocused] = useState(false);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);

  const {
    activeSession: scopedSession,
    hydrated: sessionHydrated,
    refetch: refetchActiveSession,
  } = useActiveSession(user?.id, {
    eventId: id,
  });

  const navigateToDateSession = useCallback(
    (sessionIdToOpen: string, trigger: string, mode: 'replace' | 'push' = 'replace') => {
      void (async () => {
        const [vs, regRes] = await Promise.all([
          fetchVideoSessionDateEntryTruth(sessionIdToOpen),
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

        rcBreadcrumb(RC_CATEGORY.lobbyDateEntry, 'date_route_decision', {
          session_id: sessionIdToOpen,
          event_id: id,
          decision,
          reason,
          queue_status: reg?.queue_status ?? null,
          current_room_id: reg?.current_room_id ?? null,
          vs_state: vs?.state ?? null,
          vs_phase: vs?.phase ?? null,
          handshake_started_at: Boolean(vs?.handshake_started_at),
          ready_gate_status: rgStatus,
          ready_gate_expires_at: rgExpiresRaw == null ? null : String(rgExpiresRaw),
        });
        vdbg('lobby_date_route_decision', {
          trigger,
          eventId: id,
          sessionId: sessionIdToOpen,
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
          router.replace(`/ready/${sessionIdToOpen}` as const);
          return;
        }
        if (decision === 'stay_lobby') {
          void refetchActiveSession();
          return;
        }

        navigateToDateSessionGuarded({
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
    sameEventActiveSession?.kind,
    sameEventActiveSession?.sessionId,
  ]);

  useEventStatus(id, user?.id ?? undefined, !!id && !!user?.id);

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
    queuedTtlExpiryNotifiedIdsRef.current.clear();
  }, [id, user?.id]);

  useEffect(() => {
    if (!id || !user?.id) return;
    if (!isLobbyFocused || appState !== 'active') return;

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
  }, [id, user?.id, isLobbyFocused, appState]);

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
    if (!id || !user?.id || !isConfirmedSeat || !isLiveWindow || pauseStatus.isPaused) return;
    trackEvent('lobby_entered', { event_id: id });
  }, [id, user?.id, isConfirmedSeat, isLiveWindow, pauseStatus.isPaused]);

  const openReadyGateWithSession = useCallback(
    async (sessionId: string, trigger = 'unknown') => {
      if (lastOpenedSessionRef.current === sessionId) return;
      lastOpenedSessionRef.current = sessionId;
      if (user?.id) {
        void queryClient.invalidateQueries({ queryKey: ['event-deck', id, user.id] });
      }
      logVdbgSessionStage('ready_gate_open', sessionId, {
        trigger,
        eventId: id,
      });
      setActiveSessionId(sessionId);
      setActiveSessionPartnerName(null);
      setActiveSessionPartnerImage(null);
      if (!user?.id) return;
      const { data: session } = await supabase
        .from('video_sessions')
        .select('participant_1_id, participant_2_id, event_id, ready_gate_status, state, phase, handshake_started_at, ended_at, ready_gate_expires_at, daily_room_name')
        .eq('id', sessionId)
        .maybeSingle();
      vdbg('ready_gate_open_loaded_session', {
        sessionId,
        trigger,
        eventId: id,
        row: session ?? null,
      });
      if (!session) return;
      const partnerId = session.participant_1_id === user.id ? session.participant_2_id : session.participant_1_id;
      const { data: profile } = await supabase
        .from('profiles')
        .select('name, avatar_url, photos')
        .eq('id', partnerId)
        .maybeSingle();
      if (profile) {
        setActiveSessionPartnerName((profile as { name?: string }).name ?? null);
        const p = profile as { avatar_url?: string; photos?: string[] };
        const img = resolvePrimaryProfilePhotoPath({
          photos: p.photos,
          avatar_url: p.avatar_url,
        });
        setActiveSessionPartnerImage(img ? avatarUrl(img) : null);
      }
    },
    [id, queryClient, user?.id]
  );

  const refreshQueueAndSuperVibe = useCallback(async () => {
    if (!id || !user?.id) return;
    const [count, remaining] = await Promise.all([
      getQueuedMatchCount(id, user.id),
      getSuperVibeRemaining(id, user.id),
    ]);
    setQueuedMatchCount(count);
    setSuperVibeRemaining(remaining);
    void refetchActiveSession();
  }, [id, user?.id, refetchActiveSession]);

  useEffect(() => {
    if (!id || !user?.id || !isLobbyFocused || appState !== 'active') return;
    void refreshQueueAndSuperVibe();
  }, [id, user?.id, isLobbyFocused, appState, refreshQueueAndSuperVibe]);

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
      void openReadyGateWithSession(sameEventActiveSession.sessionId, 'active_session_hydration');
    }
  }, [sessionHydrated, id, sameEventActiveSession, openReadyGateWithSession, navigateToDateSession]);

  /**
   * Queued mutual match: promotion may lag realtime. Re-run `drain_match_queue` with adaptive backoff
   * (same curve as reconnect sync) while queued/syncing and not already routing to date/Ready Gate.
   * Realtime on `event_registrations` / `video_sessions` + `queue_drain_initial` still drive fast paths.
   */
  useEffect(() => {
    if (!id || !user?.id) return;
    if (!isLobbyFocused || appState !== 'active') return;
    if (queuedMatchCount <= 0 && sameEventActiveSession?.kind !== 'syncing') return;
    if (activeSessionId) return;
    if (sameEventActiveSession?.kind === 'video') return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();

    const tick = async () => {
      if (cancelled) return;
      const result = await drainMatchQueue(id, user.id);
      const promotedSessionId = videoSessionIdFromDrainPayload(result ?? undefined);
      if (result?.found && promotedSessionId) {
        await openReadyGateWithSession(promotedSessionId, 'queue_drain_interval');
      }
      await refreshQueueAndSuperVibe();
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
    queuedMatchCount,
    activeSessionId,
    sameEventActiveSession?.kind,
    openReadyGateWithSession,
    refreshQueueAndSuperVibe,
  ]);

  useEffect(() => {
    if (!id || !user?.id) return;
    const run = async () => {
      const result = await drainMatchQueue(id, user.id);
      const sessionId = videoSessionIdFromDrainPayload(result ?? undefined);
      if (result?.found && sessionId) {
        await openReadyGateWithSession(sessionId, 'queue_drain_initial');
      }
      await refreshQueueAndSuperVibe();
    };
    run();
  }, [id, user?.id, openReadyGateWithSession, refreshQueueAndSuperVibe]);

  useEffect(() => {
    if (!id) return;
    const a = Array.isArray(pendingVideoSession) ? pendingVideoSession[0] : pendingVideoSession;
    const b = Array.isArray(pendingMatch) ? pendingMatch[0] : pendingMatch;
    const pending = typeof a === 'string' && a ? a : typeof b === 'string' && b ? b : undefined;
    if (pending) {
      void openReadyGateWithSession(pending, 'pending_deep_link');
    }
  }, [id, pendingVideoSession, pendingMatch, openReadyGateWithSession]);

  useEffect(() => {
    if (id && user?.id) refreshQueueAndSuperVibe();
  }, [id, user?.id, refreshQueueAndSuperVibe]);

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
            await openReadyGateWithSession(currentRoomId, 'registration_realtime');
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
              await openReadyGateWithSession(latestReg.current_room_id, 'registration_realtime_refetch');
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
    const channel = supabase
      .channel(`lobby-video-${id}-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'video_sessions', filter: `event_id=eq.${id}` },
        async (payload) => {
          const session = payload.new as Record<string, unknown>;
          const old = payload.old as Record<string, unknown> | null;
          const isParticipant = session.participant_1_id === user.id || session.participant_2_id === user.id;
          if (!isParticipant) return;
          const sid = session.id as string;
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
          void refetchDeck();
          void refreshQueueAndSuperVibe();
          const newStatus = session.ready_gate_status as string;
          const oldStatus = old?.ready_gate_status as string | undefined;
          const becameReadyGateActive =
            READY_GATE_ACTIVE_STATUSES.has(newStatus) &&
            (!oldStatus || !READY_GATE_ACTIVE_STATUSES.has(oldStatus));
          if (becameReadyGateActive) {
            await openReadyGateWithSession(session.id as string, 'video_session_update');
            return;
          }
          // If this participant's session has already moved into active video phases,
          // route out of lobby even if ready-gate transitions were missed.
          const phase = session.state as string | undefined;
          if (phase === 'handshake' || phase === 'date') {
            navigateToDateSession(session.id as string, 'video_session_update', 'replace');
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'video_sessions', filter: `event_id=eq.${id}` },
        async (payload) => {
          const session = payload.new as Record<string, unknown>;
          const isParticipant = session.participant_1_id === user.id || session.participant_2_id === user.id;
          if (!isParticipant) return;
          void refetchDeck();
          void refreshQueueAndSuperVibe();
          const status = session.ready_gate_status as string;
          const sid = session.id as string;
          if (status === 'queued') {
            const drainResult = await drainMatchQueue(id, user.id);
            const promotedId = videoSessionIdFromDrainPayload(drainResult ?? undefined);
            if (drainResult?.found && promotedId) {
              await openReadyGateWithSession(promotedId, 'video_session_insert_queue_drain');
            }
            await refreshQueueAndSuperVibe();
            return;
          }
          if (READY_GATE_ACTIVE_STATUSES.has(status)) {
            await openReadyGateWithSession(sid, 'video_session_insert');
            return;
          }
          const phase = session.state as string | undefined;
          if (phase === 'handshake' || phase === 'date') {
            navigateToDateSession(sid, 'video_session_insert', 'replace');
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, user?.id, openReadyGateWithSession, refreshQueueAndSuperVibe, refetchDeck, show, navigateToDateSession]);

  const timeRemaining = useCountdown(eventEndTime);

  useEffect(() => {
    if (!event || !id) return;
    if (event.status === 'ended') {
      setShowEventEndedModal(true);
      return;
    }
    if (eventEndTime && new Date() >= eventEndTime) {
      setShowEventEndedModal(true);
      return;
    }
    const channel = supabase
      .channel(`event-lifecycle-${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${id}` },
        (payload) => {
          const row = payload.new as { status?: string };
          if (row.status === 'ended') setShowEventEndedModal(true);
          if (row.status === 'cancelled') {
            show({
              title: 'This event was cancelled',
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
  }, [id, event?.status, eventEndTime, show]);

  useEffect(() => {
    if (!eventEndTime) return;
    const interval = setInterval(() => {
      if (new Date() >= eventEndTime) setShowEventEndedModal(true);
    }, 30000);
    return () => clearInterval(interval);
  }, [eventEndTime]);

  const mysteryMatchEnabled = Boolean(
    id &&
      user?.id &&
      event &&
      !eventLoading &&
      isConfirmedSeat &&
      !pauseStatus.isPaused &&
      isLiveWindow
  );
  const { findMysteryMatch, cancelSearch, isSearching, isWaiting } = useMysteryMatch({
    eventId: id,
    onMatchFound: (sessionId) => {
      void openReadyGateWithSession(sessionId, 'mystery_match');
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

  const deckProgress = useMemo(() => {
    if (profiles.length === 0) return 0;
    return Math.min(1, Math.max(0, (profiles.length - sortedProfiles.length) / profiles.length));
  }, [profiles.length, sortedProfiles.length]);

  const showSwipeToast = useCallback(
    (result: string) => {
      switch (result) {
        case 'vibe_recorded':
        case 'swipe_recorded':
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
          break;
        case 'participant_has_active_session_conflict':
          show({
            title: 'Match in progress',
            message: SWIPE_SESSION_CONFLICT_USER_MESSAGE,
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

  const isOffline = useIsOffline();

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

  if (event.status === 'cancelled') {
    return (
      <>
        <View style={[styles.centered, { backgroundColor: theme.background }]}>
          <ErrorState
            title="This event was cancelled"
            message="Head back to the event page for details and booking options."
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

  const isEventEndedForLobby =
    event.status === 'ended' ||
    (eventEndTime != null && Date.now() >= eventEndTime.getTime());

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

  const current = sortedProfiles[0] ?? null;
  const nextProfile = sortedProfiles[1] ?? null;
  const thirdProfile = sortedProfiles[2] ?? null;
  const hasCards = sortedProfiles.length > 0;
  const isEmpty = !hasCards || !current;

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

  const discoverSectionIntro = (
    <View style={styles.sectionIntro}>
      <Text style={[styles.sectionKicker, { color: theme.textSecondary }]}>Discover</Text>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>
        Swipe fast — vibes are live in this room
      </Text>
    </View>
  );

  const handleSwipe = async (swipeType: 'vibe' | 'pass' | 'super_vibe') => {
    if (!current || processing) return;
    if (isOffline) {
      show({
        title: 'You’re offline',
        message: 'Reconnect to swipe and match in the lobby.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
      return;
    }
    setProcessing(true);
    const targetId = current.id;
    try {
      const result = await swipe(id, targetId, swipeType);
      if (!result) {
        show({
          title: 'Something went wrong',
          message: 'Check your connection and try again.',
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
        return;
      }

      const envelope = result as SwipeResult;
      if (envelope.success === false) {
        show({
          title: 'Unable to swipe',
          message: envelope.message ?? 'Try again in a moment.',
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
        return;
      }

      const code = envelope.result;
      if (!code) {
        show({
          title: 'Something went wrong',
          message: 'Tap to try again, or refresh the deck.',
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
        return;
      }

      const outcome = code === 'swipe_recorded' ? 'vibe_recorded' : code;
      trackEvent('swipe', {
        event_id: id,
        swipe_type: swipeType,
        result: outcome,
      });

      const videoSessionId = videoSessionIdFromSwipePayload(envelope);
      if (code === 'match' && videoSessionId) {
        lastOpenedSessionRef.current = videoSessionId;
        logVdbgSessionStage('ready_gate_open', videoSessionId, {
          trigger: 'swipe_match',
          eventId: id,
          swipeType,
          result: code,
        });
        setActiveSessionId(videoSessionId);
        setActiveSessionPartnerName(current?.name ?? null);
        const img = resolvePrimaryProfilePhotoPath({
          photos: current?.photos,
          avatar_url: current?.avatar_url,
        });
        setActiveSessionPartnerImage(img ? avatarUrl(img) : null);
        refetchDeck();
      }

      showSwipeToast(code);
      if (code === 'super_vibe_sent' || code === 'limit_reached' || code === 'match_queued') {
        refreshQueueAndSuperVibe();
      }

      if (!shouldAdvanceLobbyDeckAfterSwipe(code)) {
        return;
      }

      seenProfileIdsRef.current.add(targetId);
      setDeckNonce((n) => n + 1);
      void queryClient.invalidateQueries({ queryKey: ['event-deck', id, user?.id] });
      const remainingVisible = profiles.filter((p) => !seenProfileIdsRef.current.has(p.id)).length;
      if (remainingVisible === 0) {
        void refetchDeck();
      }
    } catch {
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
                {sortedProfiles.length > 0 ? `1 / ${sortedProfiles.length} left` : '—'}
              </Text>
            </View>
            <View style={[styles.deckProgressTrack, { backgroundColor: withAlpha(theme.text, 0.08) }]}>
              <LinearGradient
                colors={[theme.tint, theme.neonCyan]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={[styles.deckProgressFill, { width: `${Math.round(deckProgress * 100)}%` }]}
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
              title={yieldingToVideoDateUi ? 'Joining your date...' : 'Opening Ready Gate...'}
              message={
                yieldingToVideoDateUi
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
                <Text style={[styles.emptyTitle, { color: theme.text }]}>Your match is syncing</Text>
                  <Text style={[styles.emptyMessage, { color: theme.textSecondary }]}>
                    We’re opening Ready Gate as soon as you’re both available in this lobby. Stay here — we’ll bring you in
                    automatically.
                  </Text>
                <View style={styles.emptyCheckingRow}>
                  <Ionicons name="sync" size={14} color={theme.tint} />
                  <Text style={[styles.emptySubline, { color: theme.tint }]}>
                    Looking for your video date...
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
                  <Text style={[styles.emptyTitle, { color: theme.text }]}>You&apos;ve seen everyone for now</Text>
                  <Text style={[styles.emptyMessage, { color: theme.textSecondary }]}>
                    More people may join the room — your deck refreshes every few seconds. Refresh any time. Mystery Match
                    is an optional in-app shortcut for a random pairing while you wait (not available on web yet).
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
                  processing && styles.actionDisabled,
                ]}
                onPress={() => handleSwipe('pass')}
                disabled={processing}
                accessibilityLabel="Pass"
              >
                <Ionicons name="close" size={28} color="rgba(255,255,255,0.55)" />
              </Pressable>
              <Pressable
                style={[
                  styles.actionCircle,
                  styles.actionCircleSuper,
                  { backgroundColor: withAlpha(theme.neonYellow, 0.14), borderColor: withAlpha(theme.neonYellow, 0.55) },
                  processing && styles.actionDisabled,
                  superVibeRemaining <= 0 && styles.actionDisabled,
                ]}
                onPress={() => handleSwipe('super_vibe')}
                disabled={processing || superVibeRemaining <= 0}
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
                  processing && styles.actionDisabled,
                ]}
                onPress={() => handleSwipe('vibe')}
                disabled={processing}
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
            markVideoDateEntryPipelineStarted(sessionIdToOpen);
            lastOpenedSessionRef.current = null;
            setActiveSessionId(null);
            setActiveSessionPartnerName(null);
            setActiveSessionPartnerImage(null);
            navigateToDateSession(sessionIdToOpen, 'ready_gate_overlay', 'replace');
          }}
          onClose={() => {
            lastOpenedSessionRef.current = null;
            setActiveSessionId(null);
            setActiveSessionPartnerName(null);
            setActiveSessionPartnerImage(null);
            if (user?.id) {
              void queryClient.invalidateQueries({ queryKey: ['event-deck', id, user.id] });
            }
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
  const [photoVerified, setPhotoVerified] = useState(false);

  useEffect(() => {
    if (isBehind) return;
    (async () => {
      const { data } = await supabase.from('profiles').select('photo_verified').eq('id', profile.id).maybeSingle();
      const pr = data as { photo_verified?: boolean } | null;
      setPhotoVerified(Boolean(pr?.photo_verified));
    })();
  }, [profile.id, isBehind]);

  const photo = resolvePrimaryProfilePhotoPath({
    photos: profile.photos,
    avatar_url: profile.avatar_url,
  });
  const uri = photo ? deckCardUrl(photo) : '';
  const showQueueBadge = profile.queue_status && !['browsing', 'idle'].includes(profile.queue_status);
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
            <Text style={[styles.queueBadgeText, { color: 'rgba(255,255,255,0.78)' }]}>In session</Text>
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
