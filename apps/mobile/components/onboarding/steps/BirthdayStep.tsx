import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Themed';
import { VibelyButton } from '@/components/ui';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { calculateAgeFromIsoDate, daysInMonth, formatIsoDate, parseDateParts } from '@/components/onboarding/dateUtils';

type PickerType = 'day' | 'month' | 'year' | null;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export default function BirthdayStep({
  value,
  onChange,
  onNext,
  onAgeBlocked,
}: {
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
  onAgeBlocked: () => void;
}) {
  const theme = Colors[useColorScheme()];
  const parsed = parseDateParts(value);
  const [selectedDay, setSelectedDay] = useState(parsed?.day ?? 0);
  const [selectedMonth, setSelectedMonth] = useState(parsed?.month ?? 0);
  const [selectedYear, setSelectedYear] = useState(parsed?.year ?? 0);
  const day = selectedDay;
  const month = selectedMonth;
  const year = selectedYear;
  const [activePicker, setActivePicker] = useState<PickerType>(null);
  const years = useMemo(() => {
    const max = new Date().getFullYear() - 18;
    const out: number[] = [];
    for (let y = max; y >= 1940; y -= 1) out.push(y);
    return out;
  }, []);
  const fullDateValue =
    day && month && year
      ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      : '';
  const age = calculateAgeFromIsoDate(fullDateValue || value);

  useEffect(() => {
    const next = parseDateParts(value);
    setSelectedDay(next?.day ?? 0);
    setSelectedMonth(next?.month ?? 0);
    setSelectedYear(next?.year ?? 0);
  }, [value]);

  const commitDate = (d: number, m: number, y: number) => {
    if (!d || !m || !y) {
      onChange('');
      return;
    }
    const maxDay = daysInMonth(y, m);
    const safeDay = Math.min(d, maxDay);
    const candidate = new Date(y, m - 1, safeDay);
    if (candidate.getDate() !== safeDay || candidate.getMonth() !== m - 1 || candidate.getFullYear() !== y) {
      onChange('');
      return;
    }
    onChange(formatIsoDate({ year: y, month: m, day: safeDay }));
  };

  const applySelection = (next: { day?: number; month?: number; year?: number }) => {
    const rawDay = next.day ?? day;
    const rawMonth = next.month ?? month;
    const rawYear = next.year ?? year;
    const clampedDay =
      rawDay && rawMonth && rawYear
        ? Math.min(rawDay, daysInMonth(rawYear, rawMonth))
        : rawDay;

    setSelectedDay(clampedDay);
    setSelectedMonth(rawMonth);
    setSelectedYear(rawYear);
    commitDate(clampedDay, rawMonth, rawYear);
  };

  const handleContinue = () => {
    if (!fullDateValue) return;
    if (age != null && age < 18) {
      Alert.alert('Age restriction', 'Vibely is for adults 18 and over.', [
        { text: 'OK', onPress: onAgeBlocked },
      ]);
      return;
    }
    onNext();
  };

  const pickerItems =
    activePicker === 'day'
      ? Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: String(i + 1) }))
      : activePicker === 'month'
        ? MONTHS.map((label, i) => ({ value: i + 1, label }))
        : years.map((y) => ({ value: y, label: String(y) }));

  return (
    <View style={styles.root}>
      <Text style={[styles.h1, { color: theme.text }]}>When's your birthday?</Text>
      <Text style={[styles.sub, { color: theme.textSecondary }]}>You must be 18+ to use Vibely.</Text>
      <View style={styles.row}>
        <Pressable onPress={() => setActivePicker('day')} style={[styles.pick, { borderColor: theme.border }]}>
          <Text style={{ color: day ? theme.text : theme.textSecondary }}>{day || 'Day'}</Text>
        </Pressable>
        <Pressable onPress={() => setActivePicker('month')} style={[styles.pick, { borderColor: theme.border }]}>
          <Text style={{ color: month ? theme.text : theme.textSecondary }}>{month ? MONTHS[month - 1] : 'Month'}</Text>
        </Pressable>
        <Pressable onPress={() => setActivePicker('year')} style={[styles.pick, { borderColor: theme.border }]}>
          <Text style={{ color: year ? theme.text : theme.textSecondary }}>{year || 'Year'}</Text>
        </Pressable>
      </View>
      {age != null ? <Text style={{ color: theme.textSecondary }}>You're {age}</Text> : null}
      <VibelyButton label="Continue" onPress={handleContinue} disabled={!fullDateValue} variant="gradient" />

      <Modal visible={!!activePicker} transparent animationType="fade" onRequestClose={() => setActivePicker(null)}>
        <Pressable style={styles.overlay} onPress={() => setActivePicker(null)}>
          <Pressable style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.sheetTitle, { color: theme.text }]}>
              Select {activePicker === 'day' ? 'day' : activePicker === 'month' ? 'month' : 'year'}
            </Text>
            <ScrollView style={styles.sheetList} showsVerticalScrollIndicator={false}>
              {pickerItems.map((item) => (
                <Pressable
                  key={`${activePicker}-${item.value}`}
                  onPress={() => {
                    if (activePicker === 'day') applySelection({ day: item.value });
                    if (activePicker === 'month') applySelection({ month: item.value });
                    if (activePicker === 'year') applySelection({ year: item.value });
                    setActivePicker(null);
                  }}
                  style={[styles.sheetItem, { borderColor: theme.border }]}
                >
                  <Text style={{ color: theme.text }}>{item.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  h1: { fontSize: 30, fontWeight: '700' },
  sub: { fontSize: 14 },
  row: { flexDirection: 'row', gap: 8 },
  pick: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderBottomWidth: 0,
    padding: 16,
    maxHeight: '65%',
  },
  sheetTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
  sheetList: { maxHeight: 360 },
  sheetItem: {
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 8,
  },
});
