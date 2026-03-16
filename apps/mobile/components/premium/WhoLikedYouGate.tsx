/**
 * Blurred "X people like you" section with CTA to Premium. Shown when !isPremium and count > 0.
 * Reference: src/components/premium/WhoLikedYouGate.tsx
 */
import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { VibelyText, VibelyButton } from '@/components/ui';
import { withAlpha } from '@/lib/colorUtils';
import { spacing, radius } from '@/constants/theme';

type WhoLikedYouGateProps = { count: number };

export function WhoLikedYouGate({ count }: WhoLikedYouGateProps) {
  const router = useRouter();
  const theme = Colors[useColorScheme()];

  if (count === 0) return null;

  return (
    <View style={[styles.wrap, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
      {/* Blurred avatar row */}
      <View style={styles.avatarRow} pointerEvents="none">
        {Array.from({ length: Math.min(count, 5) }).map((_, i) => (
          <View
            key={i}
            style={[styles.blurAvatar, { backgroundColor: theme.tintSoft }]}
          />
        ))}
      </View>
      <BlurView intensity={60} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[styles.overlay, { backgroundColor: withAlpha(theme.background, 0.6) }]}>
        <View style={[styles.lockIcon, { backgroundColor: theme.tintSoft }]}>
          <Ionicons name="lock-closed" size={20} color={theme.tint} />
        </View>
        <VibelyText variant="body" style={[styles.title, { color: theme.text }]}>
          {count} {count === 1 ? 'person likes' : 'people like'} you
        </VibelyText>
        <VibelyText variant="caption" style={{ color: theme.textSecondary }}>See who likes you</VibelyText>
        <Pressable
          onPress={() => router.push('/premium' as const)}
          style={({ pressed }) => [styles.cta, { backgroundColor: theme.tint }, pressed && { opacity: 0.9 }]}
        >
          <VibelyText variant="body" style={styles.ctaLabel}>Unlock with Premium</VibelyText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: spacing.lg,
    marginVertical: spacing.md,
    borderRadius: radius['2xl'],
    overflow: 'hidden',
    borderWidth: 1,
    minHeight: 140,
  },
  avatarRow: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    justifyContent: 'center',
  },
  blurAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: 4,
  },
  lockIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: { fontWeight: '600', textAlign: 'center' },
  cta: {
    marginTop: spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
  },
  ctaLabel: { color: '#fff', fontWeight: '600' },
});
