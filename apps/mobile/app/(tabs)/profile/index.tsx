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
  VibelyButton,
  VibelyInput,
  Avatar,
  LoadingState,
  SettingsRow,
  DestructiveRow,
} from '@/components/ui';
import { spacing, radius, typography, layout } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { Text, View } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import { fetchMyProfile, updateMyProfile, type ProfileRow } from '@/lib/profileApi';
import { uploadProfilePhoto } from '@/lib/uploadImage';
import { deleteVibeVideo } from '@/lib/vibeVideoApi';
import { getVibeVideoPlaybackUrl } from '@/lib/vibeVideoPlaybackUrl';
import { avatarUrl, getImageUrl } from '@/lib/imageUrl';
import { useVideoPlayer, VideoView } from 'expo-video';

function VibeVideoPlayer({ playbackUrl, style }: { playbackUrl: string; style?: object }) {
  const source = playbackUrl.endsWith('.m3u8') ? { uri: playbackUrl, contentType: 'hls' as const } : playbackUrl;
  const player = useVideoPlayer(source, (p) => {
    p.loop = false;
  });
  return <VideoView style={style} player={player} nativeControls contentFit="contain" />;
}

// Web parity: PhotoManager / PhotoGallery max (src/components/PhotoManager.tsx)
const MAX_PHOTOS = 6;

// Relationship intent labels (mirrored from web RelationshipIntent)
const LOOKING_FOR_LABELS: Record<string, string> = {
  'long-term': 'Long-term partner',
  'relationship': 'Relationship',
  'something-casual': 'Something casual',
  'new-friends': 'New friends',
  'figuring-out': 'Figuring it out',
};

function getVibeScoreLabel(score: number): string {
  if (score >= 90) return 'Iconic';
  if (score >= 75) return 'Fire';
  if (score >= 50) return 'Rising';
  if (score >= 25) return 'Warming Up';
  return 'Ghost Mode';
}

// Simple Vibe Score display (mirrors web VibeScore copy; no SVG ring on native)
function VibeScoreDisplay({
  score,
  size = 90,
  theme,
}: {
  score: number;
  size?: number;
  theme: { text: string; textSecondary: string; tint: string };
}) {
  const label = getVibeScoreLabel(score);
  return (
    <View style={[vibeScoreStyles.ring, { width: size, height: size, borderRadius: size / 2, borderColor: theme.tint }]}>
      <Text style={[vibeScoreStyles.scoreText, { color: theme.text }]}>{score}%</Text>
      <Text style={[vibeScoreStyles.scoreLabel, { color: theme.textSecondary }]}>{label}</Text>
    </View>
  );
}

