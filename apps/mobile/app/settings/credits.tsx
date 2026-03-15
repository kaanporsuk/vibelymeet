/**
 * Video Date Credits — balance from user_credits; purchase via create-credits-checkout (Stripe in browser).
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Linking, Alert, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Colors from '@/constants/Colors';
import { GlassSurface, Card, Skeleton } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { getCreditsCheckoutUrl, type CreditPackId } from '@/lib/creditsCheckout';

const PACKS: { id: CreditPackId; name: string; description: string; price: string }[] = [
  { id: 'extra_time_3', name: '3× Extra Time', description: '+2 min, 3 times', price: '€2.99' },
  { id: 'extended_vibe_3', name: '3× Extended Vibe', description: '+5 min, 3 times', price: '€4.99' },
  { id: 'bundle_3_3', name: 'Vibe Bundle', description: '3× Extra Time + 3× Extended Vibe', price: '€5.99' },
];

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
  const { data: credits, isLoading } = useCredits(user?.id);
  const [loadingPackId, setLoadingPackId] = useState<CreditPackId | null>(null);

  const handleBuyPack = async (packId: CreditPackId) => {
    setLoadingPackId(packId);
    try {
      const url = await getCreditsCheckoutUrl(packId);
      await Linking.openURL(url);
      qc.invalidateQueries({ queryKey: ['user_credits'] });
    } catch (e) {
      Alert.alert('Checkout', e instanceof Error ? e.message : 'Could not start checkout. Try again.');
    } finally {
      setLoadingPackId(null);
    }
  };

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
                <Skeleton width={80} height={28} borderRadius={8} />
                <Skeleton width={80} height={28} borderRadius={8} style={{ marginLeft: spacing.md }} />
              </View>
            ) : (
              <View style={styles.balanceRow}>
                <View style={[styles.balanceChip, { backgroundColor: theme.surfaceSubtle }]}>
                  <Ionicons name="time-outline" size={18} color={theme.tint} />
                  <Text style={[styles.balanceLabel, { color: theme.text }]}>Extra Time</Text>
                  <Text style={[styles.balanceValue, { color: theme.tint }]}>{credits?.extra_time_credits ?? 0}</Text>
                </View>
                <View style={[styles.balanceChip, { backgroundColor: theme.surfaceSubtle }]}>
                  <Ionicons name="flash-outline" size={18} color={theme.tint} />
                  <Text style={[styles.balanceLabel, { color: theme.text }]}>Extended Vibe</Text>
                  <Text style={[styles.balanceValue, { color: theme.tint }]}>{credits?.extended_vibe_credits ?? 0}</Text>
                </View>
              </View>
            )}
            <Text style={[styles.body, { color: theme.textSecondary, marginTop: spacing.lg }]}>
              Use Extra Time to add minutes in a date; Extended Vibe to extend the vibe round. Payment is processed on web (Stripe).
            </Text>
            {PACKS.map((pack) => (
              <Pressable
                key={pack.id}
                onPress={() => loadingPackId === null && handleBuyPack(pack.id)}
                disabled={!!loadingPackId}
                style={[styles.packRow, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}
              >
                <View>
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
            ))}
            <Text style={[styles.footnote, { color: theme.textSecondary, marginTop: spacing.lg }]}>
              Opens Stripe checkout in browser. After payment, return to the app; balance updates when you reopen this screen.
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
  balanceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    gap: 6,
  },
  balanceLabel: { fontSize: 14 },
  balanceValue: { fontSize: 18, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 22 },
  packRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: spacing.md,
  },
  packName: { fontSize: 16, fontWeight: '600' },
  packDesc: { fontSize: 13, marginTop: 2 },
  packRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  packPrice: { fontSize: 16, fontWeight: '700' },
  packBuy: { fontSize: 15, fontWeight: '600' },
  footnote: { fontSize: 13, lineHeight: 18 },
});
