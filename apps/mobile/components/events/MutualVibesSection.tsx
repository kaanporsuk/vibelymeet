/**
 * Mutual Vibes: attendees who vibed each other. Horizontal list with avatars.
 * Reference: src/components/events/MutualVibesSection.tsx
 */

import React from 'react';
import { View, Text, ScrollView, Pressable, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius, typography } from '@/constants/theme';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import type { EventVibeMutual } from '@/lib/eventsApi';

const CARD_WIDTH = 100;

type Props = {
  mutualVibes: EventVibeMutual[];
  onProfilePress?: (profileId: string) => void;
};

export function MutualVibesSection({ mutualVibes, onProfilePress }: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];

  if (mutualVibes.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Ionicons name="heart" size={20} color="#ec4899" />
        <Text style={[styles.title, { color: theme.text }]}>Mutual Vibes</Text>
        <View style={[styles.badge, { backgroundColor: theme.tintSoft }]}>
          <Text style={[styles.badgeText, { color: theme.tint }]}>
            {mutualVibes.length} match{mutualVibes.length !== 1 ? 'es' : ''}
          </Text>
        </View>
      </View>
      <Text style={[styles.description, { color: theme.mutedForeground }]}>
        You both sent vibes to each other! Make sure to connect during the event 💜
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {mutualVibes.map((v) => (
          <Pressable
            key={v.id}
            onPress={() => onProfilePress?.(v.id)}
            style={({ pressed }) => [
              styles.card,
              { backgroundColor: theme.surface, borderColor: theme.tint + '60' },
              pressed && styles.pressed,
            ]}
          >
            {v.avatar ? (
              <Image source={{ uri: v.avatar }} style={[styles.avatar, { borderColor: theme.tint + '80' }]} />
            ) : (
              <View style={[styles.avatarPlaceholder, { backgroundColor: theme.muted }]}>
                <Ionicons name="person" size={24} color={theme.mutedForeground} />
              </View>
            )}
            <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{v.name.split(' ')[0]}</Text>
            {v.age > 0 && <Text style={[styles.age, { color: theme.mutedForeground }]}>{v.age}</Text>}
            <View style={[styles.mutualBadge, { backgroundColor: theme.tintSoft }]}>
              <Text style={[styles.mutualBadgeText, { color: theme.tint }]}>💜 Mutual</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.xl,
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
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  description: {
    ...typography.body,
    marginBottom: spacing.md,
  },
  scrollContent: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingRight: spacing.lg,
  },
  card: {
    width: CARD_WIDTH,
    padding: spacing.sm,
    borderRadius: radius.xl,
    borderWidth: 2,
    alignItems: 'center',
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    marginBottom: spacing.xs,
  },
  avatarPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  name: {
    fontSize: 14,
    fontWeight: '600',
  },
  age: {
    fontSize: 12,
    marginTop: 2,
  },
  mutualBadge: {
    marginTop: spacing.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  mutualBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.9,
  },
});
