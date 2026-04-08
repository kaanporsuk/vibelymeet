import React, { useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Themed';
import { VibelyButton } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type GeoResult = { formatted?: string; city?: string; country?: string; lat?: number; lng?: number };
type LocationPayload = { location: string; country: string; locationData: { lat: number; lng: number } | null };
type FeedbackTone = 'info' | 'error';
type FeedbackState = { tone: FeedbackTone; text: string } | null;

const MIN_SEARCH_CHARS = 2;

export default function LocationStep({ location, onLocationChange, onNext }: { location: string; onLocationChange: (payload: LocationPayload) => void; onNext: () => void; }) {
  const theme = Colors[useColorScheme()];
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<GeoResult[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [searching, setSearching] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  const continueHint = location
    ? 'You can continue now, or change this city first.'
    : showSearch
      ? 'Search for your city and tap a result to continue.'
      : 'Enable location or search for your city to continue.';

  const openManualSearch = (nextFeedback?: FeedbackState) => {
    setShowSearch(true);
    setResults([]);
    setFeedback(nextFeedback ?? null);
  };

  const applyLocation = (payload: LocationPayload) => {
    onLocationChange(payload);
    setShowSearch(false);
    setSearch('');
    setResults([]);
    setFeedback(null);
  };

  const applySearchResult = (item: GeoResult) => {
    if (item.lat == null || item.lng == null) {
      setFeedback({
        tone: 'error',
        text: "We couldn't confirm that city's coordinates. Try another result or include the country in your search.",
      });
      return;
    }

    applyLocation({
      location: item.formatted ?? `${item.city ?? ''}, ${item.country ?? ''}`,
      country: item.country ?? '',
      locationData: { lat: Number(item.lat), lng: Number(item.lng) },
    });
  };

  const autoDetect = async () => {
    setDetecting(true);
    setFeedback(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        openManualSearch({
          tone: 'error',
          text: perm.canAskAgain === false
            ? 'Location access is off. Search for your city instead, or enable it in Settings and try again.'
            : 'Location permission was denied. Search for your city instead, or try again.',
        });
        return;
      }
      const pos = await Location.getCurrentPositionAsync({});
      const { data, error } = await supabase.functions.invoke('geocode', {
        body: { lat: pos.coords.latitude, lng: pos.coords.longitude },
      });
      if (error) throw error;
      if (data?.error || !data?.city || !data?.country) {
        openManualSearch({
          tone: 'error',
          text: "We couldn't match your current location to a city. Search manually instead.",
        });
        return;
      }
      applyLocation({
        location: data.formatted ?? `${data.city}, ${data.country}`,
        country: data.country,
        locationData: {
          lat: Number(data.lat ?? pos.coords.latitude),
          lng: Number(data.lng ?? pos.coords.longitude),
        },
      });
    } catch {
      openManualSearch({
        tone: 'error',
        text: "We couldn't determine your city right now. Search for your city instead, or try again.",
      });
    } finally {
      setDetecting(false);
    }
  };

  const searchCity = async () => {
    const query = search.trim();
    if (query.length < MIN_SEARCH_CHARS) {
      setResults([]);
      setFeedback({
        tone: 'error',
        text: `Enter at least ${MIN_SEARCH_CHARS} characters to search.`,
      });
      return;
    }

    setSearching(true);
    setFeedback(null);
    try {
      const { data, error } = await supabase.functions.invoke('forward-geocode', {
        body: { query, context: 'onboarding' },
      });
      if (error) throw error;
      const list: GeoResult[] = Array.isArray(data?.results) ? data.results : (Array.isArray(data) ? data : []);
      setResults(list);
      if (list.length === 0) {
        setFeedback({
          tone: 'info',
          text: 'No cities matched that search. Try a nearby city or include the country.',
        });
      }
    } catch {
      setResults([]);
      setFeedback({
        tone: 'error',
        text: "We couldn't search right now. Check your connection and try again.",
      });
    } finally {
      setSearching(false);
    }
  };

  return (
    <View style={styles.root}>
      <Text style={[styles.h1, { color: theme.text }]}>Where are you based?</Text>
      <Text style={[styles.sub, { color: theme.textSecondary }]}>We use this to show events and people nearby.</Text>

      {location ? (
        <>
          <View style={[styles.selectedLocation, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
            <Ionicons name="location-outline" size={18} color={theme.tint} />
            <Text style={[styles.selectedLocationText, { color: theme.text }]}>{location}</Text>
            <Ionicons name="checkmark-circle" size={18} color={theme.success} />
          </View>
          <View style={styles.actionStack}>
            <VibelyButton
              label="Search manually"
              onPress={() =>
                openManualSearch({
                  tone: 'info',
                  text: 'Search for a different city and tap a result to replace this one.',
                })
              }
              variant="secondary"
            />
            <VibelyButton
              label={detecting ? 'Detecting...' : 'Use current location again'}
              onPress={autoDetect}
              variant="ghost"
              disabled={detecting || searching}
            />
          </View>
        </>
      ) : (
        !showSearch ? (
          <>
            <VibelyButton
              label={detecting ? 'Detecting...' : 'Enable location'}
              onPress={autoDetect}
              variant="gradient"
              disabled={detecting || searching}
            />
            <Pressable
              onPress={() =>
                openManualSearch({
                  tone: 'info',
                  text: 'Search for your city and tap a result to continue.',
                })
              }
            >
              <Text style={{ color: theme.textSecondary, textAlign: 'center' }}>Search for your city instead</Text>
            </Pressable>
          </>
        ) : null
      )}

      {feedback ? (
        <View style={{ gap: 8 }}>
          <View
            style={[
              styles.feedback,
              {
                borderColor: feedback.tone === 'error' ? 'rgba(239, 68, 68, 0.3)' : theme.border,
                backgroundColor: feedback.tone === 'error' ? theme.dangerSoft : 'rgba(255,255,255,0.03)',
              },
            ]}
          >
            <Ionicons
              name={feedback.tone === 'error' ? 'warning-outline' : 'information-circle-outline'}
              size={16}
              color={feedback.tone === 'error' ? theme.danger : theme.tint}
            />
            <Text style={[styles.feedbackText, { color: feedback.tone === 'error' ? theme.text : theme.textSecondary }]}>
              {feedback.text}
            </Text>
          </View>
          {feedback.tone === 'error' ? (
            <Pressable
              onPress={() => {
                if (showSearch && search.trim().length >= MIN_SEARCH_CHARS) void searchCity();
                else void autoDetect();
              }}
              disabled={detecting || searching}
              style={{ alignSelf: 'flex-start', opacity: detecting || searching ? 0.55 : 1 }}
            >
              <Text style={{ color: theme.tint, fontSize: 14, fontWeight: '600' }}>
                {showSearch && search.trim().length >= MIN_SEARCH_CHARS ? 'Retry search' : 'Retry location'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {showSearch ? (
        <>
          <View style={styles.searchRow}>
            <TextInput
              value={search}
              onChangeText={(value) => {
                setSearch(value);
                setResults([]);
                setFeedback(null);
              }}
              onSubmitEditing={() => {
                void searchCity();
              }}
              returnKeyType="search"
              placeholder="Search city"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { borderColor: theme.border, color: theme.text }]}
            />
            <VibelyButton
              label={searching ? 'Searching...' : 'Search'}
              onPress={() => {
                void searchCity();
              }}
              size="sm"
              disabled={detecting || searching}
            />
          </View>
          <Pressable onPress={autoDetect} disabled={detecting || searching}>
            <Text style={{ color: theme.textSecondary, textAlign: 'left', opacity: detecting || searching ? 0.6 : 1 }}>
              {detecting ? 'Trying your current location...' : 'Try current location again'}
            </Text>
          </Pressable>
          {results.length > 0 ? (
            <FlatList
              data={results}
              keyExtractor={(_, i) => String(i)}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => applySearchResult(item)}
                  style={[styles.result, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
                >
                  <Ionicons name="location-outline" size={16} color={theme.tint} />
                  <Text style={[styles.resultText, { color: theme.text }]}>
                    {item.formatted ?? `${item.city ?? ''}, ${item.country ?? ''}`}
                  </Text>
                </Pressable>
              )}
              style={styles.resultsList}
            />
          ) : null}
        </>
      ) : null}

      <Text style={[styles.hint, { color: theme.textSecondary }]}>{continueHint}</Text>
      <VibelyButton label="Continue" onPress={onNext} disabled={!location} variant="gradient" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  h1: { fontSize: 30, fontWeight: '700' },
  sub: { fontSize: 14 },
  selectedLocation: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  selectedLocationText: { flex: 1, fontSize: 14, fontWeight: '600' },
  actionStack: { gap: 8 },
  feedback: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  feedbackText: { flex: 1, fontSize: 12, lineHeight: 18 },
  searchRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, borderWidth: 1, borderRadius: 12, minHeight: 42, paddingHorizontal: 10 },
  resultsList: { maxHeight: 180 },
  result: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  resultText: { flex: 1 },
  hint: { textAlign: 'center', fontSize: 12, lineHeight: 18 },
});
