import React, { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Themed';
import { VibelyButton } from '@/components/ui';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

function calculateAge(dateIso: string): number | null {
  if (!dateIso) return null;
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return null;
  const t = new Date();
  let age = t.getFullYear() - d.getFullYear();
  const m = t.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < d.getDate())) age -= 1;
  return age;
}

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
  const date = value ? new Date(value) : null;
  const day = date ? date.getDate() : 0;
  const month = date ? date.getMonth() + 1 : 0;
  const year = date ? date.getFullYear() : 0;
  const [activePicker, setActivePicker] = useState<PickerType>(null);
  const years = useMemo(() => {
    const max = new Date().getFullYear() - 18;
    const out: number[] = [];
    for (let y = max; y >= 1940; y -= 1) out.push(y);
    return out;
  }, []);
  const age = calculateAge(value);

  const setDate = (d: number, m: number, y: number) => {
    if (!d || !m || !y) return onChange('');
    const candidate = new Date(y, m - 1, d);
    if (candidate.getDate() !== d || candidate.getMonth() !== m - 1 || candidate.getFullYear() !== y) return;
    onChange(candidate.toISOString().split('T')[0]);
  };

  const handleContinue = () => {
    if (!value) return;
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
      <VibelyButton label="Continue" onPress={handleContinue} disabled={!value} variant="gradient" />

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
                    if (activePicker === 'day') setDate(item.value, month, year);
                    if (activePicker === 'month') setDate(day, item.value, year);
                    if (activePicker === 'year') setDate(day, month, item.value);
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
