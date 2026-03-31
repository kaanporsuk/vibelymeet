import React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Text } from '@/components/Themed';
import { VibelyButton } from '@/components/ui';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

export default function NameStep({ value, onChange, onNext }: { value: string; onChange: (v: string) => void; onNext: () => void }) {
  const theme = Colors[useColorScheme()];
  const ok = value.trim().length > 0;
  return (
    <View style={styles.root}>
      <Text style={[styles.h1, { color: theme.text }]}>What's your first name?</Text>
      <Text style={[styles.sub, { color: theme.textSecondary }]}>This is how you'll appear on Vibely.</Text>
      <TextInput
        autoFocus
        value={value}
        onChangeText={onChange}
        placeholder="Your first name"
        placeholderTextColor={theme.textSecondary}
        maxLength={20}
        style={[styles.input, { borderColor: theme.border, color: theme.text }]}
      />
      <VibelyButton label="Continue" onPress={() => onNext()} disabled={!ok} variant="gradient" />
    </View>
  );
}

const styles = StyleSheet.create({ root: { gap: 12 }, h1: { fontSize: 30, fontWeight: '700' }, sub: { fontSize: 14 }, input: { borderWidth: 1, borderRadius: 14, minHeight: 48, paddingHorizontal: 12 } });
