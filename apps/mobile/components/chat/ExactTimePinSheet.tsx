/**
 * Native parity with src/components/chat/ExactTimePinSheet.tsx.
 * Constrains the user to picking a start time inside the chosen block's
 * hour range. Default = mid-block. ends_at = starts_at + 90 min, clamped
 * to the block's end. Server-side validation in date_suggestion_apply.accept
 * enforces this.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius, fonts } from '@/constants/theme';
import {
  BLOCK_HOUR_RANGES,
  parseSlotKey,
  type TimeBlock,
} from '../../../../shared/dateSuggestions/scheduleShare';

const DEFAULT_DURATION_MINUTES = 90;

function halfHourSlots(block: TimeBlock): { hour: number; minute: number; label: string }[] {
  const { startHour, endHour } = BLOCK_HOUR_RANGES[block];
  const out: { hour: number; minute: number; label: string }[] = [];
  for (let h = startHour; h < endHour; h += 1) {
    for (const m of [0, 30]) {
      const display12 = h % 12 === 0 ? 12 : h % 12;
      const meridiem = h < 12 ? 'AM' : 'PM';
      out.push({
        hour: h,
        minute: m,
        label: `${display12}:${m.toString().padStart(2, '0')} ${meridiem}`,
      });
    }
  }
  return out;
}

interface Props {
  visible: boolean;
  chosenSlotKey: string;
  isSubmitting?: boolean;
  onClose: () => void;
  /**
   * Forwards user's wall-clock start hour (0-23) so the server can validate
   * against the chosen block range without timezone drift.
   */
  onConfirm: (
    startsAtIso: string,
    endsAtIso: string,
    localStartHour: number,
  ) => void | Promise<void>;
}

export function ExactTimePinSheet({ visible, chosenSlotKey, isSubmitting, onClose, onConfirm }: Props) {
  const theme = Colors[useColorScheme()];
  const parsed = useMemo(() => parseSlotKey(chosenSlotKey), [chosenSlotKey]);
  const slots = useMemo(() => (parsed ? halfHourSlots(parsed.timeBlock) : []), [parsed]);

  const defaultIndex = useMemo(() => {
    if (!parsed) return 0;
    const { startHour, endHour } = BLOCK_HOUR_RANGES[parsed.timeBlock];
    const midHour = Math.floor((startHour + endHour) / 2);
    const idx = slots.findIndex((s) => s.hour === midHour && s.minute === 0);
    return idx >= 0 ? idx : Math.floor(slots.length / 2);
  }, [parsed, slots]);

  const [selectedIndex, setSelectedIndex] = useState(defaultIndex);

  if (!parsed) return null;

  const handleConfirm = async () => {
    const slot = slots[selectedIndex];
    if (!slot) return;
    const date = new Date(`${parsed.slotDate}T00:00:00`);
    const { endHour } = BLOCK_HOUR_RANGES[parsed.timeBlock];

    const startsAt = new Date(date);
    startsAt.setHours(slot.hour, slot.minute, 0, 0);
    const endsAt = new Date(startsAt);
    endsAt.setMinutes(endsAt.getMinutes() + DEFAULT_DURATION_MINUTES);

    const blockEnd = new Date(date);
    blockEnd.setHours(endHour === 24 ? 0 : endHour, 0, 0, 0);
    if (endHour === 24) blockEnd.setDate(blockEnd.getDate() + 1);
    if (endsAt > blockEnd) endsAt.setTime(blockEnd.getTime());

    await onConfirm(startsAt.toISOString(), endsAt.toISOString(), slot.hour);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: theme.background, borderColor: theme.border }]}>
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <View style={[styles.iconWrap, { backgroundColor: 'rgba(236,72,153,0.15)' }]}>
                <Ionicons name="time-outline" size={20} color={theme.tint} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: theme.text }]}>Pick an exact time</Text>
                <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
                  {format(new Date(`${parsed.slotDate}T00:00:00`), 'EEEE, MMM d')}
                  {' · '}
                  {parsed.timeBlock.charAt(0).toUpperCase() + parsed.timeBlock.slice(1)}
                </Text>
              </View>
              <Pressable onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={22} color={theme.text} />
              </Pressable>
            </View>
          </View>

          <ScrollView contentContainerStyle={{ padding: spacing.md }}>
            <View style={styles.grid}>
              {slots.map((slot, i) => (
                <Pressable
                  key={`${slot.hour}-${slot.minute}`}
                  onPress={() => setSelectedIndex(i)}
                  style={[
                    styles.slot,
                    {
                      borderColor: i === selectedIndex ? theme.tint : theme.border,
                      backgroundColor:
                        i === selectedIndex ? 'rgba(236,72,153,0.18)' : theme.surfaceSubtle,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.slotText,
                      { color: i === selectedIndex ? theme.tint : theme.text },
                    ]}
                  >
                    {slot.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: theme.border }]}>
            <Pressable
              disabled={!!isSubmitting}
              onPress={() => void handleConfirm()}
              style={[styles.confirmBtn, { backgroundColor: theme.tint, opacity: isSubmitting ? 0.6 : 1 }]}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.confirmBtnText}>Confirm date</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: 1,
    maxHeight: '80%',
  },
  header: { padding: spacing.md, borderBottomWidth: 1 },
  iconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.bodySemiBold, fontSize: 16 },
  subtitle: { fontFamily: fonts.body, fontSize: 12, marginTop: 2 },
  closeBtn: { padding: spacing.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  slot: {
    width: '31%',
    paddingVertical: spacing.sm,
    borderWidth: 1.5,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  slotText: { fontFamily: fonts.bodyMedium, fontSize: 13 },
  footer: { padding: spacing.md, borderTopWidth: 1 },
  confirmBtn: { paddingVertical: 14, borderRadius: radius.md, alignItems: 'center' },
  confirmBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: '#fff' },
});
