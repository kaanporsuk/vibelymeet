/**
 * Legacy profile tab (rollback). Not mounted when `USE_PROFILE_STUDIO === true` in `./index.tsx`.
 * No `Modal` + `TextInput` pairs here — prompts use `PromptEditSheet`; inline profile edits use the
 * main `ScrollView` + `Card`. Photo/manage modals are pickers or grids without text fields.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import { useFocusEffect } from '@react-navigation/native';
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
import { LinearGradient } from 'expo-linear-gradient';
import { spacing, radius, typography, layout, shadows, fonts } from '@/constants/theme';
import { withAlpha } from '@/lib/colorUtils';
import Svg, { Circle } from 'react-native-svg';
import { useColorScheme } from '@/components/useColorScheme';
import { Text, View } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';

/** Profile verification section — parity with web `VerificationSteps` + spec teal / violet–pink gradient */
const VERIFICATION_TEAL = '#0D9488';
const VERIFICATION_GRADIENT = ['#8B5CF6', '#E84393'] as const;
const VERIFICATION_SHIELD = '#8B5CF6';
const VERIFICATION_SUCCESS_TEXT = '#2DD4BF';
import { setOneSignalTags } from '@/lib/onesignal';
import {
  fetchMyProfile,
  fetchProfileLiveCounts,
  updateMyProfile,
  getZodiacSign,
  getZodiacEmoji,
  formatBirthdayUsWithZodiac,
  type ProfileRow,
} from '@/lib/profileApi';
import { setUserProperties } from '@/lib/analytics';
import { uploadProfilePhoto } from '@/lib/uploadImage';
import { deleteVibeVideo, DeleteVibeVideoError } from '@/lib/vibeVideoApi';
import { resolveVibeVideoState } from '@/lib/vibeVideoState';
import { avatarUrl, getImageUrl } from '@/lib/imageUrl';
import FullscreenVibeVideoModal from '@/components/video/FullscreenVibeVideoModal';
import { PromptEditSheet } from '@/components/profile/PromptEditSheet';
import { PROMPT_EMOJIS } from '@/components/profile/PROMPT_CONSTANTS';
import { RelationshipIntentSelector, getLookingForDisplay } from '@/components/profile/RelationshipIntentSelector';
import { LifestyleDetailsSection } from '@/components/profile/LifestyleDetailsSection';
import { PhoneVerificationFlow } from '@/components/verification/PhoneVerificationFlow';
import { EmailVerificationFlow } from '@/components/verification/EmailVerificationFlow';

// Web parity: PhotoManager / PhotoGallery max (src/components/PhotoManager.tsx)
const MAX_PHOTOS = 6;

const MAX_CONVERSATION_PROMPTS = 3;

function getVibeScoreLabel(score: number): string {
  if (score >= 90) return 'Iconic';
  if (score >= 75) return 'Fire';
  if (score >= 50) return 'Rising';
  if (score >= 25) return 'Warming Up';
  return 'Ghost Mode';
}

/** Web `VibeScore.tsx`: track muted, progress color by tier, label below ring */
function vibeScoreRingColor(score: number): string {
  if (score >= 75) return '#E84393';
  if (score >= 50) return '#8B5CF6';
  return '#06B6D4';
}

function VibeScoreDisplay({
  score,
  size = 100,
  theme,
  label: labelOverride,
}: {
  score: number;
  size?: number;
  theme: { text: string; textSecondary: string; tint: string; muted: string };
  label?: string | null;
}) {
  const label = labelOverride?.trim() ? labelOverride : getVibeScoreLabel(score);
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const progress = Math.min(100, Math.max(0, score)) / 100;
  const strokeDashoffset = circumference * (1 - progress);
  const ringColor = vibeScoreRingColor(score);

  return (
    <View style={vibeScoreStyles.column}>
      <View style={[vibeScoreStyles.ringWrap, { width: size, height: size }]}>
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          <Circle cx={c} cy={c} r={r} stroke={theme.muted} strokeWidth={stroke} fill="none" />
          <Circle
            cx={c}
            cy={c}
            r={r}
            stroke={ringColor}
            strokeWidth={stroke}
            fill="none"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            transform={`rotate(-90 ${c} ${c})`}
          />
        </Svg>
        <Text style={[vibeScoreStyles.scoreText, { color: theme.text }]}>{score}%</Text>
      </View>
      <Text style={[vibeScoreStyles.scoreLabel, { color: theme.textSecondary }]}>{label}</Text>
    </View>
  );
}

