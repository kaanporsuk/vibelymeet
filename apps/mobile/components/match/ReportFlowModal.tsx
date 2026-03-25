/**
 * Report flow — reason, details, also block. Submits to user_reports.
 */
import React, { useState, useRef, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, TextInput, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import { REPORT_REASONS, submitReport, type ReportReasonId } from '@/lib/reportApi';
import { KeyboardAwareCenteredModal } from '@/components/keyboard/KeyboardAwareCenteredModal';

type ReportFlowModalProps = {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  reportedId: string;
  reportedName: string;
  reporterId: string;
};

export function ReportFlowModal({
  visible,
  onClose,
  onSuccess,
  reportedId,
  reportedName,
  reporterId,
}: ReportFlowModalProps) {
  const theme = Colors[useColorScheme()];
  const [step, setStep] = useState<'reason' | 'details' | 'done'>('reason');
  const [reason, setReason] = useState<ReportReasonId | null>(null);
  const [details, setDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const completionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (completionTimeoutRef.current !== null) {
        clearTimeout(completionTimeoutRef.current);
        completionTimeoutRef.current = null;
      }
    };
  }, []);

  const handleSubmit = async () => {
    if (!reason) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitReport({
        reporterId,
        reportedId,
        reason,
        details: details.trim() || null,
        alsoBlock,
      });
      setStep('done');
      if (completionTimeoutRef.current !== null) clearTimeout(completionTimeoutRef.current);
      completionTimeoutRef.current = setTimeout(() => {
        onSuccess();
        onClose();
        setStep('reason');
        setReason(null);
        setDetails('');
        completionTimeoutRef.current = null;
      }, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit report');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAwareCenteredModal
      visible={visible}
      onRequestClose={onClose}
      animationType="slide"
      backdropColor="rgba(0,0,0,0.8)"
    >
      <View style={[styles.card, { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.text }]}>
            {step === 'done' ? 'Report submitted' : 'Report a user'}
          </Text>
          {step !== 'done' && (
            <Pressable onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={24} color={theme.textSecondary} />
            </Pressable>
          )}
        </View>

        {step === 'done' && (
          <View style={styles.doneWrap}>
            <Ionicons name="checkmark-circle" size={48} color={theme.success} />
            <Text style={[styles.doneText, { color: theme.text }]}>Thanks. We'll look into it.</Text>
          </View>
        )}

        {step === 'reason' && (
          <ScrollView
            style={styles.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <Text style={[styles.sub, { color: theme.textSecondary }]}>Why are you reporting {reportedName}?</Text>
            {REPORT_REASONS.map((r) => (
              <Pressable
                key={r.id}
                onPress={() => setReason(r.id)}
                style={[
                  styles.reasonRow,
                  { backgroundColor: theme.surfaceSubtle, borderColor: theme.border },
                  reason === r.id && { borderColor: theme.tint, borderWidth: 2 },
                ]}
              >
                <Text style={[styles.reasonLabel, { color: theme.text }]}>{r.label}</Text>
                {reason === r.id && <Ionicons name="checkmark" size={20} color={theme.tint} />}
              </Pressable>
            ))}
            <Pressable
              onPress={() => reason && setStep('details')}
              style={[styles.nextBtn, { backgroundColor: theme.tint }, !reason && styles.nextBtnDisabled]}
              disabled={!reason}
            >
              <Text style={styles.nextBtnText}>Continue</Text>
            </Pressable>
          </ScrollView>
        )}

        {step === 'details' && (
          <ScrollView
            style={styles.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <Text style={[styles.sub, { color: theme.textSecondary }]}>Additional details (optional)</Text>
            <TextInput
              style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.surfaceSubtle }]}
              placeholder="Anything else we should know?"
              placeholderTextColor={theme.textSecondary}
              value={details}
              onChangeText={setDetails}
              multiline
              numberOfLines={3}
            />
            <Pressable
              onPress={() => setAlsoBlock(!alsoBlock)}
              style={[styles.switchRow, { borderBottomColor: theme.border }]}
            >
              <Text style={[styles.switchLabel, { color: theme.text }]}>Also block this user</Text>
              <View style={[styles.checkbox, alsoBlock && { backgroundColor: theme.tint }]}>
                {alsoBlock && <Ionicons name="checkmark" size={16} color="#fff" />}
              </View>
            </Pressable>
            {error ? <Text style={[styles.err, { color: theme.danger }]}>{error}</Text> : null}
            <Pressable
              onPress={handleSubmit}
              style={[styles.nextBtn, { backgroundColor: theme.danger }]}
              disabled={submitting}
            >
              <Text style={styles.nextBtnText}>{submitting ? 'Submitting…' : 'Submit report'}</Text>
            </Pressable>
          </ScrollView>
        )}
      </View>
    </KeyboardAwareCenteredModal>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius['2xl'], borderWidth: 1, padding: spacing.lg, maxHeight: '80%', width: '100%', maxWidth: 400 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  title: { fontSize: 18, fontWeight: '700' },
  scroll: { maxHeight: 400 },
  sub: { fontSize: 14, marginBottom: spacing.md },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.sm,
  },
  reasonLabel: { fontSize: 15 },
  input: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md, minHeight: 80, textAlignVertical: 'top' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md, borderBottomWidth: 1 },
  switchLabel: { fontSize: 15 },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  err: { fontSize: 13, marginBottom: spacing.sm },
  nextBtn: { paddingVertical: spacing.md, borderRadius: radius.lg, alignItems: 'center', marginTop: spacing.md },
  nextBtnDisabled: { opacity: 0.5 },
  nextBtnText: { color: '#fff', fontWeight: '600' },
  doneWrap: { alignItems: 'center', paddingVertical: spacing.xl },
  doneText: { marginTop: spacing.md, fontSize: 16 },
});
