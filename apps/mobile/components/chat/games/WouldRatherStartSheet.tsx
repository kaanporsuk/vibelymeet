import { useEffect, useRef, useState } from 'react';
import { View, Text, Modal, Pressable, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import { randomWouldRatherPrompt, type WouldRatherPromptPair } from '@/lib/wouldRatherPrompts';
import { formatSendGameEventError, newVibeGameSessionId, useStartWouldRatherGame } from '@/lib/gamesApi';

type Props = {
  visible: boolean;
  onClose: () => void;
  matchId: string;
  partnerName: string;
};

export function WouldRatherStartSheet({ visible, onClose, matchId, partnerName }: Props) {
  const theme = Colors[useColorScheme()];
  const insets = useSafeAreaInsets();
  const { mutateAsync, isPending } = useStartWouldRatherGame();
  const [pair, setPair] = useState<WouldRatherPromptPair>(() => randomWouldRatherPrompt());
  const [senderVote, setSenderVote] = useState<'A' | 'B' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submitGuard = useRef(false);

  useEffect(() => {
    if (!visible) return;
    setPair(randomWouldRatherPrompt());
    setSenderVote(null);
    setError(null);
    submitGuard.current = false;
  }, [visible]);

  const shuffle = () => {
    if (isPending) return;
    setPair(randomWouldRatherPrompt());
    setSenderVote(null);
    setError(null);
  };

  const handleSend = async () => {
    if (submitGuard.current || isPending) return;
    if (!senderVote) return;
    const mid = matchId.trim();
    if (!mid) {
      setError('Missing match — try again.');
      return;
    }
    submitGuard.current = true;
    setError(null);
    try {
      const gameSessionId = newVibeGameSessionId();
      const result = await mutateAsync({
        matchId: mid,
        gameSessionId,
        optionA: pair.option_a,
        optionB: pair.option_b,
        senderVote,
      });
      if (!result.ok) {
        setError(formatSendGameEventError(result.error));
        return;
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      submitGuard.current = false;
    }
  };

  const canSend = !!senderVote && !isPending;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={isPending ? undefined : onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={isPending ? undefined : onClose} accessibilityLabel="Dismiss" />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.surface,
              borderColor: theme.border,
              paddingBottom: Math.max(insets.bottom, spacing.lg),
            },
          ]}
        >
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: theme.text }]}>Would You Rather</Text>
            <Pressable
              onPress={onClose}
              disabled={isPending}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={26} color={isPending ? theme.textSecondary : theme.text} />
            </Pressable>
          </View>
          <Text style={[styles.sheetSubtitle, { color: theme.textSecondary }]}>
            Choose A or B for yourself, then send this round to {partnerName}.
          </Text>

          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={[styles.optionCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
              <Text style={[styles.optionLabel, { color: theme.textSecondary }]}>A</Text>
              <Text style={[styles.optionCopy, { color: theme.text }]}>{pair.option_a}</Text>
            </View>
            <View style={[styles.optionCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
              <Text style={[styles.optionLabel, { color: theme.textSecondary }]}>B</Text>
              <Text style={[styles.optionCopy, { color: theme.text }]}>{pair.option_b}</Text>
            </View>

            <Pressable
              onPress={shuffle}
              disabled={isPending}
              style={({ pressed }) => [
                styles.shuffleBtn,
                {
                  borderColor: theme.border,
                  opacity: isPending ? 0.45 : pressed ? 0.85 : 1,
                },
              ]}
            >
              <Ionicons name="shuffle-outline" size={18} color={theme.neonViolet} />
              <Text style={[styles.shuffleLabel, { color: theme.text }]}>New pair</Text>
            </Pressable>

            <Text style={[styles.pickTitle, { color: theme.textSecondary }]}>Your pick (required)</Text>
            <View style={styles.pickRow}>
              <Pressable
                onPress={() => !isPending && setSenderVote('A')}
                disabled={isPending}
                style={[
                  styles.pickChip,
                  {
                    borderColor: senderVote === 'A' ? theme.neonPink : theme.border,
                    backgroundColor: senderVote === 'A' ? 'rgba(236,72,153,0.12)' : theme.muted,
                  },
                ]}
              >
                <Text style={[styles.pickChipText, { color: theme.text }]}>My pick: A</Text>
              </Pressable>
              <Pressable
                onPress={() => !isPending && setSenderVote('B')}
                disabled={isPending}
                style={[
                  styles.pickChip,
                  {
                    borderColor: senderVote === 'B' ? theme.neonPink : theme.border,
                    backgroundColor: senderVote === 'B' ? 'rgba(236,72,153,0.12)' : theme.muted,
                  },
                ]}
              >
                <Text style={[styles.pickChipText, { color: theme.text }]}>My pick: B</Text>
              </Pressable>
            </View>

            {error ? (
              <View style={[styles.errorBox, { borderColor: theme.dangerSoft }]}>
                <Ionicons name="alert-circle-outline" size={18} color={theme.danger} />
                <Text style={[styles.errorText, { color: theme.text }]}>{error}</Text>
              </View>
            ) : null}
          </ScrollView>

          <Pressable
            onPress={() => void handleSend()}
            disabled={!canSend}
            style={({ pressed }) => [
              styles.sendBtn,
              {
                backgroundColor: theme.tint,
                opacity: !canSend ? 0.45 : pressed ? 0.9 : 1,
              },
            ]}
          >
            {isPending ? (
              <ActivityIndicator color={theme.primaryForeground} />
            ) : (
              <Text style={[styles.sendBtnText, { color: theme.primaryForeground }]}>Send round</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    zIndex: 0,
  },
  sheet: {
    zIndex: 1,
    borderTopLeftRadius: radius['2xl'],
    borderTopRightRadius: radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    maxHeight: '88%',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  sheetSubtitle: {
    fontSize: 13,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  scroll: {
    maxHeight: 360,
  },
  optionCard: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  optionLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  optionCopy: {
    fontSize: 16,
    lineHeight: 22,
  },
  shuffleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  shuffleLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  pickTitle: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pickRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  pickChip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.button,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  pickChipText: {
    fontSize: 15,
    fontWeight: '600',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.sm,
  },
  errorText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  sendBtn: {
    marginTop: spacing.sm,
    paddingVertical: 14,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  sendBtnText: {
    fontSize: 16,
    fontWeight: '700',
  },
});
