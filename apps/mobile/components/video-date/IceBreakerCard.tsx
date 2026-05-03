/**
 * Ice breaker card: shows one synchronized conversation-starter question.
 */

import React from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, layout } from '@/constants/theme';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type Props = {
  question: string;
  onDismiss?: () => void;
  onShuffle?: () => void;
  helperText?: string;
};

export function IceBreakerCard({
  question,
  onDismiss,
  onShuffle,
  helperText = 'Choose when it feels right',
}: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];

  return (
    <View
      style={[styles.card, { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder }]}
      accessibilityRole="text"
      accessibilityLabel={`Ice-breaker question: ${question}`}
    >
      <View style={[styles.accentRail, { backgroundColor: theme.tint }]} />
      <View style={[styles.promptIcon, { backgroundColor: theme.tintSoft, borderColor: 'rgba(139,92,246,0.24)' }]}>
        <Ionicons name="sparkles" size={16} color={theme.tint} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.question, { color: theme.text }]} numberOfLines={2}>
          {question}
        </Text>
        {helperText ? (
          <Text style={[styles.helper, { color: theme.mutedForeground }]} numberOfLines={1}>
            {helperText}
          </Text>
        ) : null}
      </View>
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
            accessibilityLabel="Hide ice-breaker question"
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
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: 22,
    borderWidth: 1,
    gap: spacing.sm,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.3,
    shadowRadius: 28,
    elevation: 7,
  },
  accentRail: {
    position: 'absolute',
    left: 0,
    top: 12,
    bottom: 12,
    width: 4,
    borderTopRightRadius: 999,
    borderBottomRightRadius: 999,
  },
  promptIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  question: {
    ...typography.body,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  helper: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500',
    opacity: 0.82,
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
