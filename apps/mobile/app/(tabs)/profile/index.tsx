import React, { useState, useEffect, useRef } from 'react';
import {
  ScrollView,
  Alert,
  Image,
  RefreshControl,
  StyleSheet,
  Pressable,
  Share,
  Platform,
  Linking,
  Animated,
  Modal,
  View as RNView,
  Dimensions,
  FlatList,
  useWindowDimensions,
  LayoutAnimation,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import {
  SectionHeader,
  Card,
  Chip,
  VibelyButton,
  VibelyInput,
  LoadingState,
  ErrorState,
  SettingsRow,
  DestructiveRow,
  VibelyText,
} from '@/components/ui';
import { GradientSurface } from '@/components/GradientSurface';
import { spacing, radius, typography, layout, shadows, fonts } from '@/constants/theme';
import Svg, { Circle } from 'react-native-svg';
import { useColorScheme } from '@/components/useColorScheme';
import { Text, View } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import { fetchMyProfile, updateMyProfile, getZodiacSign, getZodiacEmoji, type ProfileRow } from '@/lib/profileApi';
import { uploadProfilePhoto } from '@/lib/uploadImage';
import { deleteVibeVideo } from '@/lib/vibeVideoApi';
import { getVibeVideoPlaybackUrl, getVibeVideoThumbnailUrl } from '@/lib/vibeVideoPlaybackUrl';
import { avatarUrl, getImageUrl } from '@/lib/imageUrl';
import { useVideoPlayer, VideoView } from 'expo-video';
import { PromptEditSheet } from '@/components/profile/PromptEditSheet';
import { PROMPT_EMOJIS } from '@/components/profile/PROMPT_CONSTANTS';
import { RelationshipIntentSelector } from '@/components/profile/RelationshipIntentSelector';
import { LifestyleDetailsSection } from '@/components/profile/LifestyleDetailsSection';
import { VerificationBadgesRow } from '@/components/profile/VerificationBadgesRow';
import { ProfilePreviewModal } from '@/components/profile/ProfilePreviewModal';
import { PhoneVerificationFlow } from '@/components/verification/PhoneVerificationFlow';
import { EmailVerificationFlow } from '@/components/verification/EmailVerificationFlow';

function VibeVideoPlayer({ playbackUrl, thumbnailUrl, style }: { playbackUrl: string; thumbnailUrl?: string | null; style?: object }) {
  const [playbackError, setPlaybackError] = useState(false);
  const source = playbackUrl.endsWith('.m3u8') ? { uri: playbackUrl, contentType: 'hls' as const } : playbackUrl;
  const player = useVideoPlayer(source, (p) => {
    p.loop = false;
  });

  useEffect(() => {
    const sub = player.addListener?.('statusChange', (payload: { status?: string }) => {
      if (payload?.status === 'error') setPlaybackError(true);
    });
    return () => sub?.remove?.();
  }, [player]);

  if (playbackError) {
    return (
      <View style={[styles.vibeVideoUnavailable, style]}>
        {thumbnailUrl ? (
          <Image source={{ uri: thumbnailUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : null}
        <View style={styles.vibeVideoUnavailableOverlay}>
          <Ionicons name="videocam-off-outline" size={32} color="#fff" />
          <Text style={styles.vibeVideoUnavailableText}>Video unavailable</Text>
        </View>
      </View>
    );
  }

  return <VideoView style={style} player={player} nativeControls contentFit="contain" />;
}

// Web parity: PhotoManager / PhotoGallery max (src/components/PhotoManager.tsx)
const MAX_PHOTOS = 6;

// Relationship intent labels (mirrored from web + RelationshipIntentSelector)
const LOOKING_FOR_LABELS: Record<string, string> = {
  'long-term': 'Something serious',
  'relationship': 'Relationship',
  'something-casual': 'Something casual',
  'new-friends': 'New friends',
  'figuring-out': 'Not sure yet',
  'rather-not': 'Rather not say',
};

function getVibeScoreLabel(score: number): string {
  if (score >= 90) return 'Iconic';
  if (score >= 75) return 'Fire';
  if (score >= 50) return 'Rising';
  if (score >= 25) return 'Warming Up';
  return 'Ghost Mode';
}

/** Web parity: circular progress ring (tint stroke, muted track), Space Grotesk bold % */
function VibeScoreDisplay({
  score,
  size = 100,
  theme,
}: {
  score: number;
  size?: number;
  theme: { text: string; textSecondary: string; tint: string; muted: string };
}) {
  const label = getVibeScoreLabel(score);
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const progress = Math.min(100, Math.max(0, score)) / 100;
  const strokeDashoffset = circumference * (1 - progress);

  return (
    <View style={[vibeScoreStyles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={c} cy={c} r={r} stroke={theme.muted} strokeWidth={stroke} fill="none" />
        <Circle
          cx={c}
          cy={c}
          r={r}
          stroke={theme.tint}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${c} ${c})`}
        />
      </Svg>
      <Text style={[vibeScoreStyles.scoreText, { color: theme.text }]}>{score}%</Text>
      <Text style={[vibeScoreStyles.scoreLabel, { color: theme.textSecondary }]}>{label}</Text>
    </View>
  );
}

const vibeScoreStyles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  scoreText: {
    fontSize: 22,
    fontFamily: fonts.displayBold,
  },
  scoreLabel: {
    fontSize: 11,
    marginTop: 2,
    fontWeight: '600',
  },
});

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { width: winWidth } = useWindowDimensions();
  const [photoGridWidth, setPhotoGridWidth] = useState<number | null>(null);
  /** Photo grid: 3-column bento (2×2 main + row of 3); web Profile uses similar masonry — aspect 4/5 on hero tile */
  const photoGridGap = spacing.sm;
  const effectiveGridWidth = photoGridWidth ?? Math.max(0, winWidth - layout.containerPadding * 2);
  const photoCellSize = effectiveGridWidth > 0 ? (effectiveGridWidth - photoGridGap * 2) / 3 : 80;
  const photoMainSize = photoCellSize * 2 + photoGridGap;
  const photoMainHeight = photoMainSize * (5 / 4); // web aspect-[4/5] for main tile
  const { user, signOut, refreshOnboarding } = useAuth();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const qc = useQueryClient();
  const { data: profile, isLoading, isError, error, isRefetching, refetch } = useQuery({
    queryKey: ['my-profile'],
    queryFn: fetchMyProfile,
    enabled: !!user?.id,
  });
  const [photoViewerIndex, setPhotoViewerIndex] = useState(0);
  const [showPhotoViewer, setShowPhotoViewer] = useState(false);
  const [galleryCurrentIndex, setGalleryCurrentIndex] = useState(0);
  const galleryFlatListRef = useRef<FlatList<string> | null>(null);
  const [lastAddedPhotoIndex, setLastAddedPhotoIndex] = useState<number | null>(null);
  const newPhotoAnim = useRef(new Animated.Value(1)).current;
  const [showManageSheet, setShowManageSheet] = useState(false);
  const [editingPhotos, setEditingPhotos] = useState<string[]>([]);
  const [manageSaving, setManageSaving] = useState(false);
  const [showVibeVideoFullscreen, setShowVibeVideoFullscreen] = useState(false);
  const galleryBackdropOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (lastAddedPhotoIndex === null) return;
    newPhotoAnim.setValue(0);
    Animated.timing(newPhotoAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start(() => {
      setLastAddedPhotoIndex(null);
    });
  }, [lastAddedPhotoIndex, newPhotoAnim]);

  useEffect(() => {
    if (showPhotoViewer) {
      galleryBackdropOpacity.setValue(0);
      Animated.timing(galleryBackdropOpacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    } else {
      galleryBackdropOpacity.setValue(0);
    }
  }, [showPhotoViewer, galleryBackdropOpacity]);

  // Poll profile when vibe video is uploading or processing so UI updates when ready/failed
  useEffect(() => {
    const status = profile?.bunny_video_status;
    if (status !== 'uploading' && status !== 'processing') return;
    const interval = setInterval(() => refetch(), 5000);
    return () => clearInterval(interval);
  }, [profile?.bunny_video_status, refetch]);

  // Poll profile when vibe video is uploading or processing so UI updates when ready/failed
  useEffect(() => {
    const status = profile?.bunny_video_status;
    if (status !== 'uploading' && status !== 'processing') return;
    const interval = setInterval(() => refetch(), 5000);
    return () => clearInterval(interval);
  }, [profile?.bunny_video_status, refetch]);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [job, setJob] = useState('');
  const [aboutMe, setAboutMe] = useState('');
  const [lookingForEdit, setLookingForEdit] = useState('');
  const [lifestyleEdit, setLifestyleEdit] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [showPromptSheet, setShowPromptSheet] = useState(false);
  const [promptSheetMode, setPromptSheetMode] = useState<'edit' | 'add'>('edit');
  const [promptEditIndex, setPromptEditIndex] = useState<number | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showPhoneVerify, setShowPhoneVerify] = useState(false);
  const [showEmailVerify, setShowEmailVerify] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 280, useNativeDriver: true }).start();
  }, [fadeAnim]);

  useEffect(() => {
    if (profile) {
      setName(profile.name ?? '');
      setTagline(profile.tagline ?? '');
      setJob(profile.job ?? '');
      setAboutMe(profile.about_me ?? '');
      setLookingForEdit(profile.looking_for ?? '');
      setLifestyleEdit(profile.lifestyle ?? {});
    }
  }, [profile]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateMyProfile({
        name: name.trim() || undefined,
        tagline: tagline.trim() || undefined,
        job: job.trim() || undefined,
        about_me: aboutMe.trim() || undefined,
        looking_for: lookingForEdit.trim() || undefined,
        lifestyle: Object.keys(lifestyleEdit).length > 0 ? lifestyleEdit : undefined,
      });
      qc.invalidateQueries({ queryKey: ['my-profile'] });
      await refreshOnboarding();
      setEditing(false);
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handlePromptSave = async (question: string, answer: string) => {
    const current = profile?.prompts ?? [];
    const idx = promptEditIndex ?? -1;
    if (idx >= 0 && idx < current.length) {
      const next = [...current];
      next[idx] = { question, answer };
      await updateMyProfile({ prompts: next });
    }
    qc.invalidateQueries({ queryKey: ['my-profile'] });
    setShowPromptSheet(false);
    setPromptEditIndex(null);
  };

  const handlePromptAdd = async (question: string, answer: string) => {
    const current = profile?.prompts ?? [];
    const next = [...current, { question, answer }];
    await updateMyProfile({ prompts: next });
    qc.invalidateQueries({ queryKey: ['my-profile'] });
    setShowPromptSheet(false);
  };

  const handlePromptRemove = async (index: number) => {
    const current = profile?.prompts ?? [];
    const next = current.filter((_, i) => i !== index);
    await updateMyProfile({ prompts: next.length ? next : [] });
    qc.invalidateQueries({ queryKey: ['my-profile'] });
    setShowPromptSheet(false);
    setPromptEditIndex(null);
  };

  const inviteLink = `https://vibelymeet.com/auth?mode=signup&ref=${profile?.id ?? ''}`;

  const handleInviteFriends = async () => {
    try {
      if (Platform.OS !== 'web' && Share.share) {
        await Share.share({
          title: 'Join me on Vibely!',
          message: "I'm using Vibely for video dates — come find your vibe! 💜",
          url: inviteLink,
        });
      } else {
        await Linking.openURL(inviteLink);
      }
    } catch {
      await Linking.openURL(inviteLink).catch(() => {});
    }
  };

  const vibeStatus = (profile?.bunny_video_status ?? 'none') as string;

  const handleVibeVideoPress = () => {
    if (vibeStatus === 'uploading' || vibeStatus === 'processing') return;
    (router as { push: (p: string) => void }).push('/vibe-video-record');
  };

  const handleDeleteVibeVideo = () => {
    Alert.alert(
      'Delete vibe video?',
      'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteVibeVideo();
              qc.invalidateQueries({ queryKey: ['my-profile'] });
            } catch {
              Alert.alert('Error', 'Could not delete. Try again.');
            }
          },
        },
      ]
    );
  };

  const handlePreviewProfile = () => setShowPreviewModal(true);

  const handleSchedulePress = () => {
    Alert.alert(
      'My Vibe Schedule',
      'Set when you\'re open for dates on vibelymeet.com. Schedule management is on web for now.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open schedule on web', onPress: () => Linking.openURL('https://vibelymeet.com/schedule').catch(() => {}) },
      ]
    );
  };

  const handleAddPhoto = async () => {
    setPhotoError(null);
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow access to your photos to add a profile photo.');
      return;
    }
    const pickerOptions: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
      ...(Platform.OS === 'ios' && {
        presentationStyle: ImagePicker.UIImagePickerPresentationStyle.FULL_SCREEN,
      }),
    };
    const result = await ImagePicker.launchImageLibraryAsync(pickerOptions);
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    if (!asset.uri?.trim()) {
      Alert.alert('Could not use photo', 'The selected image could not be loaded. Try another.');
      return;
    }
    const currentCount = profile?.photos?.length ?? 0;
    if (currentCount >= MAX_PHOTOS) {
      Alert.alert('Maximum photos', `You can have up to ${MAX_PHOTOS} photos. Remove one in Manage to add another.`);
      return;
    }
    setPhotoUploading(true);
    try {
        const path = await uploadProfilePhoto({
          uri: asset.uri,
          mimeType: asset.mimeType ?? 'image/jpeg',
          fileName: asset.fileName ?? undefined,
        });
          const currentPhotos = profile?.photos ?? [];
        // Prepend so new upload becomes main (hero + grid); web sets avatar to first photo
        const newPhotos = [path, ...currentPhotos];
        const primaryUrl = newPhotos[0] ?? null;
        // Update cache immediately so UI shows new photo without waiting for refetch
        qc.setQueryData(['my-profile'], (old: ProfileRow | undefined) =>
          old ? { ...old, photos: newPhotos, avatar_url: primaryUrl } : old
        );
        setLastAddedPhotoIndex(0);
        await updateMyProfile({ photos: newPhotos, avatar_url: primaryUrl });
        qc.invalidateQueries({ queryKey: ['my-profile'] });
        refetch().catch(() => {});
        refreshOnboarding().catch(() => {});
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Upload failed';
        setPhotoError(msg);
        Alert.alert('Upload failed', msg);
      } finally {
        setPhotoUploading(false);
      }
  };

  const openManageSheet = () => {
    setEditingPhotos(profile?.photos?.slice() ?? []);
    setShowManageSheet(true);
  };

  const addPhotoInSheet = async () => {
    if (editingPhotos.length >= MAX_PHOTOS) return;
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow access to your photos to add a profile photo.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
        ...(Platform.OS === 'ios' && { presentationStyle: ImagePicker.UIImagePickerPresentationStyle.FULL_SCREEN }),
      });
      if (result.canceled || !result.assets?.[0]?.uri?.trim()) return;
      const asset = result.assets[0];
      setManageSaving(true);
      const path = await uploadProfilePhoto({
        uri: asset.uri,
        mimeType: asset.mimeType ?? 'image/jpeg',
        fileName: asset.fileName ?? undefined,
      });
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setEditingPhotos((prev) => [path, ...prev]);
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setManageSaving(false);
    }
  };

  const removeInSheet = (index: number) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setEditingPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const moveToMainInSheet = (index: number) => {
    if (index === 0) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setEditingPhotos((prev) => {
      const next = [...prev];
      const [photo] = next.splice(index, 1);
      next.unshift(photo);
      return next;
    });
  };

  const moveUpInSheet = (index: number) => {
    if (index <= 0) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setEditingPhotos((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  };

  const moveDownInSheet = (index: number) => {
    if (index >= editingPhotos.length - 1) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setEditingPhotos((prev) => {
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  };

  const saveManageSheet = async () => {
    if (editingPhotos.length === 0) {
      Alert.alert('At least one photo', 'Keep or add at least one photo.');
      return;
    }
    setManageSaving(true);
    try {
      const primaryUrl = editingPhotos[0] ?? null;
      qc.setQueryData(['my-profile'], (old: ProfileRow | undefined) =>
        old ? { ...old, photos: editingPhotos, avatar_url: primaryUrl } : old
      );
      await updateMyProfile({ photos: editingPhotos, avatar_url: primaryUrl });
      qc.invalidateQueries({ queryKey: ['my-profile'] });
      refetch().catch(() => {});
      setShowManageSheet(false);
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : 'Could not save photos.');
    } finally {
      setManageSaving(false);
    }
  };

  // Placeholder vibe score from profile completeness (mirrors web intent; no shared calc on mobile)
  const vibeScore =
    profile?.name && profile?.about_me && profile?.tagline && (profile?.photos?.length ?? 0) > 0
      ? 70
      : profile?.name
        ? 40
        : 0;

  if (isLoading && !profile) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <LoadingState title="Loading profile…" message="Just a sec…" />
      </View>
    );
  }

  if (isError && !profile) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background, flex: 1 }]}>
        <ErrorState
          message={error instanceof Error ? error.message : "We couldn't load your profile."}
          onActionPress={() => refetch()}
        />
      </View>
    );
  }

  // Match web ProfilePhoto: primary is first photo, avatar_url fallback
  const photoUrl = profile?.photos?.[0] ?? profile?.avatar_url ?? null;
  const displayUrl = photoUrl ? avatarUrl(photoUrl, 'profile_photo') : null;
  const eventsCount = profile?.events_attended ?? 0;
  const matchesCount = profile?.total_matches ?? 0;
  const convosCount = profile?.total_conversations ?? 0;
  const lookingForLabel = profile?.looking_for
    ? LOOKING_FOR_LABELS[profile.looking_for] ?? profile.looking_for
    : null;

  const profilePhotos = profile?.photos ?? [];
  const photoViewerPhotos = profilePhotos.length > 0 ? profilePhotos : [];

  return (
    <>
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={{ paddingBottom: layout.scrollContentPaddingBottomTab }}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching && !isLoading}
          onRefresh={() => refetch()}
          tintColor={theme.tint}
        />
      }
    >
      {/* Hero — web parity: gradient strip (GradientSurface), glass buttons */}
      <View style={[styles.heroOuter, { paddingTop: insets.top }]}>
        <GradientSurface variant="primary" style={styles.heroGradient}>
          <View style={styles.heroButtons}>
            <Pressable
              style={[styles.heroButton, styles.heroButtonGlass, { borderColor: theme.glassBorder }]}
              onPress={handlePreviewProfile}
              accessibilityLabel="Preview profile"
            >
              <Ionicons name="eye-outline" size={24} color={theme.text} />
            </Pressable>
            <Pressable
              style={[styles.heroButton, styles.heroButtonGlassRight, { borderColor: theme.glassBorder }]}
              onPress={() => router.push('/settings')}
              accessibilityLabel="Settings"
            >
              <Ionicons name="settings-outline" size={24} color={theme.text} />
            </Pressable>
          </View>
        </GradientSurface>
      </View>

      {/* Verification badges row — phone, email, photo; native flows for phone/email */}
      <View style={[styles.verificationBadgesWrap, { paddingHorizontal: spacing.lg }]}>
        <VerificationBadgesRow
          phoneVerified={profile?.phone_verified}
          emailVerified={profile?.email_verified}
          photoVerified={profile?.photo_verified}
          onVerifyPhone={() => setShowPhoneVerify(true)}
          onVerifyEmail={() => setShowEmailVerify(true)}
        />
      </View>

      {/* Centered primary photo — web parity: rounded-2xl, border-4 background, shadow; VerificationBadge when verified */}
      <View style={styles.avatarWrap}>
        <View style={[styles.heroPhotoContainer, { borderColor: theme.background }, shadows.card]}>
          {profile?.photo_verified && (
            <View style={[styles.verificationBadgeOnPhoto, { backgroundColor: theme.neonCyan }]}>
              <Ionicons name="shield-checkmark" size={14} color="#fff" />
            </View>
          )}
          {displayUrl ? (
            <Image source={{ uri: displayUrl }} style={styles.heroPhotoImage} />
          ) : (
            <View style={[styles.heroPhotoFallback, { backgroundColor: theme.surfaceSubtle }]}>
              <Text style={[styles.heroPhotoInitials, { color: theme.textSecondary }]}>
                {profile?.name?.[0] ?? 'V'}
              </Text>
            </View>
          )}
          <Pressable
            style={[styles.videoBtn, { backgroundColor: theme.surface }]}
            onPress={handleVibeVideoPress}
            disabled={vibeStatus === 'uploading' || vibeStatus === 'processing'}
            accessibilityLabel="Vibe video"
          >
            <Ionicons name="videocam-outline" size={18} color={theme.text} />
          </Pressable>
          <Pressable
            style={[styles.cameraBtn, { backgroundColor: theme.tint }]}
            onPress={handleAddPhoto}
            disabled={photoUploading}
            accessibilityLabel="Add or change photo"
          >
            {photoUploading ? (
              <Ionicons name="hourglass-outline" size={20} color="#fff" />
            ) : (
              <Ionicons name="camera" size={20} color="#fff" />
            )}
          </Pressable>
        </View>
      </View>

      <Animated.View style={[styles.main, { opacity: fadeAnim }]}>
        {/* Identity block: name / age, Premium chip, zodiac (web parity) */}
        <View style={styles.identityBlock}>
          <View style={styles.identityNameRow}>
            <Text style={[styles.nameAge, { color: theme.text }]} numberOfLines={1}>
              {profile?.name || 'Your name'}, {profile?.age ?? '—'}
            </Text>
            {profile?.is_premium && (
              <View style={[styles.premiumChip, { backgroundColor: theme.tint }]}>
                <Ionicons name="sparkles" size={12} color="#fff" />
                <Text style={styles.premiumChipText}>Premium</Text>
              </View>
            )}
            {profile?.birth_date && (
              <Text style={styles.zodiacEmoji} accessibilityLabel={getZodiacSign(new Date(profile.birth_date))}>
                {getZodiacEmoji(getZodiacSign(new Date(profile.birth_date)))}
              </Text>
            )}
          </View>
          {profile?.tagline ? (
            <Text style={[styles.taglineText, { color: theme.tint }]} numberOfLines={2}>
              "{profile.tagline}"
            </Text>
          ) : (
            <Text style={[styles.taglinePlaceholder, { color: theme.textSecondary }]}>
              Add tagline
            </Text>
          )}
          <View style={styles.locationRow}>
            <Ionicons name="location-outline" size={14} color={theme.textSecondary} />
            <Text style={[styles.locationText, { color: theme.textSecondary }]}>
              {profile?.location || 'Location not set'}
            </Text>
          </View>
        </View>

        {/* Vibe Score card — web parity glass-card */}
        <Card variant="glass" style={styles.vibeScoreCard}>
          <View style={styles.vibeScoreRow}>
            <VibeScoreDisplay score={vibeScore} size={100} theme={theme} />
            <View style={styles.vibeScoreCopy}>
              <Text style={[styles.vibeScoreTitle, { color: theme.text }]}>
                Your Vibe Score
              </Text>
              <Text style={[styles.vibeScoreDesc, { color: theme.textSecondary }]}>
                {vibeScore < 100
                  ? 'Complete your profile to stand out from the crowd.'
                  : "You're at peak vibe. Time to make some connections."}
              </Text>
              <View style={styles.vibeScoreActions}>
                {vibeScore < 100 && (
                  <VibelyButton
                    label="Complete Profile"
                    onPress={() => setEditing(true)}
                    variant="primary"
                    style={styles.completeProfileBtn}
                  />
                )}
              </View>
            </View>
          </View>
        </Card>

        {/* My Vibe Schedule — web parity glass-card */}
        <Card variant="glass">
          <SettingsRow
            icon={<Ionicons name="calendar-outline" size={20} color={theme.neonCyan} />}
            title="My Vibe Schedule"
            subtitle="Manage on web"
            onPress={handleSchedulePress}
          />
        </Card>

        {/* Stats row — web parity glass-card p-3 per cell */}
        <View style={styles.statsRow}>
          {[
            { label: 'Events', value: eventsCount, icon: 'sparkles-outline' as const },
            { label: 'Matches', value: matchesCount, icon: 'heart-outline' as const },
            { label: 'Convos', value: convosCount, icon: 'flash-outline' as const },
          ].map((stat) => (
            <View key={stat.label} style={[styles.statCard, { backgroundColor: theme.surfaceSubtle, borderColor: theme.glassBorder }]}>
              <Ionicons name={stat.icon} size={16} color={theme.tint} style={styles.statIcon} />
              <Text style={[styles.statValue, { color: theme.tint }]}>{stat.value}</Text>
              <Text style={[styles.statLabel, { color: theme.textSecondary }]}>{stat.label}</Text>
            </View>
          ))}
        </View>

        {/* Looking For — web parity glass-card, Chip for value */}
        <Card variant="glass">
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="flag-outline" size={18} color={theme.tint} style={styles.sectionIcon} />
              <VibelyText variant="titleSM" style={{ color: theme.text }}>Looking For</VibelyText>
            </View>
            <Pressable onPress={() => setEditing(true)} style={({ pressed }) => [styles.sectionEditLink, pressed && { opacity: 0.8 }]}>
              <Text style={[styles.sectionEditLinkText, { color: theme.tint }]}>Edit</Text>
              <Ionicons name="chevron-forward" size={16} color={theme.tint} />
            </Pressable>
          </View>
          {lookingForLabel ? (
            <View style={styles.chipWrap}>
              <Chip label={lookingForLabel} variant="secondary" />
            </View>
          ) : (
            <Text style={[styles.helperText, { color: theme.textSecondary }]}>
              Be upfront. It saves everyone time.
            </Text>
          )}
        </Card>

        {/* About Me — web parity glass-card */}
        <Card variant="glass">
          <View style={styles.sectionHeaderRow}>
            <VibelyText variant="titleSM" style={{ color: theme.text }}>About Me</VibelyText>
            <Pressable onPress={() => setEditing(true)} style={({ pressed }) => [styles.sectionEditLink, pressed && { opacity: 0.8 }]}>
              <Text style={[styles.sectionEditLinkText, { color: theme.tint }]}>Edit</Text>
              <Ionicons name="chevron-forward" size={16} color={theme.tint} />
            </Pressable>
          </View>
          <Text style={[styles.aboutText, { color: theme.textSecondary }]}>
            {profile?.about_me || 'Write something that makes them swipe right...'}
          </Text>
        </Card>

        {/* Conversation Starters — web parity: list when data exists, else empty card */}
        <View style={styles.sectionHeaderStandalone}>
          <Ionicons name="chatbubble-ellipses-outline" size={18} color={theme.tint} style={styles.sectionIcon} />
          <VibelyText variant="titleSM" style={{ color: theme.text }}>Conversation Starters</VibelyText>
        </View>
        {profile?.prompts && profile.prompts.length > 0 ? (
          <Card variant="glass">
            {profile.prompts.filter((p) => p.question?.trim() || p.answer?.trim()).map((p, i) => (
              <Pressable
                key={i}
                onPress={() => { setPromptEditIndex(i); setPromptSheetMode('edit'); setShowPromptSheet(true); }}
                style={[styles.promptRow, i > 0 && { borderTopWidth: 1, borderTopColor: theme.border }]}
              >
                <View style={styles.promptRowContent}>
                  <Text style={styles.promptEmojiSmall}>{PROMPT_EMOJIS[p.question] ?? '💭'}</Text>
                  <View style={styles.promptRowText}>
                    <Text style={[styles.promptQuestion, { color: theme.textSecondary }]}>{p.question || 'Prompt'}</Text>
                    <Text style={[styles.promptAnswer, { color: theme.text }]}>{p.answer || 'Tap to add your answer...'}</Text>
                  </View>
                  <Ionicons name="pencil" size={16} color={theme.tint} />
                </View>
              </Pressable>
            ))}
            <Pressable onPress={() => { setPromptSheetMode('add'); setPromptEditIndex(null); setShowPromptSheet(true); }} style={({ pressed }) => [styles.addPromptBtn, { borderColor: theme.border }, pressed && { opacity: 0.8 }]}>
              <Ionicons name="add-circle-outline" size={20} color={theme.tint} />
              <Text style={[styles.addPromptLabel, { color: theme.tint }]}>Add prompt</Text>
            </Pressable>
          </Card>
        ) : (
          <Pressable onPress={() => { setPromptSheetMode('add'); setPromptEditIndex(null); setShowPromptSheet(true); }} style={({ pressed }) => [styles.promptsEmptyCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }, pressed && { opacity: 0.92 }]}>
            <View style={styles.promptsEmptyInner}>
              <View style={[styles.promptsEmptyIcon, { backgroundColor: theme.tintSoft }]}>
                <Ionicons name="chatbubble-ellipses-outline" size={24} color={theme.tint} />
              </View>
              <Text style={[styles.promptsEmptyTitle, { color: theme.text }]}>
                Add your first Conversation Starter
              </Text>
              <Text style={[styles.promptsEmptySub, { color: theme.textSecondary }]}>
                Give matches something fun to respond to
              </Text>
            </View>
          </Pressable>
        )}

        {/* Lifestyle — web parity: display only when has values */}
        {(profile?.lifestyle && Object.keys(profile.lifestyle).length > 0) ? (
          <Card variant="glass">
            <View style={styles.sectionHeaderRow}>
              <VibelyText variant="titleSM" style={{ color: theme.text }}>Lifestyle</VibelyText>
              <Pressable onPress={() => setEditing(true)} style={({ pressed }) => [styles.sectionEditLink, pressed && { opacity: 0.8 }]}>
                <Text style={[styles.sectionEditLinkText, { color: theme.tint }]}>Edit</Text>
                <Ionicons name="chevron-forward" size={16} color={theme.tint} />
              </Pressable>
            </View>
            <LifestyleDetailsSection values={profile.lifestyle} editable={false} />
          </Card>
        ) : null}

        {/* My Vibes — web parity: chips when data exists, else placeholder */}
        <Card variant="glass">
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="sparkles-outline" size={18} color={theme.tint} style={styles.sectionIcon} />
              <VibelyText variant="titleSM" style={{ color: theme.text }}>My Vibes</VibelyText>
            </View>
            <Pressable onPress={() => setEditing(true)} style={({ pressed }) => [styles.sectionEditLink, pressed && { opacity: 0.8 }]}>
              <Text style={[styles.sectionEditLinkText, { color: theme.tint }]}>Edit</Text>
              <Ionicons name="chevron-forward" size={16} color={theme.tint} />
            </Pressable>
          </View>
          {profile?.vibes && profile.vibes.length > 0 ? (
            <View style={styles.chipWrap}>
              {profile.vibes.map((v) => (
                <Chip key={v} label={v} variant="secondary" />
              ))}
            </View>
          ) : (
            <Text style={[styles.helperText, { color: theme.textSecondary }]}>
              No vibes yet. Add some personality!
            </Text>
          )}
        </Card>

        {/* Vibe Video — web parity: 16:9 card with thumbnail, play overlay, caption */}
        <View style={styles.sectionHeaderStandalone}>
          <Ionicons name="videocam-outline" size={18} color={theme.tint} style={styles.sectionIcon} />
          <VibelyText variant="titleSM" style={{ color: theme.text }}>Vibe Video</VibelyText>
        </View>
        <View style={[styles.vibeVideoCard16x9, { backgroundColor: theme.surfaceSubtle, borderColor: theme.glassBorder }]}>
          {vibeStatus === 'uploading' && (
            <View style={styles.vibeVideoCardInner}>
              <Ionicons name="cloud-upload-outline" size={48} color={theme.textSecondary} style={{ opacity: 0.6 }} />
              <Text style={[styles.vibeVideoCopy, { color: theme.textSecondary }]}>Uploading…</Text>
            </View>
          )}
          {vibeStatus === 'processing' && (
            <View style={styles.vibeVideoCardInner}>
              <Ionicons name="sync-outline" size={48} color={theme.textSecondary} style={{ opacity: 0.6 }} />
              <Text style={[styles.vibeVideoCopy, { color: theme.textSecondary }]}>Processing your video…</Text>
            </View>
          )}
          {vibeStatus === 'ready' && (() => {
            const playbackUrl = getVibeVideoPlaybackUrl(profile?.bunny_video_uid);
            const thumbnailUrl = getVibeVideoThumbnailUrl(profile?.bunny_video_uid);
            const caption = profile?.vibe_caption?.trim() ?? '';
            return (
              <>
                {thumbnailUrl ? (
                  <Image source={{ uri: thumbnailUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                ) : (
                  <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.surface }]} />
                )}
                <View style={styles.vibeVideoPlayOverlay} pointerEvents="box-none">
                  <Pressable onPress={() => playbackUrl && setShowVibeVideoFullscreen(true)} style={styles.vibeVideoPlayBtn}>
                    <Ionicons name="play" size={32} color="#fff" />
                  </Pressable>
                </View>
                {caption ? (
                  <View style={styles.vibeVideoCaptionStrip}>
                    <Text style={styles.vibeVideoCaptionLabel}>Vibing on</Text>
                    <Text style={styles.vibeVideoCaptionText} numberOfLines={2}>{caption}</Text>
                  </View>
                ) : (
                  <View style={styles.vibeVideoCaptionStrip}>
                    <Text style={[styles.vibeVideoCaptionText, { opacity: 0.7 }]}>Tap to play</Text>
                  </View>
                )}
                <View style={styles.vibeVideoActionsRow}>
                  <VibelyButton label="Record new" onPress={handleVibeVideoPress} variant="secondary" size="sm" />
                  <Pressable onPress={handleDeleteVibeVideo}>
                    <Text style={{ color: theme.danger, fontSize: 14 }}>Delete video</Text>
                  </Pressable>
                </View>
              </>
            );
          })()}
          {vibeStatus === 'failed' && (
            <View style={styles.vibeVideoCardInner}>
              <Ionicons name="alert-circle-outline" size={48} color={theme.danger} style={{ opacity: 0.8 }} />
              <Text style={[styles.vibeVideoCopy, { color: theme.textSecondary }]}>Processing failed. Try recording again.</Text>
              <VibelyButton label="Record again" onPress={handleVibeVideoPress} variant="secondary" style={{ marginTop: spacing.sm }} />
            </View>
          )}
          {(vibeStatus === 'none' || !vibeStatus) && (
            <View style={styles.vibeVideoCardInner}>
              <Ionicons name="videocam-outline" size={48} color={theme.textSecondary} style={{ opacity: 0.3 }} />
              <Text style={[styles.vibeVideoCopy, { color: theme.textSecondary }]}>
                Record a 15-second video intro to stand out
              </Text>
              <VibelyButton label="Record My Vibe" onPress={handleVibeVideoPress} variant="secondary" style={{ marginTop: spacing.sm }} />
            </View>
          )}
        </View>

        {/* Photos — web parity: glass-card, Camera + title, Manage + chevron */}
        <Card variant="glass" style={styles.galleryCard}>
          <View style={styles.photoSectionHeader}>
            <View style={styles.photoSectionTitleRow}>
              <Ionicons name="camera-outline" size={18} color={theme.tint} style={styles.photoSectionIcon} />
              <VibelyText variant="titleSM" style={{ color: theme.text }}>Photos</VibelyText>
            </View>
            <Pressable
              onPress={profile?.photos && profile.photos.length > 0 ? openManageSheet : handleAddPhoto}
              disabled={photoUploading}
              style={({ pressed }) => [styles.photoManageLink, pressed && { opacity: 0.8 }]}
              accessibilityLabel={profile?.photos?.length ? 'Manage photos' : 'Add photo'}
            >
              <Text style={[styles.photoManageLinkText, { color: theme.tint }]}>
                {photoUploading ? 'Uploading…' : (profile?.photos && profile.photos.length > 0 ? 'Manage' : 'Add photo')}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={theme.tint} />
            </Pressable>
          </View>
          {photoError ? (
            <Text style={[styles.placeholder, { color: theme.danger, marginBottom: spacing.sm }]}>
              {photoError}
            </Text>
          ) : null}
          {profile?.photos && profile.photos.length > 0 ? (
            <View
              style={{ width: '100%' }}
              onLayout={(e) => setPhotoGridWidth(e.nativeEvent.layout.width)}
            >
              <View style={[styles.photoGrid, { gap: photoGridGap }]}>
                {profile.photos.slice(0, MAX_PHOTOS).map((url, i) => {
                const isMain = i === 0;
                const isJustAdded = i === lastAddedPhotoIndex;
                const tile = (
                  <Pressable
                    key={`${url}-${i}`}
                    style={({ pressed }) => [
                      styles.photoGridTile,
                      isMain ? [styles.photoGridTileMain, { width: photoMainSize, height: photoMainHeight }, shadows.card] : { width: photoCellSize, height: photoCellSize },
                      { backgroundColor: theme.surfaceSubtle },
                      pressed && { opacity: 0.92 },
                    ]}
                    onPress={() => {
                      setPhotoViewerIndex(i);
                      setGalleryCurrentIndex(i);
                      setShowPhotoViewer(true);
                    }}
                  >
                    <Image source={{ uri: avatarUrl(url) }} style={styles.photoGridImg} />
                    {isMain && (
                      <View style={[styles.photoMainBadge, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
                        <Ionicons name="sparkles" size={10} color="rgba(255,255,255,0.95)" />
                        <Text style={styles.photoMainBadgeText}>Main</Text>
                      </View>
                    )}
                  </Pressable>
                );
                return isJustAdded ? (
                  <Animated.View key={`${url}-${i}`} style={{ opacity: newPhotoAnim, transform: [{ scale: newPhotoAnim }] }}>
                    {tile}
                  </Animated.View>
                ) : (
                  tile
                );
              })}
              </View>
            </View>
          ) : (
            <Pressable onPress={handleAddPhoto} disabled={photoUploading} style={({ pressed }) => [styles.photoEmpty, { borderColor: theme.border }, pressed && { opacity: 0.9 }]}>
              <Ionicons name="add" size={36} color={theme.textSecondary} style={{ opacity: 0.7 }} />
              <Text style={[styles.photoEmptyLabel, { color: theme.textSecondary }]}>
                Add your first photo
              </Text>
            </Pressable>
          )}
        </Card>

        {/* The Basics — web parity glass-card, rounded-xl rows */}
        <Card variant="glass">
          <View style={styles.sectionHeaderRow}>
            <VibelyText variant="titleSM" style={{ color: theme.text }}>The Basics</VibelyText>
            <Pressable onPress={() => setEditing(true)} style={({ pressed }) => [styles.sectionEditLink, pressed && { opacity: 0.8 }]}>
              <Text style={[styles.sectionEditLinkText, { color: theme.tint }]}>Edit</Text>
              <Ionicons name="chevron-forward" size={16} color={theme.tint} />
            </Pressable>
          </View>
          <View style={styles.basicsGrid}>
            {(
              [
                { icon: 'calendar-outline' as const, label: 'Birthday', value: profile?.birth_date ? new Date(profile.birth_date).toLocaleDateString() : 'Not set' },
                { icon: 'briefcase-outline' as const, label: 'Work', value: profile?.job || 'Not set' },
                { icon: 'resize-outline' as const, label: 'Height', value: profile?.height_cm ? `${profile.height_cm} cm` : 'Not set' },
                { icon: 'location-outline' as const, label: 'Location', value: profile?.location || 'Not set' },
              ] as const
            ).map((item) => (
              <View key={item.label} style={[styles.basicRow, { backgroundColor: theme.surface }]}>
                <Ionicons name={item.icon} size={16} color={theme.textSecondary} />
                <View style={styles.basicRowText}>
                  <Text style={[styles.basicLabel, { color: theme.textSecondary }]}>{item.label}</Text>
                  <Text style={[styles.basicValue, { color: theme.text }]} numberOfLines={1}>{item.value}</Text>
                </View>
              </View>
            ))}
          </View>
        </Card>

        {/* Lifestyle — web parity: key-value rows when data exists */}
        <Card variant="glass">
          <View style={styles.sectionHeaderRow}>
            <VibelyText variant="titleSM" style={{ color: theme.text }}>Lifestyle</VibelyText>
            <Pressable onPress={() => setEditing(true)} style={({ pressed }) => [styles.sectionEditLink, pressed && { opacity: 0.8 }]}>
              <Text style={[styles.sectionEditLinkText, { color: theme.tint }]}>Edit</Text>
              <Ionicons name="chevron-forward" size={16} color={theme.tint} />
            </Pressable>
          </View>
          {profile?.lifestyle && Object.keys(profile.lifestyle).length > 0 ? (
            <View style={styles.basicsGrid}>
              {Object.entries(profile.lifestyle)
                .filter(([, v]) => v != null && String(v).trim() !== '')
                .map(([key, value]) => (
                  <View key={key} style={[styles.basicRow, { backgroundColor: theme.surface }]}>
                    <View style={styles.basicRowText}>
                      <Text style={[styles.basicLabel, { color: theme.textSecondary }]}>{key.replace(/_/g, ' ')}</Text>
                      <Text style={[styles.basicValue, { color: theme.text }]} numberOfLines={1}>{String(value)}</Text>
                    </View>
                  </View>
                ))}
            </View>
          ) : (
            <Text style={[styles.helperText, { color: theme.textSecondary }]}>
              Help find someone compatible with your lifestyle.
            </Text>
          )}
        </Card>

        {/* Verification — web parity: step list reflecting actual state (photo_verified, phone_verified) */}
        <Card variant="glass">
          <View style={styles.verificationHeader}>
            <Ionicons name="shield-checkmark-outline" size={20} color={theme.neonCyan} />
            <VibelyText variant="titleSM" style={{ color: theme.text }}>Verification</VibelyText>
          </View>
          <Text style={[styles.verificationSubline, { color: theme.textSecondary }]}>
            Get a verified badge and stand out
          </Text>
          <View style={styles.verificationSteps}>
            {profile?.email_verified ? (
              <View style={[styles.verificationStepRow, { borderBottomWidth: 1, borderBottomColor: theme.border }]}>
                <Ionicons name="mail-outline" size={18} color={theme.neonCyan} />
                <View style={styles.verificationStepContent}>
                  <Text style={[styles.verificationStepLabel, { color: theme.text }]}>Email</Text>
                  <Text style={[styles.verificationStepDesc, { color: theme.textSecondary }]}>Verified</Text>
                </View>
                <Ionicons name="checkmark-circle" size={20} color={theme.neonCyan} />
              </View>
            ) : (
              <Pressable onPress={() => setShowEmailVerify(true)} style={({ pressed }) => [styles.verificationStepRow, { borderBottomWidth: 1, borderBottomColor: theme.border }, pressed && { opacity: 0.8 }]}>
                <Ionicons name="mail-outline" size={18} color={theme.textSecondary} />
                <View style={styles.verificationStepContent}>
                  <Text style={[styles.verificationStepLabel, { color: theme.text }]}>Email</Text>
                  <Text style={[styles.verificationStepDesc, { color: theme.tint }]}>Verify</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.tint} />
              </Pressable>
            )}
            {profile?.photo_verified ? (
              <View style={[styles.verificationStepRow, { borderBottomWidth: 1, borderBottomColor: theme.border }]}>
                <Ionicons name="camera-outline" size={18} color={theme.neonCyan} />
                <View style={styles.verificationStepContent}>
                  <Text style={[styles.verificationStepLabel, { color: theme.text }]}>Photo verification</Text>
                  <Text style={[styles.verificationStepDesc, { color: theme.textSecondary }]}>Verified</Text>
                </View>
                <Ionicons name="checkmark-circle" size={20} color={theme.neonCyan} />
              </View>
            ) : (
              <Pressable onPress={() => Linking.openURL('https://vibelymeet.com/profile').catch(() => {})} style={({ pressed }) => [styles.verificationStepRow, { borderBottomWidth: 1, borderBottomColor: theme.border }, pressed && { opacity: 0.8 }]}>
                <Ionicons name="camera-outline" size={18} color={theme.textSecondary} />
                <View style={styles.verificationStepContent}>
                  <Text style={[styles.verificationStepLabel, { color: theme.text }]}>Photo verification</Text>
                  <Text style={[styles.verificationStepDesc, { color: theme.tint }]}>Verify on web</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.tint} />
              </Pressable>
            )}
            {profile?.phone_verified ? (
              <View style={[styles.verificationStepRow, styles.verificationStepRowLast, { borderBottomColor: theme.border }]}>
                <Ionicons name="call-outline" size={18} color={theme.neonCyan} />
                <View style={styles.verificationStepContent}>
                  <Text style={[styles.verificationStepLabel, { color: theme.text }]}>Phone number</Text>
                  <Text style={[styles.verificationStepDesc, { color: theme.textSecondary }]}>Verified</Text>
                </View>
                <Ionicons name="checkmark-circle" size={20} color={theme.neonCyan} />
              </View>
            ) : (
              <Pressable onPress={() => setShowPhoneVerify(true)} style={({ pressed }) => [styles.verificationStepRow, styles.verificationStepRowLast, { borderBottomColor: theme.border }, pressed && { opacity: 0.8 }]}>
                <Ionicons name="call-outline" size={18} color={theme.textSecondary} />
                <View style={styles.verificationStepContent}>
                  <Text style={[styles.verificationStepLabel, { color: theme.text }]}>Phone number</Text>
                  <Text style={[styles.verificationStepDesc, { color: theme.tint }]}>Verify</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.tint} />
              </Pressable>
            )}
          </View>
        </Card>

        {/* Invite Friends — web parity glass-card */}
        <Card variant="glass">
          <SettingsRow
            icon={<Text style={styles.inviteEmoji}>💌</Text>}
            title="Invite Friends"
            subtitle="Share Vibely with your friends"
            onPress={handleInviteFriends}
          />
        </Card>

        {/* Logout */}
        <DestructiveRow
          icon={<Ionicons name="log-out-outline" size={18} color={theme.danger} />}
          label="Log Out"
          onPress={() => signOut()}
        />

        {/* Edit mode inline — same order as web edit drawers */}
        {editing && (
          <View style={styles.editSection}>
            <SectionHeader title="Edit details" />
            <Card>
            <Text style={[styles.label, { color: theme.text }]}>Name</Text>
            <VibelyInput
              value={name}
              onChangeText={setName}
              editable={!saving}
              placeholder="Your name"
              containerStyle={styles.input}
            />
            <Text style={[styles.label, { color: theme.text }]}>Tagline</Text>
            <VibelyInput
              value={tagline}
              onChangeText={setTagline}
              editable={!saving}
              placeholder="e.g., Living my best life ✨"
              containerStyle={styles.input}
            />
            <Text style={[styles.label, { color: theme.text }]}>Job</Text>
            <VibelyInput
              value={job}
              onChangeText={setJob}
              editable={!saving}
              placeholder="What do you do?"
              containerStyle={styles.input}
            />
            <Text style={[styles.label, { color: theme.text }]}>About you</Text>
            <VibelyInput
              value={aboutMe}
              onChangeText={setAboutMe}
              multiline
              numberOfLines={4}
              editable={!saving}
              placeholder="Write something that makes them want to know more..."
              containerStyle={styles.input}
            />
            <Text style={[styles.label, { color: theme.text }]}>Relationship intent</Text>
            <RelationshipIntentSelector selected={lookingForEdit} onSelect={setLookingForEdit} editable />
            <Text style={[styles.label, { color: theme.text }]}>Lifestyle</Text>
            <LifestyleDetailsSection values={lifestyleEdit} onChange={(key, value) => setLifestyleEdit((prev) => ({ ...prev, [key]: value }))} editable />
            <VibelyButton
              label={saving ? 'Saving…' : 'Save changes'}
              onPress={handleSave}
              loading={saving}
              disabled={saving}
              style={styles.primaryCta}
            />
            <VibelyButton
              label="Cancel"
              onPress={() => setEditing(false)}
              variant="ghost"
            />
          </Card>
        </View>
        )}
      </Animated.View>
    </ScrollView>

    {/* Fullscreen gallery — premium feel: fade-in, clean chrome, thumb strip */}
    <Modal
      visible={showPhotoViewer}
      transparent
      animationType="fade"
      onRequestClose={() => setShowPhotoViewer(false)}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.96)', opacity: galleryBackdropOpacity }]}>
        <RNView style={[styles.galleryChrome, { paddingTop: insets.top + 12, paddingHorizontal: spacing.lg }]}>
          <Text style={styles.galleryCounter}>
            {photoViewerPhotos.length > 0 ? `${galleryCurrentIndex + 1} / ${photoViewerPhotos.length}` : ''}
          </Text>
          <Pressable onPress={() => setShowPhotoViewer(false)} style={({ pressed }) => [styles.galleryCloseBtn, pressed && { opacity: 0.8 }]}>
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>
        </RNView>

        {/* Pager: horizontal FlatList */}
        <RNView style={styles.galleryPager}>
          {photoViewerPhotos.length === 0 ? null : photoViewerPhotos.length === 1 ? (
            <Image
              source={{ uri: getImageUrl(photoViewerPhotos[0], { width: 800, quality: 90 }) }}
              style={styles.galleryImage}
              resizeMode="contain"
            />
          ) : (
            <FlatList
              ref={galleryFlatListRef}
              data={photoViewerPhotos}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              initialScrollIndex={Math.min(photoViewerIndex, Math.max(0, photoViewerPhotos.length - 1))}
              initialNumToRender={photoViewerPhotos.length}
              getItemLayout={(_: unknown, index: number) => ({
                length: Dimensions.get('window').width,
                offset: Dimensions.get('window').width * index,
                index,
              })}
              keyExtractor={(_, i) => String(i)}
              onMomentumScrollEnd={(e) => {
                const idx = Math.round(e.nativeEvent.contentOffset.x / Dimensions.get('window').width);
                setGalleryCurrentIndex(Math.min(Math.max(0, idx), photoViewerPhotos.length - 1));
              }}
              onScrollToIndexFailed={() => {}}
              renderItem={({ item }) => (
                <RNView style={styles.galleryPage}>
                  <Image source={{ uri: getImageUrl(item, { width: 800, quality: 90 }) }} style={styles.galleryImage} resizeMode="contain" />
                </RNView>
              )}
            />
          )}
        </RNView>

        {/* Bottom thumbnail strip — web parity */}
        {photoViewerPhotos.length > 1 && (
          <RNView style={[styles.galleryThumbStrip, { paddingBottom: insets.bottom + 20 }]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.galleryThumbStripContent}>
              {photoViewerPhotos.map((url, index) => (
                <Pressable
                  key={`thumb-${index}`}
                  style={({ pressed }) => [
                    styles.galleryThumb,
                    index === galleryCurrentIndex && styles.galleryThumbSelected,
                    index === galleryCurrentIndex && { borderColor: theme.tint },
                    pressed && { opacity: 0.9 },
                  ]}
                  onPress={() => {
                    setGalleryCurrentIndex(index);
                    galleryFlatListRef.current?.scrollToIndex({ index, animated: true });
                  }}
                >
                  <Image source={{ uri: avatarUrl(url, 'profile_photo') }} style={styles.galleryThumbImg} />
                </Pressable>
              ))}
            </ScrollView>
          </RNView>
        )}
      </Animated.View>
    </Modal>

    {/* Vibe Video fullscreen — tap play on 16:9 card; ErrorBoundary handles Bunny 403 gracefully */}
    <Modal visible={showVibeVideoFullscreen} transparent animationType="fade">
      <View style={styles.vibeVideoFullscreenBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowVibeVideoFullscreen(false)} />
        <View style={styles.vibeVideoFullscreenContent} pointerEvents="box-none">
          {getVibeVideoPlaybackUrl(profile?.bunny_video_uid) && (
            <VibeVideoPlayer
              playbackUrl={getVibeVideoPlaybackUrl(profile!.bunny_video_uid)!}
              thumbnailUrl={getVibeVideoThumbnailUrl(profile?.bunny_video_uid)}
              style={styles.vibeVideoFullscreenPlayer}
            />
          )}
          <Pressable style={styles.vibeVideoFullscreenClose} onPress={() => setShowVibeVideoFullscreen(false)}>
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
        </View>
      </View>
    </Modal>

    {/* Manage — visual media grid (web PhotoManager parity) */}
    <Modal
      visible={showManageSheet}
      transparent
      animationType="slide"
      onRequestClose={() => !manageSaving && setShowManageSheet(false)}
    >
      <Pressable style={styles.manageSheetBackdrop} onPress={() => !manageSaving && setShowManageSheet(false)}>
        <RNView style={[styles.manageSheetContent, { paddingBottom: insets.bottom + spacing.lg }]} onStartShouldSetResponder={() => true}>
          <View style={[styles.manageSheetHandle, { backgroundColor: theme.border }]} />
          <Text style={[styles.manageSheetTitle, { color: theme.text }]}>Your photos</Text>

          {(() => {
            const mgW = winWidth - spacing.lg * 2;
            const mgGap = spacing.sm;
            const mgCell = (mgW - mgGap * 2) / 3;
            const mgMain = mgCell * 2 + mgGap;
            const renderSlot = (i: number, size: number, isMain: boolean) => {
              const hasPhoto = i < editingPhotos.length;
              const url = hasPhoto ? editingPhotos[i] : null;
              if (!hasPhoto) {
                return (
                  <Pressable
                    key={`add-${i}`}
                    style={({ pressed }) => [
                      styles.manageGridAddSlot,
                      { width: size, height: size, borderColor: theme.border },
                      pressed && { opacity: 0.9 },
                    ]}
                    onPress={addPhotoInSheet}
                    disabled={manageSaving}
                  >
                    <Ionicons name="add" size={isMain ? 32 : 28} color={theme.textSecondary} />
                    <Text style={[styles.manageGridAddLabel, { color: theme.textSecondary }]}>{manageSaving ? '…' : 'Add'}</Text>
                  </Pressable>
                );
              }
              return (
                <Pressable
                  key={`photo-${i}-${url}`}
                  style={({ pressed }) => [
                    styles.manageGridTile,
                    { width: size, height: size, backgroundColor: theme.surfaceSubtle },
                    pressed && { opacity: 0.92 },
                  ]}
                >
                  <Image source={{ uri: avatarUrl(url!) }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                  <View style={styles.manageGridOverlay}>
                    {i === 0 ? (
                      <View style={[styles.manageGridMainBadge, { backgroundColor: theme.glassSurface }]}>
                        <Ionicons name="sparkles" size={10} color={theme.accent} />
                        <Text style={[styles.manageGridMainLabel, { color: theme.accent }]}>Main</Text>
                      </View>
                    ) : (
                      <View style={styles.manageGridActionsRow}>
                        <Pressable style={[styles.manageGridIconBtn, { backgroundColor: theme.glassSurface }]} onPress={() => moveToMainInSheet(i)}>
                          <Ionicons name="sparkles" size={12} color={theme.tint} />
                        </Pressable>
                        {i > 1 && (
                          <Pressable style={[styles.manageGridIconBtn, { backgroundColor: theme.glassSurface }]} onPress={() => moveUpInSheet(i)}>
                            <Ionicons name="chevron-up" size={12} color={theme.text} />
                          </Pressable>
                        )}
                        {i < editingPhotos.length - 1 && (
                          <Pressable style={[styles.manageGridIconBtn, { backgroundColor: theme.glassSurface }]} onPress={() => moveDownInSheet(i)}>
                            <Ionicons name="chevron-down" size={12} color={theme.text} />
                          </Pressable>
                        )}
                        <Pressable style={[styles.manageGridIconBtn, { backgroundColor: 'rgba(0,0,0,0.6)' }]} onPress={() => removeInSheet(i)}>
                          <Ionicons name="trash-outline" size={12} color="#fff" />
                        </Pressable>
                      </View>
                    )}
                  </View>
                </Pressable>
              );
            };
            return (
              <View style={[styles.manageGrid, { width: mgW }]}>
                <View style={styles.manageGridRow1}>
                  <View style={{ width: mgMain, height: mgMain }}>{renderSlot(0, mgMain, true)}</View>
                  <View style={[styles.manageGridRightCol, { width: mgCell + mgGap, gap: mgGap }]}>
                    {renderSlot(1, mgCell, false)}
                    {renderSlot(2, mgCell, false)}
                  </View>
                </View>
                <View style={[styles.manageGridRow2, { width: mgW, gap: mgGap, marginTop: mgGap }]}>
                  {renderSlot(3, mgCell, false)}
                  {renderSlot(4, mgCell, false)}
                  {renderSlot(5, mgCell, false)}
                </View>
              </View>
            );
          })()}

          <View style={[styles.manageSheetFooter, { marginTop: spacing.xl }]}>
            <VibelyButton label="Cancel" variant="secondary" onPress={() => setShowManageSheet(false)} disabled={manageSaving} style={{ flex: 1 }} />
            <VibelyButton label={manageSaving ? 'Saving…' : 'Save'} onPress={saveManageSheet} disabled={manageSaving || editingPhotos.length === 0} style={{ flex: 1 }} />
          </View>
        </RNView>
      </Pressable>
    </Modal>

    <PromptEditSheet
      visible={showPromptSheet}
      onClose={() => { setShowPromptSheet(false); setPromptEditIndex(null); }}
      mode={promptSheetMode}
      initialQuestion={promptEditIndex !== null && profile?.prompts?.[promptEditIndex] ? profile.prompts[promptEditIndex].question : ''}
      initialAnswer={promptEditIndex !== null && profile?.prompts?.[promptEditIndex] ? profile.prompts[promptEditIndex].answer : ''}
      onSave={handlePromptSave}
      onAdd={handlePromptAdd}
      onRemove={promptEditIndex !== null ? () => handlePromptRemove(promptEditIndex) : undefined}
      existingQuestions={(profile?.prompts ?? []).map((p) => p.question).filter(Boolean)}
    />

    <ProfilePreviewModal visible={showPreviewModal} onClose={() => setShowPreviewModal(false)} profile={profile ?? null} />

    <PhoneVerificationFlow
      visible={showPhoneVerify}
      onClose={() => setShowPhoneVerify(false)}
      onVerified={() => { qc.invalidateQueries({ queryKey: ['my-profile'] }); }}
    />
    <EmailVerificationFlow
      visible={showEmailVerify}
      email={user?.email ?? ''}
      onClose={() => setShowEmailVerify(false)}
      onVerified={() => { qc.invalidateQueries({ queryKey: ['my-profile'] }); }}
    />
    </>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroOuter: {
    paddingHorizontal: 0,
    marginBottom: 0,
  },
  heroGradient: {
    height: 140,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderBottomLeftRadius: radius['2xl'],
    borderBottomRightRadius: radius['2xl'],
    overflow: 'hidden',
  },
  heroButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heroButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  heroButtonGlass: {
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  heroButtonGlassRight: {
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  avatarWrap: {
    alignItems: 'center',
    marginTop: -56,
    marginBottom: spacing.xl + 4,
  },
  heroPhotoContainer: {
    width: 120,
    height: 120,
    borderRadius: radius['2xl'],
    overflow: 'hidden',
    borderWidth: 4,
    position: 'relative',
  },
  heroPhotoImage: {
    width: '100%',
    height: '100%',
  },
  heroPhotoFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroPhotoInitials: {
    fontSize: 48,
    fontWeight: '600',
  },
  videoBtn: {
    position: 'absolute',
    bottom: -4,
    left: -4,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraBtn: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  main: {
    paddingHorizontal: layout.containerPadding,
    maxWidth: layout.contentWidth,
    alignSelf: 'center',
    width: '100%',
  },
  identityBlock: {
    alignItems: 'center',
    marginBottom: spacing.xl,
    marginTop: spacing.sm,
  },
  identityNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  nameAge: {
    ...typography.titleLG,
    fontSize: 24,
  },
  premiumChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  premiumChipText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#fff',
  },
  zodiacEmoji: {
    fontSize: 18,
  },
  verificationBadgeOnPhoto: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 2,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptRow: {
    paddingVertical: spacing.sm,
    paddingHorizontal: 0,
  },
  promptRowContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  promptEmojiSmall: {
    fontSize: 18,
  },
  promptRowText: {
    flex: 1,
  },
  addPromptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.lg,
  },
  addPromptLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  verificationBadgesWrap: {
    marginBottom: spacing.sm,
  },
  promptQuestion: {
    fontSize: 12,
    marginBottom: 2,
  },
  promptAnswer: {
    fontSize: 14,
    fontWeight: '500',
  },
  taglineText: {
    fontSize: 14,
    fontStyle: 'italic',
    marginBottom: spacing.xs,
  },
  taglinePlaceholder: {
    fontSize: 14,
    marginBottom: spacing.xs,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  locationText: {
    fontSize: 14,
  },
  vibeScoreCard: {
    marginBottom: spacing.xl,
  },
  vibeScoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
  },
  vibeScoreCopy: {
    flex: 1,
  },
  vibeScoreTitle: {
    ...typography.titleMD,
    marginBottom: spacing.sm,
  },
  vibeScoreDesc: {
    ...typography.bodySecondary,
    marginBottom: spacing.md,
  },
  vibeScoreActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  previewLink: {
    fontSize: 14,
    fontWeight: '600',
  },
  completeProfileBtn: {
    marginTop: 0,
  },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  scheduleIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduleText: {
    flex: 1,
  },
  scheduleTitle: {
    ...typography.titleMD,
  },
  scheduleSub: {
    fontSize: 12,
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginBottom: spacing.xl,
  },
  statCard: {
    flex: 1,
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderWidth: 1,
    alignItems: 'center',
  },
  statIcon: {
    marginBottom: 6,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 11,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    paddingTop: 2,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionIcon: {
    marginRight: 0,
  },
  sectionEditLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sectionEditLinkText: {
    fontSize: 14,
    fontWeight: '600',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  helperText: {
    fontSize: 14,
    lineHeight: 20,
  },
  sectionHeaderStandalone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
    paddingHorizontal: 0,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cardTitle: {
    ...typography.titleMD,
  },
  editLink: {
    fontSize: 14,
    fontWeight: '600',
  },
  intentChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  intentLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  placeholder: {
    fontSize: 14,
  },
  aboutText: {
    fontSize: 14,
    lineHeight: 20,
  },
  verificationSubline: {
    fontSize: 12,
    marginBottom: spacing.md,
  },
  verificationSteps: {
    gap: 0,
  },
  verificationStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  verificationStepRowLast: {
    borderBottomWidth: 0,
  },
  verificationStepContent: {
    flex: 1,
  },
  verificationStepLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  verificationStepDesc: {
    fontSize: 12,
    marginTop: 2,
  },
  sectionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
    marginTop: spacing.xl,
  },
  sectionTitle: {
    ...typography.titleMD,
  },
  promptsEmpty: {
    marginBottom: spacing.md,
  },
  promptsEmptyCard: {
    borderRadius: radius['2xl'],
    borderWidth: 2,
    borderStyle: 'dashed',
    padding: spacing.xl,
    marginBottom: spacing.md,
  },
  promptsEmptyInner: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  promptsEmptyIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptsEmptyTitle: {
    ...typography.titleMD,
  },
  promptsEmptySub: {
    fontSize: 14,
  },
  vibeVideoShell: {
    borderRadius: radius['2xl'],
    aspectRatio: 16 / 9,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    marginBottom: spacing.md,
  },
  vibeVideoCard16x9: {
    borderRadius: radius['2xl'],
    aspectRatio: 16 / 9,
    overflow: 'hidden',
    marginBottom: spacing.md,
    borderWidth: 1,
    position: 'relative',
  },
  vibeVideoCardInner: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  vibeVideoUnavailable: {
    width: '100%',
    height: 200,
    borderRadius: 16,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  vibeVideoUnavailableOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  vibeVideoUnavailableText: {
    fontSize: 13,
    marginTop: 8,
  },
  vibeVideoPlayOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vibeVideoPlayBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  vibeVideoCaptionStrip: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    paddingBottom: spacing.lg,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  vibeVideoCaptionLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1,
    color: 'rgba(255,255,255,0.9)',
    marginBottom: 2,
  },
  vibeVideoCaptionText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  vibeVideoActionsRow: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  vibeVideoFullscreenBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
  },
  vibeVideoFullscreenContent: {
    flex: 1,
    justifyContent: 'center',
  },
  vibeVideoFullscreenPlayer: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
  },
  vibeVideoFullscreenClose: {
    position: 'absolute',
    top: 48,
    right: spacing.lg,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  vibeVideoCopy: {
    fontSize: 14,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  vibeVideoPlayerWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginTop: spacing.sm,
  },
  vibeVideoPlayer: {
    width: '100%',
    height: '100%',
  },
  galleryCard: {
    marginTop: spacing['2xl'],
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  photoGridTile: {
    borderRadius: radius['2xl'],
    overflow: 'hidden',
  },
  photoGridTileMain: {
    // Primary tile: same radius; shadow applied inline for hierarchy
  },
  photoGridImg: {
    width: '100%',
    height: '100%',
  },
  photoMainBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 0,
  },
  photoMainBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.95)',
  },
  photoEmptyLabel: {
    fontSize: 14,
  },
  photoEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing['2xl'],
    paddingHorizontal: spacing.xl,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: radius['2xl'],
  },
  galleryChrome: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.md,
  },
  galleryCounter: {
    fontSize: 15,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.9)',
  },
  galleryCloseBtn: {
    padding: 10,
  },
  galleryThumbSelected: {
    borderWidth: 2,
  },
  galleryPager: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  galleryPage: {
    width: Dimensions.get('window').width,
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  galleryImage: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').width,
  },
  galleryThumbStrip: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  galleryThumbStripContent: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  galleryThumb: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  galleryThumbImg: {
    width: '100%',
    height: '100%',
  },
  photoSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  photoSectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  photoSectionIcon: {
    marginRight: 0,
  },
  photoSectionTitle: {
    ...typography.titleMD,
  },
  photoManageLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  photoManageLinkText: {
    fontSize: 14,
    fontWeight: '600',
  },
  photoEditPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  photoEditPillText: {
    fontSize: 13,
    fontWeight: '600',
  },
  manageSheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  manageSheetContent: {
    backgroundColor: Colors.dark.background,
    borderTopLeftRadius: radius['2xl'],
    borderTopRightRadius: radius['2xl'],
    maxHeight: '85%',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  manageSheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  manageSheetTitle: {
    ...typography.titleLG,
    marginBottom: spacing.lg,
  },
  manageGrid: {
    alignSelf: 'center',
  },
  manageGridRow1: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  manageGridRightCol: {
    flexDirection: 'column',
  },
  manageGridRow2: {
    flexDirection: 'row',
  },
  manageGridTile: {
    borderRadius: radius.xl,
    overflow: 'hidden',
  },
  manageGridOverlay: {
    ...StyleSheet.absoluteFillObject,
    padding: 6,
    justifyContent: 'space-between',
  },
  manageGridMainBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  manageGridMainLabel: {
    fontSize: 10,
    fontWeight: '600',
  },
  manageGridActionsRow: {
    flexDirection: 'row',
    alignSelf: 'flex-end',
    gap: 6,
  },
  manageGridIconBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manageGridAddSlot: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  manageGridAddLabel: {
    fontSize: 12,
  },
  manageSheetFooter: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  basicsGrid: {
    gap: spacing.sm,
  },
  basicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.xl,
  },
  basicRowText: {
    flex: 1,
    minWidth: 0,
  },
  basicLabel: {
    fontSize: 12,
    marginBottom: 2,
  },
  basicValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  verificationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  inviteIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteEmoji: {
    fontSize: 18,
  },
  inviteText: {
    flex: 1,
  },
  inviteTitle: {
    ...typography.titleMD,
  },
  inviteSub: {
    fontSize: 12,
    marginTop: 2,
  },
  editSection: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing['2xl'],
  },
  label: {
    ...typography.caption,
    fontWeight: '600',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.input,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  textArea: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  primaryCta: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
});
