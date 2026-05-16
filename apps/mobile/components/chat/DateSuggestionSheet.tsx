/**
 * Multi-step date suggestion composer (parity with web DateSuggestionComposer).
 * Uses KeyboardAwareBottomSheetModal for text/keyboard safety.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { startOfDay } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius, fonts, shadows } from '@/constants/theme';
import { VibelyText } from '@/components/ui';
import { KeyboardAwareBottomSheetModal } from '@/components/keyboard/KeyboardAwareBottomSheetModal';
import {
  DATE_TYPE_OPTIONS,
  TIME_CHOICE_OPTIONS,
  PLACE_MODE_OPTIONS,
  OPTIONAL_MESSAGE_VARIANTS,
  type TimeChoiceKey,
  type PlaceModeKey,
} from '@/lib/dateSuggestionCopy';
import { slotDateBlockToStartsAt } from '@/lib/dateSuggestionTime';
import { useSharedPartnerSchedule } from '@/lib/useSharedPartnerSchedule';
import { dateSuggestionApply, DateSuggestionDomainError } from '@/lib/dateSuggestionApply';
import type { DateSuggestionRevisionRow } from '@/lib/useDateSuggestionData';
import { SCHEDULE_QUERY_KEY } from '@/lib/useSchedule';
import { ScheduleSharePicker } from '@/components/schedule/ScheduleSharePicker';
import {
  CLIP_DATE_COMPOSER_PILL,
  CLIP_DATE_COMPOSER_SUBCOPY,
  type DateComposerLaunchSource,
} from '../../../../shared/dateSuggestions/dateComposerLaunch';
import { useVibelyDialog } from '@/components/VibelyDialog';
import { formatProposedDateTimeSummary } from '../../../../shared/dateSuggestions/formatProposedDateTimeSummary';

const STEPS = ['Type', 'When', 'Place', 'Message', 'Review'] as const;
const MINUTE_STEP = 5;
const MINUTE_OPTIONS = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);
const HOUR12_OPTIONS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export type WizardState = {
  dateTypeKey: string;
  customDateTypeText: string;
  timeChoiceKey: TimeChoiceKey;
  placeModeKey: PlaceModeKey;
  venueText: string;
  optionalMessage: string;
  variantIndex: number;
  scheduleShareEnabled: boolean;
  pickStartIso: string | null;
  pickEndIso: string | null;
  pickSlotDate: string | null;
  pickTimeBlock: string | null;
  /** Slots the user selected to share when timeChoiceKey === 'share_schedule'. */
  selectedSlotKeys: string[];
};

const defaultWizard = (): WizardState => ({
  dateTypeKey: 'coffee',
  customDateTypeText: '',
  timeChoiceKey: 'tomorrow',
  placeModeKey: 'decide_together',
  venueText: '',
  optionalMessage: OPTIONAL_MESSAGE_VARIANTS.coffee[0],
  variantIndex: 0,
  scheduleShareEnabled: false,
  pickStartIso: null,
  pickEndIso: null,
  pickSlotDate: null,
  pickTimeBlock: null,
  selectedSlotKeys: [],
});

const DATE_TYPE_KEYS = new Set<string>(DATE_TYPE_OPTIONS.map((o) => o.key));

function wallTimePartsFromDate(d: Date): { hour12: number; minute: number; ampm: 'AM' | 'PM' } {
  const h = d.getHours();
  const ampm: 'AM' | 'PM' = h >= 12 ? 'PM' : 'AM';
  let hour12 = h % 12;
  if (hour12 === 0) hour12 = 12;
  const minute = Math.min(55, Math.round(d.getMinutes() / MINUTE_STEP) * MINUTE_STEP);
  return { hour12, minute, ampm };
}

function mergeDayAndWallTime(day: Date, hour12: number, minute: number, ampm: 'AM' | 'PM'): Date {
  const out = startOfDay(day);
  let h24 = hour12 % 12;
  if (ampm === 'PM' && hour12 !== 12) h24 += 12;
  if (ampm === 'AM' && hour12 === 12) h24 = 0;
  out.setHours(h24, minute, 0, 0);
  return out;
}

function addLocalDays(day: Date, amount: number): Date {
  const out = startOfDay(day);
  out.setDate(out.getDate() + amount);
  return out;
}

function startOfLocalMonth(day: Date): Date {
  return startOfDay(new Date(day.getFullYear(), day.getMonth(), 1));
}

function shiftLocalMonth(day: Date, amount: number): Date {
  return startOfDay(new Date(day.getFullYear(), day.getMonth() + amount, 1));
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isBeforeLocalDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() < startOfDay(b).getTime();
}

function calendarDaysForMonth(month: Date): Date[] {
  const first = startOfLocalMonth(month);
  const gridStart = addLocalDays(first, -first.getDay());
  return Array.from({ length: 42 }, (_, i) => addLocalDays(gridStart, i));
}

function formatCalendarMonth(month: Date): string {
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(month);
}

function formatCalendarDayLabel(day: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(day);
}

function isUsableExactPick(iso: string | null | undefined, nowMs = Date.now()): boolean {
  if (!iso) return false;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) && ms > nowMs;
}

function nextDefaultExactPick(now = new Date()): Date {
  const out = new Date(now);
  out.setSeconds(0, 0);
  const nextMinute = Math.ceil(out.getMinutes() / MINUTE_STEP) * MINUTE_STEP;
  if (nextMinute >= 60) {
    out.setHours(out.getHours() + 1, 0, 0, 0);
  } else {
    out.setMinutes(nextMinute, 0, 0);
  }
  if (out.getTime() <= now.getTime()) {
    out.setMinutes(out.getMinutes() + MINUTE_STEP);
  }
  return out;
}

