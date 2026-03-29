/**
 * Scheduled account deletion (30-day grace) — same contract as web.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { GlassHeaderBar } from '@/components/ui';
import { spacing, layout } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { withAlpha } from '@/lib/colorUtils';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { useDeletionRecovery } from '@/lib/useDeletionRecovery';
import { DeletionRecoveryBanner } from '@/components/settings/DeletionRecoveryBanner';
import { useVibelyDialog } from '@/components/VibelyDialog';

export default function DeleteAccountScreen() {
  const insets = useSafeAreaInsets();
  const theme = Colors[useColorScheme()];
  const { user } = useAuth();
  const email = user?.email ?? '';
  const [isDeleting, setIsDeleting] = useState(false);
  const { pendingDeletion, cancelDeletion, isCancelling, refetchDeletionState } = useDeletionRecovery(user?.id);
  const { show: showDialog, dialog: dialogEl } = useVibelyDialog();

  const requestAccountDeletion = async () => {
    if (!email?.includes('@')) {
      showDialog({
        title: 'Email needed',
        message: 'We need a valid email on your account to schedule deletion.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
      return;
    }
    setIsDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke('request-account-deletion', {
        body: { email, reason: null, source: 'native' },
      });
      if (error || (data as { success?: boolean })?.success !== true) {
        showDialog({
          title: 'Couldn’t schedule deletion',
          message: 'Something went wrong on our end. Try again in a moment.',
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
        return;
      }
      await refetchDeletionState();
    } catch {
      showDialog({
        title: 'Connection issue',
        message: 'We couldn’t reach the server. Check your connection and try again.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const confirmSchedule = () => {
    showDialog({
      title: 'Delete your account?',
      message:
        'Your account will be scheduled for deletion. You have 30 days to change your mind — after that, your data is permanently removed.',
      variant: 'destructive',
      primaryAction: { label: 'Schedule deletion', onPress: () => void requestAccountDeletion() },
      secondaryAction: { label: 'Not now', onPress: () => {} },
    });
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      {dialogEl}
      <GlassHeaderBar insets={insets}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: theme.text }]}>Delete account</Text>
        </View>
      </GlassHeaderBar>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {pendingDeletion ? (
          <DeletionRecoveryBanner
            scheduledDate={pendingDeletion.scheduled_deletion_at}
            onCancel={cancelDeletion}
            isCancelling={isCancelling}
          />
        ) : null}

        <Text style={[styles.body, { color: theme.textSecondary }]}>
          Scheduling deletion starts a 30-day grace period. You can cancel anytime before the final date.
        </Text>

        {!pendingDeletion ? (
          <Pressable
            onPress={confirmSchedule}
            disabled={isDeleting}
            style={({ pressed }) => [
              styles.deleteBtn,
              { backgroundColor: withAlpha(theme.danger, 0.09), borderColor: withAlpha(theme.danger, 0.31) },
              pressed && { opacity: 0.9 },
            ]}
          >
            {isDeleting ? (
              <ActivityIndicator size="small" color={theme.danger} />
            ) : (
              <>
                <Ionicons name="trash-outline" size={20} color={theme.danger} />
                <Text style={[styles.deleteBtnLabel, { color: theme.danger }]}>Schedule account deletion</Text>
              </>
            )}
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  backBtn: { padding: spacing.xs },
  headerTitle: { fontSize: 18, fontWeight: '700', flex: 1 },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: layout.mainContentPaddingTop, gap: spacing.lg },
  body: { fontSize: 14, lineHeight: 21 },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    borderRadius: 12,
    borderWidth: 1,
  },
  deleteBtnLabel: { fontSize: 16, fontWeight: '600' },
});
