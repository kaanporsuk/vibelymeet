/**
 * Ready-gate overlay — visual parity with web: backdrop, card, partner cue, countdown ring, Ready / Skip.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, Image } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { Card, VibelyButton } from '@/components/ui';
import { withAlpha } from '@/lib/colorUtils';
import { spacing, radius, typography } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';

const RING_SIZE = 88;
const STROKE = 4;
const R = (RING_SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;
const COUNTDOWN_SEC = 30;

export type ReadyGateOverlayProps = {
  sessionId: string;
  partnerName?: string | null;
  partnerImageUri?: string | null;
  onReady: () => void;
  onClose: () => void;
};

export function ReadyGateOverlay({ partnerName, partnerImageUri, onReady, onClose }: ReadyGateOverlayProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const [countdown, setCountdown] = useState(COUNTDOWN_SEC);

  useEffect(() => {
    setCountdown(COUNTDOWN_SEC);
    const id = setInterval(() => {
      setCountdown((c) => (c <= 0 ? 0 : c - 1));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const progress = countdown / COUNTDOWN_SEC;
  const dashOffset = CIRC * (1 - progress);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: 'rgba(0,0,0,0.72)' }]} pointerEvents="auto">
        <Card variant="glass" style={[styles.card, { borderColor: theme.glassBorder }]}>
          <View style={styles.ringWrap}>
            <Svg width={RING_SIZE} height={RING_SIZE} style={styles.ringSvg}>
              <Circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={R}
                fill="none"
                stroke={theme.muted}
                strokeWidth={STROKE}
                opacity={0.35}
              />
              <Circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={R}
                fill="none"
                stroke={theme.tint}
                strokeWidth={STROKE}
                strokeDasharray={CIRC}
                strokeDashoffset={dashOffset}
                strokeLinecap="round"
                transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
              />
            </Svg>
            <Text style={[styles.countdownNum, { color: theme.text }]}>{Math.max(0, countdown)}</Text>
          </View>

          <Text style={[styles.title, { color: theme.text }]}>Ready to vibe?</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            You matched with {partnerName || 'someone'}!
          </Text>

          <Text style={[styles.waitingLine, { color: theme.mutedForeground }]}>
            Waiting for {partnerName ?? 'your match'}... ({Math.max(0, countdown)}s)
          </Text>

          <View style={[styles.avatarWrap, { borderColor: withAlpha(theme.tint, 0.31), backgroundColor: theme.surfaceSubtle }]}>
            {partnerImageUri ? (
              <Image source={{ uri: partnerImageUri }} style={styles.avatarImage} />
            ) : (
              <Ionicons name="person" size={48} color={theme.textSecondary} />
            )}
          </View>

          <VibelyButton label="I'm Ready ✨" onPress={onReady} variant="primary" size="lg" style={styles.readyBtn} />
          <Pressable onPress={onClose} style={({ pressed }) => [styles.skipWrap, pressed && { opacity: 0.8 }]}>
            <Text style={[styles.skipText, { color: theme.textSecondary }]}>Skip this one</Text>
          </Pressable>
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    padding: spacing.xl + spacing.md,
    alignItems: 'center',
  },
  ringWrap: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  ringSvg: { position: 'absolute' },
  countdownNum: {
    fontSize: 22,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  title: {
    ...typography.titleLG,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  waitingLine: {
    fontSize: 14,
    marginBottom: spacing.lg,
    textAlign: 'center',
  },
  avatarWrap: {
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  readyBtn: {
    alignSelf: 'stretch',
    marginBottom: spacing.lg,
  },
  skipWrap: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  skipText: {
    fontSize: 13,
  },
});
