import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Text } from '@/components/Themed';
import { VibelyButton } from '@/components/ui';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { uploadProfilePhoto } from '@/lib/uploadImage';
import { getImageUrl } from '@/lib/imageUrl';

export default function PhotosStep({ photos, onChange, onNext }: { photos: string[]; onChange: (v: string[]) => void; onNext: () => void; }) {
  const theme = Colors[useColorScheme()];
  const [uploading, setUploading] = useState<number | null>(null);

  const addPhoto = async () => {
    if (photos.length >= 6) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, quality: 0.85 });
    if (result.canceled || !result.assets?.[0]) return;
    setUploading(photos.length);
    try {
      const path = await uploadProfilePhoto({
        uri: result.assets[0].uri,
        mimeType: result.assets[0].mimeType ?? 'image/jpeg',
        fileName: `onboarding_${Date.now()}.jpg`,
      });
      onChange([...photos, path]);
    } finally {
      setUploading(null);
    }
  };

  return (
    <View style={styles.root}>
      <Text style={[styles.h1, { color: theme.text }]}>Add your photos</Text>
      <Text style={[styles.sub, { color: theme.textSecondary }]}>Profiles with 3+ photos get way more matches.</Text>
      <View style={styles.grid}>
        {Array.from({ length: 6 }).map((_, idx) => {
          const photo = photos[idx];
          return (
            <Pressable
              key={idx}
              onPress={() => (photo ? onChange(photos.filter((_, i) => i !== idx)) : addPhoto())}
              style={[styles.slot, { borderColor: idx < 2 ? theme.tint : theme.border }]}
            >
              {photo ? (
                <Image source={{ uri: getImageUrl(photo) }} style={styles.image} />
              ) : uploading === idx ? (
                <ActivityIndicator color={theme.tint} />
              ) : (
                <Text style={{ color: theme.textSecondary }}>{idx === 0 ? 'Main +' : '+'}</Text>
              )}
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.tip, { color: theme.textSecondary }]}>💡 First photo should clearly show your face.</Text>
      <VibelyButton
        label={photos.length < 1 ? 'Add at least 2 photos' : photos.length === 1 ? 'Add 1 more photo' : 'Continue'}
        onPress={onNext}
        disabled={photos.length < 2}
        variant="gradient"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  h1: { fontSize: 30, fontWeight: '700' },
  sub: { fontSize: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  slot: { width: '31.5%', aspectRatio: 1, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  tip: { fontSize: 12 },
});
