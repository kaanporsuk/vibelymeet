import { useEffect, useRef, useState } from 'react';
import { View, Text, Modal, Pressable, StyleSheet, ActivityIndicator, Image, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import { randomScavengerPrompt } from '@/lib/scavengerPrompts';
import { uploadChatImageWithMediaSdk } from '@/lib/mediaSdk/nativeStorageUploads';
import {
  formatSendGameEventError,
  newGameClientRequestId,
  newVibeGameSessionId,
  useStartScavengerGame,
  type ThreadInvalidateScope,
} from '@/lib/gamesApi';
import { useVibelyDialog } from '@/components/VibelyDialog';
import { permissionUxStatusFromGrant, resolvePermissionUx } from '@clientShared/permissions/permissionUx';
import { openPermissionSettings } from '@/lib/permissionSettings';

type Props = {
  visible: boolean;
  onClose: () => void;
  matchId: string;
  partnerName: string;
  invalidateScope: ThreadInvalidateScope;
};

function mediaErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : 'Could not upload photo.';
}

function isPermissionLikeMediaError(error: unknown): boolean {
  return /\b(permission|denied|access|authorized|authorization)\b/i.test(mediaErrorMessage(error));
}

export function ScavengerStartSheet({ visible, onClose, matchId, partnerName, invalidateScope }: Props) {
  const theme = Colors[useColorScheme()];
  const insets = useSafeAreaInsets();
  const { mutateAsync, isPending } = useStartScavengerGame();
  const [prompt, setPrompt] = useState<string>(() => randomScavengerPrompt());
  const [senderPhotoUrl, setSenderPhotoUrl] = useState<string | null>(null);
  const [senderPhotoClientRequestId, setSenderPhotoClientRequestId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitGuard = useRef(false);
  const { show: showDialog, dialog: dialogEl } = useVibelyDialog();

  useEffect(() => {
    if (!visible) return;
    setPrompt(randomScavengerPrompt());
    setSenderPhotoUrl(null);
    setSenderPhotoClientRequestId(null);
    setUploading(false);
    setError(null);
    submitGuard.current = false;
  }, [visible]);

  const pickPhoto = async (fromCamera: boolean) => {
    if (uploading || isPending) return;
    setError(null);
    try {
      if (fromCamera) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (permission.status !== 'granted') {
          const copy = resolvePermissionUx({
            capability: 'photo_capture',
            status: permissionUxStatusFromGrant({
              status: permission.status,
              canAskAgain: permission.canAskAgain,
            }),
            platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'native',
          });
          showDialog({
            title: copy.title,
            message: copy.message,
            variant: 'info',
            primaryAction: copy.primaryAction === 'open_settings'
              ? { label: copy.primaryLabel, onPress: () => void openPermissionSettings('scavenger_start_camera') }
              : { label: copy.primaryLabel, onPress: () => void pickPhoto(true) },
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
      const clientRequestId = newGameClientRequestId();
      const url = await uploadChatImageWithMediaSdk({
        uri: asset.uri,
        mimeType: asset.mimeType ?? null,
        matchId,
        clientRequestId,
      });
      setSenderPhotoUrl(url);
      setSenderPhotoClientRequestId(clientRequestId);
    } catch (e) {
      const message = mediaErrorMessage(e);
      if (isPermissionLikeMediaError(e)) {
        const copy = resolvePermissionUx({
          capability: fromCamera ? 'photo_capture' : 'photo_picker',
          status: 'blocked_settings',
          platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'native',
        });
        showDialog({
          title: copy.title,
          message: copy.message,
          variant: 'info',
          primaryAction: {
            label: copy.primaryLabel,
            onPress: () => void openPermissionSettings(
              fromCamera ? 'scavenger_start_camera_launch' : 'scavenger_start_library',
            ),
          },
          secondaryAction: fromCamera
            ? { label: 'Choose from library', onPress: () => void pickPhoto(false) }
            : { label: 'Take photo', onPress: () => void pickPhoto(true) },
        });
        return;
      }
      if (fromCamera) {
        showDialog({
          title: 'Camera issue',
          message,
          variant: 'warning',
          primaryAction: { label: 'Try again', onPress: () => void pickPhoto(true) },
          secondaryAction: { label: 'Choose from library', onPress: () => void pickPhoto(false) },
        });
        return;
      }
      setError(message);
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
        invalidateScope,
        clientRequestId: senderPhotoClientRequestId ?? undefined,
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
