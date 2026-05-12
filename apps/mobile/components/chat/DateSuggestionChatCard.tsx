import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { View, Text, Pressable, StyleSheet, Share } from 'react-native';
import * as Sentry from '@sentry/react-native';
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
import { useVibelyDialog } from '@/components/VibelyDialog';
import type { DateCardThreadUi } from '../../../../shared/chat/threadPresentation';
import { getDateSuggestionActionPolicy } from '../../../../shared/dateSuggestions/actionPolicy';
import { intersectSlotKeys } from '../../../../shared/dateSuggestions/scheduleShare';
import { useSharedPartnerSchedule } from '@/lib/useSharedPartnerSchedule';
import { ExactTimePinSheet } from './ExactTimePinSheet';
import { ChooseSharedBlockSheet, type OfferedBlock } from './ChooseSharedBlockSheet';

const MAX_TIMER_DELAY_MS = 2147483647;

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
  if (r.place_mode_key === 'custom_venue' && r.venue_text) return tidyDateDisplayText(r.venue_text);
  return labelForPlaceMode(r.place_mode_key);
}

function planPlaceLine(
  plan: DateSuggestionWithRelations['date_plan'],
  revision: DateSuggestionWithRelations['revisions'][0],
): string {
  const venue = plan?.venue_label?.trim();
  if (venue && venue !== revision.place_mode_key) return tidyDateDisplayText(venue);
  return placeLine(revision);
}

function tidyDateDisplayText(value: string): string {
  return value.replace(/^\[(?:fresh|smoke|test|debug|bootstrap)[^\]]*]\s*/i, '').trim();
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
  threadUi?: DateCardThreadUi;
};

