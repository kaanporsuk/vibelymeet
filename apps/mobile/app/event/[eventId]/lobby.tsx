import { useState, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  Image,
  ScrollView,
  Alert,
  Dimensions,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { GlassSurface, Card, LoadingState, ErrorState, EmptyState, VibelyButton } from '@/components/ui';
import { spacing, radius } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import { useEventDetails, useIsRegisteredForEvent, useEventDeck, swipe, type DeckProfile } from '@/lib/eventsApi';
import { avatarUrl } from '@/lib/imageUrl';
import { ReadyGateOverlay } from '@/components/lobby/ReadyGateOverlay';

function getEventEndTime(event_date: string, duration_minutes?: number | null): Date {
  const start = new Date(event_date);
  const duration = duration_minutes ?? 60;
  return new Date(start.getTime() + duration * 60 * 1000);
}

function useCountdown(endTime: Date | null): string {
  const [timeRemaining, setTimeRemaining] = useState('');
  useEffect(() => {
    if (!endTime) return;
    const tick = () => {
      const diff = Math.max(0, Math.floor((endTime.getTime() - Date.now()) / 1000));
      if (diff <= 0) {
        setTimeRemaining('Ended');
        return;
      }
      const m = Math.floor(diff / 60);
      const s = diff % 60;
      setTimeRemaining(`${m}:${String(s).padStart(2, '0')}`);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [endTime?.getTime()]);
  return timeRemaining;
}

export default function EventLobbyScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { user } = useAuth();
  const id = eventId ?? '';

  const { data: event, isLoading: eventLoading } = useEventDetails(id);
  const { data: isRegistered } = useIsRegisteredForEvent(id, user?.id);
  const { data: profiles = [], isLoading: deckLoading, refetch: refetchDeck } = useEventDeck(id, user?.id ?? null, !!id && !!user?.id);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSessionPartnerName, setActiveSessionPartnerName] = useState<string | null>(null);

  const eventEndTime = useMemo(
    () => (event ? getEventEndTime(event.event_date, event.duration_minutes) : null),
    [event?.event_date, event?.duration_minutes]
  );
  const timeRemaining = useCountdown(eventEndTime);

  if (eventLoading && !event) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <LoadingState title="Loading lobby…" />
      </View>
    );
  }

  if (!event) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <ErrorState
          title="Event not found"
          message="This event may have been removed."
          actionLabel="Go back"
          onActionPress={() => router.back()}
        />
      </View>
    );
  }

  if (!user?.id) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <ErrorState
          title="Sign in to view the lobby"
          message="You need to be signed in to discover who's here."
          actionLabel="Go back"
          onActionPress={() => router.back()}
        />
      </View>
    );
  }

  if (!isRegistered) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <ErrorState
          title="Register first"
          message="Register for this event to view the lobby and meet people."
          actionLabel="Go back"
          onActionPress={() => router.back()}
        />
      </View>
    );
  }

  const current = profiles[currentIndex];
  const nextProfile = profiles[currentIndex + 1] ?? null;
  const thirdProfile = profiles[currentIndex + 2] ?? null;
  const hasCards = profiles.length > 0;
  const isEmpty = currentIndex >= profiles.length || !current;

  const handleSwipe = async (swipeType: 'vibe' | 'pass' | 'super_vibe') => {
    if (!current || processing) return;
    setProcessing(true);
    try {
      const result = await swipe(id, current.profile_id, swipeType);
      if (result?.result === 'match' && result.match_id) {
        setActiveSessionId(result.match_id);
        setActiveSessionPartnerName(current?.name ?? null);
        refetchDeck();
      }
      if (result?.result === 'match_queued') {
        Alert.alert('Match queued', "You'll be notified when your partner is ready.");
      }
      setCurrentIndex((i) => Math.min(i + 1, profiles.length - 1));
      if (currentIndex + 1 >= profiles.length) refetchDeck();
    } catch {
      Alert.alert('Error', 'Something went wrong');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <GlassSurface
        style={[
          styles.header,
          {
            paddingTop: insets.top + spacing.sm,
            paddingBottom: spacing.md,
            paddingHorizontal: spacing.lg,
          },
        ]}
      >
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
          <View style={[styles.livePill, { backgroundColor: theme.success + '33' }]}>
            <View style={[styles.liveDot, { backgroundColor: theme.success }]} />
            <Text style={[styles.liveText, { color: theme.success }]}>LIVE</Text>
          </View>
        </View>
        <View style={[styles.countdownPill, { backgroundColor: theme.surfaceSubtle }]}>
          <Ionicons name="time-outline" size={14} color={theme.textSecondary} />
          <Text style={[styles.countdownText, { color: theme.textSecondary }]}>{timeRemaining || '—'}</Text>
        </View>
      </GlassSurface>

      <View style={styles.body}>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          Discover who's here
        </Text>

        {deckLoading && !hasCards ? (
          <View style={styles.centeredInner}>
            <LoadingState title="Loading deck…" message="Finding people at this event." />
          </View>
        ) : !hasCards || isEmpty ? (
          <View style={styles.centeredInner}>
            <EmptyState
              title="No one to show right now"
              message="Check back in a bit — the deck refreshes every 15s."
              actionLabel="Refresh"
              onActionPress={() => refetchDeck()}
            />
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
              <View style={styles.stackCard}>
                <LobbyProfileCard profile={current} theme={theme} />
              </View>
            </View>

            <View style={styles.actions}>
              <Pressable
                style={[styles.actionBtn, { backgroundColor: theme.surface }, processing && styles.actionDisabled]}
                onPress={() => handleSwipe('pass')}
                disabled={processing}
              >
                <Text style={[styles.actionBtnText, { color: theme.text }]}>Pass</Text>
              </Pressable>
              <Pressable
                style={[styles.actionBtn, { backgroundColor: theme.tint }, processing && styles.actionDisabled]}
                onPress={() => handleSwipe('vibe')}
                disabled={processing}
              >
                <Text style={styles.actionBtnText}>{processing ? '…' : 'Vibe'}</Text>
              </Pressable>
              <Pressable
                style={[styles.actionBtn, { backgroundColor: theme.accent }, processing && styles.actionDisabled]}
                onPress={() => handleSwipe('super_vibe')}
                disabled={processing}
              >
                <Text style={styles.actionBtnText}>Super</Text>
              </Pressable>
            </View>
            <Text style={[styles.deckMeta, { color: theme.textSecondary }]}>
              {currentIndex + 1} of {profiles.length} in deck
            </Text>
          </>
        )}
      </View>

      {activeSessionId && (
        <ReadyGateOverlay
          sessionId={activeSessionId}
          partnerName={activeSessionPartnerName}
          onReady={() => {
            setActiveSessionId(null);
            setActiveSessionPartnerName(null);
            router.push(`/date/${activeSessionId}` as const);
          }}
          onClose={() => {
            setActiveSessionId(null);
            setActiveSessionPartnerName(null);
          }}
        />
      )}
    </View>
  );
}

