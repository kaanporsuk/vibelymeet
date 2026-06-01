/**
 * Vibe Video capture — local record/preview only.
 *
 * Stages owned by this screen: idle → recording → preview
 * After the user taps "Upload Vibe Video":
 *   1. startNativeVibeVideoUpload() hands off to SDK/controller.
 *   2. This screen navigates immediately back to Vibe Studio (or onboarding).
 *   3. The controller runs tus upload + poll in the background.
 *   4. Vibe Studio subscribes to the controller and shows live status.
 *
 * No blocking "uploading…" screen. No fake wait. No time estimates.
 */
import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Platform,
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
import { vibeVideoDiagVerbose } from '@/lib/vibeVideoDiagnostics';
import { trackVibeVideoEvent, VIBE_VIDEO_EVENTS } from '@/lib/vibeVideoTelemetry';
import { useQuery } from '@tanstack/react-query';
import { fetchMyProfile, MY_PROFILE_STALE_TIME_MS, myProfileQueryKey } from '@/lib/profileApi';
import { setSafeAudioMode } from '@/lib/safeAudioMode';
import { KeyboardAwareCenteredModal } from '@/components/keyboard/KeyboardAwareCenteredModal';
import { useVibelyDialog } from '@/components/VibelyDialog';
import { PermissionRecoveryCard } from '@/components/permissions/PermissionRecoveryCard';
import { useAuth } from '@/context/AuthContext';
import { startNativeVibeVideoUpload } from '@/lib/mediaSdk/nativeVideoUploads';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { getDocumentAsyncSafe, isDocumentPickerAvailable } from '@/lib/safeDocumentPicker';
import {
  permissionUxMediaKindForRequiredGrants,
  permissionUxStatusForRequiredGrants,
  resolvePermissionUx,
  type PermissionUxStatus,
} from '@clientShared/permissions/permissionUx';
import { openPermissionSettings, useSettingsReturnRefresh } from '@/lib/permissionSettings';
import { classifyNativeMediaCaptureError, isNativeMediaPermissionError } from '@/lib/nativeMediaPickerErrors';

const MAX_DURATION_SEC = 15;
const CAPTION_MAX = 50;

// Local stages only — no 'uploading' here; controller owns that.
type Stage = 'idle' | 'recording' | 'preview';

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

