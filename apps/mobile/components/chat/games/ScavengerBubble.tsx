import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Image, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import type { NativeHydratedGameSessionView } from '@/lib/chatGameSessions';
import type { ScavengerSnapshot } from '@/lib/vibelyGamesTypes';
import { buildScavengerPhotoParams, formatSendGameEventError, useSendScavengerChoice } from '@/lib/gamesApi';
import { uploadChatImageMessage } from '@/lib/chatMediaUpload';

type Props = {
  view: NativeHydratedGameSessionView;
  matchId: string;
  currentUserId: string;
  partnerName: string;
  timeLabel: string;
};

type BubblePhase = 'complete' | 'submitting' | 'actionable' | 'waiting_partner' | 'invalid_context' | 'ambiguous';
type NonCompleteNonSubmittingPhase = Exclude<BubblePhase, 'complete' | 'submitting'>;

function derivePhase(
  snap: ScavengerSnapshot,
  complete: boolean,
  isPending: boolean,
  actionable: boolean,
  canBuild: boolean,
  canActNext: boolean,
  isStarter: boolean
): BubblePhase {
  if (complete) return 'complete';
  if (isPending) return 'submitting';
  if (actionable) return 'actionable';
  if (canActNext && !canBuild) return 'invalid_context';
  if (isStarter && snap.receiver_photo_url == null) return 'waiting_partner';
  return 'ambiguous';
}

function isNonCompleteNonSubmittingPhase(phase: BubblePhase): phase is NonCompleteNonSubmittingPhase {
  return phase !== 'complete' && phase !== 'submitting';
}

