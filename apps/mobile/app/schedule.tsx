/**
 * Vibe Schedule — native parity with web src/pages/Schedule.tsx + src/components/schedule/VibeSchedule.tsx
 *
 * Stream 2A keeps `user_schedules` as the availability source while aligning the
 * planning hub to the active backend-backed `date_suggestions` / `date_plans` flow
 * already used by chat surfaces. No new schema or recurrence logic is introduced here.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { format } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSchedule, SCHEDULE_QUERY_KEY, type ScheduleTimeBucket } from '@/lib/useSchedule';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useDateReminders, type DateReminder } from '@/lib/useDateReminders';
import { useActiveSession } from '@/lib/useActiveSession';
import { usePushPermission } from '@/lib/usePushPermission';
import { useScheduleHub } from '@/lib/useScheduleHub';
import { dateSuggestionApply } from '@/lib/dateSuggestionApply';
import { VibeScheduleGrid } from '@/components/schedule/VibeScheduleGrid';
import { DateReminderCard } from '@/components/schedule/DateReminderCard';
import { spacing, layout } from '@/constants/theme';
import { OnBreakBanner } from '@/components/OnBreakBanner';
import { labelForDateType, labelForPlaceMode, labelForTimeChoice } from '@/lib/dateSuggestionCopy';
import { formatProposedDateTimeSummary } from '../../../shared/dateSuggestions/formatProposedDateTimeSummary';
import type { ScheduleHubItem } from '../../../shared/schedule/planningHub';

const BG = '#09090B';
const CARD_BG = '#1C1C2E';
const TEAL = '#06B6D4';
const PURPLE = '#8B5CF6';
const MUTED = '#9CA3AF';
const DIVIDER = 'rgba(255,255,255,0.08)';
const SUCCESS_BG = '#16A34A';
const CARD_BORDER = 'rgba(255,255,255,0.12)';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  proposed: 'Waiting on reply',
  viewed: 'Seen',
  countered: 'Countered',
  accepted: 'Confirmed',
  declined: 'Declined',
  not_now: 'Not now',
  expired: 'Expired',
  cancelled: 'Cancelled',
  completed: 'Completed',
};

function resolveWhenLabel(item: ScheduleHubItem): string {
  if (item.startsAt) {
    return formatProposedDateTimeSummary(item.startsAt.toISOString()) || labelForTimeChoice(item.timeChoiceKey);
  }
  return labelForTimeChoice(item.timeChoiceKey);
}

function resolvePlaceLabel(item: ScheduleHubItem): string {
  if (item.placeModeKey === 'custom_venue' && item.venueText) return item.venueText;
  return labelForPlaceMode(item.placeModeKey);
}

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
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['unread-message-count', user?.id],
    queryFn: async () => {
      if (!user?.id) return 0;
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .neq('sender_id', user.id)
        .is('read_at', null);
      return count ?? 0;
    },
    enabled: !!user?.id,
  });
  const {
    days,
    isLoading: scheduleLoading,
    schedule,
    toggleSlot,
    rollPreviousWeek,
    dateRange,
    shiftRange,
    getSlotState,
  } = useSchedule();
  const {
    pendingItems,
    upcomingItems,
    historyItems,
    reminderSources,
    isLoading: plansLoading,
    refetch: refetchScheduleHub,
  } = useScheduleHub();
  const { imminentReminders, soonReminders } = useDateReminders(reminderSources);
  const upcomingReminders = [...imminentReminders, ...soonReminders];
  const { isGranted: pushGranted } = usePushPermission();
  const { activeSession } = useActiveSession(user?.id);
  const [banner, setBanner] = useState<'success' | 'error' | null>(null);
  const [rollLoading, setRollLoading] = useState(false);
  const [datesTab, setDatesTab] = useState<'pending' | 'upcoming' | 'history'>('pending');
  const availabilityCount = useMemo(
    () => Object.values(schedule).filter((slot) => slot.status === 'open').length,
    [schedule]
  );

  const handleRollPreviousWeek = useCallback(async () => {
    setRollLoading(true);
    try {
      await rollPreviousWeek();
      if (user?.id) {
        void qc.invalidateQueries({ queryKey: SCHEDULE_QUERY_KEY(user.id) });
      }
      setBanner('success');
      setTimeout(() => setBanner(null), 3000);
    } catch {
      setBanner('error');
      setTimeout(() => setBanner(null), 4000);
    } finally {
      setRollLoading(false);
    }
  }, [rollPreviousWeek, qc, user?.id]);

  const handleToggleSlot = useCallback(
    (isoDate: string, bucket: ScheduleTimeBucket) => {
      void toggleSlot(isoDate, bucket).catch((e) => {
        if (__DEV__) console.warn('[schedule] toggleSlot failed:', e);
      });
    },
    [toggleSlot],
  );

  const handleJoinDate = useCallback(
    async (reminder: DateReminder) => {
      if (activeSession?.sessionId) {
        if (activeSession.kind === 'ready_gate') {
          router.push(`/ready/${activeSession.sessionId}` as const);
        } else {
          router.push(`/date/${activeSession.sessionId}` as const);
        }
        return;
      }
      if (reminder.partnerUserId) {
        router.push(`/chat/${reminder.partnerUserId}` as const);
        return;
      }
      if (reminder.matchId && user?.id) {
        await openChatFromMatch(reminder.matchId, user.id);
      }
    },
    [activeSession, user?.id],
  );

  const runSuggestionAction = useCallback(
    async (action: 'accept' | 'decline' | 'cancel', item: ScheduleHubItem) => {
      try {
        await dateSuggestionApply(action, { suggestion_id: item.suggestionId });
        await refetchScheduleHub();
        const title =
          action === 'accept' ? 'Plan confirmed' : action === 'decline' ? 'Plan declined' : 'Proposal cancelled';
        Alert.alert(title, action === 'accept' ? 'You can keep coordinating in chat.' : 'The hub has been updated.');
      } catch {
        Alert.alert('Couldn’t update plan', 'Please try again in a moment.');
      }
    },
    [refetchScheduleHub]
  );

  if (scheduleLoading) {
    return (
      <View style={[styles.container, { backgroundColor: BG }]}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={TEAL} />
          <Text style={styles.loadingText}>Loading your schedule...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: BG }]}>
      {/* [A] ScheduleHeaderBar */}
      <View style={[styles.headerBar, { paddingTop: insets.top + spacing.sm, paddingHorizontal: layout.containerPadding }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.8 }]}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.headerTitle}>My Schedule</Text>
        <Pressable
          onPress={() => router.push('/settings/notifications')}
          style={({ pressed }) => [styles.bellWrap, pressed && { opacity: 0.8 }]}
        >
          <View style={styles.bellCircle}>
            <Ionicons name={pushGranted ? 'notifications' : 'notifications-outline'} size={20} color="#FFFFFF" />
            {unreadCount > 0 && <View style={styles.bellBadge} />}
          </View>
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: layout.scrollContentPaddingBottomTab }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Toast banner (success / error) */}
        {banner === 'success' && (
          <View style={styles.toastSuccess}>
            <Text style={styles.toastSuccessText}>Previous week's schedule copied!</Text>
          </View>
        )}
        {banner === 'error' && (
          <View style={styles.toastError}>
            <Text style={styles.toastErrorText}>Failed to copy schedule. Try again.</Text>
          </View>
        )}

        <OnBreakBanner variant="compact" style={{ marginHorizontal: layout.containerPadding, marginBottom: 8 }} />

        {/* Upcoming date reminders */}
        {upcomingReminders.length > 0 && (
          <View style={styles.remindersSection}>
            <Text style={styles.remindersTitle}>Upcoming Dates</Text>
            {upcomingReminders.map((r) => (
              <DateReminderCard
                key={r.id}
                reminder={r}
                onJoinDate={() => {
                  void handleJoinDate(r);
                }}
                onEnableNotifications={() => router.push('/settings/notifications')}
                notificationsEnabled={pushGranted}
              />
            ))}
          </View>
        )}

        <View style={styles.availabilityCard}>
          <View style={styles.availabilityIconWrap}>
            <Ionicons name="calendar-outline" size={20} color={TEAL} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.availabilityTitle}>Availability</Text>
            <Text style={styles.availabilityBody}>
              {availabilityCount > 0
                ? `You have ${availabilityCount} open ${availabilityCount === 1 ? 'slot' : 'slots'} ready for planning.`
                : "No availability set yet. Mark a few open blocks below so matches can build real plans from your schedule."}
            </Text>
          </View>
        </View>

        {/* [B] VibeScheduleIntro */}
        <View style={styles.introBlock}>
          <View style={styles.introLeft}>
            <View style={styles.introIconWrap}>
              <Ionicons name="calendar" size={24} color={TEAL} />
            </View>
            <View>
              <Text style={styles.introTitle1}>My Vibe</Text>
              <Text style={styles.introTitle2}>Schedule</Text>
              <Text style={styles.introSub}>Tap to mark when you're open for dates</Text>
            </View>
          </View>
          <Pressable
            onPress={handleRollPreviousWeek}
            disabled={rollLoading}
            style={({ pressed }) => [
              styles.rollBtn,
              (pressed || rollLoading) && { opacity: 0.8 },
            ]}
          >
            {rollLoading ? (
              <ActivityIndicator size="small" color={PURPLE} />
            ) : (
              <>
                <Ionicons name="copy-outline" size={16} color={PURPLE} />
                <Text style={styles.rollBtnText}>Roll Previous Week</Text>
              </>
            )}
          </Pressable>
        </View>

        {/* [C] ScheduleLegend */}
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendBox, styles.legendBoxOpen]} />
            <Text style={styles.legendText}>Open for Vibe</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendBox, styles.legendBoxLocked]} />
            <Text style={styles.legendText}>Event (Locked)</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendBox, styles.legendBoxBusy]} />
            <Text style={styles.legendText}>Busy/Neutral</Text>
          </View>
        </View>

        <View style={styles.divider} />

        {/* [E] ScheduleRangeNavigator */}
        <View style={styles.rangeNav}>
          <Pressable onPress={() => shiftRange(-1)} style={({ pressed }) => [styles.rangeBtn, pressed && { opacity: 0.8 }]}>
            <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
          </Pressable>
          <Text style={styles.rangeText}>
            {format(dateRange.start, 'MMM d')} – {format(dateRange.end, 'MMM d, yyyy')}
          </Text>
          <Pressable onPress={() => shiftRange(1)} style={({ pressed }) => [styles.rangeBtn, pressed && { opacity: 0.8 }]}>
            <Ionicons name="chevron-forward" size={24} color="#FFFFFF" />
          </Pressable>
        </View>

        <View style={styles.divider} />

        {/* [G] VibeScheduleGrid */}
        <View style={styles.gridWrap}>
          <VibeScheduleGrid days={days} getSlotState={getSlotState} onToggleSlot={handleToggleSlot} />
        </View>

        {/* [H] VibeSchedulePrivacyNote */}
        <View style={styles.privacyNote}>
          <Ionicons name="sparkles" size={16} color={TEAL} />
          <Text style={styles.privacyText}>
            Your matches will only see your open slots, never your busy times
          </Text>
        </View>

        <View style={styles.divider} />

        {/* [J] MyDatesSection */}
        <View style={styles.myDatesSection}>
          <View style={styles.myDatesHeader}>
            <Ionicons name="calendar" size={20} color={PURPLE} />
            <Text style={styles.myDatesTitle}>My Plans</Text>
          </View>
          <View style={styles.segmentedTrack}>
            {(['pending', 'upcoming', 'history'] as const).map((tab) => {
              const count = tab === 'pending' ? pendingItems.length : tab === 'upcoming' ? upcomingItems.length : historyItems.length;
              const active = datesTab === tab;
              return (
                <Pressable
                  key={tab}
                  onPress={() => setDatesTab(tab)}
                  style={[styles.segmentPill, active && styles.segmentPillActive]}
                >
                  <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>
                    {tab === 'pending' ? 'Pending' : tab === 'upcoming' ? 'Upcoming' : 'History'} ({count})
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.myDatesContent}>
            {plansLoading ? (
              <View style={styles.emptyTab}>
                <ActivityIndicator size="small" color={TEAL} />
                <Text style={styles.emptyTabText}>Loading plans...</Text>
              </View>
            ) : null}
            {!plansLoading && datesTab === 'pending' && (pendingItems.length > 0 ? (
              pendingItems.map((item) => (
                <View key={item.id} style={styles.proposalCard}>
                  <View style={styles.proposalHeaderRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.proposalPartner}>{item.partnerName}</Text>
                      <Text style={styles.proposalTitle}>{labelForDateType(item.dateTypeKey)}</Text>
                    </View>
                    <View style={[styles.statusPill, styles.statusPillPending]}>
                      <Text style={styles.statusPillText}>{STATUS_LABEL[item.status] ?? item.status}</Text>
                    </View>
                  </View>
                  <Text style={styles.proposalMeta}>{resolveWhenLabel(item)}</Text>
                  <Text style={styles.proposalMeta}>{resolvePlaceLabel(item)}</Text>
                  {item.optionalMessage ? <Text style={styles.proposalNote}>"{item.optionalMessage}"</Text> : null}
                  <View style={styles.proposalActions}>
                    {item.canAccept ? (
                      <Pressable style={[styles.actionBtn, styles.actionBtnPrimary]} onPress={() => void runSuggestionAction('accept', item)}>
                        <Text style={styles.actionBtnPrimaryText}>Accept</Text>
                      </Pressable>
                    ) : null}
                    {item.canDecline ? (
                      <Pressable style={[styles.actionBtn, styles.actionBtnOutline]} onPress={() => void runSuggestionAction('decline', item)}>
                        <Text style={styles.actionBtnOutlineText}>Decline</Text>
                      </Pressable>
                    ) : null}
                    {item.canCancel ? (
                      <Pressable style={[styles.actionBtn, styles.actionBtnOutline]} onPress={() => void runSuggestionAction('cancel', item)}>
                        <Text style={styles.actionBtnOutlineText}>Cancel</Text>
                      </Pressable>
                    ) : null}
                    <Pressable style={[styles.actionBtn, styles.actionBtnGhost]} onPress={() => router.push(`/chat/${item.partnerUserId}` as const)}>
                      <Text style={styles.actionBtnGhostText}>Open chat</Text>
                    </Pressable>
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.emptyTab}>
                <Ionicons name="calendar-outline" size={40} color={MUTED} />
                <Text style={styles.emptyTabText}>No pending plans or proposals yet.</Text>
              </View>
            ))}
            {!plansLoading && datesTab === 'upcoming' && (upcomingItems.length > 0 ? (
              upcomingItems.map((item) => (
                <View key={item.id} style={styles.proposalCard}>
                  <View style={styles.proposalHeaderRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.proposalPartner}>{item.partnerName}</Text>
                      <Text style={styles.proposalTitle}>{labelForDateType(item.dateTypeKey)}</Text>
                    </View>
                    <View style={[styles.statusPill, styles.statusPillUpcoming]}>
                      <Text style={styles.statusPillText}>{STATUS_LABEL[item.status] ?? item.status}</Text>
                    </View>
                  </View>
                  <Text style={styles.proposalMeta}>{resolveWhenLabel(item)}</Text>
                  <Text style={styles.proposalMeta}>{resolvePlaceLabel(item)}</Text>
                  {item.optionalMessage ? <Text style={styles.proposalNote}>"{item.optionalMessage}"</Text> : null}
                  <View style={styles.proposalActions}>
                    <Pressable style={[styles.actionBtn, styles.actionBtnGhost]} onPress={() => router.push(`/chat/${item.partnerUserId}` as const)}>
                      <Text style={styles.actionBtnGhostText}>Open chat</Text>
                    </Pressable>
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.emptyTab}>
                <Ionicons name="calendar-outline" size={40} color={MUTED} />
                <Text style={styles.emptyTabText}>No upcoming plans yet.</Text>
              </View>
            ))}
            {!plansLoading && datesTab === 'history' && (historyItems.length > 0 ? (
              historyItems.map((item) => (
                <View key={item.id} style={styles.proposalCard}>
                  <View style={styles.proposalHeaderRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.proposalPartner}>{item.partnerName}</Text>
                      <Text style={styles.proposalTitle}>{labelForDateType(item.dateTypeKey)}</Text>
                    </View>
                    <View style={[styles.statusPill, styles.statusPillHistory]}>
                      <Text style={styles.statusPillText}>{STATUS_LABEL[item.status] ?? item.status}</Text>
                    </View>
                  </View>
                  <Text style={styles.proposalMeta}>{resolveWhenLabel(item)}</Text>
                  <Text style={styles.proposalMeta}>{resolvePlaceLabel(item)}</Text>
                  {item.optionalMessage ? <Text style={styles.proposalNote}>"{item.optionalMessage}"</Text> : null}
                  <View style={styles.proposalActions}>
                    <Pressable style={[styles.actionBtn, styles.actionBtnGhost]} onPress={() => router.push(`/chat/${item.partnerUserId}` as const)}>
                      <Text style={styles.actionBtnGhostText}>Open chat</Text>
                    </Pressable>
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.emptyTab}>
                <Ionicons name="calendar-outline" size={40} color={MUTED} />
                <Text style={styles.emptyTabText}>No past plans yet.</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.md },
  loadingText: { fontSize: 14, color: MUTED },

  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: DIVIDER,
  },
  headerBtn: { padding: spacing.xs },
  headerTitle: { flex: 1, marginLeft: spacing.md, fontSize: 18, fontFamily: 'SpaceGrotesk_700Bold', color: '#FFFFFF' },
  bellWrap: { padding: spacing.xs },
  bellCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(139, 92, 246, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
  },

  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingTop: spacing.md },

  toastSuccess: {
    backgroundColor: SUCCESS_BG,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 12,
    marginBottom: spacing.md,
  },
  toastSuccessText: { color: '#FFFFFF', fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  toastError: {
    backgroundColor: '#B91C1C',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 12,
    marginBottom: spacing.md,
  },
  toastErrorText: { color: '#FFFFFF', fontSize: 14 },

  remindersSection: { marginBottom: spacing.xl, gap: spacing.sm },
  remindersTitle: { fontSize: 14, fontFamily: 'Inter_500Medium', color: MUTED },
  availabilityCard: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: CARD_BG,
    marginBottom: spacing.lg,
  },
  availabilityIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(6, 182, 212, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  availabilityTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF', marginBottom: 4 },
  availabilityBody: { fontSize: 13, color: MUTED, lineHeight: 19 },

  introBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  introLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 },
  introIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(6, 182, 212, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  introTitle1: { fontSize: 28, fontFamily: 'SpaceGrotesk_700Bold', color: '#FFFFFF' },
  introTitle2: { fontSize: 28, fontFamily: 'SpaceGrotesk_700Bold', color: '#FFFFFF' },
  introSub: { fontSize: 14, color: MUTED, marginTop: 4 },
  rollBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderColor: PURPLE,
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  rollBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: PURPLE },

  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, marginBottom: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendBox: { width: 16, height: 16, borderRadius: 4 },
  legendBoxOpen: { backgroundColor: 'transparent', borderWidth: 2, borderColor: TEAL },
  legendBoxLocked: { backgroundColor: 'rgba(139,92,246,0.3)', borderWidth: 2, borderColor: PURPLE },
  legendBoxBusy: { backgroundColor: CARD_BG, borderWidth: 1, borderColor: DIVIDER },
  legendText: { fontSize: 12, color: MUTED },

  divider: { height: 1, backgroundColor: DIVIDER, marginVertical: spacing.md },

  rangeNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  rangeBtn: { padding: spacing.xs },
  rangeText: { fontSize: 16, color: '#FFFFFF', fontFamily: 'Inter_500Medium' },

  gridWrap: { minHeight: 380, marginVertical: spacing.sm },

  privacyNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: spacing.md,
  },
  privacyText: { fontSize: 13, color: MUTED, fontStyle: 'italic', flex: 1 },

  myDatesSection: { marginTop: spacing.md },
  myDatesHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.md },
  myDatesTitle: { fontSize: 20, fontFamily: 'SpaceGrotesk_700Bold', color: '#FFFFFF' },
  segmentedTrack: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    padding: 4,
    marginBottom: spacing.md,
  },
  segmentPill: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  segmentPillActive: { backgroundColor: PURPLE },
  segmentLabel: { fontSize: 12, color: MUTED },
  segmentLabelActive: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF' },
  myDatesContent: { minHeight: 120 },
  emptyTab: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
  emptyTabText: { fontSize: 14, color: MUTED },
  proposalCard: {
    backgroundColor: CARD_BG,
    borderRadius: 10,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  proposalHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  proposalPartner: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF' },
  proposalTitle: { fontSize: 13, color: MUTED, marginTop: 4 },
  proposalMeta: { fontSize: 13, color: MUTED, marginTop: 4 },
  proposalNote: { fontSize: 13, color: '#D1D5DB', marginTop: 8, fontStyle: 'italic' },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  statusPillPending: { backgroundColor: 'rgba(139, 92, 246, 0.18)' },
  statusPillUpcoming: { backgroundColor: 'rgba(34, 197, 94, 0.18)' },
  statusPillHistory: { backgroundColor: 'rgba(255,255,255,0.08)' },
  statusPillText: { fontSize: 11, color: '#FFFFFF', fontFamily: 'Inter_600SemiBold' },
  proposalActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: spacing.md },
  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  actionBtnPrimary: { backgroundColor: PURPLE },
  actionBtnPrimaryText: { color: '#FFFFFF', fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  actionBtnOutline: { borderWidth: 1, borderColor: DIVIDER, backgroundColor: 'transparent' },
  actionBtnOutlineText: { color: '#FFFFFF', fontSize: 13, fontFamily: 'Inter_500Medium' },
  actionBtnGhost: { backgroundColor: 'rgba(255,255,255,0.05)' },
  actionBtnGhostText: { color: '#FFFFFF', fontSize: 13, fontFamily: 'Inter_500Medium' },
});