const vibeScoreStyles = StyleSheet.create({
  column: { alignItems: 'center' },
  ringWrap: { alignItems: 'center', justifyContent: 'center' },
  scoreText: {
    position: 'absolute',
    fontSize: 22,
    fontFamily: fonts.displayBold,
  },
  scoreLabel: {
    fontSize: 13,
    marginTop: 8,
    fontWeight: '500',
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
  const { user, signOut, refreshOnboarding, onboardingComplete } = useAuth();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const qc = useQueryClient();
  const { data: profile, isLoading, isError, error, isRefetching, refetch } = useQuery({
    queryKey: ['my-profile'],
    queryFn: fetchMyProfile,
    enabled: !!user?.id,
  });

  const verificationStepTotal = 3;
  const verificationVerifiedCount =
    (profile?.email_verified ? 1 : 0) +
    (profile?.photo_verified ? 1 : 0) +
    (profile?.phone_verified ? 1 : 0);
  const verificationProgressPct = (verificationVerifiedCount / verificationStepTotal) * 100;

  const { data: liveCounts, refetch: refetchLiveCounts } = useQuery({
    queryKey: ['profile-live-counts', user?.id],
    queryFn: () => fetchProfileLiveCounts(user!.id),
    enabled: !!user?.id,
  });

  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;
      void refetch();
      void refetchLiveCounts();
    }, [user?.id, refetch, refetchLiveCounts]),
  );

  useEffect(() => {
    if (!profile) return;
    const isPremium = !!(
      profile.is_premium &&
      profile.premium_until &&
      new Date(profile.premium_until) > new Date()
    );
    setUserProperties({
      name: profile.name ?? '',
      age: profile.age ?? 0,
      gender: profile.gender ?? '',
      location: profile.location ?? '',
      has_photos: (profile.photos?.length ?? 0) > 0,
      is_premium: isPremium,
      is_verified: !!(profile.phone_verified || profile.photo_verified),
    });
  }, [profile]);
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

  // Sync OneSignal tags when profile loads or updates (for segmentation: Incomplete Profile, etc.)
  useEffect(() => {
    if (!user?.id || !profile) return;
    setOneSignalTags({
      userId: user.id,
      onboardingComplete: onboardingComplete === true,
      hasPhotos: (profile.photos?.length ?? 0) > 0,
      isPremium: profile.is_premium === true,
      city: profile.location ?? '',
    });
  }, [user?.id, profile, onboardingComplete]);

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
  const [showVibeManageSheet, setShowVibeManageSheet] = useState(false);
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

  const usedPromptQuestionsElsewhere =
    promptEditIndex === null
      ? []
      : (profile?.prompts ?? [])
          .map((p, i) => (i !== promptEditIndex && p.question?.trim() ? p.question.trim() : null))
          .filter((q): q is string => !!q);

  const handlePromptCommit = async (payload: { question: string; answer: string }) => {
    const idx = promptEditIndex;
    if (idx === null || idx < 0) return;
    setSaving(true);
    try {
      const current = [...(profile?.prompts ?? [])];
      while (current.length <= idx) current.push({ question: '', answer: '' });
      current[idx] = { question: payload.question, answer: payload.answer };
      while (
        current.length > 0 &&
        (!String(current[current.length - 1]?.question ?? '').trim() ||
          !String(current[current.length - 1]?.answer ?? '').trim())
      ) {
        current.pop();
      }
      await updateMyProfile({ prompts: current });
      await qc.invalidateQueries({ queryKey: ['my-profile'] });
      setShowPromptSheet(false);
      setPromptEditIndex(null);
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to save prompt');
    } finally {
      setSaving(false);
    }
  };

  const handlePromptRemove = async (index: number) => {
    setSaving(true);
    try {
      const current = profile?.prompts ?? [];
      const next = current.filter((_, i) => i !== index);
      await updateMyProfile({ prompts: next.length ? next : [] });
      await qc.invalidateQueries({ queryKey: ['my-profile'] });
      setShowPromptSheet(false);
      setPromptEditIndex(null);
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to remove prompt');
    } finally {
      setSaving(false);
    }
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

  const vibeInfo = resolveVibeVideoState(profile ?? null);
  const showLegacyVibeUploading = vibeInfo.state === 'uploading';
  const showLegacyVibeProcessing =
    vibeInfo.state === 'processing' && !showLegacyVibeUploading;
  const showLegacyVibeEmpty = vibeInfo.state === 'none' || vibeInfo.state === 'error';

  const handleVibeVideoPress = () => {
    if (showLegacyVibeUploading || showLegacyVibeProcessing) return;
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
            } catch (e) {
              const msg =
                e instanceof DeleteVibeVideoError ? e.message : 'Could not delete. Try again.';
              Alert.alert('Error', msg);
            }
          },
        },
      ]
    );
  };

  const handlePreviewProfile = () => router.push('/profile-preview');

  const handleSchedulePress = () => {
    router.push('/schedule');
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

  const vibeScore = profile?.vibe_score ?? 0;

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
          onActionPress={() => {
            void refetch();
            void refetchLiveCounts();
          }}
        />
      </View>
    );
  }

  if (!isLoading && user?.id && !profile) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background, flex: 1 }]}>
        <ErrorState
          message="We couldn't load your profile. Check your connection and try again."
          onActionPress={() => {
            void refetch();
            void refetchLiveCounts();
          }}
        />
      </View>
    );
  }

  const eventsCount = liveCounts?.events ?? profile?.events_attended ?? 0;
  const matchesCount = liveCounts?.matches ?? profile?.total_matches ?? 0;
  const convosCount = liveCounts?.convos ?? profile?.total_conversations ?? 0;
  const lookingForDisplay = getLookingForDisplay(profile?.looking_for);

  const profilePhotos = profile?.photos ?? [];
  const photoViewerPhotos = profilePhotos.length > 0 ? profilePhotos : [];

  const heroAvatarPath = profile?.photos?.[0] ?? profile?.avatar_url ?? null;
  const zodiacEmoji = (() => {
    if (!profile?.birth_date) return null;
    const parts = profile.birth_date.split('-');
    if (parts.length !== 3) return null;
    const localDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return getZodiacEmoji(getZodiacSign(localDate));
  })();
  const isPremiumActive = !!(
    profile?.is_premium &&
    profile?.premium_until &&
    new Date(profile.premium_until) > new Date()
  );

  return (
    <>
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={{ paddingBottom: 120 }}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching && !isLoading}
          onRefresh={() => {
            void refetch();
            void refetchLiveCounts();
          }}
          tintColor={theme.tint}
        />
      }
    >
      {/* Zone A — absolute full-bleed gradient behind controls (web parity). Avoids flex/layout gaps showing theme.background between buttons. */}
      <RNView
        style={[
          styles.heroShell,
          { minHeight: insets.top + 8 + 44 + 24 },
        ]}
      >
        <LinearGradient
          pointerEvents="none"
          colors={['#8B5CF6', '#D946EF', '#E84393', theme.background]}
          locations={[0, 0.32, 0.62, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.heroGradientAbsolute, { height: insets.top + 220 }]}
        />
        <RNView pointerEvents="none" style={styles.glowOrb} />
        <RNView
          pointerEvents="box-none"
          style={[styles.heroTopBar, { paddingTop: insets.top + 8 }]}
        >
          <RNView style={styles.heroControls}>
            <Pressable
              onPress={handlePreviewProfile}
              style={styles.glassBtn}
              accessibilityLabel="Preview profile"
            >
              <Ionicons name="eye-outline" size={20} color="rgba(255,255,255,0.85)" />
            </Pressable>
            <Pressable
              onPress={() => router.push('/settings')}
              style={styles.glassBtn}
              accessibilityLabel="Settings"
            >
              <Ionicons name="settings-outline" size={20} color="rgba(255,255,255,0.85)" />
            </Pressable>
          </RNView>
        </RNView>
      </RNView>

      {/* Zone B — web ProfilePhoto xl: 128×128, rounded-2xl (16), border-4 background, shadow-2xl */}
      <View style={styles.avatarSection}>
        <View style={styles.avatarOuter}>
          <View
            style={[
              styles.heroAvatarCard,
              {
                borderColor: theme.background,
                backgroundColor: theme.surfaceSubtle,
              },
            ]}
          >
            {heroAvatarPath ? (
              <Image source={{ uri: getImageUrl(heroAvatarPath) }} style={styles.avatarImage} />
            ) : (
              <View style={[styles.avatarPlaceholder, { backgroundColor: theme.surfaceSubtle }]}>
                <Ionicons name="person" size={48} color={theme.mutedForeground} />
              </View>
            )}
          </View>

          {vibeInfo.state === 'ready' ? (
            <Pressable
              onPress={handleVibeVideoPress}
              style={[styles.mediaFab, styles.mediaFabLeft, { backgroundColor: '#06B6D4' }, shadows.glowCyan]}
              accessibilityLabel="Vibe video"
            >
              <Ionicons name="videocam" size={20} color="#fff" />
            </Pressable>
          ) : null}

          <Pressable
            onPress={handleAddPhoto}
            disabled={photoUploading}
            style={[styles.mediaFab, styles.mediaFabRight, { backgroundColor: '#E84393' }, shadows.glowPink]}
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

      {/* Zone C — identity block (web: Premium inline with name; no hero verification pills/chips) */}
      <View style={styles.identityBlock}>
        <View style={styles.nameRow}>
          <Text style={[styles.nameText, { color: theme.text }]} numberOfLines={1}>
            {profile?.name ?? 'Your name'}
            {profile?.age != null ? `, ${profile.age}` : ''}
          </Text>
          {isPremiumActive ? (
            <LinearGradient
              colors={['#8B5CF6', '#E84393']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.premiumPill}
            >
              <Ionicons name="diamond" size={11} color="#fff" />
              <Text style={styles.premiumPillText}>Premium</Text>
            </LinearGradient>
          ) : null}
          {zodiacEmoji ? (
            <View
              style={[
                styles.zodiacChip,
                { backgroundColor: withAlpha(theme.tint, 0.15), borderColor: withAlpha(theme.tint, 0.3) },
              ]}
            >
              <Text style={{ fontSize: 14 }}>{zodiacEmoji}</Text>
            </View>
          ) : null}
        </View>

        <Pressable
          onPress={() => setEditing(true)}
          style={({ pressed }) => [styles.taglineRow, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel={profile?.tagline ? 'Edit tagline' : 'Add tagline'}
        >
          {profile?.tagline ? (
            <Text style={[styles.tagline, { color: theme.tint }]} numberOfLines={2}>
              "{profile.tagline}"
            </Text>
          ) : (
            <Text style={[styles.taglinePlaceholder, { color: theme.textSecondary }]}>Add tagline</Text>
          )}
          <Ionicons name="pencil-outline" size={16} color={theme.tint} style={styles.taglinePencil} />
        </Pressable>

        <View style={styles.locationRow}>
          <Ionicons name="location-outline" size={14} color={theme.mutedForeground} />
          <Text style={[styles.locationText, { color: theme.mutedForeground }]}>
            {profile?.location?.trim() ? profile.location : 'Location not set'}
          </Text>
        </View>
      </View>

      <Animated.View style={[styles.main, { opacity: fadeAnim }]}>
        {/* Vibe Score card — web parity glass-card */}
        <Card variant="glass" style={styles.vibeScoreCard}>
          <View style={styles.vibeScoreRow}>
            <VibeScoreDisplay score={vibeScore} size={90} theme={theme} label={profile?.vibe_score_label} />
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
                <Pressable
                  onPress={handlePreviewProfile}
                  style={({ pressed }) => [styles.vibePreviewBtn, pressed && { opacity: 0.85 }]}
                >
                  <Ionicons name="eye-outline" size={16} color={theme.tint} />
                  <Text style={[styles.vibePreviewBtnText, { color: theme.tint }]}>Preview</Text>
                </Pressable>
                {vibeScore < 100 ? (
                  <VibelyButton
                    label="Complete Profile"
                    onPress={() => setEditing(true)}
                    variant="gradient"
                    style={styles.completeProfileBtn}
                  />
                ) : null}
              </View>
            </View>
          </View>
        </Card>

        {/* My Vibe Schedule — native parity: teal icon chip, navigates to Schedule screen */}
        <Card variant="glass">
          <Pressable
            onPress={handleSchedulePress}
            style={({ pressed }) => [styles.scheduleRow, pressed && { opacity: 0.9 }]}
          >
            <View style={styles.scheduleIconChip}>
              <Ionicons name="calendar-outline" size={20} color="#06B6D4" />
            </View>
            <View style={styles.scheduleTextWrap}>
              <Text style={[styles.scheduleRowTitle, { color: theme.text }]}>My Vibe Schedule</Text>
              <Text style={[styles.scheduleRowSub, { color: theme.textSecondary }]}>
                Set when you're open for dates
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
          </Pressable>
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

        {/* Looking For — web RelationshipIntent display chip (emoji + label) */}
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
          {lookingForDisplay ? (
            <View
              style={[
                styles.lookingForDisplayChip,
                { backgroundColor: theme.tintSoft, borderColor: theme.border },
              ]}
            >
              <Text style={styles.lookingForEmoji}>{lookingForDisplay.emoji}</Text>
              <Text style={[styles.lookingForLabelText, { color: theme.text }]}>{lookingForDisplay.label}</Text>
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

        {/* Conversation Starters — web ProfilePrompt: large cards, gradient left accent */}
        <View style={styles.sectionHeaderStandalone}>
          <Ionicons name="chatbubble-ellipses-outline" size={18} color={theme.tint} style={styles.sectionIcon} />
          <VibelyText variant="titleSM" style={{ color: theme.text }}>Conversation Starters</VibelyText>
        </View>
        {(() => {
          const list = profile?.prompts ?? [];
          const slots = [...list];
          while (slots.length < MAX_CONVERSATION_PROMPTS) {
            slots.push({ question: '', answer: '' });
          }
          const displaySlots = slots.slice(0, MAX_CONVERSATION_PROMPTS);
          const hasAnyPromptContent = list.some((p) => p.question?.trim() || p.answer?.trim());

          const openFirstPrompt = () => {
            setPromptSheetMode('add');
            setPromptEditIndex(0);
            setShowPromptSheet(true);
          };

          const openSlot = (index: number) => {
            const slot = displaySlots[index] ?? { question: '', answer: '' };
            const filled = !!(slot.question?.trim() && slot.answer?.trim());
            setPromptSheetMode(filled ? 'edit' : 'add');
            setPromptEditIndex(index);
            setShowPromptSheet(true);
          };

          if (!hasAnyPromptContent) {
            return (
              <Pressable
                onPress={openFirstPrompt}
                style={({ pressed }) => [
                  styles.promptFirstEmptyCard,
                  {
                    borderColor: theme.border,
                    backgroundColor: theme.surfaceSubtle,
                  },
                  pressed && { opacity: 0.92 },
                ]}
              >
                <Text style={styles.promptEmptyEmoji}>💬</Text>
                <Text style={[styles.promptEmptyPlaceholder, { color: theme.textSecondary }]}>
                  Tap to add your answer...
                </Text>
              </Pressable>
            );
          }

          return (
            <View style={styles.promptCardsColumn}>
              {displaySlots.map((slot, index) => {
                const answerTrim = slot.answer?.trim() ?? '';
                const filled = !!(slot.question?.trim() && answerTrim);

                if (!filled) {
                  return (
                    <Pressable
                      key={`empty-${index}`}
                      onPress={() => openSlot(index)}
                      style={({ pressed }) => [
                        styles.promptSlotEmptyCard,
                        {
                          borderStyle: 'dashed',
                          borderColor: 'rgba(255,255,255,0.12)',
                          backgroundColor: 'rgba(255,255,255,0.03)',
                        },
                        pressed && { opacity: 0.92 },
                      ]}
                    >
                      <Text style={styles.promptEmptyEmoji}>💬</Text>
                      <Text style={[styles.promptEmptyPlaceholder, { color: theme.textSecondary }]}>
                        Tap to add your answer...
                      </Text>
                    </Pressable>
                  );
                }

                const emoji = PROMPT_EMOJIS[slot.question] ?? '💭';
                return (
                  <Pressable
                    key={`prompt-${index}-${slot.question}`}
                    onPress={() => openSlot(index)}
                    style={({ pressed }) => [
                      styles.promptStandaloneCard,
                      {
                        backgroundColor: theme.surfaceSubtle,
                        borderColor: theme.glassBorder,
                      },
                      pressed && { opacity: 0.96 },
                    ]}
                  >
                    <View style={styles.promptGradientAccentWrap} pointerEvents="none">
                      <LinearGradient
                        colors={['#8B5CF6', '#E84393']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                        style={StyleSheet.absoluteFill}
                      />
                    </View>
                    <View style={styles.promptCardInner}>
                      <View style={styles.promptCardTopRow}>
                        <View style={styles.promptCardTitleRow}>
                          <Text style={styles.promptCardEmoji}>{emoji}</Text>
                          <Text style={[styles.promptCardQuestion, { color: theme.textSecondary }]} numberOfLines={3}>
                            {slot.question}
                          </Text>
                        </View>
                        <Ionicons name="pencil-outline" size={18} color={theme.textSecondary} />
                      </View>
                      <Text style={[styles.promptCardAnswer, { color: theme.text }]}>{answerTrim}</Text>
                      <View style={styles.promptCardFooter}>
                        <Ionicons name="chatbubble-ellipses-outline" size={14} color={theme.tint} />
                        <Text style={[styles.promptCardFooterLabel, { color: theme.textSecondary }]}>
                          Conversation starter
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          );
        })()}

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
          {showLegacyVibeUploading && (
            <View style={styles.vibeVideoCardInner}>
              <Ionicons name="cloud-upload-outline" size={48} color={theme.textSecondary} style={{ opacity: 0.6 }} />
              <Text style={[styles.vibeVideoCopy, { color: theme.textSecondary }]}>Uploading…</Text>
            </View>
          )}
          {showLegacyVibeProcessing && (
            <View style={styles.vibeVideoCardInner}>
              <Ionicons name="sync-outline" size={48} color={theme.textSecondary} style={{ opacity: 0.6 }} />
              <Text style={[styles.vibeVideoCopy, { color: theme.textSecondary }]}>Processing your video…</Text>
            </View>
          )}
          {vibeInfo.state === 'ready' && (() => {
            const playbackUrl = vibeInfo.playbackUrl;
            const thumbnailUrl = vibeInfo.thumbnailUrl;
            const caption = profile?.vibe_caption?.trim() ?? '';
            return (
              <>
                {thumbnailUrl ? (
                  <Image source={{ uri: thumbnailUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                ) : (
                  <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.surface }]} />
                )}
                <LinearGradient
                  pointerEvents="none"
                  colors={['transparent', 'rgba(0,0,0,0.72)']}
                  locations={[0.35, 1]}
                  style={StyleSheet.absoluteFill}
                />
                <Pressable
                  onPress={() => setShowVibeManageSheet(true)}
                  style={styles.vibeVideoManagePill}
                  accessibilityLabel="Manage vibe video"
                >
                  <Text style={styles.vibeVideoManagePillText}>Manage</Text>
                </Pressable>
                <View style={styles.vibeVideoPlayOverlay} pointerEvents="box-none">
                  <Pressable onPress={() => playbackUrl && setShowVibeVideoFullscreen(true)} style={styles.vibeVideoPlayBtn}>
                    <Ionicons name="play" size={28} color="#fff" />
                  </Pressable>
                </View>
                {caption ? (
                  <View style={styles.vibeVideoCaptionStrip} pointerEvents="none">
                    <Text style={styles.vibeVideoVibingOnLabel}>VIBING ON</Text>
                    <Text style={styles.vibeVideoCaptionText} numberOfLines={2}>
                      {caption}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.vibeVideoCaptionStrip} pointerEvents="none">
                    <Text style={[styles.vibeVideoCaptionText, { opacity: 0.7 }]}>Tap to play</Text>
                  </View>
                )}
              </>
            );
          })()}
          {vibeInfo.state === 'failed' && (
            <View style={styles.vibeVideoCardInner}>
              <Ionicons name="alert-circle-outline" size={48} color={theme.danger} style={{ opacity: 0.8 }} />
              <Text style={[styles.vibeVideoCopy, { color: theme.textSecondary }]}>Processing failed. Try recording again.</Text>
              <VibelyButton label="Record again" onPress={handleVibeVideoPress} variant="secondary" style={{ marginTop: spacing.sm }} />
            </View>
          )}
          {showLegacyVibeEmpty && (
            <View style={styles.vibeVideoCardInner}>
              <Ionicons name="videocam-outline" size={48} color={theme.textSecondary} style={{ opacity: 0.3 }} />
              <Text style={[styles.vibeVideoCopy, { color: theme.textSecondary }]}>
                Record a 15-second video intro to stand out
              </Text>
              <VibelyButton label="Record your Vibe Video" onPress={handleVibeVideoPress} variant="secondary" style={{ marginTop: spacing.sm }} />
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
                      <View style={[styles.photoMainBadge, { backgroundColor: 'rgba(0,0,0,0.55)' }]}>
                        <Text style={styles.photoMainBadgeCrown}>👑</Text>
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

        {/* The Basics — web: 2×2 grid (Birthday | Work, Height | Location) */}
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
                {
                  icon: 'calendar-outline' as const,
                  label: 'Birthday',
                  value: formatBirthdayUsWithZodiac(profile?.birth_date),
                },
                { icon: 'briefcase-outline' as const, label: 'Work', value: profile?.job?.trim() || 'Not set' },
                {
                  icon: 'resize-outline' as const,
                  label: 'Height',
                  value: profile?.height_cm ? `${profile.height_cm} cm` : 'Not set',
                },
                { icon: 'location-outline' as const, label: 'Location', value: profile?.location?.trim() || 'Not set' },
              ] as const
            ).map((item) => (
              <View
                key={item.label}
                style={[
                  styles.basicCard,
                  {
                    backgroundColor: theme.surfaceSubtle,
                    borderColor: theme.border,
                  },
                ]}
              >
                <View style={styles.basicCardTopRow}>
                  <Ionicons name={item.icon} size={16} color={theme.textSecondary} />
                  <Text style={[styles.basicCardLabel, { color: theme.textSecondary }]}>{item.label}</Text>
                </View>
                <Text style={[styles.basicCardValue, { color: theme.text }]} numberOfLines={3}>
                  {item.value}
                </Text>
              </View>
            ))}
          </View>
        </Card>

        {/* Verification — web `VerificationSteps`: header + gradient bar + teal cards + success banner */}
        <Card variant="glass">
          <View style={styles.verificationHeaderRow}>
            <View style={styles.verificationTitleLeft}>
              <Ionicons name="shield-checkmark-outline" size={20} color={VERIFICATION_SHIELD} />
              <Text style={[styles.verificationTitle, { color: theme.text }]}>Verification</Text>
            </View>
            <Text style={[styles.verificationCountLabel, { color: theme.textSecondary }]}>
              {verificationVerifiedCount}/{verificationStepTotal} complete
            </Text>
          </View>

          <View style={styles.verificationProgressTrack}>
            <View style={[styles.verificationProgressFill, { width: `${verificationProgressPct}%` }]}>
              <LinearGradient
                colors={[...VERIFICATION_GRADIENT]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFill}
              />
            </View>
          </View>

          <View style={styles.verificationCardsWrap}>
            {profile?.email_verified ? (
              <View
                style={[
                  styles.verificationCard,
                  { borderColor: 'rgba(13, 148, 136, 0.3)', backgroundColor: 'rgba(13, 148, 136, 0.1)' },
                ]}
              >
                <View style={[styles.verificationIconSquare, { backgroundColor: 'rgba(13, 148, 136, 0.2)' }]}>
                  <Ionicons name="mail-outline" size={20} color={VERIFICATION_TEAL} />
                </View>
                <View style={styles.verificationCardText}>
                  <Text style={[styles.verificationCardTitle, { color: theme.text }]}>Email verification</Text>
                  <Text style={[styles.verificationCardSubtitle, { color: theme.textSecondary }]}>Verified</Text>
                </View>
                <View style={styles.verificationTealCheck}>
                  <Ionicons name="checkmark" size={14} color="#fff" />
                </View>
              </View>
            ) : (
              <Pressable
                onPress={() => setShowEmailVerify(true)}
                style={({ pressed }) => [
                  styles.verificationCard,
                  { borderColor: theme.border, backgroundColor: theme.surfaceSubtle },
                  pressed && { opacity: 0.85 },
                ]}
              >
                <View style={[styles.verificationIconSquare, { backgroundColor: 'rgba(255,255,255,0.08)' }]}>
                  <Ionicons name="mail-outline" size={20} color={theme.textSecondary} />
                </View>
                <View style={styles.verificationCardText}>
                  <Text style={[styles.verificationCardTitle, { color: theme.text }]}>Email verification</Text>
                  <Text style={[styles.verificationCardSubtitle, { color: theme.tint }]}>Verify</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={theme.tint} />
              </Pressable>
            )}

            {profile?.photo_verified ? (
              <View
                style={[
                  styles.verificationCard,
                  { borderColor: 'rgba(13, 148, 136, 0.3)', backgroundColor: 'rgba(13, 148, 136, 0.1)' },
                ]}
              >
                <View style={[styles.verificationIconSquare, { backgroundColor: 'rgba(13, 148, 136, 0.2)' }]}>
                  <Ionicons name="camera-outline" size={20} color={VERIFICATION_TEAL} />
                </View>
                <View style={styles.verificationCardText}>
                  <Text style={[styles.verificationCardTitle, { color: theme.text }]}>Photo verification</Text>
                  <Text style={[styles.verificationCardSubtitle, { color: theme.textSecondary }]}>Verified</Text>
                </View>
                <View style={styles.verificationTealCheck}>
                  <Ionicons name="checkmark" size={14} color="#fff" />
                </View>
              </View>
            ) : (
              <Pressable
                onPress={() => Linking.openURL('https://vibelymeet.com/profile').catch(() => {})}
                style={({ pressed }) => [
                  styles.verificationCard,
                  { borderColor: theme.border, backgroundColor: theme.surfaceSubtle },
                  pressed && { opacity: 0.85 },
                ]}
              >
                <View style={[styles.verificationIconSquare, { backgroundColor: 'rgba(255,255,255,0.08)' }]}>
                  <Ionicons name="camera-outline" size={20} color={theme.textSecondary} />
                </View>
                <View style={styles.verificationCardText}>
                  <Text style={[styles.verificationCardTitle, { color: theme.text }]}>Photo verification</Text>
                  <Text style={[styles.verificationCardSubtitle, { color: theme.tint }]}>Verify on web</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={theme.tint} />
              </Pressable>
            )}

            {profile?.phone_verified ? (
              <View
                style={[
                  styles.verificationCard,
                  { borderColor: 'rgba(13, 148, 136, 0.3)', backgroundColor: 'rgba(13, 148, 136, 0.1)' },
                ]}
              >
                <View style={[styles.verificationIconSquare, { backgroundColor: 'rgba(13, 148, 136, 0.2)' }]}>
                  <Ionicons name="call-outline" size={20} color={VERIFICATION_TEAL} />
                </View>
                <View style={styles.verificationCardText}>
                  <Text style={[styles.verificationCardTitle, { color: theme.text }]}>Phone number</Text>
                  <Text style={[styles.verificationCardSubtitle, { color: theme.textSecondary }]}>Verified</Text>
                </View>
                <View style={styles.verificationTealCheck}>
                  <Ionicons name="checkmark" size={14} color="#fff" />
                </View>
              </View>
            ) : (
              <Pressable
                onPress={() => setShowPhoneVerify(true)}
                style={({ pressed }) => [
                  styles.verificationCard,
                  { borderColor: theme.border, backgroundColor: theme.surfaceSubtle },
                  pressed && { opacity: 0.85 },
                ]}
              >
                <View style={[styles.verificationIconSquare, { backgroundColor: 'rgba(255,255,255,0.08)' }]}>
                  <Ionicons name="call-outline" size={20} color={theme.textSecondary} />
                </View>
                <View style={styles.verificationCardText}>
                  <Text style={[styles.verificationCardTitle, { color: theme.text }]}>Phone number</Text>
                  <Text style={[styles.verificationCardSubtitle, { color: theme.tint }]}>Verify your number</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={theme.tint} />
              </Pressable>
            )}
          </View>

          {verificationVerifiedCount === verificationStepTotal && (
            <View
              style={[
                styles.verificationSuccessBanner,
                { backgroundColor: 'rgba(13, 148, 136, 0.15)', borderColor: 'rgba(13, 148, 136, 0.3)' },
              ]}
            >
              <View style={styles.verificationSuccessIconCircle}>
                <Ionicons name="checkmark" size={18} color="#fff" />
              </View>
              <Text style={[styles.verificationSuccessText, { color: VERIFICATION_SUCCESS_TEXT }]}>
                {"You're verified! 3x more likely to match."}
              </Text>
            </View>
          )}
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

    <FullscreenVibeVideoModal
      visible={showVibeVideoFullscreen && vibeInfo.state === 'ready'}
      onClose={() => setShowVibeVideoFullscreen(false)}
      playbackUrl={vibeInfo.playbackUrl}
      bunnyVideoUid={profile?.bunny_video_uid}
      vibeCaption={profile?.vibe_caption ?? ''}
      posterUrl={vibeInfo.thumbnailUrl}
    />

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
                        <Text style={styles.manageGridMainCrown}>👑</Text>
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
      onClose={() => {
        setShowPromptSheet(false);
        setPromptEditIndex(null);
      }}
      mode={promptSheetMode}
      initialQuestion={promptEditIndex !== null ? (profile?.prompts?.[promptEditIndex]?.question ?? '') : ''}
      initialAnswer={promptEditIndex !== null ? (profile?.prompts?.[promptEditIndex]?.answer ?? '') : ''}
      onSave={handlePromptCommit}
      onRemove={
        promptSheetMode === 'edit' && promptEditIndex !== null
          ? () => handlePromptRemove(promptEditIndex)
          : undefined
      }
      usedQuestions={usedPromptQuestionsElsewhere}
      saving={saving}
    />

    <Modal visible={showVibeManageSheet} transparent animationType="fade" onRequestClose={() => setShowVibeManageSheet(false)}>
      <Pressable style={styles.vibeManageBackdrop} onPress={() => setShowVibeManageSheet(false)}>
        <Pressable
          style={[styles.vibeManageSheet, { backgroundColor: theme.surface, borderColor: theme.border }]}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={[styles.vibeManageSheetTitle, { color: theme.text }]}>Vibe Video</Text>
          <Pressable
            onPress={() => {
              setShowVibeManageSheet(false);
              handleVibeVideoPress();
            }}
            style={({ pressed }) => [styles.vibeManageRow, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="videocam-outline" size={22} color={theme.tint} />
            <Text style={[styles.vibeManageRowLabel, { color: theme.text }]}>Record new</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setShowVibeManageSheet(false);
              handleDeleteVibeVideo();
            }}
            style={({ pressed }) => [styles.vibeManageRow, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="trash-outline" size={22} color={theme.danger} />
            <Text style={[styles.vibeManageRowLabel, { color: theme.danger }]}>Delete video</Text>
          </Pressable>
          <Pressable onPress={() => setShowVibeManageSheet(false)} style={styles.vibeManageCancel}>
            <Text style={[styles.vibeManageCancelText, { color: theme.textSecondary }]}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>

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
  heroShell: {
    position: 'relative',
    width: '100%',
    overflow: 'visible',
  },
  heroGradientAbsolute: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 0,
  },
  heroTopBar: {
    position: 'relative',
    zIndex: 2,
    paddingHorizontal: 16,
    paddingBottom: 24,
    width: '100%',
    backgroundColor: 'transparent',
  },
  glowOrb: {
    position: 'absolute',
    bottom: -40,
    alignSelf: 'center',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(139, 92, 246, 0.25)',
    zIndex: 1,
  },
  heroControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  glassBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarSection: {
    alignItems: 'center',
    marginTop: -55,
    zIndex: 10,
  },
  avatarOuter: {
    position: 'relative',
  },
  /** Web ProfilePhoto xl: w-32 h-32 + rounded-2xl + border-4 border-background + shadow-2xl */
  heroAvatarCard: {
    width: 128,
    height: 128,
    borderRadius: 16,
    borderWidth: 4,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 16,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  avatarPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaFab: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    bottom: -6,
  },
  mediaFabLeft: { left: -4 },
  mediaFabRight: { right: -4 },
  main: {
    paddingHorizontal: layout.containerPadding,
    maxWidth: layout.contentWidth,
    alignSelf: 'center',
    width: '100%',
  },
  identityBlock: {
    alignItems: 'center',
    paddingTop: 12,
    paddingHorizontal: 24,
    gap: 6,
    marginBottom: spacing.lg,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '100%',
  },
  nameText: {
    fontSize: 24,
    fontWeight: '700',
    flexShrink: 1,
  },
  zodiacChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
  },
  premiumPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  premiumPillText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  taglineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    maxWidth: '100%',
    paddingHorizontal: 8,
  },
  taglinePencil: {
    flexShrink: 0,
  },
  tagline: {
    fontSize: 15,
    fontStyle: 'italic',
    textAlign: 'center',
    flexShrink: 1,
  },
  promptCardsColumn: {
    gap: spacing.lg,
    marginBottom: spacing.sm,
  },
  promptStandaloneCard: {
    borderRadius: radius['2xl'],
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  promptGradientAccentWrap: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    zIndex: 0,
  },
  promptCardInner: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    paddingLeft: 19,
    zIndex: 1,
  },
  promptCardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  promptCardTitleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  promptCardEmoji: {
    fontSize: 18,
    marginTop: 2,
  },
  promptCardQuestion: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  promptCardAnswer: {
    fontSize: 16,
    lineHeight: 24,
    marginTop: spacing.sm,
    fontWeight: '600',
  },
  promptCardAnswerPlaceholder: {
    fontSize: 15,
    fontStyle: 'italic',
    marginTop: spacing.sm,
  },
  promptCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
  },
  promptCardFooterLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  promptFirstEmptyCard: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: radius['2xl'],
    paddingVertical: spacing['2xl'],
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  promptSlotEmptyCard: {
    borderWidth: 1,
    borderRadius: radius['2xl'],
    paddingVertical: spacing['2xl'],
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  promptEmptyEmoji: {
    fontSize: 40,
  },
  promptEmptyPlaceholder: {
    fontSize: 15,
    textAlign: 'center',
  },
  lookingForDisplayChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.xl,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  lookingForEmoji: { fontSize: 18 },
  lookingForLabelText: { fontSize: 15, fontWeight: '600' },
  taglinePlaceholder: {
    fontSize: 14,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  locationText: {
    fontSize: 13,
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
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
  },
  vibePreviewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  vibePreviewBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  completeProfileBtn: {
    marginTop: 0,
  },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    minHeight: 48,
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
  scheduleIconChip: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(6, 182, 212, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  scheduleTextWrap: { flex: 1 },
  scheduleRowTitle: { fontSize: 16, fontFamily: fonts.bodySemiBold },
  scheduleRowSub: { fontSize: 13, marginTop: 2 },
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
  placeholder: {
    fontSize: 14,
  },
  aboutText: {
    fontSize: 14,
    lineHeight: 20,
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
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    paddingTop: spacing.md,
  },
  vibeVideoVibingOnLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    color: '#06B6D4',
    marginBottom: 4,
  },
  vibeVideoCaptionText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
  vibeVideoManagePill: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 2,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  vibeVideoManagePillText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  vibeManageBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  vibeManageSheet: {
    borderTopLeftRadius: radius['2xl'],
    borderTopRightRadius: radius['2xl'],
    borderWidth: 1,
    paddingTop: spacing.md,
    paddingBottom: spacing['2xl'],
    paddingHorizontal: spacing.lg,
  },
  vibeManageSheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  vibeManageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  vibeManageRowLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  vibeManageCancel: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  vibeManageCancelText: {
    fontSize: 16,
    fontWeight: '600',
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
  photoMainBadgeCrown: {
    fontSize: 11,
    lineHeight: 12,
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
  manageGridMainCrown: {
    fontSize: 11,
    lineHeight: 12,
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
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  basicCard: {
    width: '48%',
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderWidth: 1,
  },
  basicCardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  basicCardLabel: {
    fontSize: 12,
  },
  basicCardValue: {
    fontSize: 15,
    fontWeight: '600',
    marginTop: 6,
  },
  verificationHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  verificationTitleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  verificationTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  verificationCountLabel: {
    fontSize: 14,
  },
  verificationProgressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginTop: 12,
    overflow: 'hidden',
  },
  verificationProgressFill: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  verificationCardsWrap: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  verificationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.xl,
    borderWidth: 1,
  },
  verificationIconSquare: {
    width: 40,
    height: 40,
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verificationCardText: {
    flex: 1,
    minWidth: 0,
  },
  verificationCardTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  verificationCardSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  verificationTealCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: VERIFICATION_TEAL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verificationSuccessBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderWidth: 1,
    marginTop: spacing.md,
  },
  verificationSuccessIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: VERIFICATION_TEAL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verificationSuccessText: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
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
