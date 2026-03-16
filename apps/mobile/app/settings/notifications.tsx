/**
 * Notifications settings — permission state, request, Open Settings when denied, link to web for toggles.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Linking, Alert, Switch } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { GlassHeaderBar, Card, VibelyButton } from '@/components/ui';
import { spacing, layout } from '@/constants/theme';
import { withAlpha } from '@/lib/colorUtils';
import { useColorScheme } from '@/components/useColorScheme';
import { usePushPermission } from '@/lib/usePushPermission';
import { NotificationPermissionFlow } from '@/components/notifications/NotificationPermissionFlow';
import { registerPushWithBackend } from '@/lib/onesignal';
import { useAuth } from '@/context/AuthContext';
import { useNotificationPreferences } from '@/lib/useNotificationPreferences';

export default function NotificationsSettingsScreen() {
  const insets = useSafeAreaInsets();
  const theme = Colors[useColorScheme()];
  const { isGranted, isDenied, requestPermission, openSettings, refresh } = usePushPermission();
  const { user } = useAuth();
  const [showFlow, setShowFlow] = useState(false);
  const { prefs, isLoading: prefsLoading, toggle } = useNotificationPreferences(user?.id);

  const handleRequest = async (): Promise<boolean> => {
    const granted = await requestPermission();
    if (granted && user?.id) await registerPushWithBackend(user.id);
    return granted;
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <GlassHeaderBar insets={insets}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]} accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: theme.text }]}>Notifications</Text>
        </View>
      </GlassHeaderBar>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: layout.scrollContentPaddingBottomTab }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.main}>
          <Card variant="glass" style={[styles.card, { borderColor: theme.glassBorder }]}>
            <View style={[styles.iconWrap, { backgroundColor: theme.tintSoft }]}>
              <Ionicons name="notifications-outline" size={32} color={theme.tint} />
            </View>
            <Text style={[styles.statusLabel, { color: theme.textSecondary }]}>Push notifications</Text>
            <Text style={[styles.statusValue, { color: theme.text }]}>
              {isGranted ? 'Enabled' : isDenied ? 'Disabled' : 'Not set'}
            </Text>
            {isGranted && (
              <Text style={[styles.body, { color: theme.textSecondary }]}>
                You'll get date reminders, new matches, and daily drop alerts.
              </Text>
            )}
            {isDenied && (
              <>
                <Text style={[styles.body, { color: theme.textSecondary }]}>
                  Enable in your device settings to get date reminders and match alerts.
                </Text>
                <VibelyButton label="Open Settings" onPress={openSettings} variant="primary" style={styles.cta} />
              </>
            )}
            {!isGranted && !isDenied && (
              <VibelyButton label="Enable notifications" onPress={() => setShowFlow(true)} variant="primary" style={styles.cta} />
            )}
          </Card>
          <Card variant="glass" style={[styles.card, { borderColor: theme.glassBorder }]}>
            <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>What to notify</Text>
            {!prefsLoading && (
              <View style={styles.toggles}>
                {[
                  { key: 'notify_messages' as const, label: 'New messages' },
                  { key: 'notify_new_match' as const, label: 'New matches' },
                  { key: 'notify_date_reminder' as const, label: 'Date reminders' },
                  { key: 'notify_event_reminder' as const, label: 'Event reminders' },
                  { key: 'notify_ready_gate' as const, label: 'Ready to date' },
                  { key: 'notify_daily_drop' as const, label: 'Daily drop' },
                  { key: 'notify_product_updates' as const, label: 'Product updates' },
                ].map(({ key, label }) => (
                  <View key={key} style={[styles.toggleRow, { borderBottomColor: theme.border }]}>
                    <Text style={[styles.toggleLabel, { color: theme.text }]}>{label}</Text>
                    <Switch value={prefs[key]} onValueChange={() => toggle(key)} trackColor={{ false: theme.surfaceSubtle, true: withAlpha(theme.tint, 0.6) }} thumbColor={prefs[key] ? theme.tint : theme.textSecondary} />
                  </View>
                ))}
              </View>
            )}
            <Text style={[styles.body, { color: theme.textSecondary }]}>
              Quiet hours and alert sounds can be managed on web.
            </Text>
            <VibelyButton
              label="Open notification settings on web"
              onPress={() => Linking.openURL('https://vibelymeet.com/settings').catch(() => Alert.alert('Unable to open', 'Try again later.'))}
              variant="secondary"
              size="sm"
              style={styles.cta}
            />
          </Card>
        </View>
      </ScrollView>

      <NotificationPermissionFlow
        open={showFlow}
        onOpenChange={(open) => { setShowFlow(open); if (!open) refresh(); }}
        onRequestPermission={handleRequest}
        openSettings={openSettings}
      />
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
  iconWrap: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  statusLabel: { fontSize: 12, fontWeight: '600', marginBottom: 4 },
  statusValue: { fontSize: 16, fontWeight: '600', marginBottom: spacing.sm },
  sectionTitle: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5, marginBottom: spacing.sm, textTransform: 'uppercase' },
  toggles: { marginBottom: spacing.md },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  toggleLabel: { fontSize: 15 },
  body: { fontSize: 14, lineHeight: 20, marginBottom: spacing.md },
  cta: { marginTop: spacing.sm },
});
