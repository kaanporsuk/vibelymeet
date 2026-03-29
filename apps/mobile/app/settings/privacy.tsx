/**
 * Privacy & Visibility Center — discovery, presence, location/event presence, permissions, safety, legal.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Linking,
  Platform,
  PermissionsAndroid,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import * as WebBrowser from 'expo-web-browser';
import * as Location from 'expo-location';
import {
  getCameraPermissionsAsync,
  getMediaLibraryPermissionsAsync,
} from 'expo-image-picker';
import { format, formatDistanceStrict } from 'date-fns';

import Colors from '@/constants/Colors';
import { GlassHeaderBar, SettingsRow } from '@/components/ui';
import { spacing, layout, radius } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { withAlpha } from '@/lib/colorUtils';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { useBlockUser } from '@/lib/useBlockUser';
import { useVibelyDialog } from '@/components/VibelyDialog';

const CYAN = '#22D3EE';
const AMBER = '#F59E0B';
const BOUNDARY_PINK = '#E84393';
const EVENT_VIOLET = '#8B5CF6';

type DiscoveryMode = 'visible' | 'snoozed' | 'hidden';
type DiscoveryAudience = 'everyone' | 'event_based' | 'hidden';
type ActivityVisibility = 'matches' | 'event_connections' | 'nobody';
type DistanceVisibility = 'approximate' | 'hidden';
type EventAttendanceVisibility = 'attendees' | 'matches_only' | 'hidden';

type SnoozePreset = '1h' | 'tomorrow' | '24h' | 'week' | 'indefinite';

const SNOOZE_CHOICES: { key: SnoozePreset; label: string }[] = [
  { key: '1h', label: '1 hour' },
  { key: 'tomorrow', label: 'Until tomorrow morning (8:00 AM)' },
  { key: '24h', label: '24 hours' },
  { key: 'week', label: '1 week' },
  { key: 'indefinite', label: 'Indefinitely' },
];

type PrivacyProfileRow = {
  discovery_mode: DiscoveryMode | null;
  discovery_snooze_until: string | null;
  discovery_audience: DiscoveryAudience | null;
  activity_status_visibility: ActivityVisibility | null;
  distance_visibility: DistanceVisibility | null;
  event_attendance_visibility: EventAttendanceVisibility | null;
  discoverable: boolean | null;
  show_distance: boolean | null;
  show_online_status: boolean | null;
};

/** DB row normalized — no null enum fields. */
type NormalizedPrivacyProfile = {
  discovery_mode: DiscoveryMode;
  discovery_snooze_until: string | null;
  discovery_audience: DiscoveryAudience;
  activity_status_visibility: ActivityVisibility;
  distance_visibility: DistanceVisibility;
  event_attendance_visibility: EventAttendanceVisibility;
  discoverable: boolean;
  show_distance: boolean;
  show_online_status: boolean;
};

async function getMicPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined'> {
  if (Platform.OS === 'android') {
    const result = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    return result ? 'granted' : 'denied';
  }
  return 'undetermined';
}

function normalizeProfile(p: PrivacyProfileRow | null | undefined): NormalizedPrivacyProfile {
  return {
    discovery_mode: p?.discovery_mode ?? 'visible',
    discovery_snooze_until: p?.discovery_snooze_until ?? null,
    discovery_audience: p?.discovery_audience ?? 'everyone',
    activity_status_visibility: p?.activity_status_visibility ?? 'matches',
    distance_visibility: p?.distance_visibility ?? 'approximate',
    event_attendance_visibility: p?.event_attendance_visibility ?? 'attendees',
    discoverable: p?.discoverable ?? true,
    show_distance: p?.show_distance ?? true,
    show_online_status: p?.show_online_status ?? true,
  };
}

function nextMorningEight(): Date {
  const now = new Date();
  const target = new Date(now);
  target.setHours(8, 0, 0, 0);
  if (now.getTime() < target.getTime()) return target;
  target.setDate(target.getDate() + 1);
  return target;
}

function snoozeEndForPreset(preset: Exclude<SnoozePreset, 'indefinite'>): Date {
  const now = new Date();
  switch (preset) {
    case '1h':
      return new Date(now.getTime() + 60 * 60 * 1000);
    case 'tomorrow':
      return nextMorningEight();
    case '24h':
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    case 'week':
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    default:
      return new Date(now.getTime() + 60 * 60 * 1000);
  }
}

function formatSnoozeRemaining(untilIso: string): string {
  const end = new Date(untilIso);
  if (end.getTime() <= Date.now()) return 'ending…';
  return `${formatDistanceStrict(new Date(), end)} left`;
}

function ValueChip({ label, accentColor }: { label: string; accentColor: string }) {
  return (
    <View
      style={[
        styles.valueChip,
        {
          backgroundColor: withAlpha(accentColor, 0.15),
          borderColor: withAlpha(accentColor, 0.3),
        },
      ]}
    >
      <Text style={[styles.valueChipText, { color: accentColor }]}>{label}</Text>
    </View>
  );
}

