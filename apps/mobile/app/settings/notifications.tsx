/**
 * Notifications settings — permission state + 8 toggle groups (design spec: 44 notification types).
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Linking, Alert, Switch } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { GlassHeaderBar, Card, VibelyButton } from '@/components/ui';
import { spacing, layout } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { usePushPermission } from '@/lib/usePushPermission';
import { NotificationPermissionFlow } from '@/components/notifications/NotificationPermissionFlow';
import { registerPushWithBackend } from '@/lib/onesignal';
import { useAuth } from '@/context/AuthContext';
import { useNotificationPreferences, type NotificationPrefKey } from '@/lib/useNotificationPreferences';

const PREF_GROUPS: Array<{
  key: NotificationPrefKey;
  label: string;
  desc: string;
  defaultVal: boolean;
  locked?: boolean;
}> = [
  { key: 'pref_messages', label: 'Messages', desc: 'New messages, voice notes, video messages, reactions', defaultVal: true },
  { key: 'pref_matches', label: 'Matches', desc: 'New matches, mutual vibes, who liked you', defaultVal: true },
  { key: 'pref_events', label: 'Events', desc: 'Reminders, live alerts, new events in your city', defaultVal: true },
  { key: 'pref_daily_drop', label: 'Daily Drop', desc: 'Drop available, openers, and replies', defaultVal: true },
  { key: 'pref_video_dates', label: 'Video Dates', desc: 'Partner ready, date starting, reconnection', defaultVal: true },
  { key: 'pref_vibes_social', label: 'Vibes & Social', desc: 'Someone vibed you, super vibes', defaultVal: true },
  { key: 'pref_marketing', label: 'Tips & Recommendations', desc: 'Premium features, weekly summary, re-engagement', defaultVal: false },
  { key: 'pref_account_safety', label: 'Account & Safety', desc: 'Verification, subscription, credits, security alerts', defaultVal: true, locked: true },
];

export default function NotificationsSettingsScreen() {
  const insets = useSafeAreaInsets();
  const theme = Colors[useColorScheme()];
  const { isGranted, isDenied, requestPermission, openSettings, refresh } = usePushPermission();
  const { user } = useAuth();
  const [showFlow, setShowFlow] = useState(false);
  const { prefs, isLoading: prefsLoading, updatePref } = useNotificationPreferences(user?.id);

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
                {PREF_GROUPS.map((group) => (
                  <View key={group.key} style={[styles.row, { borderBottomColor: theme.border }]}>
                    <View style={styles.rowContent}>
                      <View style={styles.rowLabelRow}>
                        <Text style={[styles.rowLabel, { color: theme.text }]}>{group.label}</Text>
                        {group.locked && (
                          <Ionicons name="lock-closed" size={14} color={theme.textSecondary} style={styles.lockIcon} />
                        )}
                      </View>
                      <Text style={[styles.rowDesc, { color: theme.textSecondary }]}>
                        {group.locked ? 'Always on for your safety' : group.desc}
                      </Text>
                    </View>
                    <Switch
                      value={group.locked ? true : (prefs[group.key] ?? group.defaultVal)}
                      onValueChange={(val) => { if (!group.locked) updatePref(group.key, val); }}
                      disabled={group.locked}
                      trackColor={{ false: theme.surfaceSubtle, true: theme.tint }}
                      thumbColor={theme.primaryForeground}
                    />
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
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  rowContent: { flex: 1, minWidth: 0, marginRight: spacing.md },
  rowLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowLabel: { fontSize: 16, fontWeight: '600' },
  rowDesc: { fontSize: 13, marginTop: 2, lineHeight: 18 },
  lockIcon: { marginLeft: 2 },
  body: { fontSize: 14, lineHeight: 20, marginBottom: spacing.md },
  cta: { marginTop: spacing.sm },
});
