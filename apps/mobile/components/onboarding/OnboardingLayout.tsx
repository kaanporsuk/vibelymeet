import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { Text } from '@/components/Themed';

interface OnboardingLayoutProps {
  children: React.ReactNode;
  currentStep: number;
  totalSteps: number;
  onBack?: () => void;
  showProgress?: boolean;
  backgroundVariant?: 'default' | 'muted';
}

export default function OnboardingLayout({
  children,
  currentStep,
  totalSteps,
  onBack,
  showProgress = true,
  backgroundVariant = 'default',
}: OnboardingLayoutProps) {
  const theme = Colors[useColorScheme()];
  const progressPct = Math.max(0, Math.min(100, ((currentStep + 1) / totalSteps) * 100));
  const isMuted = backgroundVariant === 'muted';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <View style={styles.bgLayer}>
        <View style={[styles.glowOne, { backgroundColor: isMuted ? 'rgba(139,92,246,0.11)' : 'rgba(139,92,246,0.16)' }]} />
        <View style={[styles.glowTwo, { backgroundColor: isMuted ? 'rgba(232,67,147,0.07)' : 'rgba(232,67,147,0.12)' }]} />
      </View>

      {showProgress ? (
        <View style={[styles.progressTrack, { backgroundColor: theme.border }]}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${progressPct}%`,
                backgroundColor: theme.tint,
              },
            ]}
          />
        </View>
      ) : null}

      <View style={styles.headerRow}>
        {onBack ? (
          <Pressable onPress={onBack} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={theme.text} />
          </Pressable>
        ) : (
          <View style={styles.backBtn} />
        )}
        <Text style={[styles.stepText, { color: theme.textSecondary }]}>Step {currentStep + 1}/{totalSteps}</Text>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={[styles.card, { backgroundColor: 'rgba(20,20,24,0.55)', borderColor: theme.border }]}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  bgLayer: { ...StyleSheet.absoluteFillObject },
  glowOne: { position: 'absolute', width: 280, height: 280, borderRadius: 140, top: 80, left: -40 },
  glowTwo: { position: 'absolute', width: 320, height: 320, borderRadius: 160, bottom: -100, right: -60 },
  progressTrack: { height: 3, width: '100%' },
  progressFill: { height: 3 },
  headerRow: { minHeight: 44, paddingHorizontal: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 12 },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 16, paddingBottom: 24 },
  card: { width: '100%', maxWidth: 460, alignSelf: 'center', borderWidth: 1, borderRadius: 20, padding: 16 },
});
