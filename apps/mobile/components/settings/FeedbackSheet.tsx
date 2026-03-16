/**
 * Help & Feedback — subject + details, submit via mailto.
 * Reference: web FeedbackDrawer; v1 uses mailto.
 */
import React, { useState } from 'react';
import { View, Text, Modal, Pressable, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { VibelyText, VibelyButton } from '@/components/ui';
import { spacing, radius } from '@/constants/theme';
import { Linking } from 'react-native';

const FEEDBACK_SUBJECTS = [
  { id: 'bug', label: 'Bug report' },
  { id: 'feature', label: 'Feature request' },
  { id: 'general', label: 'General feedback' },
  { id: 'safety', label: 'Safety concern' },
] as const;

const MAX_LENGTH = 1000;
const SUPPORT_EMAIL = 'support@vibelymeet.com';

type FeedbackSheetProps = {
  visible: boolean;
  onClose: () => void;
};

export function FeedbackSheet({ visible, onClose }: FeedbackSheetProps) {
  const theme = Colors[useColorScheme()];
  const [subject, setSubject] = useState<string>('general');
  const [details, setDetails] = useState('');

  const handleSubmit = () => {
    const subjectLine = FEEDBACK_SUBJECTS.find((s) => s.id === subject)?.label ?? 'Feedback';
    const body = details.trim() ? `\n\n---\n${details.trim()}` : '';
    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`[Vibely App] ${subjectLine}`)}&body=${encodeURIComponent(body)}`;
    Linking.openURL(url).catch(() => {});
    setDetails('');
    onClose();
  };

  if (!visible) return null;

  return (
    <Modal transparent visible animationType="slide">
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: theme.surface }]} onPress={(e) => e.stopPropagation()}>
          <View style={[styles.handle, { backgroundColor: theme.mutedForeground }]} />
          <VibelyText variant="titleMD" style={[styles.title, { color: theme.text }]}>Help & Feedback</VibelyText>

          <VibelyText variant="caption" style={[styles.label, { color: theme.textSecondary }]}>Subject</VibelyText>
          <View style={styles.subjectRow}>
            {FEEDBACK_SUBJECTS.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => setSubject(s.id)}
                style={[
                  styles.subjectChip,
                  { borderColor: subject === s.id ? theme.tint : theme.border, backgroundColor: subject === s.id ? theme.tintSoft : theme.surfaceSubtle },
                ]}
              >
                <VibelyText variant="caption" style={{ color: subject === s.id ? theme.tint : theme.textSecondary }}>{s.label}</VibelyText>
              </Pressable>
            ))}
          </View>

          <VibelyText variant="caption" style={[styles.label, { color: theme.textSecondary }]}>Details (optional, max {MAX_LENGTH} characters)</VibelyText>
          <TextInput
            style={[styles.input, { color: theme.text, borderColor: theme.border }]}
            placeholder="Describe your feedback..."
            placeholderTextColor={theme.mutedForeground}
            value={details}
            onChangeText={(t) => setDetails(t.slice(0, MAX_LENGTH))}
            multiline
            numberOfLines={4}
            maxLength={MAX_LENGTH}
          />
          <VibelyText variant="caption" style={{ color: theme.textSecondary }}>{details.length}/{MAX_LENGTH}</VibelyText>

          <View style={styles.actions}>
            <Pressable onPress={onClose} style={[styles.cancelBtn, { borderColor: theme.border }]}>
              <VibelyText variant="body" style={{ color: theme.textSecondary }}>Cancel</VibelyText>
            </Pressable>
            <VibelyButton label="Open email to send" onPress={handleSubmit} style={styles.submitBtn} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius['2xl'], borderTopRightRadius: radius['2xl'], paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: spacing.sm, marginBottom: spacing.md },
  title: { marginBottom: spacing.lg },
  label: { marginBottom: spacing.sm },
  subjectRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  subjectChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.lg, borderWidth: 1 },
  input: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, minHeight: 100, textAlignVertical: 'top', marginBottom: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  cancelBtn: { paddingVertical: 12, paddingHorizontal: spacing.lg, borderRadius: radius.lg, borderWidth: 1 },
  submitBtn: { flex: 1 },
});
