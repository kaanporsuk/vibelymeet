/**
 * Minimal vibe video record screen: camera, record up to 15s, upload via create-video-upload + tus.
 * On success, navigates back to profile. Backend: bunny_video_status uploading → processing → ready (video-webhook).
 */

import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { getCreateVideoUploadCredentials, uploadVibeVideoToBunny } from '@/lib/vibeVideoApi';

const MAX_DURATION_SEC = 15;

export default function VibeVideoRecordScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const [camPermission, requestCamPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const permission = camPermission?.granted && micPermission?.granted;
  const requestPermission = async () => {
    await requestCamPermission();
    await requestMicPermission();
  };

  const startRecording = async () => {
    if (!cameraRef.current || !permission) return;
    setRecording(true);
    try {
      const result = await cameraRef.current?.recordAsync({ maxDuration: MAX_DURATION_SEC });
      setRecording(false);
      if (result?.uri) {
        await doUpload(result.uri);
      }
    } catch (e) {
      setRecording(false);
      Alert.alert('Recording failed', e instanceof Error ? e.message : 'Please try again.');
    }
  };

  const stopRecording = async () => {
    if (!cameraRef.current) return;
    try {
      cameraRef.current?.stopRecording();
    } catch {
      setRecording(false);
    }
  };

  const doUpload = async (videoUri: string) => {
    setUploading(true);
    setUploadProgress(0);
    try {
      const creds = await getCreateVideoUploadCredentials();
      await uploadVibeVideoToBunny(videoUri, creds, (bytesUploaded, bytesTotal) => {
        if (bytesTotal > 0) {
          setUploadProgress(Math.round((bytesUploaded / bytesTotal) * 100));
        }
      });
      router.replace('/(tabs)/profile');
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setUploading(false);
    }
  };

  if (!camPermission) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <Text style={{ color: theme.text }}>Requesting camera access…</Text>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Text style={{ color: theme.tint, marginTop: 16 }}>Back</Text>
        </Pressable>
      </View>
    );
  }
  if (!permission) {
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

  if (uploading) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.tint} />
        <Text style={[styles.copy, { color: theme.text, marginTop: 16 }]}>
          Uploading… {uploadProgress}%
        </Text>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Text style={{ color: theme.tint }}>Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} mode="video" />
      <View style={styles.controls}>
        <Pressable style={styles.closeBtn} onPress={() => router.back()}>
          <Ionicons name="close" size={28} color="#fff" />
        </Pressable>
        {!recording ? (
          <Pressable style={[styles.recordBtn, { backgroundColor: theme.danger }]} onPress={startRecording}>
            <Text style={styles.recordLabel}>Record ({MAX_DURATION_SEC}s max)</Text>
          </Pressable>
        ) : (
          <Pressable style={[styles.recordBtn, { backgroundColor: theme.danger }]} onPress={stopRecording}>
            <Text style={styles.recordLabel}>Stop</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  copy: { fontSize: 16, textAlign: 'center' },
  btn: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8, marginTop: 16 },
  btnLabel: { color: '#fff', fontWeight: '600' },
  backBtn: { marginTop: 24 },
  controls: {
    position: 'absolute',
    bottom: 48,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24,
  },
  closeBtn: { position: 'absolute', left: 24, padding: 8 },
  recordBtn: { paddingVertical: 14, paddingHorizontal: 28, borderRadius: 999 },
  recordLabel: { color: '#fff', fontWeight: '600' },
});
