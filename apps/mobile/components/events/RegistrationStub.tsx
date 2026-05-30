/**
 * Registration stub modal — web parity: admission label and online access messaging.
 */

import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius, typography } from '@/constants/theme';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import type { RegistrationAdmissionStatus } from '@/components/events/ManageRegistrationModal';

type Props = {
  visible: boolean;
  onClose: () => void;
  eventTitle: string;
  eventDate: string;
  eventTime: string;
  registrationNumber: string;
  admissionStatus?: RegistrationAdmissionStatus;
};

export function RegistrationStub({
  visible,
  onClose,
  eventTitle,
  eventDate,
  eventTime,
  registrationNumber,
  admissionStatus = 'confirmed',
}: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const isWaitlisted = admissionStatus === 'waitlisted';

  if (!visible) return null;

  const label = isWaitlisted
    ? 'Waitlist spot'
    : 'Vibely Registration';

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.border }]} onPress={(e) => e.stopPropagation()}>
          <View style={[styles.sheetHandle, { backgroundColor: theme.muted }]} />
          <View style={[styles.header, { backgroundColor: theme.tintSoft }]}>
            <View style={[styles.registrationIcon, { backgroundColor: theme.tint }]}>
              <Ionicons name="checkmark-circle" size={24} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.registrationLabel, { color: theme.mutedForeground }]}>{label}</Text>
              <Text style={[styles.registrationNumber, { color: theme.text }]}>{registrationNumber}</Text>
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
              <Ionicons name="videocam-outline" size={20} color={theme.tint} />
              <Text style={[styles.label, { color: theme.mutedForeground }]}>Access</Text>
              <Text style={[styles.value, { color: theme.text }]} numberOfLines={2}>
                Digital Lobby
              </Text>
            </View>
          </View>
          <View style={[styles.extraBlock, { borderColor: theme.border }]}>
            <Ionicons name="videocam" size={28} color={theme.tint} />
            <Text style={[styles.extraText, { color: theme.mutedForeground }]}>
              {isWaitlisted
                ? 'Enter Lobby is for confirmed guests. If you’re promoted from the waitlist, use Enter Lobby when the event is live.'
                : 'When the event goes live, use Enter Lobby from the event page to join.'}
            </Text>
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
  registrationIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  registrationLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  registrationNumber: {
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
  extraBlock: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    gap: spacing.sm,
  },
  extraText: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  dismissHint: {
    ...typography.caption,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
