/**
 * VibeScheduleGrid — 2D matrix: rows = time buckets (4), columns = dates.
 * Row labels fixed left; day columns (header + cells) scroll horizontally together.
 */
import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { ScheduleCell } from './ScheduleCell';
import type { ScheduleDay, ScheduleTimeBucket } from '@/lib/useSchedule';
import { TIME_BLOCK_INFO } from '@/lib/useSchedule';

const ROW_LABEL_WIDTH = 80;
const COL_WIDTH = 72;
const PURPLE = '#8B5CF6';
const BUCKETS: ScheduleTimeBucket[] = ['morning', 'afternoon', 'evening', 'night'];

interface VibeScheduleGridProps {
  days: ScheduleDay[];
  getSlotState: (isoDate: string, bucket: ScheduleTimeBucket) => 'busy' | 'open' | 'locked' | 'saving';
  onToggleSlot: (isoDate: string, bucket: ScheduleTimeBucket) => void;
}

export function VibeScheduleGrid({ days, getSlotState, onToggleSlot }: VibeScheduleGridProps) {
  const gridWidth = days.length * COL_WIDTH;

  return (
    <View style={styles.wrapper}>
      <View style={styles.row}>
        <View style={styles.labelColumn}>
          <View style={styles.dayHeaderSpacer} />
          {BUCKETS.map((bucket) => (
            <View key={bucket} style={styles.labelCell}>
              <Text style={styles.labelTitle}>{TIME_BLOCK_INFO[bucket].label}</Text>
              <Text style={styles.labelHours}>{TIME_BLOCK_INFO[bucket].hours}</Text>
            </View>
          ))}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { width: gridWidth }]}
        >
          {days.map((d) => (
            <View key={d.isoDate} style={styles.dayColumn}>
              <View style={[styles.dayHeaderChip, d.isToday && styles.dayHeaderChipToday]}>
                <Text style={styles.dayWeekday}>{d.weekdayShort}</Text>
                <Text style={[styles.dayNum, d.isToday && styles.dayNumToday]}>{d.dayNumber}</Text>
              </View>
              {BUCKETS.map((bucket) => (
                <ScheduleCell
                  key={`${d.isoDate}-${bucket}`}
                  bucket={bucket}
                  state={getSlotState(d.isoDate, bucket)}
                  onPress={() => onToggleSlot(d.isoDate, bucket)}
                  style={styles.cell}
                />
              ))}
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1 },
  row: { flexDirection: 'row' },
  labelColumn: {
    width: ROW_LABEL_WIDTH,
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 12,
  },
  dayHeaderSpacer: { height: 48, marginBottom: 4 },
  labelCell: {
    height: 78,
    justifyContent: 'center',
    paddingLeft: 8,
  },
  labelTitle: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: '#FFFFFF',
  },
  labelHours: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 2,
  },
  scroll: { flex: 1 },
  scrollContent: { flexDirection: 'row', paddingVertical: 4 },
  dayColumn: {
    width: COL_WIDTH,
    paddingHorizontal: 4,
    alignItems: 'stretch',
  },
  dayHeaderChip: {
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  dayHeaderChipToday: {
    backgroundColor: PURPLE,
  },
  dayWeekday: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: '#9CA3AF',
    textTransform: 'uppercase',
  },
  dayNum: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: '#FFFFFF',
  },
  dayNumToday: {
    color: '#FFFFFF',
  },
  cell: {
    minHeight: 70,
    marginBottom: 6,
  },
});