function SoonBadge({ theme }: { theme: (typeof Colors)['dark'] }) {
  return (
    <View
      style={[
        styles.valueChip,
        {
          backgroundColor: withAlpha(theme.mutedForeground, 0.1),
          borderColor: withAlpha(theme.mutedForeground, 0.2),
        },
      ]}
    >
      <Text style={[styles.soonBadgeText, { color: theme.mutedForeground }]}>Soon</Text>
    </View>
  );
}

export default function PrivacySettingsScreen() {
  const insets = useSafeAreaInsets();
  const theme = Colors[useColorScheme()];
  const { show, dialog } = useVibelyDialog();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { blockedUsers } = useBlockUser(user?.id);

  const { data: rawProfile, isLoading: isProfileLoading } = useQuery({
    queryKey: ['privacy-profile', user?.id],
    queryFn: async (): Promise<PrivacyProfileRow | null> => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select(
          'discovery_mode, discovery_snooze_until, discovery_audience, activity_status_visibility, distance_visibility, event_attendance_visibility, discoverable, show_distance, show_online_status'
        )
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data as PrivacyProfileRow | null;
    },
    enabled: !!user?.id,
  });

  const profile = useMemo(() => normalizeProfile(rawProfile ?? undefined), [rawProfile]);

  const [locStatus, setLocStatus] = useState<Location.PermissionStatus | null>(null);
  const [camStatus, setCamStatus] = useState<string | null>(null);
  const [micStatus, setMicStatus] = useState<string | null>(null);
  const [libStatus, setLibStatus] = useState<string | null>(null);

  const refreshPermissions = useCallback(async () => {
    try {
      const [loc, cam, mic, lib] = await Promise.all([
        Location.getForegroundPermissionsAsync().catch((e) => {
          if (__DEV__) console.warn('[privacy] location permission read failed:', e);
          return { status: Location.PermissionStatus.DENIED as const };
        }),
        getCameraPermissionsAsync(),
        getMicPermissionStatus(),
        getMediaLibraryPermissionsAsync(),
      ]);
      setLocStatus(loc.status);
      setCamStatus(cam.status);
      setMicStatus(mic);
      setLibStatus(lib.status);
    } catch (e) {
      if (__DEV__) console.warn('[privacy] refreshPermissions failed:', e);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshPermissions();
    }, [refreshPermissions])
  );

  const [discoverySheetOpen, setDiscoverySheetOpen] = useState(false);
  const [audienceSheetOpen, setAudienceSheetOpen] = useState(false);
  const [activitySheetOpen, setActivitySheetOpen] = useState(false);
  const [distanceSheetOpen, setDistanceSheetOpen] = useState(false);
  const [eventAttSheetOpen, setEventAttSheetOpen] = useState(false);

  const invalidatePrivacy = () => {
    qc.invalidateQueries({ queryKey: ['privacy-profile', user?.id] });
    qc.invalidateQueries({ queryKey: ['my-profile'] });
  };

  const discoveryChip = useMemo(() => {
    const m = profile.discovery_mode;
    if (m === 'visible') return { label: 'Visible', color: theme.tint };
    if (m === 'snoozed') return { label: 'Snoozed', color: AMBER };
    return { label: 'Hidden', color: theme.mutedForeground };
  }, [profile.discovery_mode, theme.tint, theme.mutedForeground]);

  const discoveryDescription = useMemo(() => {
    if (profile.discovery_mode === 'visible') return 'You appear to new people in discovery';
    if (profile.discovery_mode === 'snoozed' && profile.discovery_snooze_until) {
      const t = format(new Date(profile.discovery_snooze_until), 'MMM d, h:mm a');
      return `Hidden until ${t} · Chats unaffected`;
    }
    if (profile.discovery_mode === 'snoozed') return 'Temporarily hidden from new people · Chats unaffected';
    return 'Hidden from discovery · Your existing chats continue';
  }, [profile.discovery_mode, profile.discovery_snooze_until]);

  const audienceDescription = useMemo(() => {
    switch (profile.discovery_audience) {
      case 'everyone':
        return 'Anyone on Vibely can find you';
      case 'event_based':
        return 'Only people at events you join';
      default:
        return 'No discovery — events and direct only';
    }
  }, [profile.discovery_audience]);

  const audienceChip = useMemo(() => {
    switch (profile.discovery_audience) {
      case 'everyone':
        return { label: 'Everyone', color: theme.tint };
      case 'event_based':
        return { label: 'Event-based', color: CYAN };
      default:
        return { label: 'Hidden', color: theme.mutedForeground };
    }
  }, [profile.discovery_audience, theme.tint, theme.mutedForeground]);

  const activityChip = useMemo(() => {
    switch (profile.activity_status_visibility) {
      case 'matches':
        return { label: 'Matches only', color: theme.tint };
      case 'event_connections':
        return { label: 'Event connections', color: CYAN };
      default:
        return { label: 'Nobody', color: theme.mutedForeground };
    }
  }, [profile.activity_status_visibility, theme.tint, theme.mutedForeground]);

  const distanceChip = useMemo(() => {
    if (profile.distance_visibility === 'approximate') return { label: 'Approximate', color: AMBER };
    return { label: 'Hidden', color: theme.mutedForeground };
  }, [profile.distance_visibility, theme.mutedForeground]);

  const eventAttChip = useMemo(() => {
    switch (profile.event_attendance_visibility) {
      case 'attendees':
        return { label: 'All attendees', color: EVENT_VIOLET };
      case 'matches_only':
        return { label: 'Matches only', color: CYAN };
      default:
        return { label: 'Hidden', color: theme.mutedForeground };
    }
  }, [profile.event_attendance_visibility, theme.mutedForeground]);

  const summaryDiscovery = useMemo(() => {
    const m = profile.discovery_mode;
    if (m === 'visible') return { text: 'Visible', color: theme.tint };
    if (m === 'snoozed' && profile.discovery_snooze_until) {
      return { text: `Snoozed · ${formatSnoozeRemaining(profile.discovery_snooze_until)}`, color: AMBER };
    }
    if (m === 'snoozed') return { text: 'Snoozed', color: AMBER };
    return { text: 'Hidden', color: theme.mutedForeground };
  }, [profile, theme.tint, theme.mutedForeground]);

  const summaryDistance = useMemo(() => {
    if (profile.distance_visibility === 'approximate') return { text: 'Approximate', color: theme.tint };
    return { text: 'Hidden', color: theme.mutedForeground };
  }, [profile.distance_visibility, theme.tint, theme.mutedForeground]);

  const summaryActivity = useMemo(() => {
    switch (profile.activity_status_visibility) {
      case 'matches':
        return { text: 'Matches only', color: theme.tint };
      case 'event_connections':
        return { text: 'Event only', color: CYAN };
      default:
        return { text: 'Off', color: theme.mutedForeground };
    }
  }, [profile.activity_status_visibility, theme.tint, theme.mutedForeground]);

  const summaryEvent = useMemo(() => {
    switch (profile.event_attendance_visibility) {
      case 'attendees':
        return { text: 'Attendees', color: theme.tint };
      case 'matches_only':
        return { text: 'Matches only', color: CYAN };
      default:
        return { text: 'Hidden', color: theme.mutedForeground };
    }
  }, [profile.event_attendance_visibility, theme.tint, theme.mutedForeground]);

  const locDescription = useMemo(() => {
    if (locStatus === Location.PermissionStatus.GRANTED) return 'Allowed while using app';
    if (locStatus === Location.PermissionStatus.DENIED) return 'Not allowed — tap to update';
    if (locStatus === Location.PermissionStatus.UNDETERMINED) return 'Not set';
    return '…';
  }, [locStatus]);

  const permLabel = (status: string | null) => {
    if (status === 'granted') return { text: 'Allowed', ok: true };
    return { text: 'Not allowed', ok: false };
  };

  const micPermLabel = (status: string | null) => {
    if (status === 'granted') return { text: 'Allowed', color: theme.success };
    if (status === 'undetermined') return { text: 'Manage in Settings', color: theme.mutedForeground };
    return { text: 'Not allowed', color: theme.danger };
  };

  const openLegal = (url: string) => {
    WebBrowser.openBrowserAsync(url).catch(() => {});
  };

  const loading = !user?.id || isProfileLoading;

  return (
    <>
    <View style={[styles.root, { backgroundColor: theme.background }]}>
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
            <Text style={[styles.headerTitle, { color: theme.text }]}>Privacy & Visibility</Text>
            <Text style={[styles.headerSubtitle, { color: theme.mutedForeground }]}>
              Control who finds you, what they see, and how you stay protected.
            </Text>
          </View>
        </View>
      </GlassHeaderBar>

      <ScrollView
        contentContainerStyle={[styles.scrollInner, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.loadingBlock}>
            <ActivityIndicator color={theme.tint} />
          </View>
        ) : (
          <>
            <View
              style={[
                styles.summaryCard,
                {
                  backgroundColor: theme.glassSurface,
                  borderColor: theme.border,
                },
              ]}
            >
              <View style={styles.summaryGrid}>
                <SummaryCell theme={theme} label="DISCOVERY" value={summaryDiscovery.text} valueColor={summaryDiscovery.color} />
                <SummaryCell theme={theme} label="DISTANCE" value={summaryDistance.text} valueColor={summaryDistance.color} />
                <SummaryCell theme={theme} label="ACTIVITY" value={summaryActivity.text} valueColor={summaryActivity.color} />
                <SummaryCell theme={theme} label="AT EVENTS" value={summaryEvent.text} valueColor={summaryEvent.color} />
              </View>
            </View>

            <SectionLabel text="VISIBILITY" theme={theme} />
            <SectionCard theme={theme}>
              <SelectorRow
                theme={theme}
                icon="eye-outline"
                iconColor={theme.tint}
                label="Discovery mode"
                description={discoveryDescription}
                onPress={() => setDiscoverySheetOpen(true)}
                right={
                  <View style={styles.rowRight}>
                    <ValueChip label={discoveryChip.label} accentColor={discoveryChip.color} />
                    <Ionicons name="chevron-forward" size={18} color={theme.mutedForeground} />
                  </View>
                }
                showDivider
              />
              <SelectorRow
                theme={theme}
                icon="people-outline"
                iconColor={theme.tint}
                label="Who can discover me"
                description={audienceDescription}
                onPress={() => setAudienceSheetOpen(true)}
                right={
                  <View style={styles.rowRight}>
                    <ValueChip label={audienceChip.label} accentColor={audienceChip.color} />
                    <Ionicons name="chevron-forward" size={18} color={theme.mutedForeground} />
                  </View>
                }
              />
            </SectionCard>

            <SectionLabel text="PRESENCE" theme={theme} />
            <SectionCard theme={theme}>
              <SelectorRow
                theme={theme}
                icon="radio-button-on-outline"
                iconColor={CYAN}
                label="Activity status"
                description="Who can see when you're active on Vibely"
                onPress={() => setActivitySheetOpen(true)}
                right={
                  <View style={styles.rowRight}>
                    <ValueChip label={activityChip.label} accentColor={activityChip.color} />
                    <Ionicons name="chevron-forward" size={18} color={theme.mutedForeground} />
                  </View>
                }
              />
            </SectionCard>

            <SectionLabel text="LOCATION & EVENT PRESENCE" theme={theme} />
            <SectionCard theme={theme}>
              <SelectorRow
                theme={theme}
                icon="location-outline"
                iconColor={AMBER}
                label="Distance visibility"
                description={
                  profile.distance_visibility === 'approximate'
                    ? 'Others see only your approximate distance'
                    : 'Your distance is completely hidden'
                }
                onPress={() => setDistanceSheetOpen(true)}
                right={
                  <View style={styles.rowRight}>
                    <ValueChip label={distanceChip.label} accentColor={distanceChip.color} />
                    <Ionicons name="chevron-forward" size={18} color={theme.mutedForeground} />
                  </View>
                }
                showDivider
              />
              <View
                style={[
                  styles.infoNote,
                  {
                    backgroundColor: withAlpha(AMBER, 0.08),
                    borderColor: withAlpha(AMBER, 0.2),
                  },
                ]}
              >
                <Ionicons name="information-circle-outline" size={14} color={AMBER} />
                <Text style={[styles.infoNoteText, { color: AMBER }]}>
                  Vibely never shares your exact location. Distance is always approximate.
                </Text>
              </View>
              <SelectorRow
                theme={theme}
                icon="calendar-outline"
                iconColor={EVENT_VIOLET}
                label="Event attendance visibility"
                description="Who can see you've joined an event"
                onPress={() => setEventAttSheetOpen(true)}
                right={
                  <View style={styles.rowRight}>
                    <ValueChip label={eventAttChip.label} accentColor={eventAttChip.color} />
                    <Ionicons name="chevron-forward" size={18} color={theme.mutedForeground} />
                  </View>
                }
                showDivider
              />
              <SelectorRow
                theme={theme}
                icon="navigate-outline"
                iconColor={CYAN}
                label="Location permission"
                description={locDescription}
                onPress={() => Linking.openSettings()}
                right={<Ionicons name="chevron-forward" size={18} color={theme.mutedForeground} />}
              />
            </SectionCard>

            <SectionLabel text="BOUNDARIES & SAFETY" theme={theme} />
            <SectionCard theme={theme}>
              <SelectorRow
                theme={theme}
                icon="person-remove-outline"
                iconColor={BOUNDARY_PINK}
                label="Blocked users"
                description="Manage who you've blocked"
                onPress={() => router.push('/settings/blocked-users')}
                right={
                  <View style={styles.rowRight}>
                    {blockedUsers.length > 0 ? (
                      <View
                        style={[
                          styles.countBadge,
                          { backgroundColor: withAlpha(BOUNDARY_PINK, 0.2), borderColor: withAlpha(BOUNDARY_PINK, 0.35) },
                        ]}
                      >
                        <Text style={[styles.countBadgeText, { color: BOUNDARY_PINK }]}>{blockedUsers.length}</Text>
                      </View>
                    ) : null}
                    <Ionicons name="chevron-forward" size={18} color={theme.mutedForeground} />
                  </View>
                }
                showDivider
              />
              <DisabledRow
                theme={theme}
                icon="phone-portrait-outline"
                iconColor={theme.mutedForeground}
                label="Blocked contacts"
                description="Prevent people from your contacts from matching with you"
                right={<SoonBadge theme={theme} />}
                showDivider
              />
              <DisabledRow
                theme={theme}
                icon="chatbubble-ellipses-outline"
                iconColor={theme.mutedForeground}
                label="Hidden words"
                description="Filter messages containing specific words or phrases"
                right={<SoonBadge theme={theme} />}
              />
            </SectionCard>

            <SectionLabel text="DATA & PERMISSIONS" theme={theme} />
            <SectionCard theme={theme}>
              <SelectorRow
                theme={theme}
                icon="camera-outline"
                iconColor={theme.mutedForeground}
                label="Camera"
                description="Used for profile photos and video dates"
                onPress={() => Linking.openSettings()}
                right={
                  <View style={styles.rowRight}>
                    <Text style={{ color: permLabel(camStatus).ok ? theme.success : theme.danger, fontSize: 12, fontWeight: '600' }}>
                      {permLabel(camStatus).text}
                    </Text>
                    <Ionicons name="chevron-forward" size={18} color={theme.mutedForeground} />
                  </View>
                }
                showDivider
              />
              <SelectorRow
                theme={theme}
                icon="mic-outline"
                iconColor={theme.mutedForeground}
                label="Microphone"
                description="Used for video dates and voice"
                onPress={() => Linking.openSettings()}
                right={
                  <View style={styles.rowRight}>
                    <Text style={{ color: micPermLabel(micStatus).color, fontSize: 12, fontWeight: '600' }}>
                      {micPermLabel(micStatus).text}
                    </Text>
                    <Ionicons name="chevron-forward" size={18} color={theme.mutedForeground} />
                  </View>
                }
                showDivider
              />
              <SelectorRow
                theme={theme}
                icon="images-outline"
                iconColor={theme.mutedForeground}
                label="Photos"
                description="Used to pick profile photos"
                onPress={() => Linking.openSettings()}
                right={
                  <View style={styles.rowRight}>
                    <Text style={{ color: permLabel(libStatus).ok ? theme.success : theme.danger, fontSize: 12, fontWeight: '600' }}>
                      {permLabel(libStatus).text}
                    </Text>
                    <Ionicons name="chevron-forward" size={18} color={theme.mutedForeground} />
                  </View>
                }
                showDivider
              />
              <SelectorRow
                theme={theme}
                icon="trash-outline"
                iconColor="#EF4444"
                label="Delete account"
                description="Permanently remove your account and data"
                onPress={() => router.push('/settings/account')}
                right={<Ionicons name="chevron-forward" size={18} color={theme.mutedForeground} />}
              />
            </SectionCard>

            <SectionLabel text="LEGAL" theme={theme} />
            <SectionCard theme={theme}>
              <SettingsRow
                icon={<Ionicons name="document-text-outline" size={20} color={theme.mutedForeground} />}
                title="Privacy Policy"
                onPress={() => openLegal('https://vibelymeet.com/privacy')}
              />
              <View style={[styles.hairline, { backgroundColor: theme.border }]} />
              <SettingsRow
                icon={<Ionicons name="document-text-outline" size={20} color={theme.mutedForeground} />}
                title="Community Guidelines"
                onPress={() => openLegal('https://vibelymeet.com/community-guidelines')}
              />
              <View style={[styles.hairline, { backgroundColor: theme.border }]} />
              <SettingsRow
                icon={<Ionicons name="document-text-outline" size={20} color={theme.mutedForeground} />}
                title="Terms of Service"
                onPress={() => openLegal('https://vibelymeet.com/terms')}
              />
            </SectionCard>
          </>
        )}
      </ScrollView>

      <DiscoveryModeSheet
        visible={discoverySheetOpen}
        theme={theme}
        profile={profile}
        userId={user?.id ?? null}
        onClose={() => setDiscoverySheetOpen(false)}
        onSaved={invalidatePrivacy}
      />

      <OptionSheet<DiscoveryAudience>
        visible={audienceSheetOpen}
        title="Who can discover me"
        theme={theme}
        options={[
          { value: 'everyone', title: 'Everyone', description: 'Standard discovery across Vibely' },
          { value: 'event_based', title: 'Event-based only', description: 'Only discoverable within events you’ve joined' },
          { value: 'hidden', title: 'Hidden', description: 'No passive discovery' },
        ]}
        current={profile.discovery_audience}
        onClose={() => setAudienceSheetOpen(false)}
        onSelect={async (v) => {
          if (!user?.id) return;
          const { error } = await supabase
            .from('profiles')
            .update({
              discovery_audience: v,
            })
            .eq('id', user.id);
          if (error) {
            show({
              title: 'Couldn’t save',
              message: error.message,
              variant: 'warning',
              primaryAction: { label: 'OK', onPress: () => {} },
            });
          } else invalidatePrivacy();
          setAudienceSheetOpen(false);
        }}
      />

      <OptionSheet<ActivityVisibility>
        visible={activitySheetOpen}
        title="Activity status"
        subtitle="Who can see when you're active on Vibely"
        theme={theme}
        options={[
          { value: 'matches', title: 'Matches only', description: 'Only your current matches see active status' },
          { value: 'event_connections', title: 'Event connections', description: 'Only people at the same events' },
          { value: 'nobody', title: 'Nobody', description: 'Activity status completely hidden' },
        ]}
        current={profile.activity_status_visibility}
        onClose={() => setActivitySheetOpen(false)}
        onSelect={async (v) => {
          if (!user?.id) return;
          const { error } = await supabase
            .from('profiles')
            .update({
              activity_status_visibility: v,
              show_online_status: v !== 'nobody',
            })
            .eq('id', user.id);
          if (error) {
            show({
              title: 'Couldn’t save',
              message: error.message,
              variant: 'warning',
              primaryAction: { label: 'OK', onPress: () => {} },
            });
          } else invalidatePrivacy();
          setActivitySheetOpen(false);
        }}
      />

      <OptionSheet<DistanceVisibility>
        visible={distanceSheetOpen}
        title="Distance visibility"
        theme={theme}
        options={[
          { value: 'approximate', title: 'Approximate', description: 'Rough distance (neighborhood level). We never share your exact location.' },
          { value: 'hidden', title: 'Hidden', description: 'No distance shown at all' },
        ]}
        current={profile.distance_visibility}
        onClose={() => setDistanceSheetOpen(false)}
        onSelect={async (v) => {
          if (!user?.id) return;
          const { error } = await supabase
            .from('profiles')
            .update({
              distance_visibility: v,
              show_distance: v === 'approximate',
            })
            .eq('id', user.id);
          if (error) {
            show({
              title: 'Couldn’t save',
              message: error.message,
              variant: 'warning',
              primaryAction: { label: 'OK', onPress: () => {} },
            });
          } else invalidatePrivacy();
          setDistanceSheetOpen(false);
        }}
      />

      <OptionSheet<EventAttendanceVisibility>
        visible={eventAttSheetOpen}
        title="Event attendance visibility"
        theme={theme}
        options={[
          { value: 'attendees', title: 'All attendees', description: 'Anyone at the event can see you joined' },
          { value: 'matches_only', title: 'Matches only', description: 'Only existing matches see your event presence' },
          { value: 'hidden', title: 'Hidden', description: 'You attend privately; no profile visible in the event' },
        ]}
        current={profile.event_attendance_visibility}
        onClose={() => setEventAttSheetOpen(false)}
        onSelect={async (v) => {
          if (!user?.id) return;
          const { error } = await supabase.from('profiles').update({ event_attendance_visibility: v }).eq('id', user.id);
          if (error) {
            show({
              title: 'Couldn’t save',
              message: error.message,
              variant: 'warning',
              primaryAction: { label: 'OK', onPress: () => {} },
            });
          } else invalidatePrivacy();
          setEventAttSheetOpen(false);
        }}
      />
    </View>
    {dialog}
    </>
  );
}

