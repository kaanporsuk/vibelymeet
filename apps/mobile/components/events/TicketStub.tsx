/**
 * Ticket stub modal: event title, date, time, venue, ticket number (VBL-{eventId first 8}).
 * Reference: src/components/events/TicketStub.tsx
 */

import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius, typography } from '@/constants/theme';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type Props = {
  visible: boolean;
  onClose: () => void;
  eventTitle: string;
  eventDate: string;
  eventTime: string;
  venue: string;
  ticketNumber: string;
  isVirtual?: boolean;
};

export function TicketStub({
  visible,
  onClose,
  eventTitle,
  eventDate,
  eventTime,
  venue,
  ticketNumber,
  isVirtual = false,
}: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="slide">
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.border }]} onPress={(e) => e.stopPropagation()}>
          <View style={[styles.sheetHandle, { backgroundColor: theme.muted }]} />
          <View style={[styles.header, { backgroundColor: theme.tintSoft }]}>
            <View style={[styles.ticketIcon, { backgroundColor: theme.tint }]}>
              <Ionicons name="ticket" size={24} color="#fff" />
            </View>
            <View>
              <Text style={[styles.ticketLabel, { color: theme.mutedForeground }]}>
                {isVirtual ? 'Vibely Registration' : 'Vibely Ticket'}
              </Text>
              <Text style={[styles.ticketNumber, { color: theme.text }]}>{ticketNumber}</Text>
            </View>
          </View>
          <Text style={[styles.eventTitle, { color: theme.text }]}>{eventTitle}</Text>
          <View style={[styles.dash, { backgroundColor: theme.border }]} />
          <View style={styles.details}>
            <View style={styles.row}>
              <Ionicons name="calendar-outline" size={20} color={theme.tint} />
              <Text style={[styles.label, { color: theme.mutedForeground }]}>Date</Text>
              <Text style={[styles.value, { color: theme.text }]}>{eventDate}</Text>
            </View>
            <View style={styles.row}>
              <Ionicons name="time-outline" size={20} color={theme.tint} />
              <Text style={[styles.label, { color: theme.mutedForeground }]}>Time</Text>
              <Text style={[styles.value, { color: theme.text }]}>{eventTime}</Text>
            </View>
            <View style={styles.row}>
              <Ionicons name="location-outline" size={20} color={theme.tint} />
              <Text style={[styles.label, { color: theme.mutedForeground }]}>Location</Text>
              <Text style={[styles.value, { color: theme.text }]} numberOfLines={1}>
                {isVirtual ? 'Virtual • Video Speed Dating' : venue}
              </Text>
            </View>
          </View>
          <Text style={[styles.dismissHint, { color: theme.mutedForeground }]}>Tap outside to close</Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'flex-end',
    padding: spacing.lg,
  },
  sheet: {
    borderTopLeftRadius: radius['3xl'],
    borderTopRightRadius: radius['3xl'],
    borderWidth: 1,
    padding: spacing.xl,
    paddingBottom: spacing['3xl'],
  },
  sheetHandle: {
    width: 100,
    height: 8,
    borderRadius: 999,
    alignSelf: 'center',
    marginTop: 16,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.xl,
    marginBottom: spacing.lg,
  },
  ticketIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ticketLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  ticketNumber: {
    fontSize: 14,
    fontWeight: '600',
  },
  eventTitle: {
    ...typography.titleMD,
    marginBottom: spacing.md,
  },
  dash: {
    height: 2,
    marginBottom: spacing.lg,
    borderRadius: 1,
  },
  details: {
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  label: {
    fontSize: 12,
    width: 60,
  },
  value: {
    flex: 1,
    ...typography.body,
  },
  dismissHint: {
    ...typography.caption,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
