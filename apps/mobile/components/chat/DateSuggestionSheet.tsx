/**
 * Bottom sheet to suggest a date: date picker, time block, activity text. Inserts into date_proposals.
 * Reference: src/components/schedule/VibeSyncModal.tsx, DateProposalSheet.tsx
 */
import React, { useState } from 'react';
import { View, Text, Modal, Pressable, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import { VibelyText } from '@/components/ui';
import type { TimeBlock } from '@/lib/dateProposalsApi';
import { getTimeBlockLabel } from '@/lib/dateProposalsApi';

const TIME_BLOCKS: TimeBlock[] = ['morning', 'afternoon', 'evening', 'night'];

type DateSuggestionSheetProps = {
  visible: boolean;
  onClose: () => void;
  matchName: string;
  matchId: string;
  proposerId: string;
  recipientId: string;
  onCreate: (proposedDate: string, timeBlock: TimeBlock, activity: string) => void;
};

export function DateSuggestionSheet({
  visible,
  onClose,
  matchName,
  matchId,
  proposerId,
  recipientId,
  onCreate,
}: DateSuggestionSheetProps) {
  const theme = Colors[useColorScheme()];
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [timeBlock, setTimeBlock] = useState<TimeBlock>('evening');
  const [activity, setActivity] = useState("Let's vibe! 💜");

  const handleSubmit = () => {
    onCreate(selectedDate, timeBlock, activity);
    onClose();
  };

  if (!visible) return null;

  return (
    <Modal transparent visible animationType="slide">
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: theme.surface }]} onPress={(e) => e.stopPropagation()}>
          <View style={[styles.handle, { backgroundColor: theme.muted }]} />
          <VibelyText variant="titleMD" style={[styles.title, { color: theme.text }]}>
            Suggest a date
          </VibelyText>
          <VibelyText variant="bodySecondary" style={[styles.subtitle, { color: theme.textSecondary }]}>
            Find a time with {matchName}
          </VibelyText>

          <VibelyText variant="overline" style={[styles.label, { color: theme.textSecondary }]}>Date</VibelyText>
          <TextInput
            value={selectedDate}
            onChangeText={setSelectedDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={theme.mutedForeground}
            style={[styles.input, { color: theme.text, borderColor: theme.border }]}
          />

          <VibelyText variant="overline" style={[styles.label, { color: theme.textSecondary }]}>Time</VibelyText>
          <View style={styles.timeRow}>
            {TIME_BLOCKS.map((block) => (
              <Pressable
                key={block}
                onPress={() => setTimeBlock(block)}
                style={[
                  styles.timeChip,
                  { backgroundColor: timeBlock === block ? theme.tintSoft : theme.surfaceSubtle, borderColor: theme.border },
                  timeBlock === block && { borderColor: theme.tint },
                ]}
              >
                <Text style={[styles.timeChipText, { color: timeBlock === block ? theme.tint : theme.text }]}>
                  {getTimeBlockLabel(block)}
                </Text>
              </Pressable>
            ))}
          </View>

          <VibelyText variant="overline" style={[styles.label, { color: theme.textSecondary }]}>Activity (optional)</VibelyText>
          <TextInput
            value={activity}
            onChangeText={setActivity}
            placeholder="e.g. Coffee, Video call..."
            placeholderTextColor={theme.mutedForeground}
            style={[styles.input, styles.textArea, { color: theme.text, borderColor: theme.border }]}
            multiline
            maxLength={140}
          />

          <View style={styles.actions}>
            <Pressable onPress={onClose} style={[styles.btn, styles.btnSecondary, { backgroundColor: theme.muted }]}>
              <VibelyText variant="body" style={{ color: theme.text }}>Cancel</VibelyText>
            </Pressable>
            <Pressable onPress={handleSubmit} style={[styles.btn, { backgroundColor: theme.tint }]}>
              <VibelyText variant="body" style={styles.btnPrimaryText}>Send proposal</VibelyText>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius['2xl'],
    borderTopRightRadius: radius['2xl'],
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['2xl'],
  },
  handle: { width: 100, height: 8, borderRadius: 999, alignSelf: 'center', marginTop: 16, marginBottom: 12 },
  title: { marginBottom: 4 },
  subtitle: { marginBottom: spacing.lg },
  label: { marginBottom: spacing.xs },
  input: { borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14, marginBottom: spacing.md },
  textArea: { minHeight: 60 },
  timeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  timeChip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1 },
  timeChipText: { fontSize: 13, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  btn: { flex: 1, paddingVertical: 14, borderRadius: radius.lg, alignItems: 'center' },
  btnSecondary: {},
  btnPrimaryText: { color: '#fff', fontWeight: '600' },
});