function resolveDateTypeValue(w: Pick<WizardState, 'dateTypeKey' | 'customDateTypeText'>): string {
  if (w.dateTypeKey !== 'custom') return w.dateTypeKey;
  return w.customDateTypeText.trim();
}

function buildRevision(w: WizardState, options?: { counterSharePick?: boolean }) {
  const counterSharePick = options?.counterSharePick === true;
  const share = w.timeChoiceKey === 'share_schedule' && !counterSharePick;
  let startsAt: string | null | undefined = null;
  let endsAt: string | null | undefined = null;
  let timeBlock: string | null | undefined = null;

  if (w.timeChoiceKey === 'pick_a_time' && w.pickStartIso) {
    startsAt = w.pickStartIso;
    endsAt = w.pickEndIso || w.pickStartIso;
  }
  if ((share || counterSharePick) && w.pickSlotDate && w.pickTimeBlock) {
    startsAt = slotDateBlockToStartsAt(w.pickSlotDate, w.pickTimeBlock);
    endsAt = null;
    timeBlock = w.pickTimeBlock;
  }

  const revision: Record<string, unknown> = {
    date_type_key: resolveDateTypeValue(w),
    time_choice_key: counterSharePick ? 'pick_a_time' : w.timeChoiceKey,
    place_mode_key: w.placeModeKey,
    venue_text: w.placeModeKey === 'custom_venue' ? (w.venueText.trim() || null) : null,
    optional_message: w.optionalMessage.trim() || null,
    schedule_share_enabled: share,
    starts_at: startsAt ?? null,
    ends_at: endsAt ?? null,
    time_block: timeBlock ?? null,
  };
  if (share && w.selectedSlotKeys.length > 0) {
    revision.selected_slot_keys = w.selectedSlotKeys;
  }
  return revision;
}

type CounterCtx = {
  suggestionId: string;
  previousRevision: DateSuggestionRevisionRow;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  matchId: string;
  currentUserId: string;
  partnerUserId: string;
  partnerName: string;
  draftSuggestionId?: string | null;
  draftFromParent?: { wizard?: Partial<WizardState>; step?: number } | null;
  counterContext?: CounterCtx | null;
  /** Client-only; does not change persisted suggestion payload. */
  launchSource?: DateComposerLaunchSource;
  onSuccess?: () => void;
};

