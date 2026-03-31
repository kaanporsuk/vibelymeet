import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Themed';
import { VibelyButton } from '@/components/ui';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { getCreateVideoUploadCredentials, uploadVibeVideoToBunny, saveVibeVideoToProfile } from '@/lib/vibeVideoApi';

export default function VibeVideoStep({ onNext, onMarkedRecorded }: { onNext: () => void; onMarkedRecorded: (videoUid: string) => void }) {
  const theme = Colors[useColorScheme()];
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const toFriendlyError = (raw: string) => {
    const normalized = raw.toLowerCase();
    if (normalized.includes('profile row mismatch') || normalized.includes('profile_update_failed') || normalized.includes('profile_ensure_failed')) {
      return "We couldn't start your upload just yet. Please try again.";
    }
    if (normalized.includes('not authenticated') || normalized.includes('unauthorized')) {
      return 'Your session expired. Please sign in again.';
    }
    if (normalized.includes('permission')) {
      return 'Please allow camera and photo access to add your Vibe Video.';
    }
    if (normalized.includes('network')) {
      return 'Upload failed due to connection issues. Please try again.';
    }
    return 'Video upload failed. Please try again.';
  };

  const uploadVideo = async (uri: string) => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const creds = await getCreateVideoUploadCredentials();
      await uploadVibeVideoToBunny(uri, creds);
      await saveVibeVideoToProfile(creds.videoId);
      onMarkedRecorded(creds.videoId);
      onNext();
    } catch (error: any) {
      const message = String(error?.message || 'Video upload failed. Please try again.');
      setErrorMessage(toFriendlyError(message));
    } finally {
      setLoading(false);
    }
  };

  const record = async () => {
    setErrorMessage(null);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setErrorMessage('Camera access is needed to record your Vibe Video.');
        return;
      }
      const r = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        quality: 0.8,
        videoMaxDuration: 30,
      });
      if (!r.canceled && r.assets?.[0]?.uri) await uploadVideo(r.assets[0].uri);
    } catch (error: any) {
      setErrorMessage(toFriendlyError(String(error?.message || 'Could not open camera.')));
    }
  };

  const pick = async () => {
    setErrorMessage(null);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setErrorMessage('Photo Library access is needed to upload your Vibe Video.');
        return;
      }
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Videos, quality: 0.8 });
      if (!r.canceled && r.assets?.[0]?.uri) await uploadVideo(r.assets[0].uri);
    } catch (error: any) {
      setErrorMessage(toFriendlyError(String(error?.message || 'Could not open Photo Library.')));
    }
  };

  return (
    <View style={styles.root}>
      <Text style={[styles.h1, { color: theme.text }]}>Stand out with a Vibe Video</Text>
      <Text style={[styles.sub, { color: theme.textSecondary }]}>30-second intro videos get more engagement.</Text>
      <View style={[styles.mock, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
        <Text style={{ color: theme.textSecondary }}>{loading ? 'Uploading your vibe video...' : '▶ Preview your vibe intro here'}</Text>
      </View>
      {errorMessage ? (
        <View style={[styles.errorCard, { borderColor: theme.danger, backgroundColor: 'rgba(239,68,68,0.12)' }]}>
          <Ionicons name="alert-circle-outline" size={15} color={theme.danger} />
          <Text style={[styles.errorText, { color: theme.text }]}>{errorMessage}</Text>
          <Pressable onPress={() => setErrorMessage(null)}>
            <Text style={{ color: theme.danger, fontSize: 12, fontWeight: '700' }}>Dismiss</Text>
          </Pressable>
        </View>
      ) : null}
      <VibelyButton label={loading ? 'Uploading...' : 'Record a Vibe Video'} onPress={record} variant="gradient" disabled={loading} />
      <VibelyButton label="Upload from library" onPress={pick} variant="secondary" disabled={loading} />
      <Pressable onPress={onNext}><Text style={{ color: theme.textSecondary, textAlign: 'center' }}>I'll do this later</Text></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  h1: { fontSize: 30, fontWeight: '700' },
  sub: { fontSize: 14 },
  mock: { borderWidth: 1, borderRadius: 14, minHeight: 180, alignItems: 'center', justifyContent: 'center' },
  errorCard: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorText: { flex: 1, fontSize: 12, lineHeight: 16 },
});
