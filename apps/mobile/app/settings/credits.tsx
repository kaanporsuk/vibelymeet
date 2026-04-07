/**
 * Video Date Credits — balance from user_credits; purchase via create-credits-checkout (Stripe in browser).
 */
import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, Linking } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Colors from '@/constants/Colors';
import { GlassSurface, Card, Skeleton } from '@/components/ui';
import { spacing, radius } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { getCreditsCheckoutUrl, type CreditPackId } from '@/lib/creditsCheckout';
import { trackEvent } from '@/lib/analytics';
import { CREDIT_PACK_IDS, CREDIT_PACKS, formatPackPriceEur } from '@shared/creditPacks';
import { useVibelyDialog } from '@/components/VibelyDialog';

const PACKS: {
  id: CreditPackId;
  name: string;
  description: string;
  price: string;
  compareAt?: string;
  isBundle: boolean;
}[] = CREDIT_PACK_IDS.map((id) => {
  const def = CREDIT_PACKS[id];
  return {
    id,
    name: def.name,
    description: def.description,
    price: formatPackPriceEur(def.priceEur),
    compareAt: def.compareAtEur != null ? formatPackPriceEur(def.compareAtEur) : undefined,
    isBundle: id === 'bundle_3_3',
  };
});

function useCredits(userId: string | null | undefined) {
  return useQuery({
    queryKey: ['user_credits', userId],
    queryFn: async () => {
      if (!userId) return null;
      const { data, error } = await supabase
        .from('user_credits')
        .select('extra_time_credits, extended_vibe_credits')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!userId,
  });
}

export default function CreditsSettingsScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: credits, isLoading, refetch: refetchCredits } = useCredits(user?.id);
  const [loadingPackId, setLoadingPackId] = useState<CreditPackId | null>(null);
  const { show: showDialog, dialog: dialogEl } = useVibelyDialog();

  useFocusEffect(
    useCallback(() => {
      refetchCredits();
    }, [refetchCredits])
  );

  const handleBuyPack = async (packId: CreditPackId) => {
    trackEvent('credit_purchase_initiated', { pack_id: packId });
    setLoadingPackId(packId);
    try {
      const url = await getCreditsCheckoutUrl(packId);
      await Linking.openURL(url);
      qc.invalidateQueries({ queryKey: ['user_credits'] });
    } catch (e) {
      trackEvent('credit_purchase_failed', { pack_id: packId, reason: 'checkout_url_error' });
      showDialog({
        title: 'Checkout didn’t start',
        message: e instanceof Error ? e.message : 'Something blocked checkout. Try again.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    } finally {
      setLoadingPackId(null);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {dialogEl}
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
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.text }]}>Video Date Credits</Text>
      </GlassSurface>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: spacing['2xl'] + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.main}>
          <Card style={styles.card}>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Your balance</Text>
            {isLoading ? (
              <View style={styles.balanceRow}>
                <Skeleton width={160} height={28} borderRadius={8} />
              </View>
            ) : (
              <Text style={[styles.balanceLine, { color: theme.text }]}>
                Extra Time {credits?.extra_time_credits ?? 0}
                <Text style={{ color: theme.textSecondary }}> · </Text>
                Extended Vibe {credits?.extended_vibe_credits ?? 0}
              </Text>
            )}
            <Text style={[styles.body, { color: theme.textSecondary, marginTop: spacing.lg }]}>
              Extra Time adds +2 minutes per credit; Extended Vibe adds +5 minutes per credit — only when you tap extend
              during a live video date. Payment runs in your browser (Stripe).
            </Text>
            {PACKS.map((pack) => {
              const rowInner = (
                <Pressable
                  onPress={() => loadingPackId === null && handleBuyPack(pack.id)}
                  disabled={!!loadingPackId}
                  style={[
                    styles.packRowInner,
                    { backgroundColor: theme.surfaceSubtle },
                    pack.isBundle && { backgroundColor: theme.surface },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={pack.isBundle ? 'Buy Vibe Bundle' : `Buy ${pack.name}`}
                  accessibilityState={{ busy: loadingPackId === pack.id, disabled: !!loadingPackId }}
                >
                  <View style={styles.packTextCol}>
                    <Text style={[styles.packName, { color: theme.text }]}>{pack.name}</Text>
                    <Text style={[styles.packDesc, { color: theme.textSecondary }]}>{pack.description}</Text>
                  </View>
                  <View style={styles.packRight}>
                    <View style={styles.priceCol}>
                      {pack.compareAt ? (
                        <Text style={[styles.compareAt, { color: theme.textSecondary }]}>{pack.compareAt}</Text>
                      ) : null}
                      <Text style={[styles.packPrice, { color: theme.tint }]}>{pack.price}</Text>
                    </View>
                    {loadingPackId === pack.id ? (
                      <ActivityIndicator size="small" color={theme.tint} />
                    ) : (
                      <Text style={[styles.packBuy, { color: theme.tint }]}>Buy</Text>
                    )}
                  </View>
                </Pressable>
              );

              if (pack.isBundle) {
                return (
                  <View key={pack.id} style={[styles.bundleWrap, { marginTop: spacing.md }]}>
                    <View style={[styles.bestValueBadge, { backgroundColor: theme.neonPink }]}>
                      <Text style={styles.bestValueBadgeText}>BEST VALUE</Text>
                    </View>
                    <LinearGradient
                      colors={['#E84393', '#8B5CF6']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.bundleGradient}
                    >
                      <View style={[styles.bundleInner, { backgroundColor: theme.surface }]}>{rowInner}</View>
                    </LinearGradient>
                  </View>
                );
              }

              return (
                <Pressable
                  key={pack.id}
                  onPress={() => loadingPackId === null && handleBuyPack(pack.id)}
                  disabled={!!loadingPackId}
                  style={[styles.packRow, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Buy ${pack.name}`}
                  accessibilityState={{ busy: loadingPackId === pack.id, disabled: !!loadingPackId }}
                >
                  <View style={styles.packTextCol}>
                    <Text style={[styles.packName, { color: theme.text }]}>{pack.name}</Text>
                    <Text style={[styles.packDesc, { color: theme.textSecondary }]}>{pack.description}</Text>
                  </View>
                  <View style={styles.packRight}>
                    <Text style={[styles.packPrice, { color: theme.tint }]}>{pack.price}</Text>
                    {loadingPackId === pack.id ? (
                      <ActivityIndicator size="small" color={theme.tint} />
                    ) : (
                      <Text style={[styles.packBuy, { color: theme.tint }]}>Buy</Text>
                    )}
                  </View>
                </Pressable>
              );
            })}
            <Text style={[styles.footnote, { color: theme.textSecondary, marginTop: spacing.lg }]}>
              Opens Stripe checkout in browser. Return to this screen after payment — your balance will refresh automatically.
            </Text>
          </Card>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  backBtn: { padding: spacing.xs },
  headerTitle: { fontSize: 20, fontWeight: '700', flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingTop: spacing.lg },
  main: { paddingHorizontal: spacing.lg },
  card: { padding: spacing.lg },
  subtitle: { fontSize: 14, fontWeight: '600', marginBottom: spacing.sm },
  balanceRow: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' },
  balanceLine: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  body: { fontSize: 15, lineHeight: 22 },
  packRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginTop: spacing.md,
  },
  bundleWrap: { position: 'relative', borderRadius: radius.lg + 2 },
  bestValueBadge: {
    position: 'absolute',
    top: -10,
    right: spacing.md,
    zIndex: 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  bestValueBadgeText: { fontSize: 10, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },
  bundleGradient: { borderRadius: radius.lg + 2, padding: 2, marginTop: spacing.xs },
  bundleInner: { borderRadius: radius.lg, overflow: 'hidden' },
  packRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  packTextCol: { flex: 1, minWidth: 0, paddingRight: spacing.sm },
  packName: { fontSize: 16, fontWeight: '600' },
  packDesc: { fontSize: 13, marginTop: 2 },
  packRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  priceCol: { alignItems: 'flex-end' },
  compareAt: { fontSize: 12, textDecorationLine: 'line-through' },
  packPrice: { fontSize: 16, fontWeight: '700' },
  packBuy: { fontSize: 15, fontWeight: '600' },
  footnote: { fontSize: 13, lineHeight: 18 },
});