const vibeScoreStyles = StyleSheet.create({
  ring: {
    borderWidth: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreText: {
    fontSize: 24,
    fontWeight: '700',
  },
  scoreLabel: {
    fontSize: 12,
    marginTop: 4,
    fontWeight: '600',
  },
});

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { width: winWidth } = useWindowDimensions();
  const [photoGridWidth, setPhotoGridWidth] = useState<number | null>(null);
  const photoGridGap = spacing.sm; // web gap-2 = 8px
  const effectiveGridWidth = photoGridWidth ?? Math.max(0, winWidth - layout.screenPadding.default * 2 - spacing.lg * 2);
  const photoCellSize = effectiveGridWidth > 0 ? (effectiveGridWidth - photoGridGap * 2) / 3 : 80;
  const photoMainSize = photoCellSize * 2 + photoGridGap;
  const photoMainHeight = photoMainSize * (5 / 4); // web aspect-[4/5] for main tile
  const { user, signOut, refreshOnboarding } = useAuth();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const qc = useQueryClient();
  const { data: profile, isLoading, isRefetching, refetch } = useQuery({
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
  useEffect(() => {
    if (lastAddedPhotoIndex === null) return;
    newPhotoAnim.setValue(0);
    Animated.timing(newPhotoAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start(() => {
      setLastAddedPhotoIndex(null);
    });
  }, [lastAddedPhotoIndex, newPhotoAnim]);

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
  const [saving, setSaving] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
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

  const handlePreviewProfile = () => {
    Alert.alert(
      'Profile preview',
      'Profile preview is coming to mobile soon. View your profile on web.',
      [
        { text: 'OK', style: 'cancel' },
        { text: 'Open on web', onPress: () => Linking.openURL('https://vibelymeet.com/profile').catch(() => {}) },
      ]
    );
  };

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
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow access to your photos to add a profile photo.');
        return;
      }
      // iOS: explicit FULL_SCREEN avoids native crash from Automatic presentation style
      // (see expo/expo#14903 — "modal presentation style doesn't have a corresponding presentation controller")
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
      setEditingPhotos((prev) => [path, ...prev]);
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setManageSaving(false);
    }
  };

  const removeInSheet = (index: number) => {
    setEditingPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const moveToMainInSheet = (index: number) => {
    if (index === 0) return;
    setEditingPhotos((prev) => {
      const next = [...prev];
      const [photo] = next.splice(index, 1);
      next.unshift(photo);
      return next;
    });
  };

  const moveUpInSheet = (index: number) => {
    if (index <= 0) return;
    setEditingPhotos((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  };

  const moveDownInSheet = (index: number) => {
    if (index >= editingPhotos.length - 1) return;
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
        <LoadingState title="Loading profile…" />
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
      contentContainerStyle={{ paddingBottom: spacing['2xl'] }}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching && !isLoading}
          onRefresh={refetch}
        />
      }
    >
      {/* Hero — safe area, no clipping: rounded bottom, overflow hidden to avoid black corners */}
      <View style={[styles.heroOuter, { paddingTop: insets.top }]}>
        <View style={[styles.heroGradient, { backgroundColor: theme.tint }]}>
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
        </View>
      </View>

      {/* Centered profile photo with floating video + camera buttons */}
      <View style={styles.avatarWrap}>
        <View style={[styles.avatarRing, { borderColor: theme.background }]}>
          <Avatar
            size={120}
            key={photoUrl ?? 'no-photo'}
            image={
              displayUrl ? (
                <Image source={{ uri: displayUrl }} style={styles.avatarImage} />
              ) : undefined
            }
            fallbackInitials={profile?.name?.[0] ?? 'V'}
          />
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
        {/* Identity block: name / age, tagline, location */}
        <View style={styles.identityBlock}>
          <Text style={[styles.nameAge, { color: theme.text }]} numberOfLines={1}>
            {profile?.name || 'Your name'}, {profile?.age ?? '—'}
          </Text>
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

        {/* Vibe Score card */}
        <Card style={styles.vibeScoreCard}>
          <View style={styles.vibeScoreRow}>
            <VibeScoreDisplay score={vibeScore} size={90} theme={theme} />
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

        {/* My Vibe Schedule — web handoff (explicit) */}
        <Card>
          <SettingsRow
            icon={<Ionicons name="calendar-outline" size={20} color={theme.neonCyan} />}
            title="My Vibe Schedule"
            subtitle="Manage on web"
            onPress={handleSchedulePress}
          />
        </Card>

        {/* Stats row: Events, Matches, Convos */}
        <View style={styles.statsRow}>
          {[
            { label: 'Events', value: eventsCount, icon: 'sparkles-outline' as const },
            { label: 'Matches', value: matchesCount, icon: 'heart-outline' as const },
            { label: 'Convos', value: convosCount, icon: 'flash-outline' as const },
          ].map((stat) => (
            <View key={stat.label} style={[styles.statCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Ionicons name={stat.icon} size={16} color={theme.tint} style={styles.statIcon} />
              <Text style={[styles.statValue, { color: theme.tint }]}>{stat.value}</Text>
              <Text style={[styles.statLabel, { color: theme.textSecondary }]}>{stat.label}</Text>
            </View>
          ))}
        </View>

        {/* Looking For card */}
        <Card>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleRow}>
              <Ionicons name="flag-outline" size={16} color={theme.tint} />
              <Text style={[styles.cardTitle, { color: theme.text }]}>Looking For</Text>
            </View>
            <Pressable onPress={() => setEditing(true)}>
              <Text style={[styles.editLink, { color: theme.tint }]}>Edit </Text>
            </Pressable>
          </View>
          {lookingForLabel ? (
            <View style={[styles.intentChip, { backgroundColor: theme.accentSoft, borderColor: 'rgba(148,163,184,0.2)' }]}>
              <Text style={[styles.intentLabel, { color: theme.text }]}>{lookingForLabel}</Text>
            </View>
          ) : (
            <Text style={[styles.placeholder, { color: theme.textSecondary }]}>
              Be upfront. It saves everyone time.
            </Text>
          )}
        </Card>

        {/* About Me card */}
        <Card>
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>About Me</Text>
            <Pressable onPress={() => setEditing(true)}>
              <Text style={[styles.editLink, { color: theme.tint }]}>Edit </Text>
            </Pressable>
          </View>
          <Text style={[styles.aboutText, { color: theme.textSecondary }]}>
            {profile?.about_me || 'Write something that makes them swipe right...'}
          </Text>
        </Card>

        {/* Conversation Starters — Vibely polish */}
        <SectionHeader title="Conversation Starters" />
        <Card style={[styles.promptsEmpty, { borderColor: theme.border }]}>
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
        </Card>

        {/* My Vibes */}
        <SectionHeader
          title="My Vibes"
          action={
            <Pressable onPress={() => setEditing(true)}>
              <Text style={[styles.editLink, { color: theme.tint }]}>Edit</Text>
            </Pressable>
          }
        />
        <Card>
          <Text style={[styles.placeholder, { color: theme.textSecondary }]}>
            No vibes yet. Add some personality!
          </Text>
        </Card>

        {/* Vibe Video card — premium feel */}
        <SectionHeader title="Vibe Video" />
        <View style={[styles.vibeVideoShell, { backgroundColor: theme.surfaceSubtle, borderWidth: 1, borderColor: theme.border }]}>
          {vibeStatus === 'uploading' && (
            <>
              <Ionicons name="cloud-upload-outline" size={48} color={theme.textSecondary} style={{ opacity: 0.6 }} />
              <Text style={[styles.vibeVideoCopy, { color: theme.textSecondary }]}>Uploading…</Text>
            </>
          )}
          {vibeStatus === 'processing' && (
            <>
              <Ionicons name="sync-outline" size={48} color={theme.textSecondary} style={{ opacity: 0.6 }} />
              <Text style={[styles.vibeVideoCopy, { color: theme.textSecondary }]}>Processing your video…</Text>
            </>
          )}
          {vibeStatus === 'ready' && (() => {
            const playbackUrl = getVibeVideoPlaybackUrl(profile?.bunny_video_uid);
            return (
              <>
                <Ionicons name="checkmark-circle-outline" size={48} color={theme.tint} />
                <Text style={[styles.vibeVideoCopy, { color: theme.text }]}>Your vibe video is ready.</Text>
                {playbackUrl ? (
                  <View style={[styles.vibeVideoPlayerWrap, { backgroundColor: theme.background }]}>
                    <VibeVideoPlayer playbackUrl={playbackUrl} style={styles.vibeVideoPlayer} />
                  </View>
                ) : (
                  <Text style={[styles.vibeVideoCopy, { color: theme.textSecondary, fontSize: 13 }]}>
                    Playback requires EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME in .env
                  </Text>
                )}
                <VibelyButton label="Record new" onPress={handleVibeVideoPress} variant="secondary" style={{ marginTop: spacing.sm }} />
                <Pressable onPress={handleDeleteVibeVideo} style={{ marginTop: spacing.sm }}>
                  <Text style={{ color: theme.danger, fontSize: 14 }}>Delete video</Text>
                </Pressable>
              </>
            );
          })()}
          {vibeStatus === 'failed' && (
            <>
              <Ionicons name="alert-circle-outline" size={48} color={theme.danger} style={{ opacity: 0.8 }} />
              <Text style={[styles.vibeVideoCopy, { color: theme.textSecondary }]}>Processing failed. Try recording again.</Text>
              <VibelyButton label="Record again" onPress={handleVibeVideoPress} variant="secondary" style={{ marginTop: spacing.sm }} />
            </>
          )}
          {(vibeStatus === 'none' || !vibeStatus) && (
            <>
              <Ionicons name="videocam-outline" size={48} color={theme.textSecondary} style={{ opacity: 0.3 }} />
              <Text style={[styles.vibeVideoCopy, { color: theme.textSecondary }]}>
                Record a short video to show your vibe.
              </Text>
              <VibelyButton
                label="Record vibe video"
                onPress={handleVibeVideoPress}
                variant="secondary"
                style={{ marginTop: spacing.sm }}
              />
            </>
          )}
        </View>

        {/* Photos section — web parity: responsive grid, count, Manage opens sheet */}
        <Card>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleRow}>
              <Ionicons name="camera-outline" size={16} color={theme.tint} />
              <Text style={[styles.cardTitle, { color: theme.text }]}>Photos</Text>
              {profile?.photos && profile.photos.length > 0 && (
                <Text style={[styles.photoCountBadge, { color: theme.textSecondary }]}>
                  {profile.photos.length} / {MAX_PHOTOS}
                </Text>
              )}
            </View>
            <Pressable
              onPress={profile?.photos && profile.photos.length > 0 ? openManageSheet : handleAddPhoto}
              disabled={photoUploading}
              style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}
            >
              <Text style={[styles.editLink, { color: theme.tint }]}>
                {photoUploading ? 'Uploading…' : (profile?.photos && profile.photos.length > 0 ? 'Manage' : 'Add photo')}
              </Text>
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
                      isMain ? { width: photoMainSize, height: photoMainHeight } : { width: photoCellSize, height: photoCellSize },
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
                      <View style={[styles.photoMainBadge, { backgroundColor: theme.glassSurface }]}>
                        <Ionicons name="sparkles" size={11} color={theme.accent} />
                        <Text style={[styles.photoMainBadgeText, { color: theme.accent }]}>Main</Text>
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
            <Pressable onPress={handleAddPhoto} disabled={photoUploading} style={[styles.photoEmpty, { borderColor: theme.border }]}>
              <Ionicons name="add-circle-outline" size={32} color={theme.textSecondary} />
              <Text style={[styles.placeholder, { color: theme.textSecondary }]}>
                Tap to add a profile photo (max {MAX_PHOTOS})
              </Text>
            </Pressable>
          )}
        </Card>

        {/* The Basics */}
        <Card>
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>The Basics</Text>
            <Pressable onPress={() => setEditing(true)}>
              <Text style={[styles.editLink, { color: theme.tint }]}>Edit </Text>
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
              <View key={item.label} style={[styles.basicRow, { backgroundColor: theme.surfaceSubtle }]}>
                <Ionicons name={item.icon} size={16} color={theme.textSecondary} />
                <View style={styles.basicRowText}>
                  <Text style={[styles.basicLabel, { color: theme.textSecondary }]}>{item.label}</Text>
                  <Text style={[styles.basicValue, { color: theme.text }]} numberOfLines={1}>{item.value}</Text>
                </View>
              </View>
            ))}
          </View>
        </Card>

        {/* Lifestyle — shell */}
        <Card>
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>Lifestyle</Text>
            <Pressable onPress={() => setEditing(true)}>
              <Text style={[styles.editLink, { color: theme.tint }]}>Edit </Text>
            </Pressable>
          </View>
          <Text style={[styles.placeholder, { color: theme.textSecondary }]}>
            Help find someone compatible with your lifestyle.
          </Text>
        </Card>

        {/* Verification — web parity copy */}
        <Card>
          <View style={styles.verificationHeader}>
            <Ionicons name="shield-checkmark-outline" size={20} color={theme.neonCyan} />
            <Text style={[styles.cardTitle, { color: theme.text }]}>Verification</Text>
          </View>
          <Text style={[styles.placeholder, { color: theme.textSecondary }]}>
            Verify your email, photo, and phone on vibelymeet.com to get a verified badge and stand out.
          </Text>
        </Card>

        {/* Invite Friends */}
        <Card>
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

    {/* Fullscreen gallery — web parity: index/total, swipe pager, bottom thumbnail strip */}
    <Modal
      visible={showPhotoViewer}
      transparent
      animationType="fade"
      onRequestClose={() => setShowPhotoViewer(false)}
    >
      <RNView style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.96)' }]}>
        {/* Header: index/total + close */}
        <RNView style={[styles.galleryHeader, { paddingTop: insets.top + 8 }]}>
          <Text style={styles.galleryIndexText}>
            {photoViewerPhotos.length > 0 ? `${galleryCurrentIndex + 1} / ${photoViewerPhotos.length}` : ''}
          </Text>
          <Pressable onPress={() => setShowPhotoViewer(false)} style={({ pressed }) => [{ padding: 8, opacity: pressed ? 0.8 : 1 }]}>
            <Ionicons name="close" size={28} color="#fff" />
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
          <RNView style={[styles.galleryThumbStrip, { paddingBottom: insets.bottom + 12 }]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.galleryThumbStripContent}>
              {photoViewerPhotos.map((url, index) => (
                <Pressable
                  key={`thumb-${index}`}
                  style={[
                    styles.galleryThumb,
                    index === galleryCurrentIndex && { borderColor: theme.tint, borderWidth: 2 },
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
      </RNView>
    </Modal>

    {/* Manage Your Gallery sheet — web parity: add, remove, make main, reorder */}
    <Modal
      visible={showManageSheet}
      transparent
      animationType="slide"
      onRequestClose={() => !manageSaving && setShowManageSheet(false)}
    >
      <Pressable style={styles.manageSheetBackdrop} onPress={() => !manageSaving && setShowManageSheet(false)}>
        <RNView style={[styles.manageSheetContent, { paddingBottom: insets.bottom + spacing.lg }]} onStartShouldSetResponder={() => true}>
          <View style={[styles.manageSheetHandle, { backgroundColor: theme.border }]} />
          <Text style={[styles.manageSheetTitle, { color: theme.text }]}>Manage Your Gallery</Text>
          <Text style={[styles.manageSheetSubtitle, { color: theme.textSecondary }]}>First impressions matter. Make them count.</Text>
          <ScrollView style={styles.manageSheetList} showsVerticalScrollIndicator={false}>
            {editingPhotos.map((url, index) => (
              <View key={`edit-${url}-${index}`} style={[styles.manageSheetRow, { backgroundColor: theme.surfaceSubtle }]}>
                <Image source={{ uri: avatarUrl(url) }} style={styles.manageSheetThumb} />
                <View style={styles.manageSheetRowBody}>
                  <Text style={[styles.manageSheetRowLabel, { color: theme.text }]}>
                    {index === 0 ? 'Main photo' : `Photo ${index + 1}`}
                  </Text>
                  <View style={styles.manageSheetRowActions}>
                    {index !== 0 && (
                      <Pressable style={[styles.manageSheetBtn, { backgroundColor: theme.tintSoft }]} onPress={() => moveToMainInSheet(index)}>
                        <Ionicons name="sparkles" size={14} color={theme.tint} />
                        <Text style={[styles.manageSheetBtnText, { color: theme.tint }]}>Main</Text>
                      </Pressable>
                    )}
                    {index > 1 && (
                      <Pressable style={[styles.manageSheetBtn, { backgroundColor: theme.surface }]} onPress={() => moveUpInSheet(index)}>
                        <Ionicons name="chevron-up" size={14} color={theme.text} />
                      </Pressable>
                    )}
                    {index < editingPhotos.length - 1 && index >= 0 && (
                      <Pressable style={[styles.manageSheetBtn, { backgroundColor: theme.surface }]} onPress={() => moveDownInSheet(index)}>
                        <Ionicons name="chevron-down" size={14} color={theme.text} />
                      </Pressable>
                    )}
                    <Pressable style={[styles.manageSheetBtn, { backgroundColor: theme.dangerSoft }]} onPress={() => removeInSheet(index)}>
                      <Ionicons name="trash-outline" size={14} color={theme.danger} />
                    </Pressable>
                  </View>
                </View>
              </View>
            ))}
            {editingPhotos.length < MAX_PHOTOS && (
              <Pressable
                style={[styles.manageSheetAddRow, { borderColor: theme.border }]}
                onPress={addPhotoInSheet}
                disabled={manageSaving}
              >
                <Ionicons name="add-circle-outline" size={24} color={theme.tint} />
                <Text style={[styles.manageSheetAddText, { color: theme.tint }]}>
                  {manageSaving ? 'Uploading…' : `Add photo (${editingPhotos.length}/${MAX_PHOTOS})`}
                </Text>
              </Pressable>
            )}
          </ScrollView>
          <View style={styles.manageSheetFooter}>
            <VibelyButton label="Cancel" variant="secondary" onPress={() => setShowManageSheet(false)} disabled={manageSaving} style={{ flex: 1 }} />
            <VibelyButton label={manageSaving ? 'Saving…' : 'Save Changes'} onPress={saveManageSheet} disabled={manageSaving || editingPhotos.length === 0} style={{ flex: 1 }} />
          </View>
        </RNView>
      </Pressable>
    </Modal>
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
  avatarRing: {
    borderWidth: 5,
    borderRadius: 999,
    padding: 3,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 999,
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
    paddingHorizontal: spacing.lg,
    maxWidth: layout.contentWidth,
    alignSelf: 'center',
    width: '100%',
  },
  identityBlock: {
    alignItems: 'center',
    marginBottom: spacing.xl,
    marginTop: spacing.sm,
  },
  nameAge: {
    ...typography.titleLG,
    fontSize: 24,
    marginBottom: spacing.sm,
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
    marginBottom: spacing.lg + 4,
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
    gap: spacing.md + 2,
    marginBottom: spacing.xl,
  },
  statCard: {
    flex: 1,
    padding: spacing.lg + 2,
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
  sectionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
    marginTop: spacing.lg + 4,
  },
  sectionTitle: {
    ...typography.titleMD,
  },
  promptsEmpty: {
    marginBottom: spacing.md,
  },
  promptsEmptyInner: {
    alignItems: 'center',
    paddingVertical: spacing.xl + 4,
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
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  photoGridTile: {
    borderRadius: radius['2xl'], // web rounded-2xl
    overflow: 'hidden',
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
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  photoMainBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  photoEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: radius.lg,
  },
  galleryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  galleryIndexText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
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
  photoCountBadge: {
    fontSize: 12,
    marginLeft: spacing.sm,
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
    marginBottom: spacing.xs,
  },
  manageSheetSubtitle: {
    fontSize: 14,
    marginBottom: spacing.lg,
  },
  manageSheetList: {
    maxHeight: 320,
    marginBottom: spacing.lg,
  },
  manageSheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.lg,
    marginBottom: spacing.sm,
  },
  manageSheetThumb: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    marginRight: spacing.md,
  },
  manageSheetRowBody: {
    flex: 1,
  },
  manageSheetRowLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  manageSheetRowActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  manageSheetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.md,
    gap: 4,
  },
  manageSheetBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  manageSheetAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: radius.lg,
    marginTop: spacing.sm,
  },
  manageSheetAddText: {
    fontSize: 14,
    fontWeight: '600',
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
    borderRadius: radius.lg,
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
    borderRadius: 12,
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
