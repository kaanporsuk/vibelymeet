import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleProp, StyleSheet, TextInput, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Themed';
import { VibelyButton } from '@/components/ui';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { KeyboardAwareBottomSheetModal } from '@/components/keyboard/KeyboardAwareBottomSheetModal';

type HeightUnit = 'cm' | 'ftin';

const MIN_CM = 120;
const MAX_CM = 230;
const CM_OPTIONS = Array.from({ length: MAX_CM - MIN_CM + 1 }, (_, i) => MIN_CM + i);
const FEET_OPTIONS = Array.from({ length: 8 }, (_, i) => i + 3); // 3..10
const INCH_OPTIONS = Array.from({ length: 12 }, (_, i) => i); // 0..11
const WHEEL_ITEM_HEIGHT = 44;
const WHEEL_VISIBLE_ROWS = 5;
const WHEEL_SIDE_PADDING = ((WHEEL_VISIBLE_ROWS - 1) / 2) * WHEEL_ITEM_HEIGHT;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cmToFeetInches(cm: number): { feet: number; inches: number } {
  const totalInches = Math.round(cm / 2.54);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return { feet, inches };
}

function feetInchesToCm(feet: number, inches: number): number {
  return Math.round((feet * 12 + inches) * 2.54);
}

function formatHeightDisplay(cm: number): string {
  const { feet, inches } = cmToFeetInches(cm);
  return `${cm} cm • ${feet}'${inches}"`;
}

function WheelColumn({
  options,
  selected,
  onSelect,
  formatValue,
  accentColor,
  borderColor,
  containerStyle,
}: {
  options: number[];
  selected: number;
  onSelect: (value: number) => void;
  formatValue: (value: number) => string;
  accentColor: string;
  borderColor: string;
  containerStyle?: StyleProp<ViewStyle>;
}) {
  const listRef = useRef<FlatList<number> | null>(null);
  const selectedIndex = Math.max(0, options.indexOf(selected));

  useEffect(() => {
    const offset = selectedIndex * WHEEL_ITEM_HEIGHT;
    listRef.current?.scrollToOffset({ offset, animated: false });
  }, [selectedIndex]);

  return (
    <View style={[styles.wheelColumn, containerStyle]}>
      <FlatList
        ref={listRef}
        data={options}
        keyExtractor={(item) => String(item)}
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ITEM_HEIGHT}
        decelerationRate="fast"
        bounces={false}
        contentContainerStyle={styles.wheelContent}
        getItemLayout={(_, index) => ({
          length: WHEEL_ITEM_HEIGHT,
          offset: WHEEL_ITEM_HEIGHT * index,
          index,
        })}
        onMomentumScrollEnd={(event) => {
          const offsetY = event.nativeEvent.contentOffset.y;
          const nextIndex = clamp(Math.round(offsetY / WHEEL_ITEM_HEIGHT), 0, options.length - 1);
          onSelect(options[nextIndex]);
        }}
        renderItem={({ item }) => {
          const active = item === selected;
          return (
            <Pressable style={styles.wheelRow} onPress={() => onSelect(item)}>
              <Text style={{ color: active ? accentColor : '#9CA3AF', fontSize: active ? 18 : 16, fontWeight: active ? '700' : '500' }}>
                {formatValue(item)}
              </Text>
            </Pressable>
          );
        }}
      />
      <View style={[styles.wheelSelectionBand, { borderColor }]} pointerEvents="none" />
    </View>
  );
}

