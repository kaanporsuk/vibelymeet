/**
 * Premium / subscription screen. Reads canonical state from backend; purchases via RevenueCat when configured.
 * Visual parity: glass header, card treatment, upgrade CTAs, theme-driven.
 */

import { useEffect, useState } from 'react';
import { StyleSheet, View, Text, ScrollView, Alert, Pressable } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { GlassSurface, Card, LoadingState, VibelyButton } from '@/components/ui';
import { spacing, radius } from '@/constants/theme';
import { useBackendSubscription } from '@/lib/subscriptionApi';
import {
  getOfferings,
  purchasePackage,
  restorePurchases,
  initRevenueCat,
  setRevenueCatUserId,
  isRevenueCatConfigured,
  getRevenueCatApiKey,
} from '@/lib/revenuecat';
import type { PurchasesOfferings, PurchasesPackage } from 'react-native-purchases';
import { format } from 'date-fns';

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

  useEffect(() => {
    initRevenueCat();
  }, []);

  useEffect(() => {
    if (user?.id && isRevenueCatConfigured()) {
      setRevenueCatUserId(user.id);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!isRevenueCatConfigured()) {
      setOfferingsLoading(false);
      return;
    }
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
  }, []);

  const handlePurchase = async (pkg: PurchasesPackage) => {
    setPurchaseLoading(true);
    setError(null);
    try {
      const result = await purchasePackage(pkg);
      if (result.success) {
        await refetch();
        Alert.alert('Success', 'You now have Premium. Enjoy!');
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
      const result = await restorePurchases();
      await refetch();
      if (result.success) {
        Alert.alert('Restored', 'Your purchases have been restored.');
      } else if (result.error) {
        setError(result.error);
      }
    } finally {
      setRestoreLoading(false);
    }
  };

  if (subLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <LoadingState title="Loading…" message="Checking your subscription." />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <GlassSurface
        style={[
          styles.header,
          {
            paddingTop: insets.top + spacing.sm,
            paddingBottom: spacing.md,
            paddingHorizontal: spacing.lg,
          },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]}
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.text }]}>Premium</Text>
      </GlassSurface>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: 48 }]}
        showsVerticalScrollIndicator={false}
      >
        {isPremium ? (
          <Card style={styles.card}>
            <View style={styles.cardIconWrap}>
              <Ionicons name="sparkles" size={32} color={theme.tint} />
            </View>
            <Text style={[styles.cardTitle, { color: theme.text }]}>You're already Premium</Text>
            {plan && (
              <Text style={[styles.planText, { color: theme.text }]}>
                {plan === 'annual' ? 'Annual' : 'Monthly'} plan
              </Text>
            )}
            {currentPeriodEnd && (
              <Text style={[styles.periodText, { color: theme.textSecondary }]}>
                Renews {format(new Date(currentPeriodEnd), 'MMM d, yyyy')}
              </Text>
            )}
            <Text style={[styles.body, { color: theme.textSecondary }]}>
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
            <Text style={[styles.heroCopy, { color: theme.textSecondary }]}>
              Unlock unlimited swipes, see who liked you, and get priority in event lobbies.
            </Text>

            {error ? (
              <View style={[styles.errorBar, { backgroundColor: theme.dangerSoft }]}>
                <Text style={[styles.errorText, { color: theme.danger }]}>{error}</Text>
              </View>
            ) : null}

            {isRevenueCatConfigured() && offeringsLoading ? (
              <LoadingState title="Loading plans…" />
            ) : isRevenueCatConfigured() && offerings?.current?.availablePackages?.length ? (
              <View style={styles.packages}>
                {offerings.current.availablePackages.map((pkg) => (
                  <VibelyButton
                    key={pkg.identifier}
                    label={`${pkg.packageType} · ${pkg.product.priceString}`}
                    onPress={() => handlePurchase(pkg)}
                    loading={purchaseLoading}
                    disabled={purchaseLoading}
                    variant="primary"
                    style={styles.packageButton}
                  />
                ))}
              </View>
            ) : isRevenueCatConfigured() ? (
              <Card style={styles.card}>
                <Text style={[styles.muted, { color: theme.textSecondary }]}>
                  No offerings available. Configure products in RevenueCat dashboard.
                </Text>
              </Card>
            ) : (
              <Card style={styles.card}>
                <Text style={[styles.muted, { color: theme.textSecondary }]}>
                  In-app purchases are not configured for this build. Subscribe on the web or contact support.
                </Text>
              </Card>
            )}

            {isRevenueCatConfigured() && (
              <VibelyButton
                label={restoreLoading ? 'Restoring…' : 'Restore purchases'}
                onPress={handleRestore}
                disabled={restoreLoading}
                variant="ghost"
                style={styles.restoreButton}
              />
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  backBtn: { padding: spacing.xs },
  headerTitle: { fontSize: 20, fontWeight: '700', flex: 1 },
  scroll: { flex: 1 },
  content: { padding: spacing.lg },
  card: { marginBottom: spacing.lg, alignItems: 'center' },
  cardIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(139,92,246,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  cardTitle: { fontSize: 20, fontWeight: '600', marginBottom: spacing.sm },
  planText: { fontSize: 16, marginBottom: 4 },
  periodText: { fontSize: 14, marginBottom: spacing.sm },
  body: { fontSize: 14, textAlign: 'center', marginBottom: spacing.lg },
  cta: { marginTop: spacing.sm },
  heroCopy: { fontSize: 16, marginBottom: spacing.lg },
  errorBar: { padding: spacing.md, borderRadius: radius.lg, marginBottom: spacing.lg },
  errorText: { fontSize: 14 },
  packages: { gap: spacing.md, marginBottom: spacing.lg },
  packageButton: {},
  muted: { fontSize: 14, textAlign: 'center' },
  restoreButton: { marginTop: spacing.sm },
});
