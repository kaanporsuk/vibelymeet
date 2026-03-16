/**
 * Date reminder card — parity with web: match name, mode icon, date/countdown, Join Now (video+now), enable notifications.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import { VibelyButton } from '@/components/ui';
import type { DateReminder } from '@/lib/useDateReminders';

type DateReminderCardProps = {
  reminder: DateReminder;
  onJoinDate?: () => void;
  onEnableNotifications?: () => void;
  notificationsEnabled?: boolean;
};

export function DateReminderCard({
  reminder,
  onJoinDate,
  onEnableNotifications,
  notificationsEnabled = false,
}: DateReminderCardProps) {
  const theme = Colors[useColorScheme()];
  const isUrgent = reminder.urgency === 'imminent' || reminder.urgency === 'now';
  const isSoon = reminder.urgency === 'soon';

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: isUrgent ? theme.dangerSoft + '40' : isSoon ? theme.neonYellow + '20' : theme.tintSoft + '30',
          borderColor: isUrgent ? theme.danger + '60' : isSoon ? theme.neonYellow + '60' : theme.tint + '50',
        },
      ]}
    >
      <View style={styles.row}>
        <View
          style={[
            styles.modeIcon,
            {
              backgroundColor: reminder.mode === 'video' ? theme.neonCyan + '25' : theme.accent + '25',
            },
          ]}
        >
          <Ionicons
            name={reminder.mode === 'video' ? 'videocam' : 'location'}
            size={24}
            color={reminder.mode === 'video' ? theme.neonCyan : theme.accent}
          />
        </View>
        <View style={styles.body}>
          <Text style={[styles.matchName, { color: theme.text }]} numberOfLines={1}>
            {reminder.matchName}
          </Text>
          <Text style={[styles.dateText, { color: theme.textSecondary }]}>
            {format(reminder.date, "EEEE, MMM d 'at' h:mm a")}
          </Text>
          <View style={styles.countdownRow}>
            <Ionicons
              name="time"
              size={14}
              color={isUrgent ? theme.danger : isSoon ? theme.neonYellow : theme.tint}
            />
            <Text
              style={[
                styles.countdown,
                {
                  color: isUrgent ? theme.danger : isSoon ? theme.neonYellow : theme.tint,
                },
              ]}
            >
              {reminder.formattedCountdown}
            </Text>
          </View>
        </View>
        <View style={styles.actions}>
          {reminder.urgency === 'now' && reminder.mode === 'video' && onJoinDate && (
            <VibelyButton label="Join Now" onPress={onJoinDate} variant="primary" size="sm" />
          )}
          {!notificationsEnabled && onEnableNotifications && (
            <Pressable
              onPress={onEnableNotifications}
              style={({ pressed }) => [styles.bellBtn, pressed && { opacity: 0.8 }]}
              accessibilityLabel="Enable notifications"
            >
              <Ionicons name="notifications-outline" size={20} color={theme.textSecondary} />
            </Pressable>
          )}
          {notificationsEnabled && (
            <View style={styles.bellBtn}>
              <Ionicons name="notifications" size={20} color={theme.tint} />
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

/** Mini countdown chip for header */
export function MiniDateCountdown({
  reminder,
  onPress,
}: {
  reminder: DateReminder;
  onPress?: () => void;
}) {
  const theme = Colors[useColorScheme()];
  const isUrgent = reminder.urgency === 'imminent' || reminder.urgency === 'now';

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: isUrgent ? theme.dangerSoft : theme.tintSoft,
          borderColor: isUrgent ? theme.danger + '80' : theme.tint + '80',
        },
      ]}
    >
      <Ionicons name="time" size={14} color={isUrgent ? theme.danger : theme.tint} />
      <Text style={[styles.chipText, { color: isUrgent ? theme.danger : theme.tint }]} numberOfLines={1}>
        {reminder.formattedCountdown} · {reminder.matchName}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.lg,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  modeIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0 },
  matchName: { fontSize: 16, fontWeight: '600' },
  dateText: { fontSize: 13, marginTop: 4 },
  countdownRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  countdown: { fontSize: 16, fontWeight: '700' },
  actions: { alignItems: 'flex-end', gap: 8 },
  bellBtn: { padding: spacing.xs },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    maxWidth: 160,
  },
  chipText: { fontSize: 12, fontWeight: '600', flex: 1 },
});
