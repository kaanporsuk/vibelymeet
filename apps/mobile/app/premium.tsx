/**
 * Premium / subscription screen. Reads canonical state from backend; purchases via RevenueCat when configured.
 * Stage 2: hero, feature callouts, entitlement states, resilient no-offerings/unavailable UX.
 */

import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, Text, ScrollView, Pressable, Platform } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { GlassHeaderBar, Card, LoadingState, VibelyButton } from '@/components/ui';
import { withAlpha } from '@/lib/colorUtils';
import { spacing, radius, layout } from '@/constants/theme';
import { useBackendSubscription } from '@/lib/subscriptionApi';
import {
  getOfferings,
  purchasePackage,
  restorePurchasesWithCustomerInfo,
  initRevenueCat,
  setRevenueCatUserId,
  isRevenueCatConfigured,
  getRevenueCatApiKey,
} from '@/lib/revenuecat';
import { syncRevenueCatSubscriberFromServer } from '@/lib/syncRevenueCatSubscriber';
import { PURCHASES_ERROR_CODE } from 'react-native-purchases';
import type { PurchasesOfferings, PurchasesPackage } from 'react-native-purchases';
import { format } from 'date-fns';
import { useVibelyDialog } from '@/components/VibelyDialog';
import { trackEvent } from '@/lib/analytics';
import {
  getPremiumDefaultHero,
  getPremiumEntryNudge,
  getPremiumTierMarketingBullets,
  PREMIUM_VIP_EXCLUSION_FOOTNOTE,
} from '@shared/premiumPageMarketing';

