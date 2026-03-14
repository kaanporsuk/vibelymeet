import React, { useState, useEffect } from 'react';
import {
  TextInput,
  ScrollView,
  Alert,
  Image,
  RefreshControl,
  StyleSheet,
  Pressable,
  Share,
  Platform,
  Linking,
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
  Avatar,
  LoadingState,
  SettingsRow,
  DestructiveRow,
} from '@/components/ui';
import { spacing, radius, typography } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { Text, View } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import { fetchMyProfile, updateMyProfile } from '@/lib/profileApi';
import { uploadProfilePhoto } from '@/lib/uploadImage';
import { deleteVibeVideo } from '@/lib/vibeVideoApi';
import { avatarUrl } from '@/lib/imageUrl';

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
  const hasVibeVideo = !!profile?.bunny_video_uid;

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
      'Set when you\'re open for dates on web. Schedule is coming to mobile in a future update.',
      [
        { text: 'OK', style: 'cancel' },
        { text: 'Open on web', onPress: () => Linking.openURL('https://vibelymeet.com/schedule').catch(() => {}) },
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
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setPhotoUploading(true);
    try {
      const path = await uploadProfilePhoto({
        uri: asset.uri,
        mimeType: asset.mimeType ?? 'image/jpeg',
        fileName: asset.fileName ?? undefined,
      });
      const currentPhotos = profile?.photos ?? [];
      await updateMyProfile({ photos: [...currentPhotos, path] });
      qc.invalidateQueries({ queryKey: ['my-profile'] });
      await refreshOnboarding();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      setPhotoError(msg);
      Alert.alert('Upload failed', msg);
    } finally {
      setPhotoUploading(false);
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

  const photoUrl = profile?.avatar_url || profile?.photos?.[0];
  const displayUrl = photoUrl ? avatarUrl(photoUrl, 'profile_photo') : null;
  const eventsCount = profile?.events_attended ?? 0;
  const matchesCount = profile?.total_matches ?? 0;
  const convosCount = profile?.total_conversations ?? 0;
  const lookingForLabel = profile?.looking_for
    ? LOOKING_FOR_LABELS[profile.looking_for] ?? profile.looking_for
    : null;

  return (
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
      {/* Hero — web parity: top-left eye, top-right settings only; no global gear elsewhere */}
      <View style={[styles.heroGradient, { backgroundColor: theme.tint, paddingTop: insets.top + spacing.lg }]}>
        <View style={styles.heroButtons}>
          <Pressable
            style={[styles.heroButton, styles.heroButtonGlass]}
            onPress={handlePreviewProfile}
            accessibilityLabel="Preview profile"
          >
            <Ionicons name="eye-outline" size={24} color={theme.text} />
          </Pressable>
          <Pressable
            style={[styles.heroButton, styles.heroButtonGlassRight]}
            onPress={() => router.push('/settings')}
            accessibilityLabel="Settings"
          >
            <Ionicons name="settings-outline" size={24} color={theme.text} />
          </Pressable>
        </View>
      </View>

      {/* Centered profile photo with floating video + camera buttons */}
      <View style={styles.avatarWrap}>
        <View style={[styles.avatarRing, { borderColor: theme.background }]}>
          <Avatar
            size={120}
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

      <View style={styles.main}>
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

        {/* My Vibe Schedule card — deferred: open web or show coming-soon */}
        <Card>
          <SettingsRow
            icon={<Ionicons name="calendar-outline" size={20} color={theme.neonCyan} />}
            title="My Vibe Schedule"
            subtitle="Set when you're open for dates"
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

        {/* Conversation Starters */}
        <SectionHeader title="Conversation Starters" />
        <Card style={styles.promptsEmpty}>
          <View style={styles.promptsEmptyInner}>
            <View style={[styles.promptsEmptyIcon, { backgroundColor: theme.accentSoft }]}>
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

        {/* Vibe Video card */}
        <SectionHeader title="Vibe Video" />
        <View style={[styles.vibeVideoShell, { backgroundColor: theme.surfaceSubtle }]}>
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
          {vibeStatus === 'ready' && (
            <>
              <Ionicons name="checkmark-circle-outline" size={48} color={theme.tint} />
              <Text style={[styles.vibeVideoCopy, { color: theme.text }]}>Your vibe video is ready.</Text>
              <VibelyButton label="Record new" onPress={handleVibeVideoPress} variant="secondary" style={{ marginTop: spacing.sm }} />
              <Pressable onPress={handleDeleteVibeVideo} style={{ marginTop: spacing.sm }}>
                <Text style={{ color: theme.danger, fontSize: 14 }}>Delete video</Text>
              </Pressable>
            </>
          )}
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

        {/* Photos section */}
        <Card>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleRow}>
              <Ionicons name="camera-outline" size={16} color={theme.tint} />
              <Text style={[styles.cardTitle, { color: theme.text }]}>Photos</Text>
            </View>
            <Pressable onPress={handleAddPhoto} disabled={photoUploading}>
              <Text style={[styles.editLink, { color: theme.tint }]}>
                {photoUploading ? 'Uploading…' : 'Add photo'}
              </Text>
            </Pressable>
          </View>
          {photoError ? (
            <Text style={[styles.placeholder, { color: theme.danger, marginBottom: spacing.sm }]}>
              {photoError}
            </Text>
          ) : null}
          {profile?.photos && profile.photos.length > 0 ? (
            <View style={styles.photosRow}>
              {profile.photos.slice(0, 3).map((url, i) => (
                <View key={i} style={[styles.photoThumb, { backgroundColor: theme.surfaceSubtle }]}>
                  <Image source={{ uri: avatarUrl(url) }} style={styles.photoThumbImg} />
                </View>
              ))}
            </View>
          ) : (
            <Text style={[styles.placeholder, { color: theme.textSecondary }]}>
              Tap "Add photo" to upload a profile photo.
            </Text>
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

        {/* Verification — shell */}
        <Card>
          <View style={styles.verificationHeader}>
            <Ionicons name="shield-checkmark-outline" size={20} color={theme.neonCyan} />
            <Text style={[styles.cardTitle, { color: theme.text }]}>Verification</Text>
          </View>
          <Text style={[styles.placeholder, { color: theme.textSecondary }]}>
            Email, photo, and phone verification available on web.
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
            <TextInput
              style={[styles.input, { borderColor: theme.border, color: theme.text }]}
              value={name}
              onChangeText={setName}
              editable={!saving}
              placeholder="Your name"
              placeholderTextColor={theme.textSecondary}
            />
            <Text style={[styles.label, { color: theme.text }]}>Tagline</Text>
            <TextInput
              style={[styles.input, { borderColor: theme.border, color: theme.text }]}
              value={tagline}
              onChangeText={setTagline}
              editable={!saving}
              placeholder="e.g., Living my best life ✨"
              placeholderTextColor={theme.textSecondary}
            />
            <Text style={[styles.label, { color: theme.text }]}>Job</Text>
            <TextInput
              style={[styles.input, { borderColor: theme.border, color: theme.text }]}
              value={job}
              onChangeText={setJob}
              editable={!saving}
              placeholder="What do you do?"
              placeholderTextColor={theme.textSecondary}
            />
            <Text style={[styles.label, { color: theme.text }]}>About you</Text>
            <TextInput
              style={[styles.input, styles.textArea, { borderColor: theme.border, color: theme.text }]}
              value={aboutMe}
              onChangeText={setAboutMe}
              multiline
              numberOfLines={3}
              editable={!saving}
              placeholder="Write something that makes them want to know more..."
              placeholderTextColor={theme.textSecondary}
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
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroGradient: {
    height: 172,
    paddingHorizontal: spacing.lg,
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
    borderColor: 'rgba(255,255,255,0.24)',
  },
  heroButtonGlass: {
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  heroButtonGlassRight: {
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  avatarWrap: {
    alignItems: 'center',
    marginTop: -78,
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
    maxWidth: 512,
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
    marginBottom: spacing.sm,
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
  vibeVideoCopy: {
    fontSize: 14,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  photosRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  photoThumb: {
    width: 80,
    height: 80,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  photoThumbImg: {
    width: '100%',
    height: '100%',
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
