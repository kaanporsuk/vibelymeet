/**
 * How Vibely Works - aligned with web src/pages/HowItWorks.tsx
 */
import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { spacing, typography, layout, radius, shadows } from '@/constants/theme';
import { Card, GlassSurface, VibelyText } from '@/components/ui';

type IconName = keyof typeof Ionicons.glyphMap;
type Tone = 'violet' | 'pink' | 'cyan';

type InfoItem = {
  icon: IconName;
  title: string;
  body: string;
  tone: Tone;
};

type InfoSection = {
  title: string;
  intro?: string;
  items: InfoItem[];
};

const BADGES = ['Event-based', 'Video-first', 'Consent-led'];

const VIBELY_LOOP: InfoItem[] = [
  {
    icon: 'person-outline',
    title: 'Build your vibe',
    body: 'Create a profile that shows your energy with photos, prompts, Vibe Video, Vibe Score, and verification.',
    tone: 'violet',
  },
  {
    icon: 'calendar-outline',
    title: 'Choose an event',
    body: 'Join curated social and dating events. Start nearby, or use premium city discovery to explore more places.',
    tone: 'pink',
  },
  {
    icon: 'people-outline',
    title: 'Vibe in the live lobby',
    body: 'When an event goes live, browse guests in the event lobby and send a Vibe when someone feels right.',
    tone: 'cyan',
  },
  {
    icon: 'checkmark-circle-outline',
    title: 'Both get ready',
    body: 'When the interest is mutual, the Ready Gate opens. You both opt in before the live video date begins.',
    tone: 'violet',
  },
  {
    icon: 'videocam-outline',
    title: 'Meet face-to-face',
    body: 'Start with a progressive-blur video moment, feel the chemistry, then decide if you both want to keep going.',
    tone: 'pink',
  },
];

const INFO_SECTIONS: InfoSection[] = [
  {
    title: 'Your Vibe, Not Just Your Photos',
    intro: 'Profiles are built to help people feel who you are before the first live moment.',
    items: [
      {
        icon: 'videocam-outline',
        title: 'Vibe Video',
        body: 'A short intro that helps people feel your energy before you meet.',
        tone: 'pink',
      },
      {
        icon: 'speedometer-outline',
        title: 'Vibe Score',
        body: 'A profile-quality signal that rewards a more complete, more trustworthy profile.',
        tone: 'violet',
      },
      {
        icon: 'sparkles-outline',
        title: 'Profile Studio',
        body: 'Your space to shape how you show up: photos, prompts, about me, looking for, vibes, schedule, verification, and invites.',
        tone: 'cyan',
      },
    ],
  },
  {
    title: 'More Ways to Connect',
    items: [
      {
        icon: 'gift-outline',
        title: 'Daily Drops',
        body: 'Curated introductions for when you are not in a live event.',
        tone: 'cyan',
      },
      {
        icon: 'chatbubble-ellipses-outline',
        title: 'Chat That Keeps the Vibe Going',
        body: 'Keep the vibe going with messages and richer conversation tools after a mutual connection.',
        tone: 'pink',
      },
      {
        icon: 'time-outline',
        title: 'Vibe Schedule',
        body: 'Make planning easier when the connection feels right.',
        tone: 'violet',
      },
      {
        icon: 'person-add-outline',
        title: 'Invite Friends',
        body: 'Bring people into Vibely or invite them to a specific event.',
        tone: 'cyan',
      },
    ],
  },
  {
    title: 'Trust Built In',
    items: [
      {
        icon: 'checkmark-circle-outline',
        title: 'Readiness before video',
        body: 'Both people confirm before entering a live date.',
        tone: 'violet',
      },
      {
        icon: 'eye-outline',
        title: 'Progressive-blur start',
        body: 'Ease into the moment before full face-to-face video.',
        tone: 'pink',
      },
      {
        icon: 'shield-checkmark-outline',
        title: 'Verification and age checks',
        body: 'Verification, age checks, reporting, blocking, and end-call controls help protect the experience.',
        tone: 'cyan',
      },
      {
        icon: 'call-outline',
        title: 'Report, block, or end anytime',
        body: 'You stay in control before, during, and after the date.',
        tone: 'violet',
      },
    ],
  },
];

function getTone(theme: typeof Colors.light, tone: Tone) {
  if (tone === 'pink') {
    return {
      color: theme.neonPink,
      backgroundColor: 'rgba(232, 67, 147, 0.14)',
      borderColor: 'rgba(232, 67, 147, 0.28)',
    };
  }

  if (tone === 'cyan') {
    return {
      color: theme.neonCyan,
      backgroundColor: 'rgba(6, 182, 212, 0.14)',
      borderColor: 'rgba(6, 182, 212, 0.28)',
    };
  }

  return {
    color: theme.neonViolet,
    backgroundColor: theme.tintSoft,
    borderColor: 'rgba(139, 92, 246, 0.3)',
  };
}

function InfoCard({ item, compact = false }: { item: InfoItem; compact?: boolean }) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const tone = getTone(theme, item.tone);

  return (
    <Card
      variant="glass"
      style={[
        styles.infoCard,
        compact && styles.infoCardCompact,
        { borderColor: tone.borderColor },
      ]}
    >
      <View style={compact ? styles.infoCardRow : styles.infoCardStack}>
        <View
          style={[
            styles.infoIcon,
            {
              backgroundColor: tone.backgroundColor,
              borderColor: tone.borderColor,
            },
          ]}
        >
          <Ionicons name={item.icon} size={22} color={tone.color} />
        </View>
        <View style={styles.infoText}>
          <Text style={[styles.infoTitle, { color: theme.text }]}>{item.title}</Text>
          <Text style={[styles.infoBody, { color: theme.mutedForeground }]}>{item.body}</Text>
        </View>
      </View>
    </Card>
  );
}

