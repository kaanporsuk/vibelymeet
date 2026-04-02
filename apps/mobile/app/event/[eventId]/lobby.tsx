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
  const lastOpenedSessionRef = useRef<string | null>(null);

  useEventStatus(id, user?.id ?? undefined, !!id && !!user?.id);

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
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <GlassHeaderBar insets={insets} style={styles.headerBar}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]}
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>
            {event.title}
          </Text>
          <View style={[styles.livePill, { backgroundColor: withAlpha(theme.success, 0.2) }]}>
            <View style={[styles.liveDot, { backgroundColor: theme.success }]} />
            <Text style={[styles.liveText, { color: theme.success }]}>LIVE</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          {queuedMatchCount > 0 && (
            <View style={[styles.queuedBadge, { backgroundColor: withAlpha(theme.tint, 0.2), borderColor: withAlpha(theme.tint, 0.5) }]}>
              <Text style={[styles.queuedBadgeText, { color: theme.tint }]}>{queuedMatchCount} match{queuedMatchCount !== 1 ? 'es' : ''} waiting</Text>
            </View>
          )}
          <View style={[styles.countdownPill, { backgroundColor: theme.surfaceSubtle }]}>
            <Ionicons name="time-outline" size={14} color={theme.textSecondary} />
            <Text style={[styles.countdownText, { color: theme.textSecondary }]}>{timeRemaining || '—'}</Text>
          </View>
        </View>
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
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          Discover who's here
        </Text>

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
                  <LobbyProfileCard profile={thirdProfile} theme={theme} isBehind />
                </View>
              )}
              {nextProfile && (
                <View style={[styles.stackCard, styles.stackCardBack2]} pointerEvents="none">
                  <LobbyProfileCard profile={nextProfile} theme={theme} isBehind />
                </View>
              )}
              <View style={[styles.stackCard, styles.stackCardFront]}>
                <LobbyProfileCard profile={current} theme={theme} />
              </View>
            </View>

            <View style={styles.actions}>
              <Pressable
                style={[
                  styles.actionCircle,
                  { backgroundColor: theme.surface, borderColor: withAlpha(theme.danger, 0.38) },
                  processing && styles.actionDisabled,
                ]}
                onPress={() => handleSwipe('pass')}
                disabled={processing}
              >
                <Ionicons name="close" size={28} color={theme.danger} />
              </Pressable>
              <Pressable
                style={[
                  styles.actionCircle,
                  styles.actionCircleSuper,
                  { backgroundColor: withAlpha(theme.neonYellow, 0.16), borderColor: withAlpha(theme.neonYellow, 0.6) },
                  processing && styles.actionDisabled,
                  superVibeRemaining <= 0 && styles.actionDisabled,
                ]}
                onPress={() => handleSwipe('super_vibe')}
                disabled={processing || superVibeRemaining <= 0}
              >
                <Ionicons name="star" size={26} color={theme.neonYellow} />
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
                  { backgroundColor: theme.tint },
                  processing && styles.actionDisabled,
                ]}
                onPress={() => handleSwipe('vibe')}
                disabled={processing}
              >
                <Ionicons name="heart" size={28} color="#fff" />
              </Pressable>
            </View>
            <Text style={[styles.deckMeta, { color: theme.textSecondary }]}>
              1 of {sortedProfiles.length} in deck
            </Text>
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
    {dialog}
    </>
  );
}

