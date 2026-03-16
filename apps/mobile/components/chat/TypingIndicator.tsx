/**
 * Animated typing dots shown when partner is typing. Reference: src/components/chat/TypingIndicator.tsx
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';

export function TypingIndicator() {
  const theme = Colors[useColorScheme()];
  const anims = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];

  useEffect(() => {
    const loops = anims.map((a, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(a, { toValue: 1, duration: 300, delay: i * 100, useNativeDriver: true }),
          Animated.timing(a, { toValue: 0, duration: 300, useNativeDriver: true }),
        ])
      )
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, []);

  return (
    <View style={styles.wrap}>
      <View style={[styles.bubble, { backgroundColor: theme.surfaceSubtle }]}>
        {anims.map((a, i) => (
          <Animated.View
            key={i}
            style={[
              styles.dot,
              { backgroundColor: theme.tint },
              {
                opacity: a.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }),
                transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }],
              },
            ]}
          />
        ))}
      </View>
      <Text style={[styles.label, { color: theme.textSecondary }]}>Vibing...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius['2xl'],
    borderBottomLeftRadius: 4,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontSize: 12 },
});
