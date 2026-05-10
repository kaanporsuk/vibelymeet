/**
 * Native parity with src/components/schedule/ScheduleSharePicker.tsx.
 * Reusable 14-day × 4-block availability picker for schedule sharing.
 *
 * Reads/writes the user's own availability via useSchedule (so adding open
 * blocks here also updates /schedule). Selection is local state — the caller
 * submits it through dateSuggestionApply.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius, fonts } from '@/constants/theme';
import { useSchedule, type ScheduleTimeBucket, TIME_BLOCK_INFO } from '@/lib/useSchedule';
import { formatSlotKey } from '../../../../shared/dateSuggestions/scheduleShare';

const BLOCKS: ScheduleTimeBucket[] = ['morning', 'afternoon', 'evening', 'night'];

interface Props {
  initialSelection?: string[];
  onSelectionChange?: (slotKeys: string[]) => void;
}

export function ScheduleSharePicker({ initialSelection = [], onSelectionChange }: Props) {
  const theme = Colors[useColorScheme()];
  const { days, isLoading, getSlotState, toggleSlot } = useSchedule();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelection));

  const emit = useCallback(
    (next: Set<string>) => {
      setSelected(next);
      onSelectionChange?.(Array.from(next));
    },
    [onSelectionChange],
  );

  const totalOpen = useMemo(() => {
    let n = 0;
    for (const d of days) {
      for (const b of BLOCKS) {
        if (getSlotState(d.isoDate, b) === 'open') n += 1;
      }
    }
    return n;
  }, [days, getSlotState]);

  const handleCellTap = useCallback(
    async (isoDate: string, block: ScheduleTimeBucket) => {
      const key = formatSlotKey(isoDate, block);
      const state = getSlotState(isoDate, block);

      if (state === 'locked' || state === 'saving') return;

      if (state === 'open') {
        const next = new Set(selected);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        emit(next);
        return;
      }

      // Busy or unset → mark open in user_schedules, auto-select after add
      try {
        await toggleSlot(isoDate, block);
        const next = new Set(selected);
        next.add(key);
        emit(next);
      } catch {
        /* useSchedule logs; UI already optimistically updated */
      }
    },
    [emit, getSlotState, selected, toggleSlot],
  );

  if (isLoading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color={theme.tint} />
      </View>
    );
  }

  const hasAnyOpen = totalOpen > 0;

  return (
    <View>
      {!hasAnyOpen && (
        <View style={[styles.emptyHint, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
          <Text style={[styles.emptyHintTitle, { color: theme.text }]}>
            Add open blocks to your Vibely Schedule
          </Text>
          <Text style={[styles.emptyHintBody, { color: theme.textSecondary }]}>
            Tap a block when you'd be open to meet. Added blocks save to your Vibely Schedule and you
            can choose which ones to share before sending.
          </Text>
        </View>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.sm }}>
        <View style={{ flexDirection: 'row', paddingVertical: spacing.xs }}>
          <View style={{ width: 64, paddingTop: 38 }}>
            {BLOCKS.map((b) => (
              <View key={b} style={styles.blockLabel}>
                <Text style={[styles.blockLabelText, { color: theme.text }]}>
                  {TIME_BLOCK_INFO[b].label}
                </Text>
              </View>
            ))}
          </View>

          {days.map((day) => (
            <View key={day.isoDate} style={styles.dayCol}>
              <View style={styles.dayHeader}>
                <Text style={[styles.dayDow, { color: theme.textSecondary }]}>{day.weekdayShort}</Text>
                <Text
                  style={[
                    styles.dayNum,
                    { color: day.isToday ? theme.tint : theme.text },
                  ]}
                >
                  {day.dayNumber}
                </Text>
              </View>

              {BLOCKS.map((block) => {
                const key = formatSlotKey(day.isoDate, block);
                const state = getSlotState(day.isoDate, block);
                const isSelected = selected.has(key);
                const isLocked = state === 'locked';
                const isOpen = state === 'open';
                const isPending = state === 'saving';
                const isBusy = state === 'busy';

                let cellStyle: ViewStyleLike = {
                  borderColor: theme.border,
                  backgroundColor: theme.surfaceSubtle,
                };
                if (isOpen && !isSelected)
                  cellStyle = { borderColor: 'rgba(34,211,238,0.55)', backgroundColor: 'rgba(34,211,238,0.12)' };
                if (isOpen && isSelected)
                  cellStyle = { borderColor: theme.tint, backgroundColor: 'rgba(236,72,153,0.18)' };
                if (isLocked)
                  cellStyle = { borderColor: 'rgba(139,92,246,0.55)', backgroundColor: 'rgba(139,92,246,0.18)' };
                if (isBusy)
                  cellStyle = { borderColor: theme.border, backgroundColor: theme.muted };

                return (
                  <Pressable
                    key={key}
                    onPress={() => void handleCellTap(day.isoDate, block)}
                    disabled={isLocked || isPending}
                    style={({ pressed }) => [
                      styles.cell,
                      cellStyle,
                      pressed && !isLocked && !isPending && { opacity: 0.85 },
                    ]}
                  >
                    {isPending ? (
                      <ActivityIndicator size="small" color={theme.textSecondary} />
                    ) : isLocked ? (
                      <Ionicons name="lock-closed" size={14} color="#a78bfa" />
                    ) : isOpen && isSelected ? (
                      <Ionicons name="checkmark-circle" size={16} color={theme.tint} />
                    ) : isOpen ? (
                      <Text style={[styles.cellText, { color: '#22d3ee' }]}>Open</Text>
                    ) : isBusy ? (
                      <Text style={[styles.cellText, { color: theme.textSecondary }]}>Busy</Text>
                    ) : (
                      <Ionicons name="add" size={14} color={theme.textSecondary} />
                    )}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>

      <Text style={[styles.footnote, { color: theme.textSecondary }]}>
        {selected.size > 0
          ? `${selected.size} block${selected.size === 1 ? '' : 's'} selected`
          : 'Tap open blocks to share with your match.'}
      </Text>
    </View>
  );
}

type ViewStyleLike = { borderColor: string; backgroundColor: string };

const styles = StyleSheet.create({
  loadingWrap: { padding: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  emptyHint: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  emptyHintTitle: { fontFamily: fonts.bodySemiBold, fontSize: 14, marginBottom: 4 },
  emptyHintBody: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16 },
  blockLabel: { height: 56, justifyContent: 'center', paddingHorizontal: spacing.xs },
  blockLabelText: { fontFamily: fonts.bodyMedium, fontSize: 11 },
  dayCol: { width: 70, marginRight: 4 },
  dayHeader: { height: 38, alignItems: 'center', justifyContent: 'center' },
  dayDow: { fontFamily: fonts.bodyMedium, fontSize: 10, textTransform: 'uppercase' },
  dayNum: { fontFamily: fonts.bodySemiBold, fontSize: 14 },
  cell: {
    height: 52,
    marginBottom: 4,
    borderWidth: 1.5,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellText: { fontFamily: fonts.bodyMedium, fontSize: 11 },
  footnote: { fontFamily: fonts.body, fontSize: 11, marginTop: spacing.xs },
});
