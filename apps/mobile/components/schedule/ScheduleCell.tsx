/**
 * ScheduleCell — one cell in the Vibe Schedule grid.
 * States: BUSY (default), OPEN (teal), LOCKED (event overlap), SAVING (in-flight).
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ViewStyle } from 'react-native';
import type { ScheduleSlotState, ScheduleTimeBucket } from '@/lib/useSchedule';
import { TIME_BLOCK_INFO } from '@/lib/useSchedule';

const TEAL = '#06B6D4';
const PURPLE = '#8B5CF6';
const CELL_BG = '#1C1C2E';
const BORDER_DARK = 'rgba(255,255,255,0.08)';

interface ScheduleCellProps {
  bucket: ScheduleTimeBucket;
  state: ScheduleSlotState;
  onPress?: () => void;
  style?: ViewStyle;
}

export function ScheduleCell({ bucket, state, onPress, style }: ScheduleCellProps) {
  const label = TIME_BLOCK_INFO[bucket].label;
  const isLocked = state === 'locked';
  const isSaving = state === 'saving';
  const isOpen = state === 'open';
  const disabled = isLocked || isSaving;

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.cell,
        state === 'busy' && styles.busy,
        state === 'open' && styles.open,
        state === 'locked' && styles.locked,
        state === 'saving' && styles.saving,
        !disabled && pressed && { opacity: 0.85 },
        style,
      ]}
      disabled={disabled}
    >
      {isSaving ? (
        <ActivityIndicator size="small" color={TEAL} />
      ) : (
        <Text
          style={[
            styles.label,
            state === 'busy' && styles.labelBusy,
            state === 'open' && styles.labelOpen,
            state === 'locked' && styles.labelLocked,
          ]}
          numberOfLines={1}
        >
          {isOpen ? 'Open' : label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cell: {
    minHeight: 70,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  busy: {
    backgroundColor: CELL_BG,
    borderWidth: 1,
    borderColor: BORDER_DARK,
  },
  open: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: TEAL,
    shadowColor: TEAL,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 4,
  },
  locked: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderWidth: 1,
    borderColor: PURPLE,
  },
  saving: {
    backgroundColor: CELL_BG,
    borderWidth: 1,
    borderColor: BORDER_DARK,
  },
  label: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  labelBusy: {
    color: '#9CA3AF',
  },
  labelOpen: {
    color: TEAL,
    fontFamily: 'Inter_600SemiBold',
  },
  labelLocked: {
    color: 'rgba(139, 92, 246, 0.9)',
  },
});
