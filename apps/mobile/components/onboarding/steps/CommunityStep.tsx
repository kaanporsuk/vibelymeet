import React from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Themed';
import { VibelyButton } from '@/components/ui';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

export default function CommunityStep({ onAgree }: { onAgree: () => void }) {
  const theme = Colors[useColorScheme()];
  return (
    <View style={styles.root}>
      <Text style={[styles.h1, { color: theme.text }]}>Our community rules</Text>
      <Text style={[styles.sub, { color: theme.textSecondary }]}>Vibely is built on respect.</Text>
      <Text style={{ color: theme.text }}>🤝 Be genuine — Real photos, real intentions.</Text>
      <Text style={{ color: theme.text }}>💬 Be respectful — Consent matters, always.</Text>
      <Text style={{ color: theme.text }}>🚫 Zero tolerance — Harassment, hate speech, fraud = ban.</Text>
      <VibelyButton label="I agree, let's go" onPress={onAgree} variant="gradient" />
      <Pressable onPress={() => Linking.openURL('https://vibelymeet.com/community-guidelines')}><Text style={{ color: theme.textSecondary, textAlign: 'center' }}>Read full guidelines</Text></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({ root: { gap: 10 }, h1: { fontSize: 30, fontWeight: '700' }, sub: { fontSize: 14 } });
