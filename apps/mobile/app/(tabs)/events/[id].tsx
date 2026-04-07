import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, router } from 'expo-router';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  View,
  Text,
  Dimensions,
  Linking,
  Alert,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Colors from '@/constants/Colors';
import { GlassHeaderBar, Card, LoadingState, ErrorState, VibelyButton } from '@/components/ui';
import { spacing, radius, typography, layout } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import { useEntitlements } from '@/hooks/useEntitlements';
import { getLanguageLabel } from '@/lib/eventLanguages';
import {
  useEventDetails,
  useIsRegisteredForEvent,
  useRegisterForEvent,
  useEventAttendeePreview,
  useEventVibesSent,
  useEventVibesReceived,
  sendEventVibe,
  type EventDetailsRow,
  type EventVibeMutual,
} from '@/lib/eventsApi';
import { eventCoverUrl, avatarUrl } from '@/lib/imageUrl';
import { InviteFriendsSheet } from '@/components/invite/InviteFriendsSheet';
import { VenueCard } from '@/components/events/VenueCard';
import { PricingBar } from '@/components/events/PricingBar';
import { ManageBookingModal } from '@/components/events/ManageBookingModal';
import { WhosGoingSection, type AttendeeDisplay } from '@/components/events/WhosGoingSection';
import { MutualVibesSection } from '@/components/events/MutualVibesSection';
import { TicketStub } from '@/components/events/TicketStub';
import { supabase } from '@/lib/supabase';
import { trackEvent } from '@/lib/analytics';
import { format } from 'date-fns';
import { useVibelyDialog } from '@/components/VibelyDialog';
import { useAccountPauseStatus } from '@/hooks/useAccountPauseStatus';
import { endAccountBreakForUser } from '@/lib/endAccountBreak';
import { FLOATING_TAB_BAR_HEIGHT } from '@/constants/tabBarMetrics';
import { withAlpha } from '@/lib/colorUtils';
import { deriveEventPhase } from '@/lib/eventPhase';
import { PhoneVerificationNudge } from '@/components/PhoneVerificationNudge';
import { PhoneVerificationFlow } from '@/components/verification/PhoneVerificationFlow';
import { openPremium } from '@/lib/premiumNavigation';
import { PREMIUM_ENTRY_SURFACE } from '@shared/premiumFunnel';

/** Same key as web `EventDetails` (`vibely_phone_nudge_event_dismissed`) for product-consistent dismiss semantics. */
const EVENT_PHONE_NUDGE_DISMISSED_KEY = 'vibely_phone_nudge_event_dismissed';

