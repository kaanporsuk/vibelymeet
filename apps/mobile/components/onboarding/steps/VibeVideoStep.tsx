import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Text } from '@/components/Themed';
import { VibelyButton } from '@/components/ui';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { getCreateVideoUploadCredentials, uploadVibeVideoToBunny, saveVibeVideoToProfile } from '@/lib/vibeVideoApi';

export default function VibeVideoStep({ onNext, onMarkedRecorded }: { onNext: () => void; onMarkedRecorded: (videoUid: string) => void }) {
  const theme = Colors[useColorScheme()];
  const [loading, setLoading] = useState(false);

  const uploadVideo = async (uri: string) => {
    setLoading(true);
    try {
      const creds = await getCreateVideoUploadCredentials();
      await uploadVibeVideoToBunny(uri, creds);
      await saveVibeVideoToProfile(creds.videoId);
      onMarkedRecorded(creds.videoId);
    } finally {
      setLoading(false);
      onNext();
    }
  };

  const record = async () => {
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Videos, quality: 0.8, videoMaxDuration: 30 });
    if (!r.canceled && r.assets?.[0]?.uri) await uploadVideo(r.assets[0].uri);
  };

  const pick = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Videos, quality: 0.8 });
    if (!r.canceled && r.assets?.[0]?.uri) await uploadVideo(r.assets[0].uri);
  };

  return (
    <View style={styles.root}>
      <Text style={[styles.h1, { color: theme.text }]}>Stand out with a Vibe Video</Text>
      <Text style={[styles.sub, { color: theme.textSecondary }]}>30-second intro videos get more engagement.</Text>
      <View style={[styles.mock, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
        <Text style={{ color: theme.textSecondary }}>▶ Preview your vibe intro here</Text>
      </View>
      <VibelyButton label={loading ? 'Uploading...' : 'Record a Vibe Video'} onPress={record} variant="gradient" disabled={loading} />
      <VibelyButton label="Upload from library" onPress={pick} variant="secondary" disabled={loading} />
      <Pressable onPress={onNext}><Text style={{ color: theme.textSecondary, textAlign: 'center' }}>I'll do this later</Text></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({ root: { gap: 10 }, h1: { fontSize: 30, fontWeight: '700' }, sub: { fontSize: 14 }, mock: { borderWidth: 1, borderRadius: 14, minHeight: 180, alignItems: 'center', justifyContent: 'center' } });
