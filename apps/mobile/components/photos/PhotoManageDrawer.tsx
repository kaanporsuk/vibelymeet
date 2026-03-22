import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  Modal,
  View as RNView,
  Text,
  Pressable,
  Image,
  StyleSheet,
  Alert,
  Platform,
  ActionSheetIOS,
  Dimensions,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';

import { fonts } from '@/constants/theme';
import { getImageUrl } from '@/lib/imageUrl';
import { uploadProfilePhoto } from '@/lib/uploadImage';
import { updateMyProfile } from '@/lib/profileApi';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const MAX_PHOTOS = 6;

interface PhotoManageDrawerProps {
  visible: boolean;
  onClose: () => void;
  photos: string[];
  onPhotosChanged: () => void;
}

function thumbUrl(path: string) {
  return getImageUrl(path, { width: 400, height: 400, crop: 'center' });
}

function fullUrl(path: string) {
  return getImageUrl(path, { width: 1200, height: 1200 });
}

function getCoachingMessage(count: number): string {
  if (count === 0) return '✨ Add your first photo to get started';
  if (count < 3) return '✨ Add at least 3 photos — profiles with 4+ get 2x more vibes';
  if (count < 6) return `✨ You have ${6 - count} empty slots — a full set gets more attention`;
  return '✨ Looking great! Your photos tell a complete story.';
}

