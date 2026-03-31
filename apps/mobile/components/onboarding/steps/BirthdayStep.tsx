import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Picker } from '@react-native-picker/picker';
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

export default function BirthdayStep({ value, onChange, onNext }: { value: string; onChange: (v: string) => void; onNext: () => void }) {
  const theme = Colors[useColorScheme()];
  const date = value ? new Date(value) : null;
  const day = date ? date.getDate() : 0;
  const month = date ? date.getMonth() + 1 : 0;
  const year = date ? date.getFullYear() : 0;
  const years = useMemo(() => {
    const max = new Date().getFullYear() - 18;
    const out: number[] = [];
    for (let y = max; y >= 1940; y -= 1) out.push(y);
    return out;
  }, []);
  const age = calculateAge(value);
  const valid = !!value && (age ?? 0) >= 18;

  const setDate = (d: number, m: number, y: number) => {
    if (!d || !m || !y) return onChange('');
    const candidate = new Date(y, m - 1, d);
    if (candidate.getDate() !== d || candidate.getMonth() !== m - 1 || candidate.getFullYear() !== y) return;
    onChange(candidate.toISOString());
  };

  return (
    <View style={styles.root}>
      <Text style={[styles.h1, { color: theme.text }]}>When's your birthday?</Text>
      <Text style={[styles.sub, { color: theme.textSecondary }]}>You must be 18+ to use Vibely.</Text>
      <View style={styles.row}>
        <View style={[styles.pick, { borderColor: theme.border }]}><Picker selectedValue={day} onValueChange={(v: number) => setDate(Number(v), month, year)}>{[0, ...Array.from({ length: 31 }, (_, i) => i + 1)].map((d) => <Picker.Item key={d} label={d === 0 ? 'Day' : String(d)} value={d} />)}</Picker></View>
        <View style={[styles.pick, { borderColor: theme.border }]}><Picker selectedValue={month} onValueChange={(v: number) => setDate(day, Number(v), year)}>{[0, ...Array.from({ length: 12 }, (_, i) => i + 1)].map((m) => <Picker.Item key={m} label={m === 0 ? 'Month' : String(m)} value={m} />)}</Picker></View>
        <View style={[styles.pick, { borderColor: theme.border }]}><Picker selectedValue={year} onValueChange={(v: number) => setDate(day, month, Number(v))}>{[0, ...years].map((y) => <Picker.Item key={y} label={y === 0 ? 'Year' : String(y)} value={y} />)}</Picker></View>
      </View>
      {age != null ? <Text style={{ color: theme.textSecondary }}>You're {age}</Text> : null}
      <VibelyButton label="Continue" onPress={onNext} disabled={!valid} variant="gradient" />
    </View>
  );
}

const styles = StyleSheet.create({ root: { gap: 12 }, h1: { fontSize: 30, fontWeight: '700' }, sub: { fontSize: 14 }, row: { flexDirection: 'row', gap: 8 }, pick: { flex: 1, borderWidth: 1, borderRadius: 12, overflow: 'hidden' } });
