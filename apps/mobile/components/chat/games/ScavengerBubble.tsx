import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Image, Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import type { NativeHydratedGameSessionView } from '@/lib/chatGameSessions';
import type { ScavengerSnapshot } from '@/lib/vibelyGamesTypes';
import {
  buildScavengerPhotoParams,
  formatSendGameEventError,
  useSendScavengerChoice,
  type ThreadInvalidateScope,
} from '@/lib/gamesApi';
import { uploadChatImageMessage } from '@/lib/chatMediaUpload';
import { useVibelyDialog } from '@/components/VibelyDialog';

const EXPIRY_MS = 48 * 60 * 60 * 1000;

type Props = {
  view: NativeHydratedGameSessionView;
  matchId: string;
  currentUserId: string;
  partnerName: string;
  timeLabel: string;
  invalidateScope: ThreadInvalidateScope;
};

type BubblePhase =
  | 'complete'
  | 'submitting'
  | 'actionable'
  | 'waiting_partner'
  | 'invalid_context'
  | 'ambiguous'
  | 'expired';

type StatusStripPhase = 'invalid_context' | 'ambiguous';

function derivePhase(
  snap: ScavengerSnapshot,
  complete: boolean,
  isPending: boolean,
  actionable: boolean,
  canBuild: boolean,
  canActNext: boolean,
  isStarter: boolean,
  isExpired: boolean
): BubblePhase {
  if (isExpired) return 'expired';
  if (complete) return 'complete';
  if (isPending) return 'submitting';
  if (actionable) return 'actionable';
  if (canActNext && !canBuild) return 'invalid_context';
  if (isStarter && snap.receiver_photo_url == null) return 'waiting_partner';
  return 'ambiguous';
}

