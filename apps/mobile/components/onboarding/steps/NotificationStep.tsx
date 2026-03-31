import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Themed';
import { VibelyButton } from '@/components/ui';
import { registerPushWithBackend } from '@/lib/onesignal';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

export default function NotificationStep({ userId, onNext }: { userId: string; onNext: () => void }) {
  const theme = Colors[useColorScheme()];
  const ask = async () => {
    await registerPushWithBackend(userId);
    onNext();
  };
  return (
    <View style={styles.root}>
      <Text style={[styles.h1, { color: theme.text }]}>Don't miss a vibe</Text>
      <Text style={[styles.sub, { color: theme.textSecondary }]}>Matches, events, and date reminders.</Text>
      <View style={[styles.mockCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
        <Text style={{ color: theme.text }}>🎉 You matched with Alex at Friday Night Social!</Text>
      </View>
      <VibelyButton label="Turn on notifications" onPress={ask} variant="gradient" />
      <Pressable onPress={onNext}><Text style={{ color: theme.textSecondary, textAlign: 'center' }}>Maybe later</Text></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({ root: { gap: 12 }, h1: { fontSize: 30, fontWeight: '700' }, sub: { fontSize: 14 }, mockCard: { borderWidth: 1, borderRadius: 14, padding: 12 } });
