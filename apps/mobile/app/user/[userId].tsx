/**
 * Public profile — view another user's profile (same core info as web UserProfile).
 * Entry: chat header "View profile", or matches (future).
 */
import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Image, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { GlassSurface, Card, LoadingState, ErrorState } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { fetchPublicProfile } from '@/lib/publicProfileApi';
import { getImageUrl } from '@/lib/imageUrl';

const LOOKING_FOR_LABELS: Record<string, string> = {
  'long-term': 'Long-term partner',
  'relationship': 'Relationship',
  'something-casual': 'Something casual',
  'new-friends': 'New friends',
  'figuring-out': 'Figuring it out',
};

export default function PublicProfileScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { data: profile, isLoading, error, refetch } = useQuery({
    queryKey: ['public-profile', userId],
    queryFn: () => fetchPublicProfile(userId ?? ''),
    enabled: !!userId,
  });

  if (!userId) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <ErrorState title="Invalid profile" message="User not found." actionLabel="Go back" onActionPress={() => router.back()} />
      </View>
    );
  }

  if (isLoading && !profile) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <LoadingState title="Loading profile…" />
      </View>
    );
  }

  if (error || !profile) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <ErrorState title="Could not load profile" message="This profile may be unavailable." actionLabel="Go back" onActionPress={() => router.back()} />
      </View>
    );
  }

  const photoUrl = profile.avatar_url || profile.photos?.[0];
  const photoUris = (profile.photos ?? []).filter(Boolean).map((p) => getImageUrl(p, { width: 800, quality: 90 }));
  const [photoIndex, setPhotoIndex] = React.useState(0);
  const displayPhoto = photoUris.length > 0 ? photoUris[photoIndex % photoUris.length] : (photoUrl ? getImageUrl(photoUrl, { width: 800, quality: 90 }) : null);
  const lookingForLabel = profile.looking_for ? LOOKING_FOR_LABELS[profile.looking_for] ?? profile.looking_for : null;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <GlassSurface style={[styles.header, { paddingTop: insets.top + spacing.sm, paddingBottom: spacing.md, paddingHorizontal: spacing.lg }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]}>
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>
          Profile
        </Text>
      </GlassSurface>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing['2xl'] }]} showsVerticalScrollIndicator={false}>
        {/* Photo */}
        {displayPhoto ? (
          <View style={[styles.photoWrap, { width }]}>
            <Image source={{ uri: displayPhoto }} style={styles.photo} resizeMode="cover" />
            {photoUris.length > 1 && (
              <View style={styles.photoDots}>
                {photoUris.map((_, i) => (
                  <Pressable key={i} onPress={() => setPhotoIndex(i)} style={[styles.dot, i === photoIndex % photoUris.length && styles.dotActive, { backgroundColor: i === photoIndex % photoUris.length ? theme.tint : 'rgba(255,255,255,0.4)' }]} />
                ))}
              </View>
            )}
          </View>
        ) : (
          <View style={[styles.photoPlaceholder, { width, backgroundColor: theme.surfaceSubtle }]}>
            <Ionicons name="person" size={64} color={theme.textSecondary} />
          </View>
        )}

        <View style={styles.content}>
          <Text style={[styles.name, { color: theme.text }]}>
            {profile.name ?? 'Unknown'}, {profile.age ?? '—'}
          </Text>
          {profile.tagline ? (
            <Text style={[styles.tagline, { color: theme.tint }]}>"{profile.tagline}"</Text>
          ) : null}
          {profile.job ? (
            <View style={styles.row}>
              <Ionicons name="briefcase-outline" size={16} color={theme.textSecondary} />
              <Text style={[styles.meta, { color: theme.textSecondary }]}>{profile.job}</Text>
            </View>
          ) : null}
          {profile.location ? (
            <View style={styles.row}>
              <Ionicons name="location-outline" size={16} color={theme.textSecondary} />
              <Text style={[styles.meta, { color: theme.textSecondary }]}>{profile.location}</Text>
            </View>
          ) : null}

          {lookingForLabel ? (
            <Card style={styles.card}>
              <Text style={[styles.cardLabel, { color: theme.textSecondary }]}>Looking for</Text>
              <Text style={[styles.cardValue, { color: theme.text }]}>{lookingForLabel}</Text>
            </Card>
          ) : null}

          {profile.about_me ? (
            <Card style={styles.card}>
              <Text style={[styles.cardLabel, { color: theme.textSecondary }]}>About</Text>
              <Text style={[styles.body, { color: theme.text }]}>{profile.about_me}</Text>
            </Card>
          ) : null}

          {profile.vibeLabels.length > 0 ? (
            <Card style={styles.card}>
              <Text style={[styles.cardLabel, { color: theme.textSecondary }]}>Vibes</Text>
              <View style={styles.vibeChips}>
                {profile.vibeLabels.map((label, i) => (
                  <View key={i} style={[styles.vibeChip, { backgroundColor: theme.accentSoft }]}>
                    <Text style={[styles.vibeChipText, { color: theme.text }]}>{label}</Text>
                  </View>
                ))}
              </View>
            </Card>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  backBtn: { padding: spacing.xs },
  headerTitle: { fontSize: 18, fontWeight: '600', flex: 1 },
  scroll: { paddingTop: 0 },
  photoWrap: { aspectRatio: 3 / 4, maxHeight: 400, backgroundColor: '#111' },
  photo: { width: '100%', height: '100%' },
  photoDots: { position: 'absolute', bottom: 12, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotActive: {},
  photoPlaceholder: { aspectRatio: 3 / 4, maxHeight: 280, justifyContent: 'center', alignItems: 'center' },
  content: { padding: spacing.lg },
  name: { fontSize: 24, fontWeight: '700', marginBottom: 4 },
  tagline: { fontSize: 15, fontStyle: 'italic', marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  meta: { fontSize: 14 },
  card: { marginTop: spacing.md, padding: spacing.lg },
  cardLabel: { fontSize: 12, fontWeight: '600', marginBottom: 4 },
  cardValue: { fontSize: 15 },
  body: { fontSize: 15, lineHeight: 22 },
  vibeChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  vibeChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999 },
  vibeChipText: { fontSize: 14 },
});
