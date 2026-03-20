import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import Colors from '@/constants/Colors';
import { GlassHeaderBar, VibelyText } from '@/components/ui';
import { spacing, layout, radius } from '@/constants/theme';
import { withAlpha } from '@/lib/colorUtils';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { SUPPORT_CATEGORIES, type PrimaryType } from '@/lib/supportCategories';
import { STATUS_CONFIG, type SupportStatus } from '@/lib/supportStatus';

type ReplyRow = {
  id: string;
  sender_type: string;
  sender_id: string | null;
  message: string;
  created_at: string;
};

type TicketRow = {
  id: string;
  reference_id: string;
  primary_type: string;
  subcategory: string;
  status: string;
  message: string;
  created_at: string;
  platform: string | null;
  app_version: string | null;
};

export default function TicketThreadScreen() {
  const { id: ticketId } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [composer, setComposer] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['support_ticket_thread', ticketId, user?.id],
    queryFn: async () => {
      const { data: ticket, error: tErr } = await supabase
        .from('support_tickets')
        .select('id, reference_id, primary_type, subcategory, status, message, created_at, platform, app_version')
        .eq('id', ticketId!)
        .single();
      if (tErr) throw tErr;
      const { data: replies, error: rErr } = await supabase
        .from('support_ticket_replies')
        .select('id, sender_type, sender_id, message, created_at')
        .eq('ticket_id', ticketId!)
        .order('created_at', { ascending: true });
      if (rErr) throw rErr;
      return { ticket: ticket as TicketRow, replies: (replies ?? []) as ReplyRow[] };
    },
    enabled: !!ticketId && !!user?.id,
  });

  const ticket = data?.ticket;
  const replies = data?.replies ?? [];
  const status = ticket?.status as SupportStatus | undefined;
  const stCfg = status ? STATUS_CONFIG[status] ?? STATUS_CONFIG.submitted : STATUS_CONFIG.submitted;
  const resolved = ticket?.status === 'resolved';

  useFocusEffect(
    useCallback(() => {
      if (!ticketId) return;
      void (async () => {
        const { data: unreadReplies } = await supabase
          .from('support_ticket_replies')
          .select('id')
          .eq('ticket_id', ticketId)
          .eq('sender_type', 'admin')
          .eq('is_read', false);

        if (unreadReplies && unreadReplies.length > 0) {
          await Promise.all(
            unreadReplies.map((r) => supabase.rpc('mark_support_reply_read', { p_reply_id: r.id })),
          );
        }
        queryClient.invalidateQueries({ queryKey: ['support_tickets'] });
      })();
    }, [ticketId, queryClient]),
  );

  const sendMutation = useMutation({
    mutationFn: async (text: string) => {
      if (!user?.id || !ticketId) return;
      const { error } = await supabase.from('support_ticket_replies').insert({
        ticket_id: ticketId,
        sender_type: 'user',
        sender_id: user.id,
        message: text.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setComposer('');
      queryClient.invalidateQueries({ queryKey: ['support_ticket_thread', ticketId] });
    },
  });

  const listData = useMemo(() => {
    if (!ticket) return [];
    const summary = {
      id: 'summary',
      kind: 'summary' as const,
      ticket,
    };
    const msgs = replies.map((r) => ({ ...r, kind: 'msg' as const }));
    return [summary, ...msgs];
  }, [ticket, replies]);

  const pt = ticket?.primary_type as PrimaryType | undefined;
  const cat = pt ? SUPPORT_CATEGORIES[pt] : null;

  if (isLoading || error || !ticket) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        {isLoading ? <ActivityIndicator color={theme.tint} /> : <Text style={{ color: theme.text }}>Could not load ticket</Text>}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <GlassHeaderBar insets={insets}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]}>
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </Pressable>
          <VibelyText variant="titleSM" style={[styles.headerTitle, { color: theme.text, fontFamily: 'SpaceMono-Regular' }]}>
            {ticket.reference_id}
          </VibelyText>
          <View style={[styles.statusChip, { borderColor: withAlpha(stCfg.color, 0.45), backgroundColor: withAlpha(stCfg.color, 0.12) }]}>
            <Text style={[styles.statusText, { color: stCfg.color }]}>{stCfg.label}</Text>
          </View>
        </View>
      </GlassHeaderBar>

      {resolved ? (
        <View style={[styles.resolvedBanner, { backgroundColor: withAlpha('#22D3EE', 0.12) }]}>
          <Text style={{ color: theme.text, fontWeight: '700' }}>This request has been resolved.</Text>
          <Pressable
            onPress={() =>
              router.push({ pathname: '/settings/submit-ticket', params: { primaryType: 'support' } })
            }
          >
            <Text style={{ color: theme.tint, fontWeight: '600', marginTop: 4 }}>Submit another request</Text>
          </Pressable>
        </View>
      ) : null}

      <FlatList
        data={listData}
        keyExtractor={(item) => ('kind' in item && item.kind === 'summary' ? 'summary' : (item as ReplyRow).id)}
        contentContainerStyle={[styles.listContent, { paddingBottom: resolved ? spacing.md : 100 }]}
        renderItem={({ item }) => {
          if ('kind' in item && item.kind === 'summary') {
            const t = item.ticket;
            const c = (t.primary_type as PrimaryType) in SUPPORT_CATEGORIES ? SUPPORT_CATEGORIES[t.primary_type as PrimaryType] : null;
            return (
              <View style={[styles.summary, { borderColor: withAlpha(theme.border, 0.4), backgroundColor: withAlpha(theme.surface, 0.35) }]}>
                <Text style={[styles.badge, { color: c?.color ?? theme.tint }]}>{c?.label ?? t.primary_type}</Text>
                <Text style={[styles.summarySub, { color: theme.text }]}>{t.subcategory}</Text>
                <Text style={[styles.summaryDate, { color: theme.textSecondary }]}>
                  Submitted {format(new Date(t.created_at), 'MMM d, yyyy · h:mm a')}
                </Text>
                <Text style={[styles.originalMsg, { color: theme.text }]}>{t.message}</Text>
                <Text style={[styles.diag, { color: theme.mutedForeground }]}>
                  {t.platform ?? '—'} · {t.app_version ?? '—'}
                </Text>
              </View>
            );
          }
          const r = item as ReplyRow;
          const isUser = r.sender_type === 'user';
          return (
            <View style={[styles.bubbleRow, isUser ? styles.bubbleRowUser : styles.bubbleRowAdmin]}>
              {!isUser ? <Text style={[styles.supportLabel, { color: theme.mutedForeground }]}>Vibely Support</Text> : null}
              <View
                style={[
                  styles.bubble,
                  isUser
                    ? { backgroundColor: withAlpha(theme.tint, 0.25), alignSelf: 'flex-end' }
                    : { backgroundColor: withAlpha(theme.surface, 0.6), alignSelf: 'flex-start' },
                ]}
              >
                <Text style={[styles.bubbleText, { color: theme.text }]}>{r.message}</Text>
                <Text style={[styles.time, { color: theme.mutedForeground }]}>
                  {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                </Text>
              </View>
            </View>
          );
        }}
      />

      {!resolved ? (
        <View
          style={[
            styles.composer,
            {
              paddingBottom: insets.bottom + spacing.sm,
              borderTopColor: withAlpha(theme.border, 0.35),
              backgroundColor: theme.background,
            },
          ]}
        >
          <TextInput
            value={composer}
            onChangeText={setComposer}
            placeholder="Write a reply…"
            placeholderTextColor={theme.mutedForeground}
            style={[
              styles.composerInput,
              { color: theme.text, borderColor: withAlpha(theme.border, 0.5), backgroundColor: withAlpha(theme.surface, 0.4) },
            ]}
          />
          <Pressable
            onPress={() => {
              if (composer.trim()) sendMutation.mutate(composer);
            }}
            disabled={!composer.trim() || sendMutation.isPending}
            style={[styles.sendBtn, { backgroundColor: theme.tint, opacity: composer.trim() ? 1 : 0.45 }]}
          >
            {sendMutation.isPending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Ionicons name="send" size={20} color="#fff" />
            )}
          </Pressable>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  backBtn: { padding: spacing.xs },
  headerTitle: { flex: 1 },
  statusChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusText: { fontSize: 11, fontWeight: '700' },
  resolvedBanner: { padding: spacing.md, marginHorizontal: layout.containerPadding },
  listContent: { paddingHorizontal: layout.containerPadding, paddingTop: spacing.md, gap: spacing.md },
  summary: {
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.sm,
  },
  badge: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  summarySub: { fontSize: 15, fontWeight: '600', marginTop: 4 },
  summaryDate: { fontSize: 12, marginTop: 6 },
  originalMsg: { fontSize: 15, lineHeight: 22, marginTop: 10 },
  diag: { fontSize: 11, marginTop: 8 },
  bubbleRow: { marginBottom: spacing.sm, maxWidth: '100%' },
  bubbleRowUser: { alignItems: 'flex-end' },
  bubbleRowAdmin: { alignItems: 'flex-start' },
  supportLabel: { fontSize: 11, fontWeight: '600', marginBottom: 4, marginLeft: 4 },
  bubble: { maxWidth: '88%', padding: spacing.md, borderRadius: radius.lg },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  time: { fontSize: 11, marginTop: 6 },
  composer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: layout.containerPadding,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    backgroundColor: 'transparent',
  },
  composerInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxHeight: 100,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
