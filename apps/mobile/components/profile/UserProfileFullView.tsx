/**
 * Full profile body (hero + sections) — same content order and styling as Profile Preview,
 * including canonical non-playable Vibe Video states. Use inside screens, modals, or sheets.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  FlatList,
  Image,
  StyleSheet,
  Pressable,
  View as RNView,
  useWindowDimensions,
  ActivityIndicator,
  Modal,
  PanResponder,
  type AccessibilityActionEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as ExpoImage } from 'expo-image';

import Colors from '@/constants/Colors';
import { spacing, radius, fonts, layout } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { Text } from '@/components/Themed';
import type { UserProfileView } from '@/lib/fetchUserProfile';
import { getImageUrl } from '@/lib/imageUrl';
import { formatBirthdayUsWithZodiac } from '@/lib/profileApi';
import { resolveVibeVideoState } from '@/lib/vibeVideoState';
import { prewarmMediaAssets } from '@/lib/mediaAssetResolver';
import {
  beginProfileVibeVideoTtffPlayback,
  completeProfileVibeVideoTtffPlayback,
} from '@/lib/profileVibeVideoTtff';
import { useMediaAsset } from '@/hooks/useMediaAsset';
import { useReduceMotion, useReduceMotionState } from '@/hooks/useReduceMotion';
import { PROMPT_EMOJIS } from '@/components/profile/PROMPT_CONSTANTS';
import { getLookingForDisplay } from '@/components/profile/RelationshipIntentSelector';
import FullscreenVibeVideoModal from '@/components/video/FullscreenVibeVideoModal';
import {
  calculateAgeFromBirthDate,
  dedupeOtherUserPhotos,
  getOtherUserLifestyleDetails,
  getZodiacFromBirthDate,
  normalizeOtherUserVibes,
} from '@clientShared/profile/otherUserProfileViewModel';

export type UserProfileFullViewProps = {
  profile: UserProfileView;
  /** Enables owner-only edit and retry copy. Non-ready Vibe Video state remains visible to all viewers. */
  isOwnProfile?: boolean;
  onEditProfile?: () => void;
  onClose?: () => void;
  hideHero?: boolean;
  enableInlineHeroPhotoPaging?: boolean;
};

const PHOTO_ZOOM_SCALE = 2;
const PHOTO_MAX_PINCH_SCALE = 4;
const PHOTO_ZOOM_LOCK_SCALE = 1.03;
const PHOTO_ZOOM_SPRING = { damping: 22, stiffness: 240, mass: 0.7 };
const PHOTO_VIEWER_OPEN_GUARD_MS = 650;
const PHOTO_VIEWER_CLOSE_GUARD_MS = 900;
const PHOTO_VIEWER_TOUCH_INTENT_MS = 650;

// Stable noop so inactive photo pages can never write the shared `photoViewerZoomed` state
// (only the active page is wired to the real setter).
const NOOP_ZOOM_CHANGE = (_zoomed: boolean) => {};

function clampPhotoPan(tx: number, ty: number, scale: number, width: number, height: number) {
  'worklet';
  if (scale <= 1) return { x: 0, y: 0 };
  const maxX = (width * (scale - 1)) / 2;
  const maxY = (height * (scale - 1)) / 2;
  return {
    x: Math.min(maxX, Math.max(-maxX, tx)),
    y: Math.min(maxY, Math.max(-maxY, ty)),
  };
}

function AdaptiveNativeProfileMedia({
  uri,
  height,
  onPress,
  onPressIn,
  onAccessibilityActivate,
  accessibilityLabel,
}: {
  uri: string;
  height: number;
  onPress?: () => void;
  onPressIn?: () => void;
  onAccessibilityActivate?: () => void;
  accessibilityLabel?: string;
}) {
  const reduceMotion = useReduceMotion();
  // Key the error state to the URI so a late onError from a previous source can't poison the
  // current photo, and a new URI clears the failed state synchronously (no reset effect needed).
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const resolvedUri = getImageUrl(uri, { width: 1400, quality: 88 });
  const failed = failedUri === resolvedUri;

  const content = failed ? (
    <RNView style={[s.adaptiveFallback, { height }]}>
      <Ionicons name="image-outline" size={36} color="rgba(255,255,255,0.72)" />
      <Text style={s.adaptiveFallbackText}>Photo unavailable</Text>
    </RNView>
  ) : (
    <>
      {/* expo-image memory/disk cache keeps remounts from showing the old forced black load state. */}
      <ExpoImage
        recyclingKey={resolvedUri}
        source={{ uri: resolvedUri }}
        style={s.adaptiveBackground}
        contentFit="cover"
        blurRadius={22}
        cachePolicy="memory-disk"
        transition={reduceMotion ? 0 : 150}
      />
      <RNView style={s.adaptiveDim} />
      <ExpoImage
        recyclingKey={resolvedUri}
        source={{ uri: resolvedUri }}
        style={s.adaptiveForeground}
        contentFit="contain"
        cachePolicy="memory-disk"
        transition={reduceMotion ? 0 : 150}
        onError={() => setFailedUri(resolvedUri)}
      />
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        onPressIn={onPressIn}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? 'View profile photo'}
        accessibilityActions={onAccessibilityActivate ? [{ name: 'activate', label: 'View photo' }] : undefined}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'activate') onAccessibilityActivate?.();
        }}
        style={[s.adaptiveMedia, { height }]}
      >
        {content}
      </Pressable>
    );
  }

  return <RNView style={[s.adaptiveMedia, { height }]}>{content}</RNView>;
}

