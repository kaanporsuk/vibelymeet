/**
 * Report flow — reason, details, action, success. Submits to user_reports (+ optional block).
 *
 * Implemented as a bottom sheet with fixed CTA to avoid clipped content on small devices.
 */
import React, { useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import { REPORT_REASONS, submitReport, type ReportReasonId } from '@/lib/reportApi';
import { KeyboardAwareBottomSheetModal } from '@/components/keyboard/KeyboardAwareBottomSheetModal';

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
  const [step, setStep] = useState<'reason' | 'details' | 'action' | 'success'>('reason');
  const [reason, setReason] = useState<ReportReasonId | null>(null);
  const [details, setDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const completionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const title = useMemo(() => {
    if (step === 'success') return 'Report submitted';
    return 'Report a user';
  }, [step]);

  const resetState = () => {
    setStep('reason');
    setReason(null);
    setDetails('');
    setAlsoBlock(true);
    setSubmitting(false);
    setError(null);
    if (completionTimeoutRef.current !== null) {
      clearTimeout(completionTimeoutRef.current);
      completionTimeoutRef.current = null;
    }
  };

  const handleRequestClose = () => {
    resetState();
    onClose();
  };

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
      setStep('success');
      if (completionTimeoutRef.current !== null) clearTimeout(completionTimeoutRef.current);
      completionTimeoutRef.current = setTimeout(() => {
        onSuccess();
        handleRequestClose();
        completionTimeoutRef.current = null;
      }, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit report');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAwareBottomSheetModal
      visible={visible}
      onRequestClose={handleRequestClose}
      scrollable={false}
      showHandle
      maxHeightRatio={0.86}
    >
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Pressable
            onPress={() => {
              if (step === 'reason') return handleRequestClose();
              if (step === 'success') return;
              if (step === 'details') return setStep('reason');
              if (step === 'action') return setStep('details');
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={step === 'reason' ? 'Close' : 'Back'}
            style={({ pressed }) => [styles.headerIconBtn, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name={step === 'reason' ? 'close' : 'arrow-back'} size={22} color={theme.textSecondary} />
          </Pressable>
          <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
            {title}
          </Text>
          <View style={styles.headerIconBtn} />
        </View>

        <View style={styles.body}>
          {step === 'success' ? (
            <View style={styles.successWrap}>
              <Ionicons name="checkmark-circle" size={52} color={theme.success} />
              <Text style={[styles.successTitle, { color: theme.text }]}>Thanks. We'll look into it.</Text>
              <Text style={[styles.successSub, { color: theme.textSecondary }]}>
                You can close this sheet now.
              </Text>
            </View>
          ) : (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
            >
              {step === 'reason' ? (
                <>
                  <Text style={[styles.sub, { color: theme.textSecondary }]}>
                    Why are you reporting {reportedName}?
                  </Text>
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
                </>
              ) : null}

              {step === 'details' ? (
                <>
                  <Text style={[styles.sub, { color: theme.textSecondary }]}>Additional details (optional)</Text>
                  <TextInput
                    style={[
                      styles.input,
                      { borderColor: theme.border, color: theme.text, backgroundColor: theme.surfaceSubtle },
                    ]}
                    placeholder="Anything else we should know?"
                    placeholderTextColor={theme.textSecondary}
                    value={details}
                    onChangeText={setDetails}
                    multiline
                    numberOfLines={4}
                    textAlignVertical="top"
                  />
                </>
              ) : null}

              {step === 'action' ? (
                <>
                  <Text style={[styles.sub, { color: theme.textSecondary }]}>What would you like to do?</Text>
                  <Pressable
                    onPress={() => setAlsoBlock(!alsoBlock)}
                    style={[
                      styles.switchRow,
                      { backgroundColor: theme.surfaceSubtle, borderColor: theme.border },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.switchLabel, { color: theme.text }]}>Also block this user</Text>
                      <Text style={[styles.switchSub, { color: theme.textSecondary }]}>
                        They won’t be able to contact you or see your profile.
                      </Text>
                    </View>
                    <View style={[styles.checkbox, alsoBlock && { backgroundColor: theme.tint, borderColor: theme.tint }]}>
                      {alsoBlock && <Ionicons name="checkmark" size={16} color="#fff" />}
                    </View>
                  </Pressable>
                  {error ? <Text style={[styles.err, { color: theme.danger }]}>{error}</Text> : null}
                </>
              ) : null}
            </ScrollView>
          )}
        </View>

        {step !== 'success' ? (
          <View style={[styles.footer, { borderTopColor: theme.border }]}>
            {step === 'reason' ? (
              <Pressable
                onPress={() => reason && setStep('details')}
                style={[
                  styles.ctaBtn,
                  { backgroundColor: theme.tint },
                  (!reason || submitting) && styles.ctaBtnDisabled,
                ]}
                disabled={!reason || submitting}
              >
                <Text style={styles.ctaBtnText}>Continue</Text>
              </Pressable>
            ) : null}

            {step === 'details' ? (
              <Pressable
                onPress={() => setStep('action')}
                style={[styles.ctaBtn, { backgroundColor: theme.tint }, submitting && styles.ctaBtnDisabled]}
                disabled={submitting}
              >
                <Text style={styles.ctaBtnText}>Continue</Text>
              </Pressable>
            ) : null}

            {step === 'action' ? (
              <Pressable
                onPress={handleSubmit}
                style={[styles.ctaBtn, { backgroundColor: theme.danger }, submitting && styles.ctaBtnDisabled]}
                disabled={submitting}
              >
                {submitting ? (
                  <View style={styles.ctaRow}>
                    <ActivityIndicator size="small" color="#fff" />
                    <Text style={styles.ctaBtnText}>Submitting…</Text>
                  </View>
                ) : (
                  <Text style={styles.ctaBtnText}>Submit report</Text>
                )}
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </KeyboardAwareBottomSheetModal>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingTop: spacing.xs },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  headerIconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  scroll: { maxHeight: 420 },
  scrollContent: { paddingBottom: spacing.md },
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
  input: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    minHeight: 120,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  switchLabel: { fontSize: 15, fontWeight: '600' },
  switchSub: { marginTop: 2, fontSize: 12 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  err: { fontSize: 13, marginBottom: spacing.sm },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  ctaBtn: { paddingVertical: spacing.md, borderRadius: radius.lg, alignItems: 'center' },
  ctaBtnDisabled: { opacity: 0.6 },
  ctaBtnText: { color: '#fff', fontWeight: '700' },
  ctaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  successWrap: { alignItems: 'center', paddingVertical: spacing.xl, paddingHorizontal: spacing.lg },
  successTitle: { marginTop: spacing.md, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  successSub: { marginTop: spacing.sm, fontSize: 13, textAlign: 'center' },
});