function LobbyProfileCard({
  profile,
  theme,
  isBehind = false,
}: {
  profile: DeckProfile;
  theme: (typeof Colors)[keyof typeof Colors];
  isBehind?: boolean;
}) {
  const [vibeLabels, setVibeLabels] = useState<string[]>([]);
  const [onePrompt, setOnePrompt] = useState<{ question: string; answer: string } | null>(null);
  const [photoVerified, setPhotoVerified] = useState(false);

  useEffect(() => {
    (async () => {
      const pid = profile.profile_id;
      const [vibesRes, profileRes] = await Promise.all([
        supabase.from('profile_vibes').select('vibe_tags(label, emoji)').eq('profile_id', pid),
        supabase.from('profiles').select('prompts, photo_verified').eq('id', pid).maybeSingle(),
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
      const pr = profileRes.data as { prompts?: { question: string; answer: string }[]; photo_verified?: boolean } | null;
      if (pr?.prompts && Array.isArray(pr.prompts) && pr.prompts.length > 0) setOnePrompt(pr.prompts[0]);
      if (pr?.photo_verified) setPhotoVerified(true);
    })();
  }, [profile.profile_id]);

  const photo = profile.avatar_url ?? profile.photos?.[0];
  const uri = photo ? avatarUrl(photo) : '';
  const showQueueBadge = profile.queue_status && !['browsing', 'idle'].includes(profile.queue_status);
  const sharedCount = profile.shared_vibe_count ?? 0;

  const intentRaw = profile.looking_for?.trim();
  const intentDisplay = intentRaw ? getRelationshipIntentDisplaySafe(intentRaw) : null;

  return (
    <View
      style={[
        styles.profileCardWrap,
        isBehind && styles.profileCardBehind,
        !isBehind && shadows.card,
        { borderColor: theme.glassBorder, backgroundColor: theme.surfaceSubtle },
      ]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={[styles.cardImage, { backgroundColor: theme.surfaceSubtle }]}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.cardImage, { backgroundColor: theme.surfaceSubtle }, styles.cardImagePlaceholder]}>
          <Ionicons name="person" size={48} color={theme.textSecondary} />
        </View>
      )}
      <View style={styles.cardGradient} />
      {profile.has_super_vibed && (
        <View style={[styles.superVibeBadge, { backgroundColor: withAlpha(theme.neonYellow, 0.2), borderColor: withAlpha(theme.neonYellow, 0.5) }]}>
          <Ionicons name="sparkles" size={14} color={theme.neonYellow} />
          <Text style={[styles.superVibeText, { color: theme.neonYellow }]}>Someone wants to meet you!</Text>
        </View>
      )}
      {photoVerified && (
        <View
          style={[
            styles.photoVerifiedBadge,
            { backgroundColor: withAlpha(theme.neonCyan, 0.93) },
            !isBehind && styles.photoVerifiedBadgeWithInfo,
          ]}
        >
          <Ionicons name="shield-checkmark" size={14} color="#fff" />
        </View>
      )}
      {showQueueBadge && (
        <View
          style={[
            styles.queueBadge,
            { backgroundColor: theme.secondary, borderColor: theme.border },
            !isBehind && styles.queueBadgeWithInfo,
            !isBehind && photoVerified ? { top: spacing.md + 36 } : null,
          ]}
        >
          <Text style={[styles.queueBadgeText, { color: theme.textSecondary }]}>In a date</Text>
        </View>
      )}
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
        <View style={styles.nameAgeRow}>
          <Text style={styles.cardName} numberOfLines={1}>{profile.name}</Text>
          <Text style={styles.cardAge}>{profile.age}</Text>
        </View>
        {intentDisplay ? (
          <Text style={[styles.cardLookingFor, { borderLeftColor: withAlpha(theme.tint, 0.65) }]} numberOfLines={1}>
            {intentDisplay.emoji} {intentDisplay.label}
          </Text>
        ) : null}
        {(profile.job || profile.location) ? (
          <View style={styles.jobLocationRow}>
            {profile.job ? (
              <View style={styles.metaChip}>
                <Ionicons name="briefcase-outline" size={14} color="rgba(255,255,255,0.7)" />
                <Text style={styles.metaChipText} numberOfLines={1}>{profile.job}</Text>
              </View>
            ) : null}
            {profile.location ? (
              <View style={styles.metaChip}>
                <Ionicons name="location-outline" size={14} color="rgba(255,255,255,0.7)" />
                <Text style={styles.metaChipText} numberOfLines={1}>{profile.location}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
        {vibeLabels.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.vibeTagsScroll} contentContainerStyle={styles.vibeTagsContent}>
            {vibeLabels.slice(0, 3).map((tag) => (
              <View key={tag} style={[styles.vibeTagChip, { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.12)' }]}>
                <Text style={styles.vibeTagText}>{tag}</Text>
              </View>
            ))}
            {vibeLabels.length > 3 && (
              <View style={[styles.vibeTagChip, { backgroundColor: 'rgba(255,255,255,0.1)' }]}>
                <Text style={[styles.vibeTagText, { opacity: 0.8 }]}>+{vibeLabels.length - 3}</Text>
              </View>
            )}
          </ScrollView>
        )}
        {onePrompt && (
          <Text style={styles.cardPrompt} numberOfLines={1}>
            {onePrompt.question}: {onePrompt.answer}
          </Text>
        )}
        {sharedCount > 0 && (
          <View style={[styles.sharedVibesChip, { backgroundColor: theme.tintSoft, borderColor: withAlpha(theme.tint, 0.31) }]}>
            <Ionicons name="sparkles" size={12} color={theme.tint} />
            <Text style={[styles.sharedVibesText, { color: theme.tint }]}>
              {sharedCount} shared vibe{sharedCount !== 1 ? 's' : ''}
            </Text>
          </View>
        )}
        {profile.about_me ? (
          <Text style={styles.cardBio} numberOfLines={2}>{profile.about_me}</Text>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  backBtn: { padding: spacing.xs },
  headerCenter: { flex: 1, minWidth: 0, alignItems: 'center', gap: 4 },
  headerTitle: { fontSize: 14, fontWeight: '600' },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  queuedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  queuedBadgeText: { fontSize: 11, fontWeight: '600' },
  countdownPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  countdownText: { fontSize: 12, fontWeight: '600' },
  body: { flex: 1, padding: spacing.lg },
  subtitle: { fontSize: 14, marginBottom: spacing.lg },
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
    maxHeight: Dimensions.get('window').height * 0.55,
    marginBottom: spacing.lg,
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
  profileCardBehind: { opacity: 0.95 },
  cardImage: { width: '100%', height: '100%', position: 'absolute' },
  cardImagePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  cardGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '72%',
    backgroundColor: 'rgba(0,0,0,0.78)',
  },
  cardBody: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.lg,
    paddingTop: 52,
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
  superVibeText: { fontSize: 11, fontWeight: '600' },
  queueBadge: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    zIndex: 10,
  },
  queueBadgeWithInfo: {
    right: spacing.md + 44,
  },
  profileInfoBtn: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 12,
  },
  photoVerifiedBadgeWithInfo: {
    right: spacing.md + 44,
  },
  queueBadgeText: { fontSize: 10, fontWeight: '500' },
  nameAgeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginBottom: spacing.sm },
  cardName: { fontSize: 25, fontWeight: '800', color: '#fff', flexShrink: 1 },
  cardAge: { fontSize: 18, fontWeight: '600', color: 'rgba(255,255,255,0.82)', marginBottom: 2 },
  cardLookingFor: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(196,181,253,0.95)',
    borderLeftWidth: 2,
    paddingLeft: 8,
    marginBottom: spacing.sm,
  },
  jobLocationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '48%' },
  metaChipText: { fontSize: 13, color: 'rgba(255,255,255,0.72)' },
  vibeTagsScroll: { marginBottom: spacing.sm, maxHeight: 32 },
  vibeTagsContent: { flexDirection: 'row', gap: 6, paddingRight: spacing.md },
  vibeTagChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, borderWidth: 1 },
  vibeTagText: { fontSize: 11, color: 'rgba(255,255,255,0.95)', fontWeight: '500' },
  cardPrompt: { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginBottom: spacing.sm },
  photoVerifiedBadge: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  sharedVibesChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  sharedVibesText: { fontSize: 12, fontWeight: '600' },
  cardBio: { fontSize: 13, color: 'rgba(255,255,255,0.78)', lineHeight: 19 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xl,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  actionCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCircleSuper: { width: 54, height: 54, borderRadius: 27, borderWidth: 2 },
  actionCirclePrimary: { borderWidth: 0 },
  actionDisabled: { opacity: 0.6 },
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
  deckMeta: { fontSize: 12, textAlign: 'center' },
});