const ZoomableProfilePhotoPage = React.memo(function ZoomableProfilePhotoPage({
  uri,
  placeholderUri,
  width,
  height,
  isActive,
  accessibilityLabel,
  onZoomChange,
}: {
  uri: string;
  /** Low-res derivative shown while the full image decodes on a cache miss (avoids a black wait). */
  placeholderUri?: string | null;
  width: number;
  height: number;
  isActive: boolean;
  accessibilityLabel: string;
  onZoomChange: (zoomed: boolean) => void;
}) {
  // Key the error state to the URI so a stale onError can't poison the current photo, and a new
  // URI clears the failed state synchronously without a reset effect.
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const failed = failedUri === uri;
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const panStartTx = useSharedValue(0);
  const panStartTy = useSharedValue(0);
  const pinchBaseScale = useSharedValue(1);
  const pinchBaseTx = useSharedValue(0);
  const pinchBaseTy = useSharedValue(0);
  const isActiveSV = useSharedValue(isActive);
  const [zoomed, setZoomed] = useState(false);
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    isActiveSV.value = isActive;
  }, [isActive, isActiveSV]);

  const notifyZoomChange = useCallback(
    (nextZoomed: boolean) => {
      onZoomChange(nextZoomed);
    },
    [onZoomChange],
  );

  const setZoomedFromWorklet = useCallback((nextZoomed: boolean) => {
    setZoomed(nextZoomed);
  }, []);

  useAnimatedReaction(
    () => ({
      active: isActiveSV.value,
      zoomed: scale.value >= PHOTO_ZOOM_LOCK_SCALE,
    }),
    (curr, prev) => {
      const nextZoomed = curr.active && curr.zoomed;
      const prevZoomed = Boolean(prev?.active && prev.zoomed);
      if (nextZoomed !== prevZoomed) {
        runOnJS(setZoomedFromWorklet)(nextZoomed);
        runOnJS(notifyZoomChange)(nextZoomed);
      }
    },
    [notifyZoomChange, setZoomedFromWorklet],
  );

  useEffect(() => {
    if (isActive) return;
    scale.value = 1;
    tx.value = 0;
    ty.value = 0;
    setZoomed(false);
    onZoomChange(false);
  }, [isActive, onZoomChange, scale, tx, ty]);

  const outerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }],
  }));

  const innerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handleAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName !== 'activate') return;
      scale.value = reduceMotion ? (zoomed ? 1 : PHOTO_ZOOM_SCALE) : withSpring(zoomed ? 1 : PHOTO_ZOOM_SCALE, PHOTO_ZOOM_SPRING);
      tx.value = reduceMotion ? 0 : withSpring(0, PHOTO_ZOOM_SPRING);
      ty.value = reduceMotion ? 0 : withSpring(0, PHOTO_ZOOM_SPRING);
    },
    [reduceMotion, scale, tx, ty, zoomed],
  );

  const gesture = useMemo(() => {
    const resetZoom = () => {
      'worklet';
      scale.value = reduceMotion ? 1 : withSpring(1, PHOTO_ZOOM_SPRING);
      tx.value = reduceMotion ? 0 : withSpring(0, PHOTO_ZOOM_SPRING);
      ty.value = reduceMotion ? 0 : withSpring(0, PHOTO_ZOOM_SPRING);
    };

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDistance(18)
      .onEnd((_event, success) => {
        if (!success) return;
        if (scale.value >= PHOTO_ZOOM_LOCK_SCALE) {
          resetZoom();
        } else {
          scale.value = reduceMotion ? PHOTO_ZOOM_SCALE : withSpring(PHOTO_ZOOM_SCALE, PHOTO_ZOOM_SPRING);
          tx.value = reduceMotion ? 0 : withSpring(0, PHOTO_ZOOM_SPRING);
          ty.value = reduceMotion ? 0 : withSpring(0, PHOTO_ZOOM_SPRING);
        }
      });

    const pinch = Gesture.Pinch()
      .onBegin(() => {
        pinchBaseScale.value = scale.value;
        pinchBaseTx.value = tx.value;
        pinchBaseTy.value = ty.value;
      })
      .onUpdate((event) => {
        const baseScale = pinchBaseScale.value;
        if (baseScale < 0.001) return;
        const nextScale = Math.min(PHOTO_MAX_PINCH_SCALE, Math.max(1, baseScale * event.scale));
        const ratio = nextScale / baseScale;
        const midX = width / 2;
        const midY = height / 2;
        const nextTx = event.focalX - midX - ratio * (event.focalX - midX - pinchBaseTx.value);
        const nextTy = event.focalY - midY - ratio * (event.focalY - midY - pinchBaseTy.value);
        const clamped = clampPhotoPan(nextTx, nextTy, nextScale, width, height);
        scale.value = nextScale;
        tx.value = clamped.x;
        ty.value = clamped.y;
      })
      .onEnd(() => {
        if (scale.value < PHOTO_ZOOM_LOCK_SCALE) {
          resetZoom();
        } else {
          const clamped = clampPhotoPan(tx.value, ty.value, scale.value, width, height);
          tx.value = reduceMotion ? clamped.x : withSpring(clamped.x, PHOTO_ZOOM_SPRING);
          ty.value = reduceMotion ? clamped.y : withSpring(clamped.y, PHOTO_ZOOM_SPRING);
        }
      });

    const pan = Gesture.Pan()
      .onStart(() => {
        panStartTx.value = tx.value;
        panStartTy.value = ty.value;
      })
      .onUpdate((event) => {
        if (scale.value < PHOTO_ZOOM_LOCK_SCALE) return;
        const clamped = clampPhotoPan(
          panStartTx.value + event.translationX,
          panStartTy.value + event.translationY,
          scale.value,
          width,
          height,
        );
        tx.value = clamped.x;
        ty.value = clamped.y;
      });

    const baseGesture = Gesture.Simultaneous(pinch, doubleTap);
    return zoomed ? Gesture.Simultaneous(baseGesture, pan) : baseGesture;
  }, [
    height,
    panStartTx,
    panStartTy,
    pinchBaseScale,
    pinchBaseTx,
    pinchBaseTy,
    reduceMotion,
    scale,
    tx,
    ty,
    width,
    zoomed,
  ]);

  return (
    <GestureDetector gesture={gesture}>
      <RNView pointerEvents={isActive ? 'auto' : 'none'} style={[s.photoModalPage, { width, height }]}>
        <Animated.View style={[s.photoModalZoomLayer, { width, height }, outerStyle]}>
          <Animated.View style={[s.photoModalZoomLayer, { width, height }, innerStyle]}>
            {failed ? (
              <RNView style={s.photoModalImageState}>
                <Ionicons name="image-outline" size={40} color="rgba(255,255,255,0.72)" />
                <Text style={s.adaptiveFallbackText}>Photo unavailable</Text>
              </RNView>
            ) : (
              // expo-image memory/disk cache keeps decoded frames stable across re-renders/remounts.
              // transition=0 in the viewer: no fade on a cache hit/remount, so there is no residual
              // flicker. The low-res placeholder fills a cache-miss instead of a silent black wait.
              <ExpoImage
                recyclingKey={uri}
                source={{ uri }}
                placeholder={placeholderUri ? { uri: placeholderUri } : undefined}
                placeholderContentFit="contain"
                style={s.photoModalImage}
                contentFit="contain"
                cachePolicy="memory-disk"
                transition={0}
                accessible
                accessibilityRole="imagebutton"
                accessibilityLabel={`${accessibilityLabel}${zoomed ? ', zoomed in' : ''}`}
                accessibilityActions={[{ name: 'activate', label: zoomed ? 'Zoom out' : 'Zoom in' }]}
                onAccessibilityAction={handleAccessibilityAction}
                onError={() => setFailedUri(uri)}
              />
            )}
          </Animated.View>
        </Animated.View>
      </RNView>
    </GestureDetector>
  );
});

