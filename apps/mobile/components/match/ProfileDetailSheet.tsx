/**
 * Full profile bottom sheet for a match — photos, name, age, location, bio, vibe tags, prompts, job, height, vibe video.
 * Fetches full profile when opened. Reference: src/components/ProfileDetailDrawer.tsx
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  Image,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius, typography } from '@/constants/theme';
import { avatarUrl } from '@/lib/imageUrl';
import { supabase } from '@/lib/supabase';
import { VibelyText } from '@/components/ui';

export type MatchForProfile = {
  id: string;
  name: string;
  age: number;
  image: string;
};

type ProfileDetail = {
  name: string;
  age: number;
  location: string | null;
  job: string | null;
  bio: string | null;
  heightCm: number | null;
  photos: string[];
  vibes: string[];
  prompts: { question: string; answer: string }[];
  bunnyVideoUid: string | null;
  bunnyVideoStatus: string | null;
};

type ProfileDetailSheetProps = {
  visible: boolean;
  onClose: () => void;
  match: MatchForProfile | null;
};

const PHOTO_WIDTH = Dimensions.get('window').width - spacing.lg * 2;

export function ProfileDetailSheet({ visible, onClose, match }: ProfileDetailSheetProps) {
  const theme = Colors[useColorScheme()];
  const [profile, setProfile] = useState<ProfileDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);

  useEffect(() => {
    if (!visible || !match?.id) {
      setProfile(null);
      return;
    }
    setLoading(true);
    (async () => {
      try {
        const [profileRes, vibesRes] = await Promise.all([
          supabase
            .from('profiles')
            .select('name, age, location, job, about_me, height_cm, photos, avatar_url, bunny_video_uid, bunny_video_status, prompts')
            .eq('id', match.id)
            .maybeSingle(),
          supabase
            .from('profile_vibes')
            .select('vibe_tags(label)')
            .eq('profile_id', match.id),
        ]);

        const row = profileRes.data as {
          name?: string;
          age?: number;
          location?: string | null;
          job?: string | null;
          about_me?: string | null;
          height_cm?: number | null;
          photos?: string[] | null;
          avatar_url?: string | null;
          bunny_video_uid?: string | null;
          bunny_video_status?: string | null;
          prompts?: { question?: string; answer?: string }[] | null;
        } | null;

        if (!row) {
          setProfile(null);
          return;
        }

        const photos: string[] = (row.photos && row.photos.length > 0)
          ? row.photos
          : (row.avatar_url ? [row.avatar_url] : []);

        type VibeRow = { vibe_tags: { label?: string } | { label?: string }[] };
        const vibes: string[] = ((vibesRes.data as VibeRow[]) || [])
          .flatMap((v) => {
            const vt = v.vibe_tags;
            if (!vt) return [];
            return Array.isArray(vt) ? vt.map((t) => t?.label).filter(Boolean) : [(vt as { label?: string }).label].filter(Boolean);
          })
          .filter(Boolean) as string[];

        const prompts = (row.prompts && Array.isArray(row.prompts))
          ? (row.prompts as { question?: string; answer?: string }[]).map((p) => ({
              question: p.question ?? '',
              answer: p.answer ?? '',
            }))
          : [];

        setProfile({
          name: row.name ?? match.name,
          age: row.age ?? match.age,
          location: row.location ?? null,
          job: row.job ?? null,
          bio: row.about_me ?? null,
          heightCm: row.height_cm ?? null,
          photos,
          vibes,
          prompts,
          bunnyVideoUid: row.bunny_video_uid ?? null,
          bunnyVideoStatus: row.bunny_video_status ?? null,
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [visible, match?.id, match?.name, match?.age]);

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="slide">
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: theme.surface }]} onPress={(e) => e.stopPropagation()}>
          <View style={[styles.handle, { backgroundColor: theme.muted }]} />
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {loading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator size="large" color={theme.tint} />
              </View>
            ) : profile ? (
              <>
                {/* Photos */}
                {profile.photos.length > 0 ? (
                  <ScrollView
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    onMomentumScrollEnd={(e) => {
                      const i = Math.round(e.nativeEvent.contentOffset.x / PHOTO_WIDTH);
                      setPhotoIndex(i);
                    }}
                    style={styles.photoScroll}
                  >
                    {profile.photos.map((path, i) => (
                      <Image key={i} source={{ uri: avatarUrl(path) }} style={[styles.photo, { width: PHOTO_WIDTH }]} />
                    ))}
                  </ScrollView>
                ) : (
                  <View style={[styles.photoPlaceholder, { backgroundColor: theme.muted }]}>
                    <Ionicons name="person" size={64} color={theme.mutedForeground} />
                  </View>
                )}
                {profile.photos.length > 1 && (
                  <View style={styles.dots}>
                    {profile.photos.map((_, i) => (
                      <View key={i} style={[styles.dot, i === photoIndex && { backgroundColor: theme.tint, opacity: 1 }]} />
                    ))}
                  </View>
                )}

                <View style={styles.body}>
                  <VibelyText variant="titleLG" style={[styles.name, { color: theme.text }]}>
                    {profile.name}{profile.age > 0 ? `, ${profile.age}` : ''}
                  </VibelyText>
                  {profile.location ? (
                    <View style={styles.metaRow}>
                      <Ionicons name="location-outline" size={16} color={theme.mutedForeground} />
                      <VibelyText variant="body" style={{ color: theme.mutedForeground }}>{profile.location}</VibelyText>
                    </View>
                  ) : null}
                  {profile.job ? (
                    <View style={styles.metaRow}>
                      <Ionicons name="briefcase-outline" size={16} color={theme.mutedForeground} />
                      <VibelyText variant="body" style={{ color: theme.mutedForeground }}>{profile.job}</VibelyText>
                    </View>
                  ) : null}
                  {profile.heightCm != null && profile.heightCm > 0 ? (
                    <View style={styles.metaRow}>
                      <Ionicons name="resize-outline" size={16} color={theme.mutedForeground} />
                      <VibelyText variant="body" style={{ color: theme.mutedForeground }}>{profile.heightCm} cm</VibelyText>
                    </View>
                  ) : null}

                  {profile.bio ? (
                    <View style={styles.section}>
                      <VibelyText variant="overline" style={{ color: theme.mutedForeground }}>About</VibelyText>
                      <VibelyText variant="body" style={[styles.bio, { color: theme.text }]}>{profile.bio}</VibelyText>
                    </View>
                  ) : null}

                  {profile.vibes.length > 0 ? (
                    <View style={styles.section}>
                      <View style={styles.sectionTitleRow}>
                        <Ionicons name="sparkles" size={16} color={theme.tint} />
                        <VibelyText variant="overline" style={{ color: theme.mutedForeground }}>Interests</VibelyText>
                      </View>
                      <View style={styles.tagsRow}>
                        {profile.vibes.map((v) => (
                          <View key={v} style={[styles.tag, { backgroundColor: theme.tintSoft }]}>
                            <VibelyText variant="body" style={{ color: theme.tint }}>{v}</VibelyText>
                          </View>
                        ))}
                      </View>
                    </View>
                  ) : null}

                  {profile.bunnyVideoUid && profile.bunnyVideoStatus === 'ready' ? (
                    <View style={[styles.videoChip, { backgroundColor: theme.tintSoft }]}>
                      <Ionicons name="videocam" size={18} color={theme.tint} />
                      <VibelyText variant="body" style={{ color: theme.tint }}>Has a Vibe Video</VibelyText>
                    </View>
                  ) : null}

                  {profile.prompts.filter((p) => p.answer).length > 0 ? (
                    <View style={styles.section}>
                      <VibelyText variant="overline" style={{ color: theme.mutedForeground }}>Prompts</VibelyText>
                      {profile.prompts.filter((p) => p.answer).map((p, i) => (
                        <View key={i} style={[styles.promptCard, { backgroundColor: theme.surfaceSubtle }]}>
                          <VibelyText variant="caption" style={{ color: theme.tint }}>{p.question}</VibelyText>
                          <VibelyText variant="body" style={{ color: theme.text, marginTop: 4 }}>{p.answer}</VibelyText>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              </>
            ) : (
              <VibelyText variant="body" style={{ color: theme.mutedForeground, textAlign: 'center', padding: spacing.xl }}>
                Could not load profile.
              </VibelyText>
            )}
          </ScrollView>
          <Pressable onPress={onClose} style={[styles.closeBtn, { backgroundColor: theme.muted }]}>
            <VibelyText variant="body" style={{ color: theme.text }}>Close</VibelyText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius['2xl'],
    borderTopRightRadius: radius['2xl'],
    maxHeight: '90%',
    paddingBottom: spacing['2xl'],
  },
  handle: { width: 100, height: 8, borderRadius: 999, alignSelf: 'center', marginTop: 16, marginBottom: 12 },
  scroll: { maxHeight: 480 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  loadingWrap: { paddingVertical: 48, alignItems: 'center' },
  photoScroll: { marginHorizontal: -spacing.lg },
  photo: { height: 360, marginHorizontal: spacing.lg, borderRadius: radius.lg },
  photoPlaceholder: { height: 200, marginHorizontal: spacing.lg, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
  body: { marginTop: spacing.lg },
  name: { marginBottom: spacing.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  section: { marginTop: spacing.lg },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.xs },
  bio: { marginTop: 4, lineHeight: 22 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: spacing.xs },
  tag: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill },
  videoChip: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.lg, paddingVertical: 10, paddingHorizontal: 14, borderRadius: radius.lg },
  promptCard: { padding: spacing.md, borderRadius: radius.lg, marginTop: spacing.sm },
  closeBtn: { marginHorizontal: spacing.lg, marginTop: spacing.md, paddingVertical: 14, borderRadius: radius.lg, alignItems: 'center' },
});
