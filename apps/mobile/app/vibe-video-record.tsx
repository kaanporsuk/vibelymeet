/**
 * Vibe Video capture — UX parity with web `VibeStudioModal`:
 * idle (camera + flip + record + library upload) → recording → preview (expo-video replay)
 * → upload (tus + `saveVibeVideoToProfile`) → processing poll. Entry: optional `libraryUri` from drawer upload.
 */
import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  TextInput,
  AppState,
  type AppStateStatus,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  CameraView,
  type CameraType,
  useCameraPermissions,
  useMicrophonePermissions,
} from 'expo-camera';
import VibeVideoPlayer from '@/components/video/VibeVideoPlayer';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { fonts } from '@/constants/theme';
import {
  getCreateVideoUploadCredentials,
  uploadVibeVideoToBunny,
  saveVibeVideoToProfile,
} from '@/lib/vibeVideoApi';
import { pollVibeVideoUntilTerminal } from '@/lib/vibeVideoPoll';
import { vibeVideoDiagVerbose } from '@/lib/vibeVideoDiagnostics';
import { trackEvent } from '@/lib/analytics';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchMyProfile } from '@/lib/profileApi';
import { supabase } from '@/lib/supabase';
import { setSafeAudioMode } from '@/lib/safeAudioMode';
import { KeyboardAwareCenteredModal } from '@/components/keyboard/KeyboardAwareCenteredModal';
import { useVibelyDialog } from '@/components/VibelyDialog';

const MAX_DURATION_SEC = 15;
const CAPTION_MAX = 50;
const SUPABASE_PROJECT_REF = (() => {
  try {
    const raw = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
    const host = new URL(raw).hostname;
    return host.split('.')[0] ?? 'unknown';
  } catch {
    return 'unknown';
  }
})();

type Stage = 'idle' | 'recording' | 'preview' | 'uploading' | 'processing';

function isAbortError(e: unknown): boolean {
  return (
    e !== null &&
    typeof e === 'object' &&
    'name' in e &&
    (e as { name?: string }).name === 'AbortError'
  );
}