export default function VibeVideoRecordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const libraryParam = useLibraryUriParam();
  const onboardingFlow = useOnboardingFlowParam();
  const sourceIntent = useSourceIntentParam();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const reduceMotion = useReduceMotion();
  const { show, dialog } = useVibelyDialog();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const { data: myProfile } = useQuery({
    queryKey: myProfileQueryKey(userId ?? 'none'),
    queryFn: () => (userId ? fetchMyProfile(userId) : Promise.resolve(null)),
    enabled: !!userId,
    staleTime: MY_PROFILE_STALE_TIME_MS,
  });

  const [camPermission, requestCamPermission, getCamPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission, getMicPermission] = useMicrophonePermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const libraryHandled = useRef(false);
  const captionSeededFromProfile = useRef(false);
  const sourceIntentHandledRef = useRef(false);
  const settingsOpenedRef = useRef(false);
  const uploadSourceRef = useRef<'camera' | 'library' | 'unknown'>('unknown');

  const [stage, setStage] = useState<Stage>('idle');
  const [facing, setFacing] = useState<CameraType>('front');
  const [recording, setRecording] = useState(false);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [vibeCaption, setVibeCaption] = useState('');
  const [captionEdited, setCaptionEdited] = useState(false);
  const [captionModal, setCaptionModal] = useState(false);
  const [captionDraft, setCaptionDraft] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const [recordIntentActive, setRecordIntentActive] = useState(sourceIntent !== 'library' && !libraryParam);
  const [recordingRecoveryStatus, setRecordingRecoveryStatus] = useState<PermissionUxStatus | null>(null);
  const chooseFileSupported = isDocumentPickerAvailable();

  // Seed caption from existing profile
  useEffect(() => {
    if (captionSeededFromProfile.current) return;
    const existing = myProfile?.vibe_caption?.trim();
    if (!existing) return;
    captionSeededFromProfile.current = true;
    setVibeCaption(existing);
    setCaptionEdited(false);
  }, [myProfile?.vibe_caption]);

  // Handle libraryUri param (from drawer upload)
  useEffect(() => {
    if (libraryParam && !libraryHandled.current) {
      libraryHandled.current = true;
      uploadSourceRef.current = 'library';
      setRecordIntentActive(false);
      setRecordedUri(libraryParam);
      setStage('preview');
    }
  }, [libraryParam]);

  // Set audio mode for preview playback
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

  const skipCameraPermission = !recordIntentActive;
  const permissionStatus: PermissionUxStatus = permissionUxStatusForRequiredGrants([camPermission, micPermission]);
  const permissionMediaKind = permissionUxMediaKindForRequiredGrants(camPermission, micPermission);
  const permission = permissionStatus === 'granted';
  const permissionCopy = resolvePermissionUx({
    capability: 'profile_vibe_video',
    status: permissionStatus,
    platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'native',
    mediaKind: permissionMediaKind,
  });
  const recordingRecoveryCopy = recordingRecoveryStatus
    ? resolvePermissionUx({
        capability: 'profile_vibe_video',
        status: recordingRecoveryStatus,
        platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'native',
      })
    : null;

  const requestPermission = async () => {
    if (permissionStatus === 'blocked_settings') {
      settingsOpenedRef.current = true;
      const opened = await openPermissionSettings('profile_vibe_video');
      if (!opened) {
        settingsOpenedRef.current = false;
        await refreshPermissions();
      }
      return;
    }
    await requestCamPermission();
    await requestMicPermission();
  };

  const refreshPermissions = useCallback(async () => {
    await Promise.allSettled([getCamPermission(), getMicPermission()]);
  }, [getCamPermission, getMicPermission]);

  useSettingsReturnRefresh({
    wasOpenedRef: settingsOpenedRef,
    refresh: refreshPermissions,
    source: 'profile_vibe_video',
  });

  const returnToVibeStudio = useCallback(() => {
    (router as { replace: (p: string) => void }).replace('/vibe-studio');
  }, [router]);

  const returnToOnboarding = useCallback(() => {
    router.replace({
      pathname: '/(onboarding)',
      params: {
        onboardingVideoRecorded: '1',
        onboardingVideoToken: `${Date.now()}`,
      },
    });
  }, [router]);

  const startRecording = async () => {
    if (!cameraRef.current || !permission) return;
    if (stage !== 'idle') return;
    setRecordingRecoveryStatus(null);
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
      setStage('idle');
      setRecordingRecoveryStatus(classifyNativeMediaCaptureError(e));
    }
  };

  const stopRecording = () => {
    try {
      cameraRef.current?.stopRecording();
    } catch {
      setRecording(false);
    }
  };

  const resetPreview = () => {
    setIsConfirming(false);
    uploadSourceRef.current = 'unknown';
    setRecordedUri(null);
    setRecordingRecoveryStatus(null);
    setStage('idle');
  };

  const pickFromDocument = async () => {
    try {
      const result = await getDocumentAsyncSafe({
        type: ['video/mp4', 'video/quicktime', 'video/*'],
        copyToCacheDirectory: true,
      });
      if (result === null) {
        show({
          title: 'Choose File unavailable',
          message: 'Rebuild the dev client after adding document picker, or choose a saved video from your library.',
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
        return;
      }
      if (result.canceled || !result.assets?.[0]?.uri) return;
      const asset = result.assets[0];
      if (asset.mimeType && !asset.mimeType.toLowerCase().startsWith('video/')) {
        show({
          title: 'Not a video',
          message: 'Please choose a video file.',
          variant: 'warning',
          primaryAction: { label: 'OK', onPress: () => {} },
        });
        return;
      }
      uploadSourceRef.current = 'library';
      setRecordingRecoveryStatus(null);
      setRecordIntentActive(false);
      setRecordedUri(asset.uri);
      setStage('preview');
    } catch (error) {
      show({
        title: 'Choose File',
        message: error instanceof Error ? error.message : 'Could not open the file picker.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
    }
  };

  const pickFromLibrary = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        videoMaxDuration: MAX_DURATION_SEC,
        quality: 1,
      });
      if (result.canceled || !result.assets[0]?.uri) return;
      uploadSourceRef.current = 'library';
      setRecordingRecoveryStatus(null);
      setRecordIntentActive(false);
      setRecordedUri(result.assets[0].uri);
      setStage('preview');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not open your video library.';
      const isPermissionError = isNativeMediaPermissionError(error);
      show({
        title: isPermissionError ? 'Video library access' : 'Video library',
        message: isPermissionError
          ? 'Photo access is off for Vibely. Re-enable it in Settings, or choose a video file.'
          : message,
        variant: isPermissionError ? 'info' : 'warning',
        primaryAction: isPermissionError
          ? chooseFileSupported
            ? { label: 'Choose file', onPress: () => void pickFromDocument() }
            : { label: 'Open Settings', onPress: () => void openPermissionSettings('profile_vibe_video_library') }
          : { label: 'Try again', onPress: () => void pickFromLibrary() },
        secondaryAction: isPermissionError
          ? chooseFileSupported
            ? { label: 'Open Settings', onPress: () => void openPermissionSettings('profile_vibe_video_library') }
            : { label: 'Not now', onPress: () => {} }
          : chooseFileSupported
            ? { label: 'Choose file', onPress: () => void pickFromDocument() }
            : undefined,
      });
    }
  };

  const handleRecordingRecoveryPrimary = useCallback(() => {
    if (!recordingRecoveryCopy) return;
    if (recordingRecoveryCopy.primaryAction === 'open_settings') {
      settingsOpenedRef.current = true;
      void openPermissionSettings('profile_vibe_video_recording_error').then((opened) => {
        if (!opened) {
          settingsOpenedRef.current = false;
          void refreshPermissions();
        }
      });
      return;
    }
    setRecordingRecoveryStatus(null);
    if (recordingRecoveryCopy.primaryAction === 'retry') {
      void startRecording();
      return;
    }
    if (recordingRecoveryCopy.primaryAction === 'upload_file') {
      void pickFromLibrary();
    }
  }, [pickFromLibrary, recordingRecoveryCopy, refreshPermissions, startRecording]);

  const chooseDifferentVideo = () => {
    const previousSource = uploadSourceRef.current;
    resetPreview();
    if (previousSource === 'library' || sourceIntent === 'library') {
      setRecordIntentActive(false);
      void pickFromLibrary();
      return;
    }
    setRecordIntentActive(true);
  };

  // Auto-launch library picker when sourceIntent=library on onboarding
  useEffect(() => {
    if (!onboardingFlow || sourceIntent !== 'library') return;
    if (sourceIntentHandledRef.current) return;
    if (stage !== 'idle') return;
    sourceIntentHandledRef.current = true;
    void pickFromLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboardingFlow, sourceIntent, stage]);

  /**
   * Confirm: hand the local URI to the controller and navigate immediately.
   * The controller owns upload → processing → ready/failed in the background.
   * Vibe Studio (or onboarding) shows live status via useNativeHeroVideoUpload().
   */
  const doConfirm = async () => {
    if (!recordedUri || isConfirming) return;

    const existingCaption = myProfile?.vibe_caption?.trim() ?? '';
    const caption =
      captionEdited || captionSeededFromProfile.current || existingCaption.length > 0
        ? vibeCaption.trim()
        : undefined;
    const context = onboardingFlow ? 'onboarding' : 'profile_studio';
    const nextCaption = vibeCaption.trim();

    vibeVideoDiagVerbose('upload.confirm', {
      source: uploadSourceRef.current,
      hasRecordedUri: !!recordedUri,
      onboardingFlow,
    });

    if (myProfile?.bunny_video_uid?.trim()) {
      trackVibeVideoEvent(VIBE_VIDEO_EVENTS.replaceStarted, {
        source: 'native_vibe_video_record',
        upload_context: context,
      });
    }
    if (!captionEdited && existingCaption.length > 0) {
      trackVibeVideoEvent(VIBE_VIDEO_EVENTS.captionPreserved, {
        source: 'native_vibe_video_record',
        upload_context: context,
      });
    } else if (captionEdited && existingCaption.length > 0 && nextCaption.length === 0) {
      trackVibeVideoEvent(VIBE_VIDEO_EVENTS.captionCleared, {
        source: 'native_vibe_video_record',
        upload_context: context,
      });
    } else if (captionEdited && nextCaption !== existingCaption) {
      trackVibeVideoEvent(VIBE_VIDEO_EVENTS.captionEdited, {
        source: 'native_vibe_video_record',
        upload_context: context,
        had_existing_caption: existingCaption.length > 0,
      });
    }
    setIsConfirming(true);
    try {
      await startNativeVibeVideoUpload({
        uri: recordedUri,
        caption,
        context,
        uploadSource: uploadSourceRef.current,
      });
    } catch (error) {
      setIsConfirming(false);
      show({
        title: "Couldn't start upload",
        message: error instanceof Error ? error.message : 'Please try again.',
        variant: 'warning',
        primaryAction: { label: 'OK', onPress: () => {} },
      });
      return;
    }

    setIsConfirming(false);
    if (onboardingFlow) {
      returnToOnboarding();
    } else {
      returnToVibeStudio();
    }
  };

  const openCaptionEditor = () => {
    setCaptionDraft(vibeCaption);
    setCaptionModal(true);
  };

  const saveCaptionFromModal = () => {
    setVibeCaption(captionDraft.slice(0, CAPTION_MAX));
    setCaptionEdited(true);
    setCaptionModal(false);
  };

  const captionModalEl = (
    <KeyboardAwareCenteredModal
      visible={captionModal}
      onRequestClose={() => setCaptionModal(false)}
      animationType={reduceMotion ? 'none' : 'fade'}
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

  // ── Permission gates ───────────────────────────────────────────────────────

  if (!recordIntentActive && stage === 'idle' && !recordedUri) {
    return (
      <>
        <View style={[styles.centered, { backgroundColor: theme.background }]}>
          <PermissionRecoveryCard
            testID="native-profile-vibe-video-library-card"
            icon="cloud-upload-outline"
            title="Choose a video"
            message="Pick a saved video for your profile. Vibely only uses the video you choose."
            primaryLabel="Choose saved video"
            onPrimaryPress={() => void pickFromLibrary()}
            fallbackLabel={chooseFileSupported ? 'Choose file' : undefined}
            onFallbackPress={chooseFileSupported ? () => void pickFromDocument() : undefined}
            secondaryLabel="Record instead"
            onSecondaryPress={() => setRecordIntentActive(true)}
          />
        </View>
        {dialog}
      </>
    );
  }

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
          <PermissionRecoveryCard
            testID="native-profile-vibe-video-permission-card"
            icon="videocam-outline"
            title={permissionCopy.title}
            message={permissionCopy.message}
            primaryLabel={permissionCopy.primaryLabel}
            onPrimaryPress={() => void requestPermission()}
            fallbackLabel={permissionCopy.fallbackLabel}
            onFallbackPress={() => void pickFromLibrary()}
            secondaryLabel="Back"
            onSecondaryPress={() => router.back()}
            loading={permissionStatus === 'checking'}
          />
        </View>
        {dialog}
      </>
    );
  }

  // ── Preview stage ──────────────────────────────────────────────────────────

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
                    message: "We couldn't play this clip here. You can still upload — our servers may process it fine.",
                    variant: 'warning',
                    primaryAction: { label: 'OK', onPress: () => {} },
                  });
                }}
              />

              <Pressable
                style={[styles.closeBtn, { top: Math.max(insets.top, 12) + 8 }, isConfirming && styles.previewActionDisabled]}
                onPress={() => router.back()}
                disabled={isConfirming}
              >
                <Ionicons name="close" size={28} color="#fff" />
              </Pressable>

              <Pressable
                style={[styles.captionPill, { top: Math.max(insets.top, 12) + 56 }, isConfirming && styles.previewActionDisabled]}
                onPress={openCaptionEditor}
                disabled={isConfirming}
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
                  onPress={() => void doConfirm()}
                  disabled={isConfirming}
                  style={[styles.previewUploadPressable, isConfirming && styles.previewActionDisabled]}
                >
                  <Text style={styles.previewUploadLabel}>
                    {isConfirming ? 'Starting upload...' : 'Post Vibe Video'}
                  </Text>
                </Pressable>
              </LinearGradient>

              <Pressable
                onPress={chooseDifferentVideo}
                disabled={isConfirming}
                style={[styles.previewSecondaryPressable, isConfirming && styles.previewActionDisabled]}
              >
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

  // ── Idle / recording stage (camera view) ──────────────────────────────────

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

        {recordingRecoveryCopy ? (
          <View style={styles.recordingRecoveryOverlay}>
            <PermissionRecoveryCard
              testID="native-profile-vibe-video-recording-recovery-card"
              icon="videocam-off-outline"
              title={recordingRecoveryCopy.title}
              message={recordingRecoveryCopy.message}
              primaryLabel={recordingRecoveryCopy.primaryLabel}
              onPrimaryPress={handleRecordingRecoveryPrimary}
              fallbackLabel={recordingRecoveryCopy.fallbackLabel}
              onFallbackPress={
                recordingRecoveryCopy.fallbackAction === 'upload_file'
                  ? () => {
                      setRecordingRecoveryStatus(null);
                      void pickFromLibrary();
                    }
                  : undefined
              }
              secondaryLabel="Back to recorder"
              onSecondaryPress={() => setRecordingRecoveryStatus(null)}
            />
          </View>
        ) : (
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
        )}

        {captionModalEl}
      </View>
      {dialog}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  previewStageColumn: { flex: 1, minHeight: 0 },
  previewPlayerShell: { flex: 1, minHeight: 0, position: 'relative' },
  previewPlayerFlex: { flex: 1 },
  previewBottomActions: {
    paddingHorizontal: 20,
    paddingTop: 16,
    backgroundColor: 'rgba(0,0,0,0.85)',
    gap: 12,
  },
  previewUploadGradient: { borderRadius: 16, overflow: 'hidden' },
  previewUploadPressable: { paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  previewActionDisabled: { opacity: 0.72 },
  previewUploadLabel: { color: '#fff', fontSize: 17, fontWeight: '700', letterSpacing: 0.3 },
  previewSecondaryPressable: { alignItems: 'center', paddingVertical: 8 },
  previewSecondaryLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 15, fontWeight: '500' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  recordingRecoveryOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    backgroundColor: 'rgba(0,0,0,0.62)',
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
  captionPillText: { color: '#fff', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  captionPillPlaceholder: { color: 'rgba(255,255,255,0.55)', fontSize: 14, textAlign: 'center' },
  idleBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  idleTopRow: { flexDirection: 'row', justifyContent: 'center', marginBottom: 16 },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordRow: { alignItems: 'center', gap: 12 },
  recordOuter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: '#f43f5e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#f43f5e' },
  linkPick: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  linkPickText: { color: '#a78bfa', fontSize: 14, fontFamily: fonts.bodySemiBold },
  hint: { color: 'rgba(255,255,255,0.65)', fontSize: 13 },
  recBar: { alignItems: 'center', gap: 12 },
  stopBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#f43f5e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopInner: { width: 28, height: 28, backgroundColor: '#fff', borderRadius: 4 },
  captionModalCard: { borderRadius: 16, padding: 20, width: '100%', maxWidth: 400 },
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
  captionModalActions: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  captionModalGhost: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  captionModalSave: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#8B5CF6',
    alignItems: 'center',
  },
});
