/**
 * Who's Going: horizontal scroll of attendee avatars, count, "+N more".
 * Reference: src/components/events/WhosGoingSection.tsx, GuestListTeaser.tsx
 */

import React from 'react';
import { View, Text, ScrollView, Pressable, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius, typography } from '@/constants/theme';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

const MAX_VISIBLE = 10;
const AVATAR_SIZE = 44;

export type AttendeeDisplay = {
  id: string;
  name: string;
  avatarUrl: string;
};

type Props = {
  attendees: AttendeeDisplay[];
  totalCount: number;
  onAttendeePress?: (attendee: AttendeeDisplay) => void;
};

export function WhosGoingSection({ attendees, totalCount, onAttendeePress }: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const visible = attendees.slice(0, MAX_VISIBLE);
  const moreCount = totalCount - visible.length;

  return (
    <View style={[styles.card, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
      <View style={styles.header}>
        <Ionicons name="people-outline" size={20} color={theme.tint} />
        <Text style={[styles.title, { color: theme.text }]}>Who&apos;s Going</Text>
      </View>
      <Text style={[styles.count, { color: theme.textSecondary }]}>{totalCount} attending</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.avatarRow}
      >
        {visible.map((a) => (
          <Pressable
            key={a.id}
            onPress={() => onAttendeePress?.(a)}
            style={({ pressed }) => [pressed && styles.pressed]}
          >
            <Image
              source={{ uri: a.avatarUrl }}
              style={[styles.avatar, { borderColor: theme.border }]}
            />
          </Pressable>
        ))}
        {moreCount > 0 && (
          <View style={[styles.moreWrap, { backgroundColor: theme.muted }]}>
            <Text style={[styles.moreText, { color: theme.mutedForeground }]}>+{moreCount} more</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  title: {
    ...typography.titleMD,
    fontSize: 18,
  },
  count: {
    ...typography.body,
    marginBottom: spacing.md,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingRight: spacing.lg,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 2,
  },
  moreWrap: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreText: {
    fontSize: 11,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.8,
  },
});