export default function PremiumScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    entry_surface?: string | string[];
    feature?: string | string[];
    source_context?: string | string[];
  }>();
  const { user } = useAuth();

  const funnelFromRoute = useMemo(() => {
    const one = (v: string | string[] | undefined) =>
      v === undefined ? undefined : Array.isArray(v) ? v[0] : v;
    return {
      entry_surface: one(params.entry_surface),
      feature: one(params.feature),
      source_context: one(params.source_context),
    };
  }, [params.entry_surface, params.feature, params.source_context]);
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { isPremium, plan, currentPeriodEnd, isLoading: subLoading, refetch } = useBackendSubscription(user?.id);

  const [offerings, setOfferings] = useState<PurchasesOfferings | null>(null);
  const [offeringsLoading, setOfferingsLoading] = useState(!!getRevenueCatApiKey());
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { show: showDialog, dialog: dialogEl } = useVibelyDialog();

  const entryNudge = useMemo(
    () => getPremiumEntryNudge(funnelFromRoute.entry_surface),
    [funnelFromRoute.entry_surface],
  );
  const defaultHero = useMemo(() => getPremiumDefaultHero(), []);
  const featureBullets = useMemo(() => getPremiumTierMarketingBullets(), []);

  const sortedPackages = useMemo(() => {
    const list = offerings?.current?.availablePackages ?? [];
    const rank = (t: string) => (t === 'ANNUAL' ? 0 : t === 'MONTHLY' ? 1 : 2);
    return [...list].sort((a, b) => rank(a.packageType) - rank(b.packageType));
  }, [offerings]);

  useEffect(() => {
    initRevenueCat();
  }, []);

  useEffect(() => {
    trackEvent('premium_page_viewed', {
      ...funnelFromRoute,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
    });
  }, [funnelFromRoute]);

  useEffect(() => {
    if (user?.id && isRevenueCatConfigured()) {
      setRevenueCatUserId(user.id);
    }
  }, [user?.id]);

  // Fetch offerings when RC is configured; refetch when user is set so offerings are after logIn
  useEffect(() => {
    if (!isRevenueCatConfigured()) {
      setOfferingsLoading(false);
      return;
    }
    setOfferingsLoading(true);
    let cancelled = false;
    getOfferings()
      .then((o) => {
        if (!cancelled) setOfferings(o);
      })
      .finally(() => {
        if (!cancelled) setOfferingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const handlePurchase = async (pkg: PurchasesPackage) => {
    const planLabel = pkg.packageType === 'ANNUAL' ? 'annual' : pkg.packageType === 'MONTHLY' ? 'monthly' : pkg.packageType;
    trackEvent('purchase_initiated', { plan: planLabel, product_id: pkg.product.identifier });
    setPurchaseLoading(true);
    setError(null);
    try {
      const result = await purchasePackage(pkg);
      if (result.success) {
        trackEvent('purchase_completed', { plan: planLabel, product_id: pkg.product.identifier });
        await refetch();
        router.push('/subscription-success' as import('expo-router').Href);
      } else if (result.error && !result.error.includes('cancelled') && !result.error.includes('Cancel')) {
        trackEvent('purchase_failed', { plan: planLabel, product_id: pkg.product.identifier, error: result.error });
        setError(result.error);
      }
    } finally {
      setPurchaseLoading(false);
    }
  };

  const handleRestore = async () => {
    setRestoreLoading(true);
    setError(null);
    try {
      const result = await restorePurchasesWithCustomerInfo();
      if (!result.ok) {
        if (result.errorCode === PURCHASES_ERROR_CODE.NETWORK_ERROR) {
          setError('Please check your internet connection and try again.');
        } else {
          setError(result.error instanceof Error ? result.error.message : 'Restore failed.');
        }
        return;
      }
      const hasActive = Object.keys(result.customerInfo.entitlements.active).length > 0;
      if (user?.id) {
        await syncRevenueCatSubscriberFromServer();
      }
      await refetch();
      if (hasActive) {
        showDialog({
          title: "You're Premium again",
          message: 'Your subscription was restored successfully.',
          variant: 'success',
          primaryAction: { label: 'Great', onPress: () => {} },
        });
      } else {
        showDialog({
          title: 'No active purchases',
          message: "We couldn't find any active subscriptions to restore.",
          variant: 'info',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
      }
    } finally {
      setRestoreLoading(false);
    }
  };

  if (subLoading) {
    return (
      <>
        <View style={[styles.centered, { backgroundColor: theme.background }]}>
          <LoadingState title="Checking subscription…" message="Just a sec…" />
        </View>
        {dialogEl}
      </>
    );
  }

  const hasOfferings = isRevenueCatConfigured() && (offerings?.current?.availablePackages?.length ?? 0) > 0;
  const showUnavailable = !hasOfferings && !offeringsLoading;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {dialogEl}
      <GlassHeaderBar insets={insets} style={styles.headerBar}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]}
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.text }]}>Premium</Text>
      </GlassHeaderBar>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: layout.scrollContentPaddingBottomTab }]}
        showsVerticalScrollIndicator={false}
      >
        {isPremium ? (
          <Card variant="glass" style={[styles.entitlementCard, { borderColor: theme.glassBorder }]}>
            <View style={[styles.entitlementIconWrap, { backgroundColor: theme.tintSoft }]}>
              <Ionicons name="sparkles" size={36} color={theme.tint} />
            </View>
            <Text style={[styles.entitlementTitle, { color: theme.text }]}>You're already Premium 🎉</Text>
            {plan && (
              <Text style={[styles.planText, { color: theme.text }]}>
                Plan: {plan === 'annual' ? 'Annual' : 'Monthly'}
              </Text>
            )}
            {currentPeriodEnd && (
              <Text style={[styles.periodText, { color: theme.textSecondary }]}>
                Renews {format(new Date(currentPeriodEnd), 'MMMM d, yyyy')}
              </Text>
            )}
            <Text style={[styles.entitlementBody, { color: theme.textSecondary }]}>
              Thanks for supporting Vibely. Your plan includes the Premium tier capabilities tied to your account.
            </Text>
            <VibelyButton
              label="Go Home"
              variant="secondary"
              onPress={() => router.replace('/(tabs)')}
              style={styles.cta}
            />
          </Card>
        ) : (
          <>
            {entryNudge ? (
              <View
                style={[
                  styles.nudgeBanner,
                  {
                    borderColor:
                      entryNudge.variant === 'caution'
                        ? 'rgba(245, 158, 11, 0.45)'
                        : withAlpha(theme.tint, 0.35),
                    backgroundColor:
                      entryNudge.variant === 'caution'
                        ? 'rgba(245, 158, 11, 0.12)'
                        : withAlpha(theme.surfaceSubtle, 0.9),
                  },
                ]}
                accessibilityRole="summary"
              >
                <Text style={[styles.nudgeTitle, { color: theme.text }]}>{entryNudge.title}</Text>
                <Text style={[styles.nudgeBody, { color: theme.textSecondary }]}>{entryNudge.body}</Text>
              </View>
            ) : null}

            <View style={styles.heroBlock}>
              <View style={[styles.heroIconWrap, { backgroundColor: theme.tintSoft }]}>
                <Ionicons name="sparkles" size={40} color={theme.tint} />
              </View>
              <Text style={[styles.heroTitle, { color: theme.text }]}>{defaultHero.title}</Text>
              <Text style={[styles.heroSub, { color: theme.textSecondary }]}>{defaultHero.subtitle}</Text>
            </View>

            <Card variant="glass" style={[styles.trustCard, { borderColor: theme.glassBorder }]}>
              <View style={styles.trustRow}>
                <Ionicons name="shield-checkmark-outline" size={22} color={theme.tint} />
                <View style={styles.trustTextWrap}>
                  <Text style={[styles.trustTitle, { color: theme.text }]}>Managed in the store</Text>
                  <Text style={[styles.trustBody, { color: theme.textSecondary }]}>
                    Subscriptions bill through your app store account. You can cancel or restore from device settings.
                  </Text>
                </View>
              </View>
            </Card>

            <Card variant="glass" style={[styles.featuresCard, { borderColor: theme.glassBorder }]}>
              <Text style={[styles.featuresCardTitle, { color: theme.text }]}>Included with Premium</Text>
              {featureBullets.map((feature) => (
                <View key={feature} style={styles.featureRow}>
                  <View style={[styles.featureCheckWrap, { backgroundColor: withAlpha(theme.tintSoft, 0.5) }]}>
                    <Ionicons name="checkmark" size={16} color={theme.tint} />
                  </View>
                  <Text style={[styles.featureText, { color: theme.text }]}>{feature}</Text>
                </View>
              ))}
              <View style={[styles.vipFootnoteRow, { borderTopColor: theme.border }]}>
                <Ionicons
                  name="information-circle-outline"
                  size={18}
                  color={theme.textSecondary}
                  style={styles.vipFootnoteIcon}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
                <Text style={[styles.vipFootnoteText, { color: theme.textSecondary }]}>
                  {PREMIUM_VIP_EXCLUSION_FOOTNOTE}
                </Text>
              </View>
            </Card>

            {error ? (
              <View style={[styles.errorBar, { backgroundColor: theme.dangerSoft, borderColor: withAlpha(theme.danger, 0.25) }]}>
                <Text style={[styles.errorText, { color: theme.danger }]}>{error}</Text>
              </View>
            ) : null}

            {offeringsLoading ? (
              <View style={styles.offeringLoadWrap}>
                <LoadingState title="Loading plans…" message="Checking what's available." />
              </View>
            ) : hasOfferings ? (
              <View style={styles.packages}>
                {sortedPackages.map((pkg) => {
                  const isAnnual = pkg.packageType === 'ANNUAL';
                  const isMonthly = pkg.packageType === 'MONTHLY';
                  const label = isAnnual ? 'Annual' : isMonthly ? 'Monthly' : pkg.packageType;
                  const billingHint = isAnnual ? 'Billed annually' : isMonthly ? 'Billed monthly' : null;
                  return (
                    <Card
                      key={pkg.identifier}
                      variant="glass"
                      style={[
                        styles.packageCard,
                        {
                          borderColor: isAnnual ? withAlpha(theme.tint, 0.55) : theme.glassBorder,
                          borderWidth: isAnnual ? 2 : 1,
                        },
                      ]}
                    >
                      {isAnnual ? (
                        <View style={[styles.recommendedPill, { backgroundColor: theme.tint }]}>
                          <Text style={styles.recommendedPillText}>Best value</Text>
                        </View>
                      ) : null}
                      <Text style={[styles.packageLabel, { color: theme.text }]}>{label}</Text>
                      <Text style={[styles.packagePrice, { color: theme.tint }]}>{pkg.product.priceString}</Text>
                      {billingHint ? (
                        <Text style={[styles.packageBillingHint, { color: theme.textSecondary }]}>{billingHint}</Text>
                      ) : null}
                      <VibelyButton
                        label={purchaseLoading ? '…' : `Get Premium — ${label}`}
                        onPress={() => handlePurchase(pkg)}
                        loading={purchaseLoading}
                        disabled={purchaseLoading}
                        variant="gradient"
                        size="lg"
                        style={styles.packageCta}
                      />
                    </Card>
                  );
                })}
              </View>
            ) : showUnavailable ? (
              <Card variant="glass" style={[styles.unavailableCard, { borderColor: theme.glassBorder }]}>
                <View style={[styles.unavailableIconWrap, { backgroundColor: theme.surface }]}>
                  <Ionicons name="card-outline" size={32} color={theme.textSecondary} />
                </View>
                <Text style={[styles.unavailableTitle, { color: theme.text }]}>Premium isn't available here yet</Text>
                <Text style={[styles.unavailableBody, { color: theme.textSecondary }]}>
                  Subscribe on the web to unlock premium, or check back later for in-app options.
                </Text>
                <VibelyButton
                  label="Back"
                  variant="secondary"
                  onPress={() => router.back()}
                  style={styles.cta}
                />
              </Card>
            ) : null}

            {isRevenueCatConfigured() && (
              <Pressable
                onPress={handleRestore}
                disabled={restoreLoading}
                style={({ pressed }) => [styles.restoreWrap, pressed && { opacity: 0.8 }]}
              >
                <Text style={[styles.restoreText, { color: theme.textSecondary }]}>
                  {restoreLoading ? 'Restoring…' : 'Restore purchases'}
                </Text>
              </Pressable>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  headerBar: { marginBottom: 0 },
  backBtn: { padding: spacing.xs },
  headerTitle: { fontSize: 18, fontWeight: '600', flex: 1 },
  scroll: { flex: 1 },
  content: { padding: spacing.lg, paddingTop: layout.mainContentPaddingTop },
  entitlementCard: { padding: spacing.xl, alignItems: 'center', marginBottom: spacing.lg },
  entitlementIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  entitlementTitle: { fontSize: 22, fontWeight: '700', marginBottom: spacing.sm, textAlign: 'center' },
  planText: { fontSize: 16, marginBottom: 4 },
  periodText: { fontSize: 14, marginBottom: spacing.sm },
  entitlementBody: { fontSize: 14, textAlign: 'center', marginBottom: spacing.lg },
  cta: { marginTop: spacing.sm, alignSelf: 'stretch' },
  nudgeBanner: {
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: spacing.md,
    marginBottom: spacing.lg,
    gap: 6,
  },
  nudgeTitle: { fontSize: 15, fontWeight: '700' },
  nudgeBody: { fontSize: 14, lineHeight: 20 },
  heroBlock: { alignItems: 'center', marginBottom: spacing.xl },
  heroIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  heroTitle: { fontSize: 28, fontWeight: '800', textAlign: 'center', marginBottom: spacing.sm },
  heroSub: { fontSize: 16, textAlign: 'center' },
  trustCard: { padding: spacing.lg, marginBottom: spacing.lg },
  trustRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  trustTextWrap: { flex: 1, gap: 4 },
  trustTitle: { fontSize: 15, fontWeight: '600' },
  trustBody: { fontSize: 13, lineHeight: 18 },
  featuresCard: { padding: spacing.xl, marginBottom: spacing.xl },
  featuresCardTitle: { fontSize: 16, fontWeight: '600', marginBottom: spacing.md },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginBottom: spacing.sm },
  featureCheckWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: { fontSize: 15, flex: 1 },
  vipFootnoteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
  },
  vipFootnoteIcon: { marginTop: 2 },
  vipFootnoteText: { fontSize: 12, lineHeight: 17, flex: 1 },
  errorBar: { padding: spacing.md, borderRadius: radius.lg, marginBottom: spacing.lg, borderWidth: 1 },
  errorText: { fontSize: 14 },
  offeringLoadWrap: { marginBottom: spacing.lg },
  packages: { gap: spacing.lg, marginBottom: spacing.lg },
  packageCard: { padding: spacing.xl, marginBottom: 0, position: 'relative' },
  recommendedPill: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  recommendedPillText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  packageLabel: { fontSize: 18, fontWeight: '600', marginBottom: 4, paddingRight: 88 },
  packagePrice: { fontSize: 22, fontWeight: '700', marginBottom: 4 },
  packageBillingHint: { fontSize: 13, marginBottom: spacing.md },
  packageCta: { marginTop: spacing.sm, alignSelf: 'stretch' },
  unavailableCard: { padding: spacing.xl, alignItems: 'center', marginBottom: spacing.lg },
  unavailableIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  unavailableTitle: { fontSize: 18, fontWeight: '600', marginBottom: spacing.sm, textAlign: 'center' },
  unavailableBody: { fontSize: 14, textAlign: 'center', marginBottom: spacing.lg },
  restoreWrap: { alignSelf: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  restoreText: { fontSize: 13 },
});
