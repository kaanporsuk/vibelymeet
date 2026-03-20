/**
 * Native Schedule — upcoming date reminders, pending proposals, upcoming/past dates.
 * Web source: src/pages/Schedule.tsx
 */
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, Pressable, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { format } from 'date-fns';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { spacing, radius, layout } from '@/constants/theme';
import { VibelyText, VibelyButton, EmptyState, Card, GlassSurface } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useDateReminders, type DateReminder } from '@/lib/useDateReminders';
import {
  useScheduleProposals,
  partitionScheduleProposals,
  toDateProposalsForReminders,
} from '@/lib/useScheduleProposals';
import { DateReminderCard } from '@/components/schedule/DateReminderCard';
import { usePushPermission } from '@/lib/usePushPermission';
import { registerPushWithBackend } from '@/lib/onesignal';
import { NotificationPermissionFlow } from '@/components/notifications/NotificationPermissionFlow';
import { useActiveSession } from '@/lib/useActiveSession';
import { supabase } from '@/lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';

async function openChatFromMatch(matchId: string, userId: string) {
  const { data, error } = await supabase
    .from('matches')
    .select('profile_id_1, profile_id_2')
    .eq('id', matchId)
    .maybeSingle();
  if (error || !data) return;
  const pid = data.profile_id_1 === userId ? data.profile_id_2 : data.profile_id_1;
  router.push(`/chat/${pid}` as const);
}