export function ScavengerBubble({ view, matchId, currentUserId, partnerName, timeLabel }: Props) {
  const theme = Colors[useColorScheme()];
  const snap = view.foldedSnapshot;
  if (snap.game_type !== 'scavenger') return null;

  const isStarter = view.starterUserId === currentUserId;
  const complete = snap.status === 'complete';
  const { mutateAsync, isPending } = useSendScavengerChoice();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [selectedPhotoUrl, setSelectedPhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const tapGuard = useRef(false);

  const canBuild = selectedPhotoUrl ? buildScavengerPhotoParams(view, matchId, selectedPhotoUrl) != null : false;
  const actionable = !complete && view.canCurrentUserActNext;
  const canSubmit = actionable && canBuild && !isPending && !uploading;
  const phase = derivePhase(snap, complete, isPending || uploading, actionable, canBuild, view.canCurrentUserActNext, isStarter);

  useEffect(() => {
    setSubmitError(null);
    setSelectedPhotoUrl(null);
  }, [view.gameSessionId, view.latestMessageId, view.updatedAt, snap.status, snap.receiver_photo_url, snap.is_unlocked]);

  const pickAndUpload = async (fromCamera: boolean) => {
    if (isPending || uploading || !actionable) return;
    setSubmitError(null);
    try {
      if (fromCamera) {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission needed', 'Allow camera access to take a photo.');
          return;
        }
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission needed', 'Allow photo library access to choose a photo.');
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
      const result = await mutateAsync({ view, matchId, receiverPhotoUrl: selectedPhotoUrl });
      if (!result.ok) setSubmitError(formatSendGameEventError(result.error));
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      tapGuard.current = false;
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: 'rgba(255,255,255,0.1)' }]}>
      <LinearGradient colors={['#22c55e', '#14b8a6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.accentBar} />
      <View style={styles.inner}>
        <View style={styles.titleRow}>
          <View style={[styles.iconWrap, { backgroundColor: 'rgba(34,197,94,0.2)' }]}>
            <Ionicons name="camera-outline" size={20} color={theme.success} />
          </View>
          <View style={styles.titleTextCol}>
            <Text style={[styles.kicker, { color: theme.textSecondary }]}>Vibe Arcade</Text>
            <Text style={[styles.title, { color: theme.text }]}>Scavenger</Text>
          </View>
        </View>

        {phase === 'complete' ? (
          <CompleteBlock theme={theme} partnerName={partnerName} isStarter={isStarter} />
        ) : isNonCompleteNonSubmittingPhase(phase) ? (
          <StatusStrip phase={phase} partnerName={partnerName} theme={theme} />
        ) : null}

        <View style={[styles.promptCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
          <Text style={[styles.promptLabel, { color: theme.textSecondary }]}>Prompt</Text>
          <Text style={[styles.promptText, { color: theme.text }]}>{snap.prompt}</Text>
        </View>

        <View style={styles.photoGrid}>
          <PhotoCard
            theme={theme}
            title={isStarter ? 'Your photo' : `${partnerName}'s photo`}
            uri={snap.sender_photo_url}
            hidden={!complete}
            placeholder={isStarter ? 'Waiting to unlock both photos' : 'Unlock by replying with your photo'}
          />
          <PhotoCard
            theme={theme}
            title={isStarter ? `${partnerName}'s photo` : 'Your photo'}
            uri={complete ? (snap.receiver_photo_url ?? null) : selectedPhotoUrl}
            hidden={!complete && !selectedPhotoUrl}
            placeholder={
              isStarter
                ? `Waiting on ${partnerName} to reply`
                : selectedPhotoUrl
                  ? 'Ready to submit'
                  : 'Choose or take a photo to reply'
            }
          />
        </View>

        {phase === 'actionable' ? (
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

        {submitError ? (
          <View style={[styles.errorBanner, { borderColor: theme.dangerSoft, backgroundColor: theme.dangerSoft }]}>
            <Ionicons name="alert-circle-outline" size={18} color={theme.danger} />
            <Text style={[styles.errorText, { color: theme.text }]}>{submitError}</Text>
          </View>
        ) : null}

        <Text style={[styles.time, { color: theme.textSecondary }]}>{timeLabel}</Text>
      </View>
    </View>
  );
}

function StatusStrip({
  phase,
  partnerName,
  theme,
}: {
  phase: NonCompleteNonSubmittingPhase;
  partnerName: string;
  theme: (typeof Colors)['light'];
}) {
  const cfg: Record<
    NonCompleteNonSubmittingPhase,
    { icon: ComponentProps<typeof Ionicons>['name']; title: string; detail: string; bg: string; iconColor: string }
  > = {
    actionable: {
      icon: 'camera-outline',
      title: 'Your turn to reply',
      detail: 'Upload a photo to unlock both shots.',
      bg: 'rgba(34,197,94,0.12)',
      iconColor: theme.success,
    },
    waiting_partner: {
      icon: 'hourglass-outline',
      title: `Waiting on ${partnerName}`,
      detail: 'Your challenge is live. Waiting for their photo reply.',
      bg: 'rgba(34,197,94,0.12)',
      iconColor: theme.success,
    },
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
  hidden,
  placeholder,
}: {
  theme: (typeof Colors)['light'];
  title: string;
  uri: string | null;
  hidden: boolean;
  placeholder: string;
}) {
  return (
    <View style={[styles.photoCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
      <Text style={[styles.photoLabel, { color: theme.textSecondary }]}>{title}</Text>
      {hidden ? (
        <View style={styles.hiddenWrap}>
          <Ionicons name="lock-closed-outline" size={16} color={theme.textSecondary} />
          <Text style={[styles.hiddenText, { color: theme.textSecondary }]}>{placeholder}</Text>
        </View>
      ) : uri ? (
        <Image source={{ uri }} style={styles.photo} />
      ) : (
        <Text style={[styles.hiddenText, { color: theme.textSecondary }]}>{placeholder}</Text>
      )}
    </View>
  );
}

function CompleteBlock({
  theme,
  partnerName,
  isStarter,
}: {
  theme: (typeof Colors)['light'];
  partnerName: string;
  isStarter: boolean;
}) {
  return (
    <View style={[styles.completeBlock, { borderColor: 'rgba(34,197,94,0.45)', backgroundColor: 'rgba(34,197,94,0.1)' }]}>
      <Ionicons name="checkmark-circle" size={22} color={theme.success} />
      <View style={styles.statusTextWrap}>
        <Text style={[styles.statusTitle, { color: theme.text }]}>Both photos unlocked</Text>
        <Text style={[styles.statusDetail, { color: theme.textSecondary }]}>
          {isStarter ? `${partnerName} replied to your challenge.` : 'Your reply unlocked both photos.'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius['2xl'], borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  accentBar: { height: 3, width: '100%' },
  inner: { padding: spacing.lg, gap: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  titleTextCol: { flex: 1, minWidth: 0 },
  kicker: { fontSize: 11, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  title: { fontSize: 18, fontWeight: '700', marginTop: 2 },
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
  photo: { width: '100%', height: 128, borderRadius: radius.md, marginTop: 2 },
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
  completeBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
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
