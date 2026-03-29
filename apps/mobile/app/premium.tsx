/**
 * Premium / subscription screen. Reads canonical state from backend; purchases via RevenueCat when configured.
 * Stage 2: hero, feature callouts, entitlement states, resilient no-offerings/unavailable UX.
 */

import { useEffect, useState } from 'react';
import { StyleSheet, View, Text, ScrollView, Pressable } from 'react-native';
import { router } from 'expo-router';
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

export default function PremiumScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { isPremium, plan, currentPeriodEnd, isLoading: subLoading, refetch } = useBackendSubscription(user?.id);

  const [offerings, setOfferings] = useState<PurchasesOfferings | null>(null);
  const [offeringsLoading, setOfferingsLoading] = useState(!!getRevenueCatApiKey());
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { show: showDialog, dialog: dialogEl } = useVibelyDialog();

  useEffect(() => {
    initRevenueCat();
  }, []);

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
    setPurchaseLoading(true);
    setError(null);
    try {
      const result = await purchasePackage(pkg);
      if (result.success) {
        await refetch();
        router.push('/subscription-success' as import('expo-router').Href);
      } else if (result.error && !result.error.includes('cancelled') && !result.error.includes('Cancel')) {
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
              Thanks for supporting Vibely. You have full access to premium features.
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
            <View style={styles.heroBlock}>
              <View style={[styles.heroIconWrap, { backgroundColor: theme.tintSoft }]}>
                <Ionicons name="sparkles" size={40} color={theme.tint} />
              </View>
              <Text style={[styles.heroTitle, { color: theme.text }]}>Unlock Your Full Vibe</Text>
              <Text style={[styles.heroSub, { color: theme.textSecondary }]}>
                Meet people worth meeting — in real life.
              </Text>
            </View>

            <Card variant="glass" style={[styles.featuresCard, { borderColor: theme.glassBorder }]}>
              <Text style={[styles.featuresCardTitle, { color: theme.text }]}>What you get</Text>
              {PREMIUM_FEATURES.map((feature) => (
                <View key={feature} style={styles.featureRow}>
                  <View style={[styles.featureCheckWrap, { backgroundColor: withAlpha(theme.tintSoft, 0.5) }]}>
                    <Ionicons name="checkmark" size={16} color={theme.tint} />
                  </View>
                  <Text style={[styles.featureText, { color: theme.text }]}>{feature}</Text>
                </View>
              ))}
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
                {offerings!.current!.availablePackages.map((pkg) => (
                  <Card key={pkg.identifier} variant="glass" style={[styles.packageCard, { borderColor: theme.glassBorder }]}>
                    <Text style={[styles.packageLabel, { color: theme.text }]}>
                      {pkg.packageType === 'ANNUAL' ? 'Annual' : pkg.packageType === 'MONTHLY' ? 'Monthly' : pkg.packageType}
                    </Text>
                    <Text style={[styles.packagePrice, { color: theme.tint }]}>
                      {pkg.product.priceString}
                      {pkg.packageType === 'MONTHLY' ? '/month' : '/year'}
                    </Text>
                    <VibelyButton
                      label={purchaseLoading ? '…' : 'Get Premium'}
                      onPress={() => handlePurchase(pkg)}
                      loading={purchaseLoading}
                      disabled={purchaseLoading}
                      variant="gradient"
                      size="lg"
                      style={styles.packageCta}
                    />
                  </Card>
                ))}
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

const PREMIUM_FEATURES = [
  'See who vibed you',
  'Browse events in any city',
  'Access Premium-tier events',
  'Premium badge on your profile',
];

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
  featuresCard: { padding: spacing.xl, marginBottom: spacing.xl },
  featuresCardTitle: { fontSize: 16, fontWeight: '600', marginBottom: spacing.md },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  featureCheckWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: { fontSize: 15, flex: 1 },
  errorBar: { padding: spacing.md, borderRadius: radius.lg, marginBottom: spacing.lg, borderWidth: 1 },
  errorText: { fontSize: 14 },
  offeringLoadWrap: { marginBottom: spacing.lg },
  packages: { gap: spacing.lg, marginBottom: spacing.lg },
  packageCard: { padding: spacing.xl, marginBottom: 0 },
  packageLabel: { fontSize: 18, fontWeight: '600', marginBottom: 4 },
  packagePrice: { fontSize: 22, fontWeight: '700', marginBottom: spacing.md },
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
