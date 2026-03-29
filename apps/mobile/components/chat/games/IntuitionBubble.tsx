import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import type { NativeHydratedGameSessionView } from '@/lib/chatGameSessions';
import type { IntuitionSnapshot } from '@/lib/vibelyGamesTypes';
import {
  buildIntuitionResultParams,
  formatSendGameEventError,
  useSendIntuitionChoice,
  type ThreadInvalidateScope,
} from '@/lib/gamesApi';

type Props = {
  view: NativeHydratedGameSessionView;
  matchId: string;
  currentUserId: string;
  partnerName: string;
  timeLabel: string;
  invalidateScope: ThreadInvalidateScope;
};

type BubblePhase =
  | 'complete_correct'
  | 'complete_wrong'
  | 'submitting'
  | 'actionable'
  | 'waiting_partner'
  | 'invalid_context'
  | 'ambiguous';

type CompletePhase = Extract<BubblePhase, 'complete_correct' | 'complete_wrong'>;
type NonCompleteNonSubmittingPhase = Exclude<BubblePhase, CompletePhase | 'submitting'>;

function derivePhase(
  snap: IntuitionSnapshot,
  complete: boolean,
  isPending: boolean,
  actionable: boolean,
  canBuild: boolean,
  canActNext: boolean,
  isStarter: boolean
): BubblePhase {
  if (complete) return snap.receiver_result === 'correct' ? 'complete_correct' : 'complete_wrong';
  if (isPending) return 'submitting';
  if (actionable) return 'actionable';
  if (canActNext && !canBuild) return 'invalid_context';
  if (isStarter && snap.receiver_result == null) return 'waiting_partner';
  return 'ambiguous';
}

function isCompletePhase(phase: BubblePhase): phase is CompletePhase {
  return phase === 'complete_correct' || phase === 'complete_wrong';
}

function isNonCompleteNonSubmittingPhase(phase: BubblePhase): phase is NonCompleteNonSubmittingPhase {
  return phase !== 'complete_correct' && phase !== 'complete_wrong' && phase !== 'submitting';
}

