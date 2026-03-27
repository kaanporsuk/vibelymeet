import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { View, Text, Pressable, StyleSheet, Share, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import {
  labelForDateType,
  labelForTimeChoice,
  labelForPlaceMode,
  buildShareDateText,
  DATE_SAFETY_NOTE,
} from '@/lib/dateSuggestionCopy';
import type { DateSuggestionWithRelations } from '@/lib/useDateSuggestionData';
import { dateSuggestionApply, DateSuggestionDomainError } from '@/lib/dateSuggestionApply';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  proposed: 'Proposed',
  viewed: 'Seen',
  countered: 'Countered',
  accepted: 'Accepted',
  declined: 'Declined',
  not_now: 'Not now',
  expired: 'Expired',
  cancelled: 'Cancelled',
  completed: 'Completed',
};

function formatWhen(r: {
  time_choice_key: string;
  starts_at: string | null;
  ends_at: string | null;
  time_block: string | null;
}): string {
  if (r.starts_at) {
    try {
      return format(new Date(r.starts_at), 'MMM d, h:mm a');
    } catch {
      return r.time_choice_key;
    }
  }
  return labelForTimeChoice(r.time_choice_key);
}

function placeLine(r: { place_mode_key: string; venue_text: string | null }): string {
  if (r.place_mode_key === 'custom_venue' && r.venue_text) return r.venue_text;
  return labelForPlaceMode(r.place_mode_key);
}

type OpenComposerOpts = {
  mode: 'new' | 'counter' | 'editDraft';
  draftId?: string;
  draftPayload?: Record<string, unknown> | null;
  counter?: { suggestionId: string; previousRevision: DateSuggestionWithRelations['revisions'][0] };
};

type Props = {
  suggestion: DateSuggestionWithRelations;
  currentUserId: string;
  partnerName: string;
  partnerUserId: string;
  onOpenComposer: (opts: OpenComposerOpts) => void;
  onUpdated: () => void;
};

