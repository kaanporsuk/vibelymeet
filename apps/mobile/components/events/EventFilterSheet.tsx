import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  Switch,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { KeyboardAwareBottomSheetModal } from '@/components/keyboard/KeyboardAwareBottomSheetModal';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { spacing, radius } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { EVENT_LANGUAGES } from '@/lib/eventLanguages';
import { supabase } from '@/lib/supabase';
import * as Location from 'expo-location';

const CATEGORIES = [
  'Music', 'Tech', 'Art', 'Gaming', 'Food',
  'Wellness', 'Outdoor', 'Sports', 'Social', 'Dating',
] as const;

const DISTANCE_OPTIONS = [
  { km: 10, label: '10 km' },
  { km: 25, label: '25 km' },
  { km: 50, label: '50 km' },
  { km: 100, label: '100 km' },
] as const;

export interface SelectedCity {
  name: string;
  country: string;
  lat: number;
  lng: number;
  region?: string | null;
}

export interface EventFilters {
  categories: string[];
  language: string | null;
  locationMode: 'nearby' | 'city';
  selectedCity: SelectedCity | null;
  distanceKm: number;
  upcomingOnly: boolean;
}

export const DEFAULT_FILTERS: EventFilters = {
  categories: [],
  language: null,
  locationMode: 'nearby',
  selectedCity: null,
  distanceKm: 50,
  upcomingOnly: true,
};

interface GeoResult {
  lat: number;
  lng: number;
  city: string;
  country: string;
  region?: string;
  display_name: string;
}

interface EventFilterSheetProps {
  visible: boolean;
  onClose: () => void;
  filters: EventFilters;
  onApply: (filters: EventFilters) => void;
  canCityBrowse: boolean;
  onPremiumUpgrade: () => void;
}

