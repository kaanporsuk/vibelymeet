/**
 * Conversation starters editor — parity with web ProfileStudio prompt drawer.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius, fonts } from '@/constants/theme';
import { PROMPT_EMOJIS, AVAILABLE_PROMPTS } from './PROMPT_CONSTANTS';
import { KeyboardAwareBottomSheetModal } from '@/components/keyboard/KeyboardAwareBottomSheetModal';

const MAX_ANSWER = 200;

export interface PromptEditSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Single save path — both add and edit */
  onSave: (prompt: { question: string; answer: string }) => void | Promise<void>;
  onRemove?: () => void | Promise<void>;
  initialQuestion?: string;
  initialAnswer?: string;
  /** Prompt questions already used by other slots (current slot’s selection stays allowed). */
  usedQuestions: string[];
  mode: 'add' | 'edit';
  saving?: boolean;
}

export function PromptEditSheet({
  visible,
  onClose,
  onSave,
  onRemove,
  initialQuestion = '',
  initialAnswer = '',
  usedQuestions,
  mode,
  saving = false,
}: PromptEditSheetProps) {
  const theme = Colors[useColorScheme()];
  const [selectedQuestion, setSelectedQuestion] = useState(initialQuestion);
  const [answerText, setAnswerText] = useState(initialAnswer);

  useEffect(() => {
    if (!visible) return;
    setSelectedQuestion(initialQuestion);
    setAnswerText(initialAnswer);
  }, [visible, initialQuestion, initialAnswer]);

  const isValid = useMemo(() => {
    return selectedQuestion.trim().length > 0 && answerText.trim().length > 0;
  }, [selectedQuestion, answerText]);

  const isPromptDisabled = useCallback(
    (prompt: string) => {
      const used = usedQuestions.some((q) => q === prompt);
      return used && prompt !== selectedQuestion.trim();
    },
    [usedQuestions, selectedQuestion],
  );

  const handleSavePress = async () => {
    if (!isValid || saving) return;
    await onSave({
      question: selectedQuestion.trim(),
      answer: answerText.trim(),
    });
  };

  const title = mode === 'add' ? 'Add Prompt' : 'Edit Prompt';

  return (
    <KeyboardAwareBottomSheetModal
      visible={visible}
      onRequestClose={onClose}
      showHandle
      backdropColor="rgba(0,0,0,0.55)"
      footer={
        <>
          <Pressable
            onPress={() => void handleSavePress()}
            disabled={!isValid || saving}
            style={[styles.saveBtnWrap, (!isValid || saving) && { opacity: 0.4 }]}
          >
            <LinearGradient
              colors={['#8B5CF6', '#E84393']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.saveGradient}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>Save Prompt</Text>
              )}
            </LinearGradient>
          </Pressable>

          {mode === 'edit' && onRemove ? (
            <Pressable onPress={() => void onRemove()} disabled={saving} style={styles.removeBtn}>
              <Text style={styles.removeText}>Remove Prompt</Text>
            </Pressable>
          ) : null}

          <Pressable onPress={onClose} style={styles.cancelBtn}>
            <Text style={[styles.cancelText, { color: theme.textSecondary }]}>Cancel</Text>
          </Pressable>
        </>
      }
    >
      <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
      <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
        Spark conversations with your answer.
      </Text>

      <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>Choose a prompt</Text>
      <ScrollView
        style={styles.promptScroll}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {AVAILABLE_PROMPTS.map((p) => {
          const disabled = isPromptDisabled(p);
          const selected = selectedQuestion.trim() === p;
          return (
            <Pressable
              key={p}
              disabled={disabled}
              onPress={() => !disabled && setSelectedQuestion(p)}
              style={[
                styles.promptRow,
                {
                  backgroundColor: selected ? 'rgba(139,92,246,0.2)' : 'rgba(255,255,255,0.04)',
                  borderColor: selected ? 'rgba(139,92,246,0.45)' : 'rgba(255,255,255,0.08)',
                  opacity: disabled ? 0.45 : 1,
                },
              ]}
            >
              <Text style={styles.promptEmoji}>{PROMPT_EMOJIS[p] ?? '💭'}</Text>
              <Text style={[styles.promptText, { color: theme.text }]} numberOfLines={2}>
                {p}
              </Text>
              {disabled ? (
                <Text style={[styles.usedBadge, { color: theme.textSecondary }]}>Already used</Text>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      <Text style={[styles.sectionLabel, { color: theme.textSecondary, marginTop: spacing.md }]}>
        Your Answer
      </Text>
      <TextInput
        value={answerText}
        onChangeText={(t) => setAnswerText(t.slice(0, MAX_ANSWER))}
        placeholder="Be authentic, be interesting..."
        placeholderTextColor="rgba(255,255,255,0.4)"
        multiline
        maxLength={MAX_ANSWER}
        style={styles.answerInput}
      />
      <Text style={[styles.charCount, { color: theme.textSecondary }]}>
        {answerText.length}/{MAX_ANSWER}
      </Text>
    </KeyboardAwareBottomSheetModal>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 20,
    fontFamily: fonts.displayBold,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: fonts.body,
    textAlign: 'center',
    marginBottom: spacing.lg,
    lineHeight: 20,
    paddingHorizontal: spacing.sm,
  },
  sectionLabel: {
    fontSize: 13,
    fontFamily: fonts.bodySemiBold,
    marginBottom: spacing.sm,
  },
  promptScroll: {
    maxHeight: 220,
    marginBottom: spacing.sm,
  },
  promptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  promptEmoji: { fontSize: 18 },
  promptText: { flex: 1, fontSize: 14, fontFamily: fonts.body },
  usedBadge: { fontSize: 11, fontFamily: fonts.bodyMedium },
  answerInput: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    padding: 16,
    color: '#FFFFFF',
    fontSize: 15,
    minHeight: 120,
    fontFamily: fonts.body,
    textAlignVertical: 'top',
  },
  charCount: {
    fontSize: 13,
    textAlign: 'right',
    marginTop: spacing.xs,
    fontFamily: fonts.body,
  },
  saveBtnWrap: {
    marginTop: spacing.lg,
    borderRadius: 12,
    overflow: 'hidden',
    alignSelf: 'stretch',
  },
  saveGradient: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: fonts.bodyBold,
  },
  removeBtn: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  removeText: {
    color: '#F87171',
    fontSize: 16,
    fontFamily: fonts.bodySemiBold,
  },
  cancelBtn: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  cancelText: {
    fontSize: 16,
    fontFamily: fonts.bodySemiBold,
  },
});

export default PromptEditSheet;
