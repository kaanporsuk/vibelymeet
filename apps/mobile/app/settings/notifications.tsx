/**
 * Notification settings — full parity with web: categories, push status, pause, sound, quiet hours, smart delivery.
 */
import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert, Switch } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { GlassHeaderBar } from '@/components/ui';
import { spacing, layout } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { usePushPermission } from '@/lib/usePushPermission';
import { registerPushWithBackend } from '@/lib/onesignal';
import { useAuth } from '@/context/AuthContext';
import { useNotificationPreferences, type NotificationPrefs } from '@/lib/useNotificationPreferences';

const NOTIFICATION_SECTIONS = [
  {
    title: 'CONNECTIONS',
    items: [
      {
        key: 'notify_new_match',
        icon: 'heart-outline' as const,
        label: 'New Match',
        desc: 'When you and someone both vibe',
        color: '#E84393',
      },
      {
        key: 'notify_messages',
        icon: 'chatbubble-outline' as const,
        label: 'Messages',
        desc: 'New messages from matches',
        color: '#00B4D8',
      },
      {
        key: 'notify_someone_vibed_you',
        icon: 'sparkles-outline' as const,
        label: 'Someone Vibed You',
        desc: 'When someone swipes vibe on you',
        color: '#8B5CF6',
      },
      {
        key: 'notify_ready_gate',
        icon: 'videocam-outline' as const,
        label: 'Ready Gate',
        desc: 'Video date invitations',
        color: '#8B5CF6',
      },
    ],
  },
  {
    title: 'EVENTS & DATES',
    items: [
      {
        key: 'notify_event_live',
        icon: 'calendar-outline' as const,
        label: 'Event Going Live',
        desc: 'When an event you joined starts',
        color: '#F97316',
      },
      {
        key: 'notify_event_reminder',
        icon: 'time-outline' as const,
        label: 'Event Reminders',
        desc: 'Reminders before your events',
        color: '#F97316',
      },
      {
        key: 'notify_date_reminder',
        icon: 'alarm-outline' as const,
        label: 'Date Reminders',
        desc: 'Upcoming video date alerts',
        color: '#F97316',
      },
    ],
  },
  {
    title: 'DISCOVERY',
    items: [
      {
        key: 'notify_daily_drop',
        icon: 'flash-outline' as const,
        label: 'Daily Drop',
        desc: 'Your daily curated match',
        color: '#EAB308',
      },
      {
        key: 'notify_recommendations',
        icon: 'compass-outline' as const,
        label: 'Recommendations',
        desc: 'People and events you might like',
        color: '#6B7280',
      },
      {
        key: 'notify_product_updates',
        icon: 'grid-outline' as const,
        label: 'Product Updates',
        desc: 'New features and improvements',
        color: '#6B7280',
      },
    ],
  },
  {
    title: 'ACCOUNT',
    items: [
      {
        key: 'notify_credits_subscription',
        icon: 'card-outline' as const,
        label: 'Credits & Purchases',
        desc: 'Purchase confirmations',
        color: '#6B7280',
      },
      {
        key: 'safety_alerts',
        icon: 'shield-outline' as const,
        label: 'Safety Alerts',
        desc: 'Safety & account alerts · Always on',
        color: '#22C55E',
        locked: true,
      },
    ],
  },
] as const;

const ADDITIONAL_SECTIONS = [
  {
    title: 'SOUND',
    items: [
      {
        key: 'sound_enabled' as const,
        icon: 'volume-high-outline' as const,
        label: 'Notification Sound',
        desc: 'Play a sound with notifications',
      },
    ],
  },
  {
    title: 'QUIET HOURS',
    items: [
      {
        key: 'quiet_hours_enabled' as const,
        icon: 'moon-outline' as const,
        label: 'Quiet Hours',
        desc: 'Mute notifications during set hours',
      },
    ],
  },
  {
    title: 'SMART DELIVERY',
    items: [
      {
        key: 'message_bundle_enabled' as const,
        icon: 'layers-outline' as const,
        label: 'Bundle rapid messages',
        desc: 'Group multiple messages from the same person',
      },
    ],
  },
] as const;

