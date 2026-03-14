/**
 * Account settings — native v1: show email, link to web for password and full account management.
 * Backend: Supabase Auth; account-pause, account-resume, delete-account on web.
 */
import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Linking } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { GlassSurface, Card, VibelyButton } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';

export default function AccountSettingsScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { user } = useAuth();
  const email = user?.email ?? '';

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <GlassSurface
        style={[
          styles.header,
          {
            paddingTop: insets.top + spacing.sm,
            paddingBottom: spacing.md,
            paddingHorizontal: spacing.lg,
          },
        ]}
      >
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.text }]}>Account</Text>
      </GlassSurface>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: spacing['2xl'] + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.main}>
          <Card style={styles.card}>
            <Text style={[styles.label, { color: theme.textSecondary }]}>Signed in as</Text>
            <Text style={[styles.email, { color: theme.text }]} numberOfLines={1}>{email || '—'}</Text>
            <Text style={[styles.body, { color: theme.textSecondary, marginTop: spacing.lg }]}>
              Change password, pause or resume account, and manage other account settings on web.
            </Text>
            <VibelyButton
              label="Open account settings on web"
              onPress={() => Linking.openURL('https://vibelymeet.com/settings').catch(() => {})}
              variant="primary"
              style={styles.cta}
            />
          </Card>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  backBtn: { padding: spacing.xs },
  headerTitle: { fontSize: 20, fontWeight: '700', flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingTop: spacing.lg },
  main: { paddingHorizontal: spacing.lg },
  card: { padding: spacing.lg },
  label: { fontSize: 12, fontWeight: '600', marginBottom: 4 },
  email: { fontSize: 16, fontWeight: '500' },
  body: { fontSize: 15, lineHeight: 22 },
  cta: { marginTop: spacing.lg, alignSelf: 'flex-start' },
});
