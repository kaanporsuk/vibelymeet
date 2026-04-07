/**
 * Deletion recovery banner — parity with web: scheduled date, Cancel Deletion CTA.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { format } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { withAlpha } from '@/lib/colorUtils';
import { spacing, radius } from '@/constants/theme';

type DeletionRecoveryBannerProps = {
  scheduledDate?: string | null;
  onCancel?: () => void;
  isCancelling?: boolean;
  deletionStateError?: string | null;
  onRetryDeletionState?: () => void;
  onDismissDeletionStateError?: () => void;
  cancelDeletionError?: string | null;
  onDismissCancelDeletionError?: () => void;
};

export function DeletionRecoveryBanner({
  scheduledDate,
  onCancel,
  isCancelling = false,
  deletionStateError,
  onRetryDeletionState,
  onDismissDeletionStateError,
  cancelDeletionError,
  onDismissCancelDeletionError,
}: DeletionRecoveryBannerProps) {
  const theme = Colors[useColorScheme()];
  const formatted = scheduledDate ? format(new Date(scheduledDate), 'MMMM d, yyyy') : null;

  if (!formatted && !deletionStateError) return null;

  return (
    <View style={[styles.banner, { backgroundColor: withAlpha(theme.danger, 0.09), borderColor: withAlpha(theme.danger, 0.31) }]}>
      <Ionicons name="warning" size={22} color={theme.danger} style={styles.icon} />
      <View style={styles.content}>
        <Text style={[styles.title, { color: theme.text }]}>
          {formatted
            ? `Your account is scheduled for deletion on ${formatted}.`
            : 'We couldn’t load your scheduled deletion status.'}
        </Text>
        {formatted && onCancel ? (
          <Pressable
            onPress={onCancel}
            disabled={isCancelling}
            accessibilityRole="button"
            accessibilityLabel="Cancel scheduled account deletion"
            style={[styles.btn, { borderColor: withAlpha(theme.danger, 0.5) }, isCancelling && styles.btnDisabled]}
          >
            {isCancelling ? (
              <ActivityIndicator size="small" color={theme.danger} />
            ) : (
              <Text style={[styles.btnLabel, { color: theme.danger }]}>Cancel Deletion</Text>
            )}
          </Pressable>
        ) : null}
        {deletionStateError ? (
          <View style={styles.errWrap}>
            <Text style={[styles.errText, { color: theme.danger }]}>{deletionStateError}</Text>
            <View style={styles.errActions}>
              {onRetryDeletionState ? (
                <Pressable onPress={onRetryDeletionState} hitSlop={8} accessibilityRole="button" accessibilityLabel="Retry loading deletion status">
                  <Text style={[styles.dismissErr, { color: theme.tint }]}>Retry</Text>
                </Pressable>
              ) : null}
              {onDismissDeletionStateError ? (
                <Pressable onPress={onDismissDeletionStateError} hitSlop={8} accessibilityRole="button" accessibilityLabel="Dismiss deletion status error">
                  <Text style={[styles.dismissErr, { color: theme.tint }]}>Dismiss</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}
        {cancelDeletionError ? (
          <View style={styles.errWrap}>
            <Text style={[styles.errText, { color: theme.danger }]}>{cancelDeletionError}</Text>
            {onDismissCancelDeletionError ? (
              <Pressable onPress={onDismissCancelDeletionError} hitSlop={8} accessibilityRole="button" accessibilityLabel="Dismiss error">
                <Text style={[styles.dismissErr, { color: theme.tint }]}>Dismiss</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderWidth: 1,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  icon: { marginRight: spacing.md, marginTop: 2 },
  content: { flex: 1 },
  title: { fontSize: 14, fontWeight: '500', marginBottom: spacing.sm },
  btn: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  btnDisabled: { opacity: 0.7 },
  btnLabel: { fontSize: 13, fontWeight: '600' },
  errWrap: { marginTop: spacing.sm, gap: 6 },
  errActions: { flexDirection: 'row', gap: spacing.md },
  errText: { fontSize: 12, lineHeight: 17, fontWeight: '500' },
  dismissErr: { fontSize: 12, fontWeight: '700' },
});
