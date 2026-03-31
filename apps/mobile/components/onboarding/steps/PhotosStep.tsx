import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Themed';
import { VibelyButton } from '@/components/ui';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { uploadProfilePhoto } from '@/lib/uploadImage';
import { getImageUrl } from '@/lib/imageUrl';

export default function PhotosStep({ photos, onChange, onNext }: { photos: string[]; onChange: (v: string[]) => void; onNext: () => void; }) {
  const theme = Colors[useColorScheme()];
  const [uploading, setUploading] = useState<number | null>(null);
  const photoCount = photos.length;
  const canContinue = photoCount >= 2;
  const ctaLabel = canContinue ? 'Continue' : photoCount === 1 ? 'Add 1 more to continue' : 'Add 2 to continue';

  const helperText = useMemo(() => {
    if (photoCount === 0) return 'Tip: Your first photo should clearly show your face.';
    if (photoCount === 1) return 'Great start. Add one more to continue.';
    if (photoCount === 2) return "You're good to go. Add more to boost your profile.";
    return 'Looking strong. More variety helps even more.';
  }, [photoCount]);

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
      <Text style={[styles.sub, { color: theme.textSecondary }]}>Profiles with 3+ photos get more matches.</Text>

      <Pressable
        onPress={() => (photos[0] ? onChange(photos.filter((_, i) => i !== 0)) : addPhoto())}
        style={[
          styles.mainSlot,
          {
            borderColor: photos[0] ? theme.tint : theme.tint,
            backgroundColor: photos[0] ? 'transparent' : theme.surfaceSubtle,
          },
        ]}
      >
        {photos[0] ? <Image source={{ uri: getImageUrl(photos[0]) }} style={styles.image} /> : null}
        <View style={[styles.mainBadge, { borderColor: theme.tint, backgroundColor: 'rgba(16,17,24,0.72)' }]}>
          <Text style={{ color: theme.text, fontSize: 11, fontWeight: '700' }}>Main photo</Text>
        </View>
        {!photos[0] ? (
          <View style={styles.uploadCenter}>
            {uploading === 0 ? (
              <ActivityIndicator color={theme.tint} />
            ) : (
              <>
                <View style={[styles.uploadIconWrap, { borderColor: theme.tint, backgroundColor: 'rgba(139,92,246,0.14)' }]}>
                  <Ionicons name="camera-outline" size={22} color={theme.tint} />
                  <View style={[styles.plusDot, { backgroundColor: theme.tint }]}>
                    <Ionicons name="add" size={11} color="#fff" />
                  </View>
                </View>
                <Text style={{ color: theme.textSecondary, fontSize: 12 }}>Tap to upload</Text>
              </>
            )}
          </View>
        ) : null}
      </Pressable>

      <View style={styles.supportGrid}>
        {Array.from({ length: 5 }).map((_, i) => {
          const idx = i + 1;
          const photo = photos[idx];
          const isRequired = idx === 1;
          const activeBorder = isRequired ? theme.tint : theme.border;
          return (
            <Pressable
              key={idx}
              onPress={() => (photo ? onChange(photos.filter((_, j) => j !== idx)) : addPhoto())}
              style={[
                styles.supportSlot,
                {
                  borderColor: activeBorder,
                  backgroundColor: photo ? 'transparent' : theme.surfaceSubtle,
                },
              ]}
            >
              {photo ? (
                <Image source={{ uri: getImageUrl(photo) }} style={styles.image} />
              ) : uploading === idx ? (
                <ActivityIndicator color={theme.tint} />
              ) : (
                <View style={styles.supportEmpty}>
                  <View style={[styles.supportIconWrap, { borderColor: isRequired ? theme.tint : theme.border }]}>
                    <Ionicons name="image-outline" size={18} color={isRequired ? theme.tint : theme.textSecondary} />
                    <View style={[styles.supportPlusDot, { backgroundColor: isRequired ? theme.tint : theme.textSecondary }]}>
                      <Ionicons name="add" size={9} color="#fff" />
                    </View>
                  </View>
                  {isRequired ? (
                    <Text style={{ color: theme.textSecondary, fontSize: 10, fontWeight: '600' }}>Required</Text>
                  ) : null}
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.helperRow, { borderColor: theme.border, backgroundColor: 'rgba(255,255,255,0.03)' }]}>
        <Ionicons name="sparkles-outline" size={14} color={theme.textSecondary} />
        <Text style={[styles.tip, { color: theme.textSecondary }]}>{helperText}</Text>
      </View>

      <VibelyButton
        label={ctaLabel}
        onPress={onNext}
        disabled={!canContinue}
        variant="gradient"
        style={[styles.cta, !canContinue ? styles.ctaDisabled : null]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 11, paddingTop: 1 },
  h1: { fontSize: 27, fontWeight: '600' },
  sub: { fontSize: 13, lineHeight: 18, marginBottom: 2 },
  mainSlot: {
    width: '100%',
    aspectRatio: 1.48,
    borderRadius: 18,
    borderWidth: 1.5,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mainBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  uploadCenter: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  uploadIconWrap: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusDot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  supportGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  supportSlot: {
    width: '31.5%',
    aspectRatio: 1,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  supportEmpty: { alignItems: 'center', justifyContent: 'center', gap: 6 },
  supportIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  supportPlusDot: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  helperRow: {
    marginTop: 2,
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tip: { fontSize: 12, flex: 1 },
  cta: { marginTop: 2 },
  ctaDisabled: { opacity: 0.82 },
});
