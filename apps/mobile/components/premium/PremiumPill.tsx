/**
 * Small gradient badge "PRO" / "Premium" — tap navigates to Premium screen.
 * Reference: src/components/premium/PremiumPill.tsx
 */
import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { VibelyText } from '@/components/ui';
import { radius } from '@/constants/theme';

export function PremiumPill() {
  const router = useRouter();
  const theme = Colors[useColorScheme()];

  return (
    <Pressable
      onPress={() => router.push('/premium' as const)}
      style={({ pressed }) => [styles.pill, { backgroundColor: theme.tint }, pressed && { opacity: 0.9 }]}
    >
      <Ionicons name="flash" size={12} color="#fff" />
      <VibelyText variant="caption" style={styles.label}>Premium</VibelyText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  label: { color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
});
