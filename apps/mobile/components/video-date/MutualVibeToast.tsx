/**
 * "You both vibed! 💚" celebration toast; on complete transition to DATE phase.
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { typography, spacing } from '@/constants/theme';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type Props = {
  onComplete: () => void;
};

export function MutualVibeToast({ onComplete }: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, damping: 15 }),
    ]).start();
    const t = setTimeout(onComplete, 2200);
    return () => clearTimeout(t);
  }, [onComplete, opacity, scale]);

  return (
    <Animated.View style={[styles.overlay, { opacity }]} pointerEvents="none">
      <Animated.View
        style={[
          styles.card,
          { backgroundColor: theme.surface, borderColor: theme.tint },
          { transform: [{ scale }] },
        ]}
      >
        <Text style={styles.emoji}>✨</Text>
        <Text style={[styles.title, { color: theme.text }]}>You both vibed! 💚</Text>
        <Text style={[styles.subtitle, { color: theme.mutedForeground }]}>Enjoy your date — 5 minutes on the clock</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 50,
  },
  card: {
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing['2xl'],
    borderRadius: 24,
    borderWidth: 2,
    alignItems: 'center',
    maxWidth: 300,
  },
  emoji: {
    fontSize: 40,
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.titleMD,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.body,
    textAlign: 'center',
  },
});
