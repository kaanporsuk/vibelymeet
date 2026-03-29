import { useEffect, useRef, useState } from 'react';
import { View, Text, Modal, Pressable, StyleSheet, ActivityIndicator, Image, Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import { randomScavengerPrompt } from '@/lib/scavengerPrompts';
import { uploadChatImageMessage } from '@/lib/chatMediaUpload';
import { formatSendGameEventError, newVibeGameSessionId, useStartScavengerGame } from '@/lib/gamesApi';
import { useVibelyDialog } from '@/components/VibelyDialog';

type Props = {
  visible: boolean;
  onClose: () => void;
  matchId: string;
  partnerName: string;
};

export function ScavengerStartSheet({ visible, onClose, matchId, partnerName }: Props) {
  const theme = Colors[useColorScheme()];
  const insets = useSafeAreaInsets();
  const { mutateAsync, isPending } = useStartScavengerGame();
  const [prompt, setPrompt] = useState<string>(() => randomScavengerPrompt());
  const [senderPhotoUrl, setSenderPhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitGuard = useRef(false);
  const { show: showDialog, dialog: dialogEl } = useVibelyDialog();

  useEffect(() => {
    if (!visible) return;
    setPrompt(randomScavengerPrompt());
    setSenderPhotoUrl(null);
    setUploading(false);
    setError(null);
    submitGuard.current = false;
  }, [visible]);

  const pickPhoto = async (fromCamera: boolean) => {
    if (uploading || isPending) return;
    setError(null);
    try {
      if (fromCamera) {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          showDialog({
            title: 'Camera Access Required',
            message: 'Allow camera access in your Settings to take photos for this challenge.',
            variant: 'info',
            primaryAction: { label: 'Open Settings', onPress: () => void Linking.openSettings() },
            secondaryAction: { label: 'Not Now', onPress: () => {} },
          });
          return;
        }
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          showDialog({
            title: 'Photo Access Required',
            message: 'Allow photo library access in your Settings to pick photos for this challenge.',
            variant: 'info',
            primaryAction: { label: 'Open Settings', onPress: () => void Linking.openSettings() },
            secondaryAction: { label: 'Not Now', onPress: () => {} },
          });
          return;
        }
      }
      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({ quality: 0.85 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 });
      if (result.canceled || !result.assets?.[0]) return;
      setUploading(true);
      const asset = result.assets[0];
      const url = await uploadChatImageMessage(asset.uri, asset.mimeType ?? 'image/jpeg');
      setSenderPhotoUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload photo.');
    } finally {
      setUploading(false);
    }
  };

  const handleSend = async () => {
    if (submitGuard.current || isPending || uploading) return;
    const mid = matchId.trim();
    if (!mid) {
      setError('Missing match — try again.');
      return;
    }
    if (!senderPhotoUrl) {
      setError('A photo is required to start this round.');
      return;
    }
    submitGuard.current = true;
    setError(null);
    try {
      const result = await mutateAsync({
        matchId: mid,
        gameSessionId: newVibeGameSessionId(),
        prompt: prompt.trim(),
        senderPhotoUrl,
      });
      if (!result.ok) {
        setError(formatSendGameEventError(result.error));
        return;
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      submitGuard.current = false;
    }
  };

  const canSend = !!senderPhotoUrl && !uploading && !isPending;

  return (
    <>
      <Modal visible={visible} animationType="slide" transparent onRequestClose={isPending || uploading ? undefined : onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={isPending || uploading ? undefined : onClose} accessibilityLabel="Dismiss" />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.surface,
              borderColor: theme.border,
              paddingBottom: Math.max(insets.bottom, spacing.lg),
            },
          ]}
        >
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: theme.text }]}>Scavenger Hunt</Text>
            <Pressable
              onPress={onClose}
              disabled={isPending || uploading}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={26} color={isPending || uploading ? theme.textSecondary : theme.text} />
            </Pressable>
          </View>
          <Text style={[styles.sheetSubtitle, { color: theme.textSecondary }]}>
            Share a photo for the prompt. {partnerName} replies with theirs to unlock both.
          </Text>

          <View style={[styles.promptCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
            <Text style={[styles.promptLabel, { color: theme.textSecondary }]}>Prompt</Text>
            <Text style={[styles.promptText, { color: theme.text }]}>{prompt}</Text>
          </View>

          <Pressable
            onPress={() => !isPending && !uploading && setPrompt(randomScavengerPrompt())}
            disabled={isPending || uploading}
            style={({ pressed }) => [
              styles.shuffleBtn,
              { borderColor: theme.border, opacity: isPending || uploading ? 0.45 : pressed ? 0.85 : 1 },
            ]}
          >
            <Ionicons name="refresh-outline" size={18} color={theme.neonCyan} />
            <Text style={[styles.shuffleLabel, { color: theme.text }]}>Different prompt</Text>
          </Pressable>

          <View style={styles.photoActions}>
            <Pressable
              onPress={() => void pickPhoto(true)}
              disabled={isPending || uploading}
              style={[styles.photoBtn, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
            >
              <Ionicons name="camera-outline" size={18} color={theme.neonCyan} />
              <Text style={[styles.photoBtnText, { color: theme.text }]}>Take photo</Text>
            </Pressable>
            <Pressable
              onPress={() => void pickPhoto(false)}
              disabled={isPending || uploading}
              style={[styles.photoBtn, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
            >
              <Ionicons name="images-outline" size={18} color={theme.neonCyan} />
              <Text style={[styles.photoBtnText, { color: theme.text }]}>Choose photo</Text>
            </Pressable>
          </View>

          <View style={[styles.previewCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
            {senderPhotoUrl ? (
              <Image source={{ uri: senderPhotoUrl }} style={styles.previewImage} />
            ) : (
              <Text style={[styles.previewPlaceholder, { color: theme.textSecondary }]}>No photo selected yet</Text>
            )}
          </View>

          {error ? (
            <View style={[styles.errorBox, { borderColor: theme.dangerSoft }]}>
              <Ionicons name="alert-circle-outline" size={18} color={theme.danger} />
              <Text style={[styles.errorText, { color: theme.text }]}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            onPress={() => void handleSend()}
            disabled={!canSend}
            style={({ pressed }) => [
              styles.sendBtn,
              { backgroundColor: theme.tint, opacity: !canSend ? 0.45 : pressed ? 0.9 : 1 },
            ]}
          >
            {isPending || uploading ? (
              <ActivityIndicator color={theme.primaryForeground} />
            ) : (
              <Text style={[styles.sendBtnText, { color: theme.primaryForeground }]}>Send challenge</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
    {dialogEl}
    </>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)', zIndex: 0 },
  sheet: {
    zIndex: 1,
    borderTopLeftRadius: radius['2xl'],
    borderTopRightRadius: radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    maxHeight: '90%',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: 20, fontWeight: '700' },
  sheetSubtitle: { fontSize: 13, marginTop: spacing.sm, marginBottom: spacing.md, lineHeight: 18 },
  promptCard: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: spacing.xs,
  },
  promptLabel: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  promptText: { fontSize: 16, lineHeight: 22 },
  shuffleBtn: {
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
  },
  shuffleLabel: { fontSize: 15, fontWeight: '600' },
  photoActions: { flexDirection: 'row', gap: spacing.sm },
  photoBtn: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: 10,
  },
  photoBtnText: { fontSize: 14, fontWeight: '600' },
  previewCard: {
    marginTop: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    height: 180,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewImage: { width: '100%', height: '100%' },
  previewPlaceholder: { fontSize: 13 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.sm,
  },
  errorText: { flex: 1, fontSize: 14, lineHeight: 20 },
  sendBtn: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    paddingVertical: 14,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  sendBtnText: { fontSize: 16, fontWeight: '700' },
});