export default function EventFilterSheet({
  visible, onClose, filters, onApply, canCityBrowse, onPremiumUpgrade,
}: EventFilterSheetProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];

  const [draft, setDraft] = useState<EventFilters>(filters);
  const [locationStatus, setLocationStatus] = useState<'unknown' | 'granted' | 'denied'>('unknown');

  const [cityQuery, setCityQuery] = useState('');
  const [cityResults, setCityResults] = useState<GeoResult[]>([]);
  const [isCitySearching, setIsCitySearching] = useState(false);
  const geocodeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible) {
      let f = filters;
      if (f.locationMode === 'city' && !canCityBrowse) {
        f = { ...f, locationMode: 'nearby', selectedCity: null, distanceKm: 50 };
      }
      setDraft(f);
      setCityQuery('');
      setCityResults([]);
    }
  }, [visible, filters, canCityBrowse]);

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        setLocationStatus(status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'unknown');
      } catch {
        setLocationStatus('unknown');
      }
    })();
  }, []);

  const toggleCategory = (cat: string) => {
    setDraft(prev => ({
      ...prev,
      categories: prev.categories.includes(cat)
        ? prev.categories.filter(c => c !== cat)
        : [...prev.categories, cat],
    }));
  };

  const setLanguage = (code: string | null) => {
    setDraft(prev => ({ ...prev, language: code }));
  };

  const setLocationMode = (mode: 'nearby' | 'city') => {
    if (mode === 'nearby') {
      setDraft(prev => ({ ...prev, locationMode: 'nearby', selectedCity: null, distanceKm: 50 }));
      setCityQuery('');
      setCityResults([]);
    } else {
      setDraft(prev => ({ ...prev, locationMode: 'city', distanceKm: 25 }));
    }
  };

  const requestLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setLocationStatus(status === 'granted' ? 'granted' : 'denied');
    } catch {
      setLocationStatus('denied');
    }
  };

  const handleCitySearch = useCallback((q: string) => {
    setCityQuery(q);
    if (geocodeTimeout.current) clearTimeout(geocodeTimeout.current);
    if (q.length < 2) { setCityResults([]); return; }
    geocodeTimeout.current = setTimeout(async () => {
      setIsCitySearching(true);
      try {
        const { data, error } = await supabase.functions.invoke('forward-geocode', { body: { query: q } });
        if (!error && Array.isArray(data)) setCityResults(data);
        else setCityResults([]);
      } catch {
        setCityResults([]);
      }
      setIsCitySearching(false);
    }, 300);
  }, []);

  const selectCity = useCallback((result: GeoResult) => {
    setDraft(prev => ({
      ...prev,
      selectedCity: {
        name: result.city,
        country: result.country,
        lat: result.lat,
        lng: result.lng,
        region: result.region?.trim() || null,
      },
    }));
    setCityQuery('');
    setCityResults([]);
  }, []);

  const clearCity = useCallback(() => {
    setDraft(prev => ({ ...prev, selectedCity: null }));
    setCityQuery('');
    setCityResults([]);
  }, []);

  const setDistance = (km: number) => {
    setDraft(prev => ({ ...prev, distanceKm: km }));
  };

  const clearAll = () => {
    setDraft(DEFAULT_FILTERS);
    setCityQuery('');
    setCityResults([]);
  };

  const activeCount = countActiveFilters(draft);

  const handleApply = () => {
    onApply(draft);
    onClose();
  };

  return (
    <KeyboardAwareBottomSheetModal
      visible={visible}
      onRequestClose={onClose}
      animationType="slide"
      maxHeightRatio={0.75}
      backdropColor="rgba(0,0,0,0.5)"
      sheetStyle={{
        backgroundColor: theme.background,
        borderColor: theme.border,
        overflow: 'hidden',
      }}
      footer={
        <View style={[s.footer, { borderTopColor: theme.border }]}>
          <Pressable onPress={clearAll} style={s.clearBtn}>
            <Text style={[s.clearBtnText, { color: theme.accent }]}>Clear all</Text>
          </Pressable>
          <Pressable onPress={handleApply} style={s.applyBtn}>
            <Text style={s.applyBtnText}>
              Apply{activeCount > 0 ? ` (${activeCount})` : ''}
            </Text>
          </Pressable>
        </View>
      }
    >
      <View style={s.handleRow}>
        <View style={[s.handle, { backgroundColor: theme.border }]} />
      </View>

      <View style={s.header}>
        <Text style={[s.headerTitle, { color: theme.text }]}>Filters</Text>
        <Pressable onPress={onClose} hitSlop={12}>
          <Ionicons name="close" size={24} color={theme.textSecondary} />
        </Pressable>
      </View>

      <View style={s.bodyContent}>
            {/* ── Categories ── */}
            <Text style={[s.sectionTitle, { color: theme.text }]}>Categories</Text>
            <View style={s.chipWrap}>
              {CATEGORIES.map(cat => {
                const active = draft.categories.includes(cat);
                return (
                  <Pressable
                    key={cat}
                    onPress={() => toggleCategory(cat)}
                    style={[
                      s.chip,
                      active
                        ? { backgroundColor: '#8B5CF6', borderColor: '#8B5CF6' }
                        : { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.1)' },
                    ]}
                  >
                    <Text style={[s.chipText, { color: active ? '#fff' : theme.textSecondary }]}>
                      {cat}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* ── Language ── */}
            <Text style={[s.sectionTitle, { color: theme.text, marginTop: spacing.xl }]}>Language</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.langRow}
            >
              <Pressable
                onPress={() => setLanguage(null)}
                style={[
                  s.langChip,
                  !draft.language
                    ? { backgroundColor: '#8B5CF6', borderColor: '#8B5CF6' }
                    : { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.1)' },
                ]}
              >
                <Text style={[s.langChipText, { color: !draft.language ? '#fff' : theme.textSecondary }]}>
                  Any language
                </Text>
              </Pressable>
              {EVENT_LANGUAGES.map(lang => {
                const active = draft.language === lang.code;
                return (
                  <Pressable
                    key={lang.code}
                    onPress={() => setLanguage(active ? null : lang.code)}
                    style={[
                      s.langChip,
                      active
                        ? { backgroundColor: '#8B5CF6', borderColor: '#8B5CF6' }
                        : { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.1)' },
                    ]}
                  >
                    <Text style={[s.langChipText, { color: active ? '#fff' : theme.textSecondary }]}>
                      {lang.flag} {lang.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* ── Location ── */}
            <Text style={[s.sectionTitle, { color: theme.text, marginTop: spacing.xl }]}>Location</Text>

            {/* Mode pills */}
            <View style={s.locationModeRow}>
              <Pressable
                onPress={() => setLocationMode('nearby')}
                style={[
                  s.modePill,
                  draft.locationMode === 'nearby'
                    ? { backgroundColor: '#8B5CF6', borderColor: '#8B5CF6' }
                    : { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.1)' },
                ]}
              >
                <Ionicons name="navigate" size={14} color={draft.locationMode === 'nearby' ? '#fff' : theme.textSecondary} />
                <Text style={[s.modePillText, { color: draft.locationMode === 'nearby' ? '#fff' : theme.textSecondary }]}>
                  Nearby
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setLocationMode('city')}
                style={[
                  s.modePill,
                  draft.locationMode === 'city'
                    ? { backgroundColor: '#8B5CF6', borderColor: '#8B5CF6' }
                    : { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.1)' },
                ]}
              >
                <Ionicons name="globe" size={14} color={draft.locationMode === 'city' ? '#fff' : theme.textSecondary} />
                <Text style={[s.modePillText, { color: draft.locationMode === 'city' ? '#fff' : theme.textSecondary }]}>
                  Choose a city
                </Text>
                {!canCityBrowse && (
                  <Ionicons name="lock-closed" size={11} color={draft.locationMode === 'city' ? '#fff' : theme.textSecondary} style={{ marginLeft: 2 }} />
                )}
              </Pressable>
            </View>

            {/* Nearby: permission helper */}
            {draft.locationMode === 'nearby' && locationStatus !== 'granted' && (
              <Pressable
                onPress={requestLocation}
                style={[s.permissionHelper, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}
              >
                <Ionicons name="location-outline" size={16} color={theme.tint} />
                <Text style={[s.permissionHelperText, { color: theme.textSecondary }]}>
                  {locationStatus === 'denied'
                    ? 'Location permission denied — enable in Settings'
                    : 'Tap to enable location for nearby events'}
                </Text>
              </Pressable>
            )}

            {/* City mode: upsell for free users */}
            {draft.locationMode === 'city' && !canCityBrowse && (
              <View style={[s.upsellCard, { borderColor: 'rgba(139,92,246,0.25)' }]}>
                <Text style={s.upsellEmoji}>💎</Text>
                <View style={s.upsellContent}>
                  <Text style={[s.upsellTitle, { color: theme.text }]}>Discover events in other cities</Text>
                  <Text style={[s.upsellDesc, { color: theme.textSecondary }]}>
                    Search and join events anywhere in the world with Vibely Premium
                  </Text>
                  <Pressable onPress={onPremiumUpgrade} style={s.upsellCta}>
                    <Ionicons name="sparkles" size={14} color="#fff" />
                    <Text style={s.upsellCtaText}>Upgrade to Premium</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* City mode: search (premium users) */}
            {draft.locationMode === 'city' && canCityBrowse && (
              <>
                {draft.selectedCity ? (
                  <View style={[s.selectedCityRow, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
                    <Ionicons name="location" size={16} color={theme.tint} />
                    <Text style={[s.selectedCityText, { color: theme.text }]} numberOfLines={1}>
                      📍 {draft.selectedCity.name}
                      {draft.selectedCity.region ? `, ${draft.selectedCity.region}` : ''}, {draft.selectedCity.country}
                    </Text>
                    <Pressable onPress={clearCity} hitSlop={8}>
                      <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
                    </Pressable>
                  </View>
                ) : (
                  <>
                    <View style={[s.citySearchWrap, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
                      <Ionicons name="search" size={16} color={theme.textSecondary} />
                      <TextInput
                        style={[s.citySearchInput, { color: theme.text }]}
                        value={cityQuery}
                        onChangeText={handleCitySearch}
                        placeholder="Search for a city..."
                        placeholderTextColor={theme.textSecondary}
                        autoCapitalize="words"
                        returnKeyType="search"
                      />
                      {isCitySearching && <ActivityIndicator size="small" color={theme.tint} />}
                    </View>
                    {cityResults.length > 0 && (
                      <View style={[s.cityResultsList, { borderColor: theme.border }]}>
                        {cityResults.map((result, i) => (
                          <Pressable
                            key={`${result.lat}-${result.lng}-${i}`}
                            onPress={() => selectCity(result)}
                            style={[
                              s.cityResultItem,
                              i < cityResults.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
                            ]}
                          >
                            <Ionicons name="location-outline" size={16} color={theme.textSecondary} />
                            <View style={s.cityResultTextWrap}>
                              <Text style={[s.cityResultName, { color: theme.text }]}>{result.city}</Text>
                              <Text style={[s.cityResultCountry, { color: theme.textSecondary }]} numberOfLines={1}>
                                {result.region ? `${result.region}, ` : ''}{result.country}
                              </Text>
                            </View>
                          </Pressable>
                        ))}
                      </View>
                    )}
                    {cityQuery.length >= 2 && !isCitySearching && cityResults.length === 0 && (
                      <Text style={[s.noResultsText, { color: theme.textSecondary }]}>No cities found</Text>
                    )}
                  </>
                )}
              </>
            )}

            {/* Distance pills */}
            <View style={s.distanceRow}>
              {DISTANCE_OPTIONS.map(opt => {
                const active = draft.distanceKm === opt.km;
                return (
                  <Pressable
                    key={opt.km}
                    onPress={() => setDistance(opt.km)}
                    style={[
                      s.distChip,
                      active
                        ? { backgroundColor: '#8B5CF6', borderColor: '#8B5CF6' }
                        : { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.1)' },
                    ]}
                  >
                    <Text style={[s.distChipText, { color: active ? '#fff' : theme.textSecondary }]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* ── Event Status ── */}
            <Text style={[s.sectionTitle, { color: theme.text, marginTop: spacing.xl }]}>Event Status</Text>
            <View style={[s.toggleRow, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
              <View style={s.toggleLabel}>
                <Ionicons name="time-outline" size={18} color={theme.tint} />
                <Text style={[s.toggleText, { color: theme.text }]}>Upcoming only</Text>
              </View>
              <Switch
                value={draft.upcomingOnly}
                onValueChange={v => setDraft(prev => ({ ...prev, upcomingOnly: v }))}
                trackColor={{ false: 'rgba(255,255,255,0.1)', true: '#8B5CF680' }}
                thumbColor={draft.upcomingOnly ? '#8B5CF6' : '#888'}
                ios_backgroundColor="rgba(255,255,255,0.1)"
              />
            </View>
            <Text style={[s.helperText, { color: theme.textSecondary }]}>
              {draft.upcomingOnly ? 'Ended events are hidden' : 'Showing all events including ended'}
            </Text>
      </View>
    </KeyboardAwareBottomSheetModal>
  );
}

export function countActiveFilters(f: EventFilters): number {
  let count = 0;
  if (f.categories.length > 0) count++;
  if (f.language) count++;
  if (f.locationMode === 'city' && f.selectedCity) count++;
  if (!f.upcomingOnly) count++;
  return count;
}

const s = StyleSheet.create({
  handleRow: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 4,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  bodyContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: spacing.md,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '500',
  },
  langRow: {
    gap: spacing.sm,
    paddingBottom: 4,
  },
  langChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  langChipText: {
    fontSize: 13,
    fontWeight: '500',
  },

  // ── Location ──
  locationModeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  modePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  modePillText: {
    fontSize: 14,
    fontWeight: '500',
  },
  permissionHelper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.md,
  },
  permissionHelperText: {
    fontSize: 12,
    flex: 1,
  },
  upsellCard: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderWidth: 1,
    backgroundColor: 'rgba(139,92,246,0.08)',
    marginBottom: spacing.md,
  },
  upsellEmoji: {
    fontSize: 24,
  },
  upsellContent: {
    flex: 1,
  },
  upsellTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  upsellDesc: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  upsellCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: '#8B5CF6',
  },
  upsellCtaText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  selectedCityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.md,
  },
  selectedCityText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  citySearchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 42,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.sm,
  },
  citySearchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  cityResultsList: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  cityResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  cityResultTextWrap: {
    flex: 1,
  },
  cityResultName: {
    fontSize: 14,
    fontWeight: '500',
  },
  cityResultCountry: {
    fontSize: 12,
    marginTop: 1,
  },
  noResultsText: {
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },

  // ── Distance ──
  distanceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  distChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  distChipText: {
    fontSize: 13,
    fontWeight: '500',
  },

  // ── Shared ──
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  toggleLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  toggleText: {
    fontSize: 15,
    fontWeight: '500',
  },
  helperText: {
    fontSize: 12,
    marginTop: 6,
    marginLeft: 4,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  clearBtn: {
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
  },
  clearBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  applyBtn: {
    paddingVertical: 14,
    paddingHorizontal: spacing['2xl'],
    borderRadius: radius.pill,
    backgroundColor: '#8B5CF6',
  },
  applyBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
