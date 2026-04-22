/**
 * Dashboard — live social command center: contextual header, 4-state hero, quick actions,
 * matches, upcoming events rail, profile readiness, ambient pulse.
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
} from 'react-native';
import { router, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import Colors from '@/constants/Colors';
import {
  Avatar,
  VibelyButton,
  GlassHeaderBar,
  EventCardSkeleton,
  MatchAvatarSkeleton,
  DiscoverCardSkeleton,
  ErrorState,
} from '@/components/ui';
import { LinearGradient } from 'expo-linear-gradient';
import { spacing, radius, layout, shadows, gradient, fonts } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import { useEvents, useNextRegisteredEvent } from '@/lib/eventsApi';
import { useOtherCityEvents, type OtherCityEvent } from '@/lib/useOtherCityEvents';
import { useEntitlements } from '@/hooks/useEntitlements';
import { useMatches } from '@/lib/chatApi';
import { eventCoverUrl, getImageUrl } from '@/lib/imageUrl';
import { hrefForActiveSession } from '@/lib/activeSessionRoutes';
import { useActiveSession } from '@/lib/useActiveSession';
import { ActiveCallBanner } from '@/components/events/ActiveCallBanner';
import { useDateReminders, type DateReminder } from '@/lib/useDateReminders';
import { useScheduleHub } from '@/lib/useScheduleHub';
import { DateReminderCard, MiniDateCountdown } from '@/components/schedule/DateReminderCard';
import { endVideoDate, updateParticipantStatus } from '@/lib/videoDateApi';
import { supabase } from '@/lib/supabase';
import { isWithinDiscoverHomeGraceWindow } from '@clientShared/discoverEventVisibility';
import { useDeletionRecovery } from '@/lib/useDeletionRecovery';
import { DeletionRecoveryBanner } from '@/components/settings/DeletionRecoveryBanner';
import { usePushPermission } from '@/lib/usePushPermission';
import { PushPermissionPrompt } from '@/components/notifications/PushPermissionPrompt';
import {
  isDashboardPushOsPermissionRequestInFlight,
  logDashboardPushPrepromptSuppressed,
  setDashboardPushPrepromptVisible,
  shouldOfferDashboardPushPreprompt,
  shouldShowDashboardPushPreprompt,
} from '@/lib/requestPushPermissions';
import { syncNativePushDeliveryOnForeground } from '@/lib/nativePushForegroundSync';
import { pushPermDevLog } from '@/lib/osPushPermission';
import { PhoneVerificationNudge } from '@/components/PhoneVerificationNudge';
import { PhoneVerificationFlow } from '@/components/verification/PhoneVerificationFlow';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { withAlpha } from '@/lib/colorUtils';
import { useDailyDropTabBadge } from '@/lib/useDailyDropTabBadge';
import { OnBreakBanner } from '@/components/OnBreakBanner';
import { deriveEventPhase, getCountdownParts } from '@/lib/eventPhase';
import { resolvePrimaryProfilePhotoPath } from '../../../../shared/profilePhoto/resolvePrimaryProfilePhotoPath';

const PHONE_NUDGE_DISMISSED_KEY = 'vibely_phone_nudge_dashboard_dismissed';

function isToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  );
}

function isThisWeek(date: Date): boolean {
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 7);
  return date >= startOfWeek && date < endOfWeek;
}

function getTimeGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Subtle scale pulse on the small LIVE dot only — calm, not card-level. */
function PulsingLiveDot({ color }: { color: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.15, duration: 2000, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 2000, useNativeDriver: true }),
      ]),
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

