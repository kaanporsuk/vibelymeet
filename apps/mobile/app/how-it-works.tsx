/**
 * How Vibely Works — aligned with web src/pages/HowItWorks.tsx
 */
import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { spacing, typography, layout, radius } from '@/constants/theme';
import { Card, GlassSurface, VibelyText } from '@/components/ui';

const STEPS = [
  {
    icon: 'calendar-outline' as const,
    title: 'Join an Event',
    body: 'Browse curated speed dating events and pick one that matches your vibe. Each event has a unique theme and audience.',
  },
  {
    icon: 'videocam-outline' as const,
    title: '5-Minute Video Dates',
    body: 'Connect with matches through quick video calls. No endless swiping — just real conversations with real people.',
  },
  {
    icon: 'heart-outline' as const,
    title: 'Match by Vibes',
    body: 'After each date, decide if you felt a connection. When both of you say yes, it’s a match! Start chatting instantly.',
  },
  {
    icon: 'chatbubble-outline' as const,
    title: 'Continue the Conversation',
    body: 'Keep the spark alive through chat. Send messages, voice notes, and play fun games to get to know each other better.',
  },
];

const FEATURES = [
  {
    emoji: '💧',
    title: 'Daily Drops',
    body: 'One curated match each day after the scheduled batch (18:00 UTC when cron is enabled).',
  },
  { emoji: '🎮', title: 'Vibe Arcade', body: 'Play games in chat to break the ice' },
  { emoji: '📅', title: 'Vibe Sync', body: 'Schedule dates that work for both of you' },
  { emoji: '🎬', title: 'Vibe Videos', body: 'Short intro videos to show your personality' },
];

export default function HowItWorksScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <GlassSurface
        style={[
          styles.header,
          {
            paddingTop: insets.top + spacing.sm,
            paddingBottom: spacing.md,
            paddingHorizontal: layout.containerPadding,
          },
        ]}
      >
        <Pressable onPress={() => router.back()} style={({ pressed }) => [pressed && { opacity: 0.8 }]}>
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </Pressable>
        <VibelyText variant="titleMD" style={[styles.headerTitle, { color: theme.text }]}>
          How Vibely Works
        </VibelyText>
      </GlassSurface>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: layout.scrollContentPaddingBottomTab }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.heroIcon, { backgroundColor: theme.tintSoft }]}>
          <Ionicons name="sparkles" size={40} color={theme.tint} />
        </View>
        <Text style={[styles.heroTitle, { color: theme.text }]}>Find Your Vibe</Text>
        <Text style={[styles.heroBody, { color: theme.mutedForeground }]}>
          Vibely is video speed dating reimagined. No endless swiping, no ghosting — just real connections through
          face-to-face conversations.
        </Text>

        <Text style={[styles.sectionLabel, { color: theme.text }]}>How It Works</Text>
        {STEPS.map((step, i) => (
          <Card key={step.title} variant="glass" style={styles.stepCard}>
            <View style={[styles.stepIcon, { backgroundColor: theme.tintSoft }]}>
              <Ionicons name={step.icon} size={28} color={theme.tint} />
            </View>
            <Text style={[styles.stepNum, { color: theme.mutedForeground }]}>Step {i + 1}</Text>
            <Text style={[styles.stepTitle, { color: theme.text }]}>{step.title}</Text>
            <Text style={[styles.stepBody, { color: theme.mutedForeground }]}>{step.body}</Text>
          </Card>
        ))}

        <Text style={[styles.sectionLabel, { color: theme.text, marginTop: spacing.lg }]}>Features</Text>
        <View style={styles.featureGrid}>
          {FEATURES.map((f) => (
            <Card key={f.title} variant="glass" style={styles.featureCard}>
              <Text style={styles.featureEmoji}>{f.emoji}</Text>
              <Text style={[styles.featureTitle, { color: theme.text }]}>{f.title}</Text>
              <Text style={[styles.featureBody, { color: theme.mutedForeground }]}>{f.body}</Text>
            </Card>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  headerTitle: { flex: 1 },
  scroll: { padding: layout.containerPadding, paddingTop: spacing.xl },
  heroIcon: {
    width: 80,
    height: 80,
    borderRadius: radius['2xl'],
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  heroTitle: { ...typography.titleXL, textAlign: 'center', marginBottom: spacing.sm },
  heroBody: { fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: spacing.xl },
  sectionLabel: { ...typography.titleMD, marginBottom: spacing.md, textAlign: 'center' },
  stepCard: { padding: spacing.xl, alignItems: 'center', marginBottom: spacing.md },
  stepIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  stepNum: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
  stepTitle: { ...typography.titleMD, marginBottom: 8, textAlign: 'center' },
  stepBody: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  featureGrid: { gap: spacing.md },
  featureCard: { padding: spacing.lg },
  featureEmoji: { fontSize: 28, marginBottom: spacing.sm },
  featureTitle: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  featureBody: { fontSize: 13, lineHeight: 18 },
});
