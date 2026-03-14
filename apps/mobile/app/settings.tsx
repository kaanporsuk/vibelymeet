/**
 * Settings — web parity: glass header, grouped cards (Premium, Credits, Notifications,
 * Privacy, Account), quick actions, destructive Log out and Danger Zone.
 */
import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert, Linking } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import {
  GlassSurface,
  Card,
  SettingsRow,
  DestructiveRow,
} from '@/components/ui';
import { spacing } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/context/AuthContext';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { signOut } = useAuth();

  const handleLogout = () => {
    Alert.alert(
      'Log out?',
      "You'll need to sign in again to access your account.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Log Out', style: 'destructive', onPress: () => signOut() },
      ]
    );
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete account',
      'Account deletion is available on web. Open vibelymeet.com and go to Settings to request account deletion.',
      [{ text: 'OK' }]
    );
  };

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
        <Text style={[styles.headerTitle, { color: theme.text }]}>Settings</Text>
      </GlassSurface>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: spacing['2xl'] + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.main}>
          {/* Premium */}
          <Card style={styles.cardSpacing}>
            <SettingsRow
              icon={<Ionicons name="sparkles" size={20} color={theme.tint} />}
              title="Premium"
              subtitle="Upgrade for full access"
              onPress={() => router.push('/premium')}
            />
          </Card>

          {/* Credits */}
          <Card style={styles.cardSpacing}>
            <SettingsRow
              icon={<Ionicons name="flash" size={20} color={theme.tint} />}
              title="Video Date Credits"
              subtitle="Extra Time · Extended Vibe"
              onPress={() => {}}
            />
          </Card>

          {/* Notifications */}
          <Card style={styles.cardSpacing}>
            <SettingsRow
              icon={<Ionicons name="notifications-outline" size={20} color={theme.tint} />}
              title="Notifications"
              subtitle="Manage alerts and sounds"
              onPress={() => {}}
            />
          </Card>

          {/* Privacy */}
          <Card style={styles.cardSpacing}>
            <SettingsRow
              icon={<Ionicons name="shield-outline" size={20} color={theme.neonCyan} />}
              title="Privacy"
              subtitle="Control who sees what"
              onPress={() => {}}
            />
          </Card>

          {/* Account */}
          <Card style={styles.cardSpacing}>
            <SettingsRow
              icon={<Ionicons name="person-outline" size={20} color={theme.accent} />}
              title="Account"
              subtitle="Manage your account"
              onPress={() => {}}
            />
          </Card>

          {/* Quick actions */}
          <Card style={styles.cardSpacing}>
            <View style={styles.quickSection}>
              <SettingsRow
                icon={<Ionicons name="sparkles-outline" size={18} color={theme.tint} />}
                title="How Vibely Works"
                onPress={() => Linking.openURL('https://vibelymeet.com/how-it-works').catch(() => {})}
              />
              <SettingsRow
                icon={<Ionicons name="chatbubble-outline" size={18} color={theme.tint} />}
                title="Help & Feedback"
                onPress={() => {}}
              />
              <SettingsRow
                icon={<Ionicons name="shield-checkmark-outline" size={18} color={theme.textSecondary} />}
                title="Privacy Policy"
                onPress={() => Linking.openURL('https://vibelymeet.com/privacy').catch(() => {})}
              />
              <SettingsRow
                icon={<Ionicons name="document-text-outline" size={18} color={theme.textSecondary} />}
                title="Terms of Service"
                onPress={() => Linking.openURL('https://vibelymeet.com/terms').catch(() => {})}
              />
            </View>
          </Card>

          {/* Log out */}
          <View style={styles.destructiveSection}>
            <DestructiveRow
              icon={<Ionicons name="log-out-outline" size={20} color={theme.danger} />}
              label="Log Out"
              onPress={handleLogout}
            />
          </View>

          {/* Danger Zone */}
          <View style={[styles.dangerZone, { borderTopColor: theme.danger + '33' }]}>
            <Text style={[styles.dangerZoneTitle, { color: theme.danger }]}>DANGER ZONE</Text>
            <DestructiveRow
              icon={<Ionicons name="trash-outline" size={20} color={theme.danger} />}
              label="Delete My Account"
              onPress={handleDeleteAccount}
            />
          </View>
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
  },
  backBtn: { padding: spacing.xs },
  headerTitle: { fontSize: 20, fontWeight: '700', flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingTop: spacing.lg },
  main: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  cardSpacing: { marginBottom: spacing.md },
  quickSection: { gap: spacing.sm },
  destructiveSection: { marginTop: spacing.lg },
  dangerZone: { marginTop: spacing.xl, paddingTop: spacing.lg, borderTopWidth: 1 },
  dangerZoneTitle: { fontSize: 12, fontWeight: '600', letterSpacing: 1, marginBottom: spacing.sm },
});