export default function PhotoManageDrawer({
  visible,
  onClose,
  photos,
  onPhotosChanged,
}: PhotoManageDrawerProps) {
  const insets = useSafeAreaInsets();

  const [localPhotos, setLocalPhotos] = useState<string[]>(photos);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Action tray for a tapped tile
  const [trayIndex, setTrayIndex] = useState<number | null>(null);
  // Position picker inside action tray
  const [showPositionPicker, setShowPositionPicker] = useState(false);

  // Fullscreen viewer
  const [fullscreenIndex, setFullscreenIndex] = useState<number | null>(null);

  const initialRef = useRef<string[]>(photos);

  React.useEffect(() => {
    if (visible) {
      setLocalPhotos(photos);
      initialRef.current = photos;
      setSelectedIndex(0);
      setTrayIndex(null);
      setShowPositionPicker(false);
      setFullscreenIndex(null);
    }
  }, [visible, photos]);

  const filledCount = localPhotos.length;
  const coaching = useMemo(() => getCoachingMessage(filledCount), [filledCount]);

  const hasChanges = useMemo(() => {
    if (localPhotos.length !== initialRef.current.length) return true;
    return localPhotos.some((p, i) => p !== initialRef.current[i]);
  }, [localPhotos]);

  // ── Photo picker ─────────────────────────────────────────────

  const pickFromLibrary = useCallback(async (replaceIndex?: number) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow access to your photos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (result.canceled || !result.assets?.[0]?.uri?.trim()) return;
    await uploadAndInsert(result.assets[0], replaceIndex);
  }, [localPhotos]);

  const takePhoto = useCallback(async (replaceIndex?: number) => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow camera access.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (result.canceled || !result.assets?.[0]?.uri?.trim()) return;
    await uploadAndInsert(result.assets[0], replaceIndex);
  }, [localPhotos]);

  const uploadAndInsert = useCallback(async (
    asset: ImagePicker.ImagePickerAsset,
    replaceIndex?: number,
  ) => {
    if (replaceIndex === undefined && filledCount >= MAX_PHOTOS) {
      Alert.alert('Maximum photos', `You can have up to ${MAX_PHOTOS} photos.`);
      return;
    }
    setUploading(true);
    try {
      const oldPath = replaceIndex !== undefined ? localPhotos[replaceIndex] : undefined;
      const path = await uploadProfilePhoto(
        { uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg', fileName: asset.fileName ?? undefined },
        oldPath,
      );
      setLocalPhotos(prev => {
        if (replaceIndex !== undefined) {
          const next = [...prev];
          next[replaceIndex] = path;
          return next;
        }
        return [...prev, path];
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, [localPhotos, filledCount]);

  const showAddSheet = useCallback((replaceIndex?: number) => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Take Photo', 'Choose from Library', 'Cancel'], cancelButtonIndex: 2 },
        (i) => {
          if (i === 0) void takePhoto(replaceIndex);
          else if (i === 1) void pickFromLibrary(replaceIndex);
        },
      );
    } else {
      Alert.alert('Add Photo', 'Choose an option', [
        { text: 'Take Photo', onPress: () => void takePhoto(replaceIndex) },
        { text: 'Choose from Library', onPress: () => void pickFromLibrary(replaceIndex) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }, [takePhoto, pickFromLibrary]);

  // ── Tile actions ─────────────────────────────────────────────

  const handleMakeMain = useCallback((index: number) => {
    setLocalPhotos(prev => {
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.unshift(item);
      return next;
    });
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setTrayIndex(null);
    setShowPositionPicker(false);
    setSelectedIndex(0);
  }, []);

  const handleMoveTo = useCallback((fromIndex: number, toPosition: number) => {
    setLocalPhotos(prev => {
      const next = [...prev];
      const [item] = next.splice(fromIndex, 1);
      next.splice(toPosition, 0, item);
      return next;
    });
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTrayIndex(null);
    setShowPositionPicker(false);
    setSelectedIndex(toPosition);
  }, []);

  const handleRemove = useCallback((index: number) => {
    Alert.alert('Remove this photo?', 'This photo will be removed from your profile.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          setLocalPhotos(prev => prev.filter((_, i) => i !== index));
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setTrayIndex(null);
          setShowPositionPicker(false);
          setSelectedIndex(0);
        },
      },
    ]);
  }, []);

  const handleReplace = useCallback((index: number) => {
    setTrayIndex(null);
    setShowPositionPicker(false);
    setTimeout(() => showAddSheet(index), 350);
  }, [showAddSheet]);

  // ── Save / Cancel / Close ────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!hasChanges) { onClose(); return; }
    setSaving(true);
    try {
      const primaryUrl = localPhotos[0] ?? null;
      await updateMyProfile({ photos: localPhotos, avatar_url: primaryUrl });
      onPhotosChanged();
      onClose();
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : 'Could not save photos.');
    } finally {
      setSaving(false);
    }
  }, [hasChanges, localPhotos, onClose, onPhotosChanged]);

  const confirmDiscard = useCallback(() => {
    if (!hasChanges) { onClose(); return; }
    Alert.alert('Discard changes?', 'Your photo changes will be lost.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onClose },
    ]);
  }, [hasChanges, onClose]);

  // ── Render grid tile ─────────────────────────────────────────

  const renderTile = (slotIndex: number) => {
    const url = localPhotos[slotIndex] ?? null;
    const isMain = slotIndex === 0 && url !== null;

    if (!url) {
      return (
        <Pressable
          key={`empty-${slotIndex}`}
          onPress={() => showAddSheet()}
          style={[st.gridTile, st.emptyTile, { flex: 1 }]}
        >
          <Ionicons name="add" size={28} color="rgba(255,255,255,0.3)" />
          <Text style={st.emptyTileLabel}>Add</Text>
        </Pressable>
      );
    }

    return (
      <Pressable
        key={`tile-${slotIndex}`}
        onPress={() => { setTrayIndex(slotIndex); setShowPositionPicker(false); }}
        onLongPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          setTrayIndex(slotIndex);
          setShowPositionPicker(true);
        }}
        style={({ pressed }) => [st.gridTile, st.filledTile, { flex: 1 }, pressed && { opacity: 0.92 }]}
      >
        <Image source={{ uri: thumbUrl(url) }} style={StyleSheet.absoluteFill} resizeMode="cover" />

        {/* Position badge */}
        <RNView style={st.positionBadge}>
          <Text style={st.positionBadgeText}>{slotIndex + 1}</Text>
        </RNView>

        {/* Main badge */}
        {isMain && (
          <RNView style={st.mainBadge}>
            <Text style={st.mainBadgeCrown}>👑</Text>
            <Text style={st.mainBadgeLabel}>Main</Text>
          </RNView>
        )}
      </Pressable>
    );
  };

  // ── Fullscreen viewer ────────────────────────────────────────

  const renderFullscreen = () => {
    if (fullscreenIndex === null || !localPhotos[fullscreenIndex]) return null;
    const idx = fullscreenIndex;
    const total = localPhotos.length;

    return (
      <Modal visible animationType="fade" onRequestClose={() => setFullscreenIndex(null)}>
        <RNView style={st.fsContainer}>
          {/* Top bar */}
          <RNView style={[st.fsTopBar, { paddingTop: insets.top + 8 }]}>
            <RNView style={st.fsPositionPill}>
              <Text style={st.fsPositionText}>Photo {idx + 1} of {total}</Text>
            </RNView>
            {idx === 0 && (
              <RNView style={st.fsMainPill}>
                <Text style={st.fsMainPillText}>👑 Main</Text>
              </RNView>
            )}
            <Pressable onPress={() => setFullscreenIndex(null)} style={st.fsCloseBtn}>
              <Ionicons name="close" size={24} color="rgba(255,255,255,0.8)" />
            </Pressable>
          </RNView>

          {/* Zoomable image */}
          <ScrollView
            maximumZoomScale={3}
            minimumZoomScale={1}
            centerContent
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            style={{ flex: 1 }}
            contentContainerStyle={{ flex: 1 }}
          >
            <Image
              source={{ uri: fullUrl(localPhotos[idx]) }}
              style={{ width: SCREEN_W, height: SCREEN_H - insets.top - insets.bottom - 80 }}
              resizeMode="contain"
            />
          </ScrollView>

          {/* Nav arrows */}
          <RNView style={[st.fsNavRow, { paddingBottom: insets.bottom + 16 }]}>
            <Pressable
              onPress={() => setFullscreenIndex(Math.max(0, idx - 1))}
              disabled={idx === 0}
              style={[st.fsNavBtn, idx === 0 && { opacity: 0.3 }]}
            >
              <Ionicons name="chevron-back" size={28} color="white" />
            </Pressable>
            <Pressable
              onPress={() => setFullscreenIndex(Math.min(total - 1, idx + 1))}
              disabled={idx === total - 1}
              style={[st.fsNavBtn, idx === total - 1 && { opacity: 0.3 }]}
            >
              <Ionicons name="chevron-forward" size={28} color="white" />
            </Pressable>
          </RNView>
        </RNView>
      </Modal>
    );
  };

  // ── Main render ──────────────────────────────────────────────

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={confirmDiscard}>
      <RNView style={[st.root, { paddingTop: insets.top }]}>
        {/* ── Header ── */}
        <RNView style={st.header}>
          <RNView>
            <Text style={st.headerTitle}>Manage Your Gallery</Text>
            <Text style={st.headerSubtitle}>First impressions matter. Make them count.</Text>
          </RNView>
          <Pressable onPress={confirmDiscard} style={st.closeBtn} hitSlop={12}>
            <Ionicons name="close" size={24} color="rgba(255,255,255,0.6)" />
          </Pressable>
        </RNView>

        {/* ── Filmstrip ── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={st.filmstripContent}
          style={st.filmstrip}
        >
          {localPhotos.map((photo, index) => (
            <Pressable
              key={`fs-${index}-${photo}`}
              onPress={() => setSelectedIndex(index)}
              style={[
                st.filmstripThumb,
                selectedIndex === index && st.filmstripThumbActive,
                selectedIndex !== index && { opacity: 0.55 },
              ]}
            >
              <Image source={{ uri: thumbUrl(photo) }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              {index === 0 && (
                <RNView style={st.filmstripMainDot}>
                  <Text style={{ fontSize: 8 }}>👑</Text>
                </RNView>
              )}
            </Pressable>
          ))}
          {Array.from({ length: Math.max(0, MAX_PHOTOS - filledCount) }).map((_, i) => (
            <Pressable
              key={`fs-empty-${i}`}
              onPress={() => showAddSheet()}
              style={st.filmstripEmpty}
            >
              <Ionicons name="add" size={20} color="rgba(255,255,255,0.3)" />
            </Pressable>
          ))}
        </ScrollView>

        {/* ── Grid ── */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={st.gridContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Row 1: main (60%) + stacked pair (40%) */}
          <RNView style={{ flexDirection: 'row', gap: 8, height: 260 }}>
            <RNView style={{ flex: 3 }}>{renderTile(0)}</RNView>
            <RNView style={{ flex: 2, gap: 8 }}>
              {renderTile(1)}
              {renderTile(2)}
            </RNView>
          </RNView>
          {/* Row 2: three equal */}
          <RNView style={{ flexDirection: 'row', gap: 8, height: 130, marginTop: 8 }}>
            {renderTile(3)}
            {renderTile(4)}
            {renderTile(5)}
          </RNView>

          {/* Coaching strip */}
          <Text style={st.coachingText}>{coaching}</Text>
        </ScrollView>

        {/* ── Footer ── */}
        <RNView style={[st.footer, { paddingBottom: insets.bottom + 16 }]}>
          <LinearGradient
            colors={['#8B5CF6', '#E84393']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[st.saveGradient, { opacity: hasChanges ? 1 : 0.5 }]}
          >
            <Pressable
              onPress={() => void handleSave()}
              disabled={saving}
              style={st.saveInner}
            >
              <Text style={st.saveText}>
                {saving ? 'Saving…' : hasChanges ? 'Save Changes' : 'Done'}
              </Text>
            </Pressable>
          </LinearGradient>

          <Pressable onPress={confirmDiscard} style={st.cancelBtn}>
            <Text style={st.cancelText}>Cancel</Text>
          </Pressable>
        </RNView>
      </RNView>

      {/* ── Action Tray ── */}
      <Modal
        visible={trayIndex !== null}
        transparent
        animationType="fade"
        onRequestClose={() => { setTrayIndex(null); setShowPositionPicker(false); }}
      >
        <Pressable
          style={st.trayBackdrop}
          onPress={() => { setTrayIndex(null); setShowPositionPicker(false); }}
        >
          <Pressable
            style={st.traySheet}
            onPress={(e) => e.stopPropagation()}
          >
            {trayIndex !== null && localPhotos[trayIndex] && (
              <>
                {/* Preview */}
                <RNView style={st.trayPreview}>
                  <Image
                    source={{ uri: thumbUrl(localPhotos[trayIndex]) }}
                    style={st.trayPreviewImage}
                    resizeMode="cover"
                  />
                  <RNView style={st.trayPreviewBadge}>
                    <Text style={st.trayPreviewBadgeText}>Photo {trayIndex + 1}</Text>
                  </RNView>
                </RNView>

                {/* Position picker */}
                {showPositionPicker && (
                  <RNView style={st.posPickerWrap}>
                    <Text style={st.posPickerLabel}>Move to position:</Text>
                    <RNView style={st.posPickerRow}>
                      {Array.from({ length: localPhotos.length }).map((_, pos) => (
                        <Pressable
                          key={pos}
                          onPress={() => handleMoveTo(trayIndex, pos)}
                          style={[
                            st.posPickerBtn,
                            pos === trayIndex && st.posPickerBtnActive,
                          ]}
                        >
                          <Text style={[
                            st.posPickerBtnText,
                            pos === trayIndex && st.posPickerBtnTextActive,
                          ]}>
                            {pos + 1}
                          </Text>
                        </Pressable>
                      ))}
                    </RNView>
                  </RNView>
                )}

                {/* Make Main */}
                {trayIndex !== 0 && (
                  <Pressable
                    onPress={() => handleMakeMain(trayIndex)}
                    style={({ pressed }) => [st.trayRow, pressed && st.trayRowPressed]}
                  >
                    <Text style={st.trayRowEmoji}>👑</Text>
                    <Text style={st.trayRowText}>Make Main</Text>
                  </Pressable>
                )}

                {/* Move */}
                <Pressable
                  onPress={() => setShowPositionPicker(!showPositionPicker)}
                  style={({ pressed }) => [st.trayRow, pressed && st.trayRowPressed]}
                >
                  <Text style={st.trayRowEmoji}>↔</Text>
                  <Text style={st.trayRowText}>Move</Text>
                </Pressable>

                {/* View Full Size */}
                <Pressable
                  onPress={() => {
                    const idx = trayIndex;
                    setTrayIndex(null);
                    setShowPositionPicker(false);
                    setTimeout(() => setFullscreenIndex(idx), 300);
                  }}
                  style={({ pressed }) => [st.trayRow, pressed && st.trayRowPressed]}
                >
                  <Text style={st.trayRowEmoji}>🔍</Text>
                  <Text style={st.trayRowText}>View Full Size</Text>
                </Pressable>

                {/* Replace */}
                <Pressable
                  onPress={() => handleReplace(trayIndex)}
                  style={({ pressed }) => [st.trayRow, pressed && st.trayRowPressed]}
                >
                  <Text style={st.trayRowEmoji}>🔄</Text>
                  <Text style={st.trayRowText}>Replace</Text>
                </Pressable>

                {/* Remove */}
                <Pressable
                  onPress={() => handleRemove(trayIndex)}
                  style={({ pressed }) => [st.trayRow, pressed && st.trayRowPressed]}
                >
                  <Text style={st.trayRowEmoji}>🗑</Text>
                  <Text style={[st.trayRowText, { color: '#EF4444' }]}>Remove</Text>
                </Pressable>

                {/* Cancel */}
                <Pressable
                  onPress={() => { setTrayIndex(null); setShowPositionPicker(false); }}
                  style={({ pressed }) => [st.trayRow, st.trayCancelRow, pressed && st.trayRowPressed]}
                >
                  <Text style={st.trayCancelText}>Cancel</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Fullscreen Viewer ── */}
      {renderFullscreen()}
    </Modal>
  );
}

