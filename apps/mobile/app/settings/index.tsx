/**
 * Settings — web parity: stateful Premium card, dynamic Credits, native delete, Support & Feedback, legal links.
 */
import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Linking } from 'react-native';
import { router, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { useQuery } from '@tanstack/react-query';
import Colors from '@/constants/Colors';
import {
  GlassHeaderBar,
  Card,
  SettingsRow,
  VibelyText,
  VibelyButton,
} from '@/components/ui';
import { spacing, layout, radius } from '@/constants/theme';
import { withAlpha } from '@/lib/colorUtils';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import { useBackendSubscription } from '@/lib/subscriptionApi';
import { useEntitlements } from '@/hooks/useEntitlements';
import { supabase } from '@/lib/supabase';
import {
  getSettingsAccessDateLine,
  getSettingsPlanLabel,
  showSettingsMemberElevated,
} from '@shared/settingsMembershipDisplay';
import Constants from 'expo-constants';
import { useVibelyDialog } from '@/components/VibelyDialog';
import { useAccountPauseStatus } from '@/hooks/useAccountPauseStatus';
import { openPremium } from '@/lib/premiumNavigation';
import { PREMIUM_ENTRY_SURFACE } from '@shared/premiumFunnel';

function useCredits(userId: string | null | undefined) {
  return useQuery({
    queryKey: ['user_credits', userId],
    queryFn: async () => {
      if (!userId) return null;
      const { data, error } = await supabase.from('user_credits').select('extra_time_credits, extended_vibe_credits').eq('user_id', userId).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!userId,
  });
}

/** Display-only: timed admin grant line when no billable subscription row (parity with web usePremium). */
function useProfilePremiumUntil(userId: string | null | undefined) {
  return useQuery({
    queryKey: ['profile-premium-until', userId],
    queryFn: async () => {
      if (!userId) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('premium_until')
        .eq('id', userId)
        .maybeSingle();
      if (error) throw error;
      const raw = data?.premium_until;
      return raw ? new Date(raw as string) : null;
    },
    enabled: !!userId,
  });
}

function formatDate(s: string | null): string {
  if (!s) return '';
  try {
    const d = new Date(s);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { user } = useAuth();
  const { hasBillableSubscription, currentPeriodEnd, isLoading: subLoading } = useBackendSubscription(user?.id);
  const { tierId, tierLabel, isLoading: entLoading } = useEntitlements();
  const { data: premiumUntil, isLoading: premUntilLoading } = useProfilePremiumUntil(user?.id);

  const membershipDisplay = {
    tierId,
    tierLabel,
    hasBillableSubscription,
    subscriptionPeriodEndIso: currentPeriodEnd,
    premiumUntil: premiumUntil ?? null,
  };
  const planLabel = getSettingsPlanLabel(membershipDisplay);
  const accessDateLine = getSettingsAccessDateLine(membershipDisplay);
  const showElevatedCard = showSettingsMemberElevated(membershipDisplay);
  const { data: credits, isLoading: creditsLoading } = useCredits(user?.id);
  const { show: showDialog, dialog: dialogEl } = useVibelyDialog();
  const { isPaused, remainingLabel } = useAccountPauseStatus();

  const handleManageSubscription = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('create-portal-session');
      if (error || !data?.success) {
        showDialog({
          title: 'Billing portal unavailable',
          message: "We couldn't open the billing page. Try again in a moment.",
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
        return;
      }
      if (data?.url) await Linking.openURL(data.url);
    } catch {
      showDialog({
        title: 'Something went wrong',
        message: "We couldn't reach billing. Check your connection and try again.",
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    }
  };

  const appVersion = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {dialogEl}
      <GlassHeaderBar insets={insets}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </Pressable>
          <VibelyText variant="titleMD" style={[styles.headerTitle, { color: theme.text }]}>Settings</VibelyText>
        </View>
      </GlassHeaderBar>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: layout.scrollContentPaddingBottomTab }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.main}>
          <Text style={[styles.sectionHeader, styles.sectionHeaderFirst, { color: theme.mutedForeground }]}>Account</Text>
          <Card variant="glass" style={styles.navCard}>
            {subLoading || entLoading || premUntilLoading ? null : showElevatedCard ? (
              <View style={styles.premiumCardInner}>
                <View style={styles.premiumCardRow}>
                  <View style={[styles.premiumIconBox, { backgroundColor: withAlpha(theme.tint, 0.2) }]}>
                    <Ionicons name="sparkles" size={20} color={theme.tint} />
                  </View>
                  <View style={styles.premiumCardText}>
                    <Text style={[styles.premiumBadge, { color: theme.tint }]}>✦ Vibely {planLabel}</Text>
                    {accessDateLine ? (
                      <Text style={[styles.premiumRenew, { color: theme.textSecondary }]}>
                        {accessDateLine.kind === 'renews'
                          ? `Renews ${formatDate(accessDateLine.iso)}`
                          : `Access through ${formatDate(accessDateLine.iso)}`}
                      </Text>
                    ) : null}
                  </View>
                </View>
                {hasBillableSubscription ? (
                  <VibelyButton label="Manage Subscription" onPress={handleManageSubscription} variant="secondary" size="sm" />
                ) : null}
              </View>
            ) : (
              <SettingsRow
                icon={<Ionicons name="sparkles" size={20} color={theme.tint} />}
                title="Upgrade to Premium"
                subtitle="Unlock all features"
                onPress={() =>
                  openPremium(router.push, { entry_surface: PREMIUM_ENTRY_SURFACE.SETTINGS_UPGRADE_CARD })
                }
              />
            )}
          </Card>

          <Card variant="glass" style={styles.navCard}>
            <SettingsRow
              icon={<Ionicons name="flash" size={20} color={theme.tint} />}
              title="Video Date Credits"
              subtitle={
                creditsLoading
                  ? 'Loading…'
                  : `${credits?.extra_time_credits ?? 0} Extra Time · ${credits?.extended_vibe_credits ?? 0} Extended Vibe`
              }
              onPress={() => router.push('/settings/credits')}
            />
          </Card>

          <Card variant="glass" style={styles.navCard}>
            <SettingsRow
              icon={<Ionicons name="person-outline" size={20} color={theme.accent} />}
              title="Account"
              subtitle={
                isPaused
                  ? remainingLabel
                    ? `On a break · ${remainingLabel}`
                    : 'On a break'
                  : 'Security, membership, and account control'
              }
              onPress={() => router.push('/settings/account')}
              right={
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {isPaused ? (
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#F59E0B' }} />
                  ) : null}
                  <Text style={{ color: theme.textSecondary }}>›</Text>
                </View>
              }
            />
          </Card>

          <Text style={[styles.sectionHeader, { color: theme.mutedForeground }]}>Preferences</Text>
          <Card variant="glass" style={styles.navCard}>
            <View style={styles.quickSection}>
              <SettingsRow
                icon={<Ionicons name="notifications-outline" size={20} color={theme.tint} />}
                title="Notifications"
                subtitle="Manage alerts and sounds"
                onPress={() => router.push('/settings/notifications')}
              />
              <SettingsRow
                icon={<Ionicons name="shield-outline" size={20} color={theme.neonCyan} />}
                title="Privacy & Visibility"
                subtitle="Who finds you, what they see, how you stay protected"
                onPress={() => router.push('/settings/privacy')}
              />
              <SettingsRow
                icon={<Ionicons name="compass-outline" size={20} color={theme.tint} />}
                title="Discovery"
                subtitle="Decks, intent, default event filters"
                onPress={() => router.push('/settings/discovery')}
              />
            </View>
          </Card>

          <Text style={[styles.sectionHeader, { color: theme.mutedForeground }]}>Support</Text>
          <Card variant="glass" style={styles.navCard}>
            <View style={styles.quickSection}>
              <SettingsRow
                icon={<Ionicons name="chatbubble-outline" size={18} color={theme.tint} />}
                title="Support & Feedback"
                subtitle="Get help, share ideas, or report concerns"
                onPress={() => router.push('/settings/support')}
              />
              <SettingsRow
                icon={<Ionicons name="people-outline" size={18} color={theme.textSecondary} />}
                title="Community Guidelines"
                subtitle="How we keep Vibely safe and respectful"
                onPress={() => WebBrowser.openBrowserAsync('https://vibelymeet.com/community-guidelines').catch(() => {})}
              />
              <SettingsRow
                icon={<Ionicons name="sparkles-outline" size={18} color={theme.tint} />}
                title="How Vibely Works"
                subtitle="Events, video dates, and matching explained"
                onPress={() => router.push('/how-it-works' as Href)}
              />
              <SettingsRow
                icon={<Ionicons name="shield-checkmark" size={20} color={theme.neonCyan} />}
                title="Safety Center"
                subtitle="Report, tips, emergency resources"
                onPress={() => router.push('/settings/safety-center')}
              />
              <SettingsRow
                icon={<Ionicons name="shield-checkmark-outline" size={18} color={theme.textSecondary} />}
                title="Privacy Policy"
                subtitle="How we collect, use, and protect your data"
                onPress={() => WebBrowser.openBrowserAsync('https://vibelymeet.com/privacy').catch(() => {})}
              />
              <SettingsRow
                icon={<Ionicons name="document-text-outline" size={18} color={theme.textSecondary} />}
                title="Terms of Service"
                subtitle="Rules and agreements for using Vibely"
                onPress={() => WebBrowser.openBrowserAsync('https://vibelymeet.com/terms').catch(() => {})}
              />
            </View>
          </Card>

          <Text
            style={{
              textAlign: 'center',
              color: theme.mutedForeground,
              fontSize: 12,
              marginTop: 24,
              marginBottom: 16,
            }}
          >
            Vibely v{appVersion}
          </Text>
        </View>
      </ScrollView>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingTop: layout.mainContentPaddingTop },
  main: {
    paddingHorizontal: layout.containerPadding,
    paddingBottom: spacing.xl,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  backBtn: { padding: spacing.xs },
  headerTitle: { flex: 1 },
  navCard: { marginBottom: spacing.lg },
  quickSection: { gap: spacing.sm },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 24,
    marginBottom: 8,
  },
  sectionHeaderFirst: { marginTop: 4 },
  premiumCardInner: {
    gap: spacing.md,
  },
  premiumCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  premiumIconBox: {
    width: 40,
    height: 40,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  premiumCardText: { flex: 1 },
  premiumBadge: {
    fontSize: 12,
    fontWeight: '600',
  },
  premiumRenew: {
    fontSize: 11,
    marginTop: 2,
  },
});
