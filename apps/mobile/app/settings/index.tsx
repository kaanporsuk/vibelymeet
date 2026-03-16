/**
 * Settings — web parity: stateful Premium card, dynamic Credits, native delete, Help & Feedback, legal links.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert, Linking } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import Colors from '@/constants/Colors';
import {
  GlassHeaderBar,
  Card,
  SettingsRow,
  DestructiveRow,
  VibelyText,
  VibelyButton,
} from '@/components/ui';
import { spacing, typography, layout, radius } from '@/constants/theme';
import { withAlpha } from '@/lib/colorUtils';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import { useBackendSubscription } from '@/lib/subscriptionApi';
import { supabase } from '@/lib/supabase';
import { FeedbackSheet } from '@/components/settings/FeedbackSheet';

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
  const { user, signOut } = useAuth();
  const { isPremium, currentPeriodEnd, isLoading: subLoading } = useBackendSubscription(user?.id);
  const { data: credits } = useCredits(user?.id);
  const [showFeedbackSheet, setShowFeedbackSheet] = useState(false);

  const handleLogout = () => {
    Alert.alert(
      'Log out?',
      "You'll need to sign in again to access your account.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Log Out', style: 'destructive', onPress: () => signOut() },
      ]
    );
  };

  const handleManageSubscription = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('create-portal-session');
      if (error || !data?.success) {
        Alert.alert('Couldn\'t open billing', 'The billing portal couldn\'t be opened. Try again.');
        return;
      }
      if (data?.url) await Linking.openURL(data.url);
    } catch {
      Alert.alert('Couldn\'t open billing', 'Something went wrong. Try again.');
    }
  };

  const handleDeleteAccount = () => {
    router.push('/settings/account');
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
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
          {/* Group 1: Premium — web parity stateful card (Premium status vs Upgrade CTA) */}
          <Card variant="glass" style={styles.navCard}>
            {!subLoading && isPremium ? (
              <View style={styles.premiumCardInner}>
                <View style={styles.premiumCardRow}>
                  <View style={[styles.premiumIconBox, { backgroundColor: withAlpha(theme.tint, 0.2) }]}>
                    <Ionicons name="sparkles" size={20} color={theme.tint} />
                  </View>
                  <View style={styles.premiumCardText}>
                    <Text style={[styles.premiumBadge, { color: theme.tint }]}>✦ Vibely Premium</Text>
                    {currentPeriodEnd ? (
                      <Text style={[styles.premiumRenew, { color: theme.textSecondary }]}>
                        Renews {formatDate(currentPeriodEnd)}
                      </Text>
                    ) : null}
                  </View>
                </View>
                <VibelyButton label="Manage Subscription" onPress={handleManageSubscription} variant="secondary" size="sm" />
              </View>
            ) : (
              <SettingsRow
                icon={<Ionicons name="sparkles" size={20} color={theme.tint} />}
                title="Upgrade to Premium"
                subtitle="Unlock all features"
                onPress={() => router.push('/premium')}
              />
            )}
          </Card>

          {/* Group 2: Credits — dynamic subtitle */}
          <Card variant="glass" style={styles.navCard}>
            <SettingsRow
              icon={<Ionicons name="flash" size={20} color={theme.tint} />}
              title="Video Date Credits"
              subtitle={
                isPremium && currentPeriodEnd
                  ? `Premium · Expires ${formatDate(currentPeriodEnd)}`
                  : credits
                    ? `${credits.extra_time_credits ?? 0} Extra Time · ${credits.extended_vibe_credits ?? 0} Extended Vibe`
                    : 'Extra Time · Extended Vibe'
              }
              onPress={() => router.push('/settings/credits')}
            />
          </Card>

          {/* Group 3: Notifications */}
          <Card variant="glass" style={styles.navCard}>
            <SettingsRow
              icon={<Ionicons name="notifications-outline" size={20} color={theme.tint} />}
              title="Notifications"
              subtitle="Manage alerts and sounds"
              onPress={() => router.push('/settings/notifications')}
            />
          </Card>

          {/* Group 4: Privacy & legal */}
          <Card variant="glass" style={styles.navCard}>
            <SettingsRow
              icon={<Ionicons name="shield-outline" size={20} color={theme.neonCyan} />}
              title="Privacy"
              subtitle="Visibility, blocked users, data"
              onPress={() => router.push('/(app)/settings/privacy' as import('expo-router').Href)}
            />
            <SettingsRow
              icon={<Ionicons name="shield-checkmark-outline" size={18} color={theme.textSecondary} />}
              title="Privacy Policy"
              onPress={() => Linking.openURL('https://vibelymeet.com/privacy').catch(() => {})}
            />
            <SettingsRow
              icon={<Ionicons name="document-text-outline" size={18} color={theme.textSecondary} />}
              title="Terms of Service"
              onPress={() => Linking.openURL('https://vibelymeet.com/terms').catch(() => {})}
            />
          </Card>

          {/* Safety Hub */}
          <Card variant="glass" style={styles.navCard}>
            <SettingsRow
              icon={<Ionicons name="shield-checkmark" size={20} color={theme.neonCyan} />}
              title="Safety Center"
              subtitle="Report, tips, emergency resources"
              onPress={() => Linking.openURL('https://vibelymeet.com/settings').catch(() => {})}
            />
          </Card>

          {/* Group 5: Account */}
          <Card variant="glass" style={styles.navCard}>
            <SettingsRow
              icon={<Ionicons name="person-outline" size={20} color={theme.accent} />}
              title="Account"
              subtitle="Manage your account"
              onPress={() => router.push('/settings/account')}
            />
          </Card>

          {/* Section break: Quick links — web parity pt-4 then outline-style group */}
          <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>Quick links</Text>
          <Card variant="glass" style={styles.quickCard}>
            <View style={styles.quickSection}>
              <SettingsRow
                icon={<Ionicons name="sparkles-outline" size={18} color={theme.tint} />}
                title="How Vibely Works"
                onPress={() => Linking.openURL('https://vibelymeet.com/how-it-works').catch(() => {})}
              />
              <SettingsRow
                icon={<Ionicons name="chatbubble-outline" size={18} color={theme.tint} />}
                title="Help & Feedback"
                onPress={() => setShowFeedbackSheet(true)}
              />
              <SettingsRow
                icon={<Ionicons name="people-outline" size={18} color={theme.textSecondary} />}
                title="Community Guidelines"
                onPress={() => Linking.openURL('https://vibelymeet.com/community-guidelines').catch(() => {})}
              />
            </View>
          </Card>

          {/* Log out — standalone action, same visual group as quick links */}
          <View style={styles.logoutWrap}>
            <DestructiveRow
              icon={<Ionicons name="log-out-outline" size={20} color={theme.danger} />}
              label="Log Out"
              onPress={handleLogout}
            />
          </View>

          {/* Danger Zone — contained, with helper */}
          <View style={[styles.dangerZone, { borderTopColor: withAlpha(theme.danger, 0.2) }]}>
            <Text style={[styles.dangerZoneTitle, { color: theme.danger }]}>Danger Zone</Text>
            <Text style={[styles.dangerZoneHelper, { color: theme.textSecondary }]}>
              Account deletion is permanent after the grace period.
            </Text>
            <DestructiveRow
              icon={<Ionicons name="trash-outline" size={20} color={theme.danger} />}
              label="Delete My Account"
              onPress={handleDeleteAccount}
            />
          </View>
        </View>
      </ScrollView>

      <FeedbackSheet visible={showFeedbackSheet} onClose={() => setShowFeedbackSheet(false)} />
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
  quickCard: { marginBottom: 0 },
  quickSection: { gap: spacing.sm },
  sectionLabel: {
    ...typography.overline,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
    textTransform: 'none',
  },
  logoutWrap: { marginTop: spacing.lg },
  dangerZone: {
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
  },
  dangerZoneTitle: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  dangerZoneHelper: {
    fontSize: 12,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
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