function SummaryCell({
  theme,
  label,
  value,
  valueColor,
}: {
  theme: (typeof Colors)['dark'];
  label: string;
  value: string;
  valueColor: string;
}) {
  return (
    <View style={styles.summaryCell}>
      <Text style={[styles.summaryLabel, { color: theme.mutedForeground }]}>{label}</Text>
      <Text style={[styles.summaryValue, { color: valueColor }]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function SectionLabel({ text, theme }: { text: string; theme: (typeof Colors)['dark'] }) {
  return <Text style={[styles.sectionLabel, { color: theme.mutedForeground }]}>{text}</Text>;
}

function SectionCard({ theme, children }: { theme: (typeof Colors)['dark']; children: React.ReactNode }) {
  return (
    <View
      style={[
        styles.sectionCard,
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
        },
      ]}
    >
      {children}
    </View>
  );
}

function SelectorRow({
  theme,
  icon,
  iconColor,
  label,
  description,
  onPress,
  right,
  showDivider,
}: {
  theme: (typeof Colors)['dark'];
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  label: string;
  description: string;
  onPress?: () => void;
  right: React.ReactNode;
  showDivider?: boolean;
}) {
  const inner = (
    <View
      style={[
        styles.selectorRow,
        showDivider && {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.border,
        },
      ]}
    >
      <Ionicons name={icon} size={20} color={iconColor} />
      <View style={styles.selectorTextWrap}>
        <Text style={[styles.selectorLabel, { color: theme.text }]}>{label}</Text>
        <Text style={[styles.selectorDesc, { color: theme.mutedForeground }]}>{description}</Text>
      </View>
      {right}
    </View>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [pressed && { opacity: 0.85 }]}>
        {inner}
      </Pressable>
    );
  }
  return inner;
}

