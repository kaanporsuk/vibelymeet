import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  Image,
  ScrollView,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
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
import { avatarUrl } from '@/lib/imageUrl';
import { ReadyGateOverlay } from '@/components/lobby/ReadyGateOverlay';
import { EventEndedModal } from '@/components/events/EventEndedModal';
import { useEventStatus } from '@/lib/eventStatus';
import { useIsOffline } from '@/lib/useNetworkStatus';
import { useMysteryMatch } from '@/lib/useMysteryMatch';
import { supabase } from '@/lib/supabase';
import { trackEvent } from '@/lib/analytics';
import { LiveSurfaceOfflineStrip } from '@/components/connectivity/LiveSurfaceOfflineStrip';
import { useVibelyDialog } from '@/components/VibelyDialog';
import { useQueryClient } from '@tanstack/react-query';
import { useAccountPauseStatus } from '@/hooks/useAccountPauseStatus';
import { endAccountBreakForUser } from '@/lib/endAccountBreak';
import { getRelationshipIntentDisplaySafe } from '@shared/profileContracts';

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
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const pauseStatus = useAccountPauseStatus();
  const { show, dialog } = useVibelyDialog();
  const id = eventId ?? '';

  const { data: event, isLoading: eventLoading } = useEventDetails(id);
  const { data: isRegistered } = useIsRegisteredForEvent(id, user?.id);

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

  const seenProfileIdsRef = useRef<Set<string>>(new Set());
  const [deckNonce, setDeckNonce] = useState(0);

  useEffect(() => {
    seenProfileIdsRef.current = new Set();
    setDeckNonce((n) => n + 1);
  }, [id]);

  const sortedProfiles = useMemo(() => {
    const filtered = profiles.filter((p) => !seenProfileIdsRef.current.has(p.profile_id));
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

  useEventStatus(id, user?.id ?? undefined, !!id && !!user?.id);

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
    if (!id || !user?.id || isRegistered !== true || !isLiveWindow || pauseStatus.isPaused) return;
    trackEvent('lobby_entered', { event_id: id });
  }, [id, user?.id, isRegistered, isLiveWindow, pauseStatus.isPaused]);

  const openReadyGateWithSession = useCallback(
    async (sessionId: string) => {
      if (lastOpenedSessionRef.current === sessionId) return;
      lastOpenedSessionRef.current = sessionId;
      setActiveSessionId(sessionId);
      setActiveSessionPartnerName(null);
      setActiveSessionPartnerImage(null);
      if (!user?.id) return;
      const { data: session } = await supabase
        .from('video_sessions')
        .select('participant_1_id, participant_2_id')
        .eq('id', sessionId)
        .maybeSingle();
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
        const img = p.avatar_url ?? p.photos?.[0];
        setActiveSessionPartnerImage(img ? avatarUrl(img) : null);
      }
    },
    [user?.id]
  );

  const refreshQueueAndSuperVibe = useCallback(async () => {
    if (!id || !user?.id) return;
    const [count, remaining] = await Promise.all([
      getQueuedMatchCount(id, user.id),
      getSuperVibeRemaining(id, user.id),
    ]);
    setQueuedMatchCount(count);
    setSuperVibeRemaining(remaining);
  }, [id, user?.id]);

  useEffect(() => {
    if (!id || !user?.id) return;
    const check = async () => {
      const { data } = await supabase
        .from('event_registrations')
        .select('queue_status, current_room_id')
        .eq('event_id', id)
        .eq('profile_id', user.id)
        .maybeSingle();
      if (data?.queue_status === 'in_ready_gate' && data.current_room_id) {
        await openReadyGateWithSession(data.current_room_id as string);
      }
    };
    check();
  }, [id, user?.id, openReadyGateWithSession]);

  useEffect(() => {
    if (!id || !user?.id) return;
    const run = async () => {
      const result = await drainMatchQueue(id, user.id);
      if (result?.found && result.match_id) {
        await openReadyGateWithSession(result.match_id);
      }
      await refreshQueueAndSuperVibe();
    };
    run();
  }, [id, user?.id, openReadyGateWithSession, refreshQueueAndSuperVibe]);

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
          if (newData.queue_status === 'in_ready_gate' && newData.current_room_id) {
            await openReadyGateWithSession(newData.current_room_id as string);
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, user?.id, openReadyGateWithSession]);

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
          void refetchDeck();
          refreshQueueAndSuperVibe();
          const newStatus = session.ready_gate_status as string;
          const oldStatus = old?.ready_gate_status as string | undefined;
          if (newStatus === 'ready' && oldStatus === 'queued') {
            await openReadyGateWithSession(session.id as string);
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
          refreshQueueAndSuperVibe();
          if ((session.ready_gate_status as string) === 'ready') {
            await openReadyGateWithSession(session.id as string);
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, user?.id, openReadyGateWithSession, refreshQueueAndSuperVibe, refetchDeck]);

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
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, event?.status, eventEndTime]);

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
      isRegistered === true &&
      !pauseStatus.isPaused &&
      isLiveWindow
  );
  const { findMysteryMatch, cancelSearch, isSearching, isWaiting } = useMysteryMatch({
    eventId: id,
    onMatchFound: openReadyGateWithSession,
    enabled: mysteryMatchEnabled,
  });

  if (eventLoading && !event) {
    return (
      <>
        <View style={[styles.centered, { backgroundColor: theme.background }]}>
          <LoadingState title="Loading lobby…" message="Getting the lobby ready…" />
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

  if (!isRegistered) {
    return (
      <>
        <View style={[styles.centered, { backgroundColor: theme.background }]}>
          <ErrorState
            title="Register first"
            message="Register for this event to view the lobby and meet people."
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
          break;
        case 'match_queued':
          show({
            title: 'Match waiting',
            message: 'It’ll start when your partner is free. 💚',
            variant: 'success',
            primaryAction: { label: 'Nice', onPress: () => {} },
          });
          break;
        case 'super_vibe_sent':
          show({
            title: 'Super Vibe sent! ✨',
            variant: 'success',
            primaryAction: { label: 'OK', onPress: () => {} },
          });
          break;
        case 'no_credits':
          show({
            title: 'Get Super Vibes',
            message: 'Grab credits to stand out with a Super Vibe. ✨',
            variant: 'info',
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
    const targetId = current.profile_id;
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

      if (code === 'match' && envelope.match_id) {
        lastOpenedSessionRef.current = envelope.match_id;
        setActiveSessionId(envelope.match_id);
        setActiveSessionPartnerName(current?.name ?? null);
        const img = current?.avatar_url ?? current?.photos?.[0];
        setActiveSessionPartnerImage(img ? avatarUrl(img) : null);
        refetchDeck();
      }

      showSwipeToast(code);
      if (code === 'super_vibe_sent' || code === 'limit_reached' || code === 'no_credits') {
        refreshQueueAndSuperVibe();
      }

      const noDeckAdvance = new Set([
        'blocked',
        'reported',
        'not_registered',
        'target_not_found',
        'limit_reached',
        'no_credits',
        'already_super_vibed_recently',
        'already_matched',
      ]);
      if (noDeckAdvance.has(code)) {
        return;
      }

      seenProfileIdsRef.current.add(targetId);
      setDeckNonce((n) => n + 1);
      const remainingVisible = profiles.filter((p) => !seenProfileIdsRef.current.has(p.profile_id)).length;
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
              {queuedMatchCount > 0 ? (
                <View style={[styles.queuedBadge, { backgroundColor: withAlpha(theme.neonPink, 0.14), borderColor: withAlpha(theme.neonPink, 0.35) }]}>
                  <Ionicons name="sparkles" size={11} color={theme.neonPink} />
                  <Text style={[styles.queuedBadgeText, { color: theme.neonPink }]}>{queuedMatchCount} queued</Text>
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
                {sortedProfiles.length > 0 ? `1 / ${sortedProfiles.length}` : '—'}
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
        <View style={styles.sectionIntro}>
          <Text style={[styles.sectionKicker, { color: theme.textSecondary }]}>Discover</Text>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>
            Swipe fast — vibes are live in this room
          </Text>
        </View>

        {deckError && !hasCards ? (
          <View style={styles.centeredInner}>
            <ErrorState
              title="Couldn't load deck"
              message="We couldn't load people at this event. Tap Retry to try again."
              actionLabel="Retry"
              onActionPress={() => refetchDeck()}
            />
          </View>
        ) : deckLoading && !hasCards ? (
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
        ) : !hasCards || isEmpty ? (
          <View style={styles.centeredInner}>
            <Card variant="glass" style={[styles.emptyCard, { borderColor: theme.glassBorder }]}>
              {isWaiting ? (
                <>
                  <Text style={styles.emptyEmoji}>⏳</Text>
                  <Text style={[styles.emptyTitle, { color: theme.text }]}>Hang tight!</Text>
                  <Text style={[styles.emptyMessage, { color: theme.textSecondary }]}>
                    New people may join the event! We'll refresh your deck automatically.
                  </Text>
                  <View style={styles.emptyCheckingRow}>
                    <Ionicons name="sync" size={14} color={theme.tint} />
                    <Text style={[styles.emptySubline, { color: theme.tint }]}>Checking for new arrivals...</Text>
                  </View>
                  <Pressable
                    style={({ pressed }) => [styles.emptySecondaryBtn, pressed && { opacity: 0.8 }]}
                    onPress={cancelSearch}
                  >
                    <Text style={[styles.emptySecondaryLabel, { color: theme.textSecondary }]}>I'll check later</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <View style={[styles.emptyIconWrap, { backgroundColor: theme.accentSoft }]}>
                    <Ionicons name="people-outline" size={40} color={theme.tint} />
                  </View>
                  <Text style={[styles.emptyTitle, { color: theme.text }]}>No more profiles</Text>
                  <Text style={[styles.emptyMessage, { color: theme.textSecondary }]}>
                    Check back soon or try Mystery Match
                  </Text>
                  <Pressable
                    style={({ pressed }) => [styles.emptyPrimaryBtn, { backgroundColor: theme.tint }, pressed && { opacity: 0.9 }]}
                    onPress={findMysteryMatch}
                    disabled={isSearching}
                  >
                    {isSearching ? (
                      <Text style={styles.emptyPrimaryLabel}>Finding match...</Text>
                    ) : (
                      <Text style={styles.emptyPrimaryLabel}>Try Mystery Match 🎲</Text>
                    )}
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.emptySecondaryBtn, pressed && { opacity: 0.8 }]}
                    onPress={() => {
                      cancelSearch();
                      refetchDeck();
                    }}
                  >
                    <Text style={[styles.emptySecondaryLabel, { color: theme.textSecondary }]}>I'll wait</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.emptyRefreshBtn, { borderColor: theme.border }, pressed && { opacity: 0.8 }]}
                    onPress={() => refetchDeck()}
                  >
                    <Ionicons name="refresh" size={18} color={theme.textSecondary} />
                    <Text style={[styles.emptyRefreshLabel, { color: theme.textSecondary }]}>Refresh</Text>
                  </Pressable>
                </>
              )}
            </Card>
          </View>
        ) : (
          <>
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

      {activeSessionId && user?.id ? (
        <ReadyGateOverlay
          sessionId={activeSessionId}
          eventId={id}
          userId={user.id}
          partnerImageUri={activeSessionPartnerImage}
          onNavigateToDate={(sessionIdToOpen) => {
            lastOpenedSessionRef.current = null;
            setActiveSessionId(null);
            setActiveSessionPartnerName(null);
            setActiveSessionPartnerImage(null);
            router.push(`/date/${sessionIdToOpen}` as const);
          }}
          onClose={() => {
            lastOpenedSessionRef.current = null;
            setActiveSessionId(null);
            setActiveSessionPartnerName(null);
            setActiveSessionPartnerImage(null);
          }}
        />
      ) : null}

      <EventEndedModal isOpen={showEventEndedModal} />
      </View>
    </View>
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
  const [vibeLabels, setVibeLabels] = useState<string[]>([]);
  const [photoVerified, setPhotoVerified] = useState(false);

  useEffect(() => {
    (async () => {
      const pid = profile.profile_id;
      const [vibesRes, profileRes] = await Promise.all([
        supabase.from('profile_vibes').select('vibe_tags(label, emoji)').eq('profile_id', pid),
        supabase.from('profiles').select('photo_verified').eq('id', pid).maybeSingle(),
      ]);
      if (vibesRes.data) {
        const labels: string[] = [];
        for (const row of vibesRes.data as { vibe_tags?: { label: string; emoji: string } | { label: string; emoji: string }[] }[]) {
          const tag = row.vibe_tags;
          if (Array.isArray(tag)) {
            tag.forEach((t) => labels.push(`${t.emoji} ${t.label}`));
          } else if (tag && typeof tag === 'object' && 'label' in tag) {
            labels.push(`${tag.emoji} ${tag.label}`);
          }
        }
        setVibeLabels(labels);
      }
      const pr = profileRes.data as { photo_verified?: boolean } | null;
      if (pr?.photo_verified) setPhotoVerified(true);
    })();
  }, [profile.profile_id]);

  const photo = profile.avatar_url ?? profile.photos?.[0];
  const uri = photo ? avatarUrl(photo) : '';
  const showQueueBadge = profile.queue_status && !['browsing', 'idle'].includes(profile.queue_status);
  const sharedFromDeck = profile.shared_vibe_count > 0 ? profile.shared_vibe_count : 0;
  const sharedCount =
    sharedFromDeck > 0
      ? sharedFromDeck
      : vibeLabels.filter((v) => {
          const label = v.replace(/^\S+\s/, '');
          return userVibes.includes(label);
        }).length;
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
          onPress={() => router.push(`/user/${profile.profile_id}`)}
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
          <Text style={styles.cardAge}>{profile.age}</Text>
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
        {vibeLabels.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.vibeTagsScroll} contentContainerStyle={styles.vibeTagsContent}>
            {vibeLabels.slice(0, 2).map((tag) => {
              const label = tag.replace(/^\S+\s/, '');
              const isShared = userVibes.includes(label);
              return (
                <View
                  key={tag}
                  style={[
                    styles.vibeTagChip,
                    isShared
                      ? { backgroundColor: theme.tintSoft, borderColor: withAlpha(theme.tint, 0.45) }
                      : { backgroundColor: 'rgba(255,255,255,0.1)', borderColor: 'rgba(255,255,255,0.14)' },
                  ]}
                >
                  <Text style={[styles.vibeTagText, isShared && { color: theme.tint }]}>{tag}</Text>
                </View>
              );
            })}
            {vibeLabels.length > 2 ? (
              <View style={[styles.vibeTagChip, { backgroundColor: 'rgba(0,0,0,0.35)', borderColor: 'rgba(255,255,255,0.08)' }]}>
                <Text style={[styles.vibeTagText, { opacity: 0.75 }]}>+{vibeLabels.length - 2}</Text>
              </View>
            ) : null}
          </ScrollView>
        )}
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
