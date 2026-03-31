import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Themed';
import { VibelyButton } from '@/components/ui';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

const OPTIONS = [
  { id: 'long_term', label: 'Relationship', emoji: '💕' },
  { id: 'short_term', label: 'Something casual', emoji: '🌊' },
  { id: 'not_sure', label: 'Not sure yet', emoji: '🤷' },
  { id: 'friends', label: 'New friends', emoji: '👋' },
  { id: 'open', label: 'Open to anything', emoji: '💬' },
];

export default function IntentStep({ value, onChange, onNext }: { value: string; onChange: (v: string) => void; onNext: () => void; }) {
  const theme = Colors[useColorScheme()];
  return (
    <View style={styles.root}>
      <Text style={[styles.h1, { color: theme.text }]}>What are you looking for?</Text>
      <Text style={[styles.sub, { color: theme.textSecondary }]}>No pressure. We'll match your vibe.</Text>
      <View style={styles.wrap}>
        {OPTIONS.map((o) => (
          <Pressable key={o.id} onPress={() => onChange(o.id)} style={[styles.chip, { borderColor: value === o.id ? theme.tint : theme.border, backgroundColor: value === o.id ? theme.tintSoft : 'transparent' }]}>
            <Text style={{ color: value === o.id ? theme.tint : theme.text }}>{o.emoji} {o.label}</Text>
          </Pressable>
        ))}
      </View>
      <VibelyButton label="Continue" onPress={onNext} disabled={!value} variant="gradient" />
    </View>
  );
}

const styles = StyleSheet.create({ root: { gap: 10 }, h1: { fontSize: 30, fontWeight: '700' }, sub: { fontSize: 14 }, wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { borderWidth: 1, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 12 } });
