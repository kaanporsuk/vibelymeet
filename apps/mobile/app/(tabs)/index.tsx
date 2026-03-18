/**
 * Dashboard — web parity: glass header (greeting + notification + avatar),
 * Next Event card with cover/countdown/CTA, Your Matches horizontal strip, Upcoming Events rail.
 */
import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
  RefreshControl,
  StyleSheet,
  Animated,
  Linking,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { differenceInSeconds } from 'date-fns';
import Colors from '@/constants/Colors';
import { Card, Avatar, VibelyButton, GlassHeaderBar, SectionHeader, EventCardSkeleton, MatchAvatarSkeleton, DiscoverCardSkeleton, VibelyText } from '@/components/ui';
import { DashboardGreeting } from '@/components/DashboardGreeting';
import { spacing, radius, typography, layout, shadows } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import { useEvents, useNextRegisteredEvent } from '@/lib/eventsApi';
import { useMatches } from '@/lib/chatApi';
import { eventCoverUrl } from '@/lib/imageUrl';
import { useActiveSession } from '@/lib/useActiveSession';
import { ActiveCallBanner } from '@/components/events/ActiveCallBanner';
import { useDateProposals } from '@/lib/useDateProposals';
import { useDateReminders } from '@/lib/useDateReminders';
import { DateReminderCard, MiniDateCountdown } from '@/components/schedule/DateReminderCard';
import { endVideoDate } from '@/lib/videoDateApi';
import { supabase } from '@/lib/supabase';
import { useDeletionRecovery } from '@/lib/useDeletionRecovery';
import { DeletionRecoveryBanner } from '@/components/settings/DeletionRecoveryBanner';
import { usePushPermission } from '@/lib/usePushPermission';
import { NotificationPermissionFlow } from '@/components/notifications/NotificationPermissionFlow';
import { PhoneVerificationNudge } from '@/components/PhoneVerificationNudge';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { withAlpha } from '@/lib/colorUtils';
import { useOtherCityEvents } from '@/lib/useOtherCityEvents';

const PHONE_NUDGE_DISMISSED_KEY = 'vibely_phone_nudge_dashboard_dismissed';

