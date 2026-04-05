/**
 * Full profile body (hero + sections) — same content order and styling as Profile Preview,
 * minus owner-only vibe pipeline states unless `isOwnProfile`. Use inside screens, modals, or sheets.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  Image,
  StyleSheet,
  Pressable,
  View as RNView,
  useWindowDimensions,
  ActivityIndicator,
  Modal,
  PanResponder,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import Colors from '@/constants/Colors';
import { spacing, radius, fonts, layout } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { Text } from '@/components/Themed';
import type { UserProfileView } from '@/lib/fetchUserProfile';
import { avatarUrl, deckCardUrl, getImageUrl } from '@/lib/imageUrl';
import { formatBirthdayUsWithZodiac } from '@/lib/profileApi';
import { resolveVibeVideoState } from '@/lib/vibeVideoState';
import { PROMPT_EMOJIS } from '@/components/profile/PROMPT_CONSTANTS';
import { getLookingForDisplay } from '@/components/profile/RelationshipIntentSelector';
import { LifestyleDetailsSection } from '@/components/profile/LifestyleDetailsSection';
import { getLifestyleDisplayChips } from '@/lib/lifestyleChips';
import FullscreenVibeVideoModal from '@/components/video/FullscreenVibeVideoModal';

const HERO_HEIGHT = 250;
const AVATAR_SIZE = 160;
const AVATAR_RADIUS = 20;

/** Matches legacy client scoring threshold intent; stricter than Profile Preview’s “any trim”. */
const ABOUT_ME_MIN_CHARS = 10;

export type UserProfileFullViewProps = {
  profile: UserProfileView;
  /** Owner-only: video processing / failed cards. Default false — others see nothing for non-ready video. */
  isOwnProfile?: boolean;
  onEditProfile?: () => void;
  onClose?: () => void;
  hideHero?: boolean;
};