function LobbyProfileCard({
  profile,
  theme,
  isBehind = false,
}: {
  profile: DeckProfile;
  theme: { text: string; textSecondary: string; surfaceSubtle: string };
  isBehind?: boolean;
}) {
  const photo = profile.avatar_url ?? profile.photos?.[0];
  const uri = photo ? avatarUrl(photo) : '';
  return (
    <Card style={[styles.profileCard, isBehind && styles.profileCardBehind]}>
      <Image
        source={{ uri }}
        style={[styles.cardImage, { backgroundColor: theme.surfaceSubtle }]}
      />
      <View style={[styles.cardGradient]} />
      <View style={styles.cardBody}>
        <Text style={[styles.cardName, { color: theme.text }]}>
          {profile.name}, {profile.age}
        </Text>
        {(profile.tagline || profile.job) && (
          <Text style={[styles.cardMeta, { color: theme.textSecondary }]} numberOfLines={2}>
            {[profile.tagline, profile.job].filter(Boolean).join(' · ')}
          </Text>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  centeredInner: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg },
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
  stackCardBack3: {
    transform: [{ scale: 0.92 }, { translateY: 4 }],
    opacity: 0.3,
    pointerEvents: 'none',
  },
  stackCardBack2: {
    transform: [{ scale: 0.96 }, { translateY: 2 }],
    opacity: 0.6,
    pointerEvents: 'none',
  },
  profileCard: { flex: 1, overflow: 'hidden', padding: 0 },
  profileCardBehind: { opacity: 0.95 },
  cardImage: { width: '100%', height: '100%', position: 'absolute' },
  cardGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 140,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  cardBody: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.lg,
    paddingTop: 48,
  },
  cardName: { fontSize: 22, fontWeight: '700', marginBottom: 4 },
  cardMeta: { fontSize: 14 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginBottom: spacing.sm,
  },
  actionBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: radius.lg,
    minWidth: 80,
    alignItems: 'center',
  },
  actionDisabled: { opacity: 0.6 },
  actionBtnText: { color: '#fff', fontWeight: '600' },
  deckMeta: { fontSize: 12, textAlign: 'center' },
});
