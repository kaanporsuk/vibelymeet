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
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import * as WebBrowser from 'expo-web-browser';
import {
  getCameraPermissionsAsync,
  getMediaLibraryPermissionsAsync,
} from 'expo-image-picker';
import { Camera } from 'expo-camera';
import { format, formatDistanceStrict } from 'date-fns';

import Colors from '@/constants/Colors';
import { GlassHeaderBar, SettingsRow } from '@/components/ui';
import { spacing, layout, radius } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { withAlpha } from '@/lib/colorUtils';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { fetchMyLocationData } from '@/lib/myLocationData';
import {
  clearSavedLocationData,
  saveCurrentDeviceLocationToProfile,
  type SaveProfileLocationResult,
} from '@/lib/locationProfileUpdate';
import { useLocationPermission } from '@/lib/useLocationPermission';
import { useBlockUser } from '@/lib/useBlockUser';
import { useVibelyDialog } from '@/components/VibelyDialog';
import {
  isEventAttendanceVisibility,
  type EventAttendanceVisibility,
} from '@clientShared/eventAttendanceVisibility';

const CYAN = '#22D3EE';
const AMBER = '#F59E0B';
const BOUNDARY_PINK = '#E84393';
const EVENT_VIOLET = '#8B5CF6';

type DiscoveryMode = 'visible' | 'snoozed' | 'hidden';
type DiscoveryAudience = 'everyone' | 'event_based' | 'hidden';
type ActivityVisibility = 'matches' | 'event_connections' | 'nobody';
type DistanceVisibility = 'approximate' | 'hidden';

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
  show_online_status: boolean;
};

async function getMicPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined'> {
  try {
    const { status } = await Camera.getMicrophonePermissionsAsync();
    return status as 'granted' | 'denied' | 'undetermined';
  } catch {
    return 'undetermined';
  }
}