export function ScavengerBubble({ view, matchId, currentUserId, partnerName, timeLabel, invalidateScope }: Props) {
  const theme = Colors[useColorScheme()];
  const { show: showDialog, dialog: dialogEl } = useVibelyDialog();
  const { mutateAsync, isPending } = useSendScavengerChoice();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [selectedPhotoUrl, setSelectedPhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const tapGuard = useRef(false);

  const snap = view.foldedSnapshot;
  const scavengerSnap = snap.game_type === 'scavenger' ? snap : null;

  useEffect(() => {
    if (!scavengerSnap) return;
    setSubmitError(null);
    setSelectedPhotoUrl(null);
  }, [
    view.gameSessionId,
    view.latestMessageId,
    view.updatedAt,
    scavengerSnap?.status,
    scavengerSnap?.receiver_photo_url,
    scavengerSnap?.is_unlocked,
  ]);

  if (!scavengerSnap) return null;

  const creationMs = view.createdAt ? new Date(view.createdAt).getTime() : NaN;
  const isExpired =
    scavengerSnap.status === 'active' &&
    Number.isFinite(creationMs) &&
    Date.now() - creationMs > EXPIRY_MS;

  const isStarter = view.starterUserId === currentUserId;
  const complete = scavengerSnap.status === 'complete';

  const canBuild = selectedPhotoUrl ? buildScavengerPhotoParams(view, matchId, selectedPhotoUrl) != null : false;
  const actionable = !complete && !isExpired && view.canCurrentUserActNext;
  const canSubmit = actionable && canBuild && !isPending && !uploading;
  const phase = derivePhase(
    scavengerSnap,
    complete,
    isPending || uploading,
    actionable,
    canBuild,
    view.canCurrentUserActNext,
    isStarter,
    isExpired
  );

  const pickAndUpload = async (fromCamera: boolean) => {
    if (isPending || uploading || !actionable) return;
    setSubmitError(null);
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
      setSelectedPhotoUrl(url);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Could not upload photo.');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (tapGuard.current || isPending || uploading || !selectedPhotoUrl) return;
    if (!canBuild) return;
    tapGuard.current = true;
    setSubmitError(null);
    try {
      const result = await mutateAsync({ view, matchId, receiverPhotoUrl: selectedPhotoUrl, invalidateScope });
      if (!result.ok) setSubmitError(formatSendGameEventError(result.error));
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      tapGuard.current = false;
    }
  };

  const senderUri = scavengerSnap.sender_photo_url?.trim() ? scavengerSnap.sender_photo_url : null;
  const receiverFinalUri =
    complete && scavengerSnap.receiver_photo_url?.trim() ? scavengerSnap.receiver_photo_url : null;
  const receiverDraftUri = !complete && selectedPhotoUrl ? selectedPhotoUrl : null;
  const receiverDisplayUri = receiverFinalUri ?? receiverDraftUri;

  return (
    <>
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: 'rgba(255,255,255,0.1)', opacity: isExpired ? 0.5 : 1 }]}>
        <LinearGradient colors={['#22c55e', '#14b8a6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.accentBar} />
        <View style={styles.inner}>
          <View style={styles.titleRow}>
            <View style={[styles.iconWrap, { backgroundColor: 'rgba(34,197,94,0.2)' }]}>
              <Ionicons name="camera-outline" size={20} color={theme.success} />
            </View>
            <View style={styles.titleTextCol}>
              <Text style={[styles.kicker, { color: theme.textSecondary }]}>Vibe Arcade</Text>
              <Text style={[styles.title, { color: theme.text }]}>Scavenger Hunt</Text>
            </View>
          </View>

          {phase === 'expired' ? null : phase === 'complete' ? null : phase === 'waiting_partner' ? (
            <Text style={[styles.singleStatus, { color: theme.textSecondary }]}>Waiting for their reply</Text>
          ) : phase === 'invalid_context' || phase === 'ambiguous' ? (
            <StatusStrip phase={phase} partnerName={partnerName} theme={theme} />
          ) : null}

          <View style={[styles.promptCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
            <Text style={[styles.promptLabel, { color: theme.textSecondary }]}>Prompt</Text>
            <Text style={[styles.promptText, { color: theme.text }]}>{scavengerSnap.prompt}</Text>
          </View>

          <View style={styles.photoGrid}>
            <PhotoCard
              theme={theme}
              title={isStarter ? 'Your photo' : `${partnerName}'s photo`}
              uri={senderUri}
              emptyPlaceholder="No challenge photo"
            />
            <ReceiverPhotoCard
              theme={theme}
              title={isStarter ? `${partnerName}'s photo` : 'Your photo'}
              isStarter={isStarter}
              complete={complete}
              isExpired={isExpired}
              actionable={actionable}
              displayUri={receiverDisplayUri}
              partnerName={partnerName}
            />
          </View>

          {phase === 'actionable' ? (
            <>
              <View style={styles.replyActions}>
                <Pressable
                  onPress={() => void pickAndUpload(true)}
                  disabled={isPending || uploading}
                  style={[styles.actionBtn, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
                >
                  <Ionicons name="camera-outline" size={16} color={theme.neonCyan} />
                  <Text style={[styles.actionText, { color: theme.text }]}>Take photo</Text>
                </Pressable>
                <Pressable
                  onPress={() => void pickAndUpload(false)}
                  disabled={isPending || uploading}
                  style={[styles.actionBtn, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
                >
                  <Ionicons name="images-outline" size={16} color={theme.neonCyan} />
                  <Text style={[styles.actionText, { color: theme.text }]}>Choose photo</Text>
                </Pressable>
              </View>
            </>
          ) : null}

          {phase === 'actionable' ? (
            <Pressable
              onPress={() => void handleSubmit()}
              disabled={!canSubmit}
              style={({ pressed }) => [
                styles.submitBtn,
                {
                  backgroundColor: theme.tint,
                  opacity: !canSubmit ? 0.45 : pressed ? 0.9 : 1,
                },
              ]}
            >
              {isPending || uploading ? (
                <ActivityIndicator color={theme.primaryForeground} />
              ) : (
                <Text style={[styles.submitBtnText, { color: theme.primaryForeground }]}>Submit photo reply</Text>
              )}
            </Pressable>
          ) : null}

          {phase === 'submitting' ? (
            <View style={[styles.submittingRow, { backgroundColor: theme.secondary }]}>
              <ActivityIndicator size="small" color={theme.success} />
              <Text style={[styles.submittingText, { color: theme.text }]}>
                {uploading ? 'Uploading your photo…' : 'Saving your reply…'}
              </Text>
            </View>
          ) : null}

          {phase === 'expired' ? (
            <Text style={[styles.expiredStatus, { color: theme.textSecondary }]}>This challenge expired</Text>
          ) : null}

          {complete ? (
            <Text style={[styles.completeStatus, { color: theme.textSecondary }]}>Challenge completed</Text>
          ) : null}

          {submitError ? (
            <View style={[styles.errorBanner, { borderColor: theme.dangerSoft, backgroundColor: theme.dangerSoft }]}>
              <Ionicons name="alert-circle-outline" size={18} color={theme.danger} />
              <Text style={[styles.errorText, { color: theme.text }]}>{submitError}</Text>
            </View>
          ) : null}

          <Text style={[styles.time, { color: theme.textSecondary }]}>{timeLabel}</Text>
        </View>
      </View>
      {dialogEl}
    </>
  );
}

function StatusStrip({
  phase,
  partnerName,
  theme,
}: {
  phase: StatusStripPhase;
  partnerName: string;
  theme: (typeof Colors)['light'];
}) {
  const cfg: Record<
    StatusStripPhase,
    { icon: ComponentProps<typeof Ionicons>['name']; title: string; detail: string; bg: string; iconColor: string }
  > = {
    invalid_context: {
      icon: 'warning-outline',
      title: 'Something is off',
      detail: 'Pull to refresh the chat, then try again.',
      bg: theme.dangerSoft,
      iconColor: theme.danger,
    },
    ambiguous: {
      icon: 'help-circle-outline',
      title: 'Round in progress',
      detail: 'We will update this when the next event arrives.',
      bg: theme.secondary,
      iconColor: theme.textSecondary,
    },
  };
  const c = cfg[phase];
  return (
    <View style={[styles.statusStrip, { backgroundColor: c.bg }]}>
      <Ionicons name={c.icon} size={20} color={c.iconColor} />
      <View style={styles.statusTextWrap}>
        <Text style={[styles.statusTitle, { color: theme.text }]}>{c.title}</Text>
        <Text style={[styles.statusDetail, { color: theme.textSecondary }]}>{c.detail}</Text>
      </View>
    </View>
  );
}

function PhotoCard({
  theme,
  title,
  uri,
  emptyPlaceholder,
}: {
  theme: (typeof Colors)['light'];
  title: string;
  uri: string | null;
  emptyPlaceholder: string;
}) {
  return (
    <View style={[styles.photoCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
      <Text style={[styles.photoLabel, { color: theme.textSecondary }]}>{title}</Text>
      {uri ? (
        <Image source={{ uri }} style={styles.photo} />
      ) : (
        <Text style={[styles.hiddenText, { color: theme.textSecondary }]}>{emptyPlaceholder}</Text>
      )}
    </View>
  );
}

function ReceiverPhotoCard({
  theme,
  title,
  isStarter,
  complete,
  isExpired,
  actionable,
  displayUri,
  partnerName,
}: {
  theme: (typeof Colors)['light'];
  title: string;
  isStarter: boolean;
  complete: boolean;
  isExpired: boolean;
  actionable: boolean;
  displayUri: string | null;
  partnerName: string;
}) {
  if (complete && displayUri) {
    return (
      <View style={[styles.photoCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
        <Text style={[styles.photoLabel, { color: theme.textSecondary }]}>{title}</Text>
        <Image source={{ uri: displayUri }} style={styles.photo} />
      </View>
    );
  }

  if (complete && !displayUri) {
    return (
      <View style={[styles.photoCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
        <Text style={[styles.photoLabel, { color: theme.textSecondary }]}>{title}</Text>
        <Text style={[styles.hiddenText, { color: theme.textSecondary }]}>No reply photo</Text>
      </View>
    );
  }

  if (isStarter) {
    return (
      <View style={[styles.photoCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
        <Text style={[styles.photoLabel, { color: theme.textSecondary }]}>{title}</Text>
        <View style={styles.hiddenWrap}>
          <Ionicons name="lock-closed-outline" size={16} color={theme.textSecondary} />
          <Text style={[styles.hiddenText, { color: theme.textSecondary }]}>
            {isExpired ? '—' : `Waiting on ${partnerName}`}
          </Text>
        </View>
      </View>
    );
  }

  if (actionable && !isExpired) {
    if (displayUri) {
      return (
        <View style={[styles.photoCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
          <Text style={[styles.photoLabel, { color: theme.textSecondary }]}>{title}</Text>
          <Image source={{ uri: displayUri }} style={styles.photo} />
        </View>
      );
    }
    return (
      <View style={[styles.photoCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
        <Text style={[styles.photoLabel, { color: theme.textSecondary }]}>{title}</Text>
        <View style={styles.hiddenWrap}>
          <Ionicons name="camera-outline" size={16} color={theme.textSecondary} />
          <Text style={[styles.hiddenText, { color: theme.textSecondary }]}>Reply with your photo</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.photoCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
      <Text style={[styles.photoLabel, { color: theme.textSecondary }]}>{title}</Text>
      <View style={styles.hiddenWrap}>
        <Ionicons name="help-circle-outline" size={16} color={theme.textSecondary} />
        <Text style={[styles.hiddenText, { color: theme.textSecondary }]}>—</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  accentBar: { height: 3, width: '100%' },
  inner: { padding: spacing.md, gap: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  titleTextCol: { flex: 1, minWidth: 0 },
  kicker: { fontSize: 11, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  title: { fontSize: 18, fontWeight: '700', marginTop: 2 },
  singleStatus: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
  completeStatus: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
  expiredStatus: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: spacing.xs },
  statusStrip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  statusTextWrap: { flex: 1, minWidth: 0, gap: 2 },
  statusTitle: { fontSize: 15, fontWeight: '700' },
  statusDetail: { fontSize: 13, lineHeight: 18 },
  promptCard: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: spacing.xs,
  },
  promptLabel: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  promptText: { fontSize: 15, lineHeight: 20 },
  photoGrid: { flexDirection: 'row', gap: spacing.sm },
  photoCard: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.sm,
    gap: spacing.xs,
    minHeight: 170,
  },
  photoLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  photo: { width: '100%', height: 112, borderRadius: radius.md, marginTop: 2 },
  hiddenWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.xs },
  hiddenText: { fontSize: 12, lineHeight: 17, textAlign: 'center' },
  replyActions: { flexDirection: 'row', gap: spacing.sm },
  actionBtn: {
    flex: 1,
    minHeight: 38,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  actionText: { fontSize: 13, fontWeight: '600' },
  submitBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
    borderRadius: radius.button,
    paddingVertical: 10,
  },
  submitBtnText: { fontSize: 14, fontWeight: '700' },
  submittingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  submittingText: { fontSize: 14, fontWeight: '600' },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  errorText: { flex: 1, fontSize: 13, lineHeight: 18 },
  time: { fontSize: 11, marginTop: 2 },
});