export function DateSuggestionSheet({
  visible,
  onClose,
  matchId,
  currentUserId,
  partnerUserId,
  partnerName,
  draftSuggestionId,
  draftFromParent,
  counterContext,
  launchSource = 'default',
  onSuccess,
}: Props) {
  const theme = Colors[useColorScheme()];
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [w, setW] = useState<WizardState>(defaultWizard);
  const [saving, setSaving] = useState(false);
  const submitInFlightRef = useRef(false);
  const [draftId, setDraftId] = useState<string | null>(draftSuggestionId ?? null);

  const shareEnabled = w.timeChoiceKey === 'share_schedule';
  const { data: partnerSlots = [], isLoading: slotsLoading } = useSharedPartnerSchedule(
    matchId,
    partnerUserId,
    visible && shareEnabled && !!counterContext
  );

  const [inlinePickOpen, setInlinePickOpen] = useState(false);
  const [inlinePickPhase, setInlinePickPhase] = useState<'date' | 'time'>('date');
  const [inlinePickMonth, setInlinePickMonth] = useState(() => startOfLocalMonth(new Date()));
  const [inlinePickDay, setInlinePickDay] = useState(() => startOfDay(new Date()));
  const [inlinePickHour12, setInlinePickHour12] = useState(() => wallTimePartsFromDate(new Date()).hour12);
  const [inlinePickMinute, setInlinePickMinute] = useState(() => wallTimePartsFromDate(new Date()).minute);
  const [inlinePickAmPm, setInlinePickAmPm] = useState<'AM' | 'PM'>(() => wallTimePartsFromDate(new Date()).ampm);
  const { show: showDialog, dialog: dialogEl } = useVibelyDialog();

  const resetInlinePickUi = useCallback(() => {
    setInlinePickOpen(false);
    setInlinePickPhase('date');
  }, []);

  useEffect(() => {
    resetInlinePickUi();
    if (!visible) return;
    if (counterContext) {
      const r = counterContext.previousRevision;
      const incomingType = (r.date_type_key ?? '').trim();
      const hasKnownType = incomingType.length > 0 && DATE_TYPE_KEYS.has(incomingType);
      setW({
        dateTypeKey: hasKnownType ? incomingType : 'custom',
        customDateTypeText: hasKnownType ? '' : incomingType,
        timeChoiceKey: (r.time_choice_key as TimeChoiceKey) || 'tomorrow',
        placeModeKey: (r.place_mode_key as PlaceModeKey) || 'decide_together',
        venueText: r.venue_text || '',
        optionalMessage: r.optional_message || '',
        variantIndex: 0,
        scheduleShareEnabled: r.schedule_share_enabled,
        pickStartIso: r.starts_at,
        pickEndIso: r.ends_at,
        pickSlotDate: null,
        pickTimeBlock: r.time_block,
        selectedSlotKeys: [],
      });
      setStep(0);
      setDraftId(null);
      return;
    }
    if (draftFromParent?.wizard) {
      setW(() => {
        const next = { ...defaultWizard(), ...draftFromParent.wizard };
        const incomingType = typeof next.dateTypeKey === 'string' ? next.dateTypeKey.trim() : '';
        const incomingCustom = typeof next.customDateTypeText === 'string' ? next.customDateTypeText : '';
        if (!incomingType) return { ...next, dateTypeKey: 'coffee', customDateTypeText: '' };
        if (DATE_TYPE_KEYS.has(incomingType)) return { ...next, dateTypeKey: incomingType };
        return { ...next, dateTypeKey: 'custom', customDateTypeText: incomingCustom || incomingType };
      });
      if (typeof draftFromParent.step === 'number') {
        setStep(Math.min(4, Math.max(0, draftFromParent.step)));
      }
      setDraftId(draftSuggestionId ?? null);
      return;
    }
    setW(defaultWizard());
    setStep(0);
    setDraftId(draftSuggestionId ?? null);
  }, [visible, counterContext, draftSuggestionId, draftFromParent, resetInlinePickUi]);

  const openInlinePickFlow = useCallback(() => {
    const fallback = nextDefaultExactPick();
    const parsed = w.pickStartIso ? new Date(w.pickStartIso) : fallback;
    const parsedMs = parsed.getTime();
    const base = Number.isFinite(parsedMs) && parsedMs > Date.now() ? parsed : fallback;
    const day = startOfDay(base);
    const wall = wallTimePartsFromDate(base);
    setInlinePickDay(day);
    setInlinePickMonth(startOfLocalMonth(day));
    setInlinePickHour12(wall.hour12);
    setInlinePickMinute(wall.minute);
    setInlinePickAmPm(wall.ampm);
    setInlinePickPhase('date');
    setInlinePickOpen(true);
  }, [w.pickStartIso]);

  const refreshOwnSchedule = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: SCHEDULE_QUERY_KEY(currentUserId) });
  }, [currentUserId, queryClient]);

  useEffect(() => {
    if (w.timeChoiceKey !== 'pick_a_time') setInlinePickOpen(false);
  }, [w.timeChoiceKey]);

  const submitErrorMessage = (error: unknown): string => {
    if (!(error instanceof DateSuggestionDomainError)) {
      return counterContext ? 'We couldn’t send your counter. Try again.' : 'We couldn’t send your suggestion. Try again.';
    }
    switch (error.code) {
      case 'invalid_status':
        return 'This date suggestion has already changed. Refresh the chat and try again.';
      case 'cannot_counter_own_revision':
      case 'author_cannot_accept_own_revision':
        return 'They need to respond before you can change it again.';
      case 'forbidden':
        return 'This date suggestion is no longer available to you.';
      case 'not_found':
      case 'no_revision':
        return 'This date suggestion is no longer available.';
      case 'tier_capability_disabled':
        return 'This date option is not available for your account right now.';
      case 'revision_fields_required':
        return 'Pick a type, time, and place before sending.';
      case 'selected_slots_required':
        return 'Pick at least one open block to share.';
      case 'selected_slot_not_open':
        return 'One of those blocks is no longer open. Review your selection and try again.';
      case 'invalid_selected_slot_keys':
        return 'Your schedule selection could not be read. Pick your blocks again.';
      default:
        return counterContext ? 'We couldn’t send your counter. Try again.' : 'We couldn’t send your suggestion. Try again.';
    }
  };

  const submitProposal = async () => {
    if (submitInFlightRef.current || saving) return;
    if (w.timeChoiceKey === 'pick_a_time' && !isUsableExactPick(w.pickStartIso)) {
      setStep(1);
      openInlinePickFlow();
      showDialog({
        title: 'Pick a new time',
        message: 'That date and time has passed. Choose a future time before sending.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
      return;
    }
    submitInFlightRef.current = true;
    setSaving(true);
    try {
      const revision = buildRevision(w, {
        counterSharePick: Boolean(counterContext && w.timeChoiceKey === 'share_schedule'),
      });
      if (counterContext) {
        await dateSuggestionApply('counter', {
          suggestion_id: counterContext.suggestionId,
          revision,
        });
      } else {
        const payload: Record<string, unknown> = { revision };
        if (draftId) payload.suggestion_id = draftId;
        else payload.match_id = matchId;
        await dateSuggestionApply('send_proposal', payload);
      }
      onSuccess?.();
      onClose();
    } catch (e) {
      if (e instanceof DateSuggestionDomainError && e.code === 'active_suggestion_exists') {
        if (e.suggestionId) setDraftId(e.suggestionId);
        onSuccess?.();
        onClose();
        showDialog({
          title: 'Already planning something',
          message: 'You already have an active date suggestion in this chat.',
          variant: 'info',
          primaryAction: { label: 'Got it', onPress: () => {} },
        });
      } else {
        if (
          e instanceof DateSuggestionDomainError &&
          (e.code === 'selected_slot_not_open' || e.code === 'invalid_selected_slot_keys')
        ) {
          refreshOwnSchedule();
        }
        if (!(e instanceof DateSuggestionDomainError)) {
          console.error(e);
        }
        showDialog({
          title: 'Couldn’t send',
          message: submitErrorMessage(e),
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
      }
    } finally {
      submitInFlightRef.current = false;
      setSaving(false);
    }
  };

  const canNext = useCallback(() => {
    if (step === 0 && w.dateTypeKey === 'custom' && !w.customDateTypeText.trim()) return false;
    if (step === 1 && w.timeChoiceKey === 'pick_a_time' && !isUsableExactPick(w.pickStartIso)) return false;
    if (step === 1 && shareEnabled && counterContext && (!w.pickSlotDate || !w.pickTimeBlock)) {
      return false;
    }
    if (step === 1 && shareEnabled && !counterContext && w.selectedSlotKeys.length === 0) {
      return false;
    }
    if (step === 2 && w.placeModeKey === 'custom_venue' && !w.venueText.trim()) return false;
    return true;
  }, [step, w, shareEnabled, counterContext]);

  const todayStart = startOfDay(new Date());
  const inlinePickCandidate = mergeDayAndWallTime(
    inlinePickDay,
    inlinePickHour12,
    inlinePickMinute,
    inlinePickAmPm,
  );
  const inlinePickTimeIsPast = inlinePickCandidate.getTime() <= Date.now();
  const inlinePreviewIso = inlinePickCandidate.toISOString();
  const previousMonthDisabled = inlinePickMonth.getTime() <= startOfLocalMonth(todayStart).getTime();

  const stepContent = (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.scrollContent}
    >
      <View style={styles.stepDots}>
        {STEPS.map((s, i) => (
          <Text
            key={s}
            style={[
              styles.stepDot,
              { color: i === step ? theme.tint : theme.textSecondary, fontWeight: i === step ? '700' : '400' },
            ]}
          >
            {s}
            {i < STEPS.length - 1 ? ' · ' : ''}
          </Text>
        ))}
      </View>

      {step === 0 && (
        <View style={{ gap: spacing.sm }}>
          <View style={styles.grid2}>
            {DATE_TYPE_OPTIONS.map((o) => (
              <Pressable
                key={o.key}
                onPress={() => {
                  const v = OPTIONAL_MESSAGE_VARIANTS[o.key] || OPTIONAL_MESSAGE_VARIANTS.custom;
                  setW((p) => ({
                    ...p,
                    dateTypeKey: o.key,
                    variantIndex: 0,
                    optionalMessage: v[0],
                  }));
                }}
                style={[
                  styles.option,
                  { borderColor: w.dateTypeKey === o.key ? theme.tint : theme.border, backgroundColor: theme.surfaceSubtle },
                ]}
              >
                <Text style={{ color: theme.text, fontSize: 14 }}>{o.label}</Text>
              </Pressable>
            ))}
          </View>
          {w.dateTypeKey === 'custom' ? (
            <View style={{ gap: spacing.xs }}>
              <TextInput
                value={w.customDateTypeText}
                onChangeText={(t) => setW((p) => ({ ...p, customDateTypeText: t }))}
                placeholder="What do you have in mind?"
                placeholderTextColor={theme.mutedForeground}
                style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
              />
              {!w.customDateTypeText.trim() ? (
                <Text style={[styles.hint, { color: theme.textSecondary, marginTop: 0 }]}>
                  Add a custom type to continue.
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      )}

      {step === 1 && (
        <View style={styles.whenStep}>
          {TIME_CHOICE_OPTIONS.map((o) => {
            const selected = w.timeChoiceKey === o.key;
            const isPickTime = o.key === 'pick_a_time';
            const label =
              counterContext && o.key === 'share_schedule'
                ? 'Pick from shared availability'
                : o.label;
            return (
              <Pressable
                key={o.key}
                onPress={() =>
                  setW((p) => ({
                    ...p,
                    timeChoiceKey: o.key,
                    scheduleShareEnabled: o.key === 'share_schedule',
                    ...(o.key !== 'pick_a_time'
                      ? { pickStartIso: null, pickEndIso: null }
                      : {}),
                  }))
                }
                style={({ pressed }) => [
                  styles.whenOption,
                  {
                    borderColor: selected ? theme.tint : theme.border,
                    backgroundColor: selected
                      ? isPickTime
                        ? 'rgba(139,92,246,0.14)'
                        : theme.surfaceSubtle
                      : theme.surfaceSubtle,
                    borderWidth: selected ? 2 : 1,
                    opacity: pressed ? 0.92 : 1,
                  },
                ]}
              >
                {selected ? (
                  <View style={[styles.whenOptionAccent, { backgroundColor: theme.tint }]} />
                ) : null}
                <Text
                  style={[
                    styles.whenOptionLabel,
                    { color: selected ? theme.text : theme.textSecondary },
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
          {w.timeChoiceKey === 'pick_a_time' && (
            <View style={styles.pickTimeBlock}>
              <View style={[styles.whenSectionDivider, { backgroundColor: theme.border }]} />
              <View
                style={[
                  styles.pickSummaryCard,
                  { borderColor: theme.border, backgroundColor: theme.surfaceSubtle },
                ]}
              >
                <Text style={[styles.iosPickCardValue, { color: theme.text }]}>
                  {w.pickStartIso
                    ? formatProposedDateTimeSummary(w.pickStartIso)
                    : 'Choose a date, then a time.'}
                </Text>
                <Pressable
                  onPress={openInlinePickFlow}
                  accessibilityRole="button"
                  accessibilityLabel={w.pickStartIso ? 'Change date and time' : 'Choose date and time'}
                  style={({ pressed }) => [
                    styles.iosPickBtn,
                    {
                      borderColor: 'rgba(139,92,246,0.55)',
                      backgroundColor: 'rgba(139,92,246,0.2)',
                      opacity: pressed ? 0.9 : 1,
                      marginTop: spacing.sm,
                    },
                  ]}
                >
                  <Ionicons name="calendar-outline" size={16} color={theme.neonViolet} />
                  <Text style={[styles.iosPickBtnText, { color: theme.text }]}>
                    {w.pickStartIso ? 'Change date & time' : 'Choose date & time'}
                  </Text>
                </Pressable>
                {inlinePickOpen ? (
                  <View
                    style={[
                      styles.inlinePickPanel,
                      { borderColor: theme.border, backgroundColor: theme.surface },
                    ]}
                  >
                    <Text style={[styles.inlinePickTitle, { color: theme.text }]}>
                      {inlinePickPhase === 'date' ? 'Pick a date' : 'Pick a time'}
                    </Text>
                    <Text style={[styles.inlinePickPreview, { color: theme.textSecondary }]}>
                      {formatProposedDateTimeSummary(inlinePreviewIso)}
                    </Text>

                    {inlinePickPhase === 'date' ? (
                      <View style={styles.inlineCalendar}>
                        <View style={styles.inlineCalendarHeader}>
                          <Pressable
                            onPress={() => setInlinePickMonth((month) => shiftLocalMonth(month, -1))}
                            disabled={previousMonthDisabled}
                            accessibilityRole="button"
                            accessibilityLabel="Previous month"
                            accessibilityState={{ disabled: previousMonthDisabled }}
                            style={({ pressed }) => [
                              styles.inlineCalendarNav,
                              {
                                backgroundColor: theme.muted,
                                opacity: previousMonthDisabled ? 0.35 : pressed ? 0.82 : 1,
                              },
                            ]}
                          >
                            <Ionicons name="chevron-back" size={18} color={theme.text} />
                          </Pressable>
                          <Text style={[styles.inlineCalendarMonth, { color: theme.text }]}>
                            {formatCalendarMonth(inlinePickMonth)}
                          </Text>
                          <Pressable
                            onPress={() => setInlinePickMonth((month) => shiftLocalMonth(month, 1))}
                            accessibilityRole="button"
                            accessibilityLabel="Next month"
                            style={({ pressed }) => [
                              styles.inlineCalendarNav,
                              { backgroundColor: theme.muted, opacity: pressed ? 0.82 : 1 },
                            ]}
                          >
                            <Ionicons name="chevron-forward" size={18} color={theme.text} />
                          </Pressable>
                        </View>
                        <View style={styles.inlineWeekRow}>
                          {WEEKDAY_LABELS.map((label) => (
                            <Text key={label} style={[styles.inlineWeekLabel, { color: theme.textSecondary }]}>
                              {label}
                            </Text>
                          ))}
                        </View>
                        <View style={styles.inlineDayGrid}>
                          {calendarDaysForMonth(inlinePickMonth).map((day) => {
                            const disabled = isBeforeLocalDay(day, todayStart);
                            const selected = sameLocalDay(day, inlinePickDay);
                            const currentMonth = day.getMonth() === inlinePickMonth.getMonth();
                            return (
                              <Pressable
                                key={day.toISOString()}
                                disabled={disabled}
                                accessibilityRole="button"
                                accessibilityLabel={`Pick ${formatCalendarDayLabel(day)}`}
                                accessibilityState={{ disabled, selected }}
                                onPress={() => {
                                  const nextDay = startOfDay(day);
                                  setInlinePickDay(nextDay);
                                  setInlinePickMonth(startOfLocalMonth(nextDay));
                                  setInlinePickPhase('time');
                                }}
                                style={({ pressed }) => [
                                  styles.inlineDayCell,
                                  {
                                    backgroundColor: selected ? theme.tint : 'transparent',
                                    borderColor: selected ? theme.tint : theme.border,
                                    opacity: disabled ? 0.25 : pressed ? 0.75 : currentMonth ? 1 : 0.45,
                                  },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.inlineDayText,
                                    { color: selected ? theme.primaryForeground : theme.text },
                                  ]}
                                >
                                  {day.getDate()}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                        <View style={styles.inlinePickActions}>
                          <Pressable
                            onPress={() => setInlinePickOpen(false)}
                            style={({ pressed }) => [
                              styles.inlinePickAction,
                              { backgroundColor: theme.muted, opacity: pressed ? 0.9 : 1 },
                            ]}
                          >
                            <Text style={[styles.inlinePickActionText, { color: theme.text }]}>Cancel</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => setInlinePickPhase('time')}
                            style={({ pressed }) => [
                              styles.inlinePickAction,
                              { backgroundColor: theme.tint, opacity: pressed ? 0.9 : 1 },
                            ]}
                          >
                            <Text style={[styles.inlinePickActionText, { color: theme.primaryForeground }]}>Next</Text>
                          </Pressable>
                        </View>
                      </View>
                    ) : (
                      <View style={styles.inlineTimePanel}>
                        <Pressable
                          onPress={() => setInlinePickPhase('date')}
                          accessibilityRole="button"
                          accessibilityLabel="Change date"
                          style={({ pressed }) => [
                            styles.changeDateButton,
                            { borderColor: theme.border, opacity: pressed ? 0.8 : 1 },
                          ]}
                        >
                          <Ionicons name="calendar-outline" size={15} color={theme.tint} />
                          <Text style={[styles.changeDateText, { color: theme.tint }]}>Change date</Text>
                        </Pressable>

                        <View style={styles.timeGroup}>
                          <Text style={[styles.timeGroupLabel, { color: theme.textSecondary }]}>Hour</Text>
                          <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.timeChoiceRow}
                          >
                            {HOUR12_OPTIONS.map((hour) => {
                              const selected = inlinePickHour12 === hour;
                              return (
                                <Pressable
                                  key={`hour-${hour}`}
                                  onPress={() => setInlinePickHour12(hour)}
                                  style={({ pressed }) => [
                                    styles.timeChoiceChip,
                                    {
                                      borderColor: selected ? theme.tint : theme.border,
                                      backgroundColor: selected ? 'rgba(139,92,246,0.22)' : theme.surfaceSubtle,
                                      opacity: pressed ? 0.82 : 1,
                                    },
                                  ]}
                                >
                                  <Text style={[styles.timeChoiceText, { color: theme.text }]}>{hour}</Text>
                                </Pressable>
                              );
                            })}
                          </ScrollView>
                        </View>

                        <View style={styles.timeGroup}>
                          <Text style={[styles.timeGroupLabel, { color: theme.textSecondary }]}>Minute</Text>
                          <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.timeChoiceRow}
                          >
                            {MINUTE_OPTIONS.map((minute) => {
                              const selected = inlinePickMinute === minute;
                              return (
                                <Pressable
                                  key={`minute-${minute}`}
                                  onPress={() => setInlinePickMinute(minute)}
                                  style={({ pressed }) => [
                                    styles.timeChoiceChip,
                                    {
                                      borderColor: selected ? theme.tint : theme.border,
                                      backgroundColor: selected ? 'rgba(139,92,246,0.22)' : theme.surfaceSubtle,
                                      opacity: pressed ? 0.82 : 1,
                                    },
                                  ]}
                                >
                                  <Text style={[styles.timeChoiceText, { color: theme.text }]}>
                                    {minute.toString().padStart(2, '0')}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </ScrollView>
                        </View>

                        <View style={styles.timeGroup}>
                          <Text style={[styles.timeGroupLabel, { color: theme.textSecondary }]}>Period</Text>
                          <View style={styles.periodRow}>
                            {(['AM', 'PM'] as const).map((period) => {
                              const selected = inlinePickAmPm === period;
                              return (
                                <Pressable
                                  key={period}
                                  onPress={() => setInlinePickAmPm(period)}
                                  style={({ pressed }) => [
                                    styles.periodChip,
                                    {
                                      borderColor: selected ? theme.tint : theme.border,
                                      backgroundColor: selected ? 'rgba(139,92,246,0.22)' : theme.surfaceSubtle,
                                      opacity: pressed ? 0.82 : 1,
                                    },
                                  ]}
                                >
                                  <Text style={[styles.timeChoiceText, { color: theme.text }]}>{period}</Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        </View>
                        {inlinePickTimeIsPast ? (
                          <Text style={[styles.inlinePickWarning, { color: theme.danger }]}>
                            Pick a future time to continue.
                          </Text>
                        ) : null}

                        <View style={styles.inlinePickActions}>
                          <Pressable
                            onPress={() => setInlinePickOpen(false)}
                            style={({ pressed }) => [
                              styles.inlinePickAction,
                              { backgroundColor: theme.muted, opacity: pressed ? 0.9 : 1 },
                            ]}
                          >
                            <Text style={[styles.inlinePickActionText, { color: theme.text }]}>Cancel</Text>
                          </Pressable>
                          <Pressable
                            disabled={inlinePickTimeIsPast}
                            accessibilityRole="button"
                            accessibilityState={{ disabled: inlinePickTimeIsPast }}
                            onPress={() => {
                              if (inlinePickCandidate.getTime() <= Date.now()) {
                                showDialog({
                                  title: 'Pick a future time',
                                  message: 'That time has passed. Choose a future time to continue.',
                                  variant: 'warning',
                                  primaryAction: { label: 'OK', onPress: () => {} },
                                });
                                return;
                              }
                              const exactPickIso = inlinePickCandidate.toISOString();
                              setW((p) => ({
                                ...p,
                                pickStartIso: exactPickIso,
                                pickEndIso: exactPickIso,
                              }));
                              setInlinePickOpen(false);
                              setInlinePickPhase('date');
                            }}
                            style={({ pressed }) => [
                              styles.inlinePickAction,
                              {
                                backgroundColor: inlinePickTimeIsPast ? theme.muted : theme.tint,
                                opacity: inlinePickTimeIsPast ? 0.55 : pressed ? 0.9 : 1,
                              },
                            ]}
                          >
                            <Text style={[styles.inlinePickActionText, { color: theme.primaryForeground }]}>Save</Text>
                          </Pressable>
                        </View>
                      </View>
                    )}
                  </View>
                ) : null}
              </View>
            </View>
          )}
          {shareEnabled && !counterContext && (
            <View style={{ gap: spacing.xs }}>
              <Text style={[styles.hint, { color: theme.textSecondary }]}>
                Choose the open blocks you want to share with {partnerName}. Only selected open blocks
                are shared. Busy/private and unselected times are never shown. Visible for 48 hours.
              </Text>
              <ScheduleSharePicker
                initialSelection={w.selectedSlotKeys}
                onSelectionChange={(keys) =>
                  setW((p) => ({ ...p, selectedSlotKeys: keys }))
                }
              />
            </View>
          )}
          {shareEnabled && counterContext && (
            <View style={{ gap: spacing.sm }}>
              <Text style={[styles.hint, { color: theme.textSecondary }]}>
                Pick a slot that fits their shared availability (next 14 days). This sends a concrete counter time, not a new schedule share.
              </Text>
              {slotsLoading ? (
                <ActivityIndicator color={theme.tint} />
              ) : partnerSlots.length === 0 ? (
                <Text style={{ color: theme.textSecondary, fontSize: 13 }}>No slots visible yet — try another time option.</Text>
              ) : (
                <View style={{ maxHeight: 200 }}>
                  {partnerSlots.map((s) => (
                    <Pressable
                      key={`${s.slot_key}-${s.time_block}`}
                      onPress={() =>
                        setW((prev) => ({
                          ...prev,
                          pickSlotDate: s.slot_date,
                          pickTimeBlock: s.time_block,
                        }))
                      }
                      style={[
                        styles.slotRow,
                        {
                          backgroundColor:
                            w.pickSlotDate === s.slot_date && w.pickTimeBlock === s.time_block
                              ? 'rgba(236,72,153,0.15)'
                              : theme.muted,
                        },
                      ]}
                    >
                      <Text style={{ color: theme.text, fontSize: 12 }}>
                        {s.slot_date} · {s.time_block} · {s.status}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          )}
        </View>
      )}

      {step === 2 && (
        <View style={{ gap: spacing.sm }}>
          <View style={styles.grid2}>
            {PLACE_MODE_OPTIONS.map((o) => (
              <Pressable
                key={o.key}
                onPress={() => setW((p) => ({ ...p, placeModeKey: o.key }))}
                style={[
                  styles.option,
                  { borderColor: w.placeModeKey === o.key ? theme.tint : theme.border, backgroundColor: theme.surfaceSubtle },
                ]}
              >
                <Text style={{ color: theme.text, fontSize: 14 }}>{o.label}</Text>
              </Pressable>
            ))}
          </View>
          {w.placeModeKey === 'custom_venue' && (
            <TextInput
              value={w.venueText}
              onChangeText={(t) => setW((p) => ({ ...p, venueText: t }))}
              placeholder="Venue name"
              placeholderTextColor={theme.mutedForeground}
              style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
            />
          )}
        </View>
      )}

      {step === 3 && (
        <View style={{ gap: spacing.md }}>
          <View style={styles.variantRow}>
            {[0, 1, 2, 3].map((i) => (
              <Pressable
                key={i}
                onPress={() => {
                  const v = OPTIONAL_MESSAGE_VARIANTS[w.dateTypeKey] || OPTIONAL_MESSAGE_VARIANTS.custom;
                  setW((p) => ({ ...p, variantIndex: i, optionalMessage: v[i] ?? v[0] }));
                }}
                style={[
                  styles.variantChip,
                  { borderColor: w.variantIndex === i ? theme.tint : theme.border },
                ]}
              >
                <Text style={{ color: theme.text, fontSize: 12 }}>Variant {i + 1}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            value={w.optionalMessage}
            onChangeText={(t) => setW((p) => ({ ...p, optionalMessage: t }))}
            multiline
            placeholder="Optional message"
            placeholderTextColor={theme.mutedForeground}
            style={[styles.textArea, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
          />
        </View>
      )}

      {step === 4 && (
        <View style={[styles.review, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
          <Text style={{ color: theme.text, fontSize: 14 }}>
            <Text style={{ color: theme.textSecondary }}>Type: </Text>
            {w.dateTypeKey === 'custom'
              ? w.customDateTypeText.trim() || 'Custom'
              : (DATE_TYPE_OPTIONS.find((x) => x.key === w.dateTypeKey)?.label ?? w.dateTypeKey)}
          </Text>
          <Text style={{ color: theme.text, fontSize: 14, marginTop: 6 }}>
            <Text style={{ color: theme.textSecondary }}>When: </Text>
            {counterContext && shareEnabled && w.pickSlotDate && w.pickTimeBlock
              ? formatProposedDateTimeSummary(slotDateBlockToStartsAt(w.pickSlotDate, w.pickTimeBlock))
              : w.timeChoiceKey === 'pick_a_time' && w.pickStartIso
              ? formatProposedDateTimeSummary(w.pickStartIso)
              : TIME_CHOICE_OPTIONS.find((x) => x.key === w.timeChoiceKey)?.label}
          </Text>
          <Text style={{ color: theme.text, fontSize: 14, marginTop: 6 }}>
            <Text style={{ color: theme.textSecondary }}>Place: </Text>
            {PLACE_MODE_OPTIONS.find((x) => x.key === w.placeModeKey)?.label}
            {w.placeModeKey === 'custom_venue' && w.venueText ? ` — ${w.venueText}` : ''}
          </Text>
          <Text style={{ color: theme.text, fontSize: 14, marginTop: 6 }}>
            <Text style={{ color: theme.textSecondary }}>Note: </Text>
            {w.optionalMessage}
          </Text>
          {shareEnabled && (
            <Text style={{ color: '#f59e0b', fontSize: 12, marginTop: 8 }}>
              {counterContext
                ? 'This counter uses their shared availability to propose a concrete time.'
                : `Your Vibely Schedule will be shared with ${partnerName} for 48 hours.`}
            </Text>
          )}
        </View>
      )}
    </ScrollView>
  );

  const footer = (
    <View style={[styles.footer, { borderTopColor: theme.border }]}>
      {step > 0 && (
        <Pressable
          onPress={() => setStep((s) => s - 1)}
          style={[styles.footerBtn, { backgroundColor: theme.muted }]}
        >
          <Ionicons name="chevron-back" size={18} color={theme.text} />
          <Text style={{ color: theme.text, fontWeight: '600' }}>Back</Text>
        </Pressable>
      )}
      {step < 4 ? (
        <Pressable
          onPress={() => canNext() && setStep((s) => s + 1)}
          disabled={!canNext()}
          style={[styles.footerBtn, styles.footerPrimary, { backgroundColor: canNext() ? theme.tint : theme.muted }]}
        >
          <Text style={{ color: theme.primaryForeground, fontWeight: '700' }}>Next</Text>
          <Ionicons name="chevron-forward" size={18} color={theme.primaryForeground} />
        </Pressable>
      ) : (
        <Pressable
          onPress={submitProposal}
          disabled={saving || !canNext()}
          style={[styles.footerBtn, styles.footerPrimary, { backgroundColor: theme.tint, flex: 1 }]}
        >
          {saving ? (
            <ActivityIndicator color={theme.primaryForeground} />
          ) : (
            <Text style={{ color: theme.primaryForeground, fontWeight: '700' }}>
              {counterContext ? 'Send counter' : 'Send suggestion'}
            </Text>
          )}
        </Pressable>
      )}
    </View>
  );

  return (
    <>
      <KeyboardAwareBottomSheetModal
        visible={visible}
        onRequestClose={onClose}
        backdropColor="rgba(0,0,0,0.85)"
        showHandle
        handleStyle={{ width: 100, height: 8, borderRadius: 999, marginTop: 16, marginBottom: 12 }}
        footer={footer}
      >
        <VibelyText variant="titleMD" style={[styles.title, { color: theme.text }]}>
          {counterContext ? 'Counter proposal' : `Suggest a date with ${partnerName}`}
        </VibelyText>
        {launchSource === 'vibe_clip' && !counterContext ? (
          <View
            style={[
              styles.clipBridgeBanner,
              { borderColor: 'rgba(244,63,94,0.28)', backgroundColor: 'rgba(244,63,94,0.07)' },
            ]}
          >
            <View style={styles.clipBridgePill}>
              <Ionicons name="sparkles" size={12} color="rgba(254,205,211,0.95)" />
              <Text style={styles.clipBridgePillText}>{CLIP_DATE_COMPOSER_PILL}</Text>
            </View>
            <Text style={[styles.clipBridgeSub, { color: theme.textSecondary }]}>{CLIP_DATE_COMPOSER_SUBCOPY}</Text>
          </View>
        ) : null}
        {stepContent}
      </KeyboardAwareBottomSheetModal>
      {dialogEl}
    </>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: spacing.xl,
    flexGrow: 1,
  },
  title: { marginBottom: spacing.md },
  clipBridgeBanner: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  clipBridgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(244,63,94,0.16)',
  },
  clipBridgePillText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
    color: 'rgba(254,205,211,0.95)',
    textTransform: 'uppercase',
  },
  clipBridgeSub: {
    fontSize: 12,
    lineHeight: 17,
  },
  stepDots: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md, alignItems: 'center', gap: 4 },
  stepDot: { fontSize: 11 },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  whenStep: {
    gap: spacing.sm,
  },
  whenOption: {
    width: '100%',
    minWidth: '100%',
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  whenOptionAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    borderTopLeftRadius: radius.lg,
    borderBottomLeftRadius: radius.lg,
  },
  whenOptionLabel: {
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
    flex: 1,
  },
  pickTimeBlock: {
    marginTop: spacing.sm,
  },
  pickSummaryCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
    ...shadows.card,
  },
  whenSectionDivider: {
    height: 1,
    opacity: 0.45,
    marginBottom: spacing.md,
    marginTop: spacing.xs,
  },
  iosPickCardValue: {
    fontSize: 17,
    fontFamily: fonts.bodySemiBold,
    lineHeight: 24,
  },
  iosPickBtn: {
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  iosPickBtnText: {
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
  },
  inlinePickPanel: {
    marginTop: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.sm,
  },
  inlinePickTitle: {
    fontSize: 17,
    fontFamily: fonts.bodySemiBold,
  },
  inlinePickPreview: {
    fontSize: 13,
    lineHeight: 18,
  },
  inlinePickWarning: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fonts.bodySemiBold,
  },
  inlineCalendar: {
    gap: spacing.sm,
  },
  inlineCalendarHeader: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  inlineCalendarNav: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineCalendarMonth: {
    flex: 1,
    textAlign: 'center',
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
  },
  inlineWeekRow: {
    flexDirection: 'row',
  },
  inlineWeekLabel: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    fontSize: 11,
    fontFamily: fonts.bodySemiBold,
  },
  inlineDayGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 6,
  },
  inlineDayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineDayText: {
    fontSize: 13,
    fontFamily: fonts.bodySemiBold,
  },
  inlineTimePanel: {
    gap: spacing.sm,
  },
  changeDateButton: {
    alignSelf: 'flex-start',
    minHeight: 34,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  changeDateText: {
    fontSize: 13,
    fontFamily: fonts.bodySemiBold,
  },
  timeGroup: {
    gap: spacing.xs,
  },
  timeGroupLabel: {
    fontSize: 11,
    fontFamily: fonts.bodySemiBold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  timeChoiceRow: {
    gap: spacing.xs,
    paddingRight: spacing.sm,
  },
  timeChoiceChip: {
    minWidth: 44,
    minHeight: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  timeChoiceText: {
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
  },
  periodRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  periodChip: {
    flex: 1,
    minHeight: 42,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlinePickActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  inlinePickAction: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  inlinePickActionText: {
    fontSize: 15,
    fontWeight: '700',
  },
  option: {
    minWidth: '47%',
    flexGrow: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  hint: { fontSize: 12, lineHeight: 18, marginTop: spacing.sm },
  slotRow: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: radius.md, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 14,
    marginTop: spacing.sm,
  },
  textArea: {
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 14,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  variantRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  variantChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  review: {
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: 4,
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingTop: spacing.md,
    marginTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: radius.lg,
    minWidth: 100,
    justifyContent: 'center',
  },
  footerPrimary: { flexGrow: 1 },
});
