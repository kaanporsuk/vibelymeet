/**
 * Dashboard — web parity: glass header (greeting + notification + avatar),
 * Next Event card with cover/countdown/CTA, Your Matches horizontal strip, Upcoming Events rail.
 */
import React, { useCallback, useMemo, useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
  RefreshControl,
  StyleSheet,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { differenceInSeconds } from 'date-fns';
import Colors from '@/constants/Colors';
import { Card, Avatar, VibelyButton } from '@/components/ui';
import { DashboardGreeting } from '@/components/DashboardGreeting';
import { spacing, radius, typography } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import { useEvents, useIsRegisteredForEvent } from '@/lib/eventsApi';
import { useMatches } from '@/lib/chatApi';
import { eventCoverUrl, avatarUrl } from '@/lib/imageUrl';

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { user } = useAuth();
  const { data: events = [], isLoading: eventsLoading, refetch: refetchEvents } = useEvents(user?.id);
  const { data: matches = [], isLoading: matchesLoading, refetch: refetchMatches } = useMatches(user?.id);

  const [countdown, setCountdown] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const [refreshing, setRefreshing] = useState(false);

  const nextEvent = useMemo(() => {
    const now = new Date();
    const upcoming = events.filter((e) => e.eventDate >= now || e.status === 'live');
    return upcoming[0] ?? null;
  }, [events]);
  const isLiveEvent = nextEvent?.status === 'live';
  const { data: isRegistered = false } = useIsRegisteredForEvent(nextEvent?.id, user?.id);

  useEffect(() => {
    if (!nextEvent?.eventDate || isLiveEvent) return;
    const update = () => {
      const diff = differenceInSeconds(nextEvent.eventDate, new Date());
      if (diff <= 0) {
        setCountdown({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        return;
      }
      setCountdown({
        days: Math.floor(diff / 86400),
        hours: Math.floor((diff % 86400) / 3600),
        minutes: Math.floor((diff % 3600) / 60),
        seconds: diff % 60,
      });
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [nextEvent?.eventDate, isLiveEvent]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchEvents(), refetchMatches()]);
    setRefreshing(false);
  }, [refetchEvents, refetchMatches]);

  const loading = eventsLoading || matchesLoading;
  const discoverEvents = useMemo(
    () => events.filter((e) => e.status !== 'live').slice(0, 4),
    [events]
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Glass header — web parity: greeting left, notification + avatar right */}
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + spacing.md,
            paddingBottom: spacing.md,
            paddingHorizontal: spacing.lg,
            backgroundColor: theme.glassSurface,
            borderBottomColor: theme.glassBorder,
          },
        ]}
      >
        <DashboardGreeting />
        <View style={styles.headerRight}>
          <Pressable
            onPress={() => {}}
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.8 }]}
            accessibilityLabel="Notifications"
          >
            <Ionicons name="notifications-outline" size={22} color={theme.text} />
          </Pressable>
          <Pressable
            onPress={() => router.push('/profile')}
            style={({ pressed }) => [styles.avatarBtn, pressed && { opacity: 0.8 }]}
            accessibilityLabel="Profile"
          >
            <Avatar size={32} fallbackInitials={user?.user_metadata?.name?.[0] ?? user?.email?.[0] ?? 'V'} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 24 + 80 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.tint} />}
      >
        <View style={styles.main}>
          {/* Next Event card — web parity: cover, title/date, countdown, CTA */}
          {nextEvent && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>Next Event</Text>
              <Pressable
                onPress={() => router.push(`/events/${nextEvent.id}` as const)}
                style={[styles.eventCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
              >
                <View style={styles.eventCardMedia}>
                  <Image source={{ uri: eventCoverUrl(nextEvent.image) }} style={styles.eventCardImage} />
                  <View style={styles.eventCardOverlay} />
                  {isRegistered && (
                    <View style={[styles.registeredBadge, { backgroundColor: 'rgba(0,229,255,0.2)', borderColor: theme.neonCyan }]}>
                      <Text style={[styles.registeredText, { color: theme.neonCyan }]}>✓ Registered</Text>
                    </View>
                  )}
                  <View style={styles.eventCardCaption}>
                    <Text style={styles.eventCardTitle} numberOfLines={1}>{nextEvent.title}</Text>
                    <Text style={styles.eventCardDate}>{nextEvent.date}</Text>
                  </View>
                </View>
                <View style={styles.eventCardBody}>
                  {!isLiveEvent && (
                    <View style={styles.countdownRow}>
                      {[
                        { value: countdown.days, label: 'DAYS' },
                        { value: countdown.hours, label: 'HRS' },
                        { value: countdown.minutes, label: 'MIN' },
                        { value: countdown.seconds, label: 'SEC' },
                      ].map((item, i) => (
                        <View key={i} style={[styles.countdownBlock, { backgroundColor: theme.surfaceSubtle }]}>
                          <Text style={[styles.countdownValue, { color: theme.tint }]}>
                            {String(item.value).padStart(2, '0')}
                          </Text>
                          <Text style={[styles.countdownLabel, { color: theme.textSecondary }]}>{item.label}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  {isLiveEvent && isRegistered ? (
                    <VibelyButton
                      label="Enter Lobby →"
                      onPress={() => router.push(`/event/${nextEvent.id}/lobby` as const)}
                    />
                  ) : (
                    <VibelyButton
                      label={isRegistered ? 'View event' : 'View & Register'}
                      onPress={() => router.push(`/events/${nextEvent.id}` as const)}
                      variant={isRegistered ? 'primary' : 'secondary'}
                    />
                  )}
                </View>
              </Pressable>
            </View>
          )}

          {!nextEvent && !loading && (
            <View style={[styles.emptyCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.emptyText, { color: theme.textSecondary }]}>No upcoming events</Text>
              <VibelyButton label="Browse Events" onPress={() => router.push('/events')} variant="ghost" />
            </View>
          )}

          {/* Your Matches — web parity: horizontal avatars + See all */}
          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>Your Matches</Text>
              <Pressable onPress={() => router.push('/matches')} style={styles.seeAll}>
                <Text style={[styles.seeAllText, { color: theme.tint }]}>See all</Text>
                <Ionicons name="chevron-forward" size={16} color={theme.tint} />
              </Pressable>
            </View>
            {loading ? (
              <View style={styles.matchRow}>
                {[1, 2, 3, 4].map((i) => (
                  <View key={i} style={[styles.matchAvatarSkeleton, { backgroundColor: theme.surfaceSubtle }]} />
                ))}
              </View>
            ) : matches.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.matchRow}>
                {matches.map((m) => (
                  <Pressable
                    key={m.matchId}
                    onPress={() => router.push(`/chat/${m.id}` as const)}
                    style={({ pressed }) => [styles.matchItem, pressed && { opacity: 0.8 }]}
                  >
                    <Avatar
                      size={56}
                      image={<Image source={{ uri: m.image }} style={styles.avatarImg} />}
                      fallbackInitials={m.name?.[0]}
                    />
                    <Text style={[styles.matchName, { color: theme.text }]} numberOfLines={1}>
                      {m.name?.split(' ')[0] ?? 'Match'}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : (
              <View style={[styles.emptyCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                  No matches yet. Join an event to start connecting!
                </Text>
                <VibelyButton label="Browse Events" onPress={() => router.push('/events')} variant="secondary" />
              </View>
            )}
          </View>

          {/* Upcoming Events — web parity: horizontal rail */}
          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>Upcoming Events</Text>
              <Pressable onPress={() => router.push('/events')} style={styles.seeAll}>
                <Text style={[styles.seeAllText, { color: theme.tint }]}>All events</Text>
                <Ionicons name="chevron-forward" size={16} color={theme.tint} />
              </Pressable>
            </View>
            {loading ? (
              <View style={styles.eventRail}>
                {[1, 2].map((i) => (
                  <View key={i} style={[styles.discoverCardSkeleton, { backgroundColor: theme.surfaceSubtle }]} />
                ))}
              </View>
            ) : discoverEvents.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.eventRail}>
                {discoverEvents.map((event) => (
                  <Pressable
                    key={event.id}
                    onPress={() => router.push(`/events/${event.id}` as const)}
                    style={[styles.discoverCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
                  >
                    <Image source={{ uri: eventCoverUrl(event.image) }} style={styles.discoverImage} />
                    <View style={styles.discoverBody}>
                      <Text style={[styles.discoverTitle, { color: theme.text }]} numberOfLines={1}>
                        {event.title}
                      </Text>
                      <Text style={[styles.discoverMeta, { color: theme.textSecondary }]}>
                        {event.date} • {event.time}
                      </Text>
                      <Text style={[styles.discoverAttendees, { color: theme.textSecondary }]}>
                        {event.attendees} attending
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconBtn: { padding: spacing.xs },
  avatarBtn: {},
  avatarImg: { width: '100%', height: '100%', borderRadius: 999 },
  scroll: { flex: 1 },
  scrollContent: { paddingTop: spacing.lg },
  main: { paddingHorizontal: spacing.lg, gap: spacing.xl },
  section: { gap: spacing.md },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  sectionTitle: { ...typography.titleMD, fontSize: 18 },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  seeAllText: { fontSize: 14, fontWeight: '600' },
  eventCard: {
    borderRadius: radius['2xl'],
    borderWidth: 1,
    overflow: 'hidden',
  },
  eventCardMedia: { height: 144, position: 'relative' },
  eventCardImage: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  eventCardOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  registeredBadge: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  registeredText: { fontSize: 12, fontWeight: '600' },
  eventCardCaption: { position: 'absolute', bottom: spacing.md, left: spacing.md },
  eventCardTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  eventCardDate: { color: 'rgba(255,255,255,0.8)', fontSize: 14, marginTop: 2 },
  eventCardBody: { padding: spacing.lg, gap: spacing.md },
  countdownRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.md },
  countdownBlock: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownValue: { fontSize: 18, fontWeight: '700' },
  countdownLabel: { fontSize: 10, marginTop: 2 },
  emptyCard: {
    padding: spacing.xl,
    borderRadius: radius['2xl'],
    borderWidth: 1,
    alignItems: 'center',
    gap: spacing.md,
  },
  emptyText: { fontSize: 14 },
  matchRow: { flexDirection: 'row', gap: spacing.lg, paddingVertical: spacing.sm },
  matchItem: { alignItems: 'center', gap: spacing.sm, minWidth: 72 },
  matchName: { fontSize: 12, fontWeight: '600' },
  matchAvatarSkeleton: { width: 56, height: 56, borderRadius: 28 },
  eventRail: { flexDirection: 'row', gap: spacing.md, paddingBottom: spacing.sm },
  discoverCardSkeleton: { width: 260, height: 160, borderRadius: radius['2xl'] },
  discoverCard: {
    width: 260,
    borderRadius: radius['2xl'],
    borderWidth: 1,
    overflow: 'hidden',
  },
  discoverImage: { width: '100%', height: 120 },
  discoverBody: { padding: spacing.md, gap: 2 },
  discoverTitle: { fontSize: 14, fontWeight: '600' },
  discoverMeta: { fontSize: 12 },
  discoverAttendees: { fontSize: 12 },
});
