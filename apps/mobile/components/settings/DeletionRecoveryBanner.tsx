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
  scheduledDate: string;
  onCancel: () => void;
  isCancelling: boolean;
};

export function DeletionRecoveryBanner({ scheduledDate, onCancel, isCancelling }: DeletionRecoveryBannerProps) {
  const theme = Colors[useColorScheme()];
  const formatted = format(new Date(scheduledDate), 'MMMM d, yyyy');

  return (
    <View style={[styles.banner, { backgroundColor: withAlpha(theme.danger, 0.09), borderColor: withAlpha(theme.danger, 0.31) }]}>
      <Ionicons name="warning" size={22} color={theme.danger} style={styles.icon} />
      <View style={styles.content}>
        <Text style={[styles.title, { color: theme.text }]}>
          Your account is scheduled for deletion on {formatted}.
        </Text>
        <Pressable
          onPress={onCancel}
          disabled={isCancelling}
          style={[styles.btn, { borderColor: withAlpha(theme.danger, 0.5) }, isCancelling && styles.btnDisabled]}
        >
          {isCancelling ? (
            <ActivityIndicator size="small" color={theme.danger} />
          ) : (
            <Text style={[styles.btnLabel, { color: theme.danger }]}>Cancel Deletion</Text>
          )}
        </Pressable>
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
});