function CompactTrustPill() {
  return (
    <RNView style={s.verifiedPill}>
      <Ionicons name="shield-checkmark" size={12} color="#0D9488" />
      <Text style={s.verifiedPillText}>Verified</Text>
    </RNView>
  );
}

export function UserProfileFullView({
  profile,
  isOwnProfile = false,
  onEditProfile,
  onClose,
  hideHero = false,
  enableInlineHeroPhotoPaging = false,
}: UserProfileFullViewProps) {
  const insets = useSafeAreaInsets();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { reduceMotion, resolved: reduceMotionResolved } = useReduceMotionState();
  const [showFullscreenVibe, setShowFullscreenVibe] = useState(false);
  const [hideVibingOnLabelAfterComplete, setHideVibingOnLabelAfterComplete] = useState(false);
  const [photoViewerIndex, setPhotoViewerIndex] = useState<number | null>(null);
  const [photoViewerZoomed, setPhotoViewerZoomed] = useState(false);
  const [heroPhotoIndex, setHeroPhotoIndex] = useState(0);
  const heroPagerRef = useRef<FlatList<string>>(null);
  const photoPagerRef = useRef<FlatList<string>>(null);
  const profileVibeVideoTtffTokenRef = useRef<string | null>(null);
  const photoViewerOpenBlockedUntilRef = useRef(Date.now() + PHOTO_VIEWER_OPEN_GUARD_MS);
  const photoViewerTouchIntentRef = useRef<{ index: number; expiresAt: number } | null>(null);

  const blockPhotoViewerOpens = useCallback((durationMs: number) => {
    photoViewerOpenBlockedUntilRef.current = Math.max(
      photoViewerOpenBlockedUntilRef.current,
      Date.now() + durationMs,
    );
  }, []);

  const closePhotoViewer = useCallback(() => {
    blockPhotoViewerOpens(PHOTO_VIEWER_CLOSE_GUARD_MS);
    photoViewerTouchIntentRef.current = null;
    setPhotoViewerZoomed(false);
    setPhotoViewerIndex(null);
  }, [blockPhotoViewerOpens]);

  const photoDismissPan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (event, g) =>
          !photoViewerZoomed &&
          event.nativeEvent.touches.length < 2 &&
          Math.abs(g.dy) > 16 && Math.abs(g.dy) > Math.abs(g.dx) * 1.35,
        onPanResponderRelease: (_, g) => {
          if (!photoViewerZoomed && (g.dy > 90 || g.vy > 0.45)) closePhotoViewer();
        },
      }),
    [closePhotoViewer, photoViewerZoomed],
  );

  const photos = useMemo(
    () => dedupeOtherUserPhotos(profile.photos, profile.avatar_url),
    [profile.photos, profile.avatar_url],
  );
  const activeHeroPhotoIndex = photos.length > 0 ? Math.min(Math.max(0, heroPhotoIndex), photos.length - 1) : 0;
  const mainPhoto = photos[activeHeroPhotoIndex] ?? profile.avatar_url ?? null;
  const inlineHeroPhotoPagingEnabled = enableInlineHeroPhotoPaging && photos.length > 1;
  const nameTrim = profile.name?.trim() ?? '';
  const age = calculateAgeFromBirthDate(profile.birth_date) ?? profile.age;
  const tagline = profile.tagline?.trim();
  const location = profile.display_location?.trim() || profile.location?.trim();
  const distanceLabel = profile.distance_label?.trim();
  const company = profile.company?.trim();
  const job = profile.job?.trim();
  const workLabel = job && company ? `${job} at ${company}` : job || company;
  const zodiac = profile.zodiac?.trim() || getZodiacFromBirthDate(profile.birth_date);
  const vibeInfo = resolveVibeVideoState(profile);
  const signedVibeVideoRef = profile.vibe_video_playback_ref ?? null;
  const signedPlaybackRequired = profile.vibe_video_signed_playback_required && !!signedVibeVideoRef;
  const effectiveVibeVideoState = signedVibeVideoRef ? 'ready' : vibeInfo.state;
  const {
    url: signedVibeVideoUrl,
    posterUrl: signedVibeVideoPosterUrl,
    status: signedVibeVideoStatus,
    fallbackCopy: signedVibeVideoFallbackCopy,
    refresh: refreshSignedVibeVideo,
  } = useMediaAsset({
    kind: 'profile_vibe_video',
    sourceRef: signedVibeVideoRef,
    initialUrl: null,
    autoResolve: !!signedVibeVideoRef,
    enabled: effectiveVibeVideoState === 'ready' && !!signedVibeVideoRef,
  });
  const signedVibeVideoReady = signedVibeVideoStatus === 'ready' && !!signedVibeVideoUrl;
  const allowUnsignedFallback = !signedPlaybackRequired && signedVibeVideoStatus === 'error';
  const vibePlaybackUrl =
    signedVibeVideoRef && !allowUnsignedFallback ? signedVibeVideoUrl : vibeInfo.playbackUrl;
  const hasPlayableVibeVideo = effectiveVibeVideoState === 'ready' && (
    signedVibeVideoRef
      ? signedVibeVideoReady || (allowUnsignedFallback && !!vibePlaybackUrl)
      : !!vibePlaybackUrl
  );

  useEffect(() => {
    if (!reduceMotionResolved || reduceMotion || effectiveVibeVideoState !== 'ready') return;
    const sourceRef = signedVibeVideoRef ?? vibeInfo.playbackUrl ?? null;
    if (!sourceRef) return;
    void prewarmMediaAssets(
      [{
        kind: signedVibeVideoRef ? 'profile_vibe_video' : 'video',
        sourceRef,
      }],
      { concurrency: 1 },
    ).catch(() => {});
  }, [effectiveVibeVideoState, reduceMotion, reduceMotionResolved, signedVibeVideoRef, vibeInfo.playbackUrl]);

  const vibeReadyAwaitingPlayback = effectiveVibeVideoState === 'ready' && !hasPlayableVibeVideo;
  const vibeProcessing = effectiveVibeVideoState === 'processing' || effectiveVibeVideoState === 'stale_processing';
  const vibeStaleProcessing = effectiveVibeVideoState === 'stale_processing';
  const vibeFailedOrError = effectiveVibeVideoState === 'failed' || effectiveVibeVideoState === 'error';
  const thumbnailUrl =
    signedVibeVideoRef && !allowUnsignedFallback ? signedVibeVideoPosterUrl : vibeInfo.thumbnailUrl;
  const caption = vibeInfo.caption ?? '';
  const beginNativeProfileVibeVideoTtff = useCallback(() => {
    if (profileVibeVideoTtffTokenRef.current) return;
    const sourceRef = signedVibeVideoRef && !allowUnsignedFallback ? signedVibeVideoRef : vibePlaybackUrl;
    profileVibeVideoTtffTokenRef.current = beginProfileVibeVideoTtffPlayback(profile.id, {
      surface: 'native_profile_fullscreen',
      trigger: reduceMotion ? 'manual_play' : 'press',
      reduceMotion,
      usesSignedProfileRef: !!signedVibeVideoRef && !allowUnsignedFallback,
      sourceRef,
    });
  }, [allowUnsignedFallback, profile.id, reduceMotion, signedVibeVideoRef, vibePlaybackUrl]);
  const resetNativeProfileVibeVideoTtff = useCallback(() => {
    profileVibeVideoTtffTokenRef.current = null;
  }, []);
  const completeNativeProfileVibeVideoTtff = useCallback(() => {
    completeProfileVibeVideoTtffPlayback(profileVibeVideoTtffTokenRef.current);
    resetNativeProfileVibeVideoTtff();
  }, [resetNativeProfileVibeVideoTtff]);
  const closeFullscreenVibe = useCallback(() => {
    resetNativeProfileVibeVideoTtff();
    setShowFullscreenVibe(false);
  }, [resetNativeProfileVibeVideoTtff]);

  const aboutMeRaw = profile.about_me?.trim() ?? '';
  const showAboutMe = aboutMeRaw.length > 0;

  const filledPrompts = useMemo(
    () => (profile.prompts ?? []).filter((p) => p.question?.trim() && p.answer?.trim()),
    [profile.prompts],
  );

  useEffect(() => {
    setHideVibingOnLabelAfterComplete(false);
    resetNativeProfileVibeVideoTtff();
  }, [vibePlaybackUrl, vibeInfo.uid, profile.id, resetNativeProfileVibeVideoTtff]);

  useEffect(() => {
    if (!showFullscreenVibe || hasPlayableVibeVideo) return;
    resetNativeProfileVibeVideoTtff();
  }, [hasPlayableVibeVideo, resetNativeProfileVibeVideoTtff, showFullscreenVibe]);

  const vibeItems = useMemo(() => {
    const metadata = normalizeOtherUserVibes(profile.vibe_tags);
    return metadata.length > 0 ? metadata : normalizeOtherUserVibes(profile.vibes);
  }, [profile.vibe_tags, profile.vibes]);
  const lookingForId = profile.relationship_intent ?? profile.looking_for;
  const lookingForDisplay = getLookingForDisplay(lookingForId);
  const lifestyleDetails = useMemo(
    () => getOtherUserLifestyleDetails(profile.lifestyle ?? {}),
    [profile.lifestyle],
  );

  const ownTrustProfile = profile as UserProfileView & {
    email_verified?: boolean | null;
    phone_verified?: boolean | null;
  };
  const emailVerified = ownTrustProfile.email_verified === true;
  const phoneVerified = ownTrustProfile.phone_verified === true;
  const photoVerified = profile.photo_verified === true;
  const showEmailTrustPill = emailVerified;
  const showPhoneTrustPill = phoneVerified;
  const showPhotoTrustPill = photoVerified;
  const showAnyTrustPill = showEmailTrustPill || showPhoneTrustPill || showPhotoTrustPill;

  const hasLookingFor =
    typeof lookingForId === 'string' && lookingForId.trim().length > 0 && !!lookingForDisplay;

  const heroHeight = Math.min(winHeight * 0.58, 620);
  const galleryHeight = Math.max(220, Math.min(winHeight * 0.4, 420));

  useEffect(() => {
    blockPhotoViewerOpens(PHOTO_VIEWER_OPEN_GUARD_MS);
    photoViewerTouchIntentRef.current = null;
    setHeroPhotoIndex(0);
    setPhotoViewerZoomed(false);
    setPhotoViewerIndex(null);
  }, [blockPhotoViewerOpens, profile.id]);

  useEffect(() => {
    if (heroPhotoIndex < photos.length) return;
    setHeroPhotoIndex(0);
  }, [heroPhotoIndex, photos.length]);

  useEffect(() => {
    if (!inlineHeroPhotoPagingEnabled || photos.length === 0) return;
    requestAnimationFrame(() => {
      heroPagerRef.current?.scrollToIndex({ index: activeHeroPhotoIndex, animated: false });
    });
  }, [activeHeroPhotoIndex, inlineHeroPhotoPagingEnabled, photos.length, winWidth]);

  useEffect(() => {
    if (photoViewerIndex === null) return;
    if (photos.length === 0) {
      closePhotoViewer();
      return;
    }
    if (photoViewerIndex >= photos.length) {
      setPhotoViewerZoomed(false);
      setPhotoViewerIndex(photos.length - 1);
    }
  }, [closePhotoViewer, photoViewerIndex, photos.length]);

  useEffect(() => {
    if (photoViewerIndex === null || photos.length === 0) return;
    const idx = Math.min(Math.max(0, photoViewerIndex), photos.length - 1);
    requestAnimationFrame(() => {
      photoPagerRef.current?.scrollToIndex({ index: idx, animated: false });
    });
  }, [photoViewerIndex, photos.length, winWidth]);

  useEffect(() => {
    setPhotoViewerZoomed(false);
  }, [photoViewerIndex]);

  // Warm expo-image's cache for both the placeholder and full viewer resolutions.
  const prefetchProfilePhoto = useCallback((index: number) => {
    if (!Number.isInteger(index) || index < 0 || index >= photos.length) return;
    const placeholderUrl = getImageUrl(photos[index], { width: 420, quality: 60 });
    const fullUrl = getImageUrl(photos[index], { width: 1200, quality: 88 });
    const urls = Array.from(new Set([placeholderUrl, fullUrl]));
    void ExpoImage.prefetch(urls, { cachePolicy: 'memory-disk' }).catch(() => {});
  }, [photos]);

  // Prefetch the target plus immediate neighbors so opening/swiping usually avoids a cold cache.
  const prefetchPhotosAround = useCallback((index: number) => {
    prefetchProfilePhoto(index);
    prefetchProfilePhoto(index - 1);
    prefetchProfilePhoto(index + 1);
  }, [prefetchProfilePhoto]);

  const registerPhotoViewerTouchIntent = useCallback((index: number) => {
    const now = Date.now();
    if (now < photoViewerOpenBlockedUntilRef.current) return;
    if (!Number.isInteger(index) || index < 0 || index >= photos.length) return;
    photoViewerTouchIntentRef.current = {
      index,
      expiresAt: now + PHOTO_VIEWER_TOUCH_INTENT_MS,
    };
    // Start fetching at press-in (earliest signal) so the placeholder/full image are usually ready by open.
    prefetchProfilePhoto(index);
  }, [photos.length, prefetchProfilePhoto]);

  const openPhotoViewer = useCallback((index: number, source: 'touch' | 'accessibility' = 'touch') => {
    const now = Date.now();
    if (source === 'touch') {
      const intent = photoViewerTouchIntentRef.current;
      photoViewerTouchIntentRef.current = null;
      if (!intent || intent.index !== index || intent.expiresAt < now) return;
    } else {
      photoViewerTouchIntentRef.current = null;
    }
    if (now < photoViewerOpenBlockedUntilRef.current) return;
    if (photoViewerIndex !== null) return;
    if (!Number.isInteger(index) || index < 0 || index >= photos.length) return;
    prefetchPhotosAround(index);
    setPhotoViewerZoomed(false);
    setPhotoViewerIndex(index);
  }, [photoViewerIndex, photos.length, prefetchPhotosAround]);

  const handleHeroPhotoScrollBeginDrag = useCallback(() => {
    photoViewerTouchIntentRef.current = null;
  }, []);

  const handleHeroPhotoMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const idx = Math.round(event.nativeEvent.contentOffset.x / winWidth);
      if (idx < 0 || idx >= photos.length || idx === heroPhotoIndex) return;
      photoViewerTouchIntentRef.current = null;
      setHeroPhotoIndex(idx);
      prefetchPhotosAround(idx);
    },
    [heroPhotoIndex, photos.length, prefetchPhotosAround, winWidth],
  );
  const handleHeroPhotoScrollEndDrag = handleHeroPhotoMomentumEnd;

  const handlePhotoPagerMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const idx = Math.round(event.nativeEvent.contentOffset.x / winWidth);
      if (idx < 0 || idx >= photos.length || idx === photoViewerIndex) return;
      setPhotoViewerZoomed(false);
      setPhotoViewerIndex(idx);
    },
    [photoViewerIndex, photos.length, winWidth],
  );

  const basicsItems = useMemo(() => {
    const rows: Array<{
      icon: React.ComponentProps<typeof Ionicons>['name'];
      label: string;
      value?: string | null;
    }> = [
      isOwnProfile
        ? { icon: 'calendar-outline', label: 'Birthday', value: formatBirthdayUsWithZodiac(profile.birth_date) }
        : { icon: 'sparkles-outline', label: 'Zodiac', value: zodiac },
      { icon: 'briefcase-outline', label: 'Work', value: workLabel },
      {
        icon: 'resize-outline',
        label: 'Height',
        value: profile.height_cm ? `${profile.height_cm} cm` : undefined,
      },
      { icon: 'location-outline', label: 'Location', value: location },
      { icon: 'navigate-outline', label: 'Distance', value: distanceLabel ? `${distanceLabel} away` : undefined },
      ...lifestyleDetails.map((detail) => ({
        icon: 'checkmark-circle-outline' as React.ComponentProps<typeof Ionicons>['name'],
        label: detail.label,
        value: detail.value,
      })),
    ];
    return rows.filter((item) => item.value && item.value !== 'Not set');
  }, [isOwnProfile, profile.birth_date, zodiac, workLabel, profile.height_cm, location, distanceLabel, lifestyleDetails]);

  const nameAgeLine =
    nameTrim || age != null
      ? `${nameTrim}${nameTrim && age != null ? ', ' : ''}${age != null ? age : ''}`
      : '';

  const scrollBottomPad = isOwnProfile && onEditProfile ? 100 + insets.bottom : spacing['2xl'] + insets.bottom;
  const photoViewerVisible = photoViewerIndex !== null && photos.length > 0;
  const activePhotoViewerIndex =
    photoViewerIndex === null || photos.length === 0
      ? 0
      : Math.min(Math.max(0, photoViewerIndex), photos.length - 1);

  // Keep the photos adjacent to the current one warm in expo-image's cache as the user pages.
  useEffect(() => {
    if (!photoViewerVisible) return;
    prefetchPhotosAround(activePhotoViewerIndex);
  }, [activePhotoViewerIndex, photoViewerVisible, prefetchPhotosAround]);

  // Every cell renders the same component type (ZoomableProfilePhotoPage); only `isActive` toggles.
  // This keeps FlatList cells stable across re-renders so the active photo never remounts/re-fetches.
  // Only the active page is wired to `setPhotoViewerZoomed`; inactive pages get a noop so a
  // neighbor mounting/updating can never re-enable paging/dismiss while the active photo is zoomed.
  const renderPhotoViewerItem = useCallback(
    ({ item: url, index: i }: { item: string; index: number }) => {
      const isActive = i === activePhotoViewerIndex;
      const uri = getImageUrl(url, { width: 1200, quality: 88 });
      const placeholderUri = getImageUrl(url, { width: 420, quality: 60 });
      return (
        <ZoomableProfilePhotoPage
          key={`pv-${url}`}
          uri={uri}
          placeholderUri={placeholderUri}
          width={winWidth}
          height={winHeight}
          isActive={isActive}
          accessibilityLabel={`Profile photo ${i + 1} of ${photos.length}`}
          onZoomChange={isActive ? setPhotoViewerZoomed : NOOP_ZOOM_CHANGE}
        />
      );
    },
    [activePhotoViewerIndex, photos.length, winHeight, winWidth],
  );

  const renderHeroPhotoItem = useCallback(
    ({ item: url, index: i }: { item: string; index: number }) => (
      <RNView style={{ width: winWidth, height: heroHeight }}>
        <AdaptiveNativeProfileMedia
          uri={url}
          height={heroHeight}
          onPressIn={() => registerPhotoViewerTouchIntent(i)}
          onPress={() => openPhotoViewer(i)}
          onAccessibilityActivate={() => openPhotoViewer(i, 'accessibility')}
          accessibilityLabel={`View photo ${i + 1} of ${photos.length}`}
        />
      </RNView>
    ),
    [heroHeight, openPhotoViewer, photos.length, registerPhotoViewerTouchIntent, winWidth],
  );

  return (
    <RNView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: scrollBottomPad }}
        bounces
      >
        {!hideHero ? (
          <>
            <RNView style={[s.hero, { height: heroHeight, backgroundColor: theme.surfaceSubtle }]}>
              {mainPhoto ? (
                inlineHeroPhotoPagingEnabled ? (
                  <FlatList
                    ref={heroPagerRef}
                    data={photos}
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    bounces={false}
                    initialNumToRender={1}
                    maxToRenderPerBatch={2}
                    windowSize={3}
                    style={s.heroPager}
                    keyExtractor={(url, i) => `hero-${i}-${url}`}
                    getItemLayout={(_, index) => ({
                      length: winWidth,
                      offset: winWidth * index,
                      index,
                    })}
                    onScrollBeginDrag={handleHeroPhotoScrollBeginDrag}
                    onScrollEndDrag={handleHeroPhotoScrollEndDrag}
                    onMomentumScrollEnd={handleHeroPhotoMomentumEnd}
                    onScrollToIndexFailed={(info) => {
                      requestAnimationFrame(() => {
                        heroPagerRef.current?.scrollToIndex({ index: info.index, animated: false });
                      });
                    }}
                    renderItem={renderHeroPhotoItem}
                  />
                ) : (
                  <AdaptiveNativeProfileMedia
                    uri={mainPhoto}
                    height={heroHeight}
                    onPressIn={() => registerPhotoViewerTouchIntent(activeHeroPhotoIndex)}
                    onPress={() => openPhotoViewer(activeHeroPhotoIndex)}
                    onAccessibilityActivate={() => openPhotoViewer(activeHeroPhotoIndex, 'accessibility')}
                  />
                )
              ) : (
                <RNView style={[s.adaptiveFallback, { height: heroHeight }]}>
                  <Ionicons name="person" size={64} color={theme.mutedForeground} />
                  <Text style={{ color: theme.textSecondary, marginTop: 8 }}>No photo yet</Text>
                </RNView>
              )}
              <LinearGradient
                pointerEvents="none"
                colors={['rgba(0,0,0,0.42)', 'transparent', 'rgba(0,0,0,0.58)']}
                locations={[0, 0.45, 1]}
                style={StyleSheet.absoluteFill}
              />
            </RNView>

            <RNView style={[s.headerBar, { paddingTop: insets.top + 8 }]}>
              {onClose ? (
                <Pressable
                  onPress={onClose}
                  style={s.headerBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Go back"
                >
                  <Ionicons name="arrow-back" size={22} color="#fff" />
                </Pressable>
              ) : (
                <RNView style={s.headerBtn} />
              )}
              <RNView style={s.headerCenterSpacer} />
              {isOwnProfile && onEditProfile ? (
                <Pressable onPress={onEditProfile} style={s.headerBtn} accessibilityRole="button">
                  <Text style={s.headerEditText}>Edit</Text>
                </Pressable>
              ) : (
                <RNView style={s.headerBtn} />
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
              {distanceLabel ? (
                <RNView style={s.locationRow}>
                  <Ionicons name="navigate-outline" size={14} color={theme.textSecondary} />
                  <Text style={[s.locationText, { color: theme.textSecondary }]}>{distanceLabel} away</Text>
                </RNView>
              ) : null}

              {showAnyTrustPill ? (
                <RNView style={s.badgeRow}>
                  <CompactTrustPill />
                </RNView>
              ) : null}
            </RNView>
          </>
        ) : (
          <RNView style={{ paddingTop: spacing.lg }} />
        )}

        {hideHero && showAnyTrustPill ? (
          <RNView style={[s.identitySection, { paddingTop: spacing.md }]}>
            <RNView style={s.badgeRow}>
              <CompactTrustPill />
            </RNView>
          </RNView>
        ) : null}

        <RNView style={[s.main, hideHero && { paddingTop: spacing.sm }]}>
          {vibeProcessing ? (
            <RNView style={s.section}>
              <RNView style={[s.videoCard, s.videoProcessingCard, { borderColor: theme.glassBorder }]}>
                {vibeStaleProcessing ? (
                  <Ionicons name="warning-outline" size={32} color="#F59E0B" />
                ) : (
                  <ActivityIndicator size="large" color="#8B5CF6" />
                )}
                <Text style={[s.videoProcessingTitle, { color: theme.text }]}>
                  {vibeStaleProcessing
                    ? isOwnProfile
                      ? 'Still processing your video'
                      : 'Vibe Video still processing'
                    : isOwnProfile
                      ? 'Processing your video...'
                      : 'Vibe Video processing'}
                </Text>
                <Text style={[s.videoProcessingSub, { color: theme.textSecondary }]}>
                  {vibeStaleProcessing
                    ? isOwnProfile
                      ? 'Still processing. Refresh, try again later, or re-upload if it does not finish.'
                      : 'Their clip is saved, but playback is taking longer than usual.'
                    : isOwnProfile
                      ? "Your video uploaded and is still processing. This can take a few minutes. We'll keep checking."
                      : 'Their clip is saved and getting ready for playback.'}
                </Text>
              </RNView>
            </RNView>
          ) : null}

          {vibeFailedOrError ? (
            <RNView style={s.section}>
              <RNView style={[s.videoCard, s.videoFailedCard, { borderColor: theme.glassBorder }]}>
                <Ionicons name="alert-circle-outline" size={32} color="#F59E0B" />
                <Text style={[s.videoFailedTitle, { color: theme.text }]}>
                  {isOwnProfile ? 'Video processing failed' : 'Vibe Video needs a fresh take'}
                </Text>
                <Text style={[s.videoProcessingSub, { color: theme.textSecondary }]}>
                  {isOwnProfile ? 'Record a new clip from Profile Studio.' : 'This clip did not finish processing.'}
                </Text>
              </RNView>
            </RNView>
          ) : null}

          {vibeReadyAwaitingPlayback ? (
            <RNView style={s.section}>
              <RNView style={[s.videoCard, s.videoProcessingCard, { borderColor: theme.glassBorder }]}>
                <Ionicons name="sync" size={32} color="#FBBF24" />
                <Text style={[s.videoProcessingTitle, { color: theme.text }]}>
                  {signedVibeVideoFallbackCopy?.title ?? 'Preview still syncing'}
                </Text>
                <Text style={[s.videoProcessingSub, { color: theme.textSecondary }]}>
                  {signedVibeVideoFallbackCopy?.message ??
                    (isOwnProfile
                      ? 'Your Vibe Video is ready on the backend, but this device is still waiting on a playable preview URL.'
                      : 'The clip is ready on our side and playback should appear shortly.')}
                </Text>
                {signedVibeVideoFallbackCopy?.actionLabel && signedVibeVideoRef ? (
                  <Pressable
                    onPress={() => {
                      void refreshSignedVibeVideo('manual', { bypassFailureCooldown: true });
                    }}
                    style={({ pressed }) => [s.videoRetryButton, pressed && { opacity: 0.85 }]}
                    accessibilityRole="button"
                    accessibilityLabel={signedVibeVideoFallbackCopy.actionLabel}
                  >
                    <Text style={s.videoRetryText}>{signedVibeVideoFallbackCopy.actionLabel}</Text>
                  </Pressable>
                ) : null}
              </RNView>
            </RNView>
          ) : null}

          {hasPlayableVibeVideo ? (
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
                    accessibilityRole="button"
                    accessibilityLabel="Play vibe video"
                    disabled={!hasPlayableVibeVideo}
                    onPress={() => {
                      if (hasPlayableVibeVideo) {
                        if (!reduceMotion) beginNativeProfileVibeVideoTtff();
                        setShowFullscreenVibe(true);
                      }
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

          {hasLookingFor ? (
            <RNView style={s.section}>
              <Text style={[s.sectionTitle, { color: theme.text }]}>Looking For</Text>
              <RNView style={[s.intentChip, { backgroundColor: theme.tintSoft, borderColor: theme.border }]}>
                <Text style={{ fontSize: 18 }}>{lookingForDisplay?.emoji}</Text>
                <Text style={[s.intentChipLabel, { color: theme.text }]}>{lookingForDisplay?.label}</Text>
              </RNView>
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

          {vibeItems.length > 0 ? (
            <RNView style={s.section}>
              <Text style={[s.sectionTitle, { color: theme.text }]}>My Vibes</Text>
              <RNView style={s.vibesWrap}>
                {vibeItems.map((v) => (
                  <RNView key={v.id ?? v.label} style={s.vibeChip}>
                    <Text style={s.vibeChipText}>{v.emoji ? `${v.emoji} ${v.label}` : v.label}</Text>
                  </RNView>
                ))}
              </RNView>
            </RNView>
          ) : null}

          {basicsItems.length > 0 ? (
            <RNView style={s.section}>
              <Text style={[s.sectionTitle, { color: theme.text }]}>Details</Text>
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

          {showAnyTrustPill ? (
            <RNView style={s.section}>
              <Text style={[s.sectionTitle, { color: theme.text }]}>Verification Status</Text>
              <RNView style={[s.badgeRow, { marginTop: 0 }]}>
                {showEmailTrustPill ? (
                  <RNView style={s.verifiedPill}>
                    <Ionicons name="mail" size={12} color="#0D9488" />
                    <Text style={s.verifiedPillText}>Email verified</Text>
                  </RNView>
                ) : null}
                {showPhotoTrustPill ? (
                  <RNView style={s.verifiedPill}>
                    <Ionicons name="camera" size={12} color="#0D9488" />
                    <Text style={s.verifiedPillText}>Photo verified</Text>
                  </RNView>
                ) : null}
                {showPhoneTrustPill ? (
                  <RNView style={s.verifiedPill}>
                    <Ionicons name="call" size={12} color="#0D9488" />
                    <Text style={s.verifiedPillText}>Phone verified</Text>
                  </RNView>
                ) : null}
              </RNView>
            </RNView>
          ) : null}

          {photos.length > 0 ? (
            <RNView style={s.section}>
              <Text style={[s.sectionTitle, { color: theme.text }]}>Photos</Text>
              <RNView style={s.photoGalleryStack}>
                {photos.map((url, i) => (
                  <AdaptiveNativeProfileMedia
                    key={`photo-${i}`}
                    uri={url}
                    height={galleryHeight}
                    onPressIn={() => registerPhotoViewerTouchIntent(i)}
                    onPress={() => openPhotoViewer(i)}
                    onAccessibilityActivate={() => openPhotoViewer(i, 'accessibility')}
                    accessibilityLabel={`View photo ${i + 1} of ${photos.length}`}
                  />
                ))}
              </RNView>
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
        visible={showFullscreenVibe && hasPlayableVibeVideo}
        onClose={closeFullscreenVibe}
        playbackUrl={vibePlaybackUrl}
        bunnyVideoUid={vibeInfo.uid}
        vibeVideoState={effectiveVibeVideoState}
        vibeCaption={caption}
        captions={null}
        posterUrl={thumbnailUrl}
        onPlaybackRequest={beginNativeProfileVibeVideoTtff}
        onFirstFrame={completeNativeProfileVibeVideoTtff}
        onPlaybackAbort={resetNativeProfileVibeVideoTtff}
        onPlayToEnd={() => setHideVibingOnLabelAfterComplete(true)}
      />

      {photoViewerVisible ? (
        <Modal
          visible
          animationType={reduceMotion ? 'none' : 'fade'}
          presentationStyle="fullScreen"
          statusBarTranslucent
          onRequestClose={closePhotoViewer}
        >
          <GestureHandlerRootView style={s.photoModalRoot}>
            <RNView
              style={s.photoModalContent}
              accessibilityViewIsModal
              importantForAccessibility="yes"
              {...photoDismissPan.panHandlers}
            >
              <Pressable
                onPress={closePhotoViewer}
                style={[s.photoModalClose, { top: insets.top + 12 }]}
                accessibilityRole="button"
                accessibilityLabel="Close photo viewer"
                hitSlop={12}
              >
                <Ionicons name="close" size={28} color="#fff" />
              </Pressable>
              <FlatList
                ref={photoPagerRef}
                data={photos}
                extraData={activePhotoViewerIndex}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                scrollEnabled={!photoViewerZoomed}
                keyboardShouldPersistTaps="handled"
                initialScrollIndex={activePhotoViewerIndex}
                initialNumToRender={1}
                maxToRenderPerBatch={2}
                windowSize={3}
                style={s.photoModalPager}
                contentContainerStyle={{ alignItems: 'center' }}
                keyExtractor={(url, i) => `pv-${i}-${url}`}
                getItemLayout={(_, index) => ({
                  length: winWidth,
                  offset: winWidth * index,
                  index,
                })}
                onMomentumScrollEnd={handlePhotoPagerMomentumEnd}
                onScrollToIndexFailed={(info) => {
                  requestAnimationFrame(() => {
                    photoPagerRef.current?.scrollToIndex({ index: info.index, animated: false });
                  });
                }}
                renderItem={renderPhotoViewerItem}
              />
            </RNView>
          </GestureHandlerRootView>
        </Modal>
      ) : null}
    </RNView>
  );
}

const s = StyleSheet.create({
  hero: {
    width: '100%',
    overflow: 'hidden',
  },
  heroPager: {
    width: '100%',
    height: '100%',
  },
  adaptiveMedia: {
    width: '100%',
    overflow: 'hidden',
    borderRadius: 18,
    backgroundColor: '#111118',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  adaptiveBackground: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.42,
    transform: [{ scale: 1.08 }],
  },
  adaptiveDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.34)',
  },
  adaptiveForeground: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  adaptiveFallback: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111118',
  },
  adaptiveFallbackText: {
    marginTop: 8,
    color: 'rgba(255,255,255,0.74)',
    fontSize: 13,
    fontFamily: fonts.bodyMedium,
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
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenterSpacer: {
    flex: 1,
  },
  headerEditText: {
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
    color: '#fff',
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
    flexWrap: 'wrap',
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
  videoRetryButton: {
    marginTop: 2,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(139,92,246,0.42)',
    backgroundColor: 'rgba(139,92,246,0.14)',
  },
  videoRetryText: {
    color: 'rgba(233,213,255,0.95)',
    fontSize: 12,
    fontFamily: fonts.bodyBold,
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
  photoGalleryStack: {
    gap: spacing.md,
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
  photoModalContent: {
    flex: 1,
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
  photoModalZoomLayer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoModalImage: {
    width: '100%',
    height: '100%',
  },
  photoModalImageState: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
});
