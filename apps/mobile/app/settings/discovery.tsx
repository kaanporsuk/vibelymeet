/**
 * Discovery preferences — web parity with `DiscoveryDrawer` (decks, intent, default event filters).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { GlassHeaderBar, VibelyButton, VibelyText } from '@/components/ui';
import { spacing, layout, radius } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { fetchMyProfile, updateMyProfile } from '@/lib/profileApi';
import { useEntitlements } from '@/hooks/useEntitlements';
import { openPremium } from '@/lib/premiumNavigation';
import { PREMIUM_ENTRY_SURFACE } from '@shared/premiumFunnel';
import { supabase } from '@/lib/supabase';
import { RelationshipIntentSelector } from '@/components/profile/RelationshipIntentSelector';
import {
  DEFAULT_EVENT_DISCOVERY_PREFS,
  DISTANCE_PRESETS,
  type EventDiscoveryPrefs,
  type EventDiscoverySelectedCity,
  firstInterestedInFromProfile,
  normalizeInterestedInForProfile,
  validateAgePreferencePair,
  clampAgePreference,
} from '@shared/eventDiscoveryContracts';

type GeoResult = {
  lat: number;
  lng: number;
  city: string;
  country: string;
  region?: string;
  display_name: string;
};

const INTEREST_OPTIONS = [
  { label: 'Men', value: 'men' },
  { label: 'Women', value: 'women' },
  { label: 'Everyone', value: 'everyone' },
];

export default function DiscoverySettingsScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { user } = useAuth();
  const { canCityBrowse, isLoading: entLoading } = useEntitlements();
  const queryClient = useQueryClient();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [interested, setInterested] = useState('everyone');
  const [relationshipIntent, setRelationshipIntent] = useState('');
  const [ageMinStr, setAgeMinStr] = useState('');
  const [ageMaxStr, setAgeMaxStr] = useState('');
  const [eventPrefs, setEventPrefs] = useState<EventDiscoveryPrefs>(DEFAULT_EVENT_DISCOVERY_PREFS);
  const [cityQuery, setCityQuery] = useState('');
  const [cityResults, setCityResults] = useState<GeoResult[]>([]);
  const [citySearching, setCitySearching] = useState(false);
  const geocodeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const data = await fetchMyProfile();
      if (!data) {
        Alert.alert('Error', 'Could not load profile');
        return;
      }
      setInterested(firstInterestedInFromProfile(data.interested_in));
      setRelationshipIntent(data.relationship_intent ?? data.looking_for ?? '');
      setAgeMinStr(data.preferred_age_min != null ? String(data.preferred_age_min) : '');
      setAgeMaxStr(data.preferred_age_max != null ? String(data.preferred_age_max) : '');
      setEventPrefs(data.event_discovery_prefs ?? DEFAULT_EVENT_DISCOVERY_PREFS);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCitySearch = (q: string) => {
    setCityQuery(q);
    if (geocodeRef.current) clearTimeout(geocodeRef.current);
    if (q.length < 2) {
      setCityResults([]);
      return;
    }
    geocodeRef.current = setTimeout(async () => {
      setCitySearching(true);
      try {
        const { data, error } = await supabase.functions.invoke('forward-geocode', { body: { query: q } });
        if (!error && Array.isArray(data)) setCityResults(data as GeoResult[]);
        else setCityResults([]);
      } catch {
        setCityResults([]);
      }
      setCitySearching(false);
    }, 300);
  };

  const selectCity = (result: GeoResult) => {
    const next: EventDiscoverySelectedCity = {
      name: result.city,
      country: result.country,
      lat: result.lat,
      lng: result.lng,
      region: result.region?.trim() || null,
    };
    setEventPrefs((p) => ({ ...p, selectedCity: next, locationMode: 'city' }));
    setCityQuery('');
    setCityResults([]);
  };

  const handleSave = async () => {
    const minP = clampAgePreference(ageMinStr.trim() === '' ? null : ageMinStr);
    const maxP = clampAgePreference(ageMaxStr.trim() === '' ? null : ageMaxStr);
    const { min: amin, max: amax } = validateAgePreferencePair(minP, maxP);
    if ((ageMinStr.trim() !== '' && minP === null) || (ageMaxStr.trim() !== '' && maxP === null)) {
      Alert.alert('Invalid age', 'Use ages between 18 and 99, or leave blank.');
      return;
    }
    setSaving(true);
    try {
      await updateMyProfile({
        interested_in: normalizeInterestedInForProfile(interested),
        relationship_intent: relationshipIntent.trim() || '',
        preferred_age_min: amin,
        preferred_age_max: amax,
        event_discovery_prefs: eventPrefs,
      });
      await queryClient.invalidateQueries({ queryKey: ['event-discovery-prefs', user?.id] });
      await queryClient.invalidateQueries({ queryKey: ['events-discover'] });
      Alert.alert('Saved', 'Discovery preferences updated.');
      router.back();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading || entLoading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <GlassHeaderBar insets={insets}>
          <View style={styles.headerRow}>
            <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]}>
              <Ionicons name="arrow-back" size={24} color={theme.text} />
            </Pressable>
            <VibelyText variant="titleMD" style={{ color: theme.text, flex: 1 }}>Discovery</VibelyText>
          </View>
        </GlassHeaderBar>
        <View style={styles.centered}>
          <ActivityIndicator color={theme.tint} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <GlassHeaderBar insets={insets}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]}>
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </Pressable>
          <VibelyText variant="titleMD" style={{ color: theme.text, flex: 1 }}>Discovery</VibelyText>
        </View>
      </GlassHeaderBar>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: layout.scrollContentPaddingBottomTab }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.help, { color: theme.textSecondary }]}>
          City browse still requires Premium when viewing events — your city is saved for when you upgrade.
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.text }]}>Interested in</Text>
        <View style={styles.rowWrap}>
          {INTEREST_OPTIONS.map((opt) => (
            <Pressable
              key={opt.value}
              onPress={() => setInterested(opt.value)}
              style={[
                styles.chip,
                {
                  backgroundColor: interested === opt.value ? theme.tintSoft : theme.surfaceSubtle,
                  borderColor: interested === opt.value ? theme.tint : theme.border,
                },
              ]}
            >
              <Text style={{ color: theme.text, fontWeight: '600', fontSize: 14 }}>{opt.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.sectionTitle, { color: theme.text, marginTop: spacing.lg }]}>Relationship intent</Text>
        <RelationshipIntentSelector selected={relationshipIntent} onSelect={setRelationshipIntent} editable />

        <Text style={[styles.sectionTitle, { color: theme.text, marginTop: spacing.lg }]}>Age range in decks</Text>
        <Text style={[styles.help, { color: theme.textSecondary }]}>Optional. People without an age may still appear.</Text>
        <View style={styles.ageRow}>
          <View style={styles.ageField}>
            <Text style={{ color: theme.textSecondary, fontSize: 12 }}>Min</Text>
            <TextInput
              value={ageMinStr}
              onChangeText={setAgeMinStr}
              placeholder="Any"
              placeholderTextColor={theme.mutedForeground}
              keyboardType="number-pad"
              style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
            />
          </View>
          <View style={styles.ageField}>
            <Text style={{ color: theme.textSecondary, fontSize: 12 }}>Max</Text>
            <TextInput
              value={ageMaxStr}
              onChangeText={setAgeMaxStr}
              placeholder="Any"
              placeholderTextColor={theme.mutedForeground}
              keyboardType="number-pad"
              style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
            />
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: theme.text, marginTop: spacing.lg }]}>Default event list</Text>
        <View style={styles.modeRow}>
          <Pressable
            onPress={() => setEventPrefs((p) => ({ ...p, locationMode: 'nearby', selectedCity: null }))}
            style={[
              styles.modeBtn,
              {
                backgroundColor: eventPrefs.locationMode === 'nearby' ? theme.tintSoft : theme.surfaceSubtle,
                borderColor: eventPrefs.locationMode === 'nearby' ? theme.tint : theme.border,
              },
            ]}
          >
            <Ionicons name="navigate" size={16} color={theme.text} />
            <Text style={{ color: theme.text, fontWeight: '600', marginLeft: 6 }}>Nearby</Text>
          </Pressable>
          <Pressable
            onPress={() => setEventPrefs((p) => ({ ...p, locationMode: 'city' }))}
            style={[
              styles.modeBtn,
              {
                backgroundColor: eventPrefs.locationMode === 'city' ? theme.tintSoft : theme.surfaceSubtle,
                borderColor: eventPrefs.locationMode === 'city' ? theme.tint : theme.border,
              },
            ]}
          >
            {!canCityBrowse ? <Ionicons name="lock-closed" size={14} color={theme.textSecondary} style={{ marginRight: 4 }} /> : null}
            <Text style={{ color: theme.text, fontWeight: '600' }}>City</Text>
          </Pressable>
        </View>
        {!canCityBrowse ? (
          <Pressable
            onPress={() =>
              openPremium(router.push, {
                entry_surface: PREMIUM_ENTRY_SURFACE.CITY_BROWSE_DISCOVERY,
                feature: 'canCityBrowse',
              })
            }
            style={styles.premiumLink}
          >
            <Ionicons name="sparkles" size={14} color={theme.tint} />
            <Text style={{ color: theme.tint, fontSize: 13, marginLeft: 6 }}>Upgrade for city browse</Text>
          </Pressable>
        ) : null}

        {eventPrefs.locationMode === 'city' ? (
          <View style={{ marginTop: spacing.md }}>
            <Text style={{ color: theme.textSecondary, fontSize: 12, marginBottom: 6 }}>City</Text>
            <TextInput
              value={cityQuery}
              onChangeText={handleCitySearch}
              placeholder="Search city…"
              placeholderTextColor={theme.mutedForeground}
              style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
            />
            {citySearching ? <ActivityIndicator color={theme.tint} style={{ marginTop: 8 }} /> : null}
            {cityResults.map((r, i) => (
              <Pressable
                key={`${r.lat}-${r.lng}-${i}`}
                onPress={() => selectCity(r)}
                style={[styles.cityHit, { borderBottomColor: theme.border }]}
              >
                <Text style={{ color: theme.text, fontSize: 14 }}>{r.display_name}</Text>
              </Pressable>
            ))}
            {eventPrefs.selectedCity ? (
              <Text style={{ color: theme.textSecondary, fontSize: 12, marginTop: 8 }}>
                Selected: {eventPrefs.selectedCity.name}, {eventPrefs.selectedCity.country}
              </Text>
            ) : null}
          </View>
        ) : null}

        <Text style={[styles.sectionTitle, { color: theme.text, marginTop: spacing.lg }]}>Radius</Text>
        <View style={styles.rowWrap}>
          {DISTANCE_PRESETS.map((km) => (
            <Pressable
              key={km}
              onPress={() => setEventPrefs((p) => ({ ...p, distanceKm: km }))}
              style={[
                styles.chipSm,
                {
                  backgroundColor: eventPrefs.distanceKm === km ? theme.tint : theme.surfaceSubtle,
                  borderColor: eventPrefs.distanceKm === km ? theme.tint : theme.border,
                },
              ]}
            >
              <Text
                style={{
                  color: eventPrefs.distanceKm === km ? '#fff' : theme.text,
                  fontWeight: '700',
                  fontSize: 12,
                }}
              >
                {km} km
              </Text>
            </Pressable>
          ))}
        </View>

        <VibelyButton label="Save" onPress={() => void handleSave()} loading={saving} style={{ marginTop: spacing.xl }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: layout.containerPadding, paddingTop: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  backBtn: { padding: spacing.xs },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  help: { fontSize: 13, lineHeight: 18, marginBottom: spacing.md },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: spacing.sm },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipSm: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  ageRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  ageField: { flex: 1 },
  input: {
    marginTop: 4,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 16,
  },
  modeRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.xl,
    borderWidth: 1,
  },
  premiumLink: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  cityHit: { paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
});