// ─── Styles ──────────────────────────────────────────────────────

const st = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0A0A0F',
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: fonts.displayBold,
    color: '#F5F5F5',
  },
  headerSubtitle: {
    fontSize: 14,
    fontFamily: fonts.body,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 4,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Filmstrip
  filmstrip: {
    flexGrow: 0,
  },
  filmstripContent: {
    paddingHorizontal: 20,
    gap: 8,
    paddingVertical: 12,
  },
  filmstripThumb: {
    width: 56,
    height: 56,
    borderRadius: 10,
    overflow: 'hidden',
  },
  filmstripThumbActive: {
    borderWidth: 2,
    borderColor: '#8B5CF6',
  },
  filmstripMainDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filmstripEmpty: {
    width: 56,
    height: 56,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(139,92,246,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Grid
  gridContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 16,
  },
  gridTile: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  filledTile: {
    backgroundColor: '#1A1A2E',
  },
  emptyTile: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(139,92,246,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  emptyTileLabel: {
    fontSize: 11,
    fontFamily: fonts.body,
    color: 'rgba(255,255,255,0.25)',
  },
  positionBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  positionBadgeText: {
    fontSize: 11,
    fontFamily: fonts.bodyBold,
    color: 'white',
  },
  mainBadge: {
    position: 'absolute',
    top: 8,
    left: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  mainBadgeCrown: {
    fontSize: 10,
    lineHeight: 12,
  },
  mainBadgeLabel: {
    fontSize: 10,
    fontFamily: fonts.bodySemiBold,
    color: 'rgba(255,255,255,0.95)',
  },

  // Coaching
  coachingText: {
    fontSize: 13,
    fontFamily: fonts.body,
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
  },

  // Footer
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  saveGradient: {
    borderRadius: 14,
  },
  saveInner: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveText: {
    color: 'white',
    fontFamily: fonts.bodyBold,
    fontSize: 16,
  },
  cancelBtn: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelText: {
    color: 'rgba(255,255,255,0.5)',
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
  },

  // Action Tray
  trayBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  traySheet: {
    backgroundColor: '#1A1A2E',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 34,
    overflow: 'hidden',
  },
  trayPreview: {
    height: 120,
    overflow: 'hidden',
    position: 'relative',
  },
  trayPreviewImage: {
    width: '100%',
    height: '100%',
  },
  trayPreviewBadge: {
    position: 'absolute',
    bottom: 8,
    left: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  trayPreviewBadgeText: {
    fontSize: 12,
    fontFamily: fonts.bodySemiBold,
    color: 'rgba(255,255,255,0.8)',
  },
  trayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  trayRowPressed: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  trayRowEmoji: {
    fontSize: 18,
    width: 24,
    textAlign: 'center',
  },
  trayRowText: {
    fontSize: 16,
    fontFamily: fonts.bodyMedium,
    color: '#F5F5F5',
  },
  trayCancelRow: {
    justifyContent: 'center',
    borderBottomWidth: 0,
    marginTop: 4,
  },
  trayCancelText: {
    fontSize: 16,
    fontFamily: fonts.bodySemiBold,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    flex: 1,
  },

  // Position picker
  posPickerWrap: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  posPickerLabel: {
    fontSize: 13,
    fontFamily: fonts.bodySemiBold,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: 10,
  },
  posPickerRow: {
    flexDirection: 'row',
    gap: 10,
  },
  posPickerBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  posPickerBtnActive: {
    backgroundColor: 'rgba(139,92,246,0.3)',
    borderWidth: 1.5,
    borderColor: '#8B5CF6',
  },
  posPickerBtnText: {
    fontSize: 16,
    fontFamily: fonts.bodyBold,
    color: 'rgba(255,255,255,0.6)',
  },
  posPickerBtnTextActive: {
    color: '#8B5CF6',
  },

  // Fullscreen viewer
  fsContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  fsTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
  },
  fsPositionPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  fsPositionText: {
    fontSize: 13,
    fontFamily: fonts.bodySemiBold,
    color: 'rgba(255,255,255,0.8)',
  },
  fsMainPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(139,92,246,0.3)',
  },
  fsMainPillText: {
    fontSize: 12,
    fontFamily: fonts.bodySemiBold,
    color: '#C4B5FD',
  },
  fsCloseBtn: {
    marginLeft: 'auto',
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fsNavRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 40,
    paddingTop: 12,
  },
  fsNavBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
