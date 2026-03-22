/**
 * Vibe Video capture — UX parity with web `VibeStudioModal`:
 * idle (camera + flip + record + library upload) → recording → preview (expo-video replay)
 * → upload (tus + `saveVibeVideoToProfile`) → processing poll. Entry: optional `libraryUri` from drawer upload.
 */
import React, { useRef, useState, useEffect, useCallback, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  ActivityIndicator,
  Modal,
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
import { VideoView, useVideoPlayer } from 'expo-video';
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
import { setSafeAudioMode } from '@/lib/safeAudioMode';

const MAX_DURATION_SEC = 15;
const CAPTION_MAX = 50;

type Stage = 'idle' | 'recording' | 'preview' | 'uploading' | 'processing';

function isAbortError(e: unknown): boolean {
  return (
    e !== null &&
    typeof e === 'object' &&
    'name' in e &&
    (e as { name?: string }).name === 'AbortError'
  );
}

const RecordedPreview = memo(function RecordedPreview({
  uri,
  onError,
}: {
  uri: string;
  onError: () => void;
}) {
  const warned = useRef(false);
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
  });

  useEffect(() => {
    warned.current = false;
  }, [uri]);

  useEffect(() => {
    player.replace(uri);
    void player.play();
  }, [uri, player]);

  useEffect(() => {
    const sub = player.addListener('statusChange', (payload) => {
      if (payload.status === 'error' && !warned.current) {
        warned.current = true;
        onError();
      }
    });
    return () => sub.remove();
  }, [player, onError]);

  return (
    <VideoView style={StyleSheet.absoluteFill} player={player} nativeControls contentFit="contain" />
  );
});

