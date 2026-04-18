/**
 * Notification settings — categories, push status, pause (non-destructive), sound, quiet hours.
 * Pause All only touches paused_until; master switch only push_enabled — never category toggles.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Switch,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import Colors from '@/constants/Colors';
import { withAlpha } from '@/lib/colorUtils';
import { GlassHeaderBar } from '@/components/ui';
import { spacing, layout } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { usePushPermission } from '@/lib/usePushPermission';
import { syncBackendAfterPushGrant } from '@/lib/requestPushPermissions';
import { useAuth } from '@/context/AuthContext';
import { useNotificationPreferences, type NotificationPrefs } from '@/lib/useNotificationPreferences';
import {
  PAUSE_KIND_KEY,
  PAUSED_UNTIL_KEY,
  applyPause,
  applyResume,
  inferPauseKindFromUntil,
  type PauseKind,
} from '@/lib/notificationPause';
import { applyMasterPushEnabled } from '@/lib/pushMasterSwitch';
import { PauseNotificationsModal } from '@/components/settings/PauseNotificationsModal';
import { NotificationDeniedRecoverySurface } from '@/components/notifications/NotificationDeniedRecovery';
import { supabase } from '@/lib/supabase';
import { useFocusEffect } from '@react-navigation/native';
import { getCalendars } from 'expo-localization';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useVibelyDialog } from '@/components/VibelyDialog';

const AMBER = '#F59E0B';

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
        key: 'notify_match_calls',
        icon: 'call-outline' as const,
        label: 'Match calls',
        desc: 'Incoming voice and video calls',
        color: '#10B981',
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
        desc: 'Alerts before your video dates',
        color: '#06B6D4',
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
] as const;

const quietHoursLabel = Platform.OS === 'android' ? 'Do Not Disturb Hours' : 'Quiet Hours';
const quietHoursDescription =
  Platform.OS === 'android'
    ? 'Silence Vibely notifications during set hours'
    : 'Mute notifications during set hours';

function parseTimeToDate(t: string | null | undefined): Date {
  const d = new Date();
  const raw = (t || '22:00:00').split(':').map((x) => parseInt(x, 10));
  d.setHours(raw[0] ?? 22, raw[1] ?? 0, 0, 0);
  return d;
}

function dateToTimeString(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`;
}

function timezoneDisplayLabel(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: tz,
      timeZoneName: 'long',
    }).formatToParts(new Date());
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? tz;
  } catch {
    return tz;
  }
}

const PAUSE_KIND_LABEL: Record<PauseKind, string> = {
  m30: '30 min',
  h1: '1 hr',
  h8: '8 hrs',
  d1: '24 hrs',
  w1: '1 week',
  manual: 'Manual',
};

function formatRemainingShort(iso: string | null): string {
  if (!iso) return '';
  const end = new Date(iso);
  if (end <= new Date()) return '';
  if (end.getFullYear() >= 2095) return 'Manual';
  const ms = end.getTime() - Date.now();
  const totalM = Math.max(0, Math.ceil(ms / 60000));
  const h = Math.floor(totalM / 60);
  const m = totalM % 60;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

function formatUntilClock(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export default function NotificationsSettingsScreen() {
  const theme = Colors[useColorScheme()];
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { show, dialog } = useVibelyDialog();
  const { prefs, updatePref, isLoading } = useNotificationPreferences(user?.id);
  const {
    isGranted: pushOsGranted,
    isDenied: osDeniedFromHook,
    requestPermission,
    refresh,
    openSettings,
  } = usePushPermission();
  const [pauseModalVisible, setPauseModalVisible] = useState(false);
  const [pauseKind, setPauseKind] = useState<PauseKind | null>(null);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [remainingTick, setRemainingTick] = useState(0);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const isPaused = Boolean(prefs.paused_until && new Date(prefs.paused_until) > new Date());
  const osDenied = osDeniedFromHook;

  useEffect(() => {
    if (!user?.id) {
      setPauseKind(null);
      return;
    }
    void AsyncStorage.getItem(PAUSE_KIND_KEY).then((k) => setPauseKind((k as PauseKind | null) ?? null));
  }, [user?.id, prefs.paused_until]);

  useEffect(() => {
    if (!user?.id) return;
    const userId = user.id;
    async function syncPauseState() {
      const { data, error } = await supabase
        .from('notification_preferences')
        .select('paused_until')
        .eq('user_id', userId)
        .maybeSingle();
      if (error || !data) return;
      const pu = data.paused_until as string | null;
      if (pu && new Date(pu) > new Date()) {
        await AsyncStorage.setItem(PAUSED_UNTIL_KEY, pu);
        const { disablePush } = await import('@/lib/onesignal');
        disablePush(true);
      } else if (pu) {
        const { resumeNotifications } = await import('@/lib/notificationPause');
        await resumeNotifications(userId);
        await qc.invalidateQueries({ queryKey: ['notification-preferences'] });
      }
    }
    void syncPauseState();
  }, [user?.id, qc]);

  useEffect(() => {
    if (!isPaused) return;
    const id = setInterval(() => setRemainingTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, [isPaused]);

  const activePauseKind = useMemo((): PauseKind | null => {
    if (!isPaused) return null;
    if (pauseKind) return pauseKind;
    return inferPauseKindFromUntil(prefs.paused_until);
  }, [isPaused, pauseKind, prefs.paused_until]);

  const remainingShort = useMemo(
    () => formatRemainingShort(prefs.paused_until),
    [prefs.paused_until, remainingTick, isPaused]
  );

  const pauseChipLabel = useMemo(() => {
    if (!isPaused) {
      return activePauseKind ? PAUSE_KIND_LABEL[activePauseKind] : 'Off';
    }
    return remainingShort || 'Paused';
  }, [isPaused, activePauseKind, remainingShort]);

  const handleEnablePush = async () => {
    const result = await requestPermission();
    if (result.osDenied) {
      await refresh();
      return;
    }
    if (result.granted && user?.id) {
      await syncBackendAfterPushGrant(user.id);
    }
    await refresh();
  };

  const handleSelectPauseDuration = useCallback(
    async (kind: PauseKind) => {
      if (!user?.id) return;
      setPauseBusy(true);
      try {
        await applyPause(kind, user.id);
        setPauseKind(kind);
        await qc.invalidateQueries({ queryKey: ['notification-preferences'] });
        setPauseModalVisible(false);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Something went wrong';
        show({
          title: 'Couldn’t pause',
          message: msg,
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
      } finally {
        setPauseBusy(false);
      }
    },
    [user?.id, qc, show]
  );

  const handleResume = useCallback(async () => {
    if (!user?.id) return;
    setPauseBusy(true);
    try {
      await applyResume(user.id);
      setPauseKind(null);
      await qc.invalidateQueries({ queryKey: ['notification-preferences'] });
      setPauseModalVisible(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Something went wrong';
      show({
        title: 'Couldn’t resume',
        message: msg,
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    } finally {
      setPauseBusy(false);
    }
  }, [user?.id, qc, show]);

  const handleMasterSwitch = useCallback(
    async (val: boolean) => {
      if (!user?.id) return;
      try {
        await applyMasterPushEnabled(user.id, val);
        await qc.invalidateQueries({ queryKey: ['notification-preferences'] });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Something went wrong';
        show({
          title: 'Couldn’t update',
          message: msg,
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
      }
    },
    [user?.id, qc, show]
  );

  const saveQuietHoursPatch = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!user?.id) return;
      const { error } = await supabase
        .from('notification_preferences')
        .upsert({ user_id: user.id, ...patch }, { onConflict: 'user_id' });
      if (error) {
        show({
          title: 'Couldn’t save',
          message: error.message,
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
        return;
      }
      await qc.invalidateQueries({ queryKey: ['notification-preferences'] });
    },
    [user?.id, qc, show]
  );

  const handleQuietHoursToggle = useCallback(
    async (val: boolean) => {
      if (!user?.id) return;
      const tz = getCalendars()[0]?.timeZone ?? 'UTC';
      if (val) {
        await saveQuietHoursPatch({
          quiet_hours_enabled: true,
          quiet_hours_timezone: tz,
          quiet_hours_start: prefs.quiet_hours_start ?? '22:00:00',
          quiet_hours_end: prefs.quiet_hours_end ?? '08:00:00',
        });
      } else {
        await saveQuietHoursPatch({ quiet_hours_enabled: false });
      }
    },
    [user?.id, prefs.quiet_hours_start, prefs.quiet_hours_end, saveQuietHoursPatch]
  );

  const onStartTimeChange = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') setShowStartPicker(false);
    if (Platform.OS === 'android' && event.type === 'dismissed') return;
    if (date) void saveQuietHoursPatch({ quiet_hours_start: dateToTimeString(date) });
  };

  const onEndTimeChange = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') setShowEndPicker(false);
    if (Platform.OS === 'android' && event.type === 'dismissed') return;
    if (date) void saveQuietHoursPatch({ quiet_hours_end: dateToTimeString(date) });
  };

  const tzLabel = useMemo(
    () => timezoneDisplayLabel(prefs.quiet_hours_timezone || 'UTC'),
    [prefs.quiet_hours_timezone]
  );

  const renderStatusCard = () => {
    if (osDenied) {
      return (
        <NotificationDeniedRecoverySurface
          onOpenSettings={openSettings}
        />
      );
    }

    if (isPaused && prefs.paused_until) {
      const until = formatUntilClock(prefs.paused_until);
      return (
        <View style={[styles.statusCard, { backgroundColor: withAlpha(AMBER, 0.08), borderColor: withAlpha(AMBER, 0.25) }]}>
          <View style={[styles.statusIconWrap, { backgroundColor: withAlpha(AMBER, 0.15) }]}>
            <Ionicons name="pause-circle" size={28} color={AMBER} />
          </View>
          <Text style={{ fontSize: 12, color: theme.mutedForeground, marginTop: 10 }}>Notifications paused</Text>
          <Text style={{ fontSize: 17, fontWeight: '700', color: AMBER }}>Until {until}</Text>
          <Text style={{ fontSize: 12, color: theme.mutedForeground, marginTop: 4, textAlign: 'center' }}>
            Your preferences are saved. Push will resume automatically.
          </Text>
          <Pressable onPress={handleResume} disabled={pauseBusy} style={{ marginTop: 10 }}>
            <Text style={{ color: AMBER, fontWeight: '600', fontSize: 13 }}>Resume now</Text>
          </Pressable>
        </View>
      );
    }

    if (!prefs.push_enabled) {
      return (
        <View style={[styles.statusCard, { backgroundColor: withAlpha(theme.border, 0.4), borderColor: theme.glassBorder }]}>
          <View style={[styles.statusIconWrap, { backgroundColor: withAlpha(theme.mutedForeground, 0.1) }]}>
            <Ionicons name={'bell-off-outline' as any} size={28} color={theme.mutedForeground} />
          </View>
          <Text style={{ fontSize: 12, color: theme.mutedForeground, marginTop: 10 }}>Push notifications</Text>
          <Text style={{ fontSize: 17, fontWeight: '700', color: theme.mutedForeground }}>Disabled</Text>
          <Text style={{ fontSize: 12, color: theme.mutedForeground, marginTop: 4, textAlign: 'center' }}>
            Turn on All Notifications below to receive any push alerts.
          </Text>
        </View>
      );
    }

    return (
      <View style={[styles.statusCard, { backgroundColor: withAlpha(theme.tint, 0.08), borderColor: theme.glassBorder }]}>
        <View style={[styles.statusIconWrap, { backgroundColor: withAlpha(theme.tint, 0.15) }]}>
          <Ionicons name="notifications" size={28} color={theme.tint} />
        </View>
        <Text style={{ fontSize: 12, color: theme.mutedForeground, marginTop: 10 }}>Push notifications</Text>
        <Text style={{ fontSize: 17, fontWeight: '700', color: theme.tint }}>Enabled</Text>
        <Text style={{ fontSize: 12, color: theme.mutedForeground, marginTop: 4, textAlign: 'center' }}>
          You&apos;ll get new matches, messages, and daily drop alerts based on your toggles below.
        </Text>
      </View>
    );
  };

  return (
    <>
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
        {!osDenied && !pushOsGranted ? (
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
                You&apos;ll miss matches, messages, and date invitations
              </Text>
            </View>
            <Pressable onPress={handleEnablePush} style={styles.enableBtn}>
              <Text style={{ color: '#fff', fontWeight: '600', fontSize: 13 }}>Enable Push Notifications</Text>
            </Pressable>
          </View>
        ) : null}

        {renderStatusCard()}

        <Pressable
          onPress={() => setPauseModalVisible(true)}
          style={[
            styles.row,
            {
              backgroundColor: theme.glassSurface,
              borderColor: isPaused ? withAlpha(AMBER, 0.35) : theme.glassBorder,
            },
          ]}
        >
          <Ionicons name="pause-circle-outline" size={20} color={isPaused ? AMBER : theme.mutedForeground} />
          <Text style={[styles.rowLabel, { color: theme.text, flex: 1 }]}>Pause All Notifications</Text>
          <View
            style={[
              styles.chip,
              {
                borderColor: isPaused ? withAlpha(AMBER, 0.45) : theme.border,
                backgroundColor: isPaused ? withAlpha(AMBER, 0.12) : theme.surfaceSubtle,
              },
            ]}
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: '600',
                color: isPaused ? AMBER : theme.mutedForeground,
              }}
              numberOfLines={1}
            >
              {pauseChipLabel}
            </Text>
            <Ionicons name="chevron-down" size={14} color={isPaused ? AMBER : theme.mutedForeground} />
          </View>
        </Pressable>

        <View style={[styles.row, { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder }]}>
          <Ionicons name="notifications-outline" size={20} color={theme.mutedForeground} />
          <Text style={[styles.rowLabel, { color: theme.text, flex: 1 }]}>All Notifications</Text>
          <Switch
            value={prefs.push_enabled}
            onValueChange={(val) => void handleMasterSwitch(val)}
            disabled={isLoading}
            trackColor={{ false: theme.muted, true: theme.tint }}
          />
        </View>

        {!isLoading &&
          NOTIFICATION_SECTIONS.map((section) => (
            <View key={section.title} style={{ gap: 8 }}>
              {section.title === 'CONNECTIONS' && isPaused ? (
                <View
                  style={[
                    styles.pauseInfoBanner,
                    {
                      backgroundColor: withAlpha(AMBER, 0.1),
                      borderColor: withAlpha(AMBER, 0.25),
                    },
                  ]}
                >
                  <Ionicons name="information-circle-outline" size={16} color={AMBER} style={{ marginTop: 1 }} />
                  <Text style={[styles.pauseInfoText, { color: AMBER }]}>
                    Paused until {formatUntilClock(prefs.paused_until)} — your preferences below are saved and will apply
                    when notifications resume.
                  </Text>
                </View>
              ) : null}
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
                      value={prefs.sound_enabled}
                      onValueChange={(val) => updatePref('sound_enabled', val)}
                      trackColor={{ false: theme.muted, true: theme.tint }}
                    />
                  </View>
                ))}
              </View>
            </View>
          ))}

        {!isLoading ? (
          <View style={{ gap: 8 }}>
            <Text style={[styles.sectionTitle, { color: theme.mutedForeground }]}>QUIET HOURS</Text>
            <View style={[styles.sectionCard, { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder }]}>
              <View style={styles.toggleRow}>
                <Ionicons name="moon-outline" size={20} color={theme.mutedForeground} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.toggleLabel, { color: theme.text }]}>{quietHoursLabel}</Text>
                  <Text style={[styles.toggleDesc, { color: theme.mutedForeground }]}>{quietHoursDescription}</Text>
                </View>
                <Switch
                  value={prefs.quiet_hours_enabled}
                  onValueChange={(val) => void handleQuietHoursToggle(val)}
                  trackColor={{ false: theme.muted, true: theme.tint }}
                />
              </View>
              {prefs.quiet_hours_enabled ? (
                <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 10 }}>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <Pressable
                      onPress={() => {
                        setShowEndPicker(false);
                        setShowStartPicker(true);
                      }}
                      style={[styles.timeChip, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
                    >
                      <Text style={{ fontSize: 12, color: theme.mutedForeground }}>Starts</Text>
                      <Text style={{ fontSize: 15, fontWeight: '600', color: theme.text }}>
                        {parseTimeToDate(prefs.quiet_hours_start).toLocaleTimeString(undefined, {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        setShowStartPicker(false);
                        setShowEndPicker(true);
                      }}
                      style={[styles.timeChip, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
                    >
                      <Text style={{ fontSize: 12, color: theme.mutedForeground }}>Ends</Text>
                      <Text style={{ fontSize: 15, fontWeight: '600', color: theme.text }}>
                        {parseTimeToDate(prefs.quiet_hours_end).toLocaleTimeString(undefined, {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </Text>
                    </Pressable>
                  </View>
                  <Text style={{ fontSize: 11, color: theme.mutedForeground }}>
                    Times are in {tzLabel}
                  </Text>
                  <Text style={{ fontSize: 11, color: theme.mutedForeground, opacity: 0.9 }}>
                    Video date invitations and safety alerts can still come through.
                  </Text>
                </View>
              ) : null}
            </View>
            {showStartPicker ? (
              <DateTimePicker
                value={parseTimeToDate(prefs.quiet_hours_start)}
                mode="time"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={onStartTimeChange}
              />
            ) : null}
            {showEndPicker ? (
              <DateTimePicker
                value={parseTimeToDate(prefs.quiet_hours_end)}
                mode="time"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={onEndTimeChange}
              />
            ) : null}
          </View>
        ) : null}

        {!isLoading ? (
          <View style={{ gap: 8 }}>
            <Text style={[styles.sectionTitle, { color: theme.mutedForeground }]}>SMART DELIVERY</Text>
            <View style={[styles.sectionCard, { backgroundColor: theme.glassSurface, borderColor: theme.glassBorder }]}>
              <View style={styles.toggleRow}>
                <Ionicons name="layers-outline" size={20} color={theme.mutedForeground} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.toggleLabel, { color: theme.text }]}>Bundle rapid messages</Text>
                  <Text style={[styles.toggleDesc, { color: theme.mutedForeground }]}>
                    Replaces repeated alerts with one updated notification per conversation
                  </Text>
                </View>
                <Switch
                  value={prefs.message_bundle_enabled}
                  onValueChange={(val) => updatePref('message_bundle_enabled', val)}
                  trackColor={{ false: theme.muted, true: theme.tint }}
                />
              </View>
            </View>
          </View>
        ) : null}
      </ScrollView>

      <PauseNotificationsModal
        visible={pauseModalVisible}
        onClose={() => !pauseBusy && setPauseModalVisible(false)}
        theme={theme}
        activePauseKind={activePauseKind}
        isPaused={isPaused}
        busy={pauseBusy}
        onSelectDuration={handleSelectPauseDuration}
        onResume={handleResume}
      />
    </View>
    {dialog}
    </>
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
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    maxWidth: '48%',
  },
  pauseInfoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
  },
  pauseInfoText: {
    fontSize: 12,
    flex: 1,
    lineHeight: 16,
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
  timeChip: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
});
