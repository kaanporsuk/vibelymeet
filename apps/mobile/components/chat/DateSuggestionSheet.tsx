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
  Alert,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import { VibelyText } from '@/components/ui';
import { KeyboardAwareBottomSheetModal } from '@/components/keyboard/KeyboardAwareBottomSheetModal';
import {
  DATE_TYPE_OPTIONS,
  TIME_CHOICE_OPTIONS,
  PLACE_MODE_OPTIONS,
  OPTIONAL_MESSAGE_VARIANTS,
  type DateTypeKey,
  type TimeChoiceKey,
  type PlaceModeKey,
} from '@/lib/dateSuggestionCopy';
import { slotDateBlockToStartsAt } from '@/lib/dateSuggestionTime';
import { useSharedPartnerSchedule } from '@/lib/useSharedPartnerSchedule';
import { dateSuggestionApply, DateSuggestionDomainError } from '@/lib/dateSuggestionApply';
import type { DateSuggestionRevisionRow } from '@/lib/useDateSuggestionData';

const STEPS = ['Type', 'When', 'Place', 'Message', 'Review'] as const;

export type WizardState = {
  dateTypeKey: DateTypeKey;
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
    date_type_key: w.dateTypeKey,
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

  const [pickOpen, setPickOpen] = useState(false);
  const [androidPickMode, setAndroidPickMode] = useState<'date' | 'time'>('date');
  const [tempPick, setTempPick] = useState(new Date());

  useEffect(() => {
    if (!visible) return;
    if (counterContext) {
      const r = counterContext.previousRevision;
      setW({
        dateTypeKey: (r.date_type_key as DateTypeKey) || 'coffee',
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
      setW((prev) => ({ ...defaultWizard(), ...draftFromParent.wizard }));
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

  const handleSaveDraft = async () => {
    if (!matchId) return;
    setSaving(true);
    try {
      let sid = draftId;
      if (!sid) {
        const created = (await dateSuggestionApply('create_draft', {
          match_id: matchId,
          draft: { wizard: w, step },
        })) as { suggestion_id?: string };
        sid = created?.suggestion_id ?? null;
        if (sid) setDraftId(sid);
      }
      if (sid) {
        await dateSuggestionApply('update_draft', {
          suggestion_id: sid,
          draft: { wizard: w, step },
        });
        Alert.alert('Draft saved', 'You can continue later from the chat card.');
      }
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Could not save draft.');
    } finally {
      setSaving(false);
    }
  };

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
        Alert.alert('Date suggestion', 'You already have an active date suggestion in this chat.');
      } else {
        console.error(e);
        Alert.alert('Error', counterContext ? 'Could not send counter.' : 'Could not send suggestion.');
      }
    } finally {
      submitInFlightRef.current = false;
      setSaving(false);
    }
  };

  const canNext = useCallback(() => {
    if (step === 1 && w.timeChoiceKey === 'pick_a_time' && !w.pickStartIso) return false;
    if (step === 1 && shareEnabled && counterContext && (!w.pickSlotDate || !w.pickTimeBlock)) {
      return false;
    }
    if (step === 2 && w.placeModeKey === 'custom_venue' && !w.venueText.trim()) return false;
    return true;
  }, [step, w, shareEnabled, counterContext]);

  const onDtChange = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') {
      if (event.type === 'dismissed') {
        setPickOpen(false);
        setAndroidPickMode('date');
        return;
      }
      setPickOpen(false);
      if (!date) return;
      if (androidPickMode === 'date') {
        setTempPick(date);
        setAndroidPickMode('time');
        setTimeout(() => setPickOpen(true), 120);
      } else {
        const merged = new Date(tempPick);
        merged.setHours(date.getHours(), date.getMinutes(), 0, 0);
        setW((p) => ({ ...p, pickStartIso: merged.toISOString() }));
        setAndroidPickMode('date');
      }
      return;
    }
    if (date) setW((p) => ({ ...p, pickStartIso: date.toISOString() }));
  };

  const stepContent = (
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
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
      )}

      {step === 1 && (
        <View style={{ gap: spacing.sm }}>
          {TIME_CHOICE_OPTIONS.map((o) => (
            <Pressable
              key={o.key}
              onPress={() =>
                setW((p) => ({
                  ...p,
                  timeChoiceKey: o.key,
                  scheduleShareEnabled: o.key === 'share_schedule',
                }))
              }
              style={[
                styles.option,
                { borderColor: w.timeChoiceKey === o.key ? theme.tint : theme.border, backgroundColor: theme.surfaceSubtle },
              ]}
            >
              <Text style={{ color: theme.text, fontSize: 14 }}>{o.label}</Text>
            </Pressable>
          ))}
          {w.timeChoiceKey === 'pick_a_time' && (
            <View>
              {Platform.OS === 'android' && (
                <Pressable
                  onPress={() => {
                    const base = w.pickStartIso ? new Date(w.pickStartIso) : new Date();
                    setTempPick(base);
                    setAndroidPickMode('date');
                    setPickOpen(true);
                  }}
                  style={[styles.option, { borderColor: theme.border }]}
                >
                  <Text style={{ color: theme.tint, fontSize: 14, fontWeight: '600' }}>
                    {w.pickStartIso
                      ? new Date(w.pickStartIso).toLocaleString()
                      : 'Choose date & time'}
                  </Text>
                </Pressable>
              )}
              {Platform.OS === 'ios' && (
                <DateTimePicker
                  value={w.pickStartIso ? new Date(w.pickStartIso) : new Date()}
                  mode="datetime"
                  display="spinner"
                  onChange={onDtChange}
                />
              )}
              {pickOpen && Platform.OS === 'android' && (
                <DateTimePicker
                  value={tempPick}
                  mode={androidPickMode}
                  display="default"
                  onChange={onDtChange}
                />
              )}
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
            {DATE_TYPE_OPTIONS.find((x) => x.key === w.dateTypeKey)?.label}
          </Text>
          <Text style={{ color: theme.text, fontSize: 14, marginTop: 6 }}>
            <Text style={{ color: theme.textSecondary }}>When: </Text>
            {TIME_CHOICE_OPTIONS.find((x) => x.key === w.timeChoiceKey)?.label}
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
    <View style={styles.footer}>
      {step > 0 && (
        <Pressable
          onPress={() => setStep((s) => s - 1)}
          style={[styles.footerBtn, { backgroundColor: theme.muted }]}
        >
          <Ionicons name="chevron-back" size={18} color={theme.text} />
          <Text style={{ color: theme.text, fontWeight: '600' }}>Back</Text>
        </Pressable>
      )}
      {!counterContext && step === 4 && (
        <Pressable
          onPress={handleSaveDraft}
          disabled={saving}
          style={[styles.footerBtn, { backgroundColor: theme.surfaceSubtle, borderWidth: 1, borderColor: theme.border }]}
        >
          <Text style={{ color: theme.text, fontWeight: '600' }}>Save draft</Text>
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
      {stepContent}
    </KeyboardAwareBottomSheetModal>
  );
}

const styles = StyleSheet.create({
  title: { marginBottom: spacing.md },
  stepDots: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md, alignItems: 'center', gap: 4 },
  stepDot: { fontSize: 11 },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
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
    paddingTop: spacing.sm,
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
