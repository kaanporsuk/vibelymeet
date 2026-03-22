/**
 * Vibe Video manage sheet — matches web `ProfileStudio` drawer (src/pages/ProfileStudio.tsx ~1520–1601).
 * Caption is read-only on the thumbnail (edited only in the record/studio flow like web VibeStudioModal).
 */
import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  Image,
  Pressable,
  StyleSheet,
  Dimensions,
  Alert,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius, fonts } from '@/constants/theme';
import { getVibeVideoThumbnailUrl } from '@/lib/vibeVideoPlaybackUrl';
import { DeleteVibeVideoError } from '@/lib/vibeVideoApi';

const { height: SCREEN_H } = Dimensions.get('window');
const SHEET_HEIGHT = Math.min(SCREEN_H * 0.72, 640);

export type VibeVideoDrawerProps = {
  visible: boolean;
  onClose: () => void;
  /** Profile has a ready Bunny video */
  hasVibeVideo: boolean;
  bunnyVideoUid?: string | null;
  /** Read-only overlay on thumbnail (same as web drawer) */
  vibeCaption: string;
  onRecordNew: () => void;
  onOpenFullscreen: () => void;
  onDelete: () => void | Promise<void>;
};

export default function VibeVideoDrawer({
  visible,
  onClose,
  hasVibeVideo,
  bunnyVideoUid,
  vibeCaption,
  onRecordNew,
  onOpenFullscreen,
  onDelete,
}: VibeVideoDrawerProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const thumbnailUrl = getVibeVideoThumbnailUrl(bunnyVideoUid);
  const [thumbError, setThumbError] = useState(false);
  const thumbMissing = hasVibeVideo && (!thumbnailUrl || thumbError);

  useEffect(() => {
    if (visible) setThumbError(false);
  }, [visible, bunnyVideoUid]);

  const handleDelete = () => {
    Alert.alert('Delete vibe video?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await onDelete();
            onClose();
          } catch (e) {
            const msg =
              e instanceof DeleteVibeVideoError ? e.message : 'Could not delete. Try again.';
            Alert.alert('Error', msg);
          }
        },
      },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.modalRoot}>
          <Pressable style={s.backdropPress} onPress={onClose} accessibilityLabel="Close sheet" />
          <Pressable
            style={[s.sheet, { backgroundColor: theme.surface, borderColor: theme.glassBorder }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={s.handleRow}>
              <View style={[s.handle, { backgroundColor: theme.textSecondary }]} />
            </View>

            <View style={s.header}>
              <Text style={[s.title, { color: theme.text }]}>Vibe Video</Text>
              <Pressable onPress={onClose} hitSlop={12} style={s.closeBtn}>
                <Ionicons name="close" size={22} color={theme.textSecondary} />
              </Pressable>
            </View>

            <ScrollView
              style={{ maxHeight: SHEET_HEIGHT - 40 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {!hasVibeVideo ? (
                <View style={s.emptyWrap}>
                  <Ionicons name="videocam-outline" size={56} color={theme.textSecondary} style={{ opacity: 0.35 }} />
                  <Text style={[s.emptyTitle, { color: theme.text }]}>Record your Vibe Video</Text>
                  <Text style={[s.emptySub, { color: theme.textSecondary }]}>
                    Profiles with video get 3x more quality conversations
                  </Text>
                  <Pressable
                    onPress={() => {
                      onClose();
                      onRecordNew();
                    }}
                    style={s.primaryCta}
                  >
                    <LinearGradient
                      colors={['#8B5CF6', '#E84393']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={StyleSheet.absoluteFill}
                    />
                    <Text style={s.primaryCtaText}>Record now</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  <Pressable
                    style={[s.preview, { borderColor: theme.glassBorder }]}
                    onPress={() => {
                      onClose();
                      onOpenFullscreen();
                    }}
                  >
                    {thumbnailUrl && !thumbError ? (
                      <Image
                        source={{ uri: thumbnailUrl }}
                        style={StyleSheet.absoluteFill}
                        resizeMode="cover"
                        onError={() => setThumbError(true)}
                      />
                    ) : (
                      <LinearGradient colors={['#1C1A2E', '#0D0B1A']} style={StyleSheet.absoluteFill} />
                    )}
                    {thumbMissing ? (
                      <View style={s.thumbFallback} pointerEvents="none">
                        <Ionicons name="image-outline" size={28} color="rgba(255,255,255,0.5)" />
                        <Text style={s.thumbFallbackText}>Thumbnail unavailable</Text>
                      </View>
                    ) : null}
                    <LinearGradient
                      pointerEvents="none"
                      colors={['transparent', 'rgba(0,0,0,0.72)']}
                      locations={[0.35, 1]}
                      style={StyleSheet.absoluteFill}
                    />
                    <View style={s.previewPlay}>
                      <Ionicons name="play" size={24} color="#fff" />
                    </View>
                    {vibeCaption.trim() ? (
                      <View style={s.previewCaption} pointerEvents="none">
                        <Text style={s.previewCaptionLabel}>VIBING ON</Text>
                        <Text style={s.previewCaptionText} numberOfLines={2}>
                          {vibeCaption.trim()}
                        </Text>
                      </View>
                    ) : null}
                  </Pressable>

                  <View style={s.infoRow}>
                    <View style={s.statusBadge}>
                      <View style={[s.statusDot, { backgroundColor: '#22c55e' }]} />
                      <Text style={[s.statusLabel, { color: theme.text }]}>Live</Text>
                    </View>
                  </View>

                  <View style={[s.divider, { backgroundColor: theme.glassBorder }]} />

                  <ActionRow
                    icon="videocam-outline"
                    label="Record new video"
                    color={theme.text}
                    iconColor={theme.tint}
                    onPress={() => {
                      onClose();
                      onRecordNew();
                    }}
                    showChevron
                  />
                  <ActionRow
                    icon="eye-outline"
                    label="Preview as others see it"
                    color={theme.text}
                    iconColor={theme.tint}
                    onPress={() => {
                      onClose();
                      onOpenFullscreen();
                    }}
                    showChevron
                  />

                  <View style={[s.divider, { backgroundColor: theme.glassBorder }]} />

                  <ActionRow
                    icon="trash-outline"
                    label="Delete video"
                    color={theme.danger}
                    iconColor={theme.danger}
                    onPress={handleDelete}
                  />
                </>
              )}
            </ScrollView>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function ActionRow({
  icon,
  label,
  color,
  iconColor,
  onPress,
  showChevron,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  color: string;
  iconColor: string;
  onPress: () => void;
  showChevron?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.actionRow, pressed && { opacity: 0.75 }]}>
      <Ionicons name={icon} size={22} color={iconColor} />
      <Text style={[s.actionLabel, { color }]}>{label}</Text>
      {showChevron && (
        <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.3)" style={s.actionChevron} />
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdropPress: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  sheet: {
    maxHeight: SHEET_HEIGHT,
    borderTopLeftRadius: radius['2xl'],
    borderTopRightRadius: radius['2xl'],
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingBottom: 34,
    zIndex: 10,
  },
  handleRow: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 6,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    opacity: 0.4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    position: 'relative',
  },
  title: {
    fontSize: 18,
    fontFamily: fonts.displayBold,
  },
  closeBtn: {
    position: 'absolute',
    right: 0,
  },
  preview: {
    aspectRatio: 16 / 9,
    borderRadius: radius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    marginBottom: spacing.md,
    position: 'relative',
  },
  thumbFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    zIndex: 2,
  },
  thumbFallbackText: {
    marginTop: 6,
    fontSize: 12,
    fontFamily: fonts.bodySemiBold,
    color: 'rgba(255,255,255,0.75)',
  },
  previewPlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginTop: -22,
    marginLeft: -22,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(139,92,246,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewCaption: {
    position: 'absolute',
    bottom: 10,
    left: 12,
    right: 12,
  },
  previewCaptionLabel: {
    fontSize: 10,
    fontFamily: fonts.bodySemiBold,
    color: 'rgba(255,255,255,0.65)',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  previewCaptionText: {
    fontSize: 14,
    fontFamily: fonts.bodySemiBold,
    color: '#fff',
    marginTop: 2,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(34,197,94,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusLabel: {
    fontSize: 13,
    fontFamily: fonts.bodySemiBold,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 8,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    gap: 14,
  },
  actionLabel: {
    fontSize: 16,
    fontFamily: fonts.bodySemiBold,
    flex: 1,
  },
  actionChevron: {
    marginLeft: 'auto',
  },
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    paddingHorizontal: 8,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: fonts.displayBold,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 14,
    fontFamily: fonts.body,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  primaryCta: {
    marginTop: spacing.xl,
    borderRadius: 999,
    overflow: 'hidden',
    paddingVertical: 14,
    paddingHorizontal: 32,
    minWidth: 200,
    alignItems: 'center',
  },
  primaryCtaText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: fonts.bodySemiBold,
  },
});
