/**
 * Scheduled account deletion (~30-day grace) via authenticated delete-account.
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

type FlowStep = 'warning' | 'reason' | 'confirm' | 'verify';
type ReauthChannel = 'email' | 'phone';
type ReauthChallenge = {
  channel: ReauthChannel;
  maskedDestination: string;
  availableChannels?: ReauthChannel[];
};

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
  const [isDeleting, setIsDeleting] = useState(false);
  const [step, setStep] = useState<FlowStep>('warning');
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [reauthChallenge, setReauthChallenge] = useState<ReauthChallenge | null>(null);
  const [reauthCode, setReauthCode] = useState('');
  const [reauthError, setReauthError] = useState<string | null>(null);
  const [isRequestingVerification, setIsRequestingVerification] = useState(false);

  const {
    pendingDeletion,
    cancelDeletion,
    isCancelling,
    refetchDeletionState,
    deletionStateError,
    cancelDeletionError,
    clearDeletionStateError,
    clearCancelDeletionError,
  } = useDeletionRecovery(user?.id);
  const { show: showDialog, dialog: dialogEl } = useVibelyDialog();

  useFocusEffect(
    useCallback(() => {
      void refetchDeletionState();
    }, [refetchDeletionState])
  );

  const requestDeletionVerification = async (channel?: ReauthChannel) => {
    setIsRequestingVerification(true);
    setReauthError(null);
    try {
      const { data, error } = await supabase.functions.invoke('delete-account', {
        body: {
          action: 'request_reauth',
          ...(channel ? { reauthChannel: channel } : {}),
        },
      });
      const payload = data as {
        success?: boolean;
        error?: string;
        reauth?: ReauthChallenge;
      } | null;
      if (error || payload?.success !== true || !payload.reauth?.channel || !payload.reauth?.maskedDestination) {
        const message = payload?.error ?? 'We could not send a verification code. Try again in a moment.';
        setReauthError(message);
        showDialog({
          title: 'Couldn’t send code',
          message,
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
        return;
      }
      setReauthChallenge(payload.reauth);
      setReauthCode('');
      setStep('verify');
    } catch {
      const message = 'We couldn’t reach the server. Check your connection and try again.';
      setReauthError(message);
      showDialog({
        title: 'Connection issue',
        message,
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    } finally {
      setIsRequestingVerification(false);
    }
  };

  const requestAccountDeletion = async (reason: string | null, challenge: ReauthChallenge | null, code: string) => {
    if (!challenge || code.length !== 6) {
      setReauthError('Enter the 6-digit verification code.');
      return;
    }
    setIsDeleting(true);
    setReauthError(null);
    try {
      const { data, error } = await supabase.functions.invoke('delete-account', {
        body: {
          action: 'schedule_deletion',
          reason,
          reauthChannel: challenge.channel,
          reauthCode: code,
        },
      });
      const payload = data as {
        success?: boolean;
        error?: string;
        code?: string;
        warning?: string;
        deletion_request_pending?: boolean;
      } | null;
      if (error || payload?.success !== true) {
        if (!error && payload?.deletion_request_pending === true) {
          await refetchDeletionState();
          setStep('warning');
          setSelectedReason(null);
          setConfirmText('');
          setReauthChallenge(null);
          setReauthCode('');
          showDialog({
            title: 'Deletion request saved',
            message: payload.error ?? 'Your deletion request is saved, but some cleanup still needs a retry.',
            variant: 'warning',
            primaryAction: { label: 'OK', onPress: () => {} },
          });
          return;
        }
        if (payload?.code === 'reauth_invalid' || payload?.code === 'reauth_required') {
          setReauthError(payload.error ?? 'Verification failed. Request a new code and try again.');
          return;
        }
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
      setReauthChallenge(null);
      setReauthCode('');
      showDialog({
        title: 'Deletion scheduled',
        message: payload.warning ??
          'Your account is set to be removed after the date shown on this screen. You can keep using Vibely during the grace window, and you can return here before that date to tap “Cancel Deletion”.',
        variant: payload.warning ? 'warning' : 'success',
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
        label: 'Send verification code',
        onPress: () => void requestDeletionVerification(),
      },
      secondaryAction: { label: 'Not yet', onPress: () => {} },
    });
  };

  const updateReauthCode = (value: string) => {
    setReauthCode(value.replace(/\D/g, '').slice(0, 6));
    setReauthError(null);
  };

  const handleCancelPress = () => {
    void cancelDeletion();
  };

  const alternateReauthChannel =
    reauthChallenge?.availableChannels?.find((channel) => channel !== reauthChallenge.channel) ?? null;

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
        {pendingDeletion || deletionStateError ? (
          <>
            <DeletionRecoveryBanner
              scheduledDate={pendingDeletion?.scheduled_deletion_at}
              onCancel={handleCancelPress}
              isCancelling={isCancelling}
              deletionStateError={deletionStateError}
              onRetryDeletionState={() => void refetchDeletionState()}
              onDismissDeletionStateError={clearDeletionStateError}
              cancelDeletionError={cancelDeletionError}
              onDismissCancelDeletionError={clearCancelDeletionError}
            />
            {pendingDeletion ? (
              <Text style={[styles.body, { color: theme.textSecondary }]}>
                Your account is in the recovery window. You can keep using the app until the date above. Cancel anytime with the button on this screen, Account &
                Security, or your home banner.
              </Text>
            ) : null}
          </>
        ) : null}

        {!pendingDeletion && !deletionStateError ? (
          <>
            <Text style={[styles.lede, { color: theme.text }]}>
              Account deletion is scheduled, not instant: you get a multi-week period to cancel before data is permanently removed.
            </Text>

            {step === 'warning' ? (
              <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.surface }]}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>What happens</Text>
                <Bullet theme={theme} text="We submit a deletion request for your signed-in account." />
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
                  disabled={isDeleting || isRequestingVerification || confirmText !== 'DELETE'}
                  style={({ pressed }) => [
                    styles.deleteBtn,
                    {
                      backgroundColor: withAlpha(theme.danger, 0.09),
                      borderColor: withAlpha(theme.danger, 0.31),
                      opacity: confirmText !== 'DELETE' || isDeleting || isRequestingVerification ? 0.45 : 1,
                    },
                    pressed && confirmText === 'DELETE' && !isDeleting && !isRequestingVerification && { opacity: 0.9 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Open final confirmation to verify and schedule account deletion"
                >
                  {isRequestingVerification ? (
                    <ActivityIndicator size="small" color={theme.danger} />
                  ) : (
                    <>
                      <Ionicons name="shield-checkmark-outline" size={20} color={theme.danger} />
                      <Text style={[styles.deleteBtnLabel, { color: theme.danger }]}>Verify & schedule deletion</Text>
                    </>
                  )}
                </Pressable>
                <Pressable onPress={() => setStep('reason')} style={styles.backLink}>
                  <Text style={[styles.backLinkText, { color: theme.tint }]}>Back</Text>
                </Pressable>
              </View>
            ) : null}

            {step === 'verify' ? (
              <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.surface }]}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>Verify it’s you</Text>
                <Text style={[styles.body, { color: theme.textSecondary, marginBottom: spacing.md }]}>
                  Enter the 6-digit code sent to {reauthChallenge?.maskedDestination ?? 'your account'} before we schedule deletion.
                </Text>
                <TextInput
                  value={reauthCode}
                  onChangeText={updateReauthCode}
                  placeholder="000000"
                  placeholderTextColor={theme.mutedForeground}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  maxLength={6}
                  style={[styles.input, styles.otpInput, { color: theme.text, borderColor: reauthError ? theme.danger : theme.border }]}
                  accessibilityLabel="Enter 6-digit verification code"
                />
                {reauthError ? <Text style={[styles.errorText, { color: theme.danger }]}>{reauthError}</Text> : null}
                {alternateReauthChannel ? (
                  <Pressable
                    onPress={() => void requestDeletionVerification(alternateReauthChannel)}
                    disabled={isRequestingVerification || isDeleting}
                    style={({ pressed }) => [
                      styles.secondaryBtn,
                      {
                        borderColor: theme.border,
                        opacity: isRequestingVerification || isDeleting ? 0.65 : 1,
                      },
                      pressed && !isRequestingVerification && !isDeleting && { opacity: 0.85 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Use ${alternateReauthChannel} verification instead`}
                  >
                    <Text style={[styles.secondaryBtnText, { color: theme.textSecondary }]}>
                      Use {alternateReauthChannel === 'phone' ? 'phone' : 'email'} instead
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => void requestAccountDeletion(selectedReason, reauthChallenge, reauthCode)}
                  disabled={isDeleting || reauthCode.length !== 6}
                  style={({ pressed }) => [
                    styles.deleteBtn,
                    {
                      backgroundColor: withAlpha(theme.danger, 0.09),
                      borderColor: withAlpha(theme.danger, 0.31),
                      opacity: reauthCode.length !== 6 || isDeleting ? 0.45 : 1,
                    },
                    pressed && reauthCode.length === 6 && !isDeleting && { opacity: 0.9 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Verify code and schedule account deletion"
                >
                  {isDeleting ? (
                    <ActivityIndicator size="small" color={theme.danger} />
                  ) : (
                    <>
                      <Ionicons name="trash-outline" size={20} color={theme.danger} />
                      <Text style={[styles.deleteBtnLabel, { color: theme.danger }]}>Schedule deletion</Text>
                    </>
                  )}
                </Pressable>
                <View style={styles.rowActions}>
                  <Pressable
                    onPress={() => {
                      setReauthCode('');
                      setStep('confirm');
                    }}
                    style={({ pressed }) => [styles.secondaryBtn, { borderColor: theme.border }, pressed && { opacity: 0.85 }]}
                  >
                    <Text style={[styles.secondaryBtnText, { color: theme.textSecondary }]}>Back</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void requestDeletionVerification(reauthChallenge?.channel)}
                    disabled={isRequestingVerification}
                    style={({ pressed }) => [
                      styles.primaryBtn,
                      { backgroundColor: theme.tint, flex: 1, opacity: isRequestingVerification ? 0.7 : 1 },
                      pressed && !isRequestingVerification && { opacity: 0.9 },
                    ]}
                  >
                    <Text style={styles.primaryBtnText}>{isRequestingVerification ? 'Sending...' : 'Resend code'}</Text>
                  </Pressable>
                </View>
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
  otpInput: { textAlign: 'center', fontSize: 20, fontWeight: '700' },
  errorText: { fontSize: 13, lineHeight: 18, marginBottom: spacing.sm },
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