function useLibraryUriParam(): string | null {
  const params = useLocalSearchParams();
  const raw = params.libraryUri;
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export default function VibeVideoRecordScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const libraryParam = useLibraryUriParam();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];

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
        setRecordedUri(result.uri);
        setStage('preview');
      }
    } catch (e) {
      setRecording(false);
      Alert.alert('Recording failed', e instanceof Error ? e.message : 'Please try again.');
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
    setRecordedUri(null);
    safeSetStage('idle');
    setUploadProgress(0);
  };

  const pickFromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to upload a video.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      videoMaxDuration: 20,
      quality: 1,
    });
    if (result.canceled || !result.assets[0]?.uri) return;
    setRecordedUri(result.assets[0].uri);
    setStage('preview');
  };

  const runPostUploadPoll = useCallback(
    (expectedVideoId: string, runId: number, pollSignal: AbortSignal) => {
      void (async () => {
        const result = await pollVibeVideoUntilTerminal({
          expectedVideoId,
          maxAttempts: 30,
          intervalMs: 5000,
          signal: pollSignal,
        });

        await qc.invalidateQueries({ queryKey: ['my-profile'] });

        if (!mountedRef.current || runId !== uploadRunIdRef.current) return;
        if (leftProcessingEarlyRef.current) return;

        if (result === 'ready') {
          router.replace('/(tabs)/profile');
          return;
        }
        if (result === 'failed') {
          Alert.alert(
            'Video Processing Failed',
            'Your video could not be processed. Please try again.',
          );
          safeSetStage('preview');
          return;
        }
        if (result === 'superseded') {
          vibeVideoDiagVerbose('upload.poll_superseded_navigate', { expectedVideoId });
          router.replace('/(tabs)/profile');
          return;
        }
        if (result === 'aborted') {
          vibeVideoDiagVerbose('upload.poll_aborted', { expectedVideoId });
          return;
        }
        Alert.alert(
          'Still Processing',
          'Your video is taking longer than expected. It will appear on your profile once ready. Pull down on Profile to refresh.',
        );
        router.replace('/(tabs)/profile');
      })();
    },
    [qc, router, safeSetStage],
  );

  const doUpload = async () => {
    if (!recordedUri) {
      Alert.alert('No video', 'Record or choose a video first.');
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
      const creds = await getCreateVideoUploadCredentials();
      await uploadVibeVideoToBunny(
        recordedUri,
        creds,
        (bytesUploaded, bytesTotal) => {
          if (bytesTotal > 0 && mountedRef.current) {
            setUploadProgress(Math.round((bytesUploaded / bytesTotal) * 100));
          }
        },
        { signal: uploadAc.signal },
      );
      await saveVibeVideoToProfile(creds.videoId, {
        vibeCaption: vibeCaption.trim() || null,
      });
      trackEvent('vibe_video_uploaded');
      safeSetStage('processing');
      runPostUploadPoll(creds.videoId, runId, pollAc.signal);
    } catch (e) {
      if (isAbortError(e)) {
        vibeVideoDiagVerbose('upload.cancelled_or_unmounted');
        return;
      }
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Please try again.');
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
    <Modal visible={captionModal} transparent animationType="fade">
      <View style={styles.captionModalBackdrop}>
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
      </View>
    </Modal>
  );

  if (!camPermission && !skipCameraPermission) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <Text style={{ color: theme.text }}>Requesting camera access…</Text>
      </View>
    );
  }

  if (!permission && !skipCameraPermission) {
    return (
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
    );
  }

  if (stage === 'uploading') {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.tint} />
        <Text style={[styles.copy, { color: theme.text, marginTop: 16 }]}>
          Uploading… {uploadProgress}%
        </Text>
      </View>
    );
  }

  if (stage === 'processing') {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background, paddingHorizontal: 28 }]}>
        <ActivityIndicator size="large" color={theme.tint} />
        <Text style={[styles.copy, { color: theme.text, marginTop: 20 }]}>Processing your video…</Text>
        <Text style={[styles.copy, { color: theme.textSecondary, fontSize: 14, marginTop: 8 }]}>
          This usually takes 15–30 seconds
        </Text>
        <Text style={[styles.processingHint, { color: theme.textSecondary }]}>
          You can return to your profile — we will keep checking in the background.
        </Text>
        <Pressable
          style={[styles.btn, { backgroundColor: theme.tint, marginTop: 28 }]}
          onPress={() => {
            leftProcessingEarlyRef.current = true;
            router.replace('/(tabs)/profile');
          }}
        >
          <Text style={styles.btnLabel}>Back to profile</Text>
        </Pressable>
      </View>
    );
  }

  if (stage === 'preview' && recordedUri) {
    return (
      <View style={styles.container}>
        <RecordedPreview
          uri={recordedUri}
          onError={() => {
            if (__DEV__) console.warn('[vibe-video-record] preview playback error');
            Alert.alert(
              'Playback',
              'Could not play this clip on device. You can still upload — our servers may process it.',
            );
          }}
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

        <View style={[styles.previewBar, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <Pressable style={styles.roundBtn} onPress={retake}>
            <Ionicons name="refresh" size={26} color="#fff" />
            <Text style={styles.roundLabel}>Retake</Text>
          </Pressable>
          <Pressable
            style={[styles.roundBtn, { backgroundColor: 'rgba(139,92,246,0.9)' }]}
            onPress={() => void doUpload()}
          >
            <Ionicons name="cloud-upload" size={26} color="#fff" />
            <Text style={[styles.roundLabel, { color: '#fff' }]}>Upload</Text>
          </Pressable>
        </View>

        {captionModalEl}
      </View>
    );
  }

  return (
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
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  copy: { fontSize: 16, textAlign: 'center' },
  btn: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8, marginTop: 16 },
  btnLabel: { color: '#fff', fontWeight: '600' },
  backBtn: { marginTop: 24 },
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
  previewBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 20,
    paddingHorizontal: 24,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  roundBtn: {
    alignItems: 'center',
    gap: 6,
    minWidth: 88,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  roundLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontFamily: fonts.bodySemiBold,
  },
  captionModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    padding: 24,
  },
  captionModalCard: {
    borderRadius: 16,
    padding: 20,
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
