import React, { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Themed';
import { VibelyButton } from '@/components/ui';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { getImageUrl } from '@/lib/imageUrl';
import {
  getPhotoDraftDisplayUri,
  photoReadyPathsEqual,
  type PhotoDraftItem,
  usePhotoBatchController,
} from '@/lib/photoBatchController';
import { useVibelyDialog } from '@/components/VibelyDialog';

const MAX_PHOTOS = 6;

function onboardingPhotoUri(item: PhotoDraftItem | null | undefined) {
  const uri = getPhotoDraftDisplayUri(item);
  if (!uri) return null;
  if (item?.previewUri) return uri;
  return getImageUrl(uri);
}

export default function PhotosStep({
  photos,
  onChange,
  onNext,
  onBusyStateChange,
}: {
  photos: string[];
  onChange: (v: string[]) => void;
  onNext: () => void;
  onBusyStateChange?: (busy: boolean) => void;
}) {
  const theme = Colors[useColorScheme()];
  const { show, dialog } = useVibelyDialog();
  const {
    items,
    readyPaths,
    isUploading,
    hasFailures,
    isExitUnsafe,
    addManyFromLibrary,
    removeAtIndex,
    retryItem,
    dismissFailedItem,
  } = usePhotoBatchController({
    initialPhotos: photos,
    context: 'onboarding',
    show,
    maxPhotos: MAX_PHOTOS,
  });
  const syncedReadyPathsRef = useRef(photos);

  useEffect(() => {
    if (photoReadyPathsEqual(syncedReadyPathsRef.current, readyPaths)) return;
    syncedReadyPathsRef.current = readyPaths;
    onChange(readyPaths);
  }, [onChange, readyPaths]);

  useEffect(() => {
    onBusyStateChange?.(isExitUnsafe);
  }, [isExitUnsafe, onBusyStateChange]);

  useEffect(() => {
    return () => {
      onBusyStateChange?.(false);
    };
  }, [onBusyStateChange]);

  const photoCount = readyPaths.length;
  const canContinue = photoCount >= 2 && !isUploading && !hasFailures;
  const ctaLabel = isUploading
    ? 'Uploading…'
    : hasFailures
      ? 'Resolve failed uploads'
      : canContinue
        ? 'Continue'
        : photoCount === 1
          ? 'Add 1 more to continue'
          : 'Add 2 to continue';

  const helperText = useMemo(() => {
    if (isUploading) return 'Uploading your selected photos…';
    if (hasFailures) return 'Retry or remove failed uploads before continuing.';
    if (photoCount === 0) return 'Tip: Your first photo should clearly show your face.';
    if (photoCount === 1) return 'Great start. Add one more to continue.';
    if (photoCount === 2) return "You're good to go. Add more to boost your profile.";
    return 'Looking strong. More variety helps even more.';
  }, [hasFailures, isUploading, photoCount]);

  const totalDisplayed = items.length;

  const renderSlot = (index: number, isMain: boolean) => {
    const item = items[index] ?? null;
    const uri = onboardingPhotoUri(item);
    const isRequired = index < 2;

    return (
      <Pressable
        key={index}
        onPress={!item ? () => void addManyFromLibrary() : undefined}
        style={[
          isMain ? styles.mainSlot : styles.supportSlot,
          {
            borderColor: isMain || isRequired ? theme.tint : theme.border,
            backgroundColor: uri ? 'transparent' : theme.surfaceSubtle,
          },
        ]}
      >
        {uri ? <Image source={{ uri }} style={styles.image} /> : null}

        {isMain ? (
          <View
            style={[
              styles.mainBadge,
              { borderColor: theme.tint, backgroundColor: 'rgba(16,17,24,0.72)' },
            ]}
          >
            <Text style={{ color: theme.text, fontSize: 11, fontWeight: '700' }}>Main photo</Text>
          </View>
        ) : null}

        {item?.status === 'ready' ? (
          <Pressable
            onPress={() => removeAtIndex(index)}
            style={[styles.removeBtn, { backgroundColor: 'rgba(0,0,0,0.64)' }]}
            hitSlop={8}
          >
            <Ionicons name="close" size={14} color="#fff" />
          </Pressable>
        ) : null}

        {item?.status === 'uploading' ? (
          <View style={styles.statusOverlay}>
            <ActivityIndicator color={theme.tint} />
            <Text style={[styles.statusText, { color: theme.text }]}>Uploading…</Text>
          </View>
        ) : null}

        {item?.status === 'failed' ? (
          <View style={styles.statusOverlay}>
            <Ionicons name="alert-circle-outline" size={18} color="#fff" />
            <Text style={[styles.statusText, { color: theme.text }]}>
              {item.error ?? 'Upload failed'}
            </Text>
            <View style={styles.statusActions}>
              <Pressable
                onPress={() => void retryItem(item.id)}
                style={[styles.statusActionBtn, { backgroundColor: theme.tint }]}
              >
                <Text style={styles.statusActionText}>Retry</Text>
              </Pressable>
              <Pressable
                onPress={() => dismissFailedItem(item.id)}
                style={[styles.statusActionBtn, { backgroundColor: 'rgba(255,255,255,0.18)' }]}
              >
                <Text style={styles.statusActionText}>Remove</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {!item && isMain ? (
          <View style={styles.uploadCenter}>
            <View
              style={[
                styles.uploadIconWrap,
                { borderColor: theme.tint, backgroundColor: 'rgba(139,92,246,0.14)' },
              ]}
            >
              <Ionicons name="images-outline" size={22} color={theme.tint} />
              <View style={[styles.plusDot, { backgroundColor: theme.tint }]}>
                <Ionicons name="add" size={11} color="#fff" />
              </View>
            </View>
            <Text style={{ color: theme.textSecondary, fontSize: 12 }}>Tap to add photos</Text>
          </View>
        ) : null}

        {!item && !isMain ? (
          <View style={styles.supportEmpty}>
            <View
              style={[
                styles.supportIconWrap,
                { borderColor: isRequired ? theme.tint : theme.border },
              ]}
            >
              <Ionicons
                name="image-outline"
                size={18}
                color={isRequired ? theme.tint : theme.textSecondary}
              />
              <View
                style={[
                  styles.supportPlusDot,
                  { backgroundColor: isRequired ? theme.tint : theme.textSecondary },
                ]}
              >
                <Ionicons name="add" size={9} color="#fff" />
              </View>
            </View>
            {isRequired ? (
              <Text style={{ color: theme.textSecondary, fontSize: 10, fontWeight: '600' }}>
                Required
              </Text>
            ) : null}
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <View style={styles.root}>
      <Text style={[styles.h1, { color: theme.text }]}>Add your photos</Text>
      <Text style={[styles.sub, { color: theme.textSecondary }]}>Profiles with 3+ photos get more matches.</Text>

      {renderSlot(0, true)}

      <View style={styles.supportGrid}>
        {Array.from({ length: 5 }).map((_, i) => {
          const idx = i + 1;
          return renderSlot(idx, false);
        })}
      </View>

      <View style={[styles.helperRow, { borderColor: theme.border, backgroundColor: 'rgba(255,255,255,0.03)' }]}>
        <Ionicons name="sparkles-outline" size={14} color={theme.textSecondary} />
        <Text style={[styles.tip, { color: theme.textSecondary }]}>{helperText}</Text>
      </View>

      <Text style={[styles.multiSelectHint, { color: theme.textSecondary }]}>
        {totalDisplayed < MAX_PHOTOS
          ? 'Select multiple photos at once and they will fill the next open slots in order.'
          : 'Your gallery is full. Remove a photo to add another.'}
      </Text>

      <VibelyButton
        label={ctaLabel}
        onPress={onNext}
        disabled={!canContinue}
        variant="gradient"
        style={[styles.cta, !canContinue ? styles.ctaDisabled : null]}
      />
      {dialog}
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
  removeBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(4,6,16,0.58)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    gap: 8,
  },
  statusText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  statusActions: {
    flexDirection: 'row',
    gap: 8,
  },
  statusActionBtn: {
    minHeight: 30,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusActionText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
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
  multiSelectHint: { fontSize: 11, textAlign: 'center', marginTop: -2 },
  cta: { marginTop: 2 },
  ctaDisabled: { opacity: 0.82 },
});
