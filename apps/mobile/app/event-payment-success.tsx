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
  fetchEventTicketPaymentStatus,
  type EventTicketPaymentStatus,
} from '@/lib/eventTicketPaymentStatus';

type AdmissionStatus = 'confirmed' | 'waitlisted' | 'unknown';

function normalizeAdmissionStatus(value: string | null | undefined): AdmissionStatus {
  return value === 'confirmed' || value === 'waitlisted' ? value : 'unknown';
}

function paymentSuccessCopy(
  isEventCancelled: boolean,
  admissionStatus: AdmissionStatus,
  paymentStatus: EventTicketPaymentStatus | null,
): { headline: string; subline: string } {
  if (isEventCancelled) {
    return {
      headline: 'This event was cancelled',
      subline: 'Your payment may still show here while things sync. Open the event page for the latest status.',
    };
  }

  const outcome = paymentStatus?.settlement?.outcome ?? null;
  const code = paymentStatus?.settlement?.code ?? null;
  const success = paymentStatus?.settlement?.success;

  if (outcome === 'rejected_tier' || code === 'TIER_MISMATCH') {
    return {
      headline: 'Payment needs review',
      subline: 'Your payment was received, but this event requires a different access level.',
    };
  }
  if (outcome === 'rejected_event' || code === 'EVENT_CLOSED') {
    return {
      headline: 'This event is no longer available',
      subline: 'Your payment was received after registration closed. Support will help with next steps.',
    };
  }
  if (
    outcome === 'rejected_monthly_limit' ||
    code === 'MONTHLY_EVENT_JOIN_LIMIT_REACHED' ||
    code === 'MONTHLY_LIMIT_REACHED'
  ) {
    return {
      headline: 'Event limit reached',
      subline: 'Your payment was received, but your current plan has reached its monthly event limit.',
    };
  }
  if (outcome === 'rejected_conflict' || outcome === 'rejected_unique' || code === 'CONFLICT' || code === 'UNIQUE') {
    return {
      headline: 'Registration needs review',
      subline: 'Your payment was received, but we need to reconcile your registration before confirming the event.',
    };
  }
  if (success === false) {
    return {
      headline: 'Payment needs review',
      subline: 'Your payment was received, but registration did not complete cleanly. Support will help with next steps.',
    };
  }

  if (admissionStatus === 'waitlisted') {
    return {
      headline: "You're on the waitlist",
      subline: "The event was full when your payment settled. We'll confirm you if a spot opens.",
    };
  }
  if (admissionStatus === 'confirmed') {
    return {
      headline: "You're on the list! 🎉",
      subline: 'Check your email for confirmation',
    };
  }

  return {
    headline: 'Payment received',
    subline: 'Hang tight while we confirm your spot.',
  };
}

export default function EventPaymentSuccessScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { eventId } = useLocalSearchParams<{ eventId?: string }>();
  const id = typeof eventId === 'string' ? eventId : eventId?.[0];

  const [eventTitle, setEventTitle] = useState<string | null>(null);
  const [eventRowStatus, setEventRowStatus] = useState<string | null>(null);
  const [admissionStatus, setAdmissionStatus] = useState<AdmissionStatus>('unknown');
  const [paymentStatus, setPaymentStatus] = useState<EventTicketPaymentStatus | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const { data } = await supabase.from('events').select('title, status').eq('id', id).maybeSingle();
      if (data) {
        setEventTitle(typeof data.title === 'string' ? data.title : null);
        setEventRowStatus(typeof data.status === 'string' ? data.status : null);
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
      setAdmissionStatus(normalizeAdmissionStatus(status.admissionStatus ?? status.settlement?.admissionStatus));
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
  const { headline, subline } = paymentSuccessCopy(isEventCancelled, admissionStatus, paymentStatus);

  const iconBg = isEventCancelled ? withAlpha(theme.danger, 0.15) : 'hsla(263, 70%, 66%, 0.15)';
  const iconColor = isEventCancelled ? theme.danger : theme.tint;

  return (
    <View style={[styles.container, { backgroundColor: theme.background, paddingTop: insets.top }]}>
      <View style={styles.content}>
        <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
          <Ionicons name={isEventCancelled ? 'alert-circle-outline' : 'ticket'} size={56} color={iconColor} />
        </View>
        <Text style={[styles.title, { color: theme.text }]}>{headline}</Text>
        {eventTitle ? (
          <Text style={[styles.eventTitle, { color: theme.tint }]} numberOfLines={2}>
            {eventTitle}
          </Text>
        ) : null}
        <Text style={[styles.body, { color: theme.mutedForeground }]}>{subline}</Text>
        {id ? (
          <VibelyButton
            label="View Event"
            variant="gradient"
            onPress={() => router.replace(`/(tabs)/events/${id}` as const)}
            style={{ width: '100%', marginTop: 24 }}
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