function PulsingLiveDot({ color }: { color: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.35, duration: 750, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 750, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [scale]);
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
    </Animated.View>
  );
}

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { user } = useAuth();
  const { activeSession, refetch: refetchActiveSession } = useActiveSession(user?.id);
  const { pendingDeletion, cancelDeletion, isCancelling } = useDeletionRecovery(user?.id);
  const { isGranted: pushGranted, requestPermission, openSettings } = usePushPermission();
  const [showNotificationFlow, setShowNotificationFlow] = useState(false);
  const [showPhoneNudge, setShowPhoneNudge] = useState(false);
  const [phoneNudgeChecked, setPhoneNudgeChecked] = useState(false);
  const { data: events = [], isLoading: eventsLoading, error: eventsError, refetch: refetchEvents } = useEvents(user?.id);
  const { data: matches = [], isLoading: matchesLoading, error: matchesError, refetch: refetchMatches } = useMatches(user?.id);
  const { data: nextEventData, isLoading: nextEventLoading, refetch: refetchNextEvent } = useNextRegisteredEvent(user?.id);
  const { data: proposals = [] } = useDateProposals(user?.id);
  const { nextReminder, imminentReminders } = useDateReminders(proposals);
  const { data: otherCities = [] } = useOtherCityEvents(user?.id);

  const nextEvent = nextEventData?.event ?? null;
  const isRegistered = nextEventData?.isRegistered ?? false;
  const isLiveEvent = nextEvent?.status === 'live';

  const [countdown, setCountdown] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const [refreshing, setRefreshing] = useState(false);

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

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const dismissed = await AsyncStorage.getItem(PHONE_NUDGE_DISMISSED_KEY);
      if (dismissed === 'true') {
        setPhoneNudgeChecked(true);
        return;
      }
      const { data } = await supabase.from('profiles').select('phone_verified').eq('id', user.id).maybeSingle();
      const verified = (data as { phone_verified?: boolean } | null)?.phone_verified;
      setShowPhoneNudge(!verified);
      setPhoneNudgeChecked(true);
    })();
  }, [user?.id]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchNextEvent(), refetchEvents(), refetchMatches(), refetchActiveSession()]);
    setRefreshing(false);
  }, [refetchNextEvent, refetchEvents, refetchMatches, refetchActiveSession]);

  const handleNotificationPress = useCallback(() => {
    if (!pushGranted) setShowNotificationFlow(true);
    else router.push('/settings/notifications');
  }, [pushGranted]);

  const handleCancelDeletion = useCallback(async () => {
    const ok = await cancelDeletion();
    if (ok) {
      // optional: show brief success; banner will disappear
    }
  }, [cancelDeletion]);

  const handleEndActiveSession = useCallback(async () => {
    if (!activeSession || !user?.id) return;
    await endVideoDate(activeSession.sessionId);
    await supabase
      .from('event_registrations')
      .update({ queue_status: 'browsing', current_room_id: null, current_partner_id: null })
      .eq('profile_id', user.id)
      .eq('event_id', activeSession.eventId);
    refetchActiveSession();
  }, [activeSession, user?.id, refetchActiveSession]);

  const loading = nextEventLoading || eventsLoading || matchesLoading;
  const hasError = !loading && (!!eventsError || !!matchesError);
  const handleRetry = useCallback(() => {
    refetchNextEvent();
    refetchEvents();
    refetchMatches();
  }, [refetchNextEvent, refetchEvents, refetchMatches]);
  const discoverEvents = useMemo(
    () => events.filter((e) => e.status !== 'live').slice(0, 4),
    [events]
  );
  const newMatchCount = useMemo(() => matches.filter((m) => m.isNew).length, [matches]);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 320, useNativeDriver: true }).start();
  }, [fadeAnim]);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Deletion recovery banner */}
      {pendingDeletion && (
        <DeletionRecoveryBanner
          scheduledDate={pendingDeletion.scheduled_deletion_at}
          onCancel={handleCancelDeletion}
          isCancelling={isCancelling}
        />
      )}
      {/* Active call rejoin banner — pinned at top when live session exists (in-flow so header stays below) */}
      {activeSession && (
        <View style={[styles.rejoinBannerWrap, { paddingTop: insets.top + 4 }]}>
          <ActiveCallBanner
            sessionId={activeSession.sessionId}
            partnerName={activeSession.partnerName}
            onRejoin={() => router.push(`/date/${activeSession.sessionId}` as const)}
            onEnd={handleEndActiveSession}
          />
        </View>
      )}
      {/* Glass header — greeting left, mini countdown (when next reminder) + notification + avatar right */}
      <GlassHeaderBar insets={insets}>
        <View style={styles.header}>
          <DashboardGreeting />
          <View style={styles.headerRight}>
          {nextReminder && nextReminder.urgency !== 'none' && (
            <MiniDateCountdown
              reminder={nextReminder}
              onPress={() => Linking.openURL('https://vibelymeet.com/schedule')}
            />
          )}
          <Pressable
            onPress={handleNotificationPress}
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.8 }]}
            accessibilityLabel="Notifications"
          >
            <View style={styles.notifWrap}>
              <Ionicons name="notifications-outline" size={22} color={theme.text} />
              <View style={[styles.notifDot, { backgroundColor: theme.accent }]} />
            </View>
          </Pressable>
          <Pressable
            onPress={() => router.push('/profile')}
            style={({ pressed }) => [styles.avatarBtn, pressed && { opacity: 0.8 }]}
            accessibilityLabel="Profile"
          >
            <View style={[styles.avatarRing, { borderColor: theme.glassBorder }]}>
              <Avatar size={32} fallbackInitials={user?.user_metadata?.name?.[0] ?? user?.email?.[0] ?? 'V'} />
            </View>
          </Pressable>
          </View>
        </View>
      </GlassHeaderBar>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: layout.scrollContentPaddingBottomTab }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.tint} />}
      >
        <Animated.View style={[styles.main, { opacity: fadeAnim }]}>
          <NotificationPermissionFlow
            open={showNotificationFlow}
            onOpenChange={setShowNotificationFlow}
            onRequestPermission={requestPermission}
            openSettings={openSettings}
          />
          {/* Phone verification nudge — web parity */}
          {phoneNudgeChecked && showPhoneNudge && (
            <View style={styles.section}>
              <PhoneVerificationNudge
                variant="wizard"
                onDismiss={async () => {
                  await AsyncStorage.setItem(PHONE_NUDGE_DISMISSED_KEY, 'true');
                  setShowPhoneNudge(false);
                }}
                onVerified={() => setShowPhoneNudge(false)}
              />
            </View>
          )}
          {/* Imminent date reminders — web parity */}
          {imminentReminders.length > 0 && (
            <View style={styles.section}>
              {imminentReminders.map((reminder) => (
                <DateReminderCard
                  key={reminder.id}
                  reminder={reminder}
                  onJoinDate={() => Linking.openURL('https://vibelymeet.com/video-date')}
                  onEnableNotifications={() => router.push('/settings/notifications')}
                  notificationsEnabled={pushGranted}
                />
              ))}
            </View>
          )}
          {/* Error banner — minimal, calm */}
          {hasError && (
            <Card variant="glass" style={styles.errorBanner}>
              <Text style={[styles.errorBannerText, { color: theme.textSecondary }]}>Something went wrong loading your feed. Tap Retry.</Text>
              <VibelyButton label="Retry" onPress={handleRetry} variant="secondary" size="sm" />
            </Card>
          )}

          {/* Live event — web SECTION 1: dedicated card, pulsing LIVE, gradient CTA (not merged with countdown) */}
          {loading && !nextEvent ? (
            <View style={styles.section}>
              <SectionHeader title="Next Event" />
              <EventCardSkeleton />
            </View>
          ) : isLiveEvent && isRegistered && nextEvent ? (
            <View style={styles.section}>
              <SectionHeader title="Live Now" />
              <View
                style={[
                  styles.liveEventShell,
                  {
                    backgroundColor: theme.surfaceSubtle,
                    borderColor: withAlpha(theme.danger, 0.4),
                  },
                  shadows.glowPink,
                ]}
              >
                <View style={styles.liveEventMediaTall}>
                  <Image source={{ uri: eventCoverUrl(nextEvent.image) }} style={styles.eventCardImage} resizeMode="cover" />
                  <View style={styles.liveEventGradient} />
                  <View style={[styles.liveBadge, { backgroundColor: theme.dangerSoft, borderColor: theme.danger }]}>
                    <PulsingLiveDot color={theme.danger} />
                    <Text style={[styles.liveBadgeText, { color: theme.danger }]}>Live Now</Text>
                  </View>
                  <View style={styles.liveEventTextBlock}>
                    <VibelyText variant="titleLG" color="#fff" style={[styles.eventCardTitleShadow, { fontSize: 22 }]} numberOfLines={2}>
                      {nextEvent.title}
                    </VibelyText>
                    <View style={styles.liveSubline}>
                      <Ionicons name="people" size={14} color="rgba(255,255,255,0.9)" />
                      <Text style={styles.liveSublineText}>People vibing right now</Text>
                    </View>
                  </View>
                </View>
                <View style={[styles.eventCardBody, { paddingTop: spacing.lg }]}>
                  <VibelyButton
                    label="Enter Lobby →"
                    onPress={() => router.push(`/event/${nextEvent.id}/lobby` as const)}
                    style={styles.ctaFull}
                  />
                </View>
              </View>
            </View>
          ) : nextEvent ? (
            <View style={styles.section}>
              <SectionHeader title="Next Event" />
              <Pressable
                onPress={() => router.push(`/events/${nextEvent.id}` as const)}
                style={[
                  styles.eventCard,
                  { backgroundColor: theme.surfaceSubtle, borderColor: theme.glassBorder },
                  shadows.card,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Next event: ${nextEvent.title}`}
              >
                <View style={styles.eventCardMedia}>
                  <Image source={{ uri: eventCoverUrl(nextEvent.image) }} style={styles.eventCardImage} resizeMode="cover" />
                  <View style={[styles.eventCardOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]} />
                  {isRegistered && (
                    <View style={[styles.registeredBadge, { backgroundColor: 'rgba(0,229,255,0.2)', borderColor: theme.neonCyan }]}>
                      <Text style={[styles.registeredText, { color: theme.neonCyan }]}>✓ Registered</Text>
                    </View>
                  )}
                  <View style={styles.eventCardCaption}>
                    <VibelyText variant="titleLG" color="#fff" style={[styles.eventCardTitleOverlay, styles.eventCardTitleShadow]} numberOfLines={2}>
                      {nextEvent.title}
                    </VibelyText>
                    <Text style={[styles.eventCardDate, { color: 'rgba(255,255,255,0.88)' }]}>{nextEvent.date}</Text>
                  </View>
                </View>
                <View style={styles.eventCardBody}>
                  <View style={styles.countdownRow}>
                    {[
                      { value: countdown.days, label: 'DAYS' },
                      { value: countdown.hours, label: 'HRS' },
                      { value: countdown.minutes, label: 'MIN' },
                      { value: countdown.seconds, label: 'SEC' },
                    ].map((item, i) => (
                      <View key={i} style={[styles.countdownBlock, { backgroundColor: theme.secondary }]}>
                        <VibelyText variant="titleMD" color={theme.tint} style={styles.countdownValue}>
                          {String(item.value).padStart(2, '0')}
                        </VibelyText>
                        <Text style={[styles.countdownLabel, { color: theme.textSecondary }]}>{item.label}</Text>
                      </View>
                    ))}
                  </View>
                  {!isRegistered && (
                    <View style={styles.ctaWrap}>
                      <VibelyButton
                        label="View & Register"
                        onPress={() => router.push(`/events/${nextEvent.id}` as const)}
                        variant="secondary"
                        size="sm"
                        style={styles.ctaFull}
                      />
                    </View>
                  )}
                </View>
              </Pressable>
            </View>
          ) : null}

          {!nextEvent && !loading && (
            <Card variant="glass" style={styles.emptyNoEvents}>
              <Text style={[styles.emptyNoEventsText, { color: theme.textSecondary }]}>No upcoming events</Text>
              <Pressable onPress={() => router.push('/events')} style={({ pressed }) => [pressed && { opacity: 0.8 }]}>
                <Text style={[styles.emptyNoEventsBtn, { color: theme.tint }]}>Browse Events</Text>
              </Pressable>
            </Card>
          )}

          {otherCities.length > 0 && (
            <View
              style={[
                styles.otherCitiesCard,
                { backgroundColor: theme.surfaceSubtle, borderColor: withAlpha(theme.tint, 0.2) },
              ]}
            >
              <View style={styles.otherCitiesRow}>
                <Text style={styles.otherCitiesEmoji}>💎</Text>
                <View style={styles.otherCitiesCopy}>
                  <Text style={[styles.otherCitiesTitle, { color: theme.text }]}>
                    {otherCities.reduce((sum, c) => sum + Number(c.event_count), 0)} events in {otherCities.length}{' '}
                    {otherCities.length === 1 ? 'city' : 'cities'}
                  </Text>
                  <Text style={[styles.otherCitiesSub, { color: theme.textSecondary }]}>
                    {otherCities
                      .slice(0, 3)
                      .map((c) => c.city)
                      .join(' · ')}
                    {otherCities.length > 3 ? ` + ${otherCities.length - 3} more` : ''}
                  </Text>
                </View>
                <Pressable
                  onPress={() => router.push('/events')}
                  style={({ pressed }) => [
                    styles.otherCitiesCta,
                    { borderColor: withAlpha(theme.tint, 0.3) },
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={[styles.otherCitiesCtaText, { color: theme.tint }]}>Go Premium →</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* Your Matches — web parity: horizontal avatars + "X new" pill + See all */}
          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <View style={styles.sectionTitleRow}>
                <VibelyText variant="titleMD" style={styles.sectionTitle}>Your Matches</VibelyText>
                {!loading && newMatchCount > 0 && (
                  <View
                  style={[
                    styles.newPill,
                    { backgroundColor: withAlpha(theme.neonPink, 0.2), borderColor: withAlpha(theme.neonPink, 0.35) },
                  ]}
                >
                    <Text style={[styles.newPillText, { color: theme.neonPink }]}>{newMatchCount} new</Text>
                  </View>
                )}
              </View>
              <Pressable onPress={() => router.push('/matches')} style={styles.seeAll}>
                <Text style={[styles.seeAllText, { color: theme.tint }]}>See all</Text>
                <Ionicons name="chevron-forward" size={16} color={theme.tint} />
              </Pressable>
            </View>
            {loading ? (
              <View style={styles.matchRow}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <MatchAvatarSkeleton key={i} />
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
                    <View style={[styles.matchAvatarWrap, m.isNew && { borderColor: theme.tint, borderWidth: 2 }]}>
                      <Avatar
                        size={52}
                        image={<Image source={{ uri: m.image }} style={styles.avatarImg} />}
                        fallbackInitials={m.name?.[0]}
                      />
                    </View>
                    <VibelyText variant="body" color={theme.text} style={styles.matchName} numberOfLines={1}>
                      {m.name?.split(' ')[0] ?? 'Match'}
                    </VibelyText>
                  </Pressable>
                ))}
              </ScrollView>
            ) : (
              <View style={styles.matchesEmpty}>
                <Text style={[styles.matchesEmptyText, { color: theme.textSecondary }]}>
                  No matches yet. Join an event to start connecting!
                </Text>
                <Pressable
                  onPress={() => router.push('/events')}
                  style={({ pressed }) => [styles.matchesEmptyBtn, { borderColor: theme.border }, pressed && { opacity: 0.85 }]}
                >
                  <Text style={[styles.matchesEmptyBtnText, { color: theme.text }]}>Browse Events →</Text>
                </Pressable>
              </View>
            )}
          </View>

          {/* Upcoming Events — web parity: horizontal rail */}
          <View style={styles.section}>
            <SectionHeader
              title="Upcoming Events"
              action={
                <Pressable onPress={() => router.push('/events')} style={styles.seeAll}>
                  <Text style={[styles.seeAllText, { color: theme.tint }]}>All events</Text>
                  <Ionicons name="chevron-forward" size={16} color={theme.tint} />
                </Pressable>
              }
            />
            {loading ? (
              <View style={styles.eventRail}>
                <DiscoverCardSkeleton />
                <DiscoverCardSkeleton />
              </View>
            ) : discoverEvents.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.eventRail}>
                {discoverEvents.map((event) => (
                  <Pressable
                    key={event.id}
                    onPress={() => router.push(`/events/${event.id}` as const)}
                    style={[
                      styles.discoverCard,
                      { backgroundColor: theme.surfaceSubtle, borderColor: theme.glassBorder },
                      shadows.card,
                    ]}
                  >
                    <Image source={{ uri: eventCoverUrl(event.image) }} style={styles.discoverImage} resizeMode="cover" />
                    <View style={styles.discoverBody}>
                      <VibelyText variant="titleSM" numberOfLines={1} style={styles.discoverTitle}>
                        {event.title}
                      </VibelyText>
                      <Text style={[styles.discoverMeta, { color: theme.textSecondary }]}>
                        {event.date} • {event.time}
                      </Text>
                      <View style={styles.discoverAttendeesRow}>
                        <Ionicons name="people-outline" size={12} color={theme.textSecondary} />
                        <Text style={[styles.discoverAttendees, { color: theme.textSecondary }]}>
                          {event.attendees} attending
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            ) : (
              <View style={[styles.upcomingEmpty, { borderColor: theme.border }]}>
                <Text style={[styles.upcomingEmptyText, { color: theme.textSecondary }]}>No upcoming events</Text>
                <Pressable onPress={() => router.push('/events')} style={styles.upcomingEmptyLink}>
                  <Text style={[styles.upcomingEmptyLinkText, { color: theme.tint }]}>Browse Events</Text>
                  <Ionicons name="chevron-forward" size={14} color={theme.tint} />
                </Pressable>
              </View>
            )}
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  rejoinBannerWrap: { zIndex: 60 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconBtn: { padding: spacing.xs },
  notifWrap: { position: 'relative' },
  notifDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
    opacity: 0.9,
  },
  avatarBtn: {},
  avatarRing: { borderRadius: 999, borderWidth: 1, padding: 2 },
  avatarImg: { width: '100%', height: '100%', borderRadius: 999 },
  scroll: { flex: 1 },
  scrollContent: { paddingTop: layout.mainContentPaddingTop },
  main: {
    paddingHorizontal: layout.containerPadding,
    paddingTop: layout.mainContentPaddingTop,
    gap: spacing['2xl'],
    maxWidth: layout.contentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  errorBannerText: { fontSize: 14 },
  section: { gap: spacing.md + 2 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionTitle: { ...typography.titleMD, fontSize: 18 },
  newPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  newPillText: { fontSize: 12, fontWeight: '600' },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  matchAvatarWrap: { borderRadius: 999, padding: 2 },
  seeAllText: { fontSize: 12, fontWeight: '600' },
  upcomingEmpty: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderRadius: radius.lg,
    borderStyle: 'dashed',
    alignItems: 'center',
    gap: spacing.sm,
  },
  upcomingEmptyText: { fontSize: 14 },
  upcomingEmptyLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  upcomingEmptyLinkText: { fontSize: 12, fontWeight: '600' },
  liveEventShell: {
    borderRadius: radius['2xl'],
    borderWidth: 1,
    overflow: 'hidden',
  },
  liveEventMediaTall: { minHeight: 200, position: 'relative' },
  liveEventGradient: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  liveEventTextBlock: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
  },
  emptyNoEvents: { padding: spacing.xl, alignItems: 'center', borderRadius: radius['2xl'] },
  emptyNoEventsText: { fontSize: 14, marginBottom: spacing.sm },
  emptyNoEventsBtn: { fontSize: 14, fontWeight: '600', marginTop: spacing.xs },
  otherCitiesCard: {
    padding: spacing.lg,
    borderRadius: radius['2xl'],
    borderWidth: 1,
  },
  otherCitiesRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  otherCitiesEmoji: { fontSize: 20 },
  otherCitiesCopy: { flex: 1, minWidth: 0 },
  otherCitiesTitle: { fontSize: 14, fontWeight: '600' },
  otherCitiesSub: { fontSize: 12, marginTop: 2 },
  otherCitiesCta: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.md, borderWidth: 1 },
  otherCitiesCtaText: { fontSize: 12, fontWeight: '600' },
  matchesEmpty: { alignItems: 'center', paddingVertical: spacing.lg, width: '100%' },
  matchesEmptyText: { fontSize: 14, textAlign: 'center', marginBottom: spacing.sm },
  matchesEmptyBtn: { paddingVertical: 8, paddingHorizontal: spacing.lg, borderRadius: radius.lg, borderWidth: 1 },
  matchesEmptyBtnText: { fontSize: 14, fontWeight: '600' },
  eventCard: {
    borderRadius: radius['2xl'],
    borderWidth: 1,
    overflow: 'hidden',
  },
  eventCardMedia: { height: 144, position: 'relative' },
  eventCardImage: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  eventCardOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
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
  liveBadge: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  liveBadgeText: { fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  liveSubline: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  liveSublineText: { color: 'rgba(255,255,255,0.85)', fontSize: 14 },
  eventCardCaption: { position: 'absolute', bottom: spacing.xl, left: spacing.lg, right: spacing.lg },
  eventCardTitleOverlay: { color: '#fff' },
  eventCardTitle: { color: '#fff', fontSize: 21, fontWeight: '700' },
  eventCardTitleShadow: { textShadowColor: 'rgba(0,0,0,0.65)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
  eventCardDate: { color: 'rgba(255,255,255,0.88)', fontSize: 14, marginTop: 6 },
  eventCardBody: { padding: spacing.lg, paddingTop: spacing.md + 2, gap: spacing.md },
  ctaWrap: { width: '100%', marginTop: 2 },
  ctaFull: { alignSelf: 'stretch' },
  countdownRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm },
  countdownBlock: {
    minWidth: 56,
    height: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownValue: { fontSize: 20 },
  countdownLabel: { fontSize: 10, marginTop: 2, letterSpacing: 0.5 },
  emptyCardWrap: { paddingVertical: spacing.xl, alignItems: 'center' },
  matchRow: { flexDirection: 'row', gap: spacing.lg, paddingVertical: spacing.sm, paddingRight: spacing.lg },
  matchItem: { alignItems: 'center', gap: spacing.sm, minWidth: 64 },
  matchName: { fontWeight: '600', fontSize: 12, maxWidth: 64 },
  eventRail: { flexDirection: 'row', gap: spacing.md + 2, paddingBottom: spacing.lg },
  discoverCard: {
    width: 260,
    borderRadius: radius['2xl'],
    borderWidth: 1,
    overflow: 'hidden',
  },
  discoverImage: { width: '100%', height: 120 },
  discoverBody: { padding: spacing.md, gap: 6 },
  discoverTitle: { fontWeight: '600' },
  discoverMeta: { fontSize: 12 },
  discoverAttendeesRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  discoverAttendees: { fontSize: 12 },
});
