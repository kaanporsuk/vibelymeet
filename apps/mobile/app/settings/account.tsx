/**
 * Account settings — email, verification, phone/email verify, pause/resume, scheduled deletion.
 *
 * Deletion: Native uses `request-account-deletion` (30-day grace) — same contract as web
 * (`email`, optional `reason`, `source: 'native'`). `cancel-deletion` revokes the schedule.
 * After 30 days the server runs final deletion (`delete-account`); no in-app immediate delete on native.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Linking, Alert, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Colors from '@/constants/Colors';
import { GlassHeaderBar, Card, VibelyButton } from '@/components/ui';
import { spacing, layout } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { withAlpha } from '@/lib/colorUtils';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { useDeletionRecovery } from '@/lib/useDeletionRecovery';
import { DeletionRecoveryBanner } from '@/components/settings/DeletionRecoveryBanner';
import { PhoneVerificationFlow } from '@/components/verification/PhoneVerificationFlow';
import { EmailVerificationFlow } from '@/components/verification/EmailVerificationFlow';

export default function AccountSettingsScreen() {
  const insets = useSafeAreaInsets();
  const theme = Colors[useColorScheme()];
  const { user } = useAuth();
  const email = user?.email ?? '';
  const qc = useQueryClient();
  const [showPhoneVerify, setShowPhoneVerify] = useState(false);
  const [showEmailVerify, setShowEmailVerify] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const { data: profile } = useQuery({
    queryKey: ['profile-account', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase
        .from('profiles')
        .select('phone_verified, email_verified, photo_verified, is_paused')
        .eq('id', user.id)
        .maybeSingle();
      return data as {
        phone_verified?: boolean;
        email_verified?: boolean;
        photo_verified?: boolean;
        is_paused?: boolean;
      } | null;
    },
    enabled: !!user?.id,
  });
  const [pauseLoading, setPauseLoading] = useState(false);
  const [resumeLoading, setResumeLoading] = useState(false);

  const pauseAccount = async (duration: 'day' | 'week' | 'indefinite') => {
    setPauseLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('account-pause', { body: { duration } });
      if (error || (data as { success?: boolean })?.success !== true) {
        Alert.alert('Error', 'Could not pause your account. Try again.');
        return;
      }
      await qc.invalidateQueries({ queryKey: ['profile-account', user?.id] });
      await qc.invalidateQueries({ queryKey: ['my-profile'] });
      Alert.alert('Account paused', 'Your profile is hidden from events and matches. You can resume anytime.');
    } finally {
      setPauseLoading(false);
    }
  };

  const resumeAccount = async () => {
    setResumeLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('account-resume', { body: {} });
      if (error || (data as { success?: boolean })?.success !== true) {
        Alert.alert('Error', 'Could not resume. Try again.');
        return;
      }
      await qc.invalidateQueries({ queryKey: ['profile-account', user?.id] });
      await qc.invalidateQueries({ queryKey: ['my-profile'] });
    } finally {
      setResumeLoading(false);
    }
  };

  const confirmPause = () => {
    Alert.alert(
      'Pause account',
      'Your profile will be hidden from events and matches. Choose how long.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: '24 hours', onPress: () => pauseAccount('day') },
        { text: '1 week', onPress: () => pauseAccount('week') },
        { text: 'Until I resume', style: 'destructive', onPress: () => pauseAccount('indefinite') },
      ]
    );
  };
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
      if (error) {
        Alert.alert('Error', 'Could not schedule deletion. Try again.');
        setIsDeleting(false);
        return;
      }
      if ((data as { success?: boolean })?.success !== true) {
        Alert.alert('Error', 'Something went wrong. Try again.');
        setIsDeleting(false);
        return;
      }
      await refetchDeletionState();
    } catch {
      Alert.alert('Error', 'Could not reach the server. Try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  const confirmDeleteAccount = () => {
    Alert.alert(
      'Delete your account?',
      'Your account will be scheduled for deletion.\n\nYou have 30 days to change your mind.\n\nAfter 30 days, all your data will be permanently deleted. This includes your profile, matches, messages, and media.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete my account', style: 'destructive', onPress: requestAccountDeletion },
      ]
    );
  };

  const refetchProfile = () => {
    qc.invalidateQueries({ queryKey: ['profile-account', user?.id] });
    qc.invalidateQueries({ queryKey: ['my-profile'] });
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <GlassHeaderBar insets={insets}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: theme.text }]}>Account</Text>
        </View>
      </GlassHeaderBar>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: layout.scrollContentPaddingBottomTab }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.main}>
          {pendingDeletion && (
            <DeletionRecoveryBanner
              scheduledDate={pendingDeletion.scheduled_deletion_at}
              onCancel={cancelDeletion}
              isCancelling={isCancelling}
            />
          )}
          <Card variant="glass" style={[styles.card, { borderColor: theme.glassBorder }]}>
            <View style={[styles.iconWrap, { backgroundColor: theme.tintSoft }]}>
              <Ionicons name="person-circle-outline" size={32} color={theme.tint} />
            </View>
            <Text style={[styles.label, { color: theme.textSecondary }]}>Signed in as</Text>
            <Text style={[styles.email, { color: theme.text }]} numberOfLines={1}>{email || '—'}</Text>
            <View style={styles.verificationRow}>
              {profile?.phone_verified ? (
                <View style={[styles.badge, { backgroundColor: withAlpha(theme.success, 0.15) }]}>
                  <Ionicons name="call" size={14} color={theme.success} />
                  <Text style={[styles.badgeText, { color: theme.success }]}>Phone verified</Text>
                </View>
              ) : (
                <Pressable onPress={() => setShowPhoneVerify(true)} style={[styles.badge, { backgroundColor: theme.surfaceSubtle }]}>
                  <Ionicons name="call" size={14} color={theme.textSecondary} />
                  <Text style={[styles.badgeText, { color: theme.textSecondary }]}>Verify Phone</Text>
                </Pressable>
              )}
              {profile?.email_verified ? (
                <View style={[styles.badge, { backgroundColor: withAlpha(theme.success, 0.15) }]}>
                  <Ionicons name="mail" size={14} color={theme.success} />
                  <Text style={[styles.badgeText, { color: theme.success }]}>Email verified</Text>
                </View>
              ) : (
                <Pressable onPress={() => setShowEmailVerify(true)} style={[styles.badge, { backgroundColor: theme.surfaceSubtle }]}>
                  <Ionicons name="mail" size={14} color={theme.textSecondary} />
                  <Text style={[styles.badgeText, { color: theme.textSecondary }]}>Verify Email</Text>
                </Pressable>
              )}
              <View style={[styles.badge, (profile?.photo_verified) ? { backgroundColor: withAlpha(theme.success, 0.15) } : { backgroundColor: theme.surfaceSubtle }]}>
                <Ionicons name="camera" size={14} color={profile?.photo_verified ? theme.success : theme.textSecondary} />
                <Text style={[styles.badgeText, { color: profile?.photo_verified ? theme.success : theme.textSecondary }]}>
                  {profile?.photo_verified ? 'Photo verified' : 'Photo not verified'}
                </Text>
              </View>
            </View>
            <Text style={[styles.body, { color: theme.textSecondary }]}>
              Change password and other settings on web. Pause or resume below.
            </Text>
            {profile?.is_paused ? (
              <View style={[styles.pausedBanner, { backgroundColor: withAlpha(theme.tint, 0.12), borderColor: theme.tint }]}>
                <Ionicons name="pause-circle" size={22} color={theme.tint} />
                <Text style={[styles.pausedText, { color: theme.text }]}>Your account is paused</Text>
              </View>
            ) : null}
            {profile?.is_paused ? (
              <VibelyButton
                label={resumeLoading ? 'Resuming…' : 'Resume account'}
                onPress={() => resumeAccount()}
                variant="primary"
                style={styles.cta}
                disabled={resumeLoading}
              />
            ) : (
              <VibelyButton
                label={pauseLoading ? 'Pausing…' : 'Pause account'}
                onPress={confirmPause}
                variant="secondary"
                style={styles.cta}
                disabled={pauseLoading}
              />
            )}
            <VibelyButton
              label="Open account settings on web"
              onPress={() => Linking.openURL('https://vibelymeet.com/settings').catch(() => {})}
              variant="secondary"
              style={styles.ctaSecondary}
            />
          </Card>

          {!pendingDeletion && (
            <Pressable
              onPress={confirmDeleteAccount}
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
                  <Text style={[styles.deleteBtnLabel, { color: theme.danger }]}>Delete Account</Text>
                </>
              )}
            </Pressable>
          )}
        </View>
      </ScrollView>

      <PhoneVerificationFlow
        visible={showPhoneVerify}
        onClose={() => setShowPhoneVerify(false)}
        onVerified={refetchProfile}
      />
      <EmailVerificationFlow
        visible={showEmailVerify}
        email={email}
        onClose={() => setShowEmailVerify(false)}
        onVerified={refetchProfile}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  backBtn: { padding: spacing.xs },
  headerTitle: { fontSize: 18, fontWeight: '600', flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingTop: layout.mainContentPaddingTop, paddingHorizontal: spacing.lg },
  main: {},
  card: { padding: spacing.lg },
  iconWrap: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  label: { fontSize: 12, fontWeight: '600', marginBottom: 4 },
  email: { fontSize: 16, fontWeight: '500', marginBottom: spacing.sm },
  verificationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  body: { fontSize: 14, lineHeight: 20, marginBottom: spacing.md },
  cta: { marginTop: spacing.sm },
  ctaSecondary: { marginTop: spacing.sm },
  pausedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  pausedText: { fontSize: 15, fontWeight: '600', flex: 1 },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    borderRadius: 12,
    borderWidth: 1,
  },
  deleteBtnLabel: { fontSize: 16, fontWeight: '600' },
});