export default function BasicsStep({ heightCm, job, onHeightChange, onJobChange, onNext }: { heightCm: number | null; job: string; onHeightChange: (v: number | null) => void; onJobChange: (v: string) => void; onNext: () => void; }) {
  const theme = Colors[useColorScheme()];
  const [pickerOpen, setPickerOpen] = useState(false);
  const [unit, setUnit] = useState<HeightUnit>('cm');
  const [draftCm, setDraftCm] = useState<number>(heightCm ?? 170);

  const hasHeight = heightCm != null;
  const hasJob = job.trim().length > 0;
  const ctaLabel = hasHeight || hasJob ? 'Continue' : 'Skip for now';
  const heightDisplay = hasHeight ? formatHeightDisplay(heightCm) : 'Height';
  const draftFeetInches = useMemo(() => cmToFeetInches(clamp(draftCm, MIN_CM, MAX_CM)), [draftCm]);

  const openPicker = () => {
    setDraftCm(clamp(heightCm ?? 170, MIN_CM, MAX_CM));
    setUnit('cm');
    setPickerOpen(true);
  };

  const commitHeight = () => {
    onHeightChange(clamp(draftCm, MIN_CM, MAX_CM));
    setPickerOpen(false);
  };

  const closeWithoutSaving = () => {
    setPickerOpen(false);
  };

  return (
    <View style={styles.root}>
      <Text style={[styles.h1, { color: theme.text }]}>The basics</Text>
      <Text style={[styles.sub, { color: theme.textSecondary }]}>These help us find your best matches. Skip anything you'd rather share later.</Text>

      <Pressable onPress={openPicker} style={[styles.heightRow, { borderColor: theme.border, backgroundColor: hasHeight ? 'rgba(255,255,255,0.06)' : theme.surfaceSubtle }]}>
        <View style={styles.leftRow}>
          <Ionicons name="resize-outline" size={18} color={hasHeight ? theme.tint : theme.textSecondary} />
          <Text numberOfLines={1} style={{ color: hasHeight ? theme.text : theme.textSecondary, fontWeight: hasHeight ? '600' : '500' }}>{heightDisplay}</Text>
        </View>
        <Ionicons name="chevron-down" size={17} color={hasHeight ? theme.text : theme.textSecondary} />
      </Pressable>

      <View style={[styles.jobRow, { borderColor: theme.border, backgroundColor: 'rgba(255,255,255,0.02)' }]}>
        <Ionicons name="briefcase-outline" size={18} color={theme.textSecondary} />
        <TextInput
          value={job}
          onChangeText={onJobChange}
          placeholder="What do you do?"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="words"
          style={[styles.jobInput, { color: theme.text }]}
        />
      </View>

      <View style={styles.ctaWrap}>
        <VibelyButton label={ctaLabel} onPress={onNext} variant="gradient" style={styles.ctaButton} />
      </View>

      <KeyboardAwareBottomSheetModal
        visible={pickerOpen}
        onRequestClose={closeWithoutSaving}
        animationType="fade"
        scrollable={false}
        sheetStyle={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.border }]}
      >
        <View>
            <View style={styles.sheetTop}>
              <Text style={[styles.sheetTitle, { color: theme.text }]}>Select height</Text>
              <View style={styles.sheetActions}>
                <Pressable onPress={closeWithoutSaving} style={styles.actionBtn}>
                  <Text style={{ color: theme.textSecondary, fontWeight: '600' }}>Cancel</Text>
                </Pressable>
              </View>
              <Pressable onPress={commitHeight} style={styles.actionBtn}>
                <Text style={{ color: theme.tint, fontWeight: '700' }}>Done</Text>
              </Pressable>
            </View>
            <Text style={[styles.sheetValue, { color: theme.textSecondary }]}>
              {formatHeightDisplay(clamp(draftCm, MIN_CM, MAX_CM))}
            </Text>

            <View style={styles.unitSwitchRow}>
              <Pressable
                onPress={() => setUnit('cm')}
                style={[styles.unitPrimaryChip, { borderColor: theme.border, backgroundColor: unit === 'cm' ? theme.tintSoft : theme.surfaceSubtle }]}
              >
                <Text style={{ color: unit === 'cm' ? theme.tint : theme.textSecondary, fontWeight: '700' }}>cm (default)</Text>
              </Pressable>
              <Pressable
                onPress={() => setUnit('ftin')}
                style={styles.unitSecondaryBtn}
              >
                <Text style={{ color: unit === 'ftin' ? theme.tint : theme.textSecondary, fontWeight: '600', fontSize: 13 }}>Use ft/in</Text>
              </Pressable>
            </View>

            {unit === 'cm' ? (
              <View style={styles.wheelSingle} key="cm-wheel">
                <WheelColumn
                  options={CM_OPTIONS}
                  selected={clamp(draftCm, MIN_CM, MAX_CM)}
                  onSelect={(nextCm) => setDraftCm(nextCm)}
                  formatValue={(value) => `${value} cm`}
                  accentColor={theme.text}
                  borderColor={theme.border}
                  containerStyle={styles.wheelSingleCol}
                />
              </View>
            ) : (
              <View style={styles.wheelDouble} key="ftin-wheel">
                <WheelColumn
                  options={FEET_OPTIONS}
                  selected={draftFeetInches.feet}
                  onSelect={(feet) => {
                    const nextCm = feetInchesToCm(feet, draftFeetInches.inches);
                    setDraftCm(clamp(nextCm, MIN_CM, MAX_CM));
                  }}
                  formatValue={(value) => `${value} ft`}
                  accentColor={theme.text}
                  borderColor={theme.border}
                  containerStyle={styles.wheelDoubleCol}
                />
                <WheelColumn
                  options={INCH_OPTIONS}
                  selected={draftFeetInches.inches}
                  onSelect={(inches) => {
                    const nextCm = feetInchesToCm(draftFeetInches.feet, inches);
                    setDraftCm(clamp(nextCm, MIN_CM, MAX_CM));
                  }}
                  formatValue={(value) => `${value} in`}
                  accentColor={theme.text}
                  borderColor={theme.border}
                  containerStyle={styles.wheelDoubleCol}
                />
              </View>
            )}
        </View>
      </KeyboardAwareBottomSheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12, paddingTop: 1 },
  h1: { fontSize: 26, fontWeight: '600' },
  sub: { fontSize: 13, lineHeight: 19, marginBottom: 2 },
  heightRow: {
    borderWidth: 1,
    borderRadius: 15,
    minHeight: 54,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 4,
  },
  leftRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, paddingRight: 8 },
  jobRow: {
    borderWidth: 1,
    borderRadius: 14,
    minHeight: 52,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  jobInput: { flex: 1, minHeight: 50, paddingVertical: 0, fontSize: 15 },
  ctaWrap: { marginTop: 6 },
  ctaButton: { opacity: 0.95 },
  sheet: {
    borderWidth: 1,
    borderBottomWidth: 0,
    maxHeight: '74%',
  },
  sheetTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheetTitle: { fontSize: 18, fontWeight: '700', flex: 1 },
  sheetActions: { flexDirection: 'row', alignItems: 'center' },
  actionBtn: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 6 },
  sheetValue: { marginTop: 4, marginBottom: 10, fontSize: 13 },
  unitSwitchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 12 },
  unitPrimaryChip: { flex: 1, minHeight: 36, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  unitSecondaryBtn: { minHeight: 30, justifyContent: 'center', paddingHorizontal: 2 },
  wheelSingle: { marginBottom: 8, minHeight: WHEEL_VISIBLE_ROWS * WHEEL_ITEM_HEIGHT },
  wheelDouble: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  wheelColumn: {
    height: WHEEL_VISIBLE_ROWS * WHEEL_ITEM_HEIGHT,
    borderRadius: 14,
    overflow: 'hidden',
  },
  wheelSingleCol: { width: '100%' },
  wheelDoubleCol: { flex: 1 },
  wheelContent: {
    paddingVertical: WHEEL_SIDE_PADDING,
  },
  wheelRow: {
    height: WHEEL_ITEM_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wheelSelectionBand: {
    position: 'absolute',
    left: 4,
    right: 4,
    top: WHEEL_SIDE_PADDING,
    height: WHEEL_ITEM_HEIGHT,
    borderWidth: 1,
    borderRadius: 10,
  },
});