export function DateSuggestionChatCard({
  suggestion,
  currentUserId,
  partnerName,
  partnerUserId,
  onOpenComposer,
  onUpdated,
  threadUi = 'normal',
}: Props) {
  const theme = Colors[useColorScheme()];
  const queryClient = useQueryClient();
  const cancelInFlightRef = useRef(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const { show: showDialog, dialog: dialogEl } = useVibelyDialog();
  const markedRef = useRef(false);
  const revs = suggestion.revisions;
  const current = useMemo(() => {
    if (suggestion.current_revision_id) {
      return revs.find((r) => r.id === suggestion.current_revision_id) ?? revs[revs.length - 1];
    }
    return revs[revs.length - 1];
  }, [revs, suggestion.current_revision_id]);

  const actionPolicy = getDateSuggestionActionPolicy({
    status: suggestion.status,
    currentUserId,
    proposerId: suggestion.proposer_id,
    recipientId: suggestion.recipient_id,
    currentRevisionProposedBy: current?.proposed_by,
    hasCurrentRevision: Boolean(current),
  });
  const authorOfCurrent = actionPolicy.isAuthorOfCurrent;
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
  const plan = suggestion.date_plan;
  const [timeGateNow, setTimeGateNow] = useState(() => Date.now());
  const planStartsAt = useMemo(() => {
    if (!plan?.starts_at) return null;
    const parsed = new Date(plan.starts_at);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }, [plan?.starts_at]);
  useEffect(() => {
    if (!planStartsAt) return;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const scheduleNextRefresh = () => {
      const now = Date.now();
      const delayMs = planStartsAt.getTime() - now;
      if (delayMs <= 0) {
        setTimeGateNow(now);
        queryClient.invalidateQueries({ queryKey: ['date-suggestions', suggestion.match_id] });
        return;
      }
      timeout = setTimeout(scheduleNextRefresh, Math.min(delayMs + 1000, MAX_TIMER_DELAY_MS));
    };
    scheduleNextRefresh();
    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [planStartsAt, queryClient, suggestion.match_id]);
  const hasDateStarted = Boolean(planStartsAt && planStartsAt.getTime() <= timeGateNow);
  const isMutuallyCompleted =
    status === 'completed' ||
    plan?.status === 'completed' ||
    Boolean(plan?.completion_confirmed_at);
  const currentUserMarkedComplete = Boolean(
    plan &&
      (plan.completion_initiated_by === currentUserId ||
        plan.completion_confirmed_by === currentUserId),
  );
  const partnerMarkedComplete = Boolean(
    plan &&
      (plan.completion_initiated_by === partnerUserId ||
        plan.completion_confirmed_by === partnerUserId),
  );
  const confirmedWhenLabel =
    planStartsAt && (status === 'accepted' || status === 'completed')
      ? format(planStartsAt, 'MMM d, h:mm a')
      : current
        ? formatWhen(current)
        : '';
  const confirmedPlaceLabel = current ? planPlaceLine(plan, current) : "Let's decide together";

  const isScheduleShare = current?.time_choice_key === 'share_schedule';
  const offerAuthorId = current?.proposed_by ?? null;
  const [pendingSlotKey, setPendingSlotKey] = useState<string | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [acceptBusy, setAcceptBusy] = useState(false);
  const acceptInFlightRef = useRef(false);
  const [cancelPlanBusy, setCancelPlanBusy] = useState(false);
  const [markCompleteBusy, setMarkCompleteBusy] = useState(false);
  const accepterOffer = useSharedPartnerSchedule(
    suggestion.match_id,
    offerAuthorId,
    Boolean(
      isScheduleShare &&
        current &&
        status !== 'accepted' &&
        status !== 'completed' &&
        actionPolicy.canAccept,
    ),
  );

  const chooserOfferedBlocks: OfferedBlock[] = useMemo(() => {
    const slots = accepterOffer.data ?? [];
    return slots.map((slot) => ({
      slot_key: slot.slot_key,
      slot_date: slot.slot_date,
      time_block: slot.time_block,
    }));
  }, [accepterOffer.data]);

  const handleAccept = async () => {
    if (acceptBusy || acceptInFlightRef.current) return;
    if (isScheduleShare) {
      setChooserOpen(true);
      return;
    }
    acceptInFlightRef.current = true;
    setAcceptBusy(true);
    try {
      await dateSuggestionApply('accept', { suggestion_id: suggestion.id });
      showDialog({
        title: "It's a date!",
        message: 'Enjoy planning together.',
        variant: 'success',
        primaryAction: { label: 'Love it', onPress: () => {} },
      });
      onUpdated();
    } catch {
      showDialog({
        title: 'Couldn’t accept',
        message: 'Something went wrong. Try again.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    } finally {
      acceptInFlightRef.current = false;
      setAcceptBusy(false);
    }
  };

  const handleChooserContinue = (slotKey: string) => {
    setChooserOpen(false);
    setPendingSlotKey(slotKey);
  };

  const handleAcceptWithSlot = async (
    slotKey: string,
    startsAtIso: string,
    localStartHour: number,
  ) => {
    if (acceptBusy || acceptInFlightRef.current) return;
    acceptInFlightRef.current = true;
    const localTimezone = (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        return undefined;
      }
    })();
    if (!localTimezone) {
      showDialog({
        title: 'Couldn’t accept',
        message: 'Could not read your timezone. Check device settings and try again.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
      acceptInFlightRef.current = false;
      return;
    }
    setAcceptBusy(true);
    try {
      await dateSuggestionApply('accept', {
        suggestion_id: suggestion.id,
        chosen_slot_key: slotKey,
        starts_at: startsAtIso,
        local_timezone: localTimezone,
        local_start_hour: localStartHour,
      });
      setPendingSlotKey(null);
      setChooserOpen(false);
      showDialog({
        title: "It's a date!",
        message: 'Enjoy planning together.',
        variant: 'success',
        primaryAction: { label: 'Love it', onPress: () => {} },
      });
      onUpdated();
    } catch (e) {
      let msg = 'Something went wrong. Try again.';
      if (e instanceof DateSuggestionDomainError) {
        if (e.code === 'slot_already_locked') msg = 'That time was just taken by another date.';
        else if (e.code === 'slot_user_busy') msg = 'One of you marked that block busy. Pick another.';
        else if (e.code === 'exact_time_outside_block') msg = 'Pick a time inside the chosen block.';
        else if (e.code === 'slot_not_in_share_grant') msg = 'That time is no longer available. Pick another.';
        else if (
          e.code === 'exact_time_required' ||
          e.code === 'invalid_slot_key' ||
          e.code === 'local_date_mismatch' ||
          e.code === 'local_start_hour_mismatch'
        ) {
          msg = 'Pick a time inside the chosen block.';
        } else if (e.code === 'local_timezone_required' || e.code === 'invalid_local_timezone') {
          msg = 'Could not verify your timezone. Check device settings and try again.';
        }
      }
      showDialog({
        title: 'Couldn’t accept',
        message: msg,
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    } finally {
      acceptInFlightRef.current = false;
      setAcceptBusy(false);
    }
  };

  const handleCancelPlan = useCallback(async () => {
    const planId = suggestion.date_plan_id;
    if (!planId) {
      showDialog({
        title: 'Still syncing',
        message: 'This date plan is still syncing.',
        variant: 'info',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
      return;
    }
    setCancelPlanBusy(true);
    try {
      await dateSuggestionApply('cancel_plan', { plan_id: planId });
      onUpdated();
    } catch (e) {
      if (e instanceof DateSuggestionDomainError && e.code === 'invalid_plan_status') {
        showDialog({
          title: 'Already updated',
          message: 'This date can no longer be cancelled.',
          variant: 'info',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
        onUpdated();
      } else {
        showDialog({
          title: 'Couldn’t cancel',
          message: 'We couldn’t cancel this date. Try again.',
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
      }
    } finally {
      setCancelPlanBusy(false);
    }
  }, [onUpdated, showDialog, suggestion.date_plan_id]);

  const handleDecline = async () => {
    try {
      await dateSuggestionApply('decline', { suggestion_id: suggestion.id });
      onUpdated();
    } catch {
      showDialog({
        title: 'Couldn’t decline',
        message: 'Something went wrong. Try again.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    }
  };

  const handleNotNow = async () => {
    try {
      await dateSuggestionApply('not_now', { suggestion_id: suggestion.id });
      onUpdated();
    } catch {
      showDialog({
        title: 'Couldn’t update',
        message: 'Something went wrong. Try again.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
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
            showDialog({
              title: 'Already cancelled',
              message: 'This suggestion was already cancelled.',
              variant: 'info',
              primaryAction: { label: 'OK', onPress: () => {} },
            });
            onUpdated();
            return;
          }
          showDialog({
            title: 'Can’t cancel',
            message: 'This suggestion can no longer be cancelled.',
            variant: 'info',
            primaryAction: { label: 'OK', onPress: () => {} },
          });
          onUpdated();
          return;
        }
        if (code === 'forbidden') {
          showDialog({
            title: 'Not allowed',
            message: 'You can only cancel suggestions you created.',
            variant: 'warning',
            primaryAction: { label: 'OK', onPress: () => {} },
          });
          return;
        }
        if (code === 'suggestion_id_required') {
          showDialog({
            title: 'Something went wrong',
            message: 'Please try again.',
            variant: 'warning',
            primaryAction: { label: 'OK', onPress: () => {} },
          });
          return;
        }
        if (code === 'not_found') {
          showDialog({
            title: 'Gone',
            message: 'This suggestion is no longer available.',
            variant: 'info',
            primaryAction: { label: 'OK', onPress: () => {} },
          });
          onUpdated();
          return;
        }
      }
      Sentry.captureException(e, {
        tags: {
          feature: 'date_suggestion',
          action: 'cancel',
          surface: 'native_chat_card',
        },
        extra: {
          suggestionId: suggestion.id,
          matchId: suggestion.match_id,
          status,
        },
      });
      showDialog({
        title: 'Couldn’t cancel',
        message: 'Please try again in a moment.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    } finally {
      cancelInFlightRef.current = false;
      setCancelBusy(false);
    }
  }, [onUpdated, queryClient, showDialog, status, suggestion.id, suggestion.match_id]);

  const handleShare = async () => {
    if (!current) return;
    const body = buildShareDateText({
      partnerName,
      dateTypeLabel: labelForDateType(plan?.date_type_key ?? current.date_type_key),
      placeLabel: confirmedPlaceLabel,
      timeLabel: confirmedWhenLabel || 'Not decided yet',
    });
    try {
      await Share.share({ title: 'Vibely date', message: body });
    } catch {
      showDialog({
        title: 'Share didn’t open',
        message: 'We couldn’t open the share sheet. Try again.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    }
  };

  const handleMarkComplete = async () => {
    const planId = suggestion.date_plan_id;
    if (!planId) return;
    if (!hasDateStarted) {
      showDialog({
        title: 'Available after the date starts',
        message: 'You can mark the date complete once the scheduled time begins.',
        variant: 'info',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
      return;
    }
    if (currentUserMarkedComplete) {
      showDialog({
        title: 'Already marked',
        message: isMutuallyCompleted
          ? 'This date is already marked complete.'
          : 'Waiting for your match to confirm too.',
        variant: 'info',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
      return;
    }
    setMarkCompleteBusy(true);
    try {
      const result = (await dateSuggestionApply('plan_mark_complete', { plan_id: planId })) as {
        completion_state?: string;
      };
      const mutuallyCompleted = result.completion_state === 'mutually_completed';
      showDialog({
        title: mutuallyCompleted ? 'Date completed' : 'Marked complete',
        message: mutuallyCompleted ? 'Thanks for confirming.' : 'Waiting for your match to confirm too.',
        variant: 'success',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
      onUpdated();
    } catch (e) {
      if (e instanceof DateSuggestionDomainError && e.code === 'date_not_started') {
        showDialog({
          title: 'Available after the date starts',
          message: 'You can mark the date complete once the scheduled time begins.',
          variant: 'info',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
      } else if (e instanceof DateSuggestionDomainError && e.code === 'awaiting_partner_confirm') {
        showDialog({
          title: 'Almost there',
          message: 'Waiting for your match to confirm.',
          variant: 'info',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
      } else {
        showDialog({
          title: 'Couldn’t update',
          message: 'Something went wrong. Try again.',
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
      }
    } finally {
      setMarkCompleteBusy(false);
    }
  };

  if (!current && status !== 'draft') {
    return (
      <>
        <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
          <Text style={{ color: theme.textSecondary, fontSize: 13 }}>Loading suggestion…</Text>
        </View>
        {dialogEl}
      </>
    );
  }

  const staleTerminal = ['declined', 'expired', 'cancelled', 'not_now'].includes(status);
  if (staleTerminal) {
    const summary =
      current != null
        ? `${labelForDateType(current.date_type_key)} · ${formatWhen(current)}`
        : '';
    if (threadUi === 'quiet_stale') {
      return (
        <>
          <View
            style={[
              styles.quietRow,
              { borderColor: theme.border, backgroundColor: 'rgba(255,255,255,0.02)' },
            ]}
          >
            <Text style={[styles.quietText, { color: theme.textSecondary }]} numberOfLines={2}>
              <Text style={{ fontWeight: '600' }}>{STATUS_LABEL[status] ?? status}</Text>
              {summary ? <Text style={{ opacity: 0.75 }}>{` · ${summary}`}</Text> : null}
            </Text>
          </View>
          {dialogEl}
        </>
      );
    }
    return (
      <>
        <View style={[styles.compactCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
          <View style={styles.compactTopRow}>
            <Text style={[styles.compactStatus, { color: theme.textSecondary }]}>
              {STATUS_LABEL[status] ?? status}
            </Text>
            <Pressable
              onPress={() => onOpenComposer({ mode: 'new' })}
              style={({ pressed }) => [styles.compactLinkBtn, pressed && { opacity: 0.85 }]}
            >
              <Text style={[styles.compactLinkText, { color: theme.tint }]}>New suggestion</Text>
            </Pressable>
          </View>
          {summary ? (
            <Text style={[styles.compactSummary, { color: theme.textSecondary }]} numberOfLines={2}>
              {summary}
            </Text>
          ) : null}
        </View>
        {dialogEl}
      </>
    );
  }

  if (status === 'completed') {
    if (threadUi === 'quiet_completed') {
      const when =
        current != null
          ? `${labelForDateType(plan?.date_type_key ?? current.date_type_key)} · ${confirmedWhenLabel}`
          : '';
      return (
        <>
          <View
            style={[
              styles.quietRow,
              { borderColor: theme.border, backgroundColor: 'rgba(255,255,255,0.02)' },
            ]}
          >
            <Ionicons name="checkmark-circle" size={14} color="rgba(34,197,94,0.65)" style={{ marginRight: 6 }} />
            <Text style={[styles.quietText, { color: theme.textSecondary, flex: 1 }]} numberOfLines={2}>
              Date marked complete
              {when ? <Text style={{ opacity: 0.7 }}>{` · ${when}`}</Text> : null}
            </Text>
          </View>
          {dialogEl}
        </>
      );
    }
    return (
      <>
        <View
          style={[
            styles.compactCard,
            { borderColor: 'rgba(34,197,94,0.35)', backgroundColor: 'rgba(34,197,94,0.06)' },
          ]}
        >
          <View style={styles.compactTopRow}>
            <Text style={[styles.compactDoneLabel, { color: theme.textSecondary }]} numberOfLines={1}>
              Date marked complete
            </Text>
            <Pressable
              onPress={() => onOpenComposer({ mode: 'new' })}
              style={({ pressed }) => [styles.compactLinkBtn, pressed && { opacity: 0.85 }]}
            >
              <Text style={[styles.compactLinkText, { color: theme.tint }]}>New</Text>
            </Pressable>
          </View>
        </View>
        {dialogEl}
      </>
    );
  }

  const showCelebration = status === 'accepted';
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
    <>
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
          <Text style={[styles.kicker, { color: theme.textSecondary }]}>Date idea</Text>
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
            <Text style={[styles.lineValue, { color: theme.text }]}>{confirmedWhenLabel}</Text>
          </View>

          {current.schedule_share_enabled && status !== 'accepted' && status !== 'completed' ? (
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
            <Text style={[styles.lineValue, { color: theme.text }]}>
              {status === 'accepted' || status === 'completed' ? confirmedPlaceLabel : placeLine(current)}
            </Text>
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

      {isScheduleShare && current && status !== 'accepted' && status !== 'completed' ? (
        <ScheduleShareOfferedBlocks
          matchId={suggestion.match_id}
          currentUserId={currentUserId}
          offerAuthorId={current.proposed_by}
          otherSideId={
            current.proposed_by === suggestion.proposer_id
              ? suggestion.recipient_id
              : suggestion.proposer_id
          }
          partnerName={partnerName}
          canPick={actionPolicy.canAccept && !acceptBusy}
          onPickSlot={(slotKey) => setPendingSlotKey(slotKey)}
        />
      ) : null}

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

      <ExactTimePinSheet
        visible={pendingSlotKey !== null}
        chosenSlotKey={pendingSlotKey ?? ''}
        isSubmitting={acceptBusy}
        onClose={() => setPendingSlotKey(null)}
        onConfirm={(startsAt, localHour) =>
          pendingSlotKey
            ? handleAcceptWithSlot(pendingSlotKey, startsAt, localHour)
            : Promise.resolve()
        }
      />

      <ChooseSharedBlockSheet
        visible={chooserOpen}
        onClose={() => setChooserOpen(false)}
        offeredBlocks={chooserOfferedBlocks}
        isLoading={accepterOffer.isLoading}
        isError={accepterOffer.isError}
        partnerName={partnerName}
        onContinue={handleChooserContinue}
      />

      <View style={[styles.actions, { borderTopColor: theme.border }]}>
        {actionPolicy.canEditDraft && (
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

        {actionPolicy.canRespondToCurrent && (
          <>
            {actionPolicy.canAccept ? btn('Accept', handleAccept, 'primary', acceptBusy) : null}
            {actionPolicy.canCounter
              ? btn(
                  'Counter',
                  () =>
                    current &&
                    onOpenComposer({
                      mode: 'counter',
                      counter: { suggestionId: suggestion.id, previousRevision: current },
                    }),
                  'secondary'
                )
              : null}
            {actionPolicy.canNotNow ? btn('Not now', handleNotNow) : null}
            {actionPolicy.canDecline ? btn('Decline', handleDecline, 'ghost') : null}
          </>
        )}

        {actionPolicy.canCancel
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
            {hasDateStarted && !currentUserMarkedComplete
              ? btn('Mark complete', handleMarkComplete, 'secondary', markCompleteBusy)
              : null}
            {plan?.status === 'active' && suggestion.date_plan_id
              ? btn('Cancel date', handleCancelPlan, 'ghost', cancelPlanBusy)
              : null}
            {currentUserMarkedComplete && !isMutuallyCompleted ? (
              <View style={styles.completedRow}>
                <Ionicons name="checkmark-circle" size={14} color="#22c55e" />
                <Text style={[styles.completedText, { color: theme.textSecondary }]}>
                  Marked complete. Waiting for {partnerName} to confirm too.
                </Text>
              </View>
            ) : partnerMarkedComplete && !currentUserMarkedComplete && hasDateStarted ? (
              <Text style={[styles.completedText, { color: theme.textSecondary }]}>
                {partnerName} marked this complete. Mark complete when you&apos;re ready.
              </Text>
            ) : null}
          </>
        )}

      </View>
    </View>
    {dialogEl}
    </>
  );
}

const TIME_BLOCK_LABEL: Record<string, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  night: 'Night',
};

function dayLabelNative(slotDate: string): string {
  try {
    return format(new Date(`${slotDate}T00:00:00`), 'EEE MMM d');
  } catch {
    return slotDate;
  }
}

function ScheduleShareOfferedBlocks({
  matchId,
  currentUserId,
  offerAuthorId,
  otherSideId,
  partnerName,
  canPick,
  onPickSlot,
}: {
  matchId: string;
  currentUserId: string;
  offerAuthorId: string;
  otherSideId: string;
  partnerName: string;
  canPick: boolean;
  onPickSlot: (slotKey: string) => void;
}) {
  const theme = Colors[useColorScheme()];
  const isOwnOffer = offerAuthorId === currentUserId;

  // Chips: whatever the latest offer-author shared (works for either side via
  // get_shared_schedule_for_date_planning's "viewer OR subject" check).
  const chipsOffer = useSharedPartnerSchedule(matchId, offerAuthorId, true);
  // Mutual: the OTHER side's offered blocks (if they shared in any prior revision).
  const otherOffer = useSharedPartnerSchedule(matchId, otherSideId, true);

  const chipsSlots = useMemo(() => chipsOffer.data ?? [], [chipsOffer.data]);
  const chipsSlotKeys = useMemo(() => chipsSlots.map((s) => s.slot_key), [chipsSlots]);
  const otherSlotKeys = useMemo(
    () => (otherOffer.data ?? []).map((s) => s.slot_key),
    [otherOffer.data],
  );
  const mutualSet = useMemo(
    () => new Set(intersectSlotKeys(chipsSlotKeys, otherSlotKeys)),
    [chipsSlotKeys, otherSlotKeys],
  );

  const grouped = useMemo(() => {
    const byDay = new Map<string, Array<{ slot_key: string; time_block: string; mutual: boolean }>>();
    for (const slot of chipsSlots) {
      const mutual = mutualSet.has(slot.slot_key);
      const arr = byDay.get(slot.slot_date) ?? [];
      arr.push({ slot_key: slot.slot_key, time_block: slot.time_block, mutual });
      byDay.set(slot.slot_date, arr);
    }
    const blockOrder: Record<string, number> = { morning: 0, afternoon: 1, evening: 2, night: 3 };
    for (const arr of byDay.values()) {
      arr.sort((a, b) => (blockOrder[a.time_block] ?? 9) - (blockOrder[b.time_block] ?? 9));
    }
    return Array.from(byDay.entries()).sort(([dateA, slotsA], [dateB, slotsB]) => {
      const aMutual = slotsA.some((s) => s.mutual) ? 0 : 1;
      const bMutual = slotsB.some((s) => s.mutual) ? 0 : 1;
      if (aMutual !== bMutual) return aMutual - bMutual;
      return dateA.localeCompare(dateB);
    });
  }, [chipsSlots, mutualSet]);

  if (chipsOffer.isLoading) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm }}>
        <Text style={{ color: theme.textSecondary, fontSize: 12 }}>Loading offered blocks…</Text>
      </View>
    );
  }
  if (chipsOffer.isError) {
    return (
      <Text style={{ color: theme.textSecondary, fontSize: 12, marginTop: spacing.sm }}>
        {isOwnOffer
          ? 'Your share window has expired. Share again to keep planning.'
          : 'Schedule access expired — share again to plan.'}
      </Text>
    );
  }
  if (chipsSlots.length === 0) {
    return (
      <View
        style={{
          marginTop: spacing.sm,
          padding: spacing.sm,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.muted,
        }}
      >
        <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
          {isOwnOffer
            ? 'No currently-visible blocks. (Some may have changed since you shared.)'
            : `${partnerName} hasn't shared open blocks that align right now.`}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
      <Text style={{ color: theme.textSecondary, fontSize: 11 }}>
        {isOwnOffer
          ? `You shared these open blocks. Waiting for ${partnerName} to pick or share back.`
          : `${partnerName} shared these open blocks. Tap to pick one or share yours back.`}
      </Text>
      {grouped.map(([dayDate, slots]) => (
        <View key={dayDate} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          <Text style={{ color: theme.textSecondary, fontSize: 11, width: 78 }}>
            {dayLabelNative(dayDate)}
          </Text>
          {slots.map((slot) => {
            const canTap = !isOwnOffer && canPick;
            return (
              <Pressable
                key={slot.slot_key}
                disabled={!canTap}
                onPress={() => canTap && onPickSlot(slot.slot_key)}
                style={({ pressed }) => [
                  {
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: slot.mutual ? 'rgba(245,158,11,0.6)' : 'rgba(34,211,238,0.5)',
                    backgroundColor: slot.mutual ? 'rgba(245,158,11,0.15)' : 'rgba(34,211,238,0.1)',
                    opacity: pressed && canTap ? 0.85 : 1,
                  },
                ]}
              >
                <Text
                  style={{
                    fontSize: 11,
                    color: slot.mutual ? '#b45309' : '#0e7490',
                    fontWeight: '600',
                  }}
                >
                  {TIME_BLOCK_LABEL[slot.time_block] ?? slot.time_block}
                  {slot.mutual ? ' · Both open' : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
      <Text style={{ color: theme.textSecondary, fontSize: 10, fontStyle: 'italic' }}>
        Only selected open blocks are shared. Visible for 48 hours.
      </Text>
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
  quietRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    maxWidth: '100%',
  },
  quietText: { fontSize: 11, lineHeight: 15, flex: 1 },
  compactCard: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    maxWidth: '100%',
  },
  compactTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  compactStatus: { fontSize: 12, fontWeight: '700' },
  compactDoneLabel: { fontSize: 12, flex: 1, fontWeight: '600' },
  compactSummary: { fontSize: 11, marginTop: 4, lineHeight: 15 },
  compactLinkBtn: { paddingVertical: 4, paddingHorizontal: 4 },
  compactLinkText: { fontSize: 10, fontWeight: '700' },
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.sm,
    maxWidth: '100%',
  },
  celebrationRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.xs + 2 },
  celebrationTitle: { fontSize: 14, fontWeight: '700' },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    flexWrap: 'wrap',
    rowGap: 4,
    marginBottom: spacing.xs + 2,
  },
  headerTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, minWidth: 0 },
  kicker: { fontSize: 10, fontWeight: '600', letterSpacing: 0.2 },
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
  lineLabel: { fontSize: 11, fontWeight: '600', letterSpacing: 0.1 },
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
