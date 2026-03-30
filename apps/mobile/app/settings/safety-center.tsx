import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, layout, radius, typography } from '@/constants/theme';
import { withAlpha } from '@/lib/colorUtils';

type FeatureCard = {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  title: string;
  description: string;
};

type TipCard = {
  title: string;
  description: string;
};

type EmergencyContact = {
  flag: string;
  label: string;
  number: string;
  dial: string;
};

const FEATURE_CARDS: FeatureCard[] = [
  {
    icon: 'videocam',
    color: '#8B5CF6',
    title: 'Consent-Gated Video',
    description: "Both people must confirm they're ready before any video date begins. No surprise calls, ever.",
  },
  {
    icon: 'shield-checkmark',
    color: '#22D3EE',
    title: 'Photo Verification',
    description: "Selfie verification helps confirm you're talking to a real person, not a fake profile.",
  },
  {
    icon: 'calendar',
    color: '#E84393',
    title: 'Event-Gated Matching',
    description: 'You can only match with people attending the same event. No random strangers in your inbox.',
  },
  {
    icon: 'eye-off',
    color: '#F59E0B',
    title: 'Block & Report',
    description: 'Block anyone instantly. Report inappropriate behavior and our team reviews it as a priority.',
  },
];

const ONLINE_TIPS: TipCard[] = [
  {
    title: 'Take your time',
    description:
      "Don't feel pressured to share personal information like your phone number, address, or workplace too quickly. Use Vibely's in-app chat.",
  },
  {
    title: 'Keep conversations on Vibely',
    description:
      'Scammers often try to move conversations to other platforms quickly. Stay on Vibely where our safety tools protect you.',
  },
  {
    title: 'Trust your instincts',
    description:
      'If something feels off about a person or conversation, trust that feeling. You can block or report at any time.',
  },
  {
    title: 'Protect your finances',
    description:
      "Never send money or financial information to someone you've met online, no matter how convincing their story.",
  },
  {
    title: 'Video date first',
    description:
      "Vibely's video dates let you see and talk to someone before meeting in person. Use them.",
  },
];

const IN_PERSON_TIPS: TipCard[] = [
  {
    title: 'Meet in public',
    description:
      'Choose a busy, well-lit public place for your first few meetings. Coffee shops, restaurants, and public events are great choices.',
  },
  {
    title: 'Tell someone your plans',
    description:
      "Share where you're going, who you're meeting, and when you expect to be back with a trusted friend or family member.",
  },
  {
    title: 'Arrange your own transport',
    description:
      "Drive yourself, use a rideshare, or take public transport. Don't depend on your date for a ride, especially on a first meeting.",
  },
  {
    title: 'Stay sober',
    description:
      'Keep a clear head. Limit alcohol consumption so you can make safe decisions throughout the date.',
  },
  {
    title: 'Have an exit plan',
    description:
      "Know how you'll leave if things don't feel right. It's always OK to end a date early.",
  },
];

const EMERGENCY_CONTACTS: EmergencyContact[] = [
  { flag: '🇪🇺', label: 'European Emergency', number: '112', dial: '112' },
  { flag: '🇩🇪', label: 'Germany (Police)', number: '110', dial: '110' },
  { flag: '🇩🇪', label: 'Germany (Domestic Violence)', number: '08000 116 016', dial: '08000116016' },
  { flag: '🇬🇧', label: 'UK (Emergency)', number: '999', dial: '999' },
  { flag: '🇬🇧', label: 'UK (Domestic Abuse)', number: '0808 2000 247', dial: '08082000247' },
  { flag: '🇫🇷', label: 'France (Emergency)', number: '17', dial: '17' },
  { flag: '🇳🇱', label: 'Netherlands (Emergency)', number: '112', dial: '112' },
  { flag: '🇹🇷', label: 'Turkey (Emergency)', number: '155', dial: '155' },
];

