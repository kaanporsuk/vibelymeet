import React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Text } from '@/components/Themed';
import { VibelyButton } from '@/components/ui';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

export default function BasicsStep({ heightCm, job, onHeightChange, onJobChange, onNext }: { heightCm: number | null; job: string; onHeightChange: (v: number | null) => void; onJobChange: (v: string) => void; onNext: () => void; }) {
  const theme = Colors[useColorScheme()];
  const value = heightCm == null ? '' : String(heightCm);

  return (
    <View style={styles.root}>
      <Text style={[styles.h1, { color: theme.text }]}>A couple more details</Text>
      <Text style={[styles.sub, { color: theme.textSecondary }]}>These help with matching, but they're optional.</Text>
      <TextInput
        value={value}
        onChangeText={(t) => onHeightChange(t.trim() ? Number(t.replace(/\D/g, '').slice(0, 3)) : null)}
        placeholder="Height in cm"
        placeholderTextColor={theme.textSecondary}
        keyboardType="number-pad"
        style={[styles.input, { borderColor: theme.border, color: theme.text }]}
      />
      <TextInput
        value={job}
        onChangeText={onJobChange}
        placeholder="Designer, student, chef, dreamer..."
        placeholderTextColor={theme.textSecondary}
        style={[styles.input, { borderColor: theme.border, color: theme.text }]}
      />
      <VibelyButton label="Continue" onPress={onNext} variant="gradient" />
    </View>
  );
}

const styles = StyleSheet.create({ root: { gap: 12 }, h1: { fontSize: 30, fontWeight: '700' }, sub: { fontSize: 14 }, input: { borderWidth: 1, borderRadius: 14, minHeight: 48, paddingHorizontal: 12 } });
