import { useEffect, useRef, useState } from 'react';
import { View, Text, Modal, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import { randomIntuitionOptions } from '@/lib/intuitionPrompts';
import {
  formatSendGameEventError,
  newVibeGameSessionId,
  useStartIntuitionGame,
  type ThreadInvalidateScope,
} from '@/lib/gamesApi';

type Props = {
  visible: boolean;
  onClose: () => void;
  matchId: string;
  partnerName: string;
  invalidateScope: ThreadInvalidateScope;
};

export function IntuitionStartSheet({ visible, onClose, matchId, partnerName, invalidateScope }: Props) {
  const theme = Colors[useColorScheme()];
  const insets = useSafeAreaInsets();
  const { mutateAsync, isPending } = useStartIntuitionGame();
  const [options, setOptions] = useState<readonly [string, string]>(() => randomIntuitionOptions());
  const [senderChoice, setSenderChoice] = useState<0 | 1 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submitGuard = useRef(false);

  useEffect(() => {
    if (!visible) return;
    setOptions(randomIntuitionOptions());
    setSenderChoice(null);
    setError(null);
    submitGuard.current = false;
  }, [visible]);

  const shuffle = () => {
    if (isPending) return;
    setOptions(randomIntuitionOptions());
    setSenderChoice(null);
    setError(null);
  };

  const handleSend = async () => {
    if (submitGuard.current || isPending) return;
    if (senderChoice == null) return;
    const mid = matchId.trim();
    if (!mid) {
      setError('Missing match — try again.');
      return;
    }
    submitGuard.current = true;
    setError(null);
    try {
      const result = await mutateAsync({
        matchId: mid,
        gameSessionId: newVibeGameSessionId(),
        options: [options[0], options[1]],
        senderChoice,
        invalidateScope,
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
            <Text style={[styles.sheetTitle, { color: theme.text }]}>Intuition Test</Text>
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
            Pick what you think {partnerName} prefers.
          </Text>

          <View style={styles.optionsStack}>
            {[0, 1].map((n) => {
              const idx = n as 0 | 1;
              return (
                <Pressable
                  key={idx}
                  onPress={() => !isPending && setSenderChoice(idx)}
                  disabled={isPending}
                  style={[
                    styles.optionCard,
                    {
                      borderColor: senderChoice === idx ? theme.neonViolet : theme.border,
                      backgroundColor: senderChoice === idx ? 'rgba(139,92,246,0.12)' : theme.surfaceSubtle,
                    },
                  ]}
                >
                  <Text style={[styles.optionText, { color: theme.text }]}>{options[idx]}</Text>
                </Pressable>
              );
            })}
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

          {error ? (
            <View style={[styles.errorBox, { borderColor: theme.dangerSoft }]}>
              <Ionicons name="alert-circle-outline" size={18} color={theme.danger} />
              <Text style={[styles.errorText, { color: theme.text }]}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            onPress={() => void handleSend()}
            disabled={senderChoice == null || isPending}
            style={({ pressed }) => [
              styles.sendBtn,
              {
                backgroundColor: theme.tint,
                opacity: senderChoice == null || isPending ? 0.45 : pressed ? 0.9 : 1,
              },
            ]}
          >
            {isPending ? (
              <ActivityIndicator color={theme.primaryForeground} />
            ) : (
              <Text style={[styles.sendBtnText, { color: theme.primaryForeground }]}>Send prediction</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)', zIndex: 0 },
  sheet: {
    zIndex: 1,
    borderTopLeftRadius: radius['2xl'],
    borderTopRightRadius: radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: 20, fontWeight: '700' },
  sheetSubtitle: { fontSize: 13, marginTop: spacing.sm, marginBottom: spacing.md, lineHeight: 18 },
  optionsStack: { gap: spacing.sm, marginBottom: spacing.md },
  optionCard: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  optionText: { fontSize: 16, fontWeight: '600' },
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
  shuffleLabel: { fontSize: 15, fontWeight: '600' },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.sm,
  },
  errorText: { flex: 1, fontSize: 14, lineHeight: 20 },
  sendBtn: {
    marginTop: spacing.sm,
    paddingVertical: 14,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  sendBtnText: { fontSize: 16, fontWeight: '700' },
});
