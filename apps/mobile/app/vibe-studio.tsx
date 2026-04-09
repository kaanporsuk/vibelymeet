import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import Colors from '@/constants/Colors';
import { fonts } from '@/constants/theme';
import { useColorScheme } from '@/components/useColorScheme';
import { useVibelyDialog } from '@/components/VibelyDialog';
import FullscreenVibeVideoModal from '@/components/video/FullscreenVibeVideoModal';
import { deleteVibeVideo, DeleteVibeVideoError } from '@/lib/vibeVideoApi';
import { fetchMyProfile, updateMyProfile } from '@/lib/profileApi';
import { resolveVibeVideoState } from '@/lib/vibeVideoState';
import { useNativeHeroVideoUpload } from '@/hooks/useNativeHeroVideoUpload';

const CAPTION_MAX = 50;

type StatusTone = {
  label: string;
  title: string;
  description: string;
  badgeBg: string;
  badgeText: string;
  icon:
    | 'checkmark-circle'
    | 'refresh-circle'
    | 'alert-circle'
    | 'videocam'
    | 'sync'
    | 'warning-outline'
    | 'cloud-upload-outline';
};

export default function VibeStudioScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { show, dialog } = useVibelyDialog();

  const { data: profile, isLoading, refetch } = useQuery({
    queryKey: ['my-profile'],
    queryFn: fetchMyProfile,
  });

  const [captionDraft, setCaptionDraft] = useState('');
  const [thumbnailError, setThumbnailError] = useState(false);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [isSavingCaption, setIsSavingCaption] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Subscribe to the module-level upload controller so live progress is shown here.
  const ctrl = useNativeHeroVideoUpload();

  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  useEffect(() => {
    setCaptionDraft(profile?.vibe_caption ?? '');
  }, [profile?.vibe_caption]);

  useEffect(() => {
    setThumbnailError(false);
  }, [profile?.bunny_video_uid, profile?.bunny_video_status]);

  // When the controller reaches a terminal state, reload profile so the page
  // reflects the latest backend truth without a manual refresh tap.
  const prevCtrlPhaseRef = useRef<string>('idle');
  useEffect(() => {
    const prev = prevCtrlPhaseRef.current;
    prevCtrlPhaseRef.current = ctrl.phase;
    if ((ctrl.phase === 'ready' || ctrl.phase === 'failed') && prev !== ctrl.phase) {
      void refetch();
    }
  }, [ctrl.phase, refetch]);

  const videoInfo = useMemo(() => resolveVibeVideoState(profile ?? null), [profile]);
  const readyAwaitingPlaybackUrl = videoInfo.state === 'ready' && !videoInfo.canPlay;
  const captionChanged = captionDraft !== (profile?.vibe_caption ?? '');

  // Effective display phase: controller overrides profile when active or terminal.
  const controllerIsActive = ctrl.phase === 'uploading' || ctrl.phase === 'processing';
  const controllerIsTerminal = ctrl.phase === 'ready' || ctrl.phase === 'failed';
  const effectivePhase =
    controllerIsActive || controllerIsTerminal ? ctrl.phase : videoInfo.state;

  const tone: StatusTone = useMemo(() => {
    if (readyAwaitingPlaybackUrl) {
      return {
        label: 'Syncing preview',
        title: 'Your video is ready on our side',
        description:
          'The clip has finished processing, but this device is still waiting on a playable preview URL. Refresh shortly.',
        badgeBg: 'rgba(245, 158, 11, 0.16)',
        badgeText: '#FBBF24',
        icon: 'sync',
      };
    }

    switch (effectivePhase) {
      case 'ready':
        return {
          label: 'Ready',
          title: 'Your Vibe Video is live',
          description:
            'Preview it full-screen, keep the caption fresh, or replace it with a sharper take without changing the shared upload pipeline.',
          badgeBg: theme.successSoft,
          badgeText: theme.success,
          icon: 'checkmark-circle',
        };
      case 'uploading':
        return {
          label: 'Uploading',
          title: ctrl.phase === 'uploading' && ctrl.uploadProgress > 0
            ? `Uploading… ${ctrl.uploadProgress}%`
            : 'Your upload is still in flight',
          description:
            'You can leave this screen — the upload continues in the background.',
          badgeBg: 'rgba(34, 211, 238, 0.14)',
          badgeText: theme.neonCyan,
          icon: 'cloud-upload-outline',
        };
      case 'processing':
        return {
          label: 'Processing',
          title: "We're preparing your Vibe Video",
          description:
            'The clip is on file and moving toward playback. You can leave this screen — processing continues on our servers.',
          badgeBg: theme.tintSoft,
          badgeText: theme.tint,
          icon: 'refresh-circle',
        };
      case 'failed':
        return {
          label: 'Needs attention',
          title: ctrl.phase === 'failed' && ctrl.errorMessage
            ? 'Upload or processing failed'
            : "Processing didn't finish",
          description:
            ctrl.phase === 'failed' && ctrl.errorMessage
              ? ctrl.errorMessage
              : 'The last upload never reached a playable state. Replace it with a new take.',
          badgeBg: theme.dangerSoft,
          badgeText: theme.danger,
          icon: 'alert-circle',
        };
      case 'error':
        return {
          label: 'Status mismatch',
          title: 'This video state looks inconsistent',
          description:
            'The backend still has video metadata, but the app cannot present it cleanly yet. Refresh, replace, or delete if it stays stuck.',
          badgeBg: 'rgba(245, 158, 11, 0.16)',
          badgeText: '#FBBF24',
          icon: 'warning-outline',
        };
      default:
        return {
          label: 'No video yet',
          title: 'Create your Vibe Video',
          description:
            'Give people a fast read on your energy before the first chat. One strong 15 second take beats another static photo.',
          badgeBg: theme.tintSoft,
          badgeText: theme.tint,
          icon: 'videocam',
        };
    }
  }, [readyAwaitingPlaybackUrl, ctrl.phase, ctrl.uploadProgress, ctrl.errorMessage, effectivePhase, theme.danger, theme.dangerSoft, theme.neonCyan, theme.success, theme.successSoft, theme.tint, theme.tintSoft]);

  const openRecorder = () => {
    router.push('/vibe-video-record');
  };

  const refreshProfile = async () => {
    await qc.invalidateQueries({ queryKey: ['my-profile'] });
    await refetch();
  };

  const handleSaveCaption = async () => {
    if (!captionChanged) return;
    setIsSavingCaption(true);
    try {
      const nextCaption = captionDraft.slice(0, CAPTION_MAX);
      await updateMyProfile({ vibe_caption: nextCaption || null });
      await refreshProfile();
      show({
        title: 'Caption updated',
        message: 'Your Vibe Video caption is now up to date.',
        variant: 'success',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    } catch (error) {
      show({
        title: "Couldn't save caption",
        message: error instanceof Error ? error.message : 'Please try again.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    } finally {
      setIsSavingCaption(false);
    }
  };

  const confirmDelete = () => {
    if (!videoInfo.canDelete || isDeleting) return;

    const deletingPipelineVideo = videoInfo.state === 'uploading' || videoInfo.state === 'processing';
    show({
      title: deletingPipelineVideo ? 'Cancel this upload?' : 'Delete vibe video?',
      message: deletingPipelineVideo
        ? 'This will remove the current in-progress Vibe Video from your profile.'
        : 'This cannot be undone.',
      variant: 'destructive',
      primaryAction: {
        label: deletingPipelineVideo ? 'Cancel & delete' : 'Delete',
        onPress: () => {
          void (async () => {
            setIsDeleting(true);
            try {
              await deleteVibeVideo();
              setShowFullscreen(false);
              await refreshProfile();
              show({
                title: 'Video removed',
                message: deletingPipelineVideo
                  ? 'The in-progress Vibe Video was removed.'
                  : 'Your Vibe Video was deleted.',
                variant: 'success',
                primaryAction: { label: 'OK', onPress: () => {} },
              });
            } catch (error) {
              const message =
                error instanceof DeleteVibeVideoError ? error.message : 'Could not delete. Try again.';
              show({
                title: "Couldn't delete video",
                message,
                variant: 'warning',
                primaryAction: { label: 'OK', onPress: () => {} },
              });
            } finally {
              setIsDeleting(false);
            }
          })();
        },
      },
      secondaryAction: { label: 'Cancel', onPress: () => {} },
    });
  };

  if (isLoading) {
    return (
      <>
        <View style={[styles.centered, { backgroundColor: theme.background }]}>
          <ActivityIndicator size="large" color={theme.tint} />
          <Text style={[styles.loadingText, { color: theme.textSecondary }]}>Opening Vibe Studio…</Text>
        </View>
        {dialog}
      </>
    );
  }

  if (!profile) {
    return (
      <>
        <View style={[styles.centered, { backgroundColor: theme.background, paddingHorizontal: 24 }]}>
          <Ionicons name="warning-outline" size={44} color="#FBBF24" />
          <Text style={[styles.emptyTitle, { color: theme.text, marginTop: 18 }]}>
            Couldn't open Vibe Studio
          </Text>
          <Text style={[styles.emptyBody, { color: theme.textSecondary }]}>
            We couldn't load your profile details right now. Try again or head back to Profile Studio.
          </Text>
          <Pressable onPress={() => void refetch()} style={[styles.primaryBtn, { backgroundColor: theme.tint }]}>
            <Text style={styles.primaryBtnText}>Try again</Text>
          </Pressable>
          <Pressable onPress={() => router.replace('/(tabs)/profile')} style={styles.secondaryLink}>
            <Text style={[styles.secondaryLinkText, { color: theme.textSecondary }]}>Back to profile</Text>
          </Pressable>
        </View>
        {dialog}
      </>
    );
  }

  const showPreviewCard = effectivePhase === 'ready' && videoInfo.canPlay;
  const statusIconColor = tone.badgeText;

  return (
    <>
      <View style={[styles.screen, { backgroundColor: theme.background }]}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 36 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <LinearGradient
            colors={['#1A1037', '#24143C', '#120D24']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.hero, { paddingTop: insets.top + 8 }]}
          >
            <Pressable
              onPress={() => router.replace('/(tabs)/profile')}
              style={styles.heroBackBtn}
              accessibilityLabel="Back to profile"
            >
              <Ionicons name="arrow-back" size={20} color="#fff" />
            </Pressable>

            <View style={styles.heroChip}>
              <Ionicons name="sparkles" size={12} color="#C4B5FD" />
              <Text style={styles.heroChipText}>VIBE STUDIO</Text>
            </View>

            <Text style={styles.heroTitle}>Show your energy before the first chat.</Text>
            <Text style={styles.heroSubtitle}>
              Record, replace, preview, and manage your Vibe Video from one dedicated surface.
            </Text>
          </LinearGradient>

          <View style={styles.content}>
            <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.glassBorder }]}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <View style={[styles.statusPill, { backgroundColor: tone.badgeBg }]}>
                    <Ionicons
                      name={tone.icon}
                      size={14}
                      color={statusIconColor}
                      style={tone.icon === 'refresh-circle' || tone.icon === 'sync' ? styles.spinIcon : undefined}
                    />
                    <Text style={[styles.statusPillText, { color: statusIconColor }]}>{tone.label}</Text>
                  </View>
                  <Text style={[styles.sectionTitle, { color: theme.text }]}>{tone.title}</Text>
                  <Text style={[styles.sectionBody, { color: theme.textSecondary }]}>{tone.description}</Text>
                </View>

                <Pressable
                  onPress={() => void refreshProfile()}
                  style={[styles.refreshBtn, { borderColor: theme.glassBorder, backgroundColor: theme.surfaceSubtle }]}
                >
                  <Ionicons name="refresh" size={16} color={theme.text} />
                  <Text style={[styles.refreshBtnText, { color: theme.text }]}>Refresh</Text>
                </Pressable>
              </View>

              {showPreviewCard ? (
                <Pressable
                  onPress={() => setShowFullscreen(true)}
                  style={[styles.previewCard, { borderColor: theme.glassBorder }]}
                >
                  {videoInfo.thumbnailUrl && !thumbnailError ? (
                    <Image
                      source={{ uri: videoInfo.thumbnailUrl }}
                      style={StyleSheet.absoluteFill}
                      resizeMode="cover"
                      onError={() => setThumbnailError(true)}
                    />
                  ) : (
                    <LinearGradient colors={['#1C1A2E', '#0D0B1A']} style={StyleSheet.absoluteFill} />
                  )}
                  <LinearGradient
                    colors={['transparent', 'rgba(0,0,0,0.72)']}
                    locations={[0.35, 1]}
                    style={StyleSheet.absoluteFill}
                  />
                  <View style={styles.previewReadyBadge}>
                    <View style={styles.previewReadyDot} />
                    <Text style={styles.previewReadyText}>READY</Text>
                  </View>
                  <View style={styles.previewPlayWrap}>
                    <View style={styles.previewPlayBtn}>
                      <Ionicons name="play" size={28} color="#fff" />
                    </View>
                  </View>
                  <View style={styles.previewCaptionWrap}>
                    <Text style={styles.previewCaptionLabel}>FULLSCREEN PREVIEW</Text>
                    <Text style={styles.previewCaptionText} numberOfLines={2}>
                      {(videoInfo.caption ?? '').trim() || 'Open your live video and preview it exactly as others see it.'}
                    </Text>
                  </View>
                </Pressable>
              ) : (
                <View style={[styles.emptyState, { backgroundColor: theme.surfaceSubtle, borderColor: theme.glassBorder }]}>
                  {effectivePhase === 'none' ? (
                    <>
                      <Ionicons name="videocam-outline" size={52} color={theme.textSecondary} style={{ opacity: 0.5 }} />
                      <Text style={[styles.emptyTitle, { color: theme.text }]}>Start with a simple hello</Text>
                      <Text style={[styles.emptyBody, { color: theme.textSecondary }]}>
                        Good light, one sentence about your vibe, and a clear smile is enough for a strong first version.
                      </Text>
                    </>
                  ) : effectivePhase === 'failed' || effectivePhase === 'error' ? (
                    <>
                      <Ionicons name="alert-circle-outline" size={52} color="#FBBF24" />
                      <Text style={[styles.emptyTitle, { color: theme.text }]}>This clip needs a fresh take</Text>
                      <Text style={[styles.emptyBody, { color: theme.textSecondary }]}>
                        Your caption stays intact, and you can replace the video without changing any backend ownership.
                      </Text>
                    </>
                  ) : effectivePhase === 'uploading' ? (
                    <>
                      <ActivityIndicator size="large" color={theme.neonCyan} />
                      <Text style={[styles.emptyTitle, { color: theme.text }]}>Uploading your Vibe Video…</Text>
                      {ctrl.phase === 'uploading' && ctrl.uploadProgress > 0 && (
                        <View style={styles.progressBarTrack}>
                          <View style={[styles.progressBarFill, { width: `${ctrl.uploadProgress}%` as `${number}%` }]} />
                        </View>
                      )}
                      <Text style={[styles.emptyBody, { color: theme.textSecondary }]}>
                        You can leave this screen — the upload continues in the background.
                      </Text>
                    </>
                  ) : (
                    <>
                      <ActivityIndicator size="large" color={theme.tint} />
                      <Text style={[styles.emptyTitle, { color: theme.text }]}>Processing your Vibe Video…</Text>
                      <Text style={[styles.emptyBody, { color: theme.textSecondary }]}>
                        The clip is on file and moving through the pipeline. You can leave this screen.
                      </Text>
                    </>
                  )}
                </View>
              )}

              <View style={styles.actionRow}>
                {showPreviewCard ? (
                  <Pressable
                    onPress={() => setShowFullscreen(true)}
                    style={[styles.secondaryAction, { borderColor: theme.glassBorder, backgroundColor: theme.surfaceSubtle }]}
                  >
                    <Ionicons name="play-outline" size={18} color={theme.text} />
                    <Text style={[styles.secondaryActionText, { color: theme.text }]}>Preview</Text>
                  </Pressable>
                ) : null}

                <LinearGradient colors={['#8B5CF6', '#E84393']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.primaryActionGradient}>
                  <Pressable onPress={openRecorder} style={styles.primaryActionPressable}>
                    <Ionicons name="videocam" size={18} color="#fff" />
                    <Text style={styles.primaryActionText}>
                      {effectivePhase === 'none' ? 'Create video' : 'Replace video'}
                    </Text>
                  </Pressable>
                </LinearGradient>

                {videoInfo.canDelete ? (
                  <Pressable
                    onPress={confirmDelete}
                    style={[styles.dangerAction, { backgroundColor: theme.dangerSoft, borderColor: 'rgba(239,68,68,0.28)' }]}
                  >
                    {isDeleting ? (
                      <ActivityIndicator size="small" color={theme.danger} />
                    ) : (
                      <Ionicons name="trash-outline" size={18} color={theme.danger} />
                    )}
                    <Text style={[styles.dangerActionText, { color: theme.danger }]}>
                      {videoInfo.state === 'uploading' || videoInfo.state === 'processing'
                        ? 'Cancel & delete'
                        : 'Delete'}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.glassBorder }]}>
              <View style={styles.captionHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sectionTitle, { color: theme.text }]}>Caption</Text>
                  <Text style={[styles.sectionBody, { color: theme.textSecondary }]}>
                    This text appears over your Vibe Video in playback. Keep it current and easy to respond to.
                  </Text>
                </View>
                <View style={[styles.captionCountPill, { backgroundColor: theme.surfaceSubtle }]}>
                  <Text style={[styles.captionCountText, { color: theme.textSecondary }]}>
                    {captionDraft.length}/{CAPTION_MAX}
                  </Text>
                </View>
              </View>

              <TextInput
                value={captionDraft}
                onChangeText={(text) => setCaptionDraft(text.slice(0, CAPTION_MAX))}
                placeholder="What are you vibing on right now?"
                placeholderTextColor={theme.textSecondary}
                multiline
                textAlignVertical="top"
                style={[
                  styles.captionInput,
                  {
                    borderColor: theme.glassBorder,
                    backgroundColor: theme.surfaceSubtle,
                    color: theme.text,
                  },
                ]}
              />

              <View style={styles.captionFooter}>
                <Text style={[styles.captionHint, { color: theme.textSecondary }]}>
                  You can update this while your video is ready, processing, or waiting for a new take.
                </Text>
                <Pressable
                  onPress={() => void handleSaveCaption()}
                  disabled={!captionChanged || isSavingCaption}
                  style={[
                    styles.captionSaveBtn,
                    {
                      backgroundColor: !captionChanged || isSavingCaption ? theme.surfaceSubtle : theme.tint,
                      opacity: !captionChanged || isSavingCaption ? 0.65 : 1,
                    },
                  ]}
                >
                  {isSavingCaption ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.captionSaveBtnText}>Save caption</Text>
                  )}
                </Pressable>
              </View>
            </View>

            <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.glassBorder }]}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>Studio guidance</Text>
              <View style={styles.guidanceList}>
                <View style={[styles.guidanceItem, { backgroundColor: theme.surfaceSubtle, borderColor: theme.glassBorder }]}>
                  <Text style={[styles.guidanceText, { color: theme.textSecondary }]}>
                    Lead with one real sentence about your energy, plans, or what kind of connection you want.
                  </Text>
                </View>
                <View style={[styles.guidanceItem, { backgroundColor: theme.surfaceSubtle, borderColor: theme.glassBorder }]}>
                  <Text style={[styles.guidanceText, { color: theme.textSecondary }]}>
                    Uploading and processing are still active video states, not empty ones, so the studio keeps that distinction honest.
                  </Text>
                </View>
                <View style={[styles.guidanceItem, { backgroundColor: theme.surfaceSubtle, borderColor: theme.glassBorder }]}>
                  <Text style={[styles.guidanceText, { color: theme.textSecondary }]}>
                    Failed clips are recoverable. Replace them here instead of treating them like “no video.”
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </ScrollView>
      </View>

      <FullscreenVibeVideoModal
        visible={showFullscreen && videoInfo.canPlay}
        onClose={() => setShowFullscreen(false)}
        playbackUrl={videoInfo.playbackUrl}
        bunnyVideoUid={videoInfo.uid}
        vibeCaption={videoInfo.caption ?? ''}
        posterUrl={videoInfo.thumbnailUrl}
      />

      {dialog}
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 14,
    fontSize: 15,
    fontFamily: fonts.body,
  },
  hero: {
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
  heroBackBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(0,0,0,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroChip: {
    marginTop: 18,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(196, 181, 253, 0.18)',
  },
  heroChipText: {
    color: '#DDD6FE',
    fontSize: 11,
    fontFamily: fonts.bodySemiBold,
    letterSpacing: 1.8,
  },
  heroTitle: {
    marginTop: 18,
    color: '#fff',
    fontSize: 30,
    lineHeight: 36,
    fontFamily: fonts.displayBold,
    maxWidth: 320,
  },
  heroSubtitle: {
    marginTop: 10,
    color: 'rgba(255,255,255,0.72)',
    fontSize: 15,
    lineHeight: 23,
    maxWidth: 340,
    fontFamily: fonts.body,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 14,
  },
  card: {
    borderRadius: 28,
    borderWidth: 1,
    padding: 18,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  statusPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    marginBottom: 12,
  },
  statusPillText: {
    fontSize: 12,
    fontFamily: fonts.bodySemiBold,
  },
  spinIcon: {
    transform: [{ rotate: '0deg' }],
  },
  refreshBtn: {
    minHeight: 40,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  refreshBtnText: {
    fontSize: 13,
    fontFamily: fonts.bodySemiBold,
  },
  sectionTitle: {
    fontSize: 21,
    lineHeight: 27,
    fontFamily: fonts.displayBold,
  },
  sectionBody: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 21,
    fontFamily: fonts.body,
  },
  previewCard: {
    marginTop: 18,
    aspectRatio: 16 / 9,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    position: 'relative',
  },
  previewReadyBadge: {
    position: 'absolute',
    top: 14,
    left: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  previewReadyDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#22c55e',
  },
  previewReadyText: {
    color: '#22c55e',
    fontSize: 11,
    fontFamily: fonts.bodySemiBold,
    letterSpacing: 1.8,
  },
  previewPlayWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewPlayBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewCaptionWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
  },
  previewCaptionLabel: {
    color: '#C4B5FD',
    fontSize: 10,
    fontFamily: fonts.bodySemiBold,
    letterSpacing: 2.2,
  },
  previewCaptionText: {
    marginTop: 6,
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fonts.bodySemiBold,
  },
  emptyState: {
    marginTop: 18,
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingVertical: 28,
    alignItems: 'center',
  },
  emptyTitle: {
    marginTop: 16,
    textAlign: 'center',
    fontSize: 20,
    lineHeight: 26,
    fontFamily: fonts.displayBold,
  },
  emptyBody: {
    marginTop: 8,
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 21,
    fontFamily: fonts.body,
    maxWidth: 320,
  },
  actionRow: {
    marginTop: 18,
    gap: 10,
  },
  secondaryAction: {
    minHeight: 48,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryActionText: {
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
  },
  primaryActionGradient: {
    borderRadius: 18,
    overflow: 'hidden',
  },
  primaryActionPressable: {
    minHeight: 52,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryActionText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: fonts.bodySemiBold,
  },
  dangerAction: {
    minHeight: 48,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  dangerActionText: {
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
  },
  captionHeader: {
    flexDirection: 'row',
    gap: 12,
  },
  captionCountPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  captionCountText: {
    fontSize: 12,
    fontFamily: fonts.bodySemiBold,
  },
  captionInput: {
    marginTop: 16,
    minHeight: 122,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 14,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: fonts.body,
  },
  captionFooter: {
    marginTop: 14,
    gap: 12,
  },
  captionHint: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fonts.body,
  },
  captionSaveBtn: {
    minHeight: 46,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  captionSaveBtnText: {
    color: '#fff',
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
  },
  guidanceList: {
    marginTop: 14,
    gap: 10,
  },
  guidanceItem: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  guidanceText: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: fonts.body,
  },
  primaryBtn: {
    marginTop: 22,
    minWidth: 180,
    minHeight: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: fonts.bodySemiBold,
  },
  secondaryLink: {
    marginTop: 14,
    paddingVertical: 6,
  },
  secondaryLinkText: {
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
  },
  progressBarTrack: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
    marginTop: 12,
    marginBottom: 4,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: '#22D3EE',
  },
});
