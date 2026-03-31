import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Text } from '@/components/Themed';
import { VibelyButton } from '@/components/ui';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

const PLACEHOLDERS = [
  'Coffee snob and sunset chaser...',
  "I'll beat you at Mario Kart...",
  'Looking for my partner in crime...',
  'Dog person pretending to like cats...',
  "Let's grab drinks at that place we both walk past...",
];

export default function AboutMeStep({ value, onChange, onNext }: { value: string; onChange: (v: string) => void; onNext: () => void; }) {
  const theme = Colors[useColorScheme()];
  const [pIdx, setPIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPIdx((x) => (x + 1) % PLACEHOLDERS.length), 3000);
    return () => clearInterval(t);
  }, []);
  const trimmed = value.trim();
  const valid = trimmed.length === 0 || trimmed.length >= 10;

  return (
    <View style={styles.root}>
      <Text style={[styles.h1, { color: theme.text }]}>Tell them something memorable</Text>
      <Text style={[styles.sub, { color: theme.textSecondary }]}>You have 3 seconds to make an impression.</Text>
      <TextInput
        value={value}
        onChangeText={(t) => onChange(t.slice(0, 140))}
        multiline
        placeholder={PLACEHOLDERS[pIdx]}
        placeholderTextColor={theme.textSecondary}
        style={[styles.input, { borderColor: theme.border, color: theme.text }]}
      />
      <Text style={[styles.counter, { color: theme.textSecondary }]}>{140 - value.length} chars left</Text>
      <Pressable onPress={() => { onChange(''); onNext(); }}><Text style={{ color: theme.textSecondary, textAlign: 'center' }}>I'll write this later</Text></Pressable>
      <VibelyButton label="Continue" onPress={onNext} disabled={!valid} variant="gradient" />
    </View>
  );
}

const styles = StyleSheet.create({ root: { gap: 10 }, h1: { fontSize: 30, fontWeight: '700' }, sub: { fontSize: 14 }, input: { borderWidth: 1, borderRadius: 14, minHeight: 110, paddingHorizontal: 12, paddingVertical: 10, textAlignVertical: 'top' }, counter: { textAlign: 'right', fontSize: 12 } });
