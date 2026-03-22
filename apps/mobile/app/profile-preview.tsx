import React, { useMemo, useState, useCallback } from 'react';
import {
  ScrollView,
  Image,
  StyleSheet,
  Pressable,
  View as RNView,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import Colors from '@/constants/Colors';
import { spacing, radius, fonts, layout } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { Text, View } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import { LoadingState, ErrorState } from '@/components/ui';
import { fetchMyProfile, formatBirthdayUsWithZodiac, type ProfileRow } from '@/lib/profileApi';
import { getImageUrl, avatarUrl } from '@/lib/imageUrl';
import { getVibeVideoThumbnailUrl } from '@/lib/vibeVideoPlaybackUrl';
import { PROMPT_EMOJIS } from '@/components/profile/PROMPT_CONSTANTS';
import { getLookingForDisplay } from '@/components/profile/RelationshipIntentSelector';
import { LifestyleDetailsSection } from '@/components/profile/LifestyleDetailsSection';
import { getLifestyleDisplayChips } from '@/lib/lifestyleChips';

const HERO_HEIGHT = 250;
const AVATAR_SIZE = 160;
const AVATAR_RADIUS = 20;

export default function ProfilePreviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: winWidth } = useWindowDimensions();
  const { user } = useAuth();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];

  const { data: profile, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['my-profile'],
    queryFn: fetchMyProfile,
    enabled: !!user?.id,
  });

  useFocusEffect(
    useCallback(() => {
      if (user?.id) {
        void refetch().catch((e) => {
          if (__DEV__) console.warn('[profile-preview] refetch failed:', e);
        });
      }
    }, [user?.id, refetch]),
  );

  if (isLoading && !profile) {
    return (
      <View style={[s.centered, { backgroundColor: theme.background }]}>
        <LoadingState title="Loading preview…" message="Just a sec…" />
      </View>
    );
  }

  if (isError && !profile) {
    return (
      <View style={[s.centered, { backgroundColor: theme.background, flex: 1 }]}>
        <ErrorState
          message={error instanceof Error ? error.message : "Couldn't load profile."}
          onActionPress={() => {
            void refetch().catch((e) => {
              if (__DEV__) console.warn('[profile-preview] refetch failed:', e);
            });
          }}
        />
      </View>
    );
  }

  if (!isLoading && user?.id && !profile) {
    return (
      <View style={[s.centered, { backgroundColor: theme.background, flex: 1 }]}>
        <ErrorState
          message="We couldn't load your profile. Check your connection and try again."
          onActionPress={() => {
            void refetch().catch((e) => {
              if (__DEV__) console.warn('[profile-preview] refetch failed:', e);
            });
          }}
        />
      </View>
    );
  }

  const mainPhoto = profile?.photos?.[0] ?? profile?.avatar_url ?? null;
  const displayName = profile?.name ?? 'Your name';
  const age = profile?.age;
  const tagline = profile?.tagline?.trim();
  const location = profile?.location?.trim();
  const hasVibeVideo = !!(profile?.bunny_video_uid && profile?.bunny_video_status === 'ready');
  const thumbnailUrl = getVibeVideoThumbnailUrl(profile?.bunny_video_uid);
  const caption = profile?.vibe_caption?.trim() ?? '';
  const aboutMe = profile?.about_me?.trim();
  const filledPrompts = (profile?.prompts ?? []).filter(p => p.question?.trim() && p.answer?.trim());
  const photos = (profile?.photos ?? []).filter(Boolean);
  const vibes = profile?.vibes ?? [];
  const lookingForDisplay = getLookingForDisplay(profile?.looking_for);
  const lifestyle = profile?.lifestyle ?? {};
  const lifestyleChips = getLifestyleDisplayChips(lifestyle);

  const emailVerified = profile?.email_verified;
  const phoneVerified = profile?.phone_verified;
  const photoVerified = profile?.photo_verified;

  const photoGridGap = spacing.sm;
  const gridPadding = layout.containerPadding * 2;
  const gridWidth = winWidth - gridPadding;
  const photoCellSize = Math.floor((gridWidth - photoGridGap * 2) / 3);

  return (
    <RNView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 100 + insets.bottom }}
        bounces
      >
        {/* ═══ Hero gradient ═══ */}
        <LinearGradient
          colors={['#8B5CF6', '#E84393']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={s.hero}
        />

        {/* ═══ Header bar (over hero) ═══ */}
        <RNView style={[s.headerBar, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={() => router.back()} style={s.headerBtn} accessibilityLabel="Go back">
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </Pressable>
          <Text style={s.headerTitle}>Profile Preview</Text>
          <Pressable onPress={() => router.back()} style={s.headerBtn}>
            <Text style={s.headerEditText}>Edit</Text>
          </Pressable>
        </RNView>

        {/* ═══ Avatar ═══ */}
        <RNView style={s.avatarWrap}>
          {mainPhoto ? (
            <Image
              source={{ uri: avatarUrl(mainPhoto) }}
              style={s.avatar}
              resizeMode="cover"
            />
          ) : (
            <RNView style={[s.avatar, s.avatarPlaceholder, { backgroundColor: theme.surfaceSubtle }]}>
              <Ionicons name="person" size={64} color={theme.mutedForeground} />
            </RNView>
          )}
        </RNView>

        {/* ═══ Identity ═══ */}
        <RNView style={s.identitySection}>
          <Text style={[s.nameText, { color: theme.text }]}>
            {displayName}{age != null ? `, ${age}` : ''}
          </Text>
          {tagline ? (
            <Text style={s.taglineText}>"{tagline}"</Text>
          ) : null}
          {location ? (
            <RNView style={s.locationRow}>
              <Ionicons name="location-outline" size={14} color={theme.textSecondary} />
              <Text style={[s.locationText, { color: theme.textSecondary }]}>{location}</Text>
            </RNView>
          ) : null}

          {/* Verification badges */}
          {(emailVerified || phoneVerified || photoVerified) && (
            <RNView style={s.badgeRow}>
              {emailVerified && (
                <RNView style={s.verifiedPill}>
                  <Ionicons name="mail" size={12} color="#0D9488" />
                  <Text style={s.verifiedPillText}>Email</Text>
                </RNView>
              )}
              {photoVerified && (
                <RNView style={s.verifiedPill}>
                  <Ionicons name="camera" size={12} color="#0D9488" />
                  <Text style={s.verifiedPillText}>Photo</Text>
                </RNView>
              )}
              {phoneVerified && (
                <RNView style={s.verifiedPill}>
                  <Ionicons name="call" size={12} color="#0D9488" />
                  <Text style={s.verifiedPillText}>Phone</Text>
                </RNView>
              )}
            </RNView>
          )}
        </RNView>

        <RNView style={s.main}>

          {/* ═══ Vibe Video ═══ */}
          {hasVibeVideo && (
            <RNView style={s.section}>
              <RNView style={[s.videoCard, { borderColor: theme.glassBorder }]}>
                {thumbnailUrl ? (
                  <Image source={{ uri: thumbnailUrl }} style={s.videoThumbnail} resizeMode="cover" />
                ) : (
                  <RNView style={[s.videoThumbnail, { backgroundColor: theme.surface }]} />
                )}
                <LinearGradient
                  pointerEvents="none"
                  colors={['transparent', 'rgba(0,0,0,0.72)']}
                  locations={[0.3, 1]}
                  style={StyleSheet.absoluteFill}
                />
                <RNView style={s.videoPlayOverlay} pointerEvents="box-none">
                  <RNView style={s.videoPlayBtn}>
                    <Ionicons name="play" size={28} color="#fff" />
                  </RNView>
                </RNView>
                {caption ? (
                  <RNView style={s.videoCaptionStrip} pointerEvents="none">
                    <Text style={s.videoCaptionLabel}>VIBING ON</Text>
                    <Text style={s.videoCaptionText} numberOfLines={2}>{caption}</Text>
                  </RNView>
                ) : null}
              </RNView>
            </RNView>
          )}

          {/* ═══ About Me ═══ */}
          {aboutMe ? (
            <RNView style={s.section}>
              <Text style={[s.sectionTitle, { color: theme.text }]}>About Me</Text>
              <Text style={[s.bodyText, { color: theme.textSecondary }]}>{aboutMe}</Text>
            </RNView>
          ) : null}

          {/* ═══ Conversation Starters ═══ */}
          {filledPrompts.length > 0 && (
            <RNView style={s.section}>
              <Text style={[s.sectionTitle, { color: theme.text }]}>Conversation Starters</Text>
              <RNView style={{ gap: spacing.md }}>
                {filledPrompts.map((p, i) => {
                  const emoji = PROMPT_EMOJIS[p.question] ?? '💭';
                  return (
                    <RNView
                      key={`${i}-${p.question}`}
                      style={[s.promptCard, { backgroundColor: theme.surfaceSubtle, borderColor: theme.glassBorder }]}
                    >
                      <RNView style={s.promptGradientAccent}>
                        <LinearGradient
                          colors={['#8B5CF6', '#E84393']}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 0, y: 1 }}
                          style={StyleSheet.absoluteFill}
                        />
                      </RNView>
                      <RNView style={s.promptInner}>
                        <RNView style={s.promptTopRow}>
                          <Text style={{ fontSize: 18, marginTop: 2 }}>{emoji}</Text>
                          <Text style={[s.promptQuestion, { color: theme.textSecondary }]} numberOfLines={3}>
                            {p.question}
                          </Text>
                        </RNView>
                        <Text style={[s.promptAnswer, { color: theme.text }]}>{p.answer}</Text>
                        <RNView style={s.promptFooter}>
                          <Ionicons name="chatbubble-ellipses-outline" size={14} color={theme.tint} />
                          <Text style={[s.promptFooterLabel, { color: theme.textSecondary }]}>
                            Conversation starter
                          </Text>
                        </RNView>
                      </RNView>
                    </RNView>
                  );
                })}
              </RNView>
            </RNView>
          )}

          {/* ═══ Looking For ═══ */}
          {lookingForDisplay && (
            <RNView style={s.section}>
              <Text style={[s.sectionTitle, { color: theme.text }]}>Looking For</Text>
              <RNView style={[s.intentChip, { backgroundColor: theme.tintSoft, borderColor: theme.border }]}>
                <Text style={{ fontSize: 18 }}>{lookingForDisplay.emoji}</Text>
                <Text style={[s.intentChipLabel, { color: theme.text }]}>{lookingForDisplay.label}</Text>
              </RNView>
            </RNView>
          )}

          {/* ═══ Photos ═══ */}
          {photos.length > 0 && (
            <RNView style={s.section}>
              <Text style={[s.sectionTitle, { color: theme.text }]}>Photos</Text>
              <RNView style={[s.photoGrid, { gap: photoGridGap }]}>
                {photos.map((url, i) => (
                  <RNView
                    key={`photo-${i}`}
                    style={[s.photoCell, { width: photoCellSize, height: photoCellSize, backgroundColor: theme.surfaceSubtle }]}
                  >
                    <Image source={{ uri: avatarUrl(url) }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                  </RNView>
                ))}
              </RNView>
            </RNView>
          )}

          {/* ═══ The Basics ═══ */}
          {(profile?.birth_date || profile?.job || profile?.height_cm || profile?.location) && (
            <RNView style={s.section}>
              <Text style={[s.sectionTitle, { color: theme.text }]}>The Basics</Text>
              <RNView style={s.basicsGrid}>
                {([
                  { icon: 'calendar-outline' as const, label: 'Birthday', value: formatBirthdayUsWithZodiac(profile?.birth_date) },
                  { icon: 'briefcase-outline' as const, label: 'Work', value: profile?.job?.trim() },
                  { icon: 'resize-outline' as const, label: 'Height', value: profile?.height_cm ? `${profile.height_cm} cm` : undefined },
                  { icon: 'location-outline' as const, label: 'Location', value: profile?.location?.trim() },
                ] as const)
                  .filter(item => item.value && item.value !== 'Not set')
                  .map((item) => (
                    <RNView key={item.label} style={[s.basicCard, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
                      <RNView style={s.basicCardTopRow}>
                        <Ionicons name={item.icon} size={14} color={theme.textSecondary} />
                        <Text style={[s.basicCardLabel, { color: theme.textSecondary }]}>{item.label}</Text>
                      </RNView>
                      <Text style={[s.basicCardValue, { color: theme.text }]} numberOfLines={2}>{item.value}</Text>
                    </RNView>
                  ))}
              </RNView>
            </RNView>
          )}

          {/* ═══ My Vibes ═══ */}
          {vibes.length > 0 && (
            <RNView style={s.section}>
              <Text style={[s.sectionTitle, { color: theme.text }]}>My Vibes</Text>
              <RNView style={s.vibesWrap}>
                {vibes.map((v) => (
                  <RNView key={v} style={s.vibeChip}>
                    <Text style={s.vibeChipText}>{v}</Text>
                  </RNView>
                ))}
              </RNView>
            </RNView>
          )}

          {/* ═══ Lifestyle ═══ */}
          {lifestyleChips.length > 0 && (
            <RNView style={s.section}>
              <Text style={[s.sectionTitle, { color: theme.text }]}>Lifestyle</Text>
              <LifestyleDetailsSection values={lifestyle} editable={false} />
            </RNView>
          )}
        </RNView>
      </ScrollView>

      {/* ═══ Fixed bottom CTA ═══ */}
      <RNView style={[s.bottomBar, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable onPress={() => router.back()} style={{ flex: 1 }}>
          <LinearGradient
            colors={['#8B5CF6', '#E84393']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={s.editBtn}
          >
            <Ionicons name="pencil-outline" size={18} color="#fff" />
            <Text style={s.editBtnText}>Edit Profile</Text>
          </LinearGradient>
        </Pressable>
      </RNView>
    </RNView>
  );
}

const s = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  hero: {
    height: HERO_HEIGHT,
    width: '100%',
  },

  headerBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    zIndex: 10,
  },
  headerBtn: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontFamily: fonts.displayBold,
    color: '#fff',
  },
  headerEditText: {
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
    color: '#fff',
  },

  avatarWrap: {
    alignItems: 'center',
    marginTop: -(AVATAR_SIZE / 2),
    zIndex: 5,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_RADIUS,
    borderWidth: 4,
    borderColor: '#0D0D12',
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  identitySection: {
    alignItems: 'center',
    paddingTop: spacing.lg,
    paddingHorizontal: layout.containerPadding,
    gap: 6,
  },
  nameText: {
    fontSize: 28,
    fontFamily: fonts.displayBold,
  },
  taglineText: {
    fontSize: 15,
    fontFamily: fonts.body,
    fontStyle: 'italic',
    color: '#8B5CF6',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  locationText: {
    fontSize: 14,
    fontFamily: fonts.body,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  verifiedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(13,148,136,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(13,148,136,0.3)',
  },
  verifiedPillText: {
    fontSize: 11,
    fontFamily: fonts.bodySemiBold,
    color: '#0D9488',
  },

  main: {
    paddingHorizontal: layout.containerPadding,
    paddingTop: spacing.xl,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: fonts.displayBold,
    marginBottom: spacing.md,
  },
  bodyText: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: fonts.body,
  },

  // Vibe Video
  videoCard: {
    borderRadius: radius['2xl'],
    aspectRatio: 16 / 9,
    overflow: 'hidden',
    borderWidth: 1,
    position: 'relative',
  },
  videoThumbnail: {
    ...StyleSheet.absoluteFillObject,
  },
  videoPlayOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoPlayBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  videoCaptionStrip: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    paddingTop: spacing.md,
  },
  videoCaptionLabel: {
    fontSize: 10,
    fontFamily: fonts.bodySemiBold,
    letterSpacing: 2,
    color: '#06B6D4',
    marginBottom: 4,
  },
  videoCaptionText: {
    fontSize: 14,
    fontFamily: fonts.bodyBold,
    color: '#fff',
  },

  // Prompts
  promptCard: {
    borderRadius: radius['2xl'],
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  promptGradientAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    zIndex: 0,
  },
  promptInner: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    paddingLeft: 19,
    zIndex: 1,
  },
  promptTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  promptQuestion: {
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
    flex: 1,
  },
  promptAnswer: {
    fontSize: 16,
    lineHeight: 24,
    marginTop: spacing.sm,
    fontFamily: fonts.bodySemiBold,
  },
  promptFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
  },
  promptFooterLabel: {
    fontSize: 12,
    fontFamily: fonts.bodyMedium,
  },

  // Intent
  intentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.xl,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  intentChipLabel: {
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
  },

  // Photos
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  photoCell: {
    borderRadius: 12,
    overflow: 'hidden',
  },

  // Basics
  basicsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  basicCard: {
    width: '48%',
    padding: spacing.md,
    borderRadius: radius.xl,
    borderWidth: 1,
  },
  basicCardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  basicCardLabel: {
    fontSize: 11,
    fontFamily: fonts.body,
  },
  basicCardValue: {
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
    marginTop: 4,
  },

  // Vibes
  vibesWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  vibeChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(139,92,246,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(139,92,246,0.35)',
  },
  vibeChipText: {
    fontSize: 13,
    fontFamily: fonts.bodyMedium,
    color: '#fff',
  },

  // Bottom bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: layout.containerPadding,
    paddingTop: spacing.md,
    backgroundColor: 'rgba(13,13,18,0.95)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
  editBtnText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: fonts.bodyBold,
  },
});
