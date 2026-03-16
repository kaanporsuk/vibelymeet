/**
 * Sheet to edit a single prompt answer or add a new prompt. Saves via onSave(question, answer) or onAdd(question, answer).
 */
import React, { useState, useEffect } from 'react';
import { View, Text, Modal, Pressable, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import { VibelyText } from '@/components/ui';
import { PROMPT_EMOJIS, AVAILABLE_PROMPTS } from './PROMPT_CONSTANTS';

type PromptEditSheetProps = {
  visible: boolean;
  onClose: () => void;
  mode: 'edit' | 'add';
  initialQuestion?: string;
  initialAnswer?: string;
  onSave: (question: string, answer: string) => void;
  onAdd?: (question: string, answer: string) => void;
  onRemove?: () => void;
  existingQuestions?: string[];
};

export function PromptEditSheet({
  visible,
  onClose,
  mode,
  initialQuestion = '',
  initialAnswer = '',
  onSave,
  onAdd,
  onRemove,
  existingQuestions = [],
}: PromptEditSheetProps) {
  const theme = Colors[useColorScheme()];
  const [question, setQuestion] = useState(initialQuestion);
  const [answer, setAnswer] = useState(initialAnswer);
  const [showQuestionPicker, setShowQuestionPicker] = useState(mode === 'add');

  useEffect(() => {
    if (visible) {
      setQuestion(initialQuestion);
      setAnswer(initialAnswer);
      setShowQuestionPicker(mode === 'add');
    }
  }, [visible, mode, initialQuestion, initialAnswer]);

  const handleDone = () => {
    const q = question.trim();
    const a = answer.trim();
    if (!q) return;
    if (mode === 'edit') {
      onSave(q, a);
    } else if (onAdd) {
      onAdd(q, a);
    }
    onClose();
  };

  const canAdd = mode === 'add' ? question.trim().length > 0 : true;
  const remaining = AVAILABLE_PROMPTS.filter((p) => !existingQuestions.includes(p));

  if (!visible) return null;

  return (
    <Modal transparent visible animationType="slide">
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: theme.surface }]} onPress={(e) => e.stopPropagation()}>
          <View style={[styles.handle, { backgroundColor: theme.mutedForeground }]} />
          <VibelyText variant="titleMD" style={[styles.title, { color: theme.text }]}>
            {mode === 'edit' ? 'Edit prompt' : 'Add prompt'}
          </VibelyText>

          {mode === 'add' && showQuestionPicker ? (
            <View style={styles.pickerBlock}>
              <VibelyText variant="overline" style={[styles.label, { color: theme.textSecondary }]}>Choose a prompt</VibelyText>
              <View style={styles.questionList}>
                {remaining.slice(0, 10).map((p) => (
                  <Pressable
                    key={p}
                    onPress={() => { setQuestion(p); setShowQuestionPicker(false); }}
                    style={[styles.questionRow, { backgroundColor: theme.surfaceSubtle }]}
                  >
                    <Text style={styles.questionEmoji}>{PROMPT_EMOJIS[p] ?? '💭'}</Text>
                    <VibelyText variant="body" style={{ color: theme.text }} numberOfLines={1}>{p}</VibelyText>
                  </Pressable>
                ))}
              </View>
              <Pressable onPress={onClose} style={[styles.cancelBtn, { borderColor: theme.border }]}>
                <VibelyText variant="body" style={{ color: theme.text }}>Cancel</VibelyText>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={[styles.promptHeader, { backgroundColor: theme.surfaceSubtle }]}>
                <Text style={styles.promptEmoji}>{PROMPT_EMOJIS[question] ?? '💭'}</Text>
                <VibelyText variant="body" style={{ color: theme.textSecondary }}>{question || 'Prompt'}</VibelyText>
                {mode === 'add' && (
                  <Pressable onPress={() => setShowQuestionPicker(true)} style={styles.changeQuestion}>
                    <VibelyText variant="caption" style={{ color: theme.tint }}>Change</VibelyText>
                  </Pressable>
                )}
              </View>
              <VibelyText variant="overline" style={[styles.label, { color: theme.textSecondary }]}>Your answer</VibelyText>
              <TextInput
                value={answer}
                onChangeText={setAnswer}
                placeholder="Tap to add your answer..."
                placeholderTextColor={theme.mutedForeground}
                style={[styles.input, { color: theme.text, borderColor: theme.border }]}
                multiline
                numberOfLines={3}
              />
              {mode === 'edit' && onRemove ? (
                <Pressable onPress={() => { onRemove(); onClose(); }} style={styles.removeWrap}>
                  <VibelyText variant="body" style={styles.btnDangerText}>Remove this prompt</VibelyText>
                </Pressable>
              ) : null}
              <View style={styles.actions}>
                <Pressable onPress={onClose} style={[styles.btn, { backgroundColor: theme.muted }]}>
                  <VibelyText variant="body" style={{ color: theme.text }}>Cancel</VibelyText>
                </Pressable>
                <Pressable onPress={handleDone} style={[styles.btn, { backgroundColor: theme.tint }]} disabled={!question.trim()}>
                  <VibelyText variant="body" style={styles.btnPrimaryText}>{mode === 'edit' ? 'Save' : 'Add'}</VibelyText>
                </Pressable>
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius['2xl'],
    borderTopRightRadius: radius['2xl'],
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['2xl'],
  },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: spacing.sm, marginBottom: spacing.md },
  title: { marginBottom: spacing.md },
  label: { marginBottom: spacing.xs },
  pickerBlock: {},
  questionList: { maxHeight: 280, marginBottom: spacing.md },
  questionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 12, paddingHorizontal: spacing.md, borderRadius: radius.lg, marginBottom: spacing.xs },
  questionEmoji: { fontSize: 20 },
  cancelBtn: { paddingVertical: 14, borderRadius: radius.lg, alignItems: 'center', borderWidth: 1 },
  promptHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, marginBottom: spacing.md },
  promptEmoji: { fontSize: 22 },
  changeQuestion: { marginLeft: 'auto' },
  input: { borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: 12, minHeight: 88, fontSize: 14, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  btn: { flex: 1, paddingVertical: 14, borderRadius: radius.lg, alignItems: 'center' },
  btnPrimaryText: { color: '#fff', fontWeight: '600' },
  removeWrap: { alignSelf: 'center', paddingVertical: spacing.sm, marginBottom: spacing.sm },
  btnDangerText: { color: '#ef4444', fontWeight: '600' },
});
