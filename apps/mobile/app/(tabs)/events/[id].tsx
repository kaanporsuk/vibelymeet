import { useState, useEffect, useCallback } from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { StyleSheet, ScrollView, Pressable, Image, View, Text, Dimensions, Linking, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
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
  useEventAttendees,
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
import { FLOATING_TAB_BAR_HEIGHT } from '../_layout';

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
  const { data: isRegistered, refetch: refetchRegistration } = useIsRegisteredForEvent(id ?? undefined, user?.id);
  const { registerForEvent, unregisterFromEvent, isRegistering, isUnregistering } = useRegisterForEvent();
  const [userGender, setUserGender] = useState<string>('male');
  const [showManageBooking, setShowManageBooking] = useState(false);
  const [showTicket, setShowTicket] = useState(false);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [showFullDesc, setShowFullDesc] = useState(false);
  const [showInviteSheet, setShowInviteSheet] = useState(false);
  const { show: showDialog, dialog: dialogEl } = useVibelyDialog();
  const { isPaused } = useAccountPauseStatus();

  const { data: attendees = [] } = useEventAttendees(id ?? undefined);
  const { data: sentVibeIds = [], refetch: refetchSentVibes } = useEventVibesSent(id ?? undefined, user?.id);
  const { data: receivedVibes = [], refetch: refetchReceivedVibes } = useEventVibesReceived(id ?? undefined, user?.id);

  useEffect(() => {
    if (!id || !event) return;
    trackEvent('event_viewed', { event_id: id, event_title: event.title ?? '' });
  }, [id, event?.id]);

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

  // Derived values for callbacks (event may be undefined until loaded)
  const ev = event as EventDetailsRow | undefined;
  const isFree = ev?.is_free !== false;
  const priceAmount = ev?.price_amount ?? 0;
  const isFemale = userGender === 'female' || userGender === 'woman';
  const userPrice = !event || isFree ? 0 : (isFemale ? priceAmount * 0.6 : priceAmount);

  const performRegisterCore = useCallback(async () => {
    if (!event) return;
    const vis = (event as EventDetailsRow).visibility;
    if (vis === 'premium' && !canAccessPremiumEvents) {
      showDialog({
        title: 'Premium only',
        message: 'This event is for Premium members. Upgrade to join.',
        variant: 'info',
        primaryAction: { label: 'View Premium', onPress: () => router.push('/premium') },
        secondaryAction: { label: 'Not now', onPress: () => {} },
      });
      return;
    }
    if (vis === 'vip' && !canAccessVipEvents) {
      showDialog({
        title: 'VIP only',
        message: 'This event is for VIP members. Upgrade to unlock access.',
        variant: 'info',
        primaryAction: { label: 'View Premium', onPress: () => router.push('/premium') },
        secondaryAction: { label: 'Not now', onPress: () => {} },
      });
      return;
    }
    const ok = await registerForEvent(event.id);
    if (ok) {
      trackEvent('event_registered', {
        event_id: event.id,
        event_title: event.title,
        is_free: ev?.is_free !== false,
      });
    } else {
      showDialog({
        title: 'Couldn’t register',
        message: 'Check your connection and try again.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    }
  }, [event, ev?.is_free, registerForEvent, canAccessPremiumEvents, canAccessVipEvents, showDialog, router]);

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
  }, [event, isFree, userPrice, handleRegister, showDialog]);

  const handleUnregister = useCallback(async () => {
    if (!event) return;
    const ok = await unregisterFromEvent(event.id);
    if (ok) {
      refetchRegistration();
      queryClient.invalidateQueries({ queryKey: ['event-registration-check'] });
      queryClient.invalidateQueries({ queryKey: ['event-details', id] });
      setShowManageBooking(false);
    } else {
      showDialog({
        title: 'Couldn’t cancel',
        message: 'Check your connection and try again.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    }
  }, [event, unregisterFromEvent, refetchRegistration, queryClient, id, showDialog]);

  const openCancelConfirm = useCallback(() => {
    if (!event) return;
    setShowManageBooking(false);
    showDialog({
      title: 'Cancel your spot?',
      message: `Release your spot for ${event.title}?`,
      variant: 'destructive',
      primaryAction: { label: 'Cancel spot', onPress: () => void handleUnregister() },
      secondaryAction: { label: 'Keep my spot', onPress: () => {} },
    });
  }, [event, handleUnregister, showDialog]);

  // Conditional returns — after ALL hooks
  if (isLoading && !event) {
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
  const eventEndMs = eventDate.getTime() + durationMin * 60 * 1000;
  const nowMs = Date.now();
  const eventEnded = nowMs > eventEndMs;
  const eventLive = nowMs >= eventDate.getTime() && nowMs <= eventEndMs;
  const descText = event.description?.trim() ?? '';

  const tags = (event as { tags?: string[] | null }).tags ?? [];
  const coverHeight = Math.min(280, Dimensions.get('window').height * 0.4);
  const goingCount = event.current_attendees ?? 0;
  const ticketNumber = `VBL-${event.id.slice(0, 8).toUpperCase()}`;
  const floatingTabBarObstruction = FLOATING_TAB_BAR_HEIGHT + Math.max(insets.bottom, 8);
  const pricingBarBottomInset = floatingTabBarObstruction + spacing.xs;
  const pricingBarReserveSpace = 124 + pricingBarBottomInset;

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
            paddingBottom: !isRegistered
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

        <Pressable
          onPress={() => setShowInviteSheet(true)}
          style={({ pressed }) => [styles.inviteFriendsBtn, { opacity: pressed ? 0.85 : 1 }]}
        >
          <Ionicons name="people-outline" size={18} color="#8B5CF6" />
          <Text style={styles.inviteFriendsBtnText}>Invite friends to this event</Text>
        </Pressable>

        <WhosGoingSection
          attendees={attendeeDisplays}
          totalCount={Math.max(event.current_attendees ?? 0, attendeeDisplays.length)}
          onAttendeePress={(attendee) => {
            if (attendee.id === user?.id) return;
            if (!isRegistered) {
              router.push(`/user/${attendee.id}` as const);
              return;
            }
            handleAttendeePress(attendee);
          }}
        />

        {isRegistered && mutualVibes.length > 0 && (
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
          eventId={event.id}
          isRegistered={!!isRegistered}
          onAccessPress={!isRegistered ? handlePurchase : undefined}
          accessLabel={isFree || userPrice === 0 ? 'Register' : 'Get Tickets'}
          accessDisabled={isPurchasing || isRegistering || soldOut}
        />

        {isRegistered ? (
          <>
            <View style={[styles.youreInBlock, { backgroundColor: theme.tintSoft, borderColor: theme.tint }]}>
              <View style={[styles.youreInIconWrap, { backgroundColor: theme.tint }]}>
                <Ionicons name="sparkles" size={22} color="#fff" />
              </View>
              <View style={styles.youreInText}>
                <Text style={[styles.youreInTitle, { color: theme.text }]}>You're in!</Text>
                <Text style={[styles.youreInSub, { color: theme.textSecondary }]}>See you there</Text>
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
              <VibelyButton label="Registered ✓" variant="primary" disabled style={styles.cta} onPress={() => {}} />
            )}
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
            {!eventEnded ? (
              <Pressable
                onPress={() => setShowInviteSheet(true)}
                style={({ pressed }) => [styles.bringFriendRow, pressed && { opacity: 0.85 }]}
              >
                <Text style={[styles.bringFriendText, { color: theme.tint }]}>Bring a friend? →</Text>
              </Pressable>
            ) : null}
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
          soldOut={soldOut}
          bottomInset={pricingBarBottomInset}
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
        venue={isVirtual ? 'Digital Lobby' : (eventRow.location_name ?? 'TBA')}
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
        venue={isVirtual ? 'Digital Lobby' : (eventRow.location_name ?? 'TBA')}
        ticketNumber={ticketNumber}
        isVirtual={isVirtual}
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
});
