import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Themed';
import { VibelyButton } from '@/components/ui';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

const OPTIONS = ['men', 'women', 'everyone'];

export default function InterestedInStep({ value, onChange, onNext }: { value: string; onChange: (v: string) => void; onNext: () => void; }) {
  const theme = Colors[useColorScheme()];
  return (
    <View style={styles.root}>
      <Text style={[styles.h1, { color: theme.text }]}>Who are you interested in?</Text>
      {OPTIONS.map((opt) => (
        <Pressable key={opt} onPress={() => onChange(opt)} style={[styles.opt, { borderColor: value === opt ? theme.tint : theme.border, backgroundColor: value === opt ? theme.tintSoft : 'transparent' }]}>
          <Text style={{ color: value === opt ? theme.tint : theme.text, textTransform: 'capitalize', fontWeight: '600' }}>{opt}</Text>
        </Pressable>
      ))}
      <VibelyButton label="Continue" onPress={onNext} disabled={!value} variant="gradient" />
    </View>
  );
}

const styles = StyleSheet.create({ root: { gap: 10 }, h1: { fontSize: 30, fontWeight: '700', marginBottom: 4 }, opt: { borderWidth: 1, borderRadius: 14, minHeight: 48, justifyContent: 'center', paddingHorizontal: 12 } });