export default function SafetyCenterScreen() {
  const theme = Colors[useColorScheme()];
  const router = useRouter();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: layout.scrollContentPaddingBottomTab + 40 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]}>
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </Pressable>
        <View style={[styles.heroIcon, { backgroundColor: withAlpha(theme.neonCyan, 0.15) }]}>
          <Ionicons name="shield-checkmark" size={48} color={theme.neonCyan} />
        </View>
        <Text style={[styles.heroTitle, { color: theme.text }]}>Safety Center</Text>
        <Text style={[styles.heroBody, { color: theme.mutedForeground }]}>
          Your safety is our priority. Here&apos;s how to stay safe on Vibely and what to do if something goes wrong.
        </Text>

        <Text style={[styles.sectionHeader, { color: theme.mutedForeground }]}>VIBELY&apos;S SAFETY FEATURES</Text>
        {FEATURE_CARDS.map((card) => (
          <View key={card.title} style={[styles.card, { backgroundColor: 'rgba(255,255,255,0.05)' }]}>
            <View style={[styles.iconCircle, { backgroundColor: withAlpha(card.color, 0.15) }]}>
              <Ionicons name={card.icon} size={20} color={card.color} />
            </View>
            <View style={styles.cardText}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>{card.title}</Text>
              <Text style={[styles.cardDescription, { color: theme.mutedForeground }]}>{card.description}</Text>
            </View>
          </View>
        ))}

        <Text style={[styles.sectionHeader, { color: theme.mutedForeground }]}>ONLINE SAFETY TIPS</Text>
        {ONLINE_TIPS.map((tip, idx) => (
          <NumberedCard key={tip.title} theme={theme} number={idx + 1} title={tip.title} description={tip.description} />
        ))}

        <Text style={[styles.sectionHeader, { color: theme.mutedForeground }]}>MEETING IN PERSON</Text>
        {IN_PERSON_TIPS.map((tip, idx) => (
          <NumberedCard key={tip.title} theme={theme} number={idx + 1} title={tip.title} description={tip.description} />
        ))}

        <Text style={[styles.sectionHeader, { color: theme.mutedForeground }]}>IF SOMETHING GOES WRONG</Text>

        <View style={[styles.card, { backgroundColor: 'rgba(255,255,255,0.05)', marginBottom: spacing.md }]}>
          <View style={[styles.iconCircle, { backgroundColor: withAlpha('#E84393', 0.15) }]}>
            <Ionicons name="flag" size={20} color="#E84393" />
          </View>
          <View style={styles.cardText}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>Report in the app</Text>
            <Text style={[styles.cardDescription, { color: theme.mutedForeground }]}>
              Use the report button on any profile, in any chat, or during a video date. You can also submit a detailed report through Support & Feedback.
            </Text>
            <Pressable
              onPress={() => router.push('/settings/submit-ticket?primaryType=safety')}
              style={({ pressed }) => [
                styles.smallButton,
                {
                  borderColor: theme.tint,
                  backgroundColor: pressed ? withAlpha(theme.tint, 0.12) : 'transparent',
                },
              ]}
            >
              <Text style={[styles.smallButtonLabel, { color: theme.tint }]}>Report Now</Text>
            </Pressable>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: 'rgba(255,255,255,0.05)', marginBottom: spacing.md }]}>
          <View style={[styles.iconCircle, { backgroundColor: withAlpha('#22D3EE', 0.15) }]}>
            <Ionicons name="call" size={20} color="#22D3EE" />
          </View>
          <View style={styles.cardText}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>Emergency resources</Text>
            <Text style={[styles.cardDescription, { color: theme.mutedForeground }]}>
              If you are in immediate danger, contact emergency services.
            </Text>
            <View style={styles.contactsWrap}>
              {EMERGENCY_CONTACTS.map((contact) => (
                <Pressable
                  key={`${contact.label}-${contact.dial}`}
                  onPress={() => Linking.openURL(`tel:${contact.dial}`)}
                  style={({ pressed }) => [styles.contactRow, pressed && { opacity: 0.8 }]}
                >
                  <Text style={styles.contactFlag}>{contact.flag}</Text>
                  <Text style={[styles.contactLabel, { color: theme.text }]}>{contact.label}</Text>
                  <Text style={[styles.contactNumber, { color: theme.tint }]}>{contact.number}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={[styles.contactNote, { color: theme.mutedForeground }]}>
              If your country isn&apos;t listed, dial your local emergency number or contact us through Support & Feedback.
            </Text>
          </View>
        </View>

        <Text style={[styles.sectionHeader, { color: theme.mutedForeground }]}>LEARN MORE</Text>
        <Pressable
          onPress={() => WebBrowser.openBrowserAsync('https://vibelymeet.com/community-guidelines')}
          style={({ pressed }) => [
            styles.learnMoreRow,
            { backgroundColor: 'rgba(255,255,255,0.05)', opacity: pressed ? 0.88 : 1 },
          ]}
        >
          <View style={styles.learnMoreLeft}>
            <View style={[styles.learnMoreIcon, { backgroundColor: withAlpha(theme.textSecondary, 0.2) }]}>
              <Ionicons name="people-outline" size={18} color={theme.textSecondary} />
            </View>
            <Text style={[styles.learnMoreLabel, { color: theme.text }]}>Community Guidelines</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.mutedForeground} />
        </Pressable>
        <Pressable
          onPress={() => WebBrowser.openBrowserAsync('https://vibelymeet.com/privacy')}
          style={({ pressed }) => [
            styles.learnMoreRow,
            { backgroundColor: 'rgba(255,255,255,0.05)', opacity: pressed ? 0.88 : 1 },
          ]}
        >
          <View style={styles.learnMoreLeft}>
            <View style={[styles.learnMoreIcon, { backgroundColor: withAlpha(theme.textSecondary, 0.2) }]}>
              <Ionicons name="shield-checkmark-outline" size={18} color={theme.textSecondary} />
            </View>
            <Text style={[styles.learnMoreLabel, { color: theme.text }]}>Privacy Policy</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.mutedForeground} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function NumberedCard({
  theme,
  number,
  title,
  description,
}: {
  theme: (typeof Colors)['dark'];
  number: number;
  title: string;
  description: string;
}) {
  return (
    <View style={[styles.card, { backgroundColor: 'rgba(255,255,255,0.05)' }]}>
      <View style={[styles.numberBadge, { backgroundColor: theme.tint }]}>
        <Text style={styles.numberText}>{number}</Text>
      </View>
      <View style={styles.cardText}>
        <Text style={[styles.cardTitle, { color: theme.text }]}>{title}</Text>
        <Text style={[styles.cardDescription, { color: theme.mutedForeground }]}>{description}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: {
    paddingHorizontal: layout.containerPadding,
    paddingTop: spacing.xl,
  },
  backBtn: {
    alignSelf: 'flex-start',
    marginBottom: spacing.md,
    padding: spacing.xs,
  },
  heroIcon: {
    width: 88,
    height: 88,
    borderRadius: radius['2xl'],
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  heroTitle: { ...typography.titleXL, textAlign: 'center', marginBottom: spacing.sm },
  heroBody: { fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: spacing.xl },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  card: {
    borderRadius: radius['2xl'],
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  numberText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  cardText: { flex: 1 },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  cardDescription: {
    fontSize: 13,
    lineHeight: 19,
  },
  smallButton: {
    marginTop: spacing.md,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  smallButtonLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  contactsWrap: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 4,
  },
  contactFlag: {
    fontSize: 14,
  },
  contactLabel: {
    flex: 1,
    fontSize: 13,
  },
  contactNumber: {
    fontSize: 13,
    fontWeight: '700',
  },
  contactNote: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.sm,
  },
  learnMoreRow: {
    borderRadius: radius['2xl'],
    padding: 14,
    marginBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  learnMoreLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  learnMoreIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  learnMoreLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
});