function normalizeProfile(p: PrivacyProfileRow | null | undefined): NormalizedPrivacyProfile {
  return {
    discovery_mode: p?.discovery_mode ?? 'visible',
    discovery_snooze_until: p?.discovery_snooze_until ?? null,
    discovery_audience: p?.discovery_audience ?? 'everyone',
    activity_status_visibility: p?.activity_status_visibility ?? 'matches',
    distance_visibility: p?.distance_visibility ?? 'approximate',
    event_attendance_visibility: isEventAttendanceVisibility(p?.event_attendance_visibility)
      ? p.event_attendance_visibility
      : 'attendees',
    discoverable: p?.discoverable ?? true,
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
          'discovery_mode, discovery_snooze_until, discovery_audience, activity_status_visibility, distance_visibility, event_attendance_visibility, discoverable, show_online_status'
        )
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data as PrivacyProfileRow | null;
    },
    enabled: !!user?.id,
  });

  const profile = useMemo(() => normalizeProfile(rawProfile ?? undefined), [rawProfile]);
  const locationPermission = useLocationPermission();

  const [camStatus, setCamStatus] = useState<string | null>(null);
  const [micStatus, setMicStatus] = useState<string | null>(null);
  const [libStatus, setLibStatus] = useState<string | null>(null);
  const [locationActionLoading, setLocationActionLoading] = useState(false);
  const [clearLocationLoading, setClearLocationLoading] = useState(false);

  const { data: savedLocation, isLoading: isSavedLocationLoading, refetch: refetchSavedLocation } = useQuery({
    queryKey: ['profile-location', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      return fetchMyLocationData();
    },
    enabled: !!user?.id,
  });

  const hasSavedLocation =
    savedLocation?.location_data?.lat != null &&
    savedLocation.location_data.lng != null;

  const refreshMediaPermissions = useCallback(async () => {
    try {
      const [cam, mic, lib] = await Promise.all([
        getCameraPermissionsAsync(),
        getMicPermissionStatus(),
        getMediaLibraryPermissionsAsync(),
      ]);
      setCamStatus(cam.status);
      setMicStatus(mic);
      setLibStatus(lib.status);
    } catch (e) {
      if (__DEV__) console.warn('[privacy] refreshMediaPermissions failed:', e);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshMediaPermissions();
    }, [refreshMediaPermissions])
  );

  const [discoverySheetOpen, setDiscoverySheetOpen] = useState(false);
  const [audienceSheetOpen, setAudienceSheetOpen] = useState(false);
  const [activitySheetOpen, setActivitySheetOpen] = useState(false);
  const [distanceSheetOpen, setDistanceSheetOpen] = useState(false);
  const [eventAttSheetOpen, setEventAttSheetOpen] = useState(false);
  const [audienceSaving, setAudienceSaving] = useState<DiscoveryAudience | null>(null);
  const [distanceSaving, setDistanceSaving] = useState<DistanceVisibility | null>(null);

  const invalidatePrivacy = () => {
    qc.invalidateQueries({ queryKey: ['privacy-profile', user?.id] });
  };

  const invalidateLocationSurfaces = useCallback(async () => {
    await Promise.all([
      refetchSavedLocation(),
      qc.invalidateQueries({ queryKey: ['profile-location', user?.id] }),
      qc.invalidateQueries({ queryKey: ['my-profile'] }),
      qc.invalidateQueries({ queryKey: ['events-discover'] }),
      qc.invalidateQueries({ queryKey: ['other-city-events', user?.id] }),
      qc.invalidateQueries({ queryKey: ['next-registered-event'] }),
    ]);
  }, [qc, refetchSavedLocation, user?.id]);

  const showLocationSaveResult = useCallback((result: SaveProfileLocationResult) => {
    switch (result.status) {
      case 'success':
        show({
          title: 'Location saved',
          message: `${result.location} will power Nearby events and approximate distance.`,
          variant: 'success',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
        return;
      case 'services_disabled':
        show({
          title: 'Location Services are off',
          message: 'Turn on device Location Services, then return to Vibely to update your saved area.',
          variant: 'warning',
          primaryAction: { label: 'Open Settings', onPress: () => void locationPermission.openSettings() },
          secondaryAction: { label: 'Not now', onPress: () => {} },
        });
        return;
      case 'permission_denied':
        show({
          title: 'Location access needed',
          message: result.canAskAgain === false
            ? 'Location is off for Vibely. Enable it in Settings to update your saved area.'
            : 'Allow location access so Vibely can update your saved area for Nearby events.',
          variant: 'warning',
          primaryAction: result.canAskAgain === false
            ? { label: 'Open Settings', onPress: () => void locationPermission.openSettings() }
            : { label: 'OK', onPress: () => {} },
        });
        return;
      case 'permission_error':
        show({
          title: "Couldn't check location",
          message: 'Vibely could not read your location permission right now. Try again in a moment.',
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
        return;
      case 'gps_failed':
        show({
          title: "Couldn't get your location",
          message: 'Make sure device Location Services are on and try again.',
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
        return;
      case 'geocode_failed':
        show({
          title: 'Location not recognized',
          message: "We couldn't match your GPS position to a city. Try again in a moment.",
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
        return;
      case 'backend_failed':
        show({
          title: "Couldn't save location",
          message: 'Your permission may be allowed, but your saved area was not updated. Try again in a moment.',
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
        return;
      default:
        return;
    }
  }, [locationPermission, show]);

  const handleLocationPermissionPress = useCallback(async () => {
    if (!user?.id || locationActionLoading) return;
    setLocationActionLoading(true);
    try {
      let status = locationPermission.status;
      let canAskAgain = locationPermission.canAskAgain;
      let servicesEnabled = locationPermission.servicesEnabled;

      if (status === 'unknown') {
        const refreshed = await locationPermission.refresh();
        status = refreshed.status;
        canAskAgain = refreshed.canAskAgain;
        servicesEnabled = refreshed.servicesEnabled;

        if (status === 'unknown') {
          show({
            title: "Couldn't check location",
            message: 'Vibely could not read your location permission right now. Try again in a moment.',
            variant: 'warning',
            primaryAction: { label: 'OK', onPress: () => {} },
          });
          return;
        }
      }

      const granted = status === 'granted';
      const denied = status === 'denied';
      const undetermined = status === 'undetermined';

      if (servicesEnabled === false) {
        show({
          title: 'Location Services are off',
          message: 'Turn on device Location Services in Settings, then return to Vibely.',
          variant: 'warning',
          primaryAction: { label: 'Open Settings', onPress: () => void locationPermission.openSettings() },
          secondaryAction: { label: 'Not now', onPress: () => {} },
        });
        return;
      }

      if (denied && canAskAgain === false) {
        await locationPermission.openSettings();
        return;
      }

      if (
        undetermined ||
        (denied && canAskAgain !== false) ||
        (granted && !hasSavedLocation)
      ) {
        const result = await saveCurrentDeviceLocationToProfile({
          userId: user.id,
          requestPermission: !granted,
        });
        await locationPermission.refresh();
        if (result.status === 'success') await invalidateLocationSurfaces();
        showLocationSaveResult(result);
        return;
      }

      await locationPermission.openSettings();
    } finally {
      setLocationActionLoading(false);
    }
  }, [
    hasSavedLocation,
    invalidateLocationSurfaces,
    locationActionLoading,
    locationPermission,
    show,
    showLocationSaveResult,
    user?.id,
  ]);

  const clearSavedArea = useCallback(async () => {
    if (clearLocationLoading) return;
    setClearLocationLoading(true);
    try {
      const result = await clearSavedLocationData();
      if (result.status === 'success') {
        await invalidateLocationSurfaces();
        show({
          title: 'Saved area cleared',
          message: 'Nearby and local event visibility may be limited until you set your location again.',
          variant: 'success',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
        return;
      }
      show({
        title: "Couldn't clear saved area",
        message: 'Try again in a moment.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    } finally {
      setClearLocationLoading(false);
    }
  }, [clearLocationLoading, invalidateLocationSurfaces, show]);

  const handleClearSavedAreaPress = useCallback(() => {
    if (!hasSavedLocation || clearLocationLoading) return;
    show({
      title: 'Clear saved area?',
      message: 'This removes your saved city and private coordinates. Nearby/local events may be limited until you set location again.',
      variant: 'warning',
      primaryAction: { label: 'Clear', onPress: () => void clearSavedArea() },
      secondaryAction: { label: 'Cancel', onPress: () => {} },
    });
  }, [clearLocationLoading, clearSavedArea, hasSavedLocation, show]);

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
        return 'People can discover you in eligible Vibely experiences';
      case 'event_based':
        return 'People can discover you through events you’ve joined';
      default:
        return 'You won’t appear in passive discovery';
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
        return { text: 'All attendees', color: theme.tint };
      case 'matches_only':
        return { text: 'Matches only', color: CYAN };
      default:
        return { text: 'Hidden', color: theme.mutedForeground };
    }
  }, [profile.event_attendance_visibility, theme.tint, theme.mutedForeground]);

  const locDescription = useMemo(() => {
    if (locationPermission.isLoading) return 'Checking...';
    if (locationPermission.status === 'unknown') return "Couldn't check location permission";
    if (locationPermission.servicesEnabled === false) {
      return locationPermission.granted
        ? 'Allowed, but device Location Services are off'
        : 'Device Location Services are off — tap to update in Settings';
    }
    if (locationPermission.undetermined) return 'Not asked yet — tap to allow Nearby events';
    if (locationPermission.denied && locationPermission.canAskAgain === false) {
      return 'Not allowed — tap to update in Settings';
    }
    if (locationPermission.denied) return 'Not allowed — tap to request access';
    if (locationPermission.granted && !hasSavedLocation) return 'Allowed — saved area missing';
    if (locationPermission.granted) return 'Allowed while using app';
    return 'Checking...';
  }, [
    hasSavedLocation,
    locationPermission.canAskAgain,
    locationPermission.denied,
    locationPermission.granted,
    locationPermission.isLoading,
    locationPermission.servicesEnabled,
    locationPermission.status,
    locationPermission.undetermined,
  ]);

  const locChip = useMemo(() => {
    if (locationActionLoading || locationPermission.isLoading) {
      return { label: 'Checking', color: theme.mutedForeground };
    }
    if (locationPermission.status === 'unknown') {
      return { label: 'Check failed', color: theme.danger };
    }
    if (locationPermission.servicesEnabled === false) {
      return { label: 'Services off', color: theme.danger };
    }
    if (locationPermission.granted && hasSavedLocation) {
      return { label: 'Allowed', color: theme.success };
    }
    if (locationPermission.granted && !hasSavedLocation) {
      return { label: 'Missing area', color: AMBER };
    }
    if (locationPermission.undetermined) {
      return { label: 'Not asked', color: AMBER };
    }
    return { label: 'Not allowed', color: theme.danger };
  }, [
    hasSavedLocation,
    locationActionLoading,
    locationPermission.granted,
    locationPermission.isLoading,
    locationPermission.servicesEnabled,
    locationPermission.status,
    locationPermission.undetermined,
    theme.danger,
    theme.mutedForeground,
    theme.success,
  ]);

  const savedAreaDescription = useMemo(() => {
    if (isSavedLocationLoading) return 'Checking saved area...';
    if (!hasSavedLocation) return 'No saved area. Nearby may show only global events until you set one.';
    return savedLocation?.location
      ? `${savedLocation.location} powers Nearby events and approximate distance.`
      : 'Saved coordinates power Nearby events and approximate distance.';
  }, [hasSavedLocation, isSavedLocationLoading, savedLocation?.location]);

  const permLabel = (status: string | null) => {
    if (status === 'granted') return { text: 'Allowed', ok: true };
    return { text: 'Not allowed', ok: false };
  };

  const micPermLabel = (status: string | null) => {
    if (status === 'granted') return { text: 'Allowed', color: theme.success };
    if (status === 'undetermined') return { text: 'Not set', color: theme.mutedForeground };
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
              <View
                style={[
                  styles.infoNote,
                  {
                    backgroundColor: withAlpha(theme.tint, 0.08),
                    borderColor: withAlpha(theme.tint, 0.2),
                  },
                ]}
              >
                <Ionicons name="information-circle-outline" size={14} color={theme.tint} />
                <Text style={[styles.infoNoteText, { color: theme.tint }]}>
                  This controls passive discovery, such as decks, suggestions, and event-based introductions.
                  Existing matches can still see and message you.
                </Text>
              </View>
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
                    ? 'People may see only a rough distance range'
                    : 'No distance from you is shown'
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
                  Exact/current coordinates may be stored privately for Nearby. Other people only see approximate distance.
                </Text>
              </View>
              <SelectorRow
                theme={theme}
                icon="calendar-outline"
                iconColor={EVENT_VIOLET}
                label="Event attendance visibility"
                description="Controls who can see you in attendee lists."
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
                onPress={() => void handleLocationPermissionPress()}
                right={
                  <View style={styles.rowRight}>
                    {locationActionLoading ? (
                      <ActivityIndicator size="small" color={theme.tint} />
                    ) : (
                      <ValueChip label={locChip.label} accentColor={locChip.color} />
                    )}
                    <Ionicons name="chevron-forward" size={18} color={theme.mutedForeground} />
                  </View>
                }
                showDivider
              />
              <SelectorRow
                theme={theme}
                icon="map-outline"
                iconColor={AMBER}
                label="Saved area"
                description={savedAreaDescription}
                onPress={hasSavedLocation ? handleClearSavedAreaPress : undefined}
                right={
                  hasSavedLocation ? (
                    <View style={styles.rowRight}>
                      {clearLocationLoading ? (
                        <ActivityIndicator size="small" color={theme.tint} />
                      ) : (
                        <ValueChip label="Clear" accentColor={theme.danger} />
                      )}
                      <Ionicons name="chevron-forward" size={18} color={theme.mutedForeground} />
                    </View>
                  ) : (
                    <Ionicons name="remove-circle-outline" size={18} color={theme.mutedForeground} />
                  )
                }
              />
              <View
                style={[
                  styles.infoNote,
                  {
                    backgroundColor: withAlpha(CYAN, 0.08),
                    borderColor: withAlpha(CYAN, 0.2),
                  },
                ]}
              >
                <Ionicons name="information-circle-outline" size={14} color={CYAN} />
                <Text style={[styles.infoNoteText, { color: CYAN }]}>
                  Device permission controls fresh GPS updates. Your saved area can still power Nearby events until you update or clear it.
                </Text>
              </View>
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
                description="Schedule account removal (~30 days to cancel)"
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
          { value: 'everyone', title: 'Everyone', description: 'People can discover you in eligible Vibely experiences' },
          { value: 'event_based', title: 'Event-based only', description: 'People can discover you through events you’ve joined' },
          { value: 'hidden', title: 'Hidden', description: 'You won’t appear in passive discovery' },
        ]}
        current={profile.discovery_audience}
        disabled={audienceSaving !== null}
        savingValue={audienceSaving}
        onClose={() => setAudienceSheetOpen(false)}
        onSelect={async (v) => {
          if (!user?.id || audienceSaving !== null) return;
          setAudienceSaving(v);
          const { error } = await supabase
            .from('profiles')
            .update({
              discovery_audience: v,
            })
            .eq('id', user.id);
          if (error) {
            show({
              title: 'Couldn’t save',
              message: 'Your discoverability setting was not updated. Please try again.',
              variant: 'warning',
              primaryAction: { label: 'OK', onPress: () => {} },
            });
            setAudienceSaving(null);
            return;
          }
          invalidatePrivacy();
          setAudienceSaving(null);
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
          { value: 'approximate', title: 'Approximate', description: 'People may see only a rough distance range. Your exact location is never shared.' },
          { value: 'hidden', title: 'Hidden', description: 'No distance from you is shown.' },
        ]}
        current={profile.distance_visibility}
        disabled={distanceSaving !== null}
        savingValue={distanceSaving}
        onClose={() => setDistanceSheetOpen(false)}
        onSelect={async (v) => {
          if (!user?.id || distanceSaving !== null) return;
          setDistanceSaving(v);
          const { error } = await supabase
            .from('profiles')
            .update({
              distance_visibility: v,
            })
            .eq('id', user.id);
          if (error) {
            show({
              title: 'Couldn’t save',
              message: error.message,
              variant: 'warning',
              primaryAction: { label: 'OK', onPress: () => {} },
            });
            setDistanceSaving(null);
            return;
          }
          invalidatePrivacy();
          setDistanceSaving(null);
          setDistanceSheetOpen(false);
        }}
      />

      <OptionSheet<EventAttendanceVisibility>
        visible={eventAttSheetOpen}
        title="Event attendance visibility"
        subtitle="Live lobby matching may still show your profile when you participate."
        theme={theme}
        options={[
          { value: 'attendees', title: 'All attendees', description: 'All attendees can see you in attendee lists.' },
          { value: 'matches_only', title: 'Matches only', description: 'Current matches can see you in attendee lists.' },
          { value: 'hidden', title: 'Hidden', description: 'Hide me from attendee lists and previews.' },
        ]}
        current={profile.event_attendance_visibility}
        onClose={() => setEventAttSheetOpen(false)}
        onSelect={async (v) => {
          if (!isEventAttendanceVisibility(v)) return;
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
  disabled = false,
  savingValue,
}: {
  visible: boolean;
  onClose: () => void;
  theme: (typeof Colors)['dark'];
  title: string;
  subtitle?: string;
  options: { value: T; title: string; description?: string }[];
  current: T;
  onSelect: (v: T) => void | Promise<void>;
  disabled?: boolean;
  savingValue?: T | null;
}) {
  if (!visible) return null;
  return (
    <Modal transparent visible animationType="slide">
      <Pressable style={styles.sheetBackdrop} onPress={disabled ? undefined : onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: theme.surface }]} onPress={(e) => e.stopPropagation()}>
          <View style={[styles.handle, { backgroundColor: theme.muted }]} />
          <Text style={[styles.sheetTitle, { color: theme.text }]}>{title}</Text>
          {subtitle ? <Text style={[styles.sheetSubtitle, { color: theme.mutedForeground }]}>{subtitle}</Text> : null}
          {options.map((o) => (
            <Pressable
              key={o.value}
              disabled={disabled}
              onPress={() => void onSelect(o.value)}
              style={({ pressed }) => [
                styles.sheetOption,
                {
                  borderColor: withAlpha(theme.border, 0.6),
                  backgroundColor: pressed ? withAlpha(theme.tint, 0.06) : 'transparent',
                  opacity: disabled && savingValue !== o.value ? 0.55 : 1,
                },
              ]}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>{o.title}</Text>
                {o.description ? (
                  <Text style={{ color: theme.mutedForeground, fontSize: 12, marginTop: 2 }}>{o.description}</Text>
                ) : null}
              </View>
              {savingValue === o.value ? (
                <ActivityIndicator size="small" color={theme.tint} />
              ) : current === o.value ? (
                <Ionicons name="checkmark-circle" size={22} color={theme.tint} />
              ) : (
                <View style={{ width: 22 }} />
              )}
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
