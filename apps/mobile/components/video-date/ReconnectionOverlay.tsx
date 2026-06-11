/**
 * Shown when partner disconnects. Countdown is **server-owned** (`reconnect_grace_ends_at` via `sync_reconnect`); timer pauses.
 */

import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { typography, spacing } from '@/constants/theme';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type Props = {
  isVisible: boolean;
  partnerName: string;
  graceTimeLeft: number;
  mode?: 'partner_away' | 'network_interrupted';
  networkTier?: 'good' | 'fair' | 'poor';
  backdropImageUrl?: string | null;
};

export function ReconnectionOverlay({
  isVisible,
  partnerName,
  graceTimeLeft,
  mode = 'partner_away',
  networkTier = 'good',
  backdropImageUrl = null,
}: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];

  if (!isVisible) return null;

  const title =
    mode === 'network_interrupted'
      ? 'Reconnecting gently...'
      : `Keeping the room open for ${partnerName}`;
  const subtitle =
    mode === 'network_interrupted'
      ? "The connection softened. We'll hold the room for a few seconds."
      : "They may be stepping back in. We'll hold this gently.";

  return (
    <View style={styles.overlay}>
      {backdropImageUrl ? (
        <Image
          source={{ uri: backdropImageUrl }}
          style={styles.backdropImage}
          resizeMode="cover"
          blurRadius={18}
        />
      ) : null}
      <View style={styles.backdropWash} />
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
        <Text style={[styles.subtitle, { color: theme.mutedForeground }]}>{subtitle}</Text>
        <View style={styles.countdown}>
          <Text style={[styles.countdownNum, { color: theme.text }]}>{graceTimeLeft}s</Text>
        </View>
        {networkTier !== 'good' ? (
          <View style={[styles.resiliencePill, { borderColor: theme.border }]}>
            <Text style={[styles.resilienceText, { color: theme.mutedForeground }]}>
              {networkTier === 'poor' ? 'Audio priority mode' : 'Stabilizing video'}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 40,
  },
  backdropImage: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.68,
    transform: [{ scale: 1.08 }],
  },
  backdropWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  card: {
    padding: spacing['2xl'],
    borderRadius: 24,
    borderWidth: 1,
    maxWidth: 320,
    alignItems: 'center',
  },
  title: {
    ...typography.titleMD,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.body,
    marginBottom: spacing.lg,
    textAlign: 'center',
  },
  countdown: {
    alignItems: 'center',
  },
  countdownNum: {
    fontSize: 28,
    fontWeight: '700',
  },
  resiliencePill: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  resilienceText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
