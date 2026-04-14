/**
 * Shown when partner disconnects. Countdown is **server-owned** (`reconnect_grace_ends_at` via `sync_reconnect`); timer pauses.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { typography, spacing } from '@/constants/theme';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type Props = {
  isVisible: boolean;
  partnerName: string;
  graceTimeLeft: number;
};

export function ReconnectionOverlay({ isVisible, partnerName, graceTimeLeft }: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];

  if (!isVisible) return null;

  return (
    <View style={styles.overlay}>
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[styles.title, { color: theme.text }]}>Reconnecting with {partnerName}...</Text>
        <Text style={[styles.subtitle, { color: theme.mutedForeground }]}>Hang tight — they might be back! ⏳</Text>
        <View style={styles.countdown}>
          <Text style={[styles.countdownNum, { color: theme.text }]}>{graceTimeLeft}s</Text>
        </View>
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
});
