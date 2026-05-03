/**
 * Ice breaker card: shows one synchronized conversation-starter question.
 */

import React from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, radius, spacing, layout } from '@/constants/theme';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type Props = {
  question: string;
  onDismiss?: () => void;
  onShuffle?: () => void;
};

export function IceBreakerCard({ question, onDismiss, onShuffle }: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];

  return (
    <View
      style={[styles.card, { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder }]}
      accessibilityRole="text"
      accessibilityLabel={`Ice-breaker question: ${question}`}
    >
      <Text style={[styles.question, { color: theme.text }]} numberOfLines={2}>
        {question}
      </Text>
      <View style={styles.actions}>
        {onShuffle ? (
          <Pressable
            onPress={onShuffle}
            style={({ pressed }) => [
              styles.iconBtn,
              { backgroundColor: theme.muted, opacity: pressed ? 0.82 : 1 },
            ]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Show another ice-breaker question"
          >
            <Ionicons name="refresh" size={18} color={theme.mutedForeground} />
          </Pressable>
        ) : null}
        {onDismiss ? (
          <Pressable
            onPress={onDismiss}
            style={({ pressed }) => [
              styles.iconBtn,
              { backgroundColor: theme.muted, opacity: pressed ? 0.82 : 1 },
            ]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Hide ice-breaker question for 30 seconds"
          >
            <Ionicons name="close" size={18} color={theme.mutedForeground} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: layout.contentWidth,
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius['2xl'],
    borderWidth: 1,
    gap: spacing.sm,
  },
  question: {
    flex: 1,
    ...typography.body,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  iconBtn: {
    width: layout.minTouchTargetSize,
    height: layout.minTouchTargetSize,
    borderRadius: layout.minTouchTargetSize / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
