import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, TextInput } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import type { NativeHydratedGameSessionView } from '@/lib/chatGameSessions';
import type { RouletteSnapshot } from '@/lib/vibelyGamesTypes';
import { buildRouletteAnswerParams, formatSendGameEventError, useSendRouletteChoice } from '@/lib/gamesApi';

type Props = {
  view: NativeHydratedGameSessionView;
  matchId: string;
  currentUserId: string;
  partnerName: string;
  timeLabel: string;
};

type BubblePhase =
  | 'complete'
  | 'submitting'
  | 'actionable'
  | 'waiting_partner'
  | 'invalid_context'
  | 'ambiguous';

type NonCompleteNonSubmittingPhase = Exclude<BubblePhase, 'complete' | 'submitting'>;

function derivePhase(
  snap: RouletteSnapshot,
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
  if (isStarter && snap.receiver_answer == null) return 'waiting_partner';
  return 'ambiguous';
}

function isNonCompleteNonSubmittingPhase(phase: BubblePhase): phase is NonCompleteNonSubmittingPhase {
  return phase !== 'complete' && phase !== 'submitting';
}

export function RouletteBubble({ view, matchId, currentUserId, partnerName, timeLabel }: Props) {
  const theme = Colors[useColorScheme()];
  const snap = view.foldedSnapshot;
  if (snap.game_type !== 'roulette') return null;

  const isStarter = view.starterUserId === currentUserId;
  const complete = snap.status === 'complete';
  const { mutateAsync, isPending } = useSendRouletteChoice();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [draftAnswer, setDraftAnswer] = useState('');
  const tapGuard = useRef(false);

  const canBuild = buildRouletteAnswerParams(view, matchId, draftAnswer) != null;
  const actionable = !complete && view.canCurrentUserActNext;
  const canSubmit = actionable && canBuild && !isPending;
  const phase = derivePhase(snap, complete, isPending, actionable, canBuild, view.canCurrentUserActNext, isStarter);

  useEffect(() => {
    setSubmitError(null);
    setDraftAnswer('');
  }, [view.gameSessionId, view.latestMessageId, view.updatedAt, snap.receiver_answer, snap.status]);

  const handleSubmit = async () => {
    if (tapGuard.current || isPending) return;
    if (!canBuild) return;
    tapGuard.current = true;
    setSubmitError(null);
    try {
      const result = await mutateAsync({ view, matchId, receiverAnswer: draftAnswer.trim() });
      if (!result.ok) setSubmitError(formatSendGameEventError(result.error));
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      tapGuard.current = false;
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: 'rgba(255,255,255,0.1)' }]}>
      <LinearGradient colors={[theme.neonCyan, theme.tint]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.accentBar} />
      <View style={styles.inner}>
        <View style={styles.titleRow}>
          <View style={[styles.iconWrap, { backgroundColor: 'rgba(6,182,212,0.2)' }]}>
            <Ionicons name="repeat-outline" size={20} color={theme.neonCyan} />
          </View>
          <View style={styles.titleTextCol}>
            <Text style={[styles.kicker, { color: theme.textSecondary }]}>Vibe Arcade</Text>
            <Text style={[styles.title, { color: theme.text }]}>Roulette</Text>
          </View>
        </View>

        {phase === 'complete' ? (
          <CompleteBlock theme={theme} partnerName={partnerName} isStarter={isStarter} snap={snap} />
        ) : isNonCompleteNonSubmittingPhase(phase) ? (
          <StatusStrip phase={phase} partnerName={partnerName} theme={theme} />
        ) : null}

        <View style={[styles.questionCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
          <Text style={[styles.questionLabel, { color: theme.textSecondary }]}>Question</Text>
          <Text style={[styles.questionText, { color: theme.text }]}>“{snap.question}”</Text>
        </View>

        <View style={styles.answerStack}>
          <AnswerCard
            title={isStarter ? 'Your answer' : `${partnerName}'s answer`}
            value={snap.sender_answer}
            hidden={phase !== 'complete'}
            theme={theme}
          />

          {phase === 'actionable' ? (
            <View style={[styles.inputCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
              <Text style={[styles.answerLabel, { color: theme.textSecondary }]}>Your answer to unlock</Text>
              <TextInput
                value={draftAnswer}
                onChangeText={(t) => {
                  setDraftAnswer(t);
                  if (submitError) setSubmitError(null);
                }}
                placeholder="Type your answer..."
                placeholderTextColor={theme.textSecondary}
                editable={!isPending}
                multiline
                maxLength={500}
                style={[
                  styles.answerInput,
                  {
                    color: theme.text,
                    borderColor: theme.border,
                    backgroundColor: theme.surface,
                  },
                ]}
              />
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
                {isPending ? (
                  <ActivityIndicator color={theme.primaryForeground} />
                ) : (
                  <Text style={[styles.submitBtnText, { color: theme.primaryForeground }]}>Answer to unlock</Text>
                )}
              </Pressable>
            </View>
          ) : (
            <AnswerCard
              title={isStarter ? `${partnerName}'s answer` : 'Your answer'}
              value={snap.receiver_answer ?? ''}
              hidden={phase !== 'complete'}
              theme={theme}
              emptyCopy={isStarter ? `Waiting on ${partnerName}...` : 'Waiting for reveal...'}
            />
          )}
        </View>

        {phase === 'submitting' ? (
          <View style={[styles.submittingRow, { backgroundColor: theme.secondary }]}>
            <ActivityIndicator size="small" color={theme.neonPink} />
            <Text style={[styles.submittingText, { color: theme.text }]}>Saving your answer…</Text>
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
      icon: 'create-outline',
      title: 'Your turn to answer',
      detail: 'Reply to reveal both answers.',
      bg: 'rgba(6,182,212,0.12)',
      iconColor: theme.neonCyan,
    },
    waiting_partner: {
      icon: 'hourglass-outline',
      title: `Waiting on ${partnerName}`,
      detail: 'Your answer is locked. Waiting for theirs.',
      bg: 'rgba(6,182,212,0.12)',
      iconColor: theme.neonCyan,
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

function AnswerCard({
  title,
  value,
  hidden,
  theme,
  emptyCopy = 'Hidden until both answers are in',
}: {
  title: string;
  value: string;
  hidden: boolean;
  theme: (typeof Colors)['light'];
  emptyCopy?: string;
}) {
  return (
    <View style={[styles.answerCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
      <Text style={[styles.answerLabel, { color: theme.textSecondary }]}>{title}</Text>
      {hidden ? (
        <View style={styles.hiddenRow}>
          <Ionicons name="lock-closed-outline" size={15} color={theme.textSecondary} />
          <Text style={[styles.hiddenText, { color: theme.textSecondary }]}>{emptyCopy}</Text>
        </View>
      ) : value ? (
        <Text style={[styles.answerText, { color: theme.text }]}>{value}</Text>
      ) : (
        <Text style={[styles.hiddenText, { color: theme.textSecondary }]}>{emptyCopy}</Text>
      )}
    </View>
  );
}

function CompleteBlock({
  theme,
  partnerName,
  isStarter,
  snap,
}: {
  theme: (typeof Colors)['light'];
  partnerName: string;
  isStarter: boolean;
  snap: RouletteSnapshot;
}) {
  return (
    <View style={[styles.completeBlock, { borderColor: 'rgba(6,182,212,0.45)', backgroundColor: 'rgba(6,182,212,0.1)' }]}>
      <Ionicons name="lock-open-outline" size={21} color={theme.neonCyan} />
      <View style={styles.statusTextWrap}>
        <Text style={[styles.statusTitle, { color: theme.text }]}>Answers revealed</Text>
        <Text style={[styles.statusDetail, { color: theme.textSecondary }]}>
          {isStarter
            ? `You and ${partnerName} both answered this question.`
            : `You replied and unlocked both answers.`}
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
  questionCard: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: spacing.xs,
  },
  questionLabel: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  questionText: { fontSize: 16, lineHeight: 22, fontStyle: 'italic' },
  answerStack: { gap: spacing.sm },
  answerCard: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: spacing.xs,
  },
  answerLabel: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  answerText: { fontSize: 15, lineHeight: 20 },
  hiddenRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  hiddenText: { fontSize: 13, lineHeight: 18 },
  inputCard: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: spacing.sm,
  },
  answerInput: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 82,
    maxHeight: 170,
    textAlignVertical: 'top',
    fontSize: 15,
    lineHeight: 20,
  },
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