type HomeProfile = {
  name: string | null;
  photos: string[] | null;
  about_me: string | null;
  avatar_url: string | null;
  vibeCount: number;
};

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const qc = useQueryClient();
  const { user, onboardingComplete } = useAuth();
  const { activeSession, hydrated: sessionHydrated, refetch: refetchActiveSession } = useActiveSession(user?.id);
  const {
    pendingDeletion,
    cancelDeletion,
    isCancelling,
    refetchDeletionState,
    deletionStateError,
    cancelDeletionError,
    clearDeletionStateError,
    clearCancelDeletionError,
  } = useDeletionRecovery(user?.id);
  const {
    isGranted: pushGranted,
    isDenied: pushDenied,
    osStatus: pushOsStatus,
    permissionStateHydrated: pushPermissionStateHydrated,
    refresh: refreshPushPermission,
  } = usePushPermission();
  const [showPushPermissionPrompt, setShowPushPermissionPrompt] = useState(false);
  const pushPromptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prepromptScheduledThisSessionRef = useRef(false);
  const prepromptVisibleRef = useRef(false);
  const osPermissionRequestInFlightRef = useRef(false);
  const pushGrantedBaselineRef = useRef<boolean | null>(null);
  const [showPhoneNudge, setShowPhoneNudge] = useState(false);
  const [phoneNudgeChecked, setPhoneNudgeChecked] = useState(false);
  const [showPhoneVerify, setShowPhoneVerify] = useState(false);
  const [initialPhoneE164, setInitialPhoneE164] = useState<string | null>(null);
  const { canCityBrowse } = useEntitlements();
  const { data: events = [], isLoading: eventsLoading, error: eventsError, refetch: refetchEvents } = useEvents(
    user?.id ?? null,
    canCityBrowse,
  );
  const { data: matches = [], isLoading: matchesLoading, error: matchesError, refetch: refetchMatches } = useMatches(user?.id);
  const { data: nextEventData, isLoading: nextEventLoading, refetch: refetchNextEvent } = useNextRegisteredEvent(user?.id ?? null, canCityBrowse);
  const { reminderSources } = useScheduleHub();
  const { nextReminder, imminentReminders } = useDateReminders(reminderSources);
  const { data: otherCities = [] } = useOtherCityEvents(user?.id);
  const dropReady = useDailyDropTabBadge(user?.id);

  const { data: unreadMessageCount = 0, refetch: refetchUnread } = useQuery({
    queryKey: ['unread-home', user?.id],
    queryFn: async () => {
      if (!user?.id) return 0;
      const { count, error } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .neq('sender_id', user.id)
        .is('read_at', null);
      if (error) {
        if (__DEV__) console.warn('[home] unread messages count error:', error.message);
        throw error;
      }
      return count ?? 0;
    },
    enabled: !!user?.id,
    refetchInterval: 30_000,
  });

  const { data: homeProfile, refetch: refetchHomeProfile } = useQuery({
    queryKey: ['home-dashboard-profile', user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<HomeProfile | null> => {
      if (!user?.id) return null;
      const { data: row, error } = await supabase
        .from('profiles')
        .select('name, photos, about_me, avatar_url')
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw error;
      const { count, error: vErr } = await supabase
        .from('profile_vibes')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', user.id);
      if (vErr && __DEV__) console.warn('[home] profile_vibes count:', vErr.message);
      const r = row as { name?: string | null; photos?: string[] | null; about_me?: string | null; avatar_url?: string | null } | null;
      return {
        name: r?.name ?? null,
        photos: r?.photos ?? null,
        about_me: r?.about_me ?? null,
        avatar_url: r?.avatar_url ?? null,
        vibeCount: count ?? 0,
      };
    },
  });

  const profile = homeProfile;
  const hasPhotos = (profile?.photos?.length ?? 0) >= 2;
  const hasVibes = (profile?.vibeCount ?? 0) >= 3;
  const hasAbout = !!profile?.about_me && profile.about_me.length >= 10;
  const isProfileComplete = hasPhotos && hasVibes && hasAbout;

  const handleDateJoinReminder = useCallback(
    async (reminder: DateReminder) => {
      if (activeSession) {
        router.push(hrefForActiveSession(activeSession));
        return;
      }
      if (reminder.partnerUserId) {
        router.push(`/chat/${reminder.partnerUserId}` as const);
        return;
      }
      if (reminder.matchId && user?.id) {
        const { data } = await supabase
          .from('matches')
          .select('profile_id_1, profile_id_2')
          .eq('id', reminder.matchId)
          .maybeSingle();
        if (data) {
          const pid = data.profile_id_1 === user.id ? data.profile_id_2 : data.profile_id_1;
          router.push(`/chat/${pid}` as const);
        }
      }
    },
    [activeSession, user?.id],
  );

  const nextEvent = nextEventData?.event ?? null;
  const isConfirmedForNextEvent = nextEventData?.isRegistered ?? false;
  const isWaitlistedForNextEvent = nextEventData?.isWaitlisted ?? false;
  const hasEventAdmissionForNext =
    nextEventData?.hasEventAdmission ?? (isConfirmedForNextEvent || isWaitlistedForNextEvent);
  const [liveClockMs, setLiveClockMs] = useState(() => Date.now());

  useEffect(() => {
    if (!nextEvent || !hasEventAdmissionForNext) return;
    const timer = setInterval(() => setLiveClockMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [nextEvent?.id, hasEventAdmissionForNext]);

  const nextEventPhase = useMemo(
    () =>
      nextEvent
        ? deriveEventPhase({
            eventDate: nextEvent.eventDate,
            eventDurationMinutes: nextEvent.duration_minutes,
            nowMs: liveClockMs,
          })
        : null,
    [nextEvent?.id, nextEvent?.eventDate?.getTime(), nextEvent?.duration_minutes, liveClockMs],
  );

  const isLiveEvent = nextEventPhase?.isLive ?? false;

  const hoursUntilNext = useMemo(() => {
    if (!nextEventPhase || nextEventPhase.isEnded) return Number.POSITIVE_INFINITY;
    return nextEventPhase.msUntilStart / 36e5;
  }, [nextEventPhase]);

  /** Home rail: same window as `get_visible_events` (effective end + 6h). */
  const upcomingEvents = useMemo(
    () =>
      events.filter((e) =>
        isWithinDiscoverHomeGraceWindow({
          status: e.status,
          eventDate: e.eventDate,
          durationMinutes: e.duration_minutes,
        })
      ),
    [events],
  );

  const eventSectionTitle = useMemo(() => {
    if (upcomingEvents.some((e) => isToday(e.eventDate))) return 'Tonight';
    if (upcomingEvents.some((e) => isThisWeek(e.eventDate))) return 'This Week';
    return 'Upcoming Events';
  }, [upcomingEvents]);

  const countdown = useMemo(
    () => (nextEventPhase ? getCountdownParts(nextEventPhase.msUntilStart) : { days: 0, hours: 0, minutes: 0, seconds: 0 }),
    [nextEventPhase],
  );
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const dismissed = await AsyncStorage.getItem(PHONE_NUDGE_DISMISSED_KEY);
      if (dismissed === 'true') {
        setPhoneNudgeChecked(true);
        return;
      }
      const { data } = await supabase
        .from('profiles')
        .select('phone_verified, phone_number')
        .eq('id', user.id)
        .maybeSingle();
      const verified = (data as { phone_verified?: boolean } | null)?.phone_verified;
      const phoneNumber = (data as { phone_number?: string | null } | null)?.phone_number;
      setShowPhoneNudge(!verified);
      setInitialPhoneE164(phoneNumber ?? null);
      setPhoneNudgeChecked(true);
    })();
  }, [user?.id]);

  const refreshPhoneNudgeStatus = React.useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from('profiles')
      .select('phone_verified, phone_number')
      .eq('id', user.id)
      .maybeSingle();
    const verified = (data as { phone_verified?: boolean } | null)?.phone_verified;
    const phoneNumber = (data as { phone_number?: string | null } | null)?.phone_number;
    setShowPhoneNudge(!verified);
    setInitialPhoneE164(phoneNumber ?? null);
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      if (__DEV__) pushPermDevLog('dashboard useFocusEffect: refreshPushPermission');
      void refreshPushPermission('dashboard_focus');
    }, [refreshPushPermission])
  );

  useEffect(() => {
    let cancelled = false;
    if (pushPromptTimerRef.current) {
      clearTimeout(pushPromptTimerRef.current);
      pushPromptTimerRef.current = null;
    }

    osPermissionRequestInFlightRef.current = isDashboardPushOsPermissionRequestInFlight();
    const promptContext = {
      permissionStateHydrated: pushPermissionStateHydrated,
      osStatus: pushOsStatus,
      promptVisible: prepromptVisibleRef.current || showPushPermissionPrompt,
      osPermissionRequestInFlight: osPermissionRequestInFlightRef.current,
    };

    if (!user?.id) {
      logDashboardPushPrepromptSuppressed('missing_user');
      return;
    }
    if (onboardingComplete !== true) {
      logDashboardPushPrepromptSuppressed('onboarding_incomplete_or_unknown', { onboardingComplete });
      return;
    }
    if (!pushPermissionStateHydrated) {
      logDashboardPushPrepromptSuppressed('permission_state_not_hydrated', { osStatus: pushOsStatus });
      return;
    }
    if (pushGranted || pushDenied || pushOsStatus !== 'undetermined') {
      logDashboardPushPrepromptSuppressed('hydrated_os_state_not_promptable', { osStatus: pushOsStatus });
      return;
    }
    if (prepromptScheduledThisSessionRef.current) {
      logDashboardPushPrepromptSuppressed('preprompt_scheduled_this_session');
      return;
    }
    if (promptContext.promptVisible) {
      logDashboardPushPrepromptSuppressed('preprompt_already_visible');
      return;
    }
    if (promptContext.osPermissionRequestInFlight) {
      logDashboardPushPrepromptSuppressed('os_permission_request_in_flight');
      return;
    }

    prepromptScheduledThisSessionRef.current = true;
    void (async () => {
      const offer = await shouldOfferDashboardPushPreprompt(promptContext);
      if (!offer || cancelled) return;
      pushPromptTimerRef.current = setTimeout(() => {
        pushPromptTimerRef.current = null;
        void (async () => {
          const decision = await shouldShowDashboardPushPreprompt({
            ...promptContext,
            promptVisible: prepromptVisibleRef.current || showPushPermissionPrompt,
            osPermissionRequestInFlight:
              osPermissionRequestInFlightRef.current || isDashboardPushOsPermissionRequestInFlight(),
          });
          if (cancelled) {
            if (decision.offer) setDashboardPushPrepromptVisible(false);
            return;
          }
          if (!decision.offer) {
            logDashboardPushPrepromptSuppressed(decision.reason, { stage: 'show' });
            return;
          }
          prepromptVisibleRef.current = true;
          setDashboardPushPrepromptVisible(true);
          setShowPushPermissionPrompt(true);
        })();
      }, 1500);
    })();

    return () => {
      cancelled = true;
      if (pushPromptTimerRef.current) {
        clearTimeout(pushPromptTimerRef.current);
        pushPromptTimerRef.current = null;
      }
    };
  }, [
    user?.id,
    onboardingComplete,
    pushPermissionStateHydrated,
    pushOsStatus,
    pushGranted,
    pushDenied,
    showPushPermissionPrompt,
  ]);

  useEffect(() => {
    prepromptVisibleRef.current = showPushPermissionPrompt;
    setDashboardPushPrepromptVisible(showPushPermissionPrompt);
    return () => {
      if (showPushPermissionPrompt) {
        prepromptVisibleRef.current = false;
        setDashboardPushPrepromptVisible(false);
      }
    };
  }, [showPushPermissionPrompt]);

  /** If preprompt is showing, cancel delayed timer so it cannot fire twice. */
  useEffect(() => {
    if (!showPushPermissionPrompt) return;
    if (pushPromptTimerRef.current) {
      clearTimeout(pushPromptTimerRef.current);
      pushPromptTimerRef.current = null;
    }
  }, [showPushPermissionPrompt]);

  /** usePushPermission refreshes on foreground; react to grant transitions for modal + prefs (no separate AppState listener). */
  useEffect(() => {
    if (pushGrantedBaselineRef.current === null) {
      pushGrantedBaselineRef.current = pushGranted;
      if (pushGranted) setShowPushPermissionPrompt(false);
      return;
    }
    const prev = pushGrantedBaselineRef.current;
    pushGrantedBaselineRef.current = pushGranted;
    if (!prev && pushGranted) {
      void qc.invalidateQueries({ queryKey: ['notification-preferences'] });
      if (user?.id) {
        if (__DEV__) pushPermDevLog('dashboard: OS became granted — silent backend sync');
        void syncNativePushDeliveryOnForeground(user.id, 'dashboard_grant_transition');
      }
    }
    if (pushGranted) setShowPushPermissionPrompt(false);
  }, [pushGranted, qc, user?.id]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      refetchNextEvent(),
      refetchEvents(),
      refetchMatches(),
      refetchActiveSession(),
      refetchHomeProfile(),
      refetchUnread(),
    ]);
    setRefreshing(false);
  }, [refetchNextEvent, refetchEvents, refetchMatches, refetchActiveSession, refetchHomeProfile, refetchUnread]);

  const handleNotificationPress = useCallback(() => {
    router.push('/settings/notifications');
  }, []);

  const handleCancelDeletion = useCallback(async () => {
    await cancelDeletion();
  }, [cancelDeletion]);

  const handleEndActiveSession = useCallback(async () => {
    if (!activeSession || !user?.id) return;
    if (activeSession.kind === 'syncing') return;
    if (activeSession.kind === 'video' && activeSession.queueStatus === 'in_survey') {
      return;
    }
    if (activeSession.kind === 'ready_gate') {
      await supabase.rpc('ready_gate_transition', {
        p_session_id: activeSession.sessionId,
        p_action: 'forfeit',
      });
    } else {
      await endVideoDate(activeSession.sessionId);
    }
    await updateParticipantStatus(activeSession.eventId, 'browsing');
    await refetchActiveSession();
  }, [activeSession, user?.id, refetchActiveSession]);

  const loading = nextEventLoading || eventsLoading || matchesLoading;
  const hasError = !loading && (!!eventsError || !!matchesError);
  const handleRetry = useCallback(() => {
    refetchNextEvent();
    refetchEvents();
    refetchMatches();
  }, [refetchNextEvent, refetchEvents, refetchMatches]);

  const newMatchCount = useMemo(() => matches.filter((m) => m.isNew).length, [matches]);
  const hasUpcomingDate = reminderSources.length > 0;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 320, useNativeDriver: true }).start();
  }, [fadeAnim]);

  const firstName =
    profile?.name?.trim().split(/\s+/)[0] ??
    (user?.user_metadata?.name as string | undefined)?.trim().split(/\s+/)[0] ??
    user?.email?.split('@')[0] ??
    'there';

  const getSubline = (): string | null => {
    if (isLiveEvent && isConfirmedForNextEvent && nextEvent) return "You're live tonight";
    if (isLiveEvent && isWaitlistedForNextEvent && nextEvent) return "Event is live — you're on the waitlist";
    if (nextEvent && hasEventAdmissionForNext && hoursUntilNext < 24) return 'Tonight looks promising';
    if (unreadMessageCount > 0)
      return `${unreadMessageCount} fresh conversation${unreadMessageCount > 1 ? 's' : ''}`;
    if (newMatchCount > 0) return 'Someone new vibed with you';
    if (nextEvent && hasEventAdmissionForNext) return 'Your next event is coming up';
    return null;
  };

  const subline = getSubline();

  const avatarUri = resolvePrimaryProfilePhotoPath({
    photos: profile?.photos,
    avatar_url: profile?.avatar_url,
  });

  function HeroBanner() {
    if (loading && !nextEvent) {
      return (
        <View style={[styles.heroCard, { borderColor: theme.glassBorder, backgroundColor: theme.glassSurface }]}>
          <EventCardSkeleton />
        </View>
      );
    }

    if (isLiveEvent && isConfirmedForNextEvent && nextEvent) {
      return (
        <View style={[styles.heroCard, { borderColor: theme.glassBorder }]}>
          <View style={[styles.heroCoverWrap, { height: 200 }]}>
            <Image source={{ uri: eventCoverUrl(nextEvent.image) }} style={styles.heroCover} resizeMode="cover" />
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.85)']}
              style={styles.heroGradient}
              locations={[0, 1]}
            />
            <View style={[styles.liveBadge, { backgroundColor: theme.dangerSoft, borderColor: theme.danger }]}>
              <PulsingLiveDot color={theme.danger} />
              <Text style={[styles.liveBadgeText, { color: theme.danger }]}>Live Now</Text>
            </View>
            <View style={styles.heroContentAbs}>
              <Text style={styles.heroTitle}>{nextEvent.title}</Text>
              <Text style={styles.heroSubtitle}>People vibing right now</Text>
            </View>
          </View>
          <View style={[styles.heroContent, { backgroundColor: 'rgba(0,0,0,0.35)' }]}>
            <VibelyButton
              label="Enter Lobby"
              variant="gradient"
              onPress={() => router.push(`/event/${nextEvent.id}/lobby` as const)}
              style={styles.ctaFull}
            />
          </View>
        </View>
      );
    }

    if (isLiveEvent && isWaitlistedForNextEvent && nextEvent) {
      return (
        <View style={[styles.heroCard, { borderColor: theme.glassBorder }]}>
          <View style={[styles.heroCoverWrap, { height: 180 }]}>
            <Image source={{ uri: eventCoverUrl(nextEvent.image) }} style={styles.heroCover} resizeMode="cover" />
            <LinearGradient colors={['transparent', 'rgba(0,0,0,0.85)']} style={styles.heroGradient} />
            <View style={[styles.liveBadge, { backgroundColor: theme.dangerSoft, borderColor: theme.danger }]}>
              <PulsingLiveDot color={theme.danger} />
              <Text style={[styles.liveBadgeText, { color: theme.danger }]}>Live Now</Text>
            </View>
            <View style={styles.heroContentAbs}>
              <Text style={styles.heroTitle}>{nextEvent.title}</Text>
              <Text style={styles.heroSubtitle}>You're on the paid waitlist</Text>
            </View>
          </View>
          <View style={[styles.heroContent, { backgroundColor: theme.secondary }]}>
            <VibelyButton
              label="View Event"
              variant="primary"
              onPress={() => router.push(`/events/${nextEvent.id}` as const)}
              style={styles.ctaFull}
            />
          </View>
        </View>
      );
    }

    if (nextEvent && hasEventAdmissionForNext && hoursUntilNext <= 24) {
      return (
        <View style={[styles.heroCard, { borderColor: theme.glassBorder }]}>
          <View style={[styles.heroCoverWrap, { height: 180 }]}>
            <Image source={{ uri: eventCoverUrl(nextEvent.image) }} style={styles.heroCover} resizeMode="cover" />
            <LinearGradient colors={['transparent', 'rgba(0,0,0,0.85)']} style={styles.heroGradient} />
            <View
              style={[
                styles.registeredBadge,
                { backgroundColor: withAlpha(theme.neonCyan, 0.2), borderColor: withAlpha(theme.neonCyan, 0.3) },
              ]}
            >
              <Text style={[styles.registeredText, { color: theme.neonCyan }]}>
                {isWaitlistedForNextEvent ? 'On waitlist' : '✓ Registered'}
              </Text>
            </View>
            <View style={styles.heroContentAbs}>
              <Text style={styles.heroTitle}>{nextEvent.title}</Text>
              <Text style={styles.heroSubtitle}>
                {nextEvent.date} · {nextEvent.time}
              </Text>
            </View>
          </View>
          <View style={[styles.heroContent, { backgroundColor: theme.secondary }]}>
            <View style={styles.countdownRow}>
              {[
                { value: countdown.days, label: 'DAYS' },
                { value: countdown.hours, label: 'HRS' },
                { value: countdown.minutes, label: 'MIN' },
                { value: countdown.seconds, label: 'SEC' },
              ].map((item, i) => (
                <View key={i} style={[styles.countdownBlock, { backgroundColor: theme.secondary }]}>
                  <Text style={[styles.countdownValue, { color: theme.tint }]}>{String(item.value).padStart(2, '0')}</Text>
                  <Text style={[styles.countdownLabel, { color: theme.mutedForeground }]}>{item.label}</Text>
                </View>
              ))}
            </View>
            <VibelyButton
              label="View Event"
              variant="primary"
              onPress={() => router.push(`/events/${nextEvent.id}` as const)}
              style={styles.ctaFull}
            />
          </View>
        </View>
      );
    }

    if (nextEvent && hasEventAdmissionForNext) {
      return (
        <View style={[styles.heroCard, { borderColor: theme.glassBorder }]}>
          <View style={[styles.heroCoverWrap, { height: 140 }]}>
            <Image source={{ uri: eventCoverUrl(nextEvent.image) }} style={styles.heroCover} resizeMode="cover" />
            <LinearGradient colors={['transparent', 'rgba(0,0,0,0.85)']} style={styles.heroGradient} />
            <View
              style={[
                styles.registeredBadge,
                { backgroundColor: withAlpha(theme.neonCyan, 0.2), borderColor: withAlpha(theme.neonCyan, 0.3) },
              ]}
            >
              <Text style={[styles.registeredText, { color: theme.neonCyan }]}>
                {isWaitlistedForNextEvent ? 'On waitlist' : '✓ Registered'}
              </Text>
            </View>
            <View style={styles.heroContentAbs}>
              <Text style={styles.heroTitle}>{nextEvent.title}</Text>
              <Text style={styles.heroSubtitle}>
                {nextEvent.date} · {nextEvent.time}
              </Text>
            </View>
          </View>
          <View style={[styles.heroContent, { backgroundColor: theme.secondary }]}>
            <VibelyButton
              label="View Event"
              variant="primary"
              size="sm"
              onPress={() => router.push(`/events/${nextEvent.id}` as const)}
              style={styles.ctaFull}
            />
          </View>
        </View>
      );
    }

    return (
      <View style={[styles.heroCard, { borderColor: theme.glassBorder, backgroundColor: theme.glassSurface }]}>
        <View style={[styles.heroEmptyInner, { paddingVertical: 28 }]}>
          <Ionicons name="sparkles" size={40} color={theme.tint} />
          <Text style={[styles.heroEmptyTitle, { color: theme.text, fontFamily: fonts.displayBold }]}>Find your next vibe</Text>
          <Text style={[styles.heroEmptySub, { color: theme.mutedForeground }]}>
            Join an event to meet amazing people live
          </Text>
          <VibelyButton
            label="Explore Events"
            variant="gradient"
            onPress={() => router.push('/events' as Href)}
            style={[styles.ctaFull, { marginTop: 16 }]}
          />
        </View>
      </View>
    );
  }

  function QuickActionsRail() {
    const actions: Array<{ icon: keyof typeof Ionicons.glyphMap; label: string; color: string; onPress: () => void }> = [];

    if (isLiveEvent && isConfirmedForNextEvent && nextEvent) {
      actions.push({
        icon: 'radio-outline',
        label: 'Lobby is live',
        color: theme.danger,
        onPress: () => router.push(`/event/${nextEvent.id}/lobby` as const),
      });
    }
    if (unreadMessageCount > 0) {
      actions.push({
        icon: 'chatbubble-outline',
        label: `${unreadMessageCount} unread`,
        color: theme.accent,
        onPress: () => router.push('/(tabs)/matches' as Href),
      });
    }
    if (dropReady) {
      actions.push({
        icon: 'water-outline',
        label: 'Daily Drop',
        color: theme.neonCyan,
        onPress: () => router.push('/(tabs)/matches' as Href),
      });
    }
    if (hasUpcomingDate) {
      actions.push({
        icon: 'videocam-outline',
        label: 'Date coming up',
        color: theme.neonPink,
        onPress: () => router.push('/schedule' as Href),
      });
    }
    if (!isProfileComplete) {
      actions.push({
        icon: 'person-add-outline',
        label: 'Complete profile',
        color: theme.tint,
        onPress: () => router.push('/profile' as Href),
      });
    }
    if (actions.length < 4) {
      actions.push({
        icon: 'search-outline',
        label: 'Browse events',
        color: theme.tint,
        onPress: () => router.push('/events' as Href),
      });
    }

    const visible = actions.slice(0, 4);
    if (visible.length === 0) return null;

    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 8 }}>
        {visible.map((a, i) => (
          <Pressable
            key={`${a.label}-${i}`}
            onPress={a.onPress}
            style={[styles.quickAction, { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder }]}
          >
            <View style={[styles.quickActionIcon, { backgroundColor: withAlpha(a.color, 0.15) }]}>
              <Ionicons name={a.icon} size={18} color={a.color} />
            </View>
            <Text style={[styles.quickActionLabel, { color: theme.text }]}>{a.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
    );
  }

  function ProfileReadiness() {
    return (
      <Pressable
        onPress={() => router.push('/profile' as Href)}
        style={[styles.readinessCard, { backgroundColor: withAlpha(theme.tint, 0.08), borderColor: withAlpha(theme.tint, 0.2) }]}
      >
        <View style={{ flex: 1 }}>
          <Text style={[styles.readinessTitle, { color: theme.text }]}>Be more discoverable tonight</Text>
          <Text style={[styles.readinessSub, { color: theme.mutedForeground }]}>
            {!hasPhotos ? 'Add photos for stronger first impressions' : !hasVibes ? 'Select your vibes for better matching' : 'Add more about yourself for stronger intros'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={theme.tint} />
      </Pressable>
    );
  }

  function AmbientPulse() {
    const eventCount = upcomingEvents.length;
    const hasConversations = unreadMessageCount > 0;
    const lines: string[] = [];
    if (eventCount > 0) lines.push(`${eventCount} event${eventCount > 1 ? 's' : ''} coming up this week`);
    if (hasConversations)
      lines.push(`${unreadMessageCount} conversation${unreadMessageCount > 1 ? 's' : ''} need your reply`);
    if (newMatchCount > 0) lines.push(`${newMatchCount} new connection${newMatchCount > 1 ? 's' : ''} this week`);
    if (lines.length === 0) return null;
    return (
      <View style={[styles.pulseStrip, { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder }]}>
        {lines.map((line, i) => (
          <View key={i} style={styles.pulseRow}>
            <View style={[styles.pulseDot, { backgroundColor: theme.tint }]} />
            <Text style={[styles.pulseText, { color: theme.mutedForeground }]}>{line}</Text>
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {sessionHydrated && activeSession && activeSession.kind !== 'syncing' && (
        <View style={[styles.rejoinBannerWrap, { paddingTop: insets.top + 4 }]}>
          <ActiveCallBanner
            sessionId={activeSession.sessionId}
            partnerName={activeSession.partnerName}
            mode={activeSession.kind === 'ready_gate' ? 'ready_gate' : 'video'}
            onRejoin={() => router.push(hrefForActiveSession(activeSession))}
            onEnd={activeSession.kind === 'video' && activeSession.queueStatus === 'in_survey' ? undefined : handleEndActiveSession}
          />
        </View>
      )}

      <GlassHeaderBar insets={insets}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={[styles.greetingSub, { color: theme.mutedForeground }]}>{getTimeGreeting()},</Text>
            <Text style={[styles.greetingName, { color: theme.text, fontFamily: fonts.displayBold }]}>{firstName}</Text>
            {subline ? <Text style={[styles.greetingContext, { color: theme.tint }]}>{subline}</Text> : null}
          </View>
          <View style={styles.headerRight}>
            {nextReminder && nextReminder.urgency !== 'none' && (
              <MiniDateCountdown reminder={nextReminder} onPress={() => router.push('/schedule' as Href)} />
            )}
            <Pressable
              onPress={handleNotificationPress}
              style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.8 }]}
              accessibilityLabel="Notifications"
            >
              <View style={styles.notifWrap}>
                <Ionicons name="notifications-outline" size={22} color={theme.text} />
                {unreadMessageCount > 0 ? (
                  <View style={[styles.notifDot, { backgroundColor: theme.accent }]} />
                ) : null}
              </View>
            </Pressable>
            <Pressable
              onPress={() => router.push('/profile' as Href)}
              style={({ pressed }) => [styles.avatarBtn, pressed && { opacity: 0.8 }]}
              accessibilityLabel="Profile"
            >
              {avatarUri ? (
                <Image
                  source={{ uri: getImageUrl(avatarUri, { width: 72, height: 72 }, 'avatar') }}
                  style={{ width: 36, height: 36, borderRadius: 18 }}
                />
              ) : (
                <Avatar size={36} fallbackInitials={user?.user_metadata?.name?.[0] ?? user?.email?.[0] ?? 'V'} />
              )}
            </Pressable>
          </View>
        </View>
      </GlassHeaderBar>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.tint} />}
      >
        <Animated.View style={[{ opacity: fadeAnim }, styles.scrollInner]}>
          <OnBreakBanner variant="full" />
          {(pendingDeletion || deletionStateError) && (
            <DeletionRecoveryBanner
              scheduledDate={pendingDeletion?.scheduled_deletion_at}
              onCancel={handleCancelDeletion}
              isCancelling={isCancelling}
              deletionStateError={deletionStateError}
              onRetryDeletionState={() => void refetchDeletionState()}
              onDismissDeletionStateError={clearDeletionStateError}
              cancelDeletionError={cancelDeletionError}
              onDismissCancelDeletionError={clearCancelDeletionError}
            />
          )}
          <PushPermissionPrompt
            visible={showPushPermissionPrompt}
            onClose={() => setShowPushPermissionPrompt(false)}
            userId={user?.id}
            onCompleted={() => {
              void refreshPushPermission('dashboard_prompt_completed');
            }}
          />

          {phoneNudgeChecked && showPhoneNudge && (
            <PhoneVerificationNudge
              variant="wizard"
              onDismiss={async () => {
                await AsyncStorage.setItem(PHONE_NUDGE_DISMISSED_KEY, 'true');
                setShowPhoneNudge(false);
              }}
              onVerify={() => setShowPhoneVerify(true)}
              onVerified={() => setShowPhoneNudge(false)}
            />
          )}

          {imminentReminders.length > 0 &&
            imminentReminders.map((reminder) => (
              <DateReminderCard
                key={reminder.id}
                reminder={reminder}
                onJoinDate={() => {
                  void handleDateJoinReminder(reminder);
                }}
                onEnableNotifications={() => router.push('/settings/notifications')}
                notificationsEnabled={pushGranted}
              />
            ))}

          {hasError && (
            <ErrorState
              message="We couldn't load your feed. Check your connection and try again."
              onActionPress={handleRetry}
            />
          )}

          <HeroBanner />
          <QuickActionsRail />

          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={[styles.sectionTitle, { color: theme.text, fontFamily: fonts.displayBold }]}>Your Matches</Text>
              <Pressable onPress={() => router.push('/(tabs)/matches' as Href)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={[styles.seeAll, { color: theme.tint }]}>See all</Text>
                <Ionicons name="chevron-forward" size={14} color={theme.tint} />
              </Pressable>
            </View>
            {loading ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.matchRow}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <MatchAvatarSkeleton key={i} />
                ))}
              </ScrollView>
            ) : matches.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.matchRow}>
                {matches.map((m) => (
                  <Pressable
                    key={m.matchId}
                    onPress={() => router.push(`/chat/${m.id}` as const)}
                    style={({ pressed }) => [styles.matchItem, pressed && { opacity: 0.8 }]}
                  >
                    {m.isNew ? (
                      <LinearGradient
                        colors={[gradient.primary[0], gradient.primary[1]]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.matchAvatarGradientRing}
                      >
                        <View style={[styles.matchAvatarInnerCutout, { backgroundColor: theme.background }]}>
                          <Avatar
                            size={56}
                            image={<Image source={{ uri: m.image }} style={styles.avatarImg56} />}
                            fallbackInitials={m.name?.[0]}
                          />
                        </View>
                      </LinearGradient>
                    ) : (
                      <View style={[styles.matchAvatarPlainRing, { borderColor: theme.border }]}>
                        <Avatar
                          size={56}
                          image={<Image source={{ uri: m.image }} style={styles.avatarImg56} />}
                          fallbackInitials={m.name?.[0]}
                        />
                      </View>
                    )}
                    <Text style={[styles.matchName, { color: theme.text }]} numberOfLines={1}>
                      {m.name?.split(' ')[0] ?? 'Match'}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : (
              <View style={styles.matchesEmpty}>
                <Text style={[styles.matchesEmptyText, { color: theme.mutedForeground }]}>
                  No matches yet. Join an event to start connecting!
                </Text>
                <VibelyButton
                  label="Browse Events"
                  variant="secondary"
                  size="sm"
                  onPress={() => router.push('/events' as Href)}
                />
              </View>
            )}
          </View>

          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={[styles.sectionTitle, { color: theme.text, fontFamily: fonts.displayBold }]}>{eventSectionTitle}</Text>
              <Pressable onPress={() => router.push('/events' as Href)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={[styles.seeAll, { color: theme.tint }]}>All events</Text>
                <Ionicons name="chevron-forward" size={14} color={theme.tint} />
              </Pressable>
            </View>
            {loading ? (
              <View style={styles.eventRail}>
                <DiscoverCardSkeleton />
                <DiscoverCardSkeleton />
              </View>
            ) : upcomingEvents.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.eventRail}>
                {upcomingEvents.slice(0, 5).map((event) => (
                  <Pressable
                    key={event.id}
                    onPress={() => router.push(`/events/${event.id}` as const)}
                    style={[
                      styles.eventHorizCard,
                      { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder, minWidth: 260 },
                      shadows.card,
                    ]}
                  >
                    <Image
                      source={{ uri: eventCoverUrl(event.image) }}
                      style={styles.eventHorizCover}
                      resizeMode="cover"
                    />
                    <View style={[styles.eventHorizBody, { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder }]}>
                      <Text style={[styles.eventHorizTitle, { color: theme.text, fontFamily: fonts.displayBold }]} numberOfLines={1}>
                        {event.title}
                      </Text>
                      <Text style={[styles.eventHorizDate, { color: theme.mutedForeground }]}>
                        {event.date} · {event.time}
                        {event.status === 'ended' ? (
                          <Text style={{ color: '#fbbf24', fontWeight: '700', fontSize: 10 }}> · ENDED</Text>
                        ) : null}
                      </Text>
                      <View style={styles.discoverAttendeesRow}>
                        <Ionicons name="people-outline" size={14} color={theme.mutedForeground} />
                        <Text style={[styles.discoverAttendees, { color: theme.mutedForeground }]}>
                          {event.attendees} attending
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            ) : (
              <View style={[styles.upcomingEmpty, { borderColor: theme.border }]}>
                <Text style={[styles.upcomingEmptyText, { color: theme.mutedForeground }]}>No upcoming events</Text>
                <Pressable onPress={() => router.push('/events' as Href)} style={styles.upcomingEmptyLink}>
                  <Text style={[styles.upcomingEmptyLinkText, { color: theme.tint }]}>Browse Events</Text>
                  <Ionicons name="chevron-forward" size={14} color={theme.tint} />
                </Pressable>
              </View>
            )}
          </View>

          {!isProfileComplete && <ProfileReadiness />}
          <AmbientPulse />

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
                    {otherCities.reduce((sum: number, c: OtherCityEvent) => sum + Number(c.event_count), 0)} events in{' '}
                    {otherCities.length} {otherCities.length === 1 ? 'city' : 'cities'}
                  </Text>
                  <Text style={[styles.otherCitiesSub, { color: theme.textSecondary }]}>
                    {(otherCities as OtherCityEvent[])
                      .slice(0, 3)
                      .map((c: OtherCityEvent) => c.city)
                      .join(' · ')}
                    {otherCities.length > 3 ? ` + ${otherCities.length - 3} more` : ''}
                  </Text>
                </View>
                <Pressable
                  onPress={() => router.push('/events' as Href)}
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
        </Animated.View>
      </ScrollView>

      <PhoneVerificationFlow
        visible={showPhoneVerify}
        onClose={() => setShowPhoneVerify(false)}
        initialPhoneE164={initialPhoneE164}
        onVerified={() => {
          void refreshPhoneNudgeStatus();
          setShowPhoneVerify(false);
        }}
      />
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
  headerLeft: { flex: 1, marginRight: spacing.sm },
  greetingSub: { fontSize: 14 },
  greetingName: { fontSize: 22, fontWeight: '700' },
  greetingContext: { fontSize: 13, marginTop: 2 },
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
  scroll: { flex: 1 },
  scrollContent: { paddingTop: 8, paddingBottom: 120 },
  scrollInner: {
    paddingHorizontal: layout.containerPadding,
    gap: 24,
    maxWidth: layout.contentWidth,
    width: '100%',
    alignSelf: 'center',
    paddingBottom: spacing.md,
  },
  heroCard: {
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
  },
  heroCoverWrap: { position: 'relative', width: '100%' },
  heroCover: { width: '100%', height: '100%', resizeMode: 'cover' },
  heroGradient: {
    ...StyleSheet.absoluteFillObject,
    top: '40%',
  },
  heroContent: { padding: 16, gap: 6 },
  heroContentAbs: { position: 'absolute', left: 16, right: 16, bottom: 16, gap: 6 },
  heroTitle: {
    fontSize: 20,
    fontWeight: '700',
    fontFamily: fonts.displayBold,
    color: '#FFFFFF',
  },
  heroSubtitle: { fontSize: 14, color: 'rgba(255,255,255,0.7)' },
  heroEmptyInner: { alignItems: 'center', paddingHorizontal: 20 },
  heroEmptyTitle: { fontSize: 20, marginTop: 12, textAlign: 'center' },
  heroEmptySub: { fontSize: 14, marginTop: 8, textAlign: 'center' },
  quickAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1,
  },
  quickActionIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionLabel: { fontSize: 13, fontWeight: '600' },
  sectionTitle: { fontSize: 18, fontWeight: '700' },
  seeAll: { fontSize: 14, fontWeight: '500' },
  matchRow: { flexDirection: 'row', gap: 16, paddingVertical: spacing.sm, paddingRight: spacing.lg },
  matchItem: { alignItems: 'center', gap: spacing.sm, minWidth: 64 },
  matchAvatarGradientRing: { borderRadius: 999, padding: 2, alignSelf: 'center' },
  matchAvatarInnerCutout: {
    borderRadius: 999,
    padding: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  matchAvatarPlainRing: { borderRadius: 999, borderWidth: 1, padding: 2, alignSelf: 'center' },
  avatarImg56: { width: '100%', height: '100%', borderRadius: 999 },
  matchName: { fontWeight: '600', fontSize: 12, maxWidth: 64, textAlign: 'center' },
  matchesEmpty: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg },
  matchesEmptyText: { fontSize: 14, textAlign: 'center' },
  eventRail: { flexDirection: 'row', gap: spacing.md + 2, paddingBottom: spacing.sm },
  eventHorizCard: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    marginRight: 4,
  },
  eventHorizCover: {
    width: '100%',
    height: 140,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  eventHorizBody: {
    padding: 12,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    borderTopWidth: 0,
    gap: 4,
  },
  eventHorizTitle: { fontSize: 16, fontWeight: '600' },
  eventHorizDate: { fontSize: 13 },
  discoverAttendeesRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  discoverAttendees: { fontSize: 12 },
  readinessCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
  },
  readinessTitle: { fontSize: 15, fontWeight: '600' },
  readinessSub: { fontSize: 13, marginTop: 2 },
  pulseStrip: { padding: 14, borderRadius: 16, borderWidth: 1, gap: 8 },
  pulseRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pulseDot: { width: 5, height: 5, borderRadius: 3 },
  pulseText: { fontSize: 13, flex: 1 },
  otherCitiesCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  otherCitiesRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  otherCitiesEmoji: { fontSize: 28 },
  otherCitiesCopy: { flex: 1, minWidth: 0 },
  otherCitiesTitle: { fontSize: 15, fontWeight: '700' },
  otherCitiesSub: { fontSize: 13, marginTop: 4 },
  otherCitiesCta: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  otherCitiesCtaText: { fontSize: 13, fontWeight: '600' },
  registeredBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
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
  countdownRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  countdownBlock: {
    width: 56,
    height: 56,
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownValue: { fontSize: 20, fontWeight: '700' },
  countdownLabel: { fontSize: 10, marginTop: 2, letterSpacing: 0.5 },
  ctaFull: { alignSelf: 'stretch' },
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
});
