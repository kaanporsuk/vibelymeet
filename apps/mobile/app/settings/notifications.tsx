/**
 * Notifications settings — native v1: show copy and link to web for full management.
 * Backend: notification_preferences (player ID stored by PushRegistration); toggles/quiet hours on web.
 */
import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Linking, Alert } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { GlassSurface, Card, VibelyButton } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';

export default function NotificationsSettingsScreen() {
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
            paddingHorizontal: spacing.lg,
          },
        ]}
      >
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.text }]}>Notifications</Text>
      </GlassSurface>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: spacing['2xl'] + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.main}>
          <Card style={styles.card}>
            <View style={[styles.iconWrap, { backgroundColor: theme.tintSoft }]}>
              <Ionicons name="notifications-outline" size={32} color={theme.tint} />
            </View>
            <Text style={[styles.body, { color: theme.textSecondary }]}>
              Manage notification preferences, quiet hours, and alert sounds on web. Your device is registered for push when you're signed in.
            </Text>
            <VibelyButton
              label="Open notification settings on web"
              onPress={() => {
                Linking.openURL('https://vibelymeet.com/settings').catch(() => {
                  Alert.alert(
                    'Unable to open link',
                    'We could not open your notification settings in the browser. Please try again later.'
                  );
                });
              }}
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
  card: { padding: spacing.lg, alignItems: 'center' },
  iconWrap: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  body: { fontSize: 15, lineHeight: 22, marginBottom: spacing.lg, textAlign: 'center' },
  cta: { alignSelf: 'flex-start' },
});
