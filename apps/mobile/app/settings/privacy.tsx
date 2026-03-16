/**
 * Privacy settings — visibility, blocked users entry, link to web for full controls.
 */
import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Linking } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { GlassHeaderBar, Card, VibelyButton, SettingsRow } from '@/components/ui';
import { spacing, layout } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';

export default function PrivacySettingsScreen() {
  const insets = useSafeAreaInsets();
  const theme = Colors[useColorScheme()];

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <GlassHeaderBar insets={insets}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: theme.text }]}>Privacy</Text>
        </View>
      </GlassHeaderBar>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: layout.scrollContentPaddingBottomTab }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.main}>
          <Card variant="glass" style={[styles.card, { borderColor: theme.glassBorder }]}>
            <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>Profile & discovery</Text>
            <Text style={[styles.body, { color: theme.textSecondary }]}>
              Control who can see your profile and how you appear in discovery. Blocked users and report history are managed on web.
            </Text>
            <VibelyButton
              label="Open privacy on web"
              onPress={() => Linking.openURL('https://vibelymeet.com/settings').catch(() => {})}
              variant="primary"
              size="sm"
              style={styles.cta}
            />
          </Card>
          <Card variant="glass" style={[styles.card, { borderColor: theme.glassBorder }]}>
            <SettingsRow
              icon={<Ionicons name="people-outline" size={20} color={theme.tint} />}
              title="Blocked users"
              subtitle="Manage on web"
              onPress={() => Linking.openURL('https://vibelymeet.com/settings').catch(() => {})}
            />
            <SettingsRow
              icon={<Ionicons name="document-text-outline" size={20} color={theme.textSecondary} />}
              title="Privacy Policy"
              onPress={() => Linking.openURL('https://vibelymeet.com/privacy').catch(() => {})}
            />
          </Card>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  backBtn: { padding: spacing.xs },
  headerTitle: { fontSize: 18, fontWeight: '600', flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingTop: layout.mainContentPaddingTop, paddingHorizontal: spacing.lg },
  main: { gap: spacing.lg },
  card: { padding: spacing.lg },
  sectionTitle: { fontSize: 11, fontWeight: '600', letterSpacing: 0.5, marginBottom: spacing.sm, textTransform: 'uppercase' },
  body: { fontSize: 14, lineHeight: 20, marginBottom: spacing.md },
  cta: {},
});
