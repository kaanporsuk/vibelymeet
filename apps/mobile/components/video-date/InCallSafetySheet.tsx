/**
 * Minimal in-call safety: canonical `submit_user_report` only (parity with web InCallSafetyModal).
 */

import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  TextInput,
  Switch,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native';
import { spacing, radius, typography } from '@/constants/theme';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { REPORT_REASONS, type ReportReasonId } from '@clientShared/safety/reportReasons';
import { submitUserReportRpc } from '@clientShared/safety/submitUserReportRpc';
import { supabase } from '@/lib/supabase';

type Props = {
  visible: boolean;
  onClose: () => void;
  reportedUserId: string | null;
  onEndAfterReport: () => void | Promise<void>;
};

export function InCallSafetySheet({ visible, onClose, reportedUserId, onEndAfterReport }: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const [reason, setReason] = useState<ReportReasonId>('harassment');
  const [details, setDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [busy, setBusy] = useState<'idle' | 'report' | 'end'>('idle');

  const reset = () => {
    setReason('harassment');
    setDetails('');
    setAlsoBlock(false);
    setBusy('idle');
  };

  const submit = async (mode: 'report' | 'end') => {
    if (!reportedUserId) {
      Alert.alert('Missing profile', 'Could not determine who to report. Try again in a moment.');
      return;
    }
    setBusy(mode);
    const result = await submitUserReportRpc(supabase, {
      reportedId: reportedUserId,
      reason,
      details: details.trim() || null,
      alsoBlock,
    });
    setBusy('idle');
    if (!result.ok) {
      Alert.alert('Could not send report', result.error || 'Try again.');
      return;
    }
    reset();
    onClose();
    if (mode === 'report') {
      Alert.alert('Thanks', 'We received your report.');
      return;
    }
    await onEndAfterReport();
  };

  const disabled = !reportedUserId || busy !== 'idle';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.title, { color: theme.text }]}>Safety</Text>
          <Text style={[styles.sub, { color: theme.mutedForeground }]}>
            Report inappropriate behavior. You can stay on the call or end it after reporting.
          </Text>

          <Text style={[styles.label, { color: theme.text }]}>Reason</Text>
          <ScrollView style={styles.reasonList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {REPORT_REASONS.map((r) => (
              <Pressable
                key={r.id}
                onPress={() => setReason(r.id)}
                style={[
                  styles.reasonRow,
                  { borderColor: theme.border },
                  reason === r.id && { backgroundColor: theme.muted },
                ]}
              >
                <Text style={{ color: theme.text }}>{r.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <Text style={[styles.label, { color: theme.text }]}>Details (optional)</Text>
          <TextInput
            style={[styles.input, { color: theme.text, borderColor: theme.border }]}
            placeholder="What happened?"
            placeholderTextColor={theme.mutedForeground}
            value={details}
            onChangeText={setDetails}
            multiline
            editable={!disabled}
          />

          <View style={styles.row}>
            <Text style={{ color: theme.text, flex: 1 }}>Also block this person</Text>
            <Switch value={alsoBlock} onValueChange={setAlsoBlock} disabled={disabled} />
          </View>

          <View style={styles.actions}>
            <Pressable
              style={[styles.btn, { backgroundColor: theme.muted }]}
              disabled={disabled}
              onPress={() => void submit('report')}
            >
              {busy === 'report' ? (
                <ActivityIndicator color={theme.text} />
              ) : (
                <Text style={[styles.btnText, { color: theme.text }]}>Report</Text>
              )}
            </Pressable>
            <Pressable
              style={[styles.btn, { backgroundColor: theme.danger }]}
              disabled={disabled}
              onPress={() => void submit('end')}
            >
              {busy === 'end' ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={[styles.btnText, { color: '#fff' }]}>End & report</Text>
              )}
            </Pressable>
          </View>

          <Pressable onPress={onClose} style={styles.cancel}>
            <Text style={{ color: theme.mutedForeground }}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    padding: spacing.lg,
    maxHeight: '88%',
  },
  title: {
    ...typography.titleMD,
    marginBottom: spacing.xs,
  },
  sub: {
    ...typography.body,
    marginBottom: spacing.md,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  reasonList: {
    maxHeight: 160,
    marginBottom: spacing.md,
  },
  reasonRow: {
    padding: spacing.sm,
    borderRadius: radius.button,
    borderWidth: 1,
    marginBottom: spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.button,
    padding: spacing.sm,
    minHeight: 72,
    textAlignVertical: 'top',
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  actions: {
    gap: spacing.sm,
  },
  btn: {
    paddingVertical: 14,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    fontSize: 16,
    fontWeight: '600',
  },
  cancel: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
});
