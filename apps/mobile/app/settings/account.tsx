/**
 * Account & Security Center — sign-in, verification, membership, take a break, danger zone.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Linking,
  Platform,
  Image,
  TextInput,
  ScrollView as RNHScroll,
} from 'react-native';
import { router, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import Purchases, { type CustomerInfo, PURCHASES_ERROR_CODE } from 'react-native-purchases';

import Colors from '@/constants/Colors';
import { GlassHeaderBar, VibelyButton } from '@/components/ui';
import { spacing, layout, radius } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { withAlpha } from '@/lib/colorUtils';
import { useAuth } from '@/context/AuthContext';
import { useNativeLogout } from '@/hooks/useNativeLogout';
import { presentNativeLogoutConfirm } from '@/lib/presentNativeLogoutConfirm';
import { supabase } from '@/lib/supabase';
import { useDeletionRecovery } from '@/lib/useDeletionRecovery';
import { DeletionRecoveryBanner } from '@/components/settings/DeletionRecoveryBanner';
import { PhoneVerificationFlow } from '@/components/verification/PhoneVerificationFlow';
import { EmailVerificationFlow } from '@/components/verification/EmailVerificationFlow';
import { PhotoVerificationFlow } from '@/components/verification/PhotoVerificationFlow';
import { avatarUrl } from '@/lib/imageUrl';
import { isRevenueCatConfigured, restorePurchasesWithCustomerInfo } from '@/lib/revenuecat';
import { syncRevenueCatSubscriberFromServer } from '@/lib/syncRevenueCatSubscriber';
import { useEntitlements } from '@/hooks/useEntitlements';
import { KeyboardAwareBottomSheetModal } from '@/components/keyboard/KeyboardAwareBottomSheetModal';
import { useVibelyDialog } from '@/components/VibelyDialog';
import { useStatusDialog } from '@/components/ui/StatusDialog';
import { endAccountBreakForUser } from '@/lib/endAccountBreak';
import { fetchMyPhotoVerificationState, type PhotoVerificationState } from '@/lib/photoVerificationState';

const CYAN = '#22D3EE';
const AMBER = '#F59E0B';
const VIOLET = '#8B5CF6';

type BreakChip = '24h' | '3d' | '1w' | '2w' | 'indefinite';

type AccountProfile = {
  name: string | null;
  created_at: string | null;
  avatar_url: string | null;
  phone_number: string | null;
  phone_verified: boolean | null;
  email_verified: boolean | null;
  photo_verified: boolean | null;
  account_paused: boolean | null;
  account_paused_until: string | null;
  is_paused: boolean | null;
  paused_until: string | null;
};

function maskPhoneE164(raw: string | null | undefined): string {
  if (!raw) return 'Not set';
  return raw.replace(/(\+\d{1,3})\d+(\d{2})$/, '$1 ••• •• $2');
}

function memberSinceLabel(iso: string | null | undefined): string {
  if (!iso) return 'Member since —';
  try {
    const d = new Date(iso);
    return `Member since ${d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
  } catch {
    return 'Member since —';
  }
}

function breakUntilForChip(chip: BreakChip): Date | null {
  const now = Date.now();
  const h = 60 * 60 * 1000;
  const d = 24 * h;
  switch (chip) {
    case '24h':
      return new Date(now + d);
    case '3d':
      return new Date(now + 3 * d);
    case '1w':
      return new Date(now + 7 * d);
    case '2w':
      return new Date(now + 14 * d);
    default:
      return null;
  }
}

function formatBreakEnd(d: Date | null): string {
  if (!d) return 'indefinitely';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function passwordStrengthLabel(pw: string): { label: string; tone: 'weak' | 'fair' | 'strong' } {
  if (pw.length < 8) return { label: 'Weak', tone: 'weak' };
  let score = 0;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 2) return { label: 'Fair', tone: 'fair' };
  return { label: 'Strong', tone: 'strong' };
}

function subscriptionManageUrl(): string {
  if (Platform.OS === 'android') return 'https://play.google.com/store/account/subscriptions';
  return 'https://apps.apple.com/account/subscriptions';
}

function deriveRcMembership(info: CustomerInfo): { tier: 'none' | 'premium' | 'vip'; expiry: string | null } {
  const active = info.entitlements.active;
  const vip = active['vip'];
  const prem = active['premium'];
  if (vip) return { tier: 'vip', expiry: vip.expirationDate ?? null };
  if (prem) return { tier: 'premium', expiry: prem.expirationDate ?? null };
  const first = Object.values(active)[0];
  if (first) return { tier: 'premium', expiry: first.expirationDate ?? null };
  return { tier: 'none', expiry: null };
}

function ValueChip({ label, accentColor }: { label: string; accentColor: string }) {
  return (
    <View
      style={[
        styles.valueChip,
        { backgroundColor: withAlpha(accentColor, 0.15), borderColor: withAlpha(accentColor, 0.3) },
      ]}
    >
      <Text style={[styles.valueChipText, { color: accentColor }]}>{label}</Text>
    </View>
  );
}

function SoonBadge({ theme }: { theme: (typeof Colors)['dark'] }) {
  return (
    <View
      style={[
        styles.valueChip,
        {
          backgroundColor: withAlpha(theme.mutedForeground, 0.1),
          borderColor: withAlpha(theme.mutedForeground, 0.2),
        },
      ]}
    >
      <Text style={[styles.soonText, { color: theme.mutedForeground }]}>Soon</Text>
    </View>
  );
}

export default function AccountSettingsScreen() {
  const insets = useSafeAreaInsets();
  const theme = Colors[useColorScheme()];
  const { show, dialog } = useVibelyDialog();
  const { show: showPurchaseDialog, dialog: purchaseDialog } = useStatusDialog();
  const { user } = useAuth();
  const logout = useNativeLogout();
  const { refetch: refetchEntitlements } = useEntitlements();
  const qc = useQueryClient();
  const email = user?.email ?? '';

  const [emailForVerification, setEmailForVerification] = useState(email);

  const [copiedToast, setCopiedToast] = useState(false);
  const [showPhoneVerify, setShowPhoneVerify] = useState(false);
  const [showEmailVerify, setShowEmailVerify] = useState(false);
  const [showPhotoVerify, setShowPhotoVerify] = useState(false);
  const [photoVerificationState, setPhotoVerificationState] = useState<PhotoVerificationState>('none');
  const [emailSheetOpen, setEmailSheetOpen] = useState(false);
  const [passwordSheetOpen, setPasswordSheetOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);

  const [newEmail, setNewEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [emailSubmitting, setEmailSubmitting] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);

  const [breakChip, setBreakChip] = useState<BreakChip | null>(null);
  const [breakBusy, setBreakBusy] = useState(false);

  const [rcTier, setRcTier] = useState<'none' | 'premium' | 'vip'>('none');
  const [rcExpiry, setRcExpiry] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const { pendingDeletion, cancelDeletion, isCancelling } = useDeletionRecovery(user?.id);

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['profile-account', user?.id],
    queryFn: async (): Promise<AccountProfile | null> => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select(
          'name, created_at, avatar_url, phone_number, phone_verified, email_verified, photo_verified, account_paused, account_paused_until, is_paused, paused_until'
        )
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data as AccountProfile | null;
    },
    enabled: !!user?.id,
  });

  const { data: credits } = useQuery({
    queryKey: ['user_credits', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from('user_credits')
        .select('extra_time_credits, extended_vibe_credits')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });

  const refreshProfile = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['profile-account', user?.id] });
    qc.invalidateQueries({ queryKey: ['my-profile'] });
    qc.invalidateQueries({ queryKey: ['privacy-profile', user?.id] });
  }, [qc, user?.id]);

  const refreshPhotoVerificationState = useCallback(async () => {
    if (!user?.id) return;
    const next = await fetchMyPhotoVerificationState(user.id);
    setPhotoVerificationState(next.state);
  }, [user?.id]);

  useEffect(() => {
    void refreshPhotoVerificationState();
  }, [refreshPhotoVerificationState]);

  useEffect(() => {
    // Keep the verification email in sync with the current auth email when not actively verifying.
    if (!showEmailVerify) setEmailForVerification(email);
  }, [email, showEmailVerify]);

  const openEmailVerification = useCallback(
    (nextEmail?: string) => {
      const e = (nextEmail ?? email).trim();
      setEmailForVerification(e);
      setShowEmailVerify(true);
    },
    [email],
  );

  const openPhotoVerification = useCallback(() => {
    if (photoVerificationState === 'approved') return;
    if (photoVerificationState === 'pending') {
      show({
        title: 'Under review',
        message: 'Your selfie is currently under review. We’ll update your badge when approved.',
        variant: 'info',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
      return;
    }
    if (!profile?.avatar_url) {
      show({
        title: 'Add a profile photo first',
        message: 'Please add a profile photo before submitting selfie verification.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
      return;
    }
    setShowPhotoVerify(true);
  }, [photoVerificationState, profile?.avatar_url, profile?.name, profile?.phone_number, show]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isRevenueCatConfigured()) return;
      try {
        const info = await Purchases.getCustomerInfo();
        if (cancelled) return;
        const { tier, expiry } = deriveRcMembership(info);
        setRcTier(tier);
        setRcExpiry(expiry);
      } catch {
        if (!cancelled) {
          setRcTier('none');
          setRcExpiry(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const oauthProvider = useMemo(() => {
    const ids = user?.identities ?? [];
    const g = ids.find((i) => i.provider === 'google');
    if (g) return 'Google' as const;
    const a = ids.find((i) => i.provider === 'apple');
    if (a) return 'Apple' as const;
    return null;
  }, [user?.identities]);

  const hasEmailPasswordIdentity = useMemo(
    () => (user?.identities ?? []).some((i) => i.provider === 'email'),
    [user?.identities]
  );

  const onBreak = !!(profile?.account_paused || profile?.is_paused);
  const breakUntilIso = profile?.account_paused_until ?? profile?.paused_until ?? null;

  const creditTotal = (credits?.extra_time_credits ?? 0) + (credits?.extended_vibe_credits ?? 0);

  const copySupportId = async () => {
    if (!user?.id) return;
    await Clipboard.setStringAsync(user.id.slice(0, 8));
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      /* optional */
    }
    setCopiedToast(true);
    setTimeout(() => setCopiedToast(false), 2000);
  };

  const applyTakeBreak = async () => {
    if (!user?.id || !breakChip) return;

    // Safety: suspended users cannot use Take a Break to mask their state
    const { data: safetyCheck } = await supabase
      .from('profiles')
      .select('is_suspended')
      .eq('id', user.id)
      .maybeSingle();

    if (safetyCheck?.is_suspended) {
      show({
        title: 'Account restricted',
        message: 'Your account is currently restricted. Please contact support.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
      return;
    }

    const until = breakUntilForChip(breakChip);
    const now = new Date().toISOString();
    setBreakBusy(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          account_paused: true,
          account_paused_until: until?.toISOString() ?? null,
          is_paused: true,
          paused_until: until?.toISOString() ?? null,
          paused_at: now,
          pause_reason: 'user_break',
          discoverable: false,
          discovery_mode: 'hidden',
          discovery_snooze_until: null,
        })
        .eq('id', user.id);
      if (error) {
        show({
          title: 'Couldn’t update',
          message: error.message,
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
        return;
      }
      refreshProfile();
      qc.invalidateQueries({ queryKey: ['account-pause-status'] });
      setBreakChip(null);
      show({
        title: 'You’re on a break',
        message: 'We’ll be here when you’re ready.',
        variant: 'success',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    } finally {
      setBreakBusy(false);
    }
  };

  const confirmTakeBreak = () => {
    if (!breakChip) return;
    const until = breakUntilForChip(breakChip);
    show({
      title: 'Take a break?',
      message: `You’ll be hidden until ${formatBreakEnd(until)}. Your matches and chats stay as they are.`,
      variant: 'info',
      primaryAction: { label: 'Confirm', onPress: () => void applyTakeBreak() },
      secondaryAction: { label: 'Cancel', onPress: () => {} },
    });
  };

  const endBreak = async () => {
    if (!user?.id) return;
    setBreakBusy(true);
    try {
      const { error } = await endAccountBreakForUser(user.id);
      if (error) {
        show({
          title: 'Couldn’t update',
          message: error.message,
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
        return;
      }
      refreshProfile();
      qc.invalidateQueries({ queryKey: ['account-pause-status'] });
      show({
        title: 'Welcome back!',
        message: 'You’re visible in discovery again.',
        variant: 'success',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    } finally {
      setBreakBusy(false);
    }
  };

  const confirmDeactivate = async () => {
    if (!user?.id) return;
    const { error } = await supabase
      .from('profiles')
      .update({
        account_paused: true,
        account_paused_until: null,
        is_paused: true,
        paused_until: null,
        paused_at: new Date().toISOString(),
        pause_reason: 'deactivated',
        discoverable: false,
        discovery_mode: 'hidden',
        discovery_snooze_until: null,
      })
      .eq('id', user.id);
    setDeactivateOpen(false);
    if (error) {
      show({
        title: 'Couldn’t deactivate',
        message: error.message,
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
      return;
    }
    await logout();
  };

  const openDeleteFlow = () => {
    const isPremium = rcTier !== 'none';
    const msg = isPremium
      ? 'You have an active Vibely Premium subscription. Deleting your account does NOT automatically cancel your subscription. Cancel it in the App Store or Play Store first.'
      : 'Your account and all data will be permanently deleted.';
    const subUrl = subscriptionManageUrl();
    if (isPremium) {
      show({
        title: 'Before you delete',
        message: msg,
        variant: 'warning',
        primaryAction: {
          label: 'Manage subscription',
          onPress: () => {
            void Linking.openURL(subUrl).catch(() => {});
          },
        },
        secondaryAction: {
          label: 'Continue anyway',
          onPress: () => router.push('/delete-account' as Href),
        },
      });
    } else {
      show({
        title: 'Before you delete',
        message: msg,
        variant: 'destructive',
        primaryAction: { label: 'Continue', onPress: () => router.push('/delete-account' as Href) },
        secondaryAction: { label: 'Cancel', onPress: () => {} },
      });
    }
  };

  const handleRestorePurchases = async () => {
    if (!isRevenueCatConfigured()) {
      showPurchaseDialog({
        variant: 'info',
        title: 'Unavailable',
        message: 'In-app purchases are not configured on this build.',
        primaryActionLabel: 'Got it',
        onPrimaryAction: () => {},
      });
      return;
    }
    setRestoring(true);
    try {
      const sdk = await restorePurchasesWithCustomerInfo();
      if (!sdk.ok) {
        if (sdk.errorCode === PURCHASES_ERROR_CODE.NETWORK_ERROR) {
          showPurchaseDialog({
            variant: 'warning',
            title: 'Connection problem',
            message: 'Please check your internet connection and try again.',
            primaryActionLabel: 'OK',
            onPrimaryAction: () => {},
            backdropDismissible: false,
          });
        } else {
          showPurchaseDialog({
            variant: 'error',
            title: 'Couldn’t restore',
            message: 'Something went wrong. Please try again or contact support.',
            primaryActionLabel: 'OK',
            onPrimaryAction: () => {},
            backdropDismissible: false,
          });
        }
        console.error('Restore purchases error:', sdk.error);
        return;
      }

      const activeEntitlements = sdk.customerInfo.entitlements.active;
      if (Object.keys(activeEntitlements).length > 0) {
        const hasVip = activeEntitlements['vip'] !== undefined;
        const hasPremium = activeEntitlements['premium'] !== undefined;
        const newTier = hasVip ? 'vip' : hasPremium ? 'premium' : 'premium';

        if (user?.id) {
          await syncRevenueCatSubscriberFromServer();
        }

        const { tier, expiry } = deriveRcMembership(sdk.customerInfo);
        setRcTier(tier);
        setRcExpiry(expiry);

        await refetchEntitlements();
        qc.invalidateQueries({ queryKey: ['backend-subscription', user?.id] });
        refreshProfile();

        const label = newTier === 'vip' ? 'VIP' : 'Premium';
        showPurchaseDialog({
          variant: 'success',
          title: 'Purchases restored',
          message: `Your ${label} membership has been restored.`,
          primaryActionLabel: 'Great',
          onPrimaryAction: () => {},
        });
      } else {
        setRcTier('none');
        setRcExpiry(null);
        const storeAccountHint =
          Platform.OS === 'ios'
            ? 'We couldn’t find an active Vibely purchase linked to this Apple account.'
            : 'We couldn’t find an active Vibely purchase linked to this Google account.';
        showPurchaseDialog({
          variant: 'info',
          title: 'Nothing to restore',
          message: storeAccountHint,
          primaryActionLabel: 'Got it',
          onPrimaryAction: () => {},
        });
      }
    } finally {
      setRestoring(false);
    }
  };

  const displayName = profile?.name?.trim() || 'Member';
  const av = avatarUrl(profile?.avatar_url, 'avatar');

  const strength = passwordStrengthLabel(newPassword);
  const strengthColor =
    strength.tone === 'weak' ? theme.danger : strength.tone === 'fair' ? AMBER : theme.success;

  return (
    <>
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <GlassHeaderBar insets={insets}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </Pressable>
          <View style={styles.headerTitles}>
            <Text style={[styles.headerTitle, { color: theme.text }]}>Account & Security</Text>
            <Text style={[styles.headerSub, { color: theme.mutedForeground }]}>Manage your sign-in, trust, membership, and control.</Text>
          </View>
        </View>
      </GlassHeaderBar>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {pendingDeletion ? (
          <DeletionRecoveryBanner
            scheduledDate={pendingDeletion.scheduled_deletion_at}
            onCancel={cancelDeletion}
            isCancelling={isCancelling}
          />
        ) : null}

        {profileLoading ? (
          <ActivityIndicator color={theme.tint} style={{ marginVertical: 24 }} />
        ) : (
          <>
            {/* Summary card */}
            <View style={[styles.summaryCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <View style={styles.summaryRow}>
                <Image source={{ uri: av }} style={styles.avatar} />
                <View style={styles.summaryTextCol}>
                  <Text style={[styles.displayName, { color: theme.text }]} numberOfLines={1}>
                    {displayName}
                  </Text>
                  <Text style={[styles.emailLine, { color: theme.mutedForeground }]} numberOfLines={1}>
                    {email || '—'}
                  </Text>
                  <Text style={[styles.memberSince, { color: theme.mutedForeground }]}>{memberSinceLabel(profile?.created_at)}</Text>
                  <Pressable onPress={copySupportId} hitSlop={8}>
                    <Text style={[styles.supportId, { color: theme.mutedForeground }]}>ID: {user?.id?.slice(0, 8) ?? '—'}</Text>
                  </Pressable>
                </View>
              </View>
              <View style={styles.trustRow}>
                <TrustMini
                  theme={theme}
                  label="Phone"
                  verified={!!profile?.phone_verified}
                  onVerify={() => setShowPhoneVerify(true)}
                />
                <TrustMini
                  theme={theme}
                  label="Email"
                  verified={!!profile?.email_verified}
                  onVerify={() => openEmailVerification()}
                />
                <TrustMini
                  theme={theme}
                  label="Photo"
                  verified={!!profile?.photo_verified}
                  onVerify={openPhotoVerification}
                />
              </View>
            </View>

            <SectionTitle theme={theme} text="SIGN-IN & SECURITY" />
            <CardShell theme={theme}>
              <AccountRow
                theme={theme}
                icon="mail-outline"
                iconColor={theme.tint}
                title="Email address"
                subtitle={email || '—'}
                onPress={() => setEmailSheetOpen(true)}
              />
              <Hairline theme={theme} />
              <AccountRow
                theme={theme}
                icon="call-outline"
                iconColor={theme.tint}
                title="Phone number"
                subtitle={profile?.phone_number ? maskPhoneE164(profile.phone_number) : 'Not set'}
                right={
                  <View style={styles.rowRight}>
                    {!profile?.phone_number ? <ValueChip label="Add" accentColor={theme.tint} /> : null}
                    <Ionicons name="chevron-forward" size={18} color={theme.mutedForeground} />
                  </View>
                }
                onPress={() => setShowPhoneVerify(true)}
              />
              <Hairline theme={theme} />
              <AccountRow
                theme={theme}
                icon="lock-closed-outline"
                iconColor={theme.tint}
                title="Password"
                subtitle="••••••••"
                onPress={() => setPasswordSheetOpen(true)}
              />
              <Hairline theme={theme} />
              <DisabledAccountRow
                theme={theme}
                icon="shield-checkmark-outline"
                title="Two-factor authentication"
                subtitle="Add an extra layer of security"
                right={<SoonBadge theme={theme} />}
              />
              <Hairline theme={theme} />
              <DisabledAccountRow
                theme={theme}
                icon="key-outline"
                title="Login methods"
                subtitle="Google, Apple, email"
                right={<SoonBadge theme={theme} />}
              />
            </CardShell>

            <SectionTitle theme={theme} text="VERIFICATION & TRUST" />
            <Text style={[styles.sectionDesc, { color: theme.mutedForeground }]}>
              Verified accounts get better visibility and are trusted more at events.
            </Text>
            <CardShell theme={theme}>
              <AccountRow
                theme={theme}
                icon="camera-outline"
                iconColor={CYAN}
                title="Photo verification"
                subtitle={
                  photoVerificationState === 'approved'
                    ? "Verified · Helps others trust your profile"
                    : photoVerificationState === 'pending'
                      ? 'Under review'
                      : photoVerificationState === 'rejected'
                        ? 'Declined — try again'
                        : photoVerificationState === 'expired'
                          ? 'Expired — re-verify'
                          : "Take a selfie to verify it's really you"
                }
                right={
                  photoVerificationState === 'approved' ? (
                    <ValueChip label="Verified ✓" accentColor={CYAN} />
                  ) : photoVerificationState === 'pending' ? (
                    <ValueChip label="Under review" accentColor={AMBER} />
                  ) : (
                    <View style={styles.rowRight}>
                      <ValueChip label="Verify" accentColor={AMBER} />
                      <Ionicons name="chevron-forward" size={18} color={theme.mutedForeground} />
                    </View>
                  )
                }
                onPress={photoVerificationState === 'approved' ? undefined : openPhotoVerification}
              />
              <Hairline theme={theme} />
              <AccountRow
                theme={theme}
                icon="mail-outline"
                iconColor={CYAN}
                title="Email verified"
                right={
                  profile?.email_verified ? (
                    <ValueChip label="Verified" accentColor={theme.success} />
                  ) : (
                    <ValueChip label="Verify →" accentColor={AMBER} />
                  )
                }
                onPress={profile?.email_verified ? undefined : () => openEmailVerification()}
              />
              <Hairline theme={theme} />
              <AccountRow
                theme={theme}
                icon="call-outline"
                iconColor={CYAN}
                title="Phone verified"
                right={
                  profile?.phone_verified ? (
                    <ValueChip label="Verified" accentColor={theme.success} />
                  ) : (
                    <ValueChip label="Verify →" accentColor={AMBER} />
                  )
                }
                onPress={profile?.phone_verified ? undefined : () => setShowPhoneVerify(true)}
              />
              <Hairline theme={theme} />
              <AccountRow
                theme={theme}
                icon="information-circle-outline"
                iconColor={theme.mutedForeground}
                title="About verification"
                subtitle="How Vibely uses your verification data"
                onPress={() => WebBrowser.openBrowserAsync('https://vibelymeet.com/privacy').catch(() => {})}
              />
            </CardShell>

            <SectionTitle theme={theme} text="MEMBERSHIP & PURCHASES" />
            <CardShell theme={theme}>
              <AccountRow
                theme={theme}
                icon="star-outline"
                iconColor={AMBER}
                title={rcTier === 'vip' ? 'Vibely VIP' : 'Vibely Premium'}
                subtitle={
                  rcTier !== 'none' && rcExpiry
                    ? `Active · Renews ${new Date(rcExpiry).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                    : rcTier !== 'none'
                      ? 'Active'
                      : 'Unlock unlimited vibes and premium features'
                }
                right={
                  <View style={styles.rowRight}>
                    {rcTier !== 'none' ? (
                      <ValueChip label={rcTier === 'vip' ? 'VIP' : 'Active'} accentColor={AMBER} />
                    ) : (
                      <>
                        <ValueChip label="Upgrade" accentColor={theme.tint} />
                        <Ionicons name="chevron-forward" size={18} color={theme.mutedForeground} />
                      </>
                    )}
                  </View>
                }
                onPress={() => router.push('/premium')}
              />
              <Hairline theme={theme} />
              <AccountRow
                theme={theme}
                icon="flash-outline"
                iconColor={VIOLET}
                title="Credits"
                subtitle="Used for video dates and premium features"
                right={
                  <View style={styles.rowRight}>
                    <Text style={{ color: theme.textSecondary, fontSize: 13, fontWeight: '600' }}>{creditTotal} credits</Text>
                    <Ionicons name="chevron-forward" size={18} color={theme.mutedForeground} />
                  </View>
                }
                onPress={() => router.push('/settings/credits')}
              />
              <Hairline theme={theme} />
              <AccountRow
                theme={theme}
                icon="card-outline"
                iconColor={theme.mutedForeground}
                title="Manage subscription"
                subtitle="Cancel, upgrade, or change your plan"
                onPress={() => Linking.openURL(subscriptionManageUrl()).catch(() => {})}
              />
              <Hairline theme={theme} />
              <View style={{ opacity: restoring ? 0.55 : 1 }}>
                <AccountRow
                  theme={theme}
                  icon="refresh-outline"
                  iconColor={theme.mutedForeground}
                  title="Restore purchases"
                  subtitle="If you've reinstalled the app"
                  right={
                    restoring ? (
                      <ActivityIndicator size="small" color={theme.tint} />
                    ) : (
                      <Ionicons name="chevron-forward" size={18} color={theme.mutedForeground} />
                    )
                  }
                  onPress={restoring ? undefined : () => void handleRestorePurchases()}
                />
              </View>
            </CardShell>

            <SectionTitle theme={theme} text="TAKE A BREAK" />
            {onBreak ? (
              <View style={[styles.breakCardActive, { borderColor: withAlpha(AMBER, 0.35), backgroundColor: withAlpha(AMBER, 0.08) }]}>
                <Ionicons name="pause-circle" size={24} color={AMBER} />
                <Text style={[styles.breakTitle, { color: theme.text }]}>You're on a break</Text>
                <Text style={[styles.breakBody, { color: theme.mutedForeground }]}>
                  {breakUntilIso ? `Hidden until ${formatBreakEnd(new Date(breakUntilIso))}` : 'Hidden indefinitely'}
                  {'\n'}Your matches and chats are still active.
                </Text>
                <Pressable
                  onPress={() => void endBreak()}
                  disabled={breakBusy}
                  style={[styles.outlineAmberBtn, { borderColor: AMBER }]}
                >
                  <Text style={{ color: AMBER, fontWeight: '700' }}>{breakBusy ? '…' : 'End break now'}</Text>
                </Pressable>
              </View>
            ) : (
              <View style={[styles.breakCard, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
                <Ionicons name="moon-outline" size={24} color={AMBER} />
                <Text style={[styles.breakTitle, { color: theme.text }]}>Need some time off?</Text>
                <Text style={[styles.breakBody, { color: theme.mutedForeground }]}>
                  Going on a break hides you from discovery while keeping your matches, chats, and account intact.
                </Text>
                <RNHScroll horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
                  {(
                    [
                      ['24h', '24 hours'],
                      ['3d', '3 days'],
                      ['1w', '1 week'],
                      ['2w', '2 weeks'],
                      ['indefinite', 'Indefinitely'],
                    ] as const
                  ).map(([key, label]) => (
                    <Pressable
                      key={key}
                      onPress={() => setBreakChip(key)}
                      style={[
                        styles.durationChip,
                        {
                          borderColor: breakChip === key ? theme.tint : theme.border,
                          backgroundColor: breakChip === key ? withAlpha(theme.tint, 0.15) : theme.surface,
                        },
                      ]}
                    >
                      <Text style={{ color: theme.text, fontSize: 13, fontWeight: '600' }}>{label}</Text>
                    </Pressable>
                  ))}
                </RNHScroll>
                <VibelyButton
                  label="Take a break"
                  onPress={confirmTakeBreak}
                  variant="primary"
                  disabled={!breakChip || breakBusy}
                  style={{ marginTop: spacing.md }}
                />
              </View>
            )}

            <SectionTitle theme={theme} text="DATA & ACCOUNT CONTROL" />
            <CardShell theme={theme}>
              <DisabledAccountRow
                theme={theme}
                icon="download-outline"
                title="Download my data"
                subtitle="Request a copy of your Vibely data"
                right={<SoonBadge theme={theme} />}
              />
              <Hairline theme={theme} />
              <AccountRow
                theme={theme}
                icon="chatbubble-ellipses-outline"
                iconColor={theme.tint}
                title="Contact support"
                subtitle="Get help or report an issue"
                onPress={() => router.push('/settings/support')}
              />
              <Hairline theme={theme} />
              <AccountRow
                theme={theme}
                icon="log-out-outline"
                iconColor="#EF4444"
                title="Log out"
                destructive
                onPress={() => presentNativeLogoutConfirm(show, logout)}
              />
            </CardShell>

            <Text style={[styles.dangerSectionTitle, { color: theme.danger }]}>DANGER ZONE</Text>
            <View style={[styles.dangerCard, { borderColor: withAlpha('#EF4444', 0.3), backgroundColor: withAlpha('#EF4444', 0.04) }]}>
              <AccountRow
                theme={theme}
                icon="pause-outline"
                iconColor="#EF4444"
                title="Deactivate account"
                subtitle="Temporarily disable your account. You can reactivate anytime."
                onPress={() => setDeactivateOpen(true)}
              />
              <Hairline theme={theme} />
              <AccountRow
                theme={theme}
                icon="trash-outline"
                iconColor="#EF4444"
                title="Delete account"
                subtitle="Permanently delete your account and all data. This cannot be undone."
                onPress={openDeleteFlow}
              />
            </View>
          </>
        )}
      </ScrollView>

      {copiedToast ? (
        <View style={[styles.toast, { backgroundColor: theme.surface }]}>
          <Text style={{ color: theme.text, fontWeight: '600' }}>Copied</Text>
        </View>
      ) : null}

      <PhoneVerificationFlow
        visible={showPhoneVerify}
        onClose={() => setShowPhoneVerify(false)}
        onVerified={refreshProfile}
        initialPhoneE164={profile?.phone_number}
      />
      <EmailVerificationFlow
        visible={showEmailVerify}
        email={emailForVerification}
        onClose={() => setShowEmailVerify(false)}
        onVerified={refreshProfile}
      />
      <PhotoVerificationFlow
        visible={showPhotoVerify}
        onClose={() => setShowPhotoVerify(false)}
        profilePhotoUrl={profile?.avatar_url}
        onSubmissionComplete={() => {
          setPhotoVerificationState('pending');
          void refreshPhotoVerificationState();
          refreshProfile();
        }}
      />

      <KeyboardAwareBottomSheetModal
        visible={emailSheetOpen}
        onRequestClose={() => setEmailSheetOpen(false)}
        showHandle
        backdropColor="rgba(0,0,0,0.55)"
        footer={
          <Pressable
            onPress={async () => {
              const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
              if (!re.test(newEmail) || newEmail !== confirmEmail) {
                show({
                  title: 'Check your emails',
                  message: 'Enter a valid address and make sure both fields match.',
                  variant: 'warning',
                  primaryAction: { label: 'OK', onPress: () => {} },
                });
                return;
              }
              setEmailSubmitting(true);
              try {
                const { error } = await supabase.auth.updateUser({ email: newEmail });
                if (error) {
                  show({
                    title: 'Couldn’t update',
                    message: error.message,
                    variant: 'warning',
                    primaryAction: { label: 'OK', onPress: () => {} },
                  });
                  return;
                }
                const updatedEmail = newEmail.trim();
                show({
                  title: 'Confirm your new account email',
                  message: `Check ${updatedEmail} in your inbox to confirm your account email. Then verify this email for your profile in-app below.`,
                  variant: 'success',
                  primaryAction: { label: 'Verify in app', onPress: () => openEmailVerification(updatedEmail) },
                });
                setNewEmail('');
                setConfirmEmail('');
                setEmailSheetOpen(false);
              } finally {
                setEmailSubmitting(false);
              }
            }}
            style={[styles.primaryBtn, { backgroundColor: theme.tint, opacity: emailSubmitting ? 0.7 : 1, marginTop: spacing.md }]}
          >
            <Text style={styles.primaryBtnText}>{emailSubmitting ? '…' : 'Update'}</Text>
          </Pressable>
        }
      >
        <Text style={[styles.sheetTitle, { color: theme.text }]}>Update email</Text>
        <Text style={[styles.sheetMuted, { color: theme.mutedForeground }]}>Current: {email || '—'}</Text>
        <TextInput
          placeholder="New email address"
          placeholderTextColor={theme.mutedForeground}
          keyboardType="email-address"
          autoCapitalize="none"
          value={newEmail}
          onChangeText={setNewEmail}
          style={[styles.input, { color: theme.text, borderColor: theme.border }]}
        />
        <TextInput
          placeholder="Confirm new email"
          placeholderTextColor={theme.mutedForeground}
          keyboardType="email-address"
          autoCapitalize="none"
          value={confirmEmail}
          onChangeText={setConfirmEmail}
          style={[styles.input, { color: theme.text, borderColor: theme.border }]}
        />
        <View style={[styles.infoCard, { backgroundColor: withAlpha(theme.tint, 0.08), borderColor: withAlpha(theme.tint, 0.2) }]}>
          <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
            Confirm your new account email in your inbox. This updates your sign-in email; verifying your profile email is separate.
          </Text>
        </View>
      </KeyboardAwareBottomSheetModal>

      <KeyboardAwareBottomSheetModal
        visible={passwordSheetOpen}
        onRequestClose={() => setPasswordSheetOpen(false)}
        showHandle
        backdropColor="rgba(0,0,0,0.55)"
        footer={
          hasEmailPasswordIdentity ? (
            <Pressable
              onPress={async () => {
                if (newPassword.length < 8 || newPassword !== confirmNewPassword) {
                  show({
                    title: 'Check your password',
                    message: 'Use at least 8 characters and make sure both new fields match.',
                    variant: 'warning',
                    primaryAction: { label: 'OK', onPress: () => {} },
                  });
                  return;
                }
                setPasswordSubmitting(true);
                try {
                  const { error: authErr } = await supabase.auth.signInWithPassword({
                    email,
                    password: currentPassword,
                  });
                  if (authErr) {
                    show({
                      title: 'Incorrect password',
                      message: 'Your current password doesn’t match.',
                      variant: 'warning',
                      primaryAction: { label: 'OK', onPress: () => {} },
                    });
                    return;
                  }
                  const { error } = await supabase.auth.updateUser({ password: newPassword });
                  if (error) {
                    show({
                      title: 'Couldn’t update',
                      message: error.message,
                      variant: 'warning',
                      primaryAction: { label: 'OK', onPress: () => {} },
                    });
                    return;
                  }
                  setCurrentPassword('');
                  setNewPassword('');
                  setConfirmNewPassword('');
                  setPasswordSheetOpen(false);
                  show({
                    title: 'Password updated',
                    message: 'You’re all set.',
                    variant: 'success',
                    primaryAction: { label: 'OK', onPress: () => {} },
                  });
                } finally {
                  setPasswordSubmitting(false);
                }
              }}
              style={[styles.primaryBtn, { backgroundColor: theme.tint, opacity: passwordSubmitting ? 0.7 : 1, marginTop: spacing.md }]}
            >
              <Text style={styles.primaryBtnText}>{passwordSubmitting ? '…' : 'Update password'}</Text>
            </Pressable>
          ) : null
        }
      >
        <Text style={[styles.sheetTitle, { color: theme.text }]}>Change password</Text>
        {!hasEmailPasswordIdentity ? (
          <Text style={[styles.sheetMuted, { color: theme.mutedForeground }]}>
            Your account uses {oauthProvider ? `${oauthProvider} ` : ''}sign-in. Password not applicable.
          </Text>
        ) : (
          <>
            <TextInput
              placeholder="Current password"
              placeholderTextColor={theme.mutedForeground}
              secureTextEntry
              value={currentPassword}
              onChangeText={setCurrentPassword}
              style={[styles.input, { color: theme.text, borderColor: theme.border }]}
            />
            <TextInput
              placeholder="New password (min 8 characters)"
              placeholderTextColor={theme.mutedForeground}
              secureTextEntry
              value={newPassword}
              onChangeText={setNewPassword}
              style={[styles.input, { color: theme.text, borderColor: theme.border }]}
            />
            {newPassword.length > 0 ? (
              <Text style={{ color: strengthColor, fontSize: 12, marginBottom: 8 }}>{strength.label}</Text>
            ) : null}
            <TextInput
              placeholder="Confirm new password"
              placeholderTextColor={theme.mutedForeground}
              secureTextEntry
              value={confirmNewPassword}
              onChangeText={setConfirmNewPassword}
              style={[styles.input, { color: theme.text, borderColor: theme.border }]}
            />
          </>
        )}
      </KeyboardAwareBottomSheetModal>

      <Modal transparent visible={deactivateOpen} animationType="fade">
        <Pressable style={styles.sheetBackdrop} onPress={() => setDeactivateOpen(false)}>
          <Pressable style={[styles.deactivateBox, { backgroundColor: theme.surface, borderColor: theme.border }]} onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.sheetTitle, { color: theme.text }]}>Deactivate account?</Text>
            <Text style={[styles.sheetMuted, { color: theme.mutedForeground }]}>
              Your profile will be hidden and your account suspended until you log back in. Your data and matches are preserved.
            </Text>
            <Pressable
              onPress={() => void confirmDeactivate()}
              style={[styles.outlineDangerBtn, { borderColor: theme.danger }]}
            >
              <Text style={{ color: theme.danger, fontWeight: '700' }}>Deactivate</Text>
            </Pressable>
            <Pressable onPress={() => setDeactivateOpen(false)} style={{ paddingVertical: 12 }}>
              <Text style={{ color: theme.tint, fontWeight: '600', textAlign: 'center' }}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
    {dialog}
    {purchaseDialog}
    </>
  );
}

function TrustMini({
  theme,
  label,
  verified,
  onVerify,
}: {
  theme: (typeof Colors)['dark'];
  label: string;
  verified: boolean;
  onVerify: () => void;
}) {
  const dot = verified ? theme.success : AMBER;
  const textColor = verified ? theme.success : theme.textSecondary;
  return (
    <View style={styles.trustMini}>
      <View style={[styles.trustDot, { backgroundColor: dot }]} />
      <Text style={[styles.trustLabel, { color: textColor }]} numberOfLines={1}>
        {label}
      </Text>
      {!verified ? (
        <Pressable onPress={onVerify} hitSlop={6}>
          <Text style={{ color: theme.tint, fontSize: 11, fontWeight: '600' }}>Verify →</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function SectionTitle({ theme, text }: { theme: (typeof Colors)['dark']; text: string }) {
  return <Text style={[styles.sectionTitle, { color: theme.mutedForeground }]}>{text}</Text>;
}

function CardShell({ theme, children }: { theme: (typeof Colors)['dark']; children: React.ReactNode }) {
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>{children}</View>
  );
}

function Hairline({ theme }: { theme: (typeof Colors)['dark'] }) {
  return <View style={[styles.hairline, { backgroundColor: theme.border }]} />;
}

function AccountRow({
  theme,
  icon,
  iconColor,
  title,
  subtitle,
  onPress,
  right,
  destructive,
}: {
  theme: (typeof Colors)['dark'];
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  right?: React.ReactNode;
  destructive?: boolean;
}) {
  const inner = (
    <View style={styles.accRow}>
      <Ionicons name={icon} size={20} color={iconColor} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.accTitle, { color: destructive ? '#EF4444' : theme.text }]}>{title}</Text>
        {subtitle ? <Text style={[styles.accSub, { color: theme.mutedForeground }]}>{subtitle}</Text> : null}
      </View>
      {right ?? <Ionicons name="chevron-forward" size={18} color={theme.mutedForeground} />}
    </View>
  );
  if (onPress) {
    return <Pressable onPress={onPress}>{inner}</Pressable>;
  }
  return inner;
}

function DisabledAccountRow({
  theme,
  icon,
  title,
  subtitle,
  right,
}: {
  theme: (typeof Colors)['dark'];
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  right: React.ReactNode;
}) {
  return (
    <View style={{ opacity: 0.72 }}>
      <View style={styles.accRow}>
        <Ionicons name={icon} size={20} color={theme.mutedForeground} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.accTitle, { color: theme.text }]}>{title}</Text>
          <Text style={[styles.accSub, { color: theme.mutedForeground }]}>{subtitle}</Text>
        </View>
        {right}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  backBtn: { padding: spacing.xs, marginTop: 2 },
  headerTitles: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  headerSub: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  scroll: { paddingHorizontal: 16, gap: 20, paddingTop: layout.mainContentPaddingTop },
  summaryCard: { borderRadius: 16, borderWidth: 1, padding: 16 },
  summaryRow: { flexDirection: 'row', gap: 14 },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#333' },
  summaryTextCol: { flex: 1, minWidth: 0 },
  displayName: { fontSize: 18, fontWeight: '700' },
  emailLine: { fontSize: 13, marginTop: 2 },
  memberSince: { fontSize: 12, marginTop: 4 },
  supportId: { fontSize: 11, marginTop: 6, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  trustRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, gap: 8 },
  trustMini: { flex: 1, alignItems: 'center', gap: 4 },
  trustDot: { width: 8, height: 8, borderRadius: 4 },
  trustLabel: { fontSize: 11, fontWeight: '600' },
  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, paddingLeft: 4 },
  sectionDesc: { fontSize: 12, marginBottom: 12, marginTop: -12, paddingLeft: 4 },
  card: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  hairline: { height: StyleSheet.hairlineWidth, marginLeft: 52 },
  accRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  accTitle: { fontSize: 15, fontWeight: '600' },
  accSub: { fontSize: 12, marginTop: 2 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  valueChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  valueChipText: { fontSize: 12, fontWeight: '600' },
  soonText: { fontSize: 11, fontWeight: '600' },
  breakCard: { borderRadius: 16, borderWidth: 1, padding: 16 },
  breakCardActive: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 8 },
  breakTitle: { fontSize: 17, fontWeight: '700', marginTop: 8 },
  breakBody: { fontSize: 13, lineHeight: 19, marginTop: 4 },
  chipScroll: { gap: 8, paddingVertical: 12 },
  durationChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, marginRight: 8 },
  outlineAmberBtn: {
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  dangerSectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, paddingLeft: 4 },
  dangerCard: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  toast: {
    position: 'absolute',
    bottom: 48,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius['2xl'],
    borderTopRightRadius: radius['2xl'],
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['2xl'],
    paddingTop: spacing.md,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: spacing.md },
  sheetTitle: { fontSize: 20, fontWeight: '700' },
  sheetMuted: { fontSize: 13, marginTop: 8, marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    fontSize: 16,
  },
  infoCard: { padding: 10, borderRadius: 8, borderWidth: 1, marginBottom: 12 },
  primaryBtn: { paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  deactivateBox: { marginHorizontal: 24, borderRadius: 16, borderWidth: 1, padding: 20 },
  outlineDangerBtn: { marginTop: 16, paddingVertical: 12, borderRadius: 12, borderWidth: 1, alignItems: 'center' },
});