export default function NotificationsSettingsScreen() {
  const theme = Colors[useColorScheme()];
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { prefs, updatePref, isLoading } = useNotificationPreferences(user?.id);
  const { isGranted, isDenied, requestPermission, openSettings, refresh } = usePushPermission();

  const permissionGranted = isGranted;

  const handleEnablePush = async () => {
    const granted = await requestPermission();
    if (granted && user?.id) await registerPushWithBackend(user.id);
    await refresh();
  };

  return (
    <View style={[{ flex: 1, backgroundColor: theme.background }]}>
      <GlassHeaderBar insets={insets}>
        <View style={styles.headerInner}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]}
            accessibilityLabel="Back"
          >
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </Pressable>
          <View style={styles.headerTitles}>
            <Text style={[styles.headerTitle, { color: theme.text }]}>Notifications</Text>
            <Text style={[styles.headerSubtitle, { color: theme.mutedForeground }]}>Control what you hear about</Text>
          </View>
        </View>
      </GlassHeaderBar>

      <ScrollView
        contentContainerStyle={[styles.scrollInner, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {!permissionGranted ? (
          <View
            style={[
              styles.alertBanner,
              { borderColor: 'rgba(234,179,8,0.4)', backgroundColor: 'rgba(234,179,8,0.06)' },
            ]}
          >
            <Ionicons name="alert-circle" size={22} color="#EAB308" style={styles.alertIcon} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.alertTitle, { color: theme.text }]}>Push notifications are off</Text>
              <Text style={[styles.alertDesc, { color: theme.mutedForeground }]}>
                You'll miss matches, messages, and date invitations
              </Text>
              {isDenied ? (
                <Pressable onPress={openSettings} style={styles.openSettingsLink}>
                  <Text style={{ color: theme.tint, fontWeight: '600', fontSize: 13 }}>Open system settings</Text>
                </Pressable>
              ) : null}
            </View>
            <Pressable onPress={handleEnablePush} style={styles.enableBtn}>
              <Text style={{ color: '#fff', fontWeight: '600', fontSize: 13 }}>Enable Push Notifications</Text>
            </Pressable>
          </View>
        ) : (
          <View style={[styles.statusCard, { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder }]}>
            <View style={[styles.statusIconWrap, { backgroundColor: withAlpha(theme.tint, 0.15) }]}>
              <Ionicons name="notifications" size={28} color={theme.tint} />
            </View>
            <Text style={{ fontSize: 12, color: theme.mutedForeground, marginTop: 10 }}>Push notifications</Text>
            <Text style={{ fontSize: 17, fontWeight: '700', color: theme.text }}>Enabled</Text>
            <Text style={{ fontSize: 12, color: theme.mutedForeground, marginTop: 4, textAlign: 'center' }}>
              You'll get date reminders, new matches, and daily drop alerts.
            </Text>
          </View>
        )}

        <View style={[styles.row, { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder }]}>
          <Ionicons name="pause-circle-outline" size={20} color={theme.mutedForeground} />
          <Text style={[styles.rowLabel, { color: theme.text, flex: 1 }]}>Pause All Notifications</Text>
          <Pressable
            onPress={() => {
              Alert.alert('Pause Notifications', 'How long?', [
                {
                  text: '1 hour',
                  onPress: () => updatePref('paused_until', new Date(Date.now() + 3600000).toISOString()),
                },
                {
                  text: '8 hours',
                  onPress: () => updatePref('paused_until', new Date(Date.now() + 28800000).toISOString()),
                },
                {
                  text: '24 hours',
                  onPress: () => updatePref('paused_until', new Date(Date.now() + 86400000).toISOString()),
                },
                { text: 'Resume all', onPress: () => updatePref('paused_until', null), style: 'destructive' },
                { text: 'Cancel', style: 'cancel' },
              ]);
            }}
            style={[styles.pauseBtn, { borderColor: theme.border }]}
          >
            <Text style={{ color: theme.mutedForeground, fontSize: 13 }}>Pause</Text>
            <Ionicons name="chevron-down" size={14} color={theme.mutedForeground} />
          </Pressable>
        </View>

        <View style={[styles.row, { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder }]}>
          <Ionicons name="notifications-outline" size={20} color={theme.mutedForeground} />
          <Text style={[styles.rowLabel, { color: theme.text, flex: 1 }]}>All Notifications</Text>
          <Switch
            value={prefs.push_enabled}
            onValueChange={(val) => updatePref('push_enabled', val)}
            disabled={isLoading}
            trackColor={{ false: theme.muted, true: theme.tint }}
          />
        </View>

        {!isLoading &&
          NOTIFICATION_SECTIONS.map((section) => (
            <View key={section.title} style={{ gap: 8 }}>
              <Text style={[styles.sectionTitle, { color: theme.mutedForeground }]}>{section.title}</Text>
              <View style={[styles.sectionCard, { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder }]}>
                {section.items.map((item, idx) => (
                  <View
                    key={item.key}
                    style={[
                      styles.toggleRow,
                      idx < section.items.length - 1 && {
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: withAlpha(theme.border, 0.35),
                      },
                    ]}
                  >
                    <Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={20} color={item.color} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.toggleLabel, { color: theme.text }]}>{item.label}</Text>
                      <Text style={[styles.toggleDesc, { color: theme.mutedForeground }]}>{item.desc}</Text>
                    </View>
                    {'locked' in item && item.locked ? (
                      <Ionicons name="lock-closed" size={18} color={theme.mutedForeground} />
                    ) : (
                      <Switch
                        value={Boolean(prefs[item.key as keyof NotificationPrefs])}
                        onValueChange={(val) => updatePref(item.key, val)}
                        trackColor={{ false: theme.muted, true: theme.tint }}
                      />
                    )}
                  </View>
                ))}
              </View>
            </View>
          ))}

        {!isLoading &&
          ADDITIONAL_SECTIONS.map((section) => (
            <View key={section.title} style={{ gap: 8 }}>
              <Text style={[styles.sectionTitle, { color: theme.mutedForeground }]}>{section.title}</Text>
              <View style={[styles.sectionCard, { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder }]}>
                {section.items.map((item, idx) => (
                  <View
                    key={item.key}
                    style={[
                      styles.toggleRow,
                      idx < section.items.length - 1 && {
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: withAlpha(theme.border, 0.35),
                      },
                    ]}
                  >
                    <Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={20} color={theme.mutedForeground} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.toggleLabel, { color: theme.text }]}>{item.label}</Text>
                      <Text style={[styles.toggleDesc, { color: theme.mutedForeground }]}>{item.desc}</Text>
                    </View>
                    <Switch
                      value={
                        item.key === 'sound_enabled'
                          ? prefs.sound_enabled
                          : item.key === 'message_bundle_enabled'
                            ? prefs.message_bundle_enabled
                            : prefs.quiet_hours_enabled
                      }
                      onValueChange={(val) => updatePref(item.key, val)}
                      trackColor={{ false: theme.muted, true: theme.tint }}
                    />
                  </View>
                ))}
              </View>
            </View>
          ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  backBtn: {
    padding: spacing.xs,
  },
  headerTitles: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  scrollInner: {
    padding: 16,
    gap: 20,
    paddingTop: layout.mainContentPaddingTop,
  },
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    flexWrap: 'wrap',
  },
  alertIcon: {
    marginTop: 2,
  },
  alertTitle: { fontSize: 15, fontWeight: '600' },
  alertDesc: { fontSize: 12, marginTop: 2 },
  openSettingsLink: {
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  enableBtn: {
    backgroundColor: '#E84393',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  statusCard: {
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
  },
  statusIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  rowLabel: { fontSize: 15, fontWeight: '500' },
  pauseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, paddingLeft: 4 },
  sectionCard: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  toggleLabel: { fontSize: 15, fontWeight: '500' },
  toggleDesc: { fontSize: 12, marginTop: 1 },
});
