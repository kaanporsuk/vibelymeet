import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  Modal,
  Dimensions,
  Switch,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { spacing, radius } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { EVENT_LANGUAGES } from '@/lib/eventLanguages';
import * as Location from 'expo-location';

const SCREEN_HEIGHT = Dimensions.get('window').height;

const CATEGORIES = [
  'Music', 'Tech', 'Art', 'Gaming', 'Food',
  'Wellness', 'Outdoor', 'Sports', 'Social', 'Dating',
] as const;

const DISTANCE_OPTIONS = [
  { km: 10, label: '10 km' },
  { km: 25, label: '25 km' },
  { km: 50, label: '50 km' },
  { km: 100, label: '100 km' },
  { km: 0, label: 'Anywhere' },
] as const;

export interface EventFilters {
  categories: string[];
  language: string | null;
  locationEnabled: boolean;
  distanceKm: number;
  upcomingOnly: boolean;
}

export const DEFAULT_FILTERS: EventFilters = {
  categories: [],
  language: null,
  locationEnabled: false,
  distanceKm: 50,
  upcomingOnly: true,
};

interface EventFilterSheetProps {
  visible: boolean;
  onClose: () => void;
  filters: EventFilters;
  onApply: (filters: EventFilters) => void;
}

export default function EventFilterSheet({ visible, onClose, filters, onApply }: EventFilterSheetProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];

  const [draft, setDraft] = useState<EventFilters>(filters);
  const [locationStatus, setLocationStatus] = useState<'unknown' | 'granted' | 'denied'>('unknown');

  useEffect(() => {
    if (visible) setDraft(filters);
  }, [visible]);

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        setLocationStatus(status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'unknown');
      } catch (error) {
        console.warn('[EventFilterSheet] location permission read failed:', error);
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

  const toggleLocation = async (enabled: boolean) => {
    if (enabled && locationStatus !== 'granted') {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        setLocationStatus(status === 'granted' ? 'granted' : 'denied');
        if (status !== 'granted') return;
      } catch (error) {
        console.warn('[EventFilterSheet] location permission request failed:', error);
        setLocationStatus('denied');
        return;
      }
    }
    setDraft(prev => ({ ...prev, locationEnabled: enabled }));
  };

  const setDistance = (km: number) => {
    setDraft(prev => ({ ...prev, distanceKm: km }));
  };

  const clearAll = () => setDraft(DEFAULT_FILTERS);

  const activeCount = countActiveFilters(draft);

  const handleApply = () => {
    onApply(draft);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.overlay}>
        <Pressable style={s.backdrop} onPress={onClose} />
        <View style={[s.sheet, { backgroundColor: theme.background, borderColor: theme.border }]}>
          {/* Handle */}
          <View style={s.handleRow}>
            <View style={[s.handle, { backgroundColor: theme.border }]} />
          </View>

          {/* Header */}
          <View style={s.header}>
            <Text style={[s.headerTitle, { color: theme.text }]}>Filters</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={24} color={theme.textSecondary} />
            </Pressable>
          </View>

          <ScrollView
            style={s.body}
            contentContainerStyle={s.bodyContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
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

            {/* ── Location / Distance ── */}
            <Text style={[s.sectionTitle, { color: theme.text, marginTop: spacing.xl }]}>Location</Text>
            <View style={[s.toggleRow, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
              <View style={s.toggleLabel}>
                <Ionicons name="navigate-outline" size={18} color={theme.tint} />
                <Text style={[s.toggleText, { color: theme.text }]}>Near me</Text>
              </View>
              <Switch
                value={draft.locationEnabled}
                onValueChange={toggleLocation}
                trackColor={{ false: 'rgba(255,255,255,0.1)', true: '#8B5CF680' }}
                thumbColor={draft.locationEnabled ? '#8B5CF6' : '#888'}
                ios_backgroundColor="rgba(255,255,255,0.1)"
              />
            </View>
            {locationStatus === 'denied' && (
              <Text style={[s.helperText, { color: theme.accent }]}>
                Location permission denied. Enable it in Settings.
              </Text>
            )}
            {draft.locationEnabled && (
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
            )}

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
          </ScrollView>

          {/* Footer */}
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
        </View>
      </View>
    </Modal>
  );
}

export function countActiveFilters(f: EventFilters): number {
  let count = 0;
  if (f.categories.length > 0) count++;
  if (f.language) count++;
  if (f.locationEnabled) count++;
  if (!f.upcomingOnly) count++;
  return count;
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    height: SCREEN_HEIGHT * 0.7,
    borderTopLeftRadius: radius['2xl'],
    borderTopRightRadius: radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    overflow: 'hidden',
  },
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
  body: {
    flex: 1,
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
  distanceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
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
