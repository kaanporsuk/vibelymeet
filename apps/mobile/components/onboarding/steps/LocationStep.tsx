import React, { useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import { Text } from '@/components/Themed';
import { VibelyButton } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type GeoResult = { formatted?: string; city?: string; country?: string; lat?: number; lng?: number };

export default function LocationStep({ location, onLocationChange, onNext }: { location: string; onLocationChange: (payload: { location: string; city: string; country: string; locationData: { lat: number; lng: number } | null }) => void; onNext: () => void; }) {
  const theme = Colors[useColorScheme()];
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<GeoResult[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [loading, setLoading] = useState(false);

  const autoDetect = async () => {
    setLoading(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setShowSearch(true);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({});
      const { data } = await supabase.functions.invoke('geocode', { body: { lat: pos.coords.latitude, lng: pos.coords.longitude } });
      if (data) {
        onLocationChange({
          location: data.formatted ?? `${data.city ?? ''}, ${data.country ?? ''}`,
          city: data.city ?? '',
          country: data.country ?? '',
          locationData: { lat: Number(data.lat ?? pos.coords.latitude), lng: Number(data.lng ?? pos.coords.longitude) },
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const searchCity = async () => {
    if (!search.trim()) return;
    setLoading(true);
    try {
      const { data } = await supabase.functions.invoke('forward-geocode', {
        body: { query: search.trim(), context: 'onboarding' },
      });
      const list: GeoResult[] = Array.isArray(data?.results) ? data.results : (Array.isArray(data) ? data : []);
      setResults(list);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      <Text style={[styles.h1, { color: theme.text }]}>Where are you based?</Text>
      <Text style={[styles.sub, { color: theme.textSecondary }]}>We use this to show events and people nearby.</Text>
      <VibelyButton label={loading ? 'Detecting...' : 'Enable location'} onPress={autoDetect} variant="gradient" disabled={loading} />
      <Pressable onPress={() => setShowSearch(true)}><Text style={{ color: theme.textSecondary, textAlign: 'center' }}>Search for your city instead</Text></Pressable>
      {showSearch ? (
        <>
          <View style={styles.searchRow}>
            <TextInput value={search} onChangeText={setSearch} placeholder="Search city" placeholderTextColor={theme.textSecondary} style={[styles.input, { borderColor: theme.border, color: theme.text }]} />
            <VibelyButton label="Search" onPress={searchCity} size="sm" disabled={loading} />
          </View>
          <FlatList
            data={results}
            keyExtractor={(_, i) => String(i)}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => onLocationChange({
                  location: item.formatted ?? `${item.city ?? ''}, ${item.country ?? ''}`,
                  city: item.city ?? '',
                  country: item.country ?? '',
                  locationData: item.lat != null && item.lng != null ? { lat: Number(item.lat), lng: Number(item.lng) } : null,
                })}
                style={[styles.result, { borderColor: theme.border }]}
              >
                <Text style={{ color: theme.text }}>{item.formatted ?? `${item.city ?? ''}, ${item.country ?? ''}`}</Text>
              </Pressable>
            )}
            style={{ maxHeight: 180 }}
          />
        </>
      ) : null}
      {location ? <Text style={{ color: theme.textSecondary }}>📍 {location}</Text> : null}
      <VibelyButton label="Continue" onPress={onNext} disabled={!location} variant="gradient" />
    </View>
  );
}

const styles = StyleSheet.create({ root: { gap: 10 }, h1: { fontSize: 30, fontWeight: '700' }, sub: { fontSize: 14 }, searchRow: { flexDirection: 'row', gap: 8, alignItems: 'center' }, input: { flex: 1, borderWidth: 1, borderRadius: 12, minHeight: 42, paddingHorizontal: 10 }, result: { borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 6 } });
