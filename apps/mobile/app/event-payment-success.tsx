import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import Colors from '@/constants/Colors';
import { spacing, typography } from '@/constants/theme';
import { VibelyButton } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { withAlpha } from '@/lib/colorUtils';
import {
  eventTicketPaymentSuccessCopy,
  fetchEventTicketPaymentStatus,
  resolveEventTicketPaymentViewState,
  type EventTicketPaymentStatus,
} from '@/lib/eventTicketPaymentStatus';

export default function EventPaymentSuccessScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { eventId, event_id: eventIdSnake } = useLocalSearchParams<{ eventId?: string; event_id?: string }>();
  const idParam = eventId ?? eventIdSnake;
  const id = typeof idParam === 'string' ? idParam : idParam?.[0];

  const [eventTitle, setEventTitle] = useState<string | null>(null);
  const [eventRowStatus, setEventRowStatus] = useState<string | null>(null);
  const [eventRowClosed, setEventRowClosed] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<EventTicketPaymentStatus | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const { data } = await supabase.from('events').select('title, status, archived_at, ended_at').eq('id', id).maybeSingle();
      if (data) {
        setEventTitle(typeof data.title === 'string' ? data.title : null);
        const status = typeof data.status === 'string' ? data.status.toLowerCase() : '';
        setEventRowStatus(status || null);
        setEventRowClosed(
          Boolean(data.archived_at) ||
            Boolean(data.ended_at) ||
            status === 'draft' ||
            status === 'archived' ||
            status === 'ended' ||
            status === 'completed'
        );
      }
    })();
    void queryClient.invalidateQueries({ queryKey: ['event-registration-check', id] });
    void queryClient.invalidateQueries({ queryKey: ['user-registrations'] });
    void queryClient.invalidateQueries({ queryKey: ['event-attendees', id] });
    void queryClient.invalidateQueries({ queryKey: ['event-attendee-preview', id] });
    void queryClient.invalidateQueries({ queryKey: ['event-details', id] });
    void queryClient.invalidateQueries({ queryKey: ['next-registered-event'] });
  }, [id, queryClient]);

  useEffect(() => {
    if (!id || !user?.id) return;
    let cancelled = false;
    const refreshAdmission = async () => {
      const status = await fetchEventTicketPaymentStatus(id);
      if (cancelled) return;
      setPaymentStatus(status);
    };

    void refreshAdmission();

    // Brief polling window to absorb async settlement lag after redirect.
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let stopPollingTimeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutId = setTimeout(() => {
      intervalId = setInterval(() => {
        void refreshAdmission();
      }, 3000);
      stopPollingTimeoutId = setTimeout(() => {
        if (intervalId) clearInterval(intervalId);
      }, 30000);
    }, 1000);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      if (stopPollingTimeoutId) clearTimeout(stopPollingTimeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [id, user?.id]);

  const isEventCancelled = eventRowStatus === 'cancelled';
  const admissionStatus = paymentStatus?.admissionStatus ?? paymentStatus?.settlement?.admissionStatus ?? null;
  const hasAdmission = admissionStatus === 'confirmed' || admissionStatus === 'waitlisted';
  const paymentClosedWithoutAdmission = paymentStatus?.settlement?.code === 'EVENT_CLOSED' && !hasAdmission;
  const isEventUnavailable = isEventCancelled || eventRowClosed || paymentClosedWithoutAdmission;
  const viewState = resolveEventTicketPaymentViewState(paymentStatus, isEventUnavailable);
  const copy = eventTicketPaymentSuccessCopy(viewState);
  const { headline, subline } = copy;
  const showViewEventAction = Boolean(
    id &&
      copy.showViewEventAction &&
      !eventRowClosed &&
      !paymentClosedWithoutAdmission
  );

  const iconBg = isEventUnavailable ? withAlpha(theme.danger, 0.15) : 'hsla(263, 70%, 66%, 0.15)';
  const iconColor = isEventUnavailable ? theme.danger : theme.tint;

  return (
    <View style={[styles.container, { backgroundColor: theme.background, paddingTop: insets.top }]}>
      <View style={styles.content}>
        <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
          <Ionicons name={isEventUnavailable ? 'alert-circle-outline' : 'calendar-outline'} size={56} color={iconColor} />
        </View>
        <Text style={[styles.title, { color: theme.text }]}>{headline}</Text>
        {eventTitle ? (
          <Text style={[styles.eventTitle, { color: theme.tint }]} numberOfLines={2}>
            {eventTitle}
          </Text>
        ) : null}
        <Text style={[styles.body, { color: theme.mutedForeground }]}>{subline}</Text>
        {showViewEventAction ? (
          <VibelyButton
            label="View Event"
            variant="gradient"
            onPress={() => router.replace(`/(tabs)/events/${id}` as const)}
            style={{ width: '100%', marginTop: 24 }}
          />
        ) : null}
        {copy.showSupportAction ? (
          <VibelyButton
            label="Contact Support"
            variant="secondary"
            onPress={() =>
              router.push({
                pathname: '/settings/submit-ticket',
                params: { primaryType: 'support', subcategory: 'Payment failed or refund' },
              })
            }
            style={{ width: '100%', marginTop: 12 }}
          />
        ) : null}
        <VibelyButton
          label="Back to Events"
          variant="secondary"
          onPress={() => router.replace('/(tabs)/events' as const)}
          style={{ width: '100%', marginTop: 12 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: spacing.xl, alignItems: 'center', maxWidth: 360 },
  iconWrap: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: { ...typography.titleXL, textAlign: 'center', marginBottom: 12 },
  eventTitle: { fontSize: 18, fontWeight: '600', textAlign: 'center', marginBottom: 8 },
  body: { fontSize: 16, textAlign: 'center', lineHeight: 24 },
});
