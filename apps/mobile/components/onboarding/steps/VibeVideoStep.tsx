import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Themed';
import { VibelyButton } from '@/components/ui';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { router } from 'expo-router';

export default function VibeVideoStep({ onNext }: { onNext: () => void }) {
  const theme = Colors[useColorScheme()];
  const openRecorder = (intent: 'record' | 'library') => {
    router.push({
      pathname: '/vibe-video-record',
      params: {
        sourceIntent: intent,
        onboardingFlow: '1',
      },
    });
  };

  return (
    <View style={styles.root}>
      <Text style={[styles.h1, { color: theme.text }]}>Stand out with a Vibe Video</Text>
      <Text style={[styles.sub, { color: theme.textSecondary }]}>30-second intro videos get more engagement.</Text>
      <View style={[styles.mock, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
        <Text style={{ color: theme.textSecondary }}>Open the camera studio to record or upload your intro.</Text>
      </View>
      <VibelyButton label="Record a Vibe Video" onPress={() => openRecorder('record')} variant="gradient" />
      <VibelyButton label="Upload from library" onPress={() => openRecorder('library')} variant="secondary" />
      <Pressable onPress={onNext}><Text style={{ color: theme.textSecondary, textAlign: 'center' }}>I'll do this later</Text></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  h1: { fontSize: 30, fontWeight: '700' },
  sub: { fontSize: 14 },
  mock: { borderWidth: 1, borderRadius: 14, minHeight: 180, alignItems: 'center', justifyContent: 'center' },
});