export default function EventDetailScreen() {
  // === ALL HOOKS — must run before any conditional return (Rules of Hooks) ===
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { canAccessPremiumEvents, canAccessVipEvents } = useEntitlements();
  const { data: event, isLoading, error } = useEventDetails(id ?? undefined);
  const { data: regSnapshot, refetch: refetchRegistration, isLoading: regLoading } = useIsRegisteredForEvent(id ?? undefined, user?.id);
  const isConfirmed = regSnapshot?.isConfirmed ?? false;
  const isWaitlisted = regSnapshot?.isWaitlisted ?? false;
  const hasAdmission = isConfirmed || isWaitlisted;
  const { registerForEvent, unregisterFromEvent, isRegistering, isUnregistering } = useRegisterForEvent();
  const [userGender, setUserGender] = useState<string>('male');
  const [showManageBooking, setShowManageBooking] = useState(false);
  const [showTicket, setShowTicket] = useState(false);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [showFullDesc, setShowFullDesc] = useState(false);
  const [showInviteSheet, setShowInviteSheet] = useState(false);
  const [phaseClockMs, setPhaseClockMs] = useState(() => Date.now());
  const { show: showDialog, dialog: dialogEl } = useVibelyDialog();
  const { isPaused } = useAccountPauseStatus();
  const [showEventPhoneNudge, setShowEventPhoneNudge] = useState(false);
  const [showEventPhoneVerify, setShowEventPhoneVerify] = useState(false);
  const [eventPhoneInitialE164, setEventPhoneInitialE164] = useState<string | null>(null);

  const { data: attendeePreview, isLoading: attendeePreviewLoading } = useEventAttendeePreview(id ?? undefined);
  const { data: sentVibeIds = [], refetch: refetchSentVibes } = useEventVibesSent(id ?? undefined, user?.id);
  const { data: receivedVibes = [], refetch: refetchReceivedVibes } = useEventVibesReceived(id ?? undefined, user?.id);

  useEffect(() => {
    if (!id || !event) return;
    trackEvent('event_viewed', { event_id: id, event_title: event.title ?? '' });
  }, [id, event?.id]);

  const mutualVibes: EventVibeMutual[] = receivedVibes
    .filter((r) => sentVibeIds.includes(r.sender_id))
    .map((r) => ({
      id: r.sender_id,
      name: r.sender?.name ?? 'Unknown',
      avatar: r.sender?.avatar_url ? avatarUrl(r.sender.avatar_url) : null,
      age: r.sender?.age ?? 0,
    }));

  const hasSentVibe = (profileId: string) => sentVibeIds.includes(profileId);

  const handleAttendeePress = useCallback(
    (attendee: AttendeeDisplay) => {
      if (!user?.id || !id) return;
      const viewProfile = () => router.push(`/user/${attendee.id}` as const);
      if (hasSentVibe(attendee.id)) {
        showDialog({
          title: 'Already vibed',
          message: `You already sent ${attendee.name} a vibe.`,
          variant: 'info',
          primaryAction: { label: 'View profile', onPress: viewProfile },
          secondaryAction: { label: 'Close', onPress: () => {} },
        });
        return;
      }
      showDialog({
        title: attendee.name,
        message: `Send a vibe or peek at ${attendee.name}'s profile first.`,
        variant: 'info',
        primaryAction: {
          label: 'Send vibe',
          onPress: () => {
            void (async () => {
              const { ok, error } = await sendEventVibe(id, user.id, attendee.id);
              if (ok) {
                refetchSentVibes();
                refetchReceivedVibes();
                showDialog({
                  title: 'Vibe sent!',
                  message: "They'll see your interest before the event.",
                  variant: 'success',
                  primaryAction: { label: 'Love it', onPress: () => {} },
                });
              } else {
                showDialog({
                  title: 'Couldn’t send vibe',
                  message: error ?? 'Try again.',
                  variant: 'warning',
                  primaryAction: { label: 'OK', onPress: () => {} },
                });
              }
            })();
          },
        },
        secondaryAction: { label: 'View profile', onPress: viewProfile },
      });
    },
    [user?.id, id, sentVibeIds, refetchSentVibes, refetchReceivedVibes, showDialog, router]
  );

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const { data } = await supabase.from('profiles').select('gender').eq('id', user.id).maybeSingle();
      if (data?.gender) setUserGender(String(data.gender).toLowerCase());
    })();
  }, [user?.id]);

  const refreshEventPhoneNudgeStatus = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from('profiles')
      .select('phone_verified, phone_number')
      .eq('id', user.id)
      .maybeSingle();
    const verified = (data as { phone_verified?: boolean } | null)?.phone_verified === true;
    setEventPhoneInitialE164((data as { phone_number?: string | null } | null)?.phone_number ?? null);
    setShowEventPhoneNudge(!verified);
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setShowEventPhoneNudge(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const dismissed = await AsyncStorage.getItem(EVENT_PHONE_NUDGE_DISMISSED_KEY);
      if (dismissed === 'true') return;
      const { data } = await supabase
        .from('profiles')
        .select('phone_verified, phone_number')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled) return;
      const verified = (data as { phone_verified?: boolean } | null)?.phone_verified === true;
      setEventPhoneInitialE164((data as { phone_number?: string | null } | null)?.phone_number ?? null);
      setShowEventPhoneNudge(!verified);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!event?.id) return;
    const timer = setInterval(() => setPhaseClockMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [event?.id]);

  // Derived values for callbacks (event may be undefined until loaded)
  const ev = event as EventDetailsRow | undefined;
  const isFree = ev?.is_free !== false;
  const priceAmount = ev?.price_amount ?? 0;
  const isFemale = userGender === 'female' || userGender === 'woman';
  const userPrice = !event || isFree ? 0 : (isFemale ? priceAmount * 0.6 : priceAmount);

  const performRegisterCore = useCallback(async () => {
    if (!event) return;
    if ((event as EventDetailsRow).status === 'cancelled') {
      showDialog({
        title: 'This event was cancelled',
        message: 'Registration and lobby access are closed.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
      return;
    }
    const vis = (event as EventDetailsRow).visibility;
    if (vis === 'premium' && !canAccessPremiumEvents) {
      trackEvent('premium_entry_tapped', {
        entry_surface: PREMIUM_ENTRY_SURFACE.PREMIUM_EVENT_REGISTER,
        feature: 'canAccessPremiumEvents',
        source_context: event.id,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
      });
      showDialog({
        title: 'Premium only',
        message: 'This event is for Premium members. Upgrade to join.',
        variant: 'info',
        primaryAction: {
          label: 'View Premium',
          onPress: () =>
            openPremium(router.push, {
              entry_surface: PREMIUM_ENTRY_SURFACE.PREMIUM_EVENT_REGISTER,
              feature: 'canAccessPremiumEvents',
              source_context: event.id,
              recordEntryTapped: false,
            }),
        },
        secondaryAction: { label: 'Not now', onPress: () => {} },
      });
      return;
    }
    if (vis === 'vip' && !canAccessVipEvents) {
      trackEvent('premium_entry_tapped', {
        entry_surface: PREMIUM_ENTRY_SURFACE.VIP_EVENT_REGISTER,
        feature: 'canAccessVipEvents',
        source_context: event.id,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
      });
      showDialog({
        title: 'VIP only',
        message: 'This event is for VIP members. Upgrade to unlock access.',
        variant: 'info',
        primaryAction: {
          label: 'View Premium',
          onPress: () =>
            openPremium(router.push, {
              entry_surface: PREMIUM_ENTRY_SURFACE.VIP_EVENT_REGISTER,
              feature: 'canAccessVipEvents',
              source_context: event.id,
              recordEntryTapped: false,
            }),
        },
        secondaryAction: { label: 'Not now', onPress: () => {} },
      });
      return;
    }
    const ok = await registerForEvent(event.id);
    if (ok) {
      const { data: regSnap } = await refetchRegistration();
      const evRow = event as EventDetailsRow;
      const registrationIsVirtual = !evRow.is_location_specific;
      if (regSnap?.isWaitlisted) {
        showDialog({
          title: 'You’re on the waitlist',
          message:
            'The event was full when you joined — we’ll confirm you if a spot opens. Check this page for your status.',
          variant: 'success',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
      } else if (regSnap?.isConfirmed) {
        showDialog({
          title: 'You’re in!',
          message: registrationIsVirtual
            ? 'Your spot is confirmed. You’ll be able to join when the event goes live.'
            : 'Your spot is confirmed. Check your email for details.',
          variant: 'success',
          primaryAction: { label: 'Great', onPress: () => {} },
        });
      } else {
        showDialog({
          title: 'Registration received',
          message: 'Hang tight while we sync your booking on this page.',
          variant: 'success',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
      }
    } else {
      showDialog({
        title: 'Couldn’t register',
        message: 'Check your connection and try again.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    }
  }, [
    event,
    ev?.is_free,
    registerForEvent,
    refetchRegistration,
    canAccessPremiumEvents,
    canAccessVipEvents,
    showDialog,
    router,
  ]);

  const handleRegister = useCallback(async () => {
    if (!event) return;
    if (isPaused && user?.id) {
      Alert.alert(
        "You're on a break",
        'End your break to register for events. Your break settings are in Account & Security.',
        [
          { text: 'Stay on break', style: 'cancel' },
          {
            text: 'End break & register',
            onPress: () => {
              void (async () => {
                const { error } = await endAccountBreakForUser(user.id);
                if (error) {
                  showDialog({
                    title: 'Couldn’t update',
                    message: error.message,
                    variant: 'warning',
                    primaryAction: { label: 'OK', onPress: () => {} },
                  });
                  return;
                }
                await queryClient.invalidateQueries({ queryKey: ['account-pause-status'] });
                await queryClient.invalidateQueries({ queryKey: ['my-profile'] });
                await performRegisterCore();
              })();
            },
          },
        ]
      );
      return;
    }
    await performRegisterCore();
  }, [event, isPaused, user?.id, queryClient, showDialog, performRegisterCore]);

  const handlePurchase = useCallback(async () => {
    if (!event) return;
    if ((event as EventDetailsRow).status === 'cancelled') {
      showDialog({
        title: 'This event was cancelled',
        message: "You can't purchase or register for this event anymore.",
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
      return;
    }
    const endMs = new Date(event.event_date).getTime() + (event.duration_minutes ?? 60) * 60 * 1000;
    if (Date.now() > endMs) return;
    const maxMen = (event as EventDetailsRow).max_male_attendees ?? Math.floor(((event as EventDetailsRow).max_attendees ?? 50) / 2);
    const maxWomen = (event as EventDetailsRow).max_female_attendees ?? Math.ceil(((event as EventDetailsRow).max_attendees ?? 50) / 2);
    const currentMen = Math.floor((event.current_attendees ?? 0) / 2);
    const currentWomen = Math.ceil((event.current_attendees ?? 0) / 2);
    const spots = userGender === 'female' || userGender === 'woman' ? maxWomen - currentWomen : maxMen - currentMen;
    if (spots <= 0) return;
    if (hasAdmission) return;
    if (isPurchasing || isRegistering) return;
    if (isFree || userPrice === 0) {
      await handleRegister();
      return;
    }
    setIsPurchasing(true);
    try {
      const { data: authData } = await supabase.auth.getSession();
      if (!authData?.session) {
        showDialog({
          title: 'Sign in required',
          message: 'Please sign in to continue to checkout.',
          variant: 'info',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
        return;
      }
      const { data: checkout, error: checkoutError } = await supabase.functions.invoke('create-event-checkout', {
        body: { eventId: event.id, eventTitle: event.title, price: userPrice, currency: 'eur' },
      });
      const result = checkout as { success?: boolean; url?: string; error?: string } | null;
      if (checkoutError || !result?.success) {
        showDialog({
          title: 'Payment didn’t go through',
          message: result?.error ?? 'Payment failed. Try again.',
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
        return;
      }
      if (result?.url) await Linking.openURL(result.url);
    } finally {
      setIsPurchasing(false);
    }
  }, [event, isFree, userPrice, userGender, hasAdmission, isPurchasing, isRegistering, handleRegister, showDialog]);

  const handleUnregister = useCallback(async () => {
    if (!event) return;
    const wasConfirmed = isConfirmed;
    const wasWaitlisted = isWaitlisted;
    const ok = await unregisterFromEvent(event.id);
    if (ok) {
      refetchRegistration();
      queryClient.invalidateQueries({ queryKey: ['event-registration-check'] });
      queryClient.invalidateQueries({ queryKey: ['event-details', id] });
      queryClient.invalidateQueries({ queryKey: ['event-attendee-preview', id] });
      setShowManageBooking(false);
      if (wasWaitlisted) {
        showDialog({
          title: 'Left the waitlist',
          message: 'You’re no longer on the waitlist for this event.',
          variant: 'success',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
      } else if (wasConfirmed) {
        showDialog({
          title: 'Spot released',
          message:
            'Your confirmed seat is cancelled for this event. If a waitlist is in use, the next person may be offered the seat according to usual rules.',
          variant: 'success',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
      } else {
        showDialog({
          title: 'Booking updated',
          message: 'Your registration for this event has been removed.',
          variant: 'success',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
      }
    } else {
      showDialog({
        title: 'Couldn’t cancel',
        message: 'Check your connection and try again.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    }
  }, [
    event,
    isConfirmed,
    isWaitlisted,
    unregisterFromEvent,
    refetchRegistration,
    queryClient,
    id,
    showDialog,
  ]);

  const openCancelConfirm = useCallback(() => {
    if (!event) return;
    setShowManageBooking(false);
    const refundNote =
      'Refunds aren’t handled in this app. Check your payment confirmation or reach out to support if you think you’re eligible for one.';
    if (isWaitlisted) {
      showDialog({
        title: 'Leave the waitlist?',
        message: `You’ll leave the paid waitlist for ${event.title}. You can join again later if the event still has capacity.\n\n${refundNote}`,
        variant: 'destructive',
        primaryAction: { label: 'Leave waitlist', onPress: () => void handleUnregister() },
        secondaryAction: { label: 'Stay on waitlist', onPress: () => {} },
      });
    } else {
      showDialog({
        title: 'Release your spot?',
        message: `You’re about to release your confirmed spot for ${event.title}. If this event uses a waitlist, the next person may be offered your seat according to Vibely’s usual rules.\n\n${refundNote}`,
        variant: 'destructive',
        primaryAction: { label: 'Release spot', onPress: () => void handleUnregister() },
        secondaryAction: { label: 'Keep my spot', onPress: () => {} },
      });
    }
  }, [event, isWaitlisted, handleUnregister, showDialog]);

  /** Web `EventDetails` parity: next occurrence in same recurring series (`parent_event_id`). */
  const parentEventIdForSeries = event?.parent_event_id ?? null;
  const currentEventDateIso = event?.event_date;
  const { data: nextInSeries } = useQuery({
    queryKey: ['next-in-series', parentEventIdForSeries, id, currentEventDateIso],
    enabled: !!parentEventIdForSeries && !!currentEventDateIso && !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('events')
        .select('id, event_date, occurrence_number')
        .eq('parent_event_id', parentEventIdForSeries!)
        .gt('event_date', currentEventDateIso!)
        .is('archived_at', null)
        .order('event_date', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; event_date: string; occurrence_number?: number | null } | null;
    },
  });

  // Conditional returns — after ALL hooks
  if ((isLoading && !event) || (user?.id && regLoading)) {
    return (
      <>
        <View style={[styles.centered, { backgroundColor: theme.background }]}>
          <LoadingState title="Loading event…" message="Just a sec…" />
        </View>
        {dialogEl}
      </>
    );
  }

  if (error || !event) {
    return (
      <>
        <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <ErrorState
          title="Event not found"
          message="This event may have been removed or doesn't exist."
          actionLabel="Back to Events"
          onActionPress={() => router.push('/(tabs)/events')}
        />
        </View>
        {dialogEl}
      </>
    );
  }

  const eventRow = event as EventDetailsRow;
  const isCancelled = eventRow.status === 'cancelled';
  const eventDate = new Date(event.event_date);
  const dateStr = format(eventDate, 'EEEE, MMMM d');
  const timeStr = format(eventDate, 'h:mm a');
  const isVirtual = !eventRow.is_location_specific;
  const maxMen = eventRow.max_male_attendees ?? Math.floor((eventRow.max_attendees ?? 50) / 2);
  const maxWomen = eventRow.max_female_attendees ?? Math.ceil((eventRow.max_attendees ?? 50) / 2);
  const currentMen = Math.floor((event.current_attendees ?? 0) / 2);
  const currentWomen = Math.ceil((event.current_attendees ?? 0) / 2);
  const spotsLeft = isFemale ? maxWomen - currentWomen : maxMen - currentMen;
  const soldOut = spotsLeft <= 0;
  const capacityStatus: 'available' | 'filling' | 'almostFull' =
    spotsLeft <= 2 ? 'almostFull' : spotsLeft <= 5 ? 'filling' : 'available';
  const genderLabel = isFemale ? 'Female' : 'Male';
  const durationMin = event.duration_minutes ?? 60;
  const eventPhase = deriveEventPhase({
    eventDate,
    eventDurationMinutes: durationMin,
    nowMs: phaseClockMs,
  });
  const eventEnded = eventPhase.isEnded;
  const eventLive = eventPhase.isLive;
  const descText = event.description?.trim() ?? '';

  const tags = (event as { tags?: string[] | null }).tags ?? [];
  const coverHeight = Math.min(280, Dimensions.get('window').height * 0.4);
  const goingCount = event.current_attendees ?? 0;
  const ticketNumber = `VBL-${event.id.slice(0, 8).toUpperCase()}`;
  const floatingTabBarObstruction = FLOATING_TAB_BAR_HEIGHT + Math.max(insets.bottom, 8);
  const pricingBarBottomInset = floatingTabBarObstruction + spacing.xs;
  const pricingBarReserveSpace = 124 + pricingBarBottomInset;

  const previewOk = attendeePreview?.success === true;
  const revealedDisplays: AttendeeDisplay[] =
    previewOk && isConfirmed
      ? attendeePreview.revealed.map((r) => ({
          id: r.id,
          name: r.name,
          avatarUrl: avatarUrl(r.avatar_path),
        }))
      : [];

  const totalOtherConfirmedFallback = Math.max(0, (event.current_attendees ?? 0) - (isConfirmed ? 1 : 0));
  const teaserTotalOthers =
    previewOk && user?.id
      ? attendeePreview.total_other_confirmed
      : hasAdmission
        ? totalOtherConfirmedFallback
        : event.current_attendees ?? 0;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {dialogEl}
      <GlassHeaderBar insets={insets} style={styles.headerBar}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]}
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>
          {event.title}
        </Text>
      </GlassHeaderBar>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom:
              isCancelled && hasAdmission
                ? Math.max(layout.scrollContentPaddingBottomTab, 100 + floatingTabBarObstruction)
                : !hasAdmission
                  ? Math.max(layout.scrollContentPaddingBottomTab, pricingBarReserveSpace)
                  : layout.scrollContentPaddingBottomTab,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.coverWrap, { height: coverHeight }]}>
          <Image
            source={{ uri: eventCoverUrl(event.cover_image) }}
            style={[styles.cover, { backgroundColor: theme.surfaceSubtle }]}
          />
          <View style={[styles.coverGradient, { height: coverHeight * 0.5 }]} />
        </View>
        <Card variant="glass" style={styles.infoCard}>
          <Text style={[styles.title, { color: theme.text }]}>{event.title}</Text>
          <View style={styles.dateTimeRow}>
            <Ionicons name="calendar-outline" size={18} color={theme.textSecondary} />
            <Text style={[styles.meta, { color: theme.textSecondary }]}>{dateStr}</Text>
          </View>
          <View style={styles.dateTimeRow}>
            <Ionicons name="time-outline" size={18} color={theme.textSecondary} />
            <Text style={[styles.meta, { color: theme.textSecondary }]}>{timeStr}</Text>
          </View>
          <View style={[styles.eventInfoRow, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.eventInfoText, { color: theme.textSecondary }]}>
              {durationMin} min · {goingCount} going
            </Text>
          </View>
          {eventRow.location_name ? (
            <View style={styles.venueRow}>
              <Ionicons name="location-outline" size={18} color={theme.textSecondary} />
              <Text style={[styles.venueText, { color: theme.textSecondary }]}>
                {eventRow.location_name}
              </Text>
            </View>
          ) : null}
          {(() => {
            const lang = getLanguageLabel(eventRow.language);
            return lang ? (
              <View style={styles.venueRow}>
                <Ionicons name="language-outline" size={18} color={theme.textSecondary} />
                <Text style={[styles.venueText, { color: theme.textSecondary }]}>
                  {lang.flag} {lang.label}
                </Text>
              </View>
            ) : null;
          })()}
          {eventRow.parent_event_id ? (
            <View
              style={[
                styles.recurringSeriesRow,
                {
                  backgroundColor: withAlpha(theme.muted, 0.35),
                  borderColor: theme.border,
                },
              ]}
            >
              <Ionicons name="refresh-outline" size={16} color={theme.textSecondary} />
              <Text style={[styles.recurringSeriesLabel, { color: theme.textSecondary }]}>
                Part of a recurring series
              </Text>
              {nextInSeries ? (
                <>
                  <Text style={[styles.recurringSeriesDot, { color: theme.textSecondary }]}>·</Text>
                  <Pressable
                    onPress={() => router.push(`/events/${nextInSeries.id}` as const)}
                    accessibilityRole="link"
                    accessibilityLabel={`Next in series ${format(new Date(nextInSeries.event_date), 'MMM d')}`}
                  >
                    <Text style={[styles.recurringSeriesNext, { color: theme.tint }]}>
                      Next: {format(new Date(nextInSeries.event_date), 'MMM d')}
                    </Text>
                  </Pressable>
                </>
              ) : null}
            </View>
          ) : null}
          {tags.length > 0 && (
            <View style={styles.tagsRow}>
              {tags.slice(0, 5).map((tag) => (
                <View key={tag} style={[styles.tag, { backgroundColor: theme.tintSoft, borderColor: theme.tint }]}>
                  <Text style={[styles.tagText, { color: theme.tint }]}>{tag}</Text>
                </View>
              ))}
            </View>
          )}
          {/* Vibe match — wire when backend provides score (e.g. event deck / registration RPC) */}
          <Text style={[styles.sectionTitle, { color: theme.text }]}>About This Event</Text>
          {descText.length > 0 ? (
            <>
              {/* Read more / Show less when description > 150 chars (web parity) */}
              <Text
                style={[styles.description, { color: theme.textSecondary }]}
                numberOfLines={showFullDesc ? undefined : 3}
              >
                {descText}
              </Text>
              {descText.length > 150 ? (
                <Pressable onPress={() => setShowFullDesc(!showFullDesc)} style={{ marginTop: 4 }}>
                  <Text style={{ color: theme.tint, fontSize: 14, fontWeight: '600' }}>
                    {showFullDesc ? 'Show less' : 'Read more'}
                  </Text>
                </Pressable>
              ) : null}
            </>
          ) : (
            <Text style={[styles.description, { color: theme.textSecondary }]}>
              Join us for an exciting video speed dating event! Meet new people in a fun, safe environment.
            </Text>
          )}
        </Card>

        {isCancelled ? (
          <View
            style={[
              styles.cancelledBanner,
              { backgroundColor: withAlpha(theme.danger, 0.12), borderColor: withAlpha(theme.danger, 0.4) },
            ]}
          >
            <Text style={[styles.cancelledBannerTitle, { color: theme.danger }]}>This event was cancelled</Text>
            <Text style={[styles.cancelledBannerBody, { color: theme.textSecondary }]}>
              You can still open this page to manage an existing booking if you registered—registration and lobby access are
              closed.
            </Text>
          </View>
        ) : null}

        {showEventPhoneNudge && !hasAdmission && !isCancelled ? (
          <View style={{ marginBottom: spacing.lg }}>
            <PhoneVerificationNudge
              variant="event"
              onDismiss={async () => {
                await AsyncStorage.setItem(EVENT_PHONE_NUDGE_DISMISSED_KEY, 'true');
                setShowEventPhoneNudge(false);
              }}
              onVerify={() => setShowEventPhoneVerify(true)}
              onVerified={() => {
                void refreshEventPhoneNudgeStatus();
                setShowEventPhoneVerify(false);
              }}
            />
          </View>
        ) : null}

        <Pressable
          onPress={() => setShowInviteSheet(true)}
          style={({ pressed }) => [styles.inviteFriendsBtn, { opacity: pressed ? 0.85 : 1 }]}
        >
          <Ionicons name="people-outline" size={18} color="#8B5CF6" />
          <Text style={styles.inviteFriendsBtnText}>Invite friends to this event</Text>
        </Pressable>

        {isConfirmed ? (
          <WhosGoingSection
            mode="preview"
            revealed={previewOk ? revealedDisplays : []}
            obscuredCount={previewOk ? attendeePreview.obscured_remaining : 0}
            totalOtherConfirmed={
              previewOk ? attendeePreview.total_other_confirmed : totalOtherConfirmedFallback
            }
            visibleCohortCount={previewOk ? attendeePreview.visible_cohort_count : 0}
            loading={!!user?.id && attendeePreviewLoading}
            onAttendeePress={(attendee) => {
              if (attendee.id === user?.id) return;
              handleAttendeePress(attendee);
            }}
          />
        ) : (
          <WhosGoingSection
            mode="aggregate"
            viewerAdmission={isWaitlisted ? 'waitlisted' : 'none'}
            totalOtherConfirmed={teaserTotalOthers}
          />
        )}

        {isConfirmed && mutualVibes.length > 0 && (
          <MutualVibesSection mutualVibes={mutualVibes} onProfilePress={() => {}} />
        )}

        {/* Venue — virtual (digital lobby) or physical */}
        <Text style={[styles.sectionTitle, { color: theme.text }]}>The Venue</Text>
        <VenueCard
          isVirtual={isVirtual}
          venueName={eventRow.location_name ?? undefined}
          address={eventRow.location_address ?? undefined}
          eventDate={eventDate}
          eventDurationMinutes={durationMin}
          currentTimeMs={phaseClockMs}
          eventId={event.id}
          isRegistered={isConfirmed}
          onAccessPress={!hasAdmission && !isCancelled ? handlePurchase : undefined}
          accessLabel={isFree || userPrice === 0 ? 'Register' : 'Get Tickets'}
          accessDisabled={isPurchasing || isRegistering || soldOut || eventEnded || isCancelled}
        />

        {isConfirmed ? (
          isCancelled ? (
            <>
              <View style={[styles.youreInBlock, { backgroundColor: withAlpha(theme.danger, 0.12), borderColor: theme.danger }]}>
                <View style={[styles.youreInIconWrap, { backgroundColor: theme.danger }]}>
                  <Ionicons name="ban-outline" size={22} color="#fff" />
                </View>
                <View style={styles.youreInText}>
                  <Text style={[styles.youreInTitle, { color: theme.text }]}>Event cancelled</Text>
                  <Text style={[styles.youreInSub, { color: theme.textSecondary }]}>
                    Your booking is still on file—lobby and live access are closed. Use Manage Booking if you need to release your
                    spot.
                  </Text>
                </View>
              </View>
              <VibelyButton
                label="View Ticket"
                variant="secondary"
                onPress={() => setShowTicket(true)}
                style={styles.cta}
              />
              {!eventEnded ? (
                <VibelyButton
                  label="Manage Booking"
                  variant="secondary"
                  onPress={() => setShowManageBooking(true)}
                  style={styles.cta}
                />
              ) : null}
            </>
          ) : (
            <>
              <View style={[styles.youreInBlock, { backgroundColor: theme.tintSoft, borderColor: theme.tint }]}>
                <View style={[styles.youreInIconWrap, { backgroundColor: theme.tint }]}>
                  <Ionicons name="sparkles" size={22} color="#fff" />
                </View>
                <View style={styles.youreInText}>
                  <Text style={[styles.youreInTitle, { color: theme.text }]}>You're in!</Text>
                  <Text style={[styles.youreInSub, { color: theme.textSecondary }]}>Your seat is confirmed</Text>
                </View>
              </View>
              {eventEnded ? (
                <VibelyButton label="Event Ended" variant="secondary" disabled style={styles.cta} onPress={() => {}} />
              ) : eventLive ? (
                <VibelyButton
                  label="Enter Lobby →"
                  variant="primary"
                  onPress={() => router.push(`/event/${event.id}/lobby` as const)}
                  style={styles.cta}
                />
              ) : (
                <VibelyButton
                  label="View Ticket"
                  variant="primary"
                  onPress={() => setShowTicket(true)}
                  style={styles.cta}
                />
              )}
              {eventLive ? (
                <VibelyButton
                  label="View Ticket"
                  variant="secondary"
                  onPress={() => setShowTicket(true)}
                  style={styles.cta}
                />
              ) : null}
              {!eventEnded ? (
                <VibelyButton
                  label="Manage Booking"
                  variant="secondary"
                  onPress={() => setShowManageBooking(true)}
                  style={styles.cta}
                />
              ) : null}
              {!eventEnded ? (
                <Pressable
                  onPress={() => setShowInviteSheet(true)}
                  style={({ pressed }) => [styles.bringFriendRow, pressed && { opacity: 0.85 }]}
                >
                  <Text style={[styles.bringFriendText, { color: theme.tint }]}>Bring a friend? →</Text>
                </Pressable>
              ) : null}
            </>
          )
        ) : isWaitlisted ? (
          isCancelled ? (
            <>
              <View style={[styles.youreInBlock, { backgroundColor: withAlpha(theme.danger, 0.12), borderColor: theme.danger }]}>
                <View style={[styles.youreInIconWrap, { backgroundColor: theme.danger }]}>
                  <Ionicons name="ban-outline" size={22} color="#fff" />
                </View>
                <View style={styles.youreInText}>
                  <Text style={[styles.youreInTitle, { color: theme.text }]}>Event cancelled</Text>
                  <Text style={[styles.youreInSub, { color: theme.textSecondary }]}>
                    You were on the paid waitlist—this event will not run. Use Manage Booking for your options.
                  </Text>
                </View>
              </View>
              <VibelyButton
                label="Manage Booking"
                variant="primary"
                onPress={() => setShowManageBooking(true)}
                style={styles.cta}
              />
              <VibelyButton
                label="View Ticket"
                variant="secondary"
                onPress={() => setShowTicket(true)}
                style={styles.cta}
              />
            </>
          ) : (
            <>
              <View style={[styles.youreInBlock, { backgroundColor: withAlpha('#d97706', 0.15), borderColor: '#d97706' }]}>
                <View style={[styles.youreInIconWrap, { backgroundColor: '#d97706' }]}>
                  <Ionicons name="hourglass-outline" size={22} color="#fff" />
                </View>
                <View style={styles.youreInText}>
                  <Text style={[styles.youreInTitle, { color: theme.text }]}>Paid waitlist</Text>
                  <Text style={[styles.youreInSub, { color: theme.textSecondary }]}>
                    We'll confirm you if a spot opens
                  </Text>
                </View>
              </View>
              <VibelyButton
                label="View Ticket"
                variant="primary"
                onPress={() => setShowTicket(true)}
                style={styles.cta}
              />
              {!eventEnded ? (
                <VibelyButton
                  label="Manage Booking"
                  variant="secondary"
                  onPress={() => setShowManageBooking(true)}
                  style={styles.cta}
                />
              ) : null}
            </>
          )
        ) : (
          <View style={styles.spacerForPricingBar} />
        )}
      </ScrollView>

      {/* Sticky bottom: pricing when not registered */}
      {!hasAdmission && !isCancelled && (
        <PricingBar
          price={userPrice}
          capacityStatus={capacityStatus}
          spotsLeft={Math.max(0, spotsLeft)}
          genderLabel={genderLabel}
          onPurchase={handlePurchase}
          isPurchasing={isPurchasing || isRegistering}
          soldOut={soldOut}
          eventEnded={eventEnded}
          bottomInset={pricingBarBottomInset}
        />
      )}

      {isCancelled && hasAdmission ? (
        <View
          style={[
            styles.cancelledAdmissionBar,
            {
              backgroundColor: theme.surface,
              borderTopColor: withAlpha(theme.danger, 0.35),
              paddingBottom: floatingTabBarObstruction,
            },
          ]}
        >
          <View style={{ flex: 1, marginRight: spacing.md }}>
            <Text style={[styles.cancelledAdmissionTitle, { color: theme.danger }]}>Event cancelled</Text>
            <Text style={[styles.cancelledAdmissionSub, { color: theme.textSecondary }]}>
              Manage booking if you need to release your spot
            </Text>
          </View>
          <VibelyButton
            label="Manage Booking"
            variant="secondary"
            onPress={() => setShowManageBooking(true)}
            style={{ flexShrink: 0 }}
          />
        </View>
      ) : null}

      <ManageBookingModal
        visible={showManageBooking}
        onClose={() => setShowManageBooking(false)}
        onCancel={openCancelConfirm}
        eventTitle={event.title}
        eventDate={dateStr}
        eventTime={timeStr}
        venue={isVirtual ? 'Digital Lobby' : (eventRow.location_name ?? 'TBA')}
        ticketNumber={ticketNumber}
        price={userPrice}
        isVirtual={isVirtual}
        admissionStatus={isConfirmed ? 'confirmed' : 'waitlisted'}
      />

      <TicketStub
        visible={showTicket}
        onClose={() => setShowTicket(false)}
        eventTitle={event.title}
        eventDate={dateStr}
        eventTime={timeStr}
        venue={isVirtual ? 'Digital Lobby' : (eventRow.location_name ?? 'TBA')}
        ticketNumber={ticketNumber}
        isVirtual={isVirtual}
        admissionStatus={isConfirmed ? 'confirmed' : 'waitlisted'}
      />

      <InviteFriendsSheet
        visible={showInviteSheet}
        onClose={() => setShowInviteSheet(false)}
        event={{
          id: event.id,
          title: event.title,
          cover_url: eventCoverUrl(event.cover_image),
          start_time: event.event_date,
          city: eventRow.location_name ?? undefined,
        }}
      />

      <PhoneVerificationFlow
        visible={showEventPhoneVerify}
        onClose={() => setShowEventPhoneVerify(false)}
        initialPhoneE164={eventPhoneInitialE164}
        onVerified={() => {
          void refreshEventPhoneNudgeStatus();
          setShowEventPhoneVerify(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  headerBar: { marginBottom: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  backBtn: { padding: spacing.xs },
  headerTitle: { fontSize: 18, fontWeight: '600', flex: 1 },
  scroll: { flex: 1 },
  content: { padding: spacing.lg, paddingTop: spacing.md },
  coverWrap: { marginBottom: spacing.xl, borderRadius: radius['2xl'], overflow: 'hidden', position: 'relative' },
  cover: {
    width: '100%',
    height: '100%',
    borderRadius: radius['2xl'],
  },
  coverGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderBottomLeftRadius: radius['2xl'],
    borderBottomRightRadius: radius['2xl'],
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  infoCard: { marginBottom: spacing.xl },
  title: { ...typography.titleLG, marginBottom: spacing.md },
  dateTimeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  meta: { fontSize: 14 },
  eventInfoRow: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  eventInfoText: { fontSize: 14 },
  venueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  venueText: { fontSize: 14, flex: 1 },
  recurringSeriesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  recurringSeriesLabel: { fontSize: 14, flexShrink: 1 },
  recurringSeriesDot: { fontSize: 14 },
  recurringSeriesNext: { fontSize: 14, fontWeight: '600' },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  tag: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  tagText: { fontSize: 13, fontWeight: '600' },
  sectionTitle: { fontSize: 18, fontWeight: '600', marginTop: spacing.lg, marginBottom: spacing.sm },
  description: { fontSize: 14, lineHeight: 20 },
  youreInBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderWidth: 1,
    marginBottom: spacing.lg,
  },
  youreInIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  youreInText: {},
  youreInTitle: { fontSize: 18, fontWeight: '700' },
  youreInSub: { fontSize: 13, marginTop: 2 },
  cta: { marginTop: spacing.md },
  ctaPrimary: { marginTop: spacing.lg, alignSelf: 'stretch' },
  spacerForPricingBar: { height: 24 },
  inviteFriendsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    marginBottom: spacing.lg,
  },
  inviteFriendsBtnText: {
    color: '#8B5CF6',
    fontWeight: '600',
    fontSize: 15,
  },
  bringFriendRow: {
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: spacing.sm,
  },
  bringFriendText: {
    fontSize: 15,
    fontWeight: '600',
  },
  cancelledBanner: {
    marginBottom: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cancelledBannerTitle: { fontSize: 15, fontWeight: '700', marginBottom: 6 },
  cancelledBannerBody: { fontSize: 13, lineHeight: 18 },
  cancelledAdmissionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cancelledAdmissionTitle: { fontSize: 15, fontWeight: '700' },
  cancelledAdmissionSub: { fontSize: 12, marginTop: 2 },
});
