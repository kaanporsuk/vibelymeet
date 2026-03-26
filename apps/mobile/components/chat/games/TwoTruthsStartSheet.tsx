import { useEffect, useRef, useState } from 'react';
import { View, Text, Modal, Pressable, StyleSheet, ActivityIndicator, ScrollView, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import { formatSendGameEventError, newVibeGameSessionId, useStartTwoTruthsGame } from '@/lib/gamesApi';

type Props = {
  visible: boolean;
  onClose: () => void;
  matchId: string;
  partnerName: string;
};

export function TwoTruthsStartSheet({ visible, onClose, matchId, partnerName }: Props) {
  const theme = Colors[useColorScheme()];
  const insets = useSafeAreaInsets();
  const { mutateAsync, isPending } = useStartTwoTruthsGame();
  const [statements, setStatements] = useState<[string, string, string]>(['', '', '']);
  const [lieIndex, setLieIndex] = useState<0 | 1 | 2>(2);
  const [error, setError] = useState<string | null>(null);
  const submitGuard = useRef(false);

  useEffect(() => {
    if (!visible) return;
    setStatements(['', '', '']);
    setLieIndex(2);
    setError(null);
    submitGuard.current = false;
  }, [visible]);

  const updateStatement = (i: 0 | 1 | 2, value: string) => {
    setStatements((prev) => {
      const next: [string, string, string] = [prev[0], prev[1], prev[2]];
      next[i] = value;
      return next;
    });
    setError(null);
  };

  const handleSend = async () => {
    if (submitGuard.current || isPending) return;
    const mid = matchId.trim();
    if (!mid) {
      setError('Missing match — try again.');
      return;
    }
    const cleaned = statements.map((s) => s.trim()) as [string, string, string];
    if (!cleaned[0] || !cleaned[1] || !cleaned[2]) {
      setError('All three statements are required.');
      return;
    }
    submitGuard.current = true;
    setError(null);
    try {
      const result = await mutateAsync({
        matchId: mid,
        gameSessionId: newVibeGameSessionId(),
        statements: cleaned,
        lieIndex,
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

  const canSend = statements.every((s) => s.trim().length > 0) && !isPending;

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
            <Text style={[styles.sheetTitle, { color: theme.text }]}>Two Truths</Text>
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
            Write 2 truths and 1 lie. {partnerName} will guess which one is fake.
          </Text>

          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {[0, 1, 2].map((n) => {
              const idx = n as 0 | 1 | 2;
              return (
                <View key={idx} style={[styles.statementCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
                  <View style={styles.statementRow}>
                    <Text style={[styles.statementLabel, { color: theme.textSecondary }]}>Statement {idx + 1}</Text>
                    <Pressable
                      onPress={() => !isPending && setLieIndex(idx)}
                      disabled={isPending}
                      style={[
                        styles.lieChip,
                        {
                          borderColor: lieIndex === idx ? theme.neonPink : theme.border,
                          backgroundColor: lieIndex === idx ? 'rgba(236,72,153,0.12)' : theme.muted,
                        },
                      ]}
                    >
                      <Text style={[styles.lieChipText, { color: theme.text }]}>
                        {lieIndex === idx ? 'Lie' : 'Mark lie'}
                      </Text>
                    </Pressable>
                  </View>
                  <TextInput
                    value={statements[idx]}
                    onChangeText={(t) => updateStatement(idx, t)}
                    placeholder={`Write statement ${idx + 1}...`}
                    placeholderTextColor={theme.textSecondary}
                    editable={!isPending}
                    maxLength={200}
                    multiline
                    style={[
                      styles.input,
                      {
                        color: theme.text,
                        borderColor: lieIndex === idx ? theme.neonPink : theme.border,
                        backgroundColor: theme.surface,
                      },
                    ]}
                  />
                </View>
              );
            })}

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
    maxHeight: '90%',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: 20, fontWeight: '700' },
  sheetSubtitle: {
    fontSize: 13,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  scroll: { maxHeight: 430 },
  statementCard: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  statementRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  statementLabel: { fontSize: 12, fontWeight: '700' },
  lieChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.button,
    borderWidth: StyleSheet.hairlineWidth,
  },
  lieChipText: { fontSize: 12, fontWeight: '600' },
  input: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    minHeight: 46,
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
