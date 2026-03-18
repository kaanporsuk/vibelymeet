import { useState, useEffect, useCallback } from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { StyleSheet, ScrollView, Pressable, Image, Alert, View, Text, Dimensions, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import Colors from '@/constants/Colors';
import { GlassHeaderBar, Card, LoadingState, ErrorState, VibelyButton } from '@/components/ui';
import { spacing, radius, typography, layout } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import {
  useEventDetails,
  useIsRegisteredForEvent,
  useRegisterForEvent,
  useEventAttendees,
  useEventVibesSent,
  useEventVibesReceived,
  sendEventVibe,
  type EventDetailsRow,
  type EventVibeMutual,
} from '@/lib/eventsApi';
import { eventCoverUrl, avatarUrl } from '@/lib/imageUrl';
import { VenueCard } from '@/components/events/VenueCard';
import { PricingBar } from '@/components/events/PricingBar';
import { ManageBookingModal } from '@/components/events/ManageBookingModal';
import { WhosGoingSection, type AttendeeDisplay } from '@/components/events/WhosGoingSection';
import { MutualVibesSection } from '@/components/events/MutualVibesSection';
import { TicketStub } from '@/components/events/TicketStub';
import { supabase } from '@/lib/supabase';
import { trackEvent } from '@/lib/analytics';

export default function EventDetailScreen() {
  // === ALL HOOKS — must run before any conditional return (Rules of Hooks) ===
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: event, isLoading, error } = useEventDetails(id ?? undefined);
  const { data: isRegistered, refetch: refetchRegistration } = useIsRegisteredForEvent(id ?? undefined, user?.id);
  const { registerForEvent, unregisterFromEvent, isRegistering, isUnregistering } = useRegisterForEvent();
  const [userGender, setUserGender] = useState<string>('male');
  const [showManageBooking, setShowManageBooking] = useState(false);
  const [showTicket, setShowTicket] = useState(false);
  const [isPurchasing, setIsPurchasing] = useState(false);

  const { data: attendees = [] } = useEventAttendees(id ?? undefined);
  const { data: sentVibeIds = [], refetch: refetchSentVibes } = useEventVibesSent(id ?? undefined, user?.id);
  const { data: receivedVibes = [], refetch: refetchReceivedVibes } = useEventVibesReceived(id ?? undefined, user?.id);

  const attendeeDisplays: AttendeeDisplay[] = attendees.map((a) => ({
    id: a.id,
    name: a.name,
    avatarUrl: avatarUrl(a.avatar_url ?? a.photos?.[0] ?? null),
  }));

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
    async (attendee: AttendeeDisplay) => {
      if (!user?.id || !id) return;
      if (hasSentVibe(attendee.id)) {
        Alert.alert(attendee.name, 'You already sent a vibe to this person.');
        return;
      }
      Alert.alert(
        'Send vibe',
        `Send a vibe to ${attendee.name}? They'll see your interest before the event.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Send vibe',
            onPress: async () => {
              const { ok, error } = await sendEventVibe(id, user.id, attendee.id);
              if (ok) {
                refetchSentVibes();
                refetchReceivedVibes();
                Alert.alert('Vibe sent! 💫', "They'll see your interest before the event.");
              } else {
                Alert.alert('Couldn\'t send vibe', error ?? 'Try again.');
              }
            },
          },
        ]
      );
    },
    [user?.id, id, sentVibeIds, refetchSentVibes, refetchReceivedVibes]
  );

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const { data } = await supabase.from('profiles').select('gender').eq('id', user.id).maybeSingle();
      if (data?.gender) setUserGender(String(data.gender).toLowerCase());
    })();
  }, [user?.id]);

  const attendeeDisplays: AttendeeDisplay[] = attendees.map((a) => ({
    id: a.id,
    name: a.name,
    avatarUrl: avatarUrl(a.avatar_url ?? a.photos?.[0] ?? null),
  }));

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
    async (attendee: AttendeeDisplay) => {
      if (!user?.id || !id) return;
      if (hasSentVibe(attendee.id)) {
        Alert.alert(attendee.name, 'You already sent a vibe to this person.');
        return;
      }
      Alert.alert(
        'Send vibe',
        `Send a vibe to ${attendee.name}? They'll see your interest before the event.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Send vibe',
            onPress: async () => {
              const { ok, error } = await sendEventVibe(id, user.id, attendee.id);
              if (ok) {
                refetchSentVibes();
                refetchReceivedVibes();
                Alert.alert('Vibe sent! 💫', "They'll see your interest before the event.");
              } else {
                Alert.alert('Couldn\'t send vibe', error ?? 'Try again.');
              }
            },
          },
        ]
      );
    },
    [user?.id, id, sentVibeIds, refetchSentVibes, refetchReceivedVibes]
  );

  // Derived values for callbacks (event may be undefined until loaded)
  const ev = event as EventDetailsRow | undefined;
  const isFree = ev?.is_free !== false;
  const priceAmount = ev?.price_amount ?? 0;
  const isFemale = userGender === 'female' || userGender === 'woman';
  const userPrice = !event || isFree ? 0 : (isFemale ? priceAmount * 0.6 : priceAmount);

  const handleRegister = useCallback(async () => {
    if (!event) return;
    const ok = await registerForEvent(event.id);
    if (ok) {
      trackEvent('event_registered', {
        event_id: event.id,
        event_title: event.title,
        is_free: ev?.is_free !== false,
      });
    } else {
      Alert.alert("Couldn't register", 'Check your connection and try again.');
    }
  }, [event, ev?.is_free, registerForEvent]);

  const handlePurchase = useCallback(async () => {
    if (!event) return;
    if (isFree || userPrice === 0) {
      await handleRegister();
      return;
    }
    setIsPurchasing(true);
    try {
      const { data: authData } = await supabase.auth.getSession();
      if (!authData?.session) {
        Alert.alert('Sign in required', 'Please sign in to continue.');
        return;
      }
      const { data: checkout, error: checkoutError } = await supabase.functions.invoke('create-event-checkout', {
        body: { eventId: event.id, eventTitle: event.title, price: userPrice, currency: 'eur' },
      });
      const result = checkout as { success?: boolean; url?: string; error?: string } | null;
      if (checkoutError || !result?.success) {
        Alert.alert('Payment error', result?.error ?? 'Payment failed. Try again.');
        return;
      }
      if (result?.url) await Linking.openURL(result.url);
    } finally {
      setIsPurchasing(false);
    }
  }, [event, isFree, userPrice, handleRegister]);

  const handleUnregister = useCallback(async () => {
    if (!event) return;
    const ok = await unregisterFromEvent(event.id);
    if (ok) {
      refetchRegistration();
      queryClient.invalidateQueries({ queryKey: ['event-registration-check'] });
      queryClient.invalidateQueries({ queryKey: ['event-details', id] });
      setShowManageBooking(false);
    } else {
      Alert.alert("Couldn't cancel", 'Check your connection and try again.');
    }
  }, [event, unregisterFromEvent, refetchRegistration, queryClient, id]);

  const openCancelConfirm = useCallback(() => {
    if (!event) return;
    setShowManageBooking(false);
    Alert.alert(
      'Cancel your spot?',
      `Release your spot for ${event.title}?`,
      [
        { text: 'Keep', style: 'cancel' },
        { text: 'Cancel spot', style: 'destructive', onPress: () => handleUnregister() },
      ]
    );
  }, [event, handleUnregister]);

  // Conditional returns — after ALL hooks
  if (isLoading && !event) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <LoadingState title="Loading event…" message="Just a sec…" />
      </View>
    );
  }

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const { data } = await supabase.from('profiles').select('gender').eq('id', user.id).maybeSingle();
      if (data?.gender) setUserGender(String(data.gender).toLowerCase());
    })();
  }, [user?.id]);

  if (error || !event) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <ErrorState
          title="Event not found"
          message="This event may have been removed or doesn't exist."
          actionLabel="Back to Events"
          onActionPress={() => router.push('/(tabs)/events')}
        />
      </View>
    );
  }

  const ev = event as EventDetailsRow;
  const eventDate = new Date(event.event_date);
  const dateStr = eventDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const timeStr = eventDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const isVirtual = !ev.is_location_specific;
  const isFree = ev.is_free !== false;
  const priceAmount = ev.price_amount ?? 0;
  const isFemale = userGender === 'female' || userGender === 'woman';
  const userPrice = isFree ? 0 : (isFemale ? priceAmount * 0.6 : priceAmount);
  const maxMen = ev.max_male_attendees ?? Math.floor((ev.max_attendees ?? 50) / 2);
  const maxWomen = ev.max_female_attendees ?? Math.ceil((ev.max_attendees ?? 50) / 2);
  const currentMen = Math.floor((event.current_attendees ?? 0) / 2);
  const currentWomen = Math.ceil((event.current_attendees ?? 0) / 2);
  const spotsLeft = isFemale ? maxWomen - currentWomen : maxMen - currentMen;
  const capacityStatus: 'available' | 'filling' | 'almostFull' =
    spotsLeft <= 2 ? 'almostFull' : spotsLeft <= 5 ? 'filling' : 'available';
  const genderLabel = isFemale ? 'Female' : 'Male';

  const handleRegister = useCallback(async () => {
    const ok = await registerForEvent(event.id);
    if (ok) {
      trackEvent('event_registered', {
        event_id: event.id,
        event_title: event.title,
        is_free: ev.is_free !== false,
      });
    } else {
      Alert.alert("Couldn't register", 'Check your connection and try again.');
    }
  }, [event.id, event.title, ev.is_free, registerForEvent]);

  const handlePurchase = useCallback(async () => {
    if (isFree || userPrice === 0) {
      await handleRegister();
      return;
    }
    setIsPurchasing(true);
    try {
      const { data: authData } = await supabase.auth.getSession();
      if (!authData?.session) {
        Alert.alert('Sign in required', 'Please sign in to continue.');
        return;
      }
      const { data: checkout, error: checkoutError } = await supabase.functions.invoke('create-event-checkout', {
        body: { eventId: event.id, eventTitle: event.title, price: userPrice, currency: 'eur' },
      });
      const result = checkout as { success?: boolean; url?: string; error?: string } | null;
      if (checkoutError || !result?.success) {
        Alert.alert('Payment error', result?.error ?? 'Payment failed. Try again.');
        return;
      }
      if (result?.url) await Linking.openURL(result.url);
    } finally {
      setIsPurchasing(false);
    }
  }, [event.id, event.title, isFree, userPrice, handleRegister]);

  const handleUnregister = useCallback(async () => {
    const ok = await unregisterFromEvent(event.id);
    if (ok) {
      refetchRegistration();
      queryClient.invalidateQueries({ queryKey: ['event-registration-check'] });
      queryClient.invalidateQueries({ queryKey: ['event-details', id] });
      setShowManageBooking(false);
    } else {
      Alert.alert("Couldn't cancel", 'Check your connection and try again.');
    }
  }, [event.id, unregisterFromEvent, refetchRegistration, queryClient, id]);

  const openCancelConfirm = useCallback(() => {
    setShowManageBooking(false);
    Alert.alert(
      'Cancel your spot?',
      `Release your spot for ${event.title}?`,
      [
        { text: 'Keep', style: 'cancel' },
        { text: 'Cancel spot', style: 'destructive', onPress: () => handleUnregister() },
      ]
    );
  }, [event.title, handleUnregister]);

  const tags = (event as { tags?: string[] | null }).tags ?? [];
  const coverHeight = Math.min(280, Dimensions.get('window').height * 0.4);
  const durationMin = event.duration_minutes ?? 60;
  const goingCount = event.current_attendees ?? 0;
  const ticketNumber = `VBL-${event.id.slice(0, 8).toUpperCase()}`;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
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
        contentContainerStyle={[styles.content, { paddingBottom: layout.scrollContentPaddingBottomTab }]}
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
          {(event as EventDetailsRow).location_name ? (
            <View style={styles.venueRow}>
              <Ionicons name="location-outline" size={18} color={theme.textSecondary} />
              <Text style={[styles.venueText, { color: theme.textSecondary }]}>
                {(event as EventDetailsRow).location_name}
              </Text>
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
          <Text style={[styles.sectionTitle, { color: theme.text }]}>About This Event</Text>
          {event.description ? (
            <Text style={[styles.description, { color: theme.textSecondary }]}>{event.description}</Text>
          ) : (
            <Text style={[styles.description, { color: theme.textSecondary }]}>
              Join us for an exciting video speed dating event! Meet new people in a fun, safe environment.
            </Text>
          )}
        </Card>

        <WhosGoingSection
          attendees={attendeeDisplays}
          totalCount={Math.max(event.current_attendees ?? 0, attendeeDisplays.length)}
          onAttendeePress={isRegistered ? handleAttendeePress : undefined}
        />

        {isRegistered && mutualVibes.length > 0 && (
          <MutualVibesSection mutualVibes={mutualVibes} onProfilePress={() => {}} />
        )}

        {/* Venue — virtual (digital lobby) or physical */}
        <Text style={[styles.sectionTitle, { color: theme.text }]}>The Venue</Text>
        <VenueCard
          isVirtual={isVirtual}
          venueName={ev.location_name ?? undefined}
          address={ev.location_address ?? undefined}
          eventDate={eventDate}
          eventDurationMinutes={durationMin}
          eventId={event.id}
          isRegistered={!!isRegistered}
        />

        {isRegistered ? (
          <>
            <View style={[styles.youreInBlock, { backgroundColor: theme.tintSoft, borderColor: theme.tint }]}>
              <View style={[styles.youreInIconWrap, { backgroundColor: theme.tint }]}>
                <Ionicons name="sparkles" size={22} color="#fff" />
              </View>
              <View style={styles.youreInText}>
                <Text style={[styles.youreInTitle, { color: theme.text }]}>You&apos;re in!</Text>
                <Text style={[styles.youreInSub, { color: theme.textSecondary }]}>See you there</Text>
              </View>
            </View>
            <VibelyButton
              label="Enter Lobby"
              variant="primary"
              onPress={() => router.push(`/event/${event.id}/lobby` as const)}
              style={styles.cta}
            />
            <VibelyButton
              label="View Ticket"
              variant="secondary"
              onPress={() => setShowTicket(true)}
              style={styles.cta}
            />
            <VibelyButton
              label="Manage Booking"
              variant="secondary"
              onPress={() => setShowManageBooking(true)}
              style={styles.cta}
            />
          </>
        ) : (
          <View style={styles.spacerForPricingBar} />
        )}
      </ScrollView>

      {/* Sticky bottom: pricing when not registered */}
      {!isRegistered && (
        <PricingBar
          price={userPrice}
          capacityStatus={capacityStatus}
          spotsLeft={Math.max(0, spotsLeft)}
          genderLabel={genderLabel}
          onPurchase={handlePurchase}
          isPurchasing={isPurchasing || isRegistering}
        />
      )}

      {/* Registered: bottom bar You're in / Manage Booking — same as inline above; optional sticky duplicate omitted for clarity */}

      <ManageBookingModal
        visible={showManageBooking}
        onClose={() => setShowManageBooking(false)}
        onCancel={openCancelConfirm}
        eventTitle={event.title}
        eventDate={dateStr}
        eventTime={timeStr}
        venue={isVirtual ? 'Digital Lobby' : (ev.location_name ?? 'TBA')}
        ticketNumber={ticketNumber}
        price={userPrice}
        isVirtual={isVirtual}
      />

      <TicketStub
        visible={showTicket}
        onClose={() => setShowTicket(false)}
        eventTitle={event.title}
        eventDate={dateStr}
        eventTime={timeStr}
        venue={isVirtual ? 'Digital Lobby' : (ev.location_name ?? 'TBA')}
        ticketNumber={ticketNumber}
        isVirtual={isVirtual}
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
});
