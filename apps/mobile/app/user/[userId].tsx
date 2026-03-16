/**
 * Public profile — view another user's profile; actions: Message, Report, Block, Unmatch.
 */
import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Image, useWindowDimensions, Alert } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { GlassSurface, Card, LoadingState, ErrorState, VibelyButton } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { fetchPublicProfile } from '@/lib/publicProfileApi';
import { getImageUrl } from '@/lib/imageUrl';
import { useAuth } from '@/context/AuthContext';
import { useMatches } from '@/lib/chatApi';
import { useUnmatch } from '@/lib/useUnmatch';
import { useBlockUser } from '@/lib/useBlockUser';
import { ReportFlowModal } from '@/components/match/ReportFlowModal';

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
  const { user } = useAuth();
  const { data: profile, isLoading, error, refetch } = useQuery({
    queryKey: ['public-profile', userId],
    queryFn: () => fetchPublicProfile(userId ?? ''),
    enabled: !!userId,
  });
  const { data: matches = [] } = useMatches(user?.id);
  // MatchListItem.id = other participant's profile id, matchId = match table primary key (chatApi)
  const matchRow = userId && user?.id ? matches.find((m) => m.id === userId) : null;
  const { mutateAsync: unmatch } = useUnmatch();
  const { blockUser, isUserBlocked } = useBlockUser(user?.id);
  const [photoIndex, setPhotoIndex] = React.useState(0);
  const [showReport, setShowReport] = useState(false);

  const handleUnmatch = useCallback(() => {
    if (!matchRow) return;
    Alert.alert('Unmatch?', `Remove ${profile?.name ?? 'this user'} from your matches? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unmatch',
        style: 'destructive',
        onPress: async () => {
          await unmatch({ matchId: matchRow.matchId });
          router.back();
        },
      },
    ]);
  }, [matchRow, profile?.name, unmatch]);

  const handleBlock = useCallback(() => {
    if (!userId || !profile?.name) return;
    Alert.alert('Block?', `Block ${profile.name}? They won't be able to contact you or see your profile.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Block',
        style: 'destructive',
        onPress: async () => {
          await blockUser({ blockedId: userId, matchId: matchRow?.matchId });
          router.back();
        },
      },
    ]);
  }, [userId, profile?.name, matchRow?.matchId, blockUser]);

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

          {user?.id && userId && !isUserBlocked(userId) && (
            <View style={[styles.actionsCard, { borderColor: theme.border }]}>
              {matchRow && (
                <VibelyButton
                  label="Message"
                  onPress={() => (router as { push: (p: string) => void }).push(`/chat/${userId}`)}
                  variant="primary"
                  style={styles.actionBtn}
                />
              )}
              <Pressable onPress={() => setShowReport(true)} style={[styles.actionRow, { borderTopColor: theme.border }]}>
                <Ionicons name="flag-outline" size={20} color={theme.textSecondary} />
                <Text style={[styles.actionLabel, { color: theme.text }]}>Report</Text>
              </Pressable>
              <Pressable onPress={handleBlock} style={[styles.actionRow, { borderTopColor: theme.border }]}>
                <Ionicons name="ban-outline" size={20} color={theme.danger} />
                <Text style={[styles.actionLabel, { color: theme.danger }]}>Block</Text>
              </Pressable>
              {matchRow && (
                <Pressable onPress={handleUnmatch} style={[styles.actionRow, { borderTopColor: theme.border }]}>
                  <Ionicons name="person-remove-outline" size={20} color={theme.danger} />
                  <Text style={[styles.actionLabel, { color: theme.danger }]}>Unmatch</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
      </ScrollView>

      {user?.id && showReport && (
        <ReportFlowModal
          visible={showReport}
          onClose={() => setShowReport(false)}
          onSuccess={() => setShowReport(false)}
          reportedId={userId!}
          reportedName={profile?.name ?? 'User'}
          reporterId={user.id}
        />
      )}
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
  actionsCard: { marginTop: spacing.xl, padding: spacing.lg, borderRadius: 12, borderWidth: 1 },
  actionBtn: { marginBottom: spacing.md },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  actionLabel: { fontSize: 15, fontWeight: '500' },
});