export function IntuitionBubble({ view, matchId, currentUserId, partnerName, timeLabel, invalidateScope }: Props) {
  const theme = Colors[useColorScheme()];
  const snap = view.foldedSnapshot;
  if (snap.game_type !== 'intuition') return null;

  const isStarter = view.starterUserId === currentUserId;
  const complete = snap.status === 'complete';
  const { mutateAsync, isPending } = useSendIntuitionChoice();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const tapGuard = useRef(false);

  const canBuild = buildIntuitionResultParams(view, matchId, 'correct') != null;
  const actionable = canBuild && !complete;
  const phase = derivePhase(snap, complete, isPending, actionable, canBuild, view.canCurrentUserActNext, isStarter);
  const predicted = snap.options[snap.sender_choice];
  const other = snap.options[snap.sender_choice === 0 ? 1 : 0];

  useEffect(() => {
    setSubmitError(null);
  }, [view.gameSessionId, view.latestMessageId, view.updatedAt, snap.receiver_result, snap.status]);

  const handleRespond = async (result: 'correct' | 'wrong') => {
    if (tapGuard.current || isPending) return;
    if (!canBuild) return;
    tapGuard.current = true;
    setSubmitError(null);
    try {
      const r = await mutateAsync({ view, matchId, result, invalidateScope });
      if (!r.ok) setSubmitError(formatSendGameEventError(r.error));
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      tapGuard.current = false;
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: 'rgba(255,255,255,0.1)' }]}>
      <LinearGradient colors={[theme.neonViolet, theme.tint]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.accentBar} />
      <View style={styles.inner}>
        <View style={styles.titleRow}>
          <View style={[styles.iconWrap, { backgroundColor: 'rgba(99,102,241,0.2)' }]}>
            <Ionicons name="sparkles-outline" size={20} color={theme.neonViolet} />
          </View>
          <View style={styles.titleTextCol}>
            <Text style={[styles.kicker, { color: theme.textSecondary }]}>Vibe Arcade</Text>
            <Text style={[styles.title, { color: theme.text }]}>Intuition Test</Text>
          </View>
        </View>

        {isCompletePhase(phase) ? (
          <CompleteOutcomeBlock phase={phase} theme={theme} partnerName={partnerName} isStarter={isStarter} />
        ) : isNonCompleteNonSubmittingPhase(phase) ? (
          <StatusStrip phase={phase} partnerName={partnerName} theme={theme} />
        ) : null}

        <View style={[styles.predictionCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
          <Text style={[styles.predictionLabel, { color: theme.textSecondary }]}>
            {isStarter ? `You predicted ${partnerName} prefers` : `${partnerName} predicted you prefer`}
          </Text>
          <Text style={[styles.predictionMain, { color: theme.text }]}>{predicted}</Text>
          <Text style={[styles.predictionVs, { color: theme.textSecondary }]}>vs {other}</Text>
        </View>

        {phase === 'submitting' ? (
          <View style={[styles.submittingRow, { backgroundColor: theme.secondary }]}>
            <ActivityIndicator size="small" color={theme.neonPink} />
            <Text style={[styles.submittingText, { color: theme.text }]}>Saving your response…</Text>
          </View>
        ) : null}

        {phase === 'actionable' ? (
          <View style={styles.actionRow}>
            <Pressable
              onPress={() => void handleRespond('correct')}
              disabled={isPending}
              style={({ pressed }) => [
                styles.actionBtn,
                {
                  borderColor: 'rgba(34,197,94,0.45)',
                  backgroundColor: 'rgba(34,197,94,0.12)',
                  opacity: isPending ? 0.5 : pressed ? 0.9 : 1,
                },
              ]}
            >
              <Text style={[styles.actionText, { color: theme.success }]}>Correct</Text>
            </Pressable>
            <Pressable
              onPress={() => void handleRespond('wrong')}
              disabled={isPending}
              style={({ pressed }) => [
                styles.actionBtn,
                {
                  borderColor: 'rgba(236,72,153,0.45)',
                  backgroundColor: 'rgba(236,72,153,0.12)',
                  opacity: isPending ? 0.5 : pressed ? 0.9 : 1,
                },
              ]}
            >
              <Text style={[styles.actionText, { color: theme.neonPink }]}>Wrong</Text>
            </Pressable>
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
      icon: 'hand-left-outline',
      title: 'Your turn to confirm',
      detail: `Tell ${partnerName} whether this prediction is right.`,
      bg: 'rgba(6,182,212,0.12)',
      iconColor: theme.neonCyan,
    },
    waiting_partner: {
      icon: 'hourglass-outline',
      title: `Waiting on ${partnerName}`,
      detail: 'Prediction sent. Waiting for their verdict.',
      bg: 'rgba(139,92,246,0.14)',
      iconColor: theme.neonViolet,
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

function CompleteOutcomeBlock({
  phase,
  theme,
  partnerName,
  isStarter,
}: {
  phase: CompletePhase;
  theme: (typeof Colors)['light'];
  partnerName: string;
  isStarter: boolean;
}) {
  const correct = phase === 'complete_correct';
  return (
    <View
      style={[
        styles.completeBlock,
        {
          borderColor: correct ? 'rgba(34,197,94,0.45)' : 'rgba(236,72,153,0.45)',
          backgroundColor: correct ? 'rgba(34,197,94,0.1)' : 'rgba(236,72,153,0.1)',
        },
      ]}
    >
      <Ionicons name={correct ? 'checkmark-circle' : 'close-circle'} size={22} color={correct ? theme.success : theme.neonPink} />
      <View style={styles.statusTextWrap}>
        <Text style={[styles.statusTitle, { color: theme.text }]}>
          {correct ? (isStarter ? `${partnerName} said you were right` : 'You said they were right') : isStarter ? `${partnerName} said you missed` : 'You said they missed'}
        </Text>
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
  predictionCard: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    alignItems: 'center',
    gap: 4,
  },
  predictionLabel: { fontSize: 12, textAlign: 'center' },
  predictionMain: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  predictionVs: { fontSize: 12 },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  actionBtn: {
    flex: 1,
    borderRadius: radius.button,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  actionText: { fontSize: 15, fontWeight: '700' },
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
