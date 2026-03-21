import React, { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import Colors from '@/constants/Colors';
import { GlassHeaderBar, VibelyText } from '@/components/ui';
import { spacing, layout, radius } from '@/constants/theme';
import { withAlpha } from '@/lib/colorUtils';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { SUPPORT_CATEGORIES, type PrimaryType } from '@/lib/supportCategories';
import { STATUS_CONFIG, type SupportStatus } from '@/lib/supportStatus';

type TicketRow = {
  id: string;
  reference_id: string;
  subcategory: string;
  status: string;
  updated_at: string;
  primary_type: string;
};

export default function SupportScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { user } = useAuth();

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ['support_tickets', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('support_tickets')
        .select('id, reference_id, subcategory, status, updated_at, primary_type')
        .eq('user_id', user!.id)
        .order('updated_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as TicketRow[];
    },
    enabled: !!user?.id,
  });

  const ticketIds = useMemo(() => tickets.map((t) => t.id), [tickets]);

  const { data: unreadByTicket = {} } = useQuery({
    queryKey: ['support_unread', user?.id, ticketIds],
    queryFn: async () => {
      if (ticketIds.length === 0) return {};
      const { data, error } = await supabase
        .from('support_ticket_replies')
        .select('ticket_id')
        .in('ticket_id', ticketIds)
        .eq('sender_type', 'admin')
        .eq('is_read', false);
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const row of data ?? []) {
        const tid = row.ticket_id as string;
        map[tid] = (map[tid] ?? 0) + 1;
      }
      return map;
    },
    enabled: ticketIds.length > 0,
  });

  const primaryTypes: PrimaryType[] = ['support', 'feedback', 'safety'];

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <GlassHeaderBar insets={insets}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]}
            accessibilityLabel="Back"
          >
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </Pressable>
          <VibelyText variant="titleMD" style={[styles.headerTitle, { color: theme.text }]}>
            Support & Feedback
          </VibelyText>
        </View>
      </GlassHeaderBar>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: layout.scrollContentPaddingBottomTab }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          Get help, share ideas, or report concerns.
        </Text>

        <View style={styles.cards}>
          {primaryTypes.map((pt) => {
            const cfg = SUPPORT_CATEGORIES[pt];
            return (
              <Pressable
                key={pt}
                onPress={() =>
                  router.push({
                    pathname: '/settings/submit-ticket',
                    params: { primaryType: pt },
                  })
                }
                style={({ pressed }) => [
                  styles.card,
                  {
                    borderColor: withAlpha(cfg.color, 0.45),
                    backgroundColor: withAlpha(theme.surface, 0.6),
                    opacity: pressed ? 0.92 : 1,
                  },
                ]}
              >
                <View style={[styles.cardIconWrap, { backgroundColor: withAlpha(cfg.color, 0.15) }]}>
                  <Ionicons name={cfg.icon as never} size={26} color={cfg.color} />
                </View>
                <View style={styles.cardText}>
                  <Text style={[styles.cardTitle, { color: theme.text }]}>{cfg.label}</Text>
                  <Text style={[styles.cardDesc, { color: theme.textSecondary }]} numberOfLines={2}>
                    {cfg.description}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={theme.mutedForeground} />
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.sectionLabel, { color: theme.mutedForeground }]}>YOUR REQUESTS</Text>

        {isLoading ? (
          <ActivityIndicator color={theme.tint} style={{ marginTop: spacing.lg }} />
        ) : tickets.length === 0 ? (
          <View style={[styles.empty, { borderColor: withAlpha(theme.border, 0.4) }]}>
            <Ionicons name="chatbubble-ellipses-outline" size={40} color={theme.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: theme.text }]}>No requests yet</Text>
            <Text style={[styles.emptySub, { color: theme.textSecondary }]}>
              Your submitted requests will appear here.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {tickets.map((t) => {
              const st = t.status as SupportStatus;
              const sc = STATUS_CONFIG[st] ?? STATUS_CONFIG.submitted;
              const unread = unreadByTicket[t.id] ?? 0;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => router.push(`/settings/ticket/${t.id}`)}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      backgroundColor: withAlpha(theme.surface, 0.5),
                      borderColor: withAlpha(theme.border, 0.35),
                      opacity: pressed ? 0.9 : 1,
                    },
                  ]}
                >
                  <View style={[styles.dot, { backgroundColor: sc.color }]} />
                  <View style={styles.rowMain}>
                    <View style={styles.rowTop}>
                      <Text style={[styles.ref, { color: theme.tint }]}>{t.reference_id}</Text>
                      {unread > 0 ? (
                        <View style={[styles.badge, { backgroundColor: theme.tint }]}>
                          <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={[styles.subcat, { color: theme.text }]} numberOfLines={1}>
                      {t.subcategory}
                    </Text>
                    <Text style={[styles.meta, { color: theme.textSecondary }]}>
                      {sc.label} ·{' '}
                      {formatDistanceToNow(new Date(t.updated_at), { addSuffix: true })}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.mutedForeground} />
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingTop: layout.mainContentPaddingTop, paddingHorizontal: layout.containerPadding },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  backBtn: { padding: spacing.xs },
  headerTitle: { flex: 1 },
  subtitle: { fontSize: 14, lineHeight: 20, marginBottom: spacing.lg },
  cards: { gap: spacing.md, marginBottom: spacing.xl },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  cardIconWrap: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  cardDesc: { fontSize: 13, marginTop: 2 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  empty: {
    alignItems: 'center',
    padding: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    gap: spacing.sm,
  },
  emptyTitle: { fontSize: 16, fontWeight: '600', marginTop: spacing.sm },
  emptySub: { fontSize: 13, textAlign: 'center' },
  list: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowMain: { flex: 1 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ref: { fontFamily: 'SpaceMono-Regular', fontSize: 14, fontWeight: '700' },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  subcat: { fontSize: 14, fontWeight: '600', marginTop: 2 },
  meta: { fontSize: 12, marginTop: 4 },
});
