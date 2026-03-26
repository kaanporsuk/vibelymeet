import { useEffect, useRef, useState } from 'react';
import { View, Text, Modal, Pressable, StyleSheet, ActivityIndicator, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import { randomRouletteQuestion } from '@/lib/roulettePrompts';
import { formatSendGameEventError, newVibeGameSessionId, useStartRouletteGame } from '@/lib/gamesApi';

type Props = {
  visible: boolean;
  onClose: () => void;
  matchId: string;
  partnerName: string;
};

export function RouletteStartSheet({ visible, onClose, matchId, partnerName }: Props) {
  const theme = Colors[useColorScheme()];
  const insets = useSafeAreaInsets();
  const { mutateAsync, isPending } = useStartRouletteGame();
  const [question, setQuestion] = useState<string>(() => randomRouletteQuestion());
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submitGuard = useRef(false);

  useEffect(() => {
    if (!visible) return;
    setQuestion(randomRouletteQuestion());
    setAnswer('');
    setError(null);
    submitGuard.current = false;
  }, [visible]);

  const shuffleQuestion = () => {
    if (isPending) return;
    setQuestion(randomRouletteQuestion());
    setError(null);
  };

  const handleSend = async () => {
    if (submitGuard.current || isPending) return;
    const mid = matchId.trim();
    const senderAnswer = answer.trim();
    if (!mid) {
      setError('Missing match — try again.');
      return;
    }
    if (!senderAnswer) {
      setError('Your answer is required.');
      return;
    }
    submitGuard.current = true;
    setError(null);
    try {
      const result = await mutateAsync({
        matchId: mid,
        gameSessionId: newVibeGameSessionId(),
        question: question.trim(),
        senderAnswer,
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

  const canSend = answer.trim().length > 0 && !isPending;

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
            <Text style={[styles.sheetTitle, { color: theme.text }]}>Roulette</Text>
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
            Answer a deep question. {partnerName} answers to unlock both responses.
          </Text>

          <View style={[styles.questionCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
            <Text style={[styles.questionLabel, { color: theme.textSecondary }]}>Question</Text>
            <Text style={[styles.questionText, { color: theme.text }]}>“{question}”</Text>
          </View>

          <Pressable
            onPress={shuffleQuestion}
            disabled={isPending}
            style={({ pressed }) => [
              styles.shuffleBtn,
              {
                borderColor: theme.border,
                opacity: isPending ? 0.45 : pressed ? 0.85 : 1,
              },
            ]}
          >
            <Ionicons name="refresh-outline" size={18} color={theme.neonCyan} />
            <Text style={[styles.shuffleLabel, { color: theme.text }]}>Different question</Text>
          </Pressable>

          <Text style={[styles.answerLabel, { color: theme.textSecondary }]}>Your answer (hidden until reply)</Text>
          <TextInput
            value={answer}
            onChangeText={(t) => {
              setAnswer(t);
              if (error) setError(null);
            }}
            placeholder="Type your answer..."
            placeholderTextColor={theme.textSecondary}
            editable={!isPending}
            multiline
            maxLength={500}
            style={[
              styles.answerInput,
              {
                color: theme.text,
                borderColor: theme.border,
                backgroundColor: theme.surfaceSubtle,
              },
            ]}
          />

          {error ? (
            <View style={[styles.errorBox, { borderColor: theme.dangerSoft }]}>
              <Ionicons name="alert-circle-outline" size={18} color={theme.danger} />
              <Text style={[styles.errorText, { color: theme.text }]}>{error}</Text>
            </View>
          ) : null}

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
              <Text style={[styles.sendBtnText, { color: theme.primaryForeground }]}>Send challenge</Text>
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
  questionCard: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  questionLabel: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  questionText: { fontSize: 16, lineHeight: 22, fontStyle: 'italic' },
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
  answerLabel: { fontSize: 12, fontWeight: '600', marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  answerInput: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 92,
    maxHeight: 180,
    textAlignVertical: 'top',
    fontSize: 15,
    lineHeight: 20,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.sm,
  },
  errorText: { flex: 1, fontSize: 14, lineHeight: 20 },
  sendBtn: {
    marginTop: spacing.md,
    paddingVertical: 14,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  sendBtnText: { fontSize: 16, fontWeight: '700' },
});