export default function ScheduleScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: all = [], isLoading, refetch, isRefetching } = useScheduleProposals(user?.id);
  const { pending, upcomingAccepted, past } = partitionScheduleProposals(all);
  const reminderSource = toDateProposalsForReminders(upcomingAccepted);
  const { imminentReminders, soonReminders } = useDateReminders(reminderSource);
  const upcomingReminders = [...imminentReminders, ...soonReminders];
  const urgentIds = new Set(upcomingReminders.map((r) => r.proposalId));
  const calmUpcoming = upcomingAccepted.filter((p) => !urgentIds.has(p.id));
  const { isGranted: pushGranted, requestPermission, openSettings, refresh: refreshPushPermission } =
    usePushPermission();
  const { activeSession } = useActiveSession(user?.id);
  const [showNotificationFlow, setShowNotificationFlow] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const handleNotificationPermissionRequest = useCallback(async (): Promise<boolean> => {
    const granted = await requestPermission();
    if (granted && user?.id) {
      await registerPushWithBackend(user.id);
    }
    await refreshPushPermission();
    return granted;
  }, [requestPermission, user?.id, refreshPushPermission]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    await qc.invalidateQueries({ queryKey: ['date-proposals', user?.id] });
    setRefreshing(false);
  }, [refetch, qc, user?.id]);

  const handleJoinDate = useCallback(
    async (reminder: DateReminder) => {
      if (activeSession?.sessionId) {
        router.push(`/date/${activeSession.sessionId}` as const);
        return;
      }
      if (reminder.matchId && user?.id) {
        await openChatFromMatch(reminder.matchId, user.id);
      }
    },
    [activeSession?.sessionId, user?.id],
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <GlassSurface
        style={[
          styles.headerBar,
          {
            paddingTop: insets.top + spacing.sm,
            paddingBottom: spacing.md,
            paddingHorizontal: layout.containerPadding,
          },
        ]}
      >
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [pressed && { opacity: 0.8 }]}>
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </Pressable>
          <VibelyText variant="titleMD" style={{ color: theme.text, flex: 1, marginLeft: spacing.md }}>
            My Schedule
          </VibelyText>
          <Pressable
            onPress={() => setShowNotificationFlow(true)}
            style={({ pressed }) => [styles.bellBtn, pressed && { opacity: 0.8 }]}
            accessibilityLabel="Notifications"
          >
            <Ionicons
              name={pushGranted ? 'notifications' : 'notifications-outline'}
              size={22}
              color={pushGranted ? theme.tint : theme.textSecondary}
            />
          </Pressable>
        </View>
      </GlassSurface>

      <NotificationPermissionFlow
        open={showNotificationFlow}
        onOpenChange={setShowNotificationFlow}
        onRequestPermission={handleNotificationPermissionRequest}
        openSettings={openSettings}
      />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: layout.scrollContentPaddingBottomTab }]}
        refreshControl={
          <RefreshControl refreshing={refreshing || isRefetching} onRefresh={onRefresh} tintColor={theme.tint} />
        }
        showsVerticalScrollIndicator={false}
      >
        {upcomingReminders.length > 0 && (
          <View style={styles.section}>
            <VibelyText variant="titleSM" style={{ color: theme.mutedForeground }}>
              Upcoming Dates
            </VibelyText>
            {upcomingReminders.map((r) => (
              <DateReminderCard
                key={r.id}
                reminder={r}
                onJoinDate={() => handleJoinDate(r)}
                onEnableNotifications={() => setShowNotificationFlow(true)}
                notificationsEnabled={pushGranted}
              />
            ))}
          </View>
        )}

        {pending.length > 0 && (
          <View style={styles.section}>
            <VibelyText variant="titleMD" style={{ color: theme.text }}>
              Needs your response
            </VibelyText>
            {pending.map((p) => (
              <Card key={p.id} variant="glass" style={styles.proposalCard}>
                <Text style={[styles.proposalName, { color: theme.text }]}>{p.partnerName}</Text>
                <Text style={[styles.proposalDate, { color: theme.mutedForeground }]}>
                  {format(p.date, 'EEEE, MMMM d')} · {p.timeBlockLabel}
                </Text>
                <Text style={[styles.hint, { color: theme.textSecondary }]}>
                  {p.isIncoming ? 'Open chat to accept or suggest another time.' : 'Waiting for their reply.'}
                </Text>
                <VibelyButton
                  label="Open chat"
                  variant="secondary"
                  size="sm"
                  onPress={() => p.matchId && user?.id && openChatFromMatch(p.matchId, user.id)}
                  style={{ alignSelf: 'flex-start', marginTop: spacing.sm }}
                />
              </Card>
            ))}
          </View>
        )}

        <View style={styles.section}>
          <VibelyText variant="titleMD" style={{ color: theme.text }}>
            Scheduled
          </VibelyText>
          {isLoading ? (
            <ActivityIndicator color={theme.tint} style={{ marginVertical: spacing.lg }} />
          ) : calmUpcoming.length > 0 ? (
            calmUpcoming.map((p) => (
              <Card key={p.id} variant="glass" style={styles.proposalCard}>
                <View style={styles.proposalRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.proposalName, { color: theme.text }]}>{p.partnerName}</Text>
                    <Text style={[styles.proposalDate, { color: theme.mutedForeground }]}>
                      {format(p.date, 'EEEE, MMMM d')}
                    </Text>
                    {p.timeBlock ? (
                      <Text style={[styles.proposalTime, { color: theme.mutedForeground }]}>{p.timeBlockLabel}</Text>
                    ) : null}
                  </View>
                  <VibelyButton
                    label="Chat"
                    variant="secondary"
                    size="sm"
                    onPress={() => user?.id && openChatFromMatch(p.matchId, user.id)}
                  />
                </View>
              </Card>
            ))
          ) : pending.length === 0 && upcomingAccepted.length === 0 ? (
            <EmptyState
              title="No dates scheduled"
              message="Suggest a date in chat to get started!"
            />
          ) : calmUpcoming.length === 0 && upcomingReminders.length > 0 ? (
            <Text style={{ color: theme.mutedForeground, fontSize: 14 }}>
              Other upcoming dates appear above when it’s almost time.
            </Text>
          ) : null}
        </View>

        {past.length > 0 && (
          <View style={styles.section}>
            <VibelyText variant="titleMD" style={{ color: theme.textSecondary }}>
              Past
            </VibelyText>
            {past.map((p) => (
              <Card key={p.id} variant="glass" style={[styles.proposalCard, { opacity: 0.85 }]}>
                <Text style={[styles.proposalName, { color: theme.text }]}>{p.partnerName}</Text>
                <Text style={[styles.proposalDate, { color: theme.mutedForeground }]}>
                  {format(p.date, 'MMM d, yyyy')} · {p.timeBlockLabel}
                </Text>
                <Text style={[styles.statusPill, { color: p.status === 'declined' ? theme.danger : theme.textSecondary }]}>
                  {p.status === 'declined' ? 'Declined' : 'Completed'}
                </Text>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerBar: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.06)' },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  bellBtn: { padding: spacing.xs },
  content: { padding: spacing.lg, gap: spacing.xl, paddingTop: spacing.md },
  section: { gap: spacing.md },
  proposalCard: { padding: spacing.lg },
  proposalRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  proposalName: { fontSize: 16, fontWeight: '600' },
  proposalDate: { fontSize: 14, marginTop: 2 },
  proposalTime: { fontSize: 13, marginTop: 2 },
  hint: { fontSize: 13, marginTop: spacing.sm },
  statusPill: { fontSize: 12, fontWeight: '600', marginTop: spacing.xs },
});
