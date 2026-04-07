/**
 * Scheduled account deletion (~30-day grace) via request-account-deletion — same contract as web public form.
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { GlassHeaderBar } from '@/components/ui';
import { spacing, layout, radius } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { withAlpha } from '@/lib/colorUtils';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { useDeletionRecovery } from '@/lib/useDeletionRecovery';
import { DeletionRecoveryBanner } from '@/components/settings/DeletionRecoveryBanner';
import { useVibelyDialog } from '@/components/VibelyDialog';

type FlowStep = 'warning' | 'reason' | 'confirm';

const DELETION_REASONS: { value: string; label: string }[] = [
  { value: 'found_someone', label: 'I found someone' },
  { value: 'not_enough_events', label: 'Not enough events near me' },
  { value: 'technical_issues', label: 'Technical issues' },
  { value: 'privacy_concerns', label: 'Privacy concerns' },
  { value: 'taking_break', label: 'Taking a break' },
  { value: 'other', label: 'Other' },
];

export default function DeleteAccountScreen() {
  const insets = useSafeAreaInsets();
  const theme = Colors[useColorScheme()];
  const { user } = useAuth();
  const email = user?.email ?? '';
  const [isDeleting, setIsDeleting] = useState(false);
  const [step, setStep] = useState<FlowStep>('warning');
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');

  const {
    pendingDeletion,
    cancelDeletion,
    isCancelling,
    refetchDeletionState,
    cancelDeletionError,
    clearCancelDeletionError,
  } = useDeletionRecovery(user?.id);
  const { show: showDialog, dialog: dialogEl } = useVibelyDialog();

  useFocusEffect(
    useCallback(() => {
      void refetchDeletionState();
    }, [refetchDeletionState])
  );

  const requestAccountDeletion = async (reason: string | null) => {
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
        body: { email, reason, source: 'native' },
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
      setStep('warning');
      setSelectedReason(null);
      setConfirmText('');
      showDialog({
        title: 'Deletion scheduled',
        message:
          'Your account is set to be removed after the date shown on this screen. Until then you can keep using Vibely. Tap “Cancel Deletion” anytime if you change your mind.',
        variant: 'success',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
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

  const openFinalConfirm = () => {
    showDialog({
      title: 'Schedule account deletion?',
      message:
        'We’ll submit your request now. You’ll have until the date shown in the banner to cancel — after that, your data is permanently removed.',
      variant: 'destructive',
      primaryAction: {
        label: 'Yes, schedule deletion',
        onPress: () => void requestAccountDeletion(selectedReason),
      },
      secondaryAction: { label: 'Not yet', onPress: () => {} },
    });
  };

  const handleCancelPress = () => {
    void cancelDeletion();
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
          <>
            <DeletionRecoveryBanner
              scheduledDate={pendingDeletion.scheduled_deletion_at}
              onCancel={handleCancelPress}
              isCancelling={isCancelling}
              cancelDeletionError={cancelDeletionError}
              onDismissCancelDeletionError={clearCancelDeletionError}
            />
            <Text style={[styles.body, { color: theme.textSecondary }]}>
              Your account is in the recovery window. You can keep using the app until the date above. Cancel anytime with the button on this screen, Account &
              Security, or your home banner.
            </Text>
          </>
        ) : null}

        {!pendingDeletion ? (
          <>
            <Text style={[styles.lede, { color: theme.text }]}>
              Account deletion is scheduled, not instant: you get a multi-week period to cancel before data is permanently removed.
            </Text>

            {step === 'warning' ? (
              <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.surface }]}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>What happens</Text>
                <Bullet theme={theme} text="We submit a deletion request for your account email." />
                <Bullet theme={theme} text="A final removal date is set about 30 days out (shown in the banner after you continue)." />
                <Bullet theme={theme} text="Until that date you stay signed in and can use Vibely as usual." />
                <Bullet theme={theme} text="You can cancel the request anytime before that date — your account will stay active." />
                <View style={styles.btnCol}>
                  <Pressable
                    onPress={() => setStep('reason')}
                    style={({ pressed }) => [styles.primaryBtn, { backgroundColor: theme.tint }, pressed && { opacity: 0.9 }]}
                    accessibilityRole="button"
                    accessibilityLabel="Continue to optional feedback step"
                  >
                    <Text style={styles.primaryBtnText}>Continue</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {step === 'reason' ? (
              <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.surface }]}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>Before you go (optional)</Text>
                <Text style={[styles.body, { color: theme.textSecondary, marginBottom: spacing.md }]}>
                  Tell us why you’re leaving — it helps us improve. You can skip this step.
                </Text>
                <View style={styles.chipWrap}>
                  {DELETION_REASONS.map((r) => {
                    const on = selectedReason === r.value;
                    return (
                      <Pressable
                        key={r.value}
                        onPress={() => setSelectedReason(on ? null : r.value)}
                        style={[
                          styles.chip,
                          {
                            borderColor: on ? theme.tint : theme.border,
                            backgroundColor: on ? withAlpha(theme.tint, 0.12) : theme.background,
                          },
                        ]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                      >
                        <Text style={[styles.chipText, { color: theme.text }]}>{r.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={styles.rowActions}>
                  <Pressable
                    onPress={() => {
                      setSelectedReason(null);
                      setStep('confirm');
                    }}
                    style={({ pressed }) => [styles.secondaryBtn, { borderColor: theme.border }, pressed && { opacity: 0.85 }]}
                  >
                    <Text style={[styles.secondaryBtnText, { color: theme.textSecondary }]}>Skip</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setStep('confirm')}
                    style={({ pressed }) => [styles.primaryBtn, { backgroundColor: theme.tint, flex: 1 }, pressed && { opacity: 0.9 }]}
                  >
                    <Text style={styles.primaryBtnText}>Continue</Text>
                  </Pressable>
                </View>
                <Pressable onPress={() => setStep('warning')} style={styles.backLink}>
                  <Text style={[styles.backLinkText, { color: theme.tint }]}>Back</Text>
                </Pressable>
              </View>
            ) : null}

            {step === 'confirm' ? (
              <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.surface }]}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>Confirm with DELETE</Text>
                <Text style={[styles.body, { color: theme.textSecondary, marginBottom: spacing.md }]}>
                  Type DELETE in capital letters, then confirm. This schedules your request — it does not remove your account immediately.
                </Text>
                <TextInput
                  value={confirmText}
                  onChangeText={setConfirmText}
                  placeholder="DELETE"
                  placeholderTextColor={theme.mutedForeground}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  style={[styles.input, { color: theme.text, borderColor: confirmText.length > 0 && confirmText !== 'DELETE' ? theme.danger : theme.border }]}
                  accessibilityLabel="Type DELETE to confirm scheduling account deletion"
                />
                <Pressable
                  onPress={() => void openFinalConfirm()}
                  disabled={isDeleting || confirmText !== 'DELETE'}
                  style={({ pressed }) => [
                    styles.deleteBtn,
                    {
                      backgroundColor: withAlpha(theme.danger, 0.09),
                      borderColor: withAlpha(theme.danger, 0.31),
                      opacity: confirmText !== 'DELETE' || isDeleting ? 0.45 : 1,
                    },
                    pressed && confirmText === 'DELETE' && !isDeleting && { opacity: 0.9 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Open final confirmation to schedule account deletion"
                >
                  {isDeleting ? (
                    <ActivityIndicator size="small" color={theme.danger} />
                  ) : (
                    <>
                      <Ionicons name="trash-outline" size={20} color={theme.danger} />
                      <Text style={[styles.deleteBtnLabel, { color: theme.danger }]}>Review & schedule deletion</Text>
                    </>
                  )}
                </Pressable>
                <Pressable onPress={() => setStep('reason')} style={styles.backLink}>
                  <Text style={[styles.backLinkText, { color: theme.tint }]}>Back</Text>
                </Pressable>
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Bullet({ theme, text }: { theme: (typeof Colors)['dark']; text: string }) {
  return (
    <View style={styles.bulletRow}>
      <View style={[styles.bulletDot, { backgroundColor: theme.danger }]} />
      <Text style={[styles.bulletText, { color: theme.textSecondary }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  backBtn: { padding: spacing.xs },
  headerTitle: { fontSize: 18, fontWeight: '700', flex: 1 },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: layout.mainContentPaddingTop, gap: spacing.lg },
  lede: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 14, lineHeight: 21 },
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardTitle: { fontSize: 17, fontWeight: '700', marginBottom: spacing.xs },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 4 },
  bulletDot: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },
  bulletText: { flex: 1, fontSize: 14, lineHeight: 20 },
  btnCol: { marginTop: spacing.md, gap: spacing.sm },
  rowActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, alignItems: 'center' },
  primaryBtn: {
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondaryBtn: {
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  secondaryBtnText: { fontSize: 15, fontWeight: '600' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipText: { fontSize: 13, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: spacing.md,
  },
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
  backLink: { marginTop: spacing.md, alignSelf: 'flex-start', paddingVertical: 4 },
  backLinkText: { fontSize: 15, fontWeight: '600' },
});
