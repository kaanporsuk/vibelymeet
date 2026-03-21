/**
 * Scheduled account deletion (30-day grace) — same contract as web.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert, ActivityIndicator } from 'react-native';
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

export default function DeleteAccountScreen() {
  const insets = useSafeAreaInsets();
  const theme = Colors[useColorScheme()];
  const { user } = useAuth();
  const email = user?.email ?? '';
  const [isDeleting, setIsDeleting] = useState(false);
  const { pendingDeletion, cancelDeletion, isCancelling, refetchDeletionState } = useDeletionRecovery(user?.id);

  const requestAccountDeletion = async () => {
    if (!email?.includes('@')) {
      Alert.alert('Error', 'We need your email to schedule deletion.');
      return;
    }
    setIsDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke('request-account-deletion', {
        body: { email, reason: null, source: 'native' },
      });
      if (error || (data as { success?: boolean })?.success !== true) {
        Alert.alert('Error', 'Could not schedule deletion. Try again.');
        return;
      }
      await refetchDeletionState();
    } catch {
      Alert.alert('Error', 'Could not reach the server. Try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  const confirmSchedule = () => {
    Alert.alert(
      'Delete your account?',
      'Your account will be scheduled for deletion.\n\nYou have 30 days to change your mind.\n\nAfter 30 days, your data will be permanently deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Schedule deletion', style: 'destructive', onPress: requestAccountDeletion },
      ]
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
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
