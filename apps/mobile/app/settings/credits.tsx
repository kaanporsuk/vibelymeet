/**
 * Video Date Credits — native v1: show balance from user_credits, link to web for purchase.
 * Backend: user_credits table; purchase via web (P1/link-out per contract).
 */
import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Linking } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import Colors from '@/constants/Colors';
import { GlassSurface, Card, VibelyButton, Skeleton } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';

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
  const { data: credits, isLoading } = useCredits(user?.id);

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
              Buy more credits on web. Use Extra Time to add minutes in a date; Extended Vibe to extend the vibe round.
            </Text>
            <VibelyButton
              label="Get credits on web"
              onPress={() => Linking.openURL('https://vibelymeet.com/credits').catch(() => {})}
              variant="primary"
              style={styles.cta}
            />
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
  cta: { marginTop: spacing.lg, alignSelf: 'flex-start' },
});
