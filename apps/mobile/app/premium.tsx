/**
 * Premium / subscription screen. Reads canonical state from backend; purchases via RevenueCat when configured.
 */

import { useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { useBackendSubscription } from '@/lib/subscriptionApi';
import {
  getOfferings,
  purchasePackage,
  restorePurchases,
  initRevenueCat,
  setRevenueCatUserId,
  isRevenueCatConfigured,
} from '@/lib/revenuecat';
import type { PurchasesOfferings, PurchasesPackage } from 'react-native-purchases';
import { format } from 'date-fns';

const RC_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY ?? '';

export default function PremiumScreen() {
  const { user } = useAuth();
  const { isPremium, plan, currentPeriodEnd, isLoading: subLoading, refetch } = useBackendSubscription(user?.id);

  const [offerings, setOfferings] = useState<PurchasesOfferings | null>(null);
  const [offeringsLoading, setOfferingsLoading] = useState(!!RC_API_KEY);
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initRevenueCat(RC_API_KEY);
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
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.message}>Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Premium</Text>

      {isPremium ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>You're Premium</Text>
          {plan && <Text style={styles.planText}>{plan === 'annual' ? 'Annual' : 'Monthly'} plan</Text>}
          {currentPeriodEnd && (
            <Text style={styles.periodText}>Renews {format(new Date(currentPeriodEnd), 'MMM d, yyyy')}</Text>
          )}
          <Text style={styles.body}>Thanks for supporting Vibely. You have full access to premium features.</Text>
        </View>
      ) : (
        <>
          <Text style={styles.body}>
            Unlock unlimited swipes, see who liked you, and get priority in event lobbies.
          </Text>

          {error ? (
            <View style={styles.errorBar}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {isRevenueCatConfigured() && offeringsLoading ? (
            <ActivityIndicator style={styles.loader} />
          ) : isRevenueCatConfigured() && offerings?.current?.availablePackages?.length ? (
            <View style={styles.packages}>
              {offerings.current.availablePackages.map((pkg) => (
                <Pressable
                  key={pkg.identifier}
                  style={({ pressed }) => [styles.packageButton, pressed && styles.packageButtonPressed]}
                  onPress={() => handlePurchase(pkg)}
                  disabled={purchaseLoading}
                >
                  <Text style={styles.packageTitle}>{pkg.packageType}</Text>
                  <Text style={styles.packagePrice}>{pkg.product.priceString}</Text>
                  {purchaseLoading && <ActivityIndicator size="small" color="#fff" style={styles.inlineLoader} />}
                </Pressable>
              ))}
            </View>
          ) : isRevenueCatConfigured() ? (
            <Text style={styles.muted}>No offerings available. Check RevenueCat dashboard.</Text>
          ) : (
            <View style={styles.card}>
              <Text style={styles.muted}>
                In-app purchases are not configured for this build. Subscribe on the web or contact support.
              </Text>
            </View>
          )}

          {isRevenueCatConfigured() && (
            <Pressable
              style={({ pressed }) => [styles.restoreButton, pressed && styles.restoreButtonPressed]}
              onPress={handleRestore}
              disabled={restoreLoading}
            >
              <Text style={styles.restoreButtonText}>
                {restoreLoading ? 'Restoring...' : 'Restore purchases'}
              </Text>
            </Pressable>
          )}
        </>
      )}

      <Pressable style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backButtonText}>Back</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 24, paddingBottom: 48 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 16 },
  message: { marginTop: 12, fontSize: 16 },
  body: { fontSize: 16, marginBottom: 24, opacity: 0.9 },
  card: { backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 12, padding: 20, marginBottom: 24 },
  cardTitle: { fontSize: 20, fontWeight: '600', marginBottom: 8 },
  planText: { fontSize: 16, marginBottom: 4 },
  periodText: { fontSize: 14, opacity: 0.8, marginBottom: 12 },
  errorBar: { backgroundColor: 'rgba(200,0,0,0.15)', padding: 12, borderRadius: 8, marginBottom: 16 },
  errorText: { color: '#c00', fontSize: 14 },
  loader: { marginVertical: 24 },
  packages: { gap: 12, marginBottom: 24 },
  packageButton: { backgroundColor: '#0a7ea4', padding: 20, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  packageButtonPressed: { opacity: 0.9 },
  packageTitle: { color: '#fff', fontSize: 18, fontWeight: '600', textTransform: 'capitalize' },
  packagePrice: { color: '#fff', fontSize: 16 },
  inlineLoader: { marginLeft: 8 },
  muted: { fontSize: 14, opacity: 0.7, marginBottom: 24 },
  restoreButton: { paddingVertical: 14, alignItems: 'center', marginBottom: 24 },
  restoreButtonPressed: { opacity: 0.8 },
  restoreButtonText: { fontSize: 16 },
  backButton: { alignSelf: 'flex-start', paddingVertical: 12, paddingHorizontal: 20 },
  backButtonText: { fontSize: 16, opacity: 0.8 },
});
