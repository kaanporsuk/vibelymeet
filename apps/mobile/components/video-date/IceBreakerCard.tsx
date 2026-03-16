/**
 * Ice breaker card: shows one conversation-starter question.
 * Parent controls questions array and rotation every 30s; auto-hide after 30s of handshake.
 */

import React from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { typography, radius, spacing } from '@/constants/theme';
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
    <Pressable
      onPress={onDismiss}
      style={[styles.card, { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder }]}
    >
      <Text style={[styles.question, { color: theme.text }]} numberOfLines={2}>
        {question}
      </Text>
      {onShuffle ? (
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            onShuffle();
          }}
          style={[styles.shuffleBtn, { backgroundColor: theme.muted }]}
        >
          <Text style={[styles.shuffleLabel, { color: theme.mutedForeground }]}>↻</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius['2xl'],
    borderWidth: 1,
    maxHeight: 60,
    gap: spacing.sm,
  },
  question: {
    flex: 1,
    ...typography.body,
    fontSize: 14,
  },
  shuffleBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shuffleLabel: {
    fontSize: 14,
  },
});