export function UserProfileFullView({
  profile,
  isOwnProfile = false,
  onEditProfile,
  onClose,
  hideHero = false,
}: UserProfileFullViewProps) {
  const insets = useSafeAreaInsets();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const [showFullscreenVibe, setShowFullscreenVibe] = useState(false);
  const [hideVibingOnLabelAfterComplete, setHideVibingOnLabelAfterComplete] = useState(false);
  const [photoViewerIndex, setPhotoViewerIndex] = useState<number | null>(null);
  const photoPagerRef = useRef<ScrollView>(null);

  const photoDismissPan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, g) =>
          Math.abs(g.dy) > 16 && Math.abs(g.dy) > Math.abs(g.dx) * 1.35,
        onPanResponderRelease: (_, g) => {
          if (g.dy > 90 || g.vy > 0.45) setPhotoViewerIndex(null);
        },
      }),
    [],
  );

  const mainPhoto = profile.photos?.[0] ?? profile.avatar_url ?? null;
  const nameTrim = profile.name?.trim() ?? '';
  const age = profile.age;
  const tagline = profile.tagline?.trim();
  const location = profile.location?.trim();
  const vibeInfo = resolveVibeVideoState(profile);
  const hasVibeVideoReady = vibeInfo.state === 'ready';
  const vibeProcessing = vibeInfo.state === 'uploading' || vibeInfo.state === 'processing';
  const vibeFailedOrError = vibeInfo.state === 'failed' || vibeInfo.state === 'error';
  const thumbnailUrl = vibeInfo.thumbnailUrl;
  const caption = profile.vibe_caption?.trim() ?? '';

  const aboutMeRaw = profile.about_me?.trim() ?? '';
  const showAboutMe = aboutMeRaw.length > ABOUT_ME_MIN_CHARS;

  const filledPrompts = useMemo(
    () => (profile.prompts ?? []).filter((p) => p.question?.trim() && p.answer?.trim()),
    [profile.prompts],
  );

  useEffect(() => {
    setHideVibingOnLabelAfterComplete(false);
  }, [vibeInfo.playbackUrl, vibeInfo.uid, profile.id]);

  const photos = useMemo(() => (profile.photos ?? []).filter(Boolean), [profile.photos]);
  const vibes = profile.vibes ?? [];
  const lookingForId = profile.relationship_intent ?? profile.looking_for;
  const lookingForDisplay = getLookingForDisplay(lookingForId);
  const lifestyle = profile.lifestyle ?? {};
  const lifestyleChips = getLifestyleDisplayChips(lifestyle);

  const emailVerified = profile.email_verified === true;
  const phoneVerified = profile.phone_verified === true;
  const photoVerified = profile.photo_verified === true;

  const hasLookingFor =
    typeof lookingForId === 'string' && lookingForId.trim().length > 0 && !!lookingForDisplay;

  const photoGridGap = spacing.sm;
  const gridPadding = layout.containerPadding * 2;
  const gridWidth = winWidth - gridPadding;
  const photoCellSize = Math.floor((gridWidth - photoGridGap * 2) / 3);

  useEffect(() => {
    if (photoViewerIndex === null || photos.length === 0) return;
    const idx = Math.min(Math.max(0, photoViewerIndex), photos.length - 1);
    requestAnimationFrame(() => {
      photoPagerRef.current?.scrollTo({ x: idx * winWidth, animated: false });
    });
  }, [photoViewerIndex, photos.length, winWidth]);

  const basicsItems = useMemo(() => {
    const rows = [
      {
        icon: 'calendar-outline' as const,
        label: 'Birthday',
        value: formatBirthdayUsWithZodiac(profile.birth_date),
      },
      { icon: 'briefcase-outline' as const, label: 'Work', value: profile.job?.trim() },
      {
        icon: 'resize-outline' as const,
        label: 'Height',
        value: profile.height_cm ? `${profile.height_cm} cm` : undefined,
      },
      { icon: 'location-outline' as const, label: 'Location', value: profile.location?.trim() },
    ] as const;
    return rows.filter((item) => item.value && item.value !== 'Not set');
  }, [profile.birth_date, profile.job, profile.height_cm, profile.location]);

  const nameAgeLine =
    nameTrim || age != null
      ? `${nameTrim}${nameTrim && age != null ? ', ' : ''}${age != null ? age : ''}`
      : '';

  const scrollBottomPad = isOwnProfile && onEditProfile ? 100 + insets.bottom : spacing['2xl'] + insets.bottom;

  return (
    <RNView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: scrollBottomPad }}
        bounces
      >
        {!hideHero ? (
          <>
            <LinearGradient
              colors={['#8B5CF6', '#E84393']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={s.hero}
            />

            <RNView style={[s.headerBar, { paddingTop: insets.top + 8 }]}>
              {onClose ? (
                <Pressable onPress={onClose} style={s.headerBtn} accessibilityLabel="Go back">
                  <Ionicons name="arrow-back" size={22} color="#fff" />
                </Pressable>
              ) : (
                <RNView style={s.headerBtn} />
              )}
              <RNView style={s.headerCenterSpacer} />
              {isOwnProfile && onEditProfile ? (
                <Pressable onPress={onEditProfile} style={s.headerBtn}>
                  <Text style={s.headerEditText}>Edit</Text>
                </Pressable>
              ) : (
                <RNView style={s.headerBtn} />
              )}
            </RNView>

            <RNView style={s.avatarWrap}>
              {mainPhoto ? (
                <Image source={{ uri: avatarUrl(mainPhoto) }} style={s.avatar} resizeMode="cover" />
              ) : (
                <RNView style={[s.avatar, s.avatarPlaceholder, { backgroundColor: theme.surfaceSubtle }]}>
                  <Ionicons name="person" size={64} color={theme.mutedForeground} />
                </RNView>
              )}
            </RNView>

            <RNView style={s.identitySection}>
              {nameAgeLine ? (
                <Text style={[s.nameText, { color: theme.text }]}>{nameAgeLine}</Text>
              ) : null}
              {tagline ? <Text style={s.taglineText}>&quot;{tagline}&quot;</Text> : null}
              {location ? (
                <RNView style={s.locationRow}>
                  <Ionicons name="location-outline" size={14} color={theme.textSecondary} />
                  <Text style={[s.locationText, { color: theme.textSecondary }]}>{location}</Text>
                </RNView>
              ) : null}

              {(emailVerified || phoneVerified || photoVerified) && (
                <RNView style={s.badgeRow}>
                  {emailVerified && (
                    <RNView style={s.verifiedPill}>
                      <Ionicons name="mail" size={12} color="#0D9488" />
                      <Text style={s.verifiedPillText}>Email verified</Text>
                    </RNView>
                  )}
                  {photoVerified && (
                    <RNView style={s.verifiedPill}>
                      <Ionicons name="camera" size={12} color="#0D9488" />
                      <Text style={s.verifiedPillText}>Photo verified</Text>
                    </RNView>
                  )}
                  {phoneVerified && (
                    <RNView style={s.verifiedPill}>
                      <Ionicons name="call" size={12} color="#0D9488" />
                      <Text style={s.verifiedPillText}>Phone verified</Text>
                    </RNView>
                  )}
                </RNView>
              )}
            </RNView>
          </>
        ) : (
          <RNView style={{ paddingTop: spacing.lg }} />
        )}

        {hideHero && (emailVerified || phoneVerified || photoVerified) ? (
          <RNView style={[s.identitySection, { paddingTop: spacing.md }]}>
            <RNView style={s.badgeRow}>
              {emailVerified && (
                <RNView style={s.verifiedPill}>
                  <Ionicons name="mail" size={12} color="#0D9488" />
                  <Text style={s.verifiedPillText}>Email verified</Text>
                </RNView>
              )}
              {photoVerified && (
                <RNView style={s.verifiedPill}>
                  <Ionicons name="camera" size={12} color="#0D9488" />
                  <Text style={s.verifiedPillText}>Photo verified</Text>
                </RNView>
              )}
              {phoneVerified && (
                <RNView style={s.verifiedPill}>
                  <Ionicons name="call" size={12} color="#0D9488" />
                  <Text style={s.verifiedPillText}>Phone verified</Text>
                </RNView>
              )}
            </RNView>
          </RNView>
        ) : null}

        <RNView style={[s.main, hideHero && { paddingTop: spacing.sm }]}>
          {isOwnProfile && vibeProcessing ? (
            <RNView style={s.section}>
              <RNView style={[s.videoCard, s.videoProcessingCard, { borderColor: theme.glassBorder }]}>
                <ActivityIndicator size="large" color="#8B5CF6" />
                <Text style={[s.videoProcessingTitle, { color: theme.text }]}>Processing your video…</Text>
                <Text style={[s.videoProcessingSub, { color: theme.textSecondary }]}>
                  This usually takes 15–30 seconds. Pull to refresh on Profile if it sticks.
                </Text>
              </RNView>
            </RNView>
          ) : null}

          {isOwnProfile && vibeFailedOrError ? (
            <RNView style={s.section}>
              <RNView style={[s.videoCard, s.videoFailedCard, { borderColor: theme.glassBorder }]}>
                <Ionicons name="alert-circle-outline" size={32} color="#F59E0B" />
                <Text style={[s.videoFailedTitle, { color: theme.text }]}>Video processing failed</Text>
                <Text style={[s.videoProcessingSub, { color: theme.textSecondary }]}>
                  Record a new clip from Profile Studio.
                </Text>
              </RNView>
            </RNView>
          ) : null}

          {hasVibeVideoReady ? (
            <RNView style={s.section}>
              <RNView style={[s.videoCard, { borderColor: theme.glassBorder }]}>
                {thumbnailUrl ? (
                  <Image source={{ uri: thumbnailUrl }} style={s.videoThumbnail} resizeMode="cover" />
                ) : (
                  <RNView
                    style={[
                      s.videoThumbnail,
                      { backgroundColor: theme.surface, justifyContent: 'center', alignItems: 'center' },
                    ]}
                  >
                    <Text style={{ color: theme.textSecondary, fontSize: 13 }}>Thumbnail unavailable</Text>
                  </RNView>
                )}
                <LinearGradient
                  pointerEvents="none"
                  colors={['transparent', 'rgba(0,0,0,0.72)']}
                  locations={[0.3, 1]}
                  style={StyleSheet.absoluteFill}
                />
                <RNView style={s.videoPlayOverlay} pointerEvents="box-none">
                  <Pressable
                    style={s.videoPlayBtn}
                    accessibilityLabel="Play vibe video"
                    disabled={!vibeInfo.canPlay}
                    onPress={() => {
                      if (vibeInfo.canPlay) setShowFullscreenVibe(true);
                    }}
                  >
                    <Ionicons name="play" size={28} color="#fff" />
                  </Pressable>
                </RNView>
                {caption ? (
                  <RNView style={s.videoCaptionStrip} pointerEvents="none">
                    {!hideVibingOnLabelAfterComplete ? (
                      <Text style={s.videoCaptionLabel}>VIBING ON</Text>
                    ) : null}
                    <Text style={s.videoCaptionText} numberOfLines={2}>
                      {caption}
                    </Text>
                  </RNView>
                ) : null}
              </RNView>
            </RNView>
          ) : null}

          {showAboutMe ? (
            <RNView style={s.section}>
              <Text style={[s.sectionTitle, { color: theme.text }]}>About Me</Text>
              <Text style={[s.bodyText, { color: theme.textSecondary }]}>{aboutMeRaw}</Text>
            </RNView>
          ) : null}

          {filledPrompts.length > 0 ? (
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
          ) : null}

          {hasLookingFor ? (
            <RNView style={s.section}>
              <Text style={[s.sectionTitle, { color: theme.text }]}>Looking For</Text>
              <RNView style={[s.intentChip, { backgroundColor: theme.tintSoft, borderColor: theme.border }]}>
                <Text style={{ fontSize: 18 }}>{lookingForDisplay?.emoji}</Text>
                <Text style={[s.intentChipLabel, { color: theme.text }]}>{lookingForDisplay?.label}</Text>
              </RNView>
            </RNView>
          ) : null}

          {photos.length > 0 ? (
            <RNView style={s.section}>
              <Text style={[s.sectionTitle, { color: theme.text }]}>Photos</Text>
              <RNView style={[s.photoGrid, { gap: photoGridGap }]}>
                {photos.map((url, i) => (
                  <Pressable
                    key={`photo-${i}`}
                    onPress={() => setPhotoViewerIndex(i)}
                    accessibilityLabel={`View photo ${i + 1} of ${photos.length}`}
                    style={[
                      s.photoCell,
                      { width: photoCellSize, height: photoCellSize, backgroundColor: theme.surfaceSubtle },
                    ]}
                  >
                    <Image source={{ uri: deckCardUrl(url) }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                  </Pressable>
                ))}
              </RNView>
            </RNView>
          ) : null}

          {basicsItems.length > 0 ? (
            <RNView style={s.section}>
              <Text style={[s.sectionTitle, { color: theme.text }]}>The Basics</Text>
              <RNView style={s.basicsGrid}>
                {basicsItems.map((item) => (
                  <RNView
                    key={item.label}
                    style={[s.basicCard, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}
                  >
                    <RNView style={s.basicCardTopRow}>
                      <Ionicons name={item.icon} size={14} color={theme.textSecondary} />
                      <Text style={[s.basicCardLabel, { color: theme.textSecondary }]}>{item.label}</Text>
                    </RNView>
                    <Text style={[s.basicCardValue, { color: theme.text }]} numberOfLines={2}>
                      {item.value}
                    </Text>
                  </RNView>
                ))}
              </RNView>
            </RNView>
          ) : null}

          {vibes.length > 0 ? (
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
          ) : null}

          {lifestyleChips.length > 0 ? (
            <RNView style={s.section}>
              <Text style={[s.sectionTitle, { color: theme.text }]}>Lifestyle</Text>
              <LifestyleDetailsSection values={lifestyle} editable={false} />
            </RNView>
          ) : null}
        </RNView>
      </ScrollView>

      {isOwnProfile && onEditProfile ? (
        <RNView style={[s.bottomBar, { paddingBottom: insets.bottom + spacing.md }]}>
          <Pressable onPress={onEditProfile} style={{ flex: 1 }}>
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
      ) : null}

      <FullscreenVibeVideoModal
        visible={showFullscreenVibe && vibeInfo.canPlay}
        onClose={() => setShowFullscreenVibe(false)}
        playbackUrl={vibeInfo.playbackUrl}
        bunnyVideoUid={profile.bunny_video_uid ?? vibeInfo.uid}
        vibeCaption={caption}
        posterUrl={vibeInfo.thumbnailUrl}
        onPlayToEnd={() => setHideVibingOnLabelAfterComplete(true)}
      />

      <Modal
        visible={photoViewerIndex !== null && photos.length > 0}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setPhotoViewerIndex(null)}
      >
        <RNView style={s.photoModalRoot} {...photoDismissPan.panHandlers}>
          <Pressable
            onPress={() => setPhotoViewerIndex(null)}
            style={[s.photoModalClose, { top: insets.top + 12 }]}
            accessibilityLabel="Close photo viewer"
          >
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
          <ScrollView
            ref={photoPagerRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={s.photoModalPager}
            contentContainerStyle={{ alignItems: 'center' }}
          >
            {photos.map((url, i) => (
              <RNView key={`pv-${i}`} style={[s.photoModalPage, { width: winWidth, height: winHeight }]}>
                <Image
                  source={{ uri: getImageUrl(url, { width: 1200, quality: 88 }) }}
                  style={s.photoModalImage}
                  resizeMode="contain"
                />
              </RNView>
            ))}
          </ScrollView>
        </RNView>
      </Modal>
    </RNView>
  );
}

const s = StyleSheet.create({
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
    minWidth: 44,
  },
  headerCenterSpacer: {
    flex: 1,
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
  videoCard: {
    borderRadius: radius['2xl'],
    aspectRatio: 16 / 9,
    overflow: 'hidden',
    borderWidth: 1,
    position: 'relative',
  },
  videoProcessingCard: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    gap: 10,
    backgroundColor: 'rgba(139,92,246,0.06)',
  },
  videoProcessingTitle: {
    fontSize: 16,
    fontFamily: fonts.displayBold,
    textAlign: 'center',
  },
  videoProcessingSub: {
    fontSize: 13,
    fontFamily: fonts.body,
    textAlign: 'center',
    lineHeight: 18,
  },
  videoFailedCard: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    gap: 8,
    backgroundColor: 'rgba(245,158,11,0.08)',
  },
  videoFailedTitle: {
    fontSize: 16,
    fontFamily: fonts.displayBold,
    textAlign: 'center',
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
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  photoCell: {
    borderRadius: 12,
    overflow: 'hidden',
  },
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
  photoModalRoot: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
  },
  photoModalClose: {
    position: 'absolute',
    right: 16,
    zIndex: 10,
    padding: 8,
  },
  photoModalPager: {
    flex: 1,
  },
  photoModalPage: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoModalImage: {
    width: '100%',
    height: '100%',
  },
});
