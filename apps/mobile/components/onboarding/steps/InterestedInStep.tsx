import React from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { Text } from '@/components/Themed';
import { VibelyButton } from '@/components/ui';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

const OPTIONS = ['men', 'women', 'everyone'];

export default function InterestedInStep({ value, showOnProfile, onChange, onToggleShow, onNext }: { value: string; showOnProfile: boolean; onChange: (v: string) => void; onToggleShow: (v: boolean) => void; onNext: () => void; }) {
  const theme = Colors[useColorScheme()];
  return (
    <View style={styles.root}>
      <Text style={[styles.h1, { color: theme.text }]}>Who are you interested in?</Text>
      {OPTIONS.map((opt) => (
        <Pressable key={opt} onPress={() => onChange(opt)} style={[styles.opt, { borderColor: value === opt ? theme.tint : theme.border, backgroundColor: value === opt ? theme.tintSoft : 'transparent' }]}>
          <Text style={{ color: value === opt ? theme.tint : theme.text, textTransform: 'capitalize', fontWeight: '600' }}>{opt}</Text>
        </Pressable>
      ))}
      <View style={styles.toggle}><Text style={{ color: theme.textSecondary }}>Show on profile</Text><Switch value={showOnProfile} onValueChange={onToggleShow} /></View>
      <VibelyButton label="Continue" onPress={onNext} disabled={!value} variant="gradient" />
    </View>
  );
}

const styles = StyleSheet.create({ root: { gap: 10 }, h1: { fontSize: 30, fontWeight: '700', marginBottom: 4 }, opt: { borderWidth: 1, borderRadius: 14, minHeight: 48, justifyContent: 'center', paddingHorizontal: 12 }, toggle: { marginVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' } });
