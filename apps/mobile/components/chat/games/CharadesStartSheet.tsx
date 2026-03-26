import { useEffect, useRef, useState } from 'react';
import { View, Text, Modal, Pressable, StyleSheet, ActivityIndicator, TextInput, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import { CHARADES_EMOJI_PICKER } from '../../../../../shared/vibely-games/charadesEmojiPicker';
import { formatSendGameEventError, newVibeGameSessionId, useStartCharadesGame } from '@/lib/gamesApi';

type Props = {
  visible: boolean;
  onClose: () => void;
  matchId: string;
  partnerName: string;
};

export function CharadesStartSheet({ visible, onClose, matchId, partnerName }: Props) {
  const theme = Colors[useColorScheme()];
  const insets = useSafeAreaInsets();
  const { mutateAsync, isPending } = useStartCharadesGame();
  const [answer, setAnswer] = useState('');
  const [selectedEmojis, setSelectedEmojis] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const submitGuard = useRef(false);

  useEffect(() => {
    if (!visible) return;
    setAnswer('');
    setSelectedEmojis([]);
    setError(null);
    submitGuard.current = false;
  }, [visible]);

  const toggleEmoji = (emoji: string) => {
    if (isPending) return;
    setError(null);
    setSelectedEmojis((prev) => {
      if (prev.includes(emoji)) return prev.filter((e) => e !== emoji);
      if (prev.length >= 5) return prev;
      return [...prev, emoji];
    });
  };

  const handleSend = async () => {
    if (submitGuard.current || isPending) return;
    const mid = matchId.trim();
    const answerTrim = answer.trim();
    if (!mid) {
      setError('Missing match — try again.');
      return;
    }
    if (!answerTrim || selectedEmojis.length === 0) {
      setError('Answer and at least one emoji are required.');
      return;
    }
    submitGuard.current = true;
    setError(null);
    try {
      const result = await mutateAsync({
        matchId: mid,
        gameSessionId: newVibeGameSessionId(),
        answer: answerTrim,
        emojis: selectedEmojis,
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

  const canSend = answer.trim().length > 0 && selectedEmojis.length > 0 && !isPending;

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
            <Text style={[styles.sheetTitle, { color: theme.text }]}>Charades</Text>
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
            Send an emoji clue. {partnerName} guesses the title.
          </Text>

          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Title (hidden until guessed)</Text>
            <TextInput
              value={answer}
              onChangeText={(t) => {
                setAnswer(t);
                if (error) setError(null);
              }}
              placeholder="Movie, song, or show..."
              placeholderTextColor={theme.textSecondary}
              editable={!isPending}
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

            <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Selected emojis (up to 5)</Text>
            <View style={[styles.selectedBox, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
              {selectedEmojis.length ? (
                selectedEmojis.map((emoji, idx) => (
                  <Pressable key={`${emoji}-${idx}`} onPress={() => toggleEmoji(emoji)} hitSlop={8}>
                    <Text style={styles.selectedEmoji}>{emoji}</Text>
                  </Pressable>
                ))
              ) : (
                <Text style={[styles.selectedPlaceholder, { color: theme.textSecondary }]}>
                  Tap emojis below to build your clue
                </Text>
              )}
            </View>

            <View style={styles.emojiGrid}>
              {CHARADES_EMOJI_PICKER.map((emoji) => {
                const selected = selectedEmojis.includes(emoji);
                return (
                  <Pressable
                    key={emoji}
                    onPress={() => toggleEmoji(emoji)}
                    style={[
                      styles.emojiCell,
                      {
                        borderColor: selected ? theme.neonViolet : theme.border,
                        backgroundColor: selected ? 'rgba(139,92,246,0.18)' : theme.surfaceSubtle,
                      },
                    ]}
                  >
                    <Text style={styles.emojiCellText}>{emoji}</Text>
                  </Pressable>
                );
              })}
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
    maxHeight: '90%',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: 20, fontWeight: '700' },
  sheetSubtitle: { fontSize: 13, marginTop: spacing.sm, marginBottom: spacing.md, lineHeight: 18 },
  scroll: { maxHeight: 460 },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  answerInput: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: spacing.md,
  },
  selectedBox: {
    minHeight: 64,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  selectedEmoji: { fontSize: 28 },
  selectedPlaceholder: { fontSize: 13 },
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  emojiCell: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiCellText: { fontSize: 22 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.md,
  },
  errorText: { flex: 1, fontSize: 14, lineHeight: 20 },
  sendBtn: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    paddingVertical: 14,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  sendBtnText: { fontSize: 16, fontWeight: '700' },
});