function useLibraryUriParam(): string | null {
  const params = useLocalSearchParams();
  const raw = params.libraryUri;
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function useOnboardingFlowParam(): boolean {
  const params = useLocalSearchParams();
  const raw = params.onboardingFlow;
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === '1';
}

function useSourceIntentParam(): 'record' | 'library' {
  const params = useLocalSearchParams();
  const raw = params.sourceIntent;
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === 'library' ? 'library' : 'record';
}

function ProcessingScreen({
  theme,
  onGoBack,
  ctaLabel,
}: {
  theme: typeof Colors.light;
  onGoBack: () => void;
  ctaLabel?: string;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const message =
    elapsed < 10
      ? 'Preparing your video…'
      : elapsed < 30
        ? 'Almost there…'
        : elapsed < 60
          ? 'Taking a bit longer than usual…'
          : 'Still working on it. You can go back and we\u2019ll notify you.';

  return (
    <View style={[styles.centered, { backgroundColor: theme.background, paddingHorizontal: 28 }]}>
      <ActivityIndicator size="large" color={theme.tint} />
      <Text style={[styles.copy, { color: theme.text, marginTop: 20 }]}>Processing your video…</Text>
      <Text style={[styles.copy, { color: theme.textSecondary, fontSize: 14, marginTop: 8 }]}>
        {message}
      </Text>
      <Text style={[styles.processingElapsed, { color: theme.textSecondary }]}>
        {elapsed}s
      </Text>
      <Text style={[styles.processingHint, { color: theme.textSecondary }]}>
        You can return to your profile — we'll keep checking in the background.
      </Text>
      <Pressable
        style={[styles.btn, { backgroundColor: theme.tint, marginTop: 28 }]}
        onPress={onGoBack}
      >
        <Text style={styles.btnLabel}>{ctaLabel ?? 'Back to profile'}</Text>
      </Pressable>
    </View>
  );
}

export default function VibeVideoRecordScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const libraryParam = useLibraryUriParam();
  const onboardingFlow = useOnboardingFlowParam();
  const sourceIntent = useSourceIntentParam();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { show, dialog } = useVibelyDialog();

  const { data: myProfile } = useQuery({ queryKey: ['my-profile'], queryFn: fetchMyProfile });

  const [camPermission, requestCamPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const libraryHandled = useRef(false);
  const captionSeededFromProfile = useRef(false);

  const mountedRef = useRef(true);
  const uploadRunIdRef = useRef(0);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const uploadInFlightRef = useRef(false);
  const leftProcessingEarlyRef = useRef(false);
  const uploadSourceRef = useRef<'camera' | 'library' | 'unknown'>('unknown');
  const sourceIntentHandledRef = useRef(false);
  const lastUploadedVideoIdRef = useRef<string | null>(null);

  const [stage, setStage] = useState<Stage>('idle');
  const [facing, setFacing] = useState<CameraType>('front');
  const [recording, setRecording] = useState(false);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [vibeCaption, setVibeCaption] = useState('');
  const [captionModal, setCaptionModal] = useState(false);
  const [captionDraft, setCaptionDraft] = useState('');

  const safeSetStage = useCallback((s: Stage) => {
    if (mountedRef.current) setStage(s);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      uploadAbortRef.current?.abort();
      pollAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const onAppState = (next: AppStateStatus) => {
      if (next === 'active') {
        void qc.invalidateQueries({ queryKey: ['my-profile'] });
      }
    };
    const sub = AppState.addEventListener('change', onAppState);
    return () => sub.remove();
  }, [qc]);

  const permission = !!(camPermission?.granted && micPermission?.granted);
  const skipCameraPermission = !!libraryParam;

  useEffect(() => {
    if (libraryParam && !libraryHandled.current) {
      libraryHandled.current = true;
      uploadSourceRef.current = 'library';
      setRecordedUri(libraryParam);
      setStage('preview');
    }
  }, [libraryParam]);

  useEffect(() => {
    if (captionSeededFromProfile.current) return;
    const existing = myProfile?.vibe_caption?.trim();
    if (!existing) return;
    captionSeededFromProfile.current = true;
    setVibeCaption(existing);
  }, [myProfile?.vibe_caption]);

  useEffect(() => {
    if (stage !== 'preview' || !recordedUri) return;
    void setSafeAudioMode({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    });
    return () => {
      void setSafeAudioMode({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: false,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
      });
    };
  }, [stage, recordedUri]);

  const requestPermission = async () => {
    await requestCamPermission();
    await requestMicPermission();
  };

  const returnToOnboarding = useCallback((videoId: string) => {
    router.replace({
      pathname: '/(onboarding)',
      params: {
        onboardingVideoUid: videoId,
        onboardingVideoRecorded: '1',
        onboardingVideoToken: `${Date.now()}`,
      },
    });
  }, [router]);

  const startRecording = async () => {
    if (!cameraRef.current || !permission) return;
    if (stage !== 'idle') return;
    setRecording(true);
    try {
      const result = await cameraRef.current.recordAsync({
        maxDuration: MAX_DURATION_SEC,
      });
      setRecording(false);
      if (result?.uri) {
        uploadSourceRef.current = 'camera';
        setRecordedUri(result.uri);
        setStage('preview');
      }
    } catch (e) {
      setRecording(false);
      show({
        title: 'Recording failed',
        message: e instanceof Error ? e.message : 'Please try again.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    }
  };

  const stopRecording = () => {
    try {
      cameraRef.current?.stopRecording();
    } catch {
      setRecording(false);
    }
  };

  const retake = () => {
    uploadAbortRef.current?.abort();
    pollAbortRef.current?.abort();
    uploadSourceRef.current = 'unknown';
    setRecordedUri(null);
    safeSetStage('idle');
    setUploadProgress(0);
  };

  const pickFromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      show({
        title: 'Library access',
        message: 'Allow photo library access to upload a video.',
        variant: 'info',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      videoMaxDuration: 20,
      quality: 1,
    });
    if (result.canceled || !result.assets[0]?.uri) return;
    uploadSourceRef.current = 'library';
    setRecordedUri(result.assets[0].uri);
    setStage('preview');
  };

  useEffect(() => {
    if (!onboardingFlow || sourceIntent !== 'library') return;
    if (sourceIntentHandledRef.current) return;
    if (stage !== 'idle') return;
    sourceIntentHandledRef.current = true;
    void pickFromLibrary();
  }, [onboardingFlow, sourceIntent, stage]);

  const runPostUploadPoll = useCallback(
    (expectedVideoId: string, runId: number, pollSignal: AbortSignal) => {
      void (async () => {
        const result = await pollVibeVideoUntilTerminal({
          expectedVideoId,
          maxAttempts: 30,
          intervalMs: 5000,
          signal: pollSignal,
        });
        vibeVideoDiagVerbose('upload.poll.result', { expectedVideoId, result });

        // Refetch (not just invalidate) so ProfileStudio gets fresh data before we navigate
        await qc.refetchQueries({ queryKey: ['my-profile'] });

        if (!mountedRef.current || runId !== uploadRunIdRef.current) return;
        if (leftProcessingEarlyRef.current) {
          // User already left — the refetch above ensures profile is fresh when they return
          return;
        }

        if (result === 'ready') {
          if (onboardingFlow) {
            returnToOnboarding(expectedVideoId);
            return;
          }
          safeSetStage('idle');
          show({
            title: 'Your Vibe Video is live!',
            message: 'It’s now visible on your profile.',
            variant: 'success',
            primaryAction: { label: 'View profile', onPress: () => router.replace('/(tabs)/profile') },
          });
          return;
        }
        if (result === 'failed') {
          show({
            title: 'Processing didn’t finish',
            message: 'We couldn’t process this video. Try uploading again.',
            variant: 'destructive',
            primaryAction: { label: 'OK', onPress: () => {} },
          });
          safeSetStage('preview');
          return;
        }
        if (result === 'superseded') {
          vibeVideoDiagVerbose('upload.poll_superseded_navigate', { expectedVideoId });
          if (onboardingFlow) {
            returnToOnboarding(expectedVideoId);
            return;
          }
          router.replace('/(tabs)/profile');
          return;
        }
        if (result === 'aborted') {
          vibeVideoDiagVerbose('upload.poll_aborted', { expectedVideoId });
          return;
        }
        show({
          title: 'Still processing',
          message:
            'Your video is taking longer than usual. It’ll show on your profile when ready — pull to refresh on Profile.',
          variant: 'info',
          primaryAction: {
            label: 'OK',
            onPress: () => {
              if (onboardingFlow) {
                returnToOnboarding(expectedVideoId);
                return;
              }
              router.replace('/(tabs)/profile');
            },
          },
        });
      })();
    },
    [onboardingFlow, qc, returnToOnboarding, router, safeSetStage, show],
  );

  const doUpload = async () => {
    if (!recordedUri) {
      show({
        title: 'No video yet',
        message: 'Record a clip or choose one from your library first.',
        variant: 'info',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
      return;
    }
    if (uploadInFlightRef.current) return;

    uploadInFlightRef.current = true;
    const runId = ++uploadRunIdRef.current;
    leftProcessingEarlyRef.current = false;

    pollAbortRef.current?.abort();
    const pollAc = new AbortController();
    pollAbortRef.current = pollAc;

    const uploadAc = new AbortController();
    uploadAbortRef.current = uploadAc;

    safeSetStage('uploading');
    setUploadProgress(0);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const uploadSource = uploadSourceRef.current;
      vibeVideoDiagVerbose('upload.pipeline.start', {
        userId: user?.id ?? null,
        projectRef: SUPABASE_PROJECT_REF,
        source: uploadSource,
        uriScheme: recordedUri.includes(':') ? recordedUri.split(':')[0] : 'path',
        uriTail: recordedUri.slice(-96),
      });

      const creds = await getCreateVideoUploadCredentials({
        context: onboardingFlow ? 'onboarding' : 'profile_studio',
      });
      vibeVideoDiagVerbose('upload.pipeline.creds', {
        userId: user?.id ?? null,
        projectRef: SUPABASE_PROJECT_REF,
        videoId: creds.videoId,
        libraryId: creds.libraryId,
      });

      await uploadVibeVideoToBunny(
        recordedUri,
        creds,
        (bytesUploaded, bytesTotal) => {
          if (bytesTotal > 0 && mountedRef.current) {
            setUploadProgress(Math.round((bytesUploaded / bytesTotal) * 100));
          }
        },
        {
          signal: uploadAc.signal,
          uploadSource,
        },
      );

      await saveVibeVideoToProfile(creds.videoId, {
        vibeCaption: vibeCaption.trim() || null,
      });
      lastUploadedVideoIdRef.current = creds.videoId;
      vibeVideoDiagVerbose('upload.pipeline.profile_saved', {
        userId: user?.id ?? null,
        projectRef: SUPABASE_PROJECT_REF,
        videoId: creds.videoId,
      });

      trackEvent('vibe_video_uploaded');
      safeSetStage('processing');
      vibeVideoDiagVerbose('upload.poll.start', { videoId: creds.videoId });
      runPostUploadPoll(creds.videoId, runId, pollAc.signal);
    } catch (e) {
      if (isAbortError(e)) {
        vibeVideoDiagVerbose('upload.cancelled_or_unmounted');
        return;
      }
      show({
        title: 'Upload failed',
        message: e instanceof Error ? e.message : 'Please try again.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
      safeSetStage('preview');
    } finally {
      uploadInFlightRef.current = false;
    }
  };

  const openCaptionEditor = () => {
    setCaptionDraft(vibeCaption);
    setCaptionModal(true);
  };

  const saveCaptionFromModal = () => {
    setVibeCaption(captionDraft.slice(0, CAPTION_MAX));
    setCaptionModal(false);
  };

  const captionModalEl = (
    <KeyboardAwareCenteredModal
      visible={captionModal}
      onRequestClose={() => setCaptionModal(false)}
      animationType="fade"
      backdropColor="rgba(0,0,0,0.85)"
    >
      <View style={[styles.captionModalCard, { backgroundColor: theme.surface }]}>
        <Text style={[styles.captionModalTitle, { color: theme.text }]}>What are you vibing on?</Text>
        <TextInput
          value={captionDraft}
          onChangeText={(t) => setCaptionDraft(t.slice(0, CAPTION_MAX))}
          placeholder="Seeking a partner in crime..."
          placeholderTextColor={theme.mutedForeground}
          maxLength={CAPTION_MAX}
          style={[styles.captionModalInput, { borderColor: theme.border, color: theme.text }]}
          autoFocus
        />
        <Text style={{ color: theme.textSecondary, fontSize: 12, marginBottom: 12 }}>
          {captionDraft.length}/{CAPTION_MAX}
        </Text>
        <View style={styles.captionModalActions}>
          <Pressable onPress={() => setCaptionModal(false)} style={styles.captionModalGhost}>
            <Text style={{ color: theme.textSecondary }}>Cancel</Text>
          </Pressable>
          <Pressable onPress={saveCaptionFromModal} style={styles.captionModalSave}>
            <Text style={{ color: '#fff', fontWeight: '600' }}>Save</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAwareCenteredModal>
  );

  if (!camPermission && !skipCameraPermission) {
    return (
      <>
        <View style={[styles.centered, { backgroundColor: theme.background }]}>
          <Text style={{ color: theme.text }}>Requesting camera access…</Text>
        </View>
        {dialog}
      </>
    );
  }

  if (!permission && !skipCameraPermission) {
    return (
      <>
        <View style={[styles.centered, { backgroundColor: theme.background }]}>
          <Text style={[styles.copy, { color: theme.textSecondary }]}>
            Camera and microphone permission are needed to record your vibe video.
          </Text>
          <Pressable style={[styles.btn, { backgroundColor: theme.tint }]} onPress={requestPermission}>
            <Text style={styles.btnLabel}>Allow</Text>
          </Pressable>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Text style={{ color: theme.tint }}>Back</Text>
          </Pressable>
        </View>
        {dialog}
      </>
    );
  }

  if (stage === 'uploading') {
    return (
      <>
        <View style={[styles.centered, { backgroundColor: theme.background }]}>
          <ActivityIndicator size="large" color={theme.tint} />
          <Text style={[styles.copy, { color: theme.text, marginTop: 16 }]}>
            Uploading… {uploadProgress}%
          </Text>
        </View>
        {dialog}
      </>
    );
  }

  if (stage === 'processing') {
    return (
      <>
        <ProcessingScreen
          theme={theme}
          onGoBack={() => {
            if (onboardingFlow) {
              if (lastUploadedVideoIdRef.current) {
                returnToOnboarding(lastUploadedVideoIdRef.current);
                return;
              }
              router.back();
              return;
            }
            leftProcessingEarlyRef.current = true;
            qc.refetchQueries({ queryKey: ['my-profile'] });
            router.replace('/(tabs)/profile');
          }}
          ctaLabel={onboardingFlow ? 'Continue onboarding' : 'Back to profile'}
        />
        {dialog}
      </>
    );
  }

  if (stage === 'preview' && recordedUri) {
    return (
      <>
      <View style={styles.container}>
        <View style={styles.previewStageColumn}>
          <View style={styles.previewPlayerShell}>
            <VibeVideoPlayer
              sourceUri={recordedUri}
              playing={stage === 'preview'}
              nativeControls
              contentFit="contain"
              style={styles.previewPlayerFlex}
              diagContext="record-preview"
              onPlayerFatalError={() => {
                vibeVideoDiagVerbose('record-preview.playback_error', {});
                show({
                  title: 'Playback issue',
                  message: 'We couldn’t play this clip here. You can still upload — our servers may process it fine.',
                  variant: 'warning',
                  primaryAction: { label: 'OK', onPress: () => {} },
                });
              }}
            />

            <Pressable
              style={[styles.closeBtn, { top: Math.max(insets.top, 12) + 8 }]}
              onPress={() => router.back()}
            >
              <Ionicons name="close" size={28} color="#fff" />
            </Pressable>

            <Pressable
              style={[styles.captionPill, { top: Math.max(insets.top, 12) + 56 }]}
              onPress={openCaptionEditor}
            >
              {vibeCaption.trim() ? (
                <Text style={styles.captionPillText} numberOfLines={1}>
                  {vibeCaption.trim()}
                </Text>
              ) : (
                <Text style={styles.captionPillPlaceholder}>What are you vibing on? Tap to add ✦</Text>
              )}
            </Pressable>
          </View>

          <View
            style={[
              styles.previewBottomActions,
              { paddingBottom: Math.max(insets.bottom, 16) + 8 },
            ]}
          >
            <LinearGradient
              colors={['#8B5CF6', '#E84393']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.previewUploadGradient}
            >
              <Pressable
                onPress={() => void doUpload()}
                style={styles.previewUploadPressable}
              >
                <Text style={styles.previewUploadLabel}>Upload Vibe Video</Text>
              </Pressable>
            </LinearGradient>

            <Pressable onPress={retake} style={styles.previewSecondaryPressable}>
              <Text style={styles.previewSecondaryLabel}>Choose different video</Text>
            </Pressable>
          </View>
        </View>

        {captionModalEl}
      </View>
      {dialog}
      </>
    );
  }

  return (
    <>
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        mode="video"
        facing={facing}
        mirror={facing === 'front'}
      />

      <Pressable
        style={[styles.closeBtn, { top: Math.max(insets.top, 12) + 8 }]}
        onPress={() => router.back()}
      >
        <Ionicons name="close" size={28} color="#fff" />
      </Pressable>

      <Pressable style={[styles.captionPill, { top: Math.max(insets.top, 12) + 56 }]} onPress={openCaptionEditor}>
        {vibeCaption.trim() ? (
          <Text style={styles.captionPillText} numberOfLines={1}>
            {vibeCaption.trim()}
          </Text>
        ) : (
          <Text style={styles.captionPillPlaceholder}>What are you vibing on? Tap to add ✦</Text>
        )}
      </Pressable>

      <View style={[styles.idleBar, { paddingBottom: Math.max(insets.bottom, 28) }]}>
        <View style={styles.idleTopRow}>
          <Pressable
            style={styles.iconCircle}
            onPress={() => setFacing((f) => (f === 'front' ? 'back' : 'front'))}
          >
            <Ionicons name="camera-reverse-outline" size={24} color="#fff" />
          </Pressable>
        </View>

        {!recording ? (
          <View style={styles.recordRow}>
            <Pressable style={styles.linkPick} onPress={() => void pickFromLibrary()}>
              <Ionicons name="cloud-upload-outline" size={18} color="#a78bfa" />
              <Text style={styles.linkPickText}>Upload a video</Text>
            </Pressable>
            <Pressable style={styles.recordOuter} onPress={() => void startRecording()}>
              <View style={styles.recordInner} />
            </Pressable>
            <Text style={styles.hint}>Tap to record ({MAX_DURATION_SEC}s)</Text>
          </View>
        ) : (
          <View style={styles.recBar}>
            <Pressable style={styles.stopBtn} onPress={stopRecording}>
              <View style={styles.stopInner} />
            </Pressable>
            <Text style={styles.hint}>Recording… tap stop when ready</Text>
          </View>
        )}
      </View>

      {captionModalEl}
    </View>
    {dialog}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  previewStageColumn: {
    flex: 1,
    minHeight: 0,
  },
  previewPlayerShell: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
  },
  previewPlayerFlex: {
    flex: 1,
  },
  previewBottomActions: {
    paddingHorizontal: 20,
    paddingTop: 16,
    backgroundColor: 'rgba(0,0,0,0.85)',
    gap: 12,
  },
  previewUploadGradient: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  previewUploadPressable: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewUploadLabel: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  previewSecondaryPressable: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  previewSecondaryLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 15,
    fontWeight: '500',
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  copy: { fontSize: 16, textAlign: 'center' },
  btn: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8, marginTop: 16 },
  btnLabel: { color: '#fff', fontWeight: '600' },
  backBtn: { marginTop: 24 },
  processingElapsed: {
    fontSize: 13,
    marginTop: 12,
    opacity: 0.6,
  },
  processingHint: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 18,
    maxWidth: 320,
  },
  closeBtn: {
    position: 'absolute',
    right: 16,
    zIndex: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captionPill: {
    position: 'absolute',
    left: 24,
    right: 24,
    zIndex: 15,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  captionPillText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  captionPillPlaceholder: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 14,
    textAlign: 'center',
  },
  idleBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  idleTopRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 16,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordRow: {
    alignItems: 'center',
    gap: 12,
  },
  recordOuter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: '#f43f5e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#f43f5e',
  },
  linkPick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  linkPickText: {
    color: '#a78bfa',
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
  },
  hint: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 13,
  },
  recBar: {
    alignItems: 'center',
    gap: 12,
  },
  stopBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#f43f5e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopInner: {
    width: 28,
    height: 28,
    backgroundColor: '#fff',
    borderRadius: 4,
  },
  captionModalCard: {
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 400,
  },
  captionModalTitle: {
    fontSize: 18,
    fontFamily: fonts.displayBold,
    textAlign: 'center',
    marginBottom: 16,
  },
  captionModalInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 8,
  },
  captionModalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  captionModalGhost: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  captionModalSave: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#8B5CF6',
    alignItems: 'center',
  },
});
