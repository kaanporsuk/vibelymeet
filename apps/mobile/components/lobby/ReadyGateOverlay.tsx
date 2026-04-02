/**
 * In-lobby ready gate: server-backed `ready_gate_transition` + realtime, aligned with web ReadyGateOverlay.
 * No visual redesign — behavior and state machine parity only.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, Image, ActivityIndicator } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { Card, VibelyButton } from '@/components/ui';
import { withAlpha } from '@/lib/colorUtils';
import { spacing, radius, typography } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { useReadyGate } from '@/lib/readyGateApi';
import { updateParticipantStatus } from '@/lib/videoDateApi';
import { useVibelyDialog } from '@/components/VibelyDialog';

const RING_SIZE = 88;
const STROKE = 4;
const R = (RING_SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;
const GATE_TIMEOUT_SEC = 30;

export type ReadyGateOverlayProps = {
  sessionId: string;
  eventId: string;
  userId: string;
  partnerImageUri?: string | null;
  onNavigateToDate: (sessionId: string) => void;
  onClose: () => void;
};

export function ReadyGateOverlay({
  sessionId,
  eventId,
  userId,
  partnerImageUri,
  onNavigateToDate,
  onClose,
}: ReadyGateOverlayProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { show } = useVibelyDialog();
  const closedRef = useRef(false);
  const [timeLeft, setTimeLeft] = useState(GATE_TIMEOUT_SEC);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const handleBothReady = useCallback(async () => {
    if (closedRef.current) return;
    closedRef.current = true;
    setIsTransitioning(true);
    await updateParticipantStatus(eventId, userId, 'in_date');
    setTimeout(() => {
      onNavigateToDate(sessionId);
    }, 1200);
  }, [eventId, userId, sessionId, onNavigateToDate]);

  const handleForfeited = useCallback(
    async (_reason: 'timeout' | 'skip') => {
      if (closedRef.current) return;
      closedRef.current = true;
      await updateParticipantStatus(eventId, userId, 'browsing');
      show({
        title: _reason === 'timeout' ? "They weren't ready" : 'No worries',
        message:
          _reason === 'timeout'
            ? 'Back to browsing — your deck is waiting.'
            : 'Back to browsing 💚',
        variant: 'info',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
      onClose();
    },
    [eventId, userId, show, onClose],
  );

  const {
    iAmReady,
    partnerReady,
    partnerName,
    snoozedByPartner,
    markReady,
    forfeit,
    isBothReady,
  } = useReadyGate(sessionId, userId, {
    onBothReady: handleBothReady,
    onForfeited: handleForfeited,
  });

  useEffect(() => {
    closedRef.current = false;
    setTimeLeft(GATE_TIMEOUT_SEC);
    setIsTransitioning(false);
  }, [sessionId]);

  useEffect(() => {
    void updateParticipantStatus(eventId, userId, 'in_ready_gate');
  }, [eventId, userId]);

  useEffect(() => {
    if (isTransitioning || iAmReady || snoozedByPartner) return;
    const id = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 0) return 0;
        if (prev === 1) {
          void forfeit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [isTransitioning, iAmReady, snoozedByPartner, forfeit]);

  const progress = timeLeft / GATE_TIMEOUT_SEC;
  const dashOffset = CIRC * (1 - progress);

  const handleSkip = () => {
    closedRef.current = true;
    void forfeit();
    void updateParticipantStatus(eventId, userId, 'browsing');
    onClose();
  };

  const displayName = partnerName || 'someone';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={handleSkip}>
      <View style={[styles.backdrop, { backgroundColor: 'rgba(0,0,0,0.8)' }]} pointerEvents="auto">
        {isTransitioning || isBothReady ? (
          <Card variant="glass" style={[styles.card, { borderColor: theme.glassBorder }]}>
            <ActivityIndicator size="large" color={theme.tint} />
            <Text style={[styles.title, { color: theme.text, marginTop: spacing.lg }]}>
              Connecting your vibe date...
            </Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Get ready to shine ✨</Text>
          </Card>
        ) : (
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
              {!iAmReady && (
                <Text style={[styles.countdownNum, { color: theme.text }]}>{Math.max(0, timeLeft)}</Text>
              )}
            </View>

            <Text style={[styles.title, { color: theme.text }]}>Ready to vibe?</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
              You matched with {displayName}!
            </Text>

            {partnerReady && !iAmReady ? (
              <View style={styles.partnerReadyRow}>
                <Ionicons name="checkmark-circle" size={18} color={theme.success} />
                <Text style={[styles.partnerReadyText, { color: theme.success }]}>
                  {displayName} is ready!
                </Text>
              </View>
            ) : null}

            {snoozedByPartner ? (
              <View style={styles.partnerReadyRow}>
                <Ionicons name="time-outline" size={18} color={theme.textSecondary} />
                <Text style={[styles.subtleLine, { color: theme.textSecondary }]}>
                  {displayName} needs a moment...
                </Text>
              </View>
            ) : null}

            <View
              style={[
                styles.avatarWrap,
                { borderColor: withAlpha(theme.tint, 0.31), backgroundColor: theme.surfaceSubtle },
              ]}
            >
              {partnerImageUri ? (
                <Image source={{ uri: partnerImageUri }} style={styles.avatarImage} />
              ) : (
                <Ionicons name="person" size={48} color={theme.textSecondary} />
              )}
            </View>

            {!iAmReady ? (
              <>
                <VibelyButton
                  label="I'm Ready ✨"
                  onPress={() => void markReady()}
                  variant="primary"
                  size="lg"
                  style={styles.readyBtn}
                />
                <Pressable onPress={handleSkip} style={({ pressed }) => [styles.skipWrap, pressed && { opacity: 0.8 }]}>
                  <Text style={[styles.skipText, { color: theme.textSecondary }]}>Skip this one</Text>
                </Pressable>
              </>
            ) : (
              <>
                <View style={[styles.waitingPill, { borderColor: withAlpha(theme.tint, 0.35), backgroundColor: theme.tintSoft }]}>
                  <Ionicons name="checkmark-circle" size={18} color={theme.tint} />
                  <Text style={[styles.waitingPillText, { color: theme.text }]}>
                    Waiting for {displayName}...
                  </Text>
                </View>
                <Pressable onPress={handleSkip} style={({ pressed }) => [styles.skipWrap, pressed && { opacity: 0.8 }]}>
                  <Text style={[styles.skipText, { color: theme.textSecondary }]}>Cancel & go back</Text>
                </Pressable>
              </>
            )}
          </Card>
        )}
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
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  partnerReadyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: spacing.md,
  },
  partnerReadyText: { fontSize: 14, fontWeight: '600' },
  subtleLine: { fontSize: 14 },
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
  waitingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    borderWidth: 1,
    marginBottom: spacing.lg,
  },
  waitingPillText: { fontSize: 14, fontWeight: '600' },
});