export function DateSuggestionChatCard({
  suggestion,
  currentUserId,
  partnerName,
  partnerUserId: _partnerUserId,
  onOpenComposer,
  onUpdated,
}: Props) {
  const theme = Colors[useColorScheme()];
  const queryClient = useQueryClient();
  const cancelInFlightRef = useRef(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const markedRef = useRef(false);
  const revs = suggestion.revisions;
  const current = useMemo(() => {
    if (suggestion.current_revision_id) {
      return revs.find((r) => r.id === suggestion.current_revision_id) ?? revs[revs.length - 1];
    }
    return revs[revs.length - 1];
  }, [revs, suggestion.current_revision_id]);

  const isProposer = suggestion.proposer_id === currentUserId;
  const originalRecipient = suggestion.recipient_id === currentUserId;
  const authorOfCurrent = current?.proposed_by === currentUserId;
  const showAgreedChips =
    revs.length > 1 &&
    current &&
    current.agreed_field_flags &&
    typeof current.agreed_field_flags === 'object' &&
    Object.keys(current.agreed_field_flags as object).length > 0;
  const status = suggestion.status;

  useEffect(() => {
    if (!current || markedRef.current) return;
    if (status !== 'proposed' && status !== 'countered') return;
    if (authorOfCurrent) return;
    markedRef.current = true;
    dateSuggestionApply('mark_viewed', { suggestion_id: suggestion.id }).catch(() => {
      markedRef.current = false;
    });
  }, [suggestion.id, status, authorOfCurrent, current]);

  const agreed = current?.agreed_field_flags as Record<string, boolean> | undefined;
  const optionalNote = current?.optional_message?.trim() ?? '';

  const handleAccept = async () => {
    try {
      await dateSuggestionApply('accept', { suggestion_id: suggestion.id });
      Alert.alert("It's a date!", 'Enjoy planning together.');
      onUpdated();
    } catch {
      Alert.alert('Error', 'Could not accept.');
    }
  };

  const handleDecline = async () => {
    try {
      await dateSuggestionApply('decline', { suggestion_id: suggestion.id });
      onUpdated();
    } catch {
      Alert.alert('Error', 'Could not decline.');
    }
  };

  const handleNotNow = async () => {
    try {
      await dateSuggestionApply('not_now', { suggestion_id: suggestion.id });
      onUpdated();
    } catch {
      Alert.alert('Error', 'Could not update.');
    }
  };

  const handleCancel = useCallback(async () => {
    if (cancelInFlightRef.current) return;
    cancelInFlightRef.current = true;
    setCancelBusy(true);
    try {
      await dateSuggestionApply('cancel', { suggestion_id: suggestion.id });
      onUpdated();
    } catch (e) {
      if (e instanceof DateSuggestionDomainError) {
        const { code } = e;
        if (code === 'invalid_status') {
          await queryClient.refetchQueries({ queryKey: ['date-suggestions', suggestion.match_id] });
          const list = queryClient.getQueryData<DateSuggestionWithRelations[]>([
            'date-suggestions',
            suggestion.match_id,
          ]);
          const row = list?.find((s) => s.id === suggestion.id);
          if (row?.status === 'cancelled') {
            Alert.alert('Date suggestion', 'Already cancelled.');
            onUpdated();
            return;
          }
          Alert.alert('Date suggestion', 'This suggestion can no longer be cancelled.');
          onUpdated();
          return;
        }
        if (code === 'forbidden') {
          Alert.alert('Date suggestion', 'You can only cancel your own suggestions.');
          return;
        }
        if (code === 'suggestion_id_required') {
          Alert.alert('Date suggestion', 'Something went wrong. Try again.');
          return;
        }
        if (code === 'not_found') {
          Alert.alert('Date suggestion', 'This suggestion is no longer available.');
          onUpdated();
          return;
        }
      }
      Alert.alert('Date suggestion', 'Could not cancel. Try again.');
    } finally {
      cancelInFlightRef.current = false;
      setCancelBusy(false);
    }
  }, [onUpdated, queryClient, suggestion.id, suggestion.match_id]);

  const handleShare = async () => {
    if (!current) return;
    const first = partnerName.split(/\s+/)[0] || 'Match';
    const body = buildShareDateText({
      partnerFirstName: first,
      dateTypeLabel: labelForDateType(current.date_type_key),
      placeLabel: placeLine(current),
      timeLabel: formatWhen(current),
      optionalMessage: current.optional_message,
    });
    try {
      await Share.share({ title: 'Vibely date', message: body });
    } catch {
      Alert.alert('Share', 'Could not open the share sheet.');
    }
  };

  const handleMarkComplete = async () => {
    const planId = suggestion.date_plan_id;
    if (!planId) return;
    try {
      await dateSuggestionApply('plan_mark_complete', { plan_id: planId });
      Alert.alert('Thanks', 'Good to know.');
      onUpdated();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('awaiting_partner_confirm')) {
        Alert.alert('Almost there', 'Waiting for your match to confirm.');
      } else {
        Alert.alert('Error', 'Could not update.');
      }
    }
  };

  if (!current && status !== 'draft') {
    return (
      <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
        <Text style={{ color: theme.textSecondary, fontSize: 13 }}>Loading suggestion…</Text>
      </View>
    );
  }

  const showCelebration = status === 'accepted';
  const plan = suggestion.date_plan;
  const myParticipant = plan?.participants?.find((p) => p.user_id === currentUserId);

  const btn = (
    label: string,
    onPress: () => void,
    variant: 'primary' | 'secondary' | 'ghost' = 'secondary',
    disabled = false
  ) => (
    <Pressable
      key={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.actionBtn,
        variant === 'primary' && { backgroundColor: theme.tint },
        variant === 'secondary' && { backgroundColor: theme.muted, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
        variant === 'ghost' && { backgroundColor: 'transparent' },
        { opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
      ]}
    >
      <Text
        style={[
          styles.actionBtnText,
          { color: variant === 'primary' ? theme.primaryForeground : theme.text },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View
      style={[
        styles.card,
        {
          borderColor: showCelebration ? 'rgba(236,72,153,0.45)' : theme.border,
          backgroundColor: showCelebration ? 'rgba(236,72,153,0.12)' : theme.surface,
        },
      ]}
    >
      {showCelebration && (
        <View style={styles.celebrationRow}>
          <Ionicons name="sparkles" size={16} color={theme.tint} />
          <Text style={[styles.celebrationTitle, { color: theme.tint }]}>{"It's a date!"}</Text>
        </View>
      )}

      <View style={styles.headerRow}>
        <View style={styles.headerTitleWrap}>
          <Ionicons name="calendar-outline" size={14} color={theme.tint} />
          <Text style={[styles.kicker, { color: theme.textSecondary }]}>DATE SUGGESTION</Text>
        </View>
        {status === 'accepted' ? (
          <View style={[styles.headerAccent, { backgroundColor: 'rgba(236,72,153,0.16)' }]}>
            <Text style={[styles.headerAccentText, { color: theme.tint }]}>Ready</Text>
          </View>
        ) : null}
        <View
          style={[
            styles.badge,
            {
              borderColor:
                status === 'accepted'
                  ? 'rgba(236,72,153,0.5)'
                  : status === 'completed'
                    ? 'rgba(34,197,94,0.5)'
                    : ['expired', 'declined', 'cancelled', 'not_now'].includes(status)
                      ? theme.border
                      : theme.border,
            },
          ]}
        >
          <Text style={[styles.badgeText, { color: theme.textSecondary }]}>
            {STATUS_LABEL[status] ?? status}
          </Text>
        </View>
      </View>

      {current && (
        <View style={styles.body}>
          <View style={[styles.infoBlock, { borderColor: theme.border, backgroundColor: 'rgba(255,255,255,0.03)' }]}>
            <View style={styles.lineRow}>
              <Text style={[styles.lineLabel, { color: theme.textSecondary }]}>Type</Text>
              {showAgreedChips && agreed?.date_type ? <AgreedChip /> : null}
            </View>
            <Text style={[styles.lineValue, { color: theme.text }]}>{labelForDateType(current.date_type_key)}</Text>
          </View>

          <View style={[styles.infoBlock, { borderColor: theme.border, backgroundColor: 'rgba(255,255,255,0.03)' }]}>
            <View style={styles.lineRow}>
              <Text style={[styles.lineLabel, { color: theme.textSecondary }]}>When</Text>
              {showAgreedChips && agreed?.time ? <AgreedChip /> : null}
            </View>
            <Text style={[styles.lineValue, { color: theme.text }]}>{formatWhen(current)}</Text>
          </View>

          {current.schedule_share_enabled ? (
            <View style={styles.scheduleRow}>
              <Ionicons name="calendar-outline" size={14} color="#22d3ee" />
              <Text style={styles.scheduleText}>Vibely Schedule shared (48h live windows)</Text>
            </View>
          ) : null}

          <View style={[styles.infoBlock, { borderColor: theme.border, backgroundColor: 'rgba(255,255,255,0.03)' }]}>
            <View style={styles.lineRow}>
              <Text style={[styles.lineLabel, { color: theme.textSecondary }]}>Place</Text>
              {showAgreedChips && agreed?.place ? <AgreedChip /> : null}
            </View>
            <Text style={[styles.lineValue, { color: theme.text }]}>{placeLine(current)}</Text>
          </View>

          {optionalNote.length > 0 ? (
            <View style={[styles.infoBlock, { borderColor: theme.border, backgroundColor: 'rgba(255,255,255,0.03)' }]}>
              <View style={styles.lineRow}>
                <Text style={[styles.lineLabel, { color: theme.textSecondary }]}>Note</Text>
                {showAgreedChips && agreed?.optional_message ? <AgreedChip /> : null}
              </View>
              <Text style={[styles.lineValue, { color: theme.text, flex: 1 }]}>{optionalNote}</Text>
            </View>
          ) : null}
        </View>
      )}

      {status === 'accepted' && plan ? (
        <View style={[styles.calendarBox, { borderColor: theme.border }]}>
          <View style={styles.calendarTitleRow}>
            <Ionicons name="checkmark-circle" size={14} color="#22c55e" />
            <Text style={[styles.calendarTitle, { color: '#22c55e' }]}>In your Vibely Calendar</Text>
          </View>
          {myParticipant ? (
            <Text style={[styles.calendarSub, { color: theme.textSecondary }]}>{myParticipant.calendar_title}</Text>
          ) : null}
          <Text style={[styles.safety, { color: theme.textSecondary }]}>{DATE_SAFETY_NOTE}</Text>
        </View>
      ) : null}

      {status === 'completed' ? (
        <View style={styles.completedRow}>
          <Ionicons name="checkmark-circle" size={14} color="#22c55e" />
          <Text style={[styles.completedText, { color: theme.textSecondary }]}>
            You both marked this date complete.
          </Text>
        </View>
      ) : null}

      <View style={[styles.actions, { borderTopColor: theme.border }]}>
        {status === 'draft' && isProposer && (
          <>
            {btn('Continue draft', () =>
              onOpenComposer({
                mode: 'editDraft',
                draftId: suggestion.id,
                draftPayload: suggestion.draft_payload,
              })
            )}
            {btn('Discard', handleCancel, 'ghost', cancelBusy)}
          </>
        )}

        {['proposed', 'viewed', 'countered'].includes(status) && !authorOfCurrent && (
          <>
            {btn('Accept', handleAccept, 'primary')}
            {btn(
              'Counter',
              () =>
                current &&
                onOpenComposer({
                  mode: 'counter',
                  counter: { suggestionId: suggestion.id, previousRevision: current },
                }),
              'secondary'
            )}
            {btn('Not now', handleNotNow)}
            {originalRecipient ? btn('Decline', handleDecline, 'ghost') : null}
          </>
        )}

        {['proposed', 'viewed', 'countered', 'draft'].includes(status) && isProposer
          ? btn('Cancel', handleCancel, 'ghost', cancelBusy)
          : null}

        {status === 'accepted' && (
          <>
            <Pressable
              onPress={handleShare}
              style={({ pressed }) => [
                styles.actionBtn,
                { backgroundColor: theme.muted, flexDirection: 'row', alignItems: 'center', gap: 6, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Ionicons name="share-outline" size={16} color={theme.text} />
              <Text style={[styles.actionBtnText, { color: theme.text }]}>Share the date</Text>
            </Pressable>
            {btn('Mark complete', handleMarkComplete)}
          </>
        )}

        {['declined', 'expired', 'cancelled', 'not_now', 'completed'].includes(status) &&
          btn('New suggestion', () => onOpenComposer({ mode: 'new' }))}
      </View>
    </View>
  );
}

function AgreedChip() {
  return (
    <View style={[styles.agreedChip, { backgroundColor: 'rgba(34,197,94,0.15)' }]}>
      <Text style={[styles.agreedChipText, { color: '#16a34a' }]}>Agreed</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    maxWidth: '100%',
  },
  celebrationRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm },
  celebrationTitle: { fontSize: 15, fontWeight: '700' },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    flexWrap: 'wrap',
    rowGap: 6,
    marginBottom: spacing.sm,
  },
  headerTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, minWidth: 0 },
  kicker: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6 },
  headerAccent: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginLeft: 'auto',
    marginRight: 8,
  },
  headerAccentText: { fontSize: 10, fontWeight: '700' },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.2 },
  body: { gap: 8 },
  infoBlock: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    gap: 4,
  },
  lineRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  lineLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  lineValue: { fontSize: 14, lineHeight: 20, flexShrink: 1, width: '100%' },
  scheduleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  scheduleText: { fontSize: 12, color: '#22d3ee', flex: 1, fontWeight: '500', lineHeight: 17 },
  calendarBox: {
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  calendarTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  calendarTitle: { fontSize: 12, fontWeight: '700' },
  calendarSub: { fontSize: 12, fontWeight: '500', lineHeight: 17, flexShrink: 1 },
  safety: { fontSize: 10, lineHeight: 14, marginTop: 4 },
  completedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm },
  completedText: { fontSize: 12, flex: 1 },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    rowGap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionBtn: {
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    flexGrow: 1,
    minWidth: 132,
    maxWidth: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: { fontSize: 13, fontWeight: '700', textAlign: 'center', flexShrink: 1 },
  agreedChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    marginRight: 4,
    alignSelf: 'center',
  },
  agreedChipText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.25 },
});
