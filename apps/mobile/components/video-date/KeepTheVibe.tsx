/**
 * +2 min / +5 min credit extension during DATE phase. Partner not notified.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { spacing, radius } from '@/constants/theme';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type Props = {
  extraTimeCredits: number;
  extendedVibeCredits: number;
  onExtend: (minutes: number, type: 'extra_time' | 'extended_vibe') => Promise<boolean>;
  isExtending?: boolean;
};

export function KeepTheVibe({
  extraTimeCredits,
  extendedVibeCredits,
  onExtend,
  isExtending = false,
}: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const hasCredits = extraTimeCredits > 0 || extendedVibeCredits > 0;

  const handleExtend = async (minutes: number, type: 'extra_time' | 'extended_vibe') => {
    if (isExtending) return;
    await onExtend(minutes, type);
  };

  if (!hasCredits) {
    return (
      <View style={styles.wrap}>
        <Text style={[styles.hint, { color: theme.mutedForeground }]}>Get credits for +time</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {extraTimeCredits > 0 && (
        <Pressable
          disabled={isExtending}
          onPress={() => handleExtend(2, 'extra_time')}
          style={({ pressed }) => [
            styles.pill,
            { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder },
            pressed && styles.pressed,
          ]}
        >
          {isExtending ? (
            <ActivityIndicator size="small" color={theme.tint} />
          ) : (
            <>
              <Text style={styles.pillIcon}>⏱</Text>
              <Text style={[styles.pillText, { color: theme.text }]}>+2 min</Text>
              <Text style={[styles.pillCount, { color: theme.mutedForeground }]}>({extraTimeCredits})</Text>
            </>
          )}
        </Pressable>
      )}
      {extendedVibeCredits > 0 && (
        <Pressable
          disabled={isExtending}
          onPress={() => handleExtend(5, 'extended_vibe')}
          style={({ pressed }) => [
            styles.pill,
            { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder },
            pressed && styles.pressed,
          ]}
        >
          {isExtending ? (
            <ActivityIndicator size="small" color={theme.accent} />
          ) : (
            <>
              <Text style={styles.pillIcon}>✨</Text>
              <Text style={[styles.pillText, { color: theme.text }]}>+5 min</Text>
              <Text style={[styles.pillCount, { color: theme.mutedForeground }]}>({extendedVibeCredits})</Text>
            </>
          )}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    gap: spacing.xs,
  },
  pillIcon: {
    fontSize: 12,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  pillCount: {
    fontSize: 11,
  },
  hint: {
    fontSize: 11,
  },
  pressed: {
    opacity: 0.8,
  },
});
