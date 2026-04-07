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
  onGetCredits?: () => void;
};

export function KeepTheVibe({
  extraTimeCredits,
  extendedVibeCredits,
  onExtend,
  isExtending = false,
  onGetCredits,
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
        {onGetCredits ? (
          <Pressable
            onPress={onGetCredits}
            style={({ pressed }) => [
              styles.getCreditsPill,
              { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder },
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Get video date credits"
            accessibilityHint="Opens credits in settings. Your date stays active."
          >
            <Text style={[styles.getCreditsTitle, { color: theme.text }]}>Get Credits</Text>
            <Text style={[styles.getCreditsSub, { color: theme.mutedForeground }]}>Extra Time: +2 min</Text>
            <Text style={[styles.getCreditsSub, { color: theme.mutedForeground }]}>Extended Vibe: +5 min</Text>
          </Pressable>
        ) : (
          <Text style={[styles.hint, { color: theme.mutedForeground }]}>Get credits for +time</Text>
        )}
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
          accessibilityRole="button"
          accessibilityLabel={`Add 2 minutes with Extra Time, ${extraTimeCredits} credit${extraTimeCredits === 1 ? '' : 's'} left`}
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
          accessibilityRole="button"
          accessibilityLabel={`Add 5 minutes with Extended Vibe, ${extendedVibeCredits} credit${extendedVibeCredits === 1 ? '' : 's'} left`}
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
  getCreditsPill: {
    flexDirection: 'column',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    gap: 2,
  },
  getCreditsTitle: {
    fontSize: 12,
    fontWeight: '600',
  },
  getCreditsSub: {
    fontSize: 11,
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