function DisabledRow({
  theme,
  icon,
  iconColor,
  label,
  description,
  right,
  showDivider,
}: {
  theme: (typeof Colors)['dark'];
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  label: string;
  description: string;
  right: React.ReactNode;
  showDivider?: boolean;
}) {
  return (
    <View style={{ opacity: 0.72 }}>
      <SelectorRow
        theme={theme}
        icon={icon}
        iconColor={iconColor}
        label={label}
        description={description}
        right={right}
        showDivider={showDivider}
      />
    </View>
  );
}

function DiscoveryModeSheet({
  visible,
  onClose,
  theme,
  profile,
  userId,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  theme: (typeof Colors)['dark'];
  profile: NormalizedPrivacyProfile;
  userId: string | null;
  onSaved: () => void;
}) {
  const { show, dialog } = useVibelyDialog();
  const [main, setMain] = useState<DiscoveryMode>('visible');
  const [snoozeExpanded, setSnoozeExpanded] = useState(false);
  const [pickedSnooze, setPickedSnooze] = useState<SnoozePreset | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setMain(profile.discovery_mode ?? 'visible');
    setSnoozeExpanded(profile.discovery_mode === 'snoozed');
    setPickedSnooze(null);
  }, [visible, profile.discovery_mode, profile.discovery_snooze_until]);

  const selectVisible = () => {
    setMain('visible');
    setSnoozeExpanded(false);
    setPickedSnooze(null);
  };

  const selectSnooze = () => {
    setMain('snoozed');
    setSnoozeExpanded(true);
  };

  const selectHidden = () => {
    setMain('hidden');
    setSnoozeExpanded(false);
    setPickedSnooze(null);
  };

  const onSave = async () => {
    if (!userId) return;
    let mode: DiscoveryMode = main;
    let until: string | null = null;

    if (main === 'snoozed') {
      if (pickedSnooze === 'indefinite') {
        mode = 'hidden';
        until = null;
      } else if (
        pickedSnooze === '1h' ||
        pickedSnooze === 'tomorrow' ||
        pickedSnooze === '24h' ||
        pickedSnooze === 'week'
      ) {
        until = snoozeEndForPreset(pickedSnooze).toISOString();
      } else if (profile.discovery_mode === 'snoozed' && profile.discovery_snooze_until) {
        until = profile.discovery_snooze_until;
      } else {
        show({
          title: 'Pick a duration',
          message: 'Choose how long to snooze, or switch to Visible / Hidden.',
          variant: 'info',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
        return;
      }
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          discovery_mode: mode,
          discovery_snooze_until: mode === 'snoozed' ? until : null,
          discoverable: mode === 'visible',
        })
        .eq('id', userId);
      if (error) {
        show({
          title: 'Couldn’t save',
          message: error.message,
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
        return;
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (!visible) return null;

  return (
    <>
    <Modal transparent visible animationType="slide">
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: theme.surface }]} onPress={(e) => e.stopPropagation()}>
          <View style={[styles.handle, { backgroundColor: theme.muted }]} />
          <Text style={[styles.sheetTitle, { color: theme.text }]}>Discovery mode</Text>
          <Text style={[styles.sheetSubtitle, { color: theme.mutedForeground }]}>
            Going hidden keeps your existing matches and chats.
          </Text>

          <SheetOptionRow
            theme={theme}
            icon="eye-outline"
            iconColor={theme.tint}
            title="Visible"
            description="Appear in discovery for new matches"
            selected={main === 'visible'}
            onPress={selectVisible}
          />
          <View>
            <SheetOptionRow
              theme={theme}
              icon="moon-outline"
              iconColor={AMBER}
              title="Snooze…"
              description="Temporarily hide from new people"
              selected={main === 'snoozed'}
              onPress={selectSnooze}
            />
            {snoozeExpanded ? (
              <View style={[styles.snoozeNest, { borderLeftColor: withAlpha(AMBER, 0.4) }]}>
                {SNOOZE_CHOICES.map(({ key, label }) => (
                  <Pressable
                    key={key}
                    onPress={() => setPickedSnooze(key)}
                    style={({ pressed }) => [
                      styles.snoozeOpt,
                      { backgroundColor: pressed ? withAlpha(theme.tint, 0.08) : 'transparent' },
                    ]}
                  >
                    <Text style={{ color: theme.text, fontSize: 14 }}>{label}</Text>
                    {pickedSnooze === key ? (
                      <Ionicons name="checkmark-circle" size={20} color={theme.tint} />
                    ) : null}
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
          <SheetOptionRow
            theme={theme}
            icon="eye-off-outline"
            iconColor={theme.mutedForeground}
            title="Hidden"
            description="Don't appear in discovery or event browsing"
            selected={main === 'hidden'}
            onPress={selectHidden}
          />

          <Pressable
            onPress={() => void onSave()}
            disabled={saving}
            style={[styles.saveBtn, { backgroundColor: theme.tint, opacity: saving ? 0.7 : 1 }]}
          >
            {saving ? <ActivityIndicator color={theme.primaryForeground} /> : <Text style={styles.saveBtnText}>Save</Text>}
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
    {dialog}
    </>
  );
}

function SheetOptionRow({
  theme,
  icon,
  iconColor,
  title,
  description,
  selected,
  onPress,
}: {
  theme: (typeof Colors)['dark'];
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  title: string;
  description: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.sheetOption,
        {
          borderColor: withAlpha(theme.border, 0.6),
          backgroundColor: pressed ? withAlpha(theme.tint, 0.06) : 'transparent',
        },
      ]}
    >
      <Ionicons name={icon} size={22} color={iconColor} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>{title}</Text>
        <Text style={{ color: theme.mutedForeground, fontSize: 12, marginTop: 2 }}>{description}</Text>
      </View>
      {selected ? <Ionicons name="checkmark-circle" size={22} color={theme.tint} /> : <View style={{ width: 22 }} />}
    </Pressable>
  );
}

function OptionSheet<T extends string>({
  visible,
  onClose,
  theme,
  title,
  subtitle,
  options,
  current,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  theme: (typeof Colors)['dark'];
  title: string;
  subtitle?: string;
  options: { value: T; title: string; description?: string }[];
  current: T;
  onSelect: (v: T) => void | Promise<void>;
}) {
  if (!visible) return null;
  return (
    <Modal transparent visible animationType="slide">
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: theme.surface }]} onPress={(e) => e.stopPropagation()}>
          <View style={[styles.handle, { backgroundColor: theme.muted }]} />
          <Text style={[styles.sheetTitle, { color: theme.text }]}>{title}</Text>
          {subtitle ? <Text style={[styles.sheetSubtitle, { color: theme.mutedForeground }]}>{subtitle}</Text> : null}
          {options.map((o) => (
            <Pressable
              key={o.value}
              onPress={() => void onSelect(o.value)}
              style={({ pressed }) => [
                styles.sheetOption,
                {
                  borderColor: withAlpha(theme.border, 0.6),
                  backgroundColor: pressed ? withAlpha(theme.tint, 0.06) : 'transparent',
                },
              ]}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>{o.title}</Text>
                {o.description ? (
                  <Text style={{ color: theme.mutedForeground, fontSize: 12, marginTop: 2 }}>{o.description}</Text>
                ) : null}
              </View>
              {current === o.value ? <Ionicons name="checkmark-circle" size={22} color={theme.tint} /> : null}
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  backBtn: { padding: spacing.xs },
  headerTitles: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  headerSubtitle: { fontSize: 13, marginTop: 2 },
  scrollInner: {
    padding: 16,
    gap: 24,
    paddingTop: layout.mainContentPaddingTop,
  },
  loadingBlock: { paddingVertical: 48, alignItems: 'center' },
  summaryCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  summaryCell: {
    width: '47%',
    flexGrow: 1,
    maxWidth: '50%',
  },
  summaryLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  summaryValue: {
    fontSize: 13,
    fontWeight: '700',
    marginTop: 4,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    paddingLeft: 4,
  },
  sectionCard: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  selectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  selectorTextWrap: { flex: 1, minWidth: 0 },
  selectorLabel: { fontSize: 15, fontWeight: '600' },
  selectorDesc: { fontSize: 12, marginTop: 2 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  valueChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  valueChipText: { fontSize: 12, fontWeight: '600' },
  soonBadgeText: { fontSize: 11, fontWeight: '600' },
  infoNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginHorizontal: 14,
    marginBottom: 10,
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  infoNoteText: { flex: 1, fontSize: 11, lineHeight: 15 },
  countBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  countBadgeText: { fontSize: 12, fontWeight: '700' },
  hairline: { height: StyleSheet.hairlineWidth, marginLeft: 56 },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius['2xl'],
    borderTopRightRadius: radius['2xl'],
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['2xl'],
    paddingTop: spacing.md,
    maxHeight: '88%',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: spacing.md,
  },
  sheetTitle: { fontSize: 20, fontWeight: '700' },
  sheetSubtitle: { fontSize: 13, marginTop: 6, marginBottom: spacing.md },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  snoozeNest: {
    marginLeft: spacing.md,
    marginBottom: 8,
    paddingLeft: spacing.md,
    borderLeftWidth: 2,
  },
  snoozeOpt: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  saveBtn: {
    marginTop: spacing.lg,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
