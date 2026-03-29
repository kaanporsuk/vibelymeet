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
  Platform,
  ActivityIndicator,
  ScrollView,
  Modal,
  useColorScheme as useRnColorScheme,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { startOfDay } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius, fonts, shadows, typography } from '@/constants/theme';
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
import {
  CLIP_DATE_COMPOSER_PILL,
  CLIP_DATE_COMPOSER_SUBCOPY,
  type DateComposerLaunchSource,
} from '../../../../shared/dateSuggestions/dateComposerLaunch';
import { useVibelyDialog } from '@/components/VibelyDialog';
import {
  formatProposedDateTimeSummary,
  mergeLocalDateAndTime,
} from '../../../../shared/dateSuggestions/formatProposedDateTimeSummary';

const STEPS = ['Type', 'When', 'Place', 'Message', 'Review'] as const;

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
});

const DATE_TYPE_KEYS = new Set<string>(DATE_TYPE_OPTIONS.map((o) => o.key));

function resolveDateTypeValue(w: Pick<WizardState, 'dateTypeKey' | 'customDateTypeText'>): string {
  if (w.dateTypeKey !== 'custom') return w.dateTypeKey;
  return w.customDateTypeText.trim();
}

function buildRevision(w: WizardState) {
  const share = w.timeChoiceKey === 'share_schedule';
  let startsAt: string | null | undefined = w.pickStartIso;
  let endsAt: string | null | undefined = w.pickEndIso;
  let timeBlock: string | null | undefined = w.pickTimeBlock;

  if (w.timeChoiceKey === 'pick_a_time' && w.pickStartIso) {
    startsAt = w.pickStartIso;
    endsAt = w.pickEndIso || w.pickStartIso;
  }
  if (share && w.pickSlotDate && w.pickTimeBlock) {
    startsAt = slotDateBlockToStartsAt(w.pickSlotDate, w.pickTimeBlock);
    endsAt = null;
    timeBlock = w.pickTimeBlock;
  }

  return {
    date_type_key: resolveDateTypeValue(w),
    time_choice_key: w.timeChoiceKey,
    place_mode_key: w.placeModeKey,
    venue_text: w.placeModeKey === 'custom_venue' ? (w.venueText.trim() || null) : null,
    optional_message: w.optionalMessage.trim() || null,
    schedule_share_enabled: share,
    starts_at: startsAt ?? null,
    ends_at: endsAt ?? null,
    time_block: timeBlock ?? null,
  };
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
  currentUserId: _currentUserId,
  partnerUserId,
  partnerName,
  draftSuggestionId,
  draftFromParent,
  counterContext,
  launchSource = 'default',
  onSuccess,
}: Props) {
  const theme = Colors[useColorScheme()];
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

  /** Stacked above the bottom sheet so system pickers are not swallowed by scroll/touches. */
  const [nativePickOpen, setNativePickOpen] = useState(false);
  const [nativePickPhase, setNativePickPhase] = useState<'date' | 'time'>('date');
  const [nativeDatePart, setNativeDatePart] = useState(() => startOfDay(new Date()));
  const [nativeTimePart, setNativeTimePart] = useState(() => new Date());
  const { show: showDialog, dialog: dialogEl } = useVibelyDialog();
  const rnScheme = useRnColorScheme();
  const pickerTheme = rnScheme === 'dark' ? 'dark' : 'light';

  useEffect(() => {
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
  }, [visible, counterContext, draftSuggestionId, draftFromParent]);

  const openNativePickFlow = useCallback(() => {
    const base = w.pickStartIso ? new Date(w.pickStartIso) : new Date();
    setNativeDatePart(startOfDay(base));
    setNativeTimePart(base);
    setNativePickPhase('date');
    setNativePickOpen(true);
  }, [w.pickStartIso]);

  useEffect(() => {
    if (w.timeChoiceKey !== 'pick_a_time') setNativePickOpen(false);
  }, [w.timeChoiceKey]);

  const submitProposal = async () => {
    if (submitInFlightRef.current || saving) return;
    submitInFlightRef.current = true;
    setSaving(true);
    try {
      const revision = buildRevision(w);
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
        console.error(e);
        showDialog({
          title: 'Couldn’t send',
          message: counterContext ? 'We couldn’t send your counter. Try again.' : 'We couldn’t send your suggestion. Try again.',
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
    if (step === 1 && w.timeChoiceKey === 'pick_a_time' && !w.pickStartIso) return false;
    if (step === 1 && shareEnabled && counterContext && (!w.pickSlotDate || !w.pickTimeBlock)) {
      return false;
    }
    if (step === 2 && w.placeModeKey === 'custom_venue' && !w.venueText.trim()) return false;
    return true;
  }, [step, w, shareEnabled, counterContext]);

  const todayStart = startOfDay(new Date());

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
                  {o.label}
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
                  onPress={openNativePickFlow}
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
              </View>
            </View>
          )}
          {shareEnabled && !counterContext && (
            <Text style={[styles.hint, { color: theme.textSecondary }]}>
              When you send, {partnerName} can view your Vibely Schedule availability for the next 14 days for 48 hours —
              open/busy windows only.
            </Text>
          )}
          {shareEnabled && counterContext && (
            <View style={{ gap: spacing.sm }}>
              <Text style={[styles.hint, { color: theme.textSecondary }]}>
                Pick a slot that fits their shared availability (next 14 days).
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
            {w.timeChoiceKey === 'pick_a_time' && w.pickStartIso
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
              Your Vibely Schedule will be shared with {partnerName} for 48 hours.
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
      {/*
        iOS: transparent + formSheet is unsupported; the modal may not present (tap appears to do nothing).
        Use overFullScreen with transparent so the dim + sheet stack above the existing sheet Modal.
      */}
      <Modal
        visible={nativePickOpen}
        transparent
        animationType="fade"
        presentationStyle={Platform.OS === 'ios' ? 'overFullScreen' : undefined}
        onRequestClose={() => setNativePickOpen(false)}
      >
        <View style={styles.nativePickRoot} pointerEvents="box-none">
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setNativePickOpen(false)}
            accessibilityLabel="Close picker"
          />
          <SafeAreaView
            edges={['bottom']}
            style={[styles.nativePickSheet, { backgroundColor: theme.surface, borderColor: theme.border }]}
          >
            <View style={styles.nativePickHandle} />
            <Text style={[styles.iosModalTitle, { color: theme.text }]}>
              {nativePickPhase === 'date' ? 'Pick a date' : 'Pick a time'}
            </Text>
            <Text style={[styles.iosModalValue, { color: theme.textSecondary, marginBottom: spacing.sm }]}>
              {formatProposedDateTimeSummary(
                mergeLocalDateAndTime(nativeDatePart, nativeTimePart).toISOString(),
              )}
            </Text>
            {nativePickPhase === 'date' ? (
              <DateTimePicker
                value={nativeDatePart}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'calendar'}
                onChange={(_, date) => {
                  if (date) setNativeDatePart(startOfDay(date));
                }}
                minimumDate={todayStart}
                themeVariant={pickerTheme}
                style={Platform.OS === 'ios' ? styles.iosInlineCalendar : styles.androidInlineCalendar}
              />
            ) : (
              <>
                <Pressable
                  onPress={() => setNativePickPhase('date')}
                  style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1, alignSelf: 'center', marginBottom: spacing.sm })}
                >
                  <Text style={{ color: theme.tint, fontSize: 15, fontFamily: fonts.bodySemiBold }}>
                    ← Change date
                  </Text>
                </Pressable>
                <DateTimePicker
                  value={nativeTimePart}
                  mode="time"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(_, date) => {
                    if (date) setNativeTimePart(date);
                  }}
                  minuteInterval={5}
                  themeVariant={pickerTheme}
                  style={styles.iosPickerWheel}
                />
              </>
            )}
            <View style={styles.nativePickActions}>
              <Pressable
                onPress={() => setNativePickOpen(false)}
                style={({ pressed }) => [
                  styles.iosActionBtn,
                  { backgroundColor: theme.muted, opacity: pressed ? 0.9 : 1 },
                ]}
              >
                <Text style={[styles.iosActionText, { color: theme.text }]}>Cancel</Text>
              </Pressable>
              {nativePickPhase === 'date' ? (
                <Pressable
                  onPress={() => setNativePickPhase('time')}
                  style={({ pressed }) => [
                    styles.iosActionBtn,
                    { backgroundColor: theme.tint, opacity: pressed ? 0.9 : 1 },
                  ]}
                >
                  <Text style={[styles.iosActionText, { color: theme.primaryForeground }]}>Next</Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => {
                    const merged = mergeLocalDateAndTime(nativeDatePart, nativeTimePart);
                    setW((p) => ({
                      ...p,
                      pickStartIso: merged.toISOString(),
                      pickEndIso: merged.toISOString(),
                    }));
                    setNativePickOpen(false);
                    setNativePickPhase('date');
                  }}
                  style={({ pressed }) => [
                    styles.iosActionBtn,
                    { backgroundColor: theme.tint, opacity: pressed ? 0.9 : 1 },
                  ]}
                >
                  <Text style={[styles.iosActionText, { color: theme.primaryForeground }]}>Save</Text>
                </Pressable>
              )}
            </View>
          </SafeAreaView>
        </View>
      </Modal>
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
  nativePickRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  nativePickSheet: {
    borderTopLeftRadius: radius['2xl'],
    borderTopRightRadius: radius['2xl'],
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    maxHeight: '92%',
  },
  nativePickHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(128,128,128,0.45)',
    marginBottom: spacing.md,
  },
  nativePickActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  iosInlineCalendar: {
    width: '100%',
    height: 360,
    alignSelf: 'center',
  },
  androidInlineCalendar: {
    width: '100%',
    minHeight: 320,
    alignSelf: 'center',
  },
  whenSectionDivider: {
    height: 1,
    opacity: 0.45,
    marginBottom: spacing.md,
    marginTop: spacing.xs,
  },
  pickerSectionOverline: {
    ...typography.overline,
    marginBottom: spacing.sm,
  },
  pickerSurface: {
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    overflow: 'hidden',
    ...shadows.card,
  },
  iosPickerWheel: {
    width: '100%',
    height: 216,
    alignSelf: 'center',
  },
  iosPickCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadows.card,
  },
  iosPickCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  iosPickCardTitle: {
    ...typography.overline,
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
  iosModalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  iosModalCard: {
    borderRadius: radius['2xl'],
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  iosModalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  iosModalValue: {
    fontSize: 13,
    lineHeight: 18,
  },
  iosWheelWrap: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: '#fff',
    paddingVertical: spacing.xs,
  },
  iosModalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  iosActionBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  iosActionText: {
    fontSize: 15,
    fontWeight: '700',
  },
  androidPickerTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.sm,
    ...shadows.card,
  },
  androidPickerTriggerText: {
    flex: 1,
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
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