export default function HowItWorksScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const appRouter = useRouter();

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
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.8 }]}
        >
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </Pressable>
        <VibelyText variant="titleMD" style={[styles.headerTitle, { color: theme.text }]}>
          How Vibely Works
        </VibelyText>
      </GlassSurface>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: layout.scrollContentPaddingBottomTab + Math.max(insets.bottom, spacing.xl) + 40 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Card variant="glass" style={[styles.heroCard, { borderColor: 'rgba(139, 92, 246, 0.24)' }]}>
          <View style={[styles.heroIcon, { backgroundColor: theme.tintSoft, borderColor: 'rgba(255,255,255,0.1)' }]}>
            <Ionicons name="heart-circle-outline" size={38} color={theme.tint} />
          </View>
          <Text style={[styles.heroTitle, { color: theme.text }]}>Meet through real moments.</Text>
          <Text style={[styles.heroBody, { color: theme.mutedForeground }]}>
            Vibely is video-first social dating built around curated events, readiness-gated live dates, and profiles
            that show more than photos.
          </Text>
          <View style={styles.badgeRow}>
            {BADGES.map((badge) => (
              <View key={badge} style={[styles.badge, { backgroundColor: theme.secondary, borderColor: theme.border }]}>
                <Text style={[styles.badgeText, { color: theme.text }]}>{badge}</Text>
              </View>
            ))}
          </View>
          <Pressable
            onPress={() => appRouter.push('/(tabs)/events')}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.ctaBtn,
              { backgroundColor: theme.tint, opacity: pressed ? 0.92 : 1 },
            ]}
          >
            <Ionicons name="calendar-outline" size={19} color="#FFFFFF" />
            <Text style={styles.ctaLabel}>Find Your First Event</Text>
          </Pressable>
        </Card>

        <View style={styles.section}>
          <Text style={[styles.sectionKicker, { color: theme.tint }]}>The Vibely Loop</Text>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>From profile to real chemistry.</Text>
          <View style={styles.cardList}>
            {VIBELY_LOOP.map((item) => (
              <InfoCard key={item.title} item={item} compact />
            ))}
          </View>
        </View>

        {INFO_SECTIONS.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>{section.title}</Text>
            {section.intro ? (
              <Text style={[styles.sectionIntro, { color: theme.mutedForeground }]}>{section.intro}</Text>
            ) : null}
            <View style={styles.cardList}>
              {section.items.map((item) => (
                <InfoCard
                  key={item.title}
                  item={item}
                  compact={section.items.length > 3}
                />
              ))}
            </View>
          </View>
        ))}

        <Card variant="glass" style={[styles.finalCard, { borderColor: 'rgba(139, 92, 246, 0.3)' }]}>
          <View style={[styles.finalIcon, { backgroundColor: theme.tintSoft }]}>
            <Ionicons name="shield-checkmark-outline" size={28} color={theme.tint} />
          </View>
          <Text style={[styles.finalTitle, { color: theme.text }]}>Ready to meet your first real vibe?</Text>
          <Text style={[styles.finalBody, { color: theme.mutedForeground }]}>
            Join an event, build your profile, and start meeting people through moments that actually feel human.
          </Text>
          <Pressable
            onPress={() => appRouter.push('/(tabs)/events')}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.ctaBtn,
              { backgroundColor: theme.tint, opacity: pressed ? 0.92 : 1 },
            ]}
          >
            <Ionicons name="calendar-outline" size={19} color="#FFFFFF" />
            <Text style={styles.ctaLabel}>Find Your First Event</Text>
          </Pressable>
        </Card>
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
  backButton: {
    minWidth: 40,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -spacing.sm,
  },
  headerTitle: { flex: 1 },
  scroll: {
    padding: layout.containerPadding,
    paddingTop: spacing.xl,
  },
  heroCard: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  heroIcon: {
    width: 72,
    height: 72,
    borderRadius: radius['2xl'],
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    ...shadows.glowViolet,
  },
  heroTitle: {
    ...typography.titleXL,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  heroBody: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 23,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  badge: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  section: {
    marginTop: spacing['2xl'],
  },
  sectionKicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    ...typography.titleLG,
    textAlign: 'center',
  },
  sectionIntro: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  cardList: {
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  infoCard: {
    padding: spacing.lg,
  },
  infoCardCompact: {
    padding: spacing.md,
  },
  infoCardRow: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  infoCardStack: {
    gap: spacing.md,
  },
  infoIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoText: {
    flex: 1,
    minWidth: 0,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 21,
  },
  infoBody: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 5,
  },
  finalCard: {
    padding: spacing.xl,
    alignItems: 'center',
    marginTop: spacing['2xl'],
  },
  finalIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  finalTitle: {
    ...typography.titleLG,
    textAlign: 'center',
  },
  finalBody: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  ctaBtn: {
    marginTop: spacing.xl,
    minHeight: 52,
    width: '100%',
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    ...shadows.glowViolet,
  },
  ctaLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
});
