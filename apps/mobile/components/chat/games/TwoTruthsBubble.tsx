import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import type { NativeHydratedGameSessionView } from '@/lib/chatGameSessions';
import type { TwoTruthsSnapshot } from '@/lib/vibelyGamesTypes';
import {
  buildTwoTruthsGuessParams,
  formatSendGameEventError,
  useSendTwoTruthsChoice,
  type ThreadInvalidateScope,
} from '@/lib/gamesApi';

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
  | 'expired'
  | 'complete_correct'
  | 'complete_wrong'
  | 'submitting'
  | 'actionable'
  | 'waiting_partner'
  | 'invalid_context'
  | 'ambiguous';

type CompletePhase = Extract<BubblePhase, 'complete_correct' | 'complete_wrong'>;
type NonCompleteNonSubmittingPhase = Exclude<BubblePhase, CompletePhase | 'submitting' | 'expired'>;

function derivePhase(
  snap: TwoTruthsSnapshot,
  complete: boolean,
  isPending: boolean,
  actionable: boolean,
  canBuildGuess: boolean,
  canActNext: boolean,
  isStarter: boolean,
  guessedIndex: number | undefined,
  isExpired: boolean
): BubblePhase {
  if (isExpired) return 'expired';
  if (complete) {
    const isCorrect = snap.is_correct === true || (guessedIndex != null && guessedIndex === snap.lie_index);
    return isCorrect ? 'complete_correct' : 'complete_wrong';
  }
  if (isPending) return 'submitting';
  if (actionable) return 'actionable';
  if (canActNext && !canBuildGuess) return 'invalid_context';
  if (isStarter && guessedIndex == null) return 'waiting_partner';
  return 'ambiguous';
}

function statementLabel(i: number) {
  return `${i + 1}`;
}

function isCompletePhase(phase: BubblePhase): phase is CompletePhase {
  return phase === 'complete_correct' || phase === 'complete_wrong';
}

function isNonCompleteNonSubmittingPhase(phase: BubblePhase): phase is NonCompleteNonSubmittingPhase {
  return phase !== 'complete_correct' && phase !== 'complete_wrong' && phase !== 'submitting' && phase !== 'expired';
}

export function TwoTruthsBubble({ view, matchId, currentUserId, partnerName, timeLabel, invalidateScope }: Props) {
  const theme = Colors[useColorScheme()];
  const snap = view.foldedSnapshot;
  const twoTruthsSnap = snap.game_type === '2truths' ? snap : null;

  const { mutateAsync, isPending } = useSendTwoTruthsChoice();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const tapGuard = useRef(false);

  useEffect(() => {
    if (!twoTruthsSnap) return;
    setSubmitError(null);
  }, [view.gameSessionId, view.latestMessageId, view.updatedAt, twoTruthsSnap?.guessed_index, twoTruthsSnap?.status]);

  if (!twoTruthsSnap) return null;

  const creationMs = view.createdAt ? new Date(view.createdAt).getTime() : NaN;
  const isExpired =
    twoTruthsSnap.status === 'active' &&
    Number.isFinite(creationMs) &&
    Date.now() - creationMs > EXPIRY_MS;

  const isStarter = view.starterUserId === currentUserId;
  const complete = twoTruthsSnap.status === 'complete';
  const canBuildGuess = buildTwoTruthsGuessParams(view, matchId, 0) != null;
  const actionable = canBuildGuess && !complete && !isExpired;
  const guessedIndex = twoTruthsSnap.guessed_index;
  const phase = derivePhase(
    twoTruthsSnap,
    complete,
    isPending,
    actionable,
    canBuildGuess,
    view.canCurrentUserActNext,
    isStarter,
    guessedIndex,
    isExpired
  );

  const handleGuess = async (guessIndex: 0 | 1 | 2) => {
    if (isExpired) return;
    if (tapGuard.current || isPending) return;
    if (!canBuildGuess) return;
    tapGuard.current = true;
    setSubmitError(null);
    try {
      const result = await mutateAsync({ view, matchId, guessIndex, invalidateScope });
      if (!result.ok) {
        setSubmitError(formatSendGameEventError(result.error));
      }
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      tapGuard.current = false;
    }
  };

  const statusStrip =
    !complete && isNonCompleteNonSubmittingPhase(phase) ? (
      <StatusStrip phase={phase} partnerName={partnerName} theme={theme} />
    ) : null;

  const completeHero = isCompletePhase(phase) ? (
    <CompleteOutcomeBlock
      snap={twoTruthsSnap}
      theme={theme}
      partnerName={partnerName}
      isStarter={isStarter}
      phase={phase}
    />
  ) : null;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: 'rgba(255,255,255,0.1)', opacity: isExpired ? 0.5 : 1 },
      ]}
    >
      <LinearGradient
        colors={[theme.neonPink, theme.neonViolet]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.accentBar}
      />
      <View style={styles.inner}>
        <View style={styles.titleRow}>
          <View style={[styles.iconWrap, { backgroundColor: 'rgba(236,72,153,0.2)' }]}>
            <Ionicons name="sparkles-outline" size={20} color={theme.neonPink} />
          </View>
          <View style={styles.titleTextCol}>
            <Text style={[styles.kicker, { color: theme.textSecondary }]}>Vibe Arcade</Text>
            <Text style={[styles.title, { color: theme.text }]}>Two Truths & A Lie</Text>
          </View>
        </View>

        {completeHero}
        {statusStrip}

        {phase === 'expired' ? (
          <Text style={[styles.expiredStatus, { color: theme.textSecondary }]}>This challenge expired</Text>
        ) : null}

        {phase === 'submitting' ? (
          <View style={[styles.submittingRow, { backgroundColor: theme.secondary }]}>
            <ActivityIndicator size="small" color={theme.neonPink} />
            <View style={styles.submittingTextCol}>
              <Text style={[styles.submittingTitle, { color: theme.text }]}>Checking your guess</Text>
              <Text style={[styles.submittingSub, { color: theme.textSecondary }]}>
                Saving your answer to the thread.
              </Text>
            </View>
          </View>
        ) : null}

        {submitError ? (
          <View style={[styles.errorBanner, { borderColor: theme.dangerSoft, backgroundColor: theme.dangerSoft }]}>
            <Ionicons name="alert-circle-outline" size={18} color={theme.danger} />
            <Text style={[styles.errorText, { color: theme.text }]}>{submitError}</Text>
          </View>
        ) : null}

        <View style={styles.statementsBlock}>
          {twoTruthsSnap.statements.map((statement, i) => (
            <StatementRow
              key={`${i}-${statement}`}
              index={i as 0 | 1 | 2}
              text={statement}
              theme={theme}
              snap={twoTruthsSnap}
              phase={phase}
              partnerName={partnerName}
              isStarter={isStarter}
              interactive={actionable}
              disabled={!actionable || isPending}
              onPress={() => void handleGuess(i as 0 | 1 | 2)}
            />
          ))}
        </View>

        {phase === 'waiting_partner' && !isExpired ? (
          <View style={[styles.waitingFootnote, { borderColor: theme.border }]}>
            <Ionicons name="ellipse-outline" size={14} color={theme.neonCyan} />
            <Text style={[styles.waitingFootnoteText, { color: theme.textSecondary }]}>
              Waiting for {partnerName} to guess your lie. The reveal appears once they choose.
            </Text>
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
    { icon: ComponentProps<typeof Ionicons>['name']; headline: string; detail: string; bg: string; iconColor: string }
  > = {
    actionable: {
      icon: 'hand-left-outline',
      headline: 'Your turn to guess',
      detail: `Pick the one statement you think is ${partnerName}'s lie.`,
      bg: 'rgba(6,182,212,0.12)',
      iconColor: theme.neonCyan,
    },
    waiting_partner: {
      icon: 'hourglass-outline',
      headline: `Waiting on ${partnerName}`,
      detail: 'Challenge sent. They still need to lock in a guess.',
      bg: 'rgba(139,92,246,0.14)',
      iconColor: theme.neonViolet,
    },
    invalid_context: {
      icon: 'warning-outline',
      headline: 'Something is off',
      detail: 'Pull to refresh the chat, then try again.',
      bg: theme.dangerSoft,
      iconColor: theme.danger,
    },
    ambiguous: {
      icon: 'help-circle-outline',
      headline: 'Round in progress',
      detail: 'We will update this when the next event arrives.',
      bg: theme.secondary,
      iconColor: theme.textSecondary,
    },
  };
  const c = cfg[phase];
  return (
    <View style={[styles.statusStrip, { backgroundColor: c.bg }]}>
      <View style={[styles.statusIconCircle, { backgroundColor: 'rgba(0,0,0,0.2)' }]}>
        <Ionicons name={c.icon} size={22} color={c.iconColor} />
      </View>
      <View style={styles.statusStripText}>
        <Text style={[styles.statusHeadline, { color: theme.text }]}>{c.headline}</Text>
        <Text style={[styles.statusDetail, { color: theme.textSecondary }]}>{c.detail}</Text>
      </View>
    </View>
  );
}

function CompleteOutcomeBlock({
  snap,
  theme,
  partnerName,
  isStarter,
  phase,
}: {
  snap: TwoTruthsSnapshot;
  theme: (typeof Colors)['light'];
  partnerName: string;
  isStarter: boolean;
  phase: CompletePhase;
}) {
  const guessIndex = snap.guessed_index;
  const lieIndex = snap.lie_index;
  const guessLabel = guessIndex != null ? statementLabel(guessIndex) : '—';
  const lieLabel = statementLabel(lieIndex);
  const correct = phase === 'complete_correct';

  return (
    <View
      style={[
        styles.outcomeBlock,
        {
          borderColor: correct ? 'rgba(34,197,94,0.45)' : 'rgba(236,72,153,0.45)',
          backgroundColor: correct ? 'rgba(34,197,94,0.08)' : 'rgba(236,72,153,0.08)',
        },
      ]}
    >
      <View style={styles.outcomeTop}>
        <Ionicons name={correct ? 'checkmark-circle' : 'close-circle'} size={26} color={correct ? theme.success : theme.neonPink} />
        <View style={styles.outcomeTopText}>
          <Text style={[styles.outcomeTitle, { color: theme.text }]}>
            {correct ? (isStarter ? `${partnerName} caught it` : 'You got it') : isStarter ? `${partnerName} missed` : 'Nice try'}
          </Text>
          <Text style={[styles.outcomeSubtitle, { color: theme.textSecondary }]}>
            {correct
              ? `Lie was statement ${lieLabel}.`
              : `Lie was statement ${lieLabel}, guessed ${guessLabel}.`}
          </Text>
        </View>
      </View>
    </View>
  );
}

function StatementRow({
  index,
  text,
  theme,
  snap,
  phase,
  partnerName,
  isStarter,
  interactive,
  disabled,
  onPress,
}: {
  index: 0 | 1 | 2;
  text: string;
  theme: (typeof Colors)['light'];
  snap: TwoTruthsSnapshot;
  phase: BubblePhase;
  partnerName: string;
  isStarter: boolean;
  interactive: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  if (phase === 'expired') {
    return (
      <View
        style={[
          styles.statementRow,
          {
            borderColor: theme.border,
            backgroundColor: theme.surfaceSubtle,
          },
        ]}
      >
        <View style={[styles.statementIndex, { backgroundColor: theme.muted }]}>
          <Text style={[styles.statementIndexText, { color: theme.text }]}>{statementLabel(index)}</Text>
        </View>
        <View style={styles.statementBody}>
          <Text style={[styles.statementText, { color: theme.text }]} numberOfLines={4}>
            {text}
          </Text>
        </View>
      </View>
    );
  }

  const isLie = snap.lie_index === index;
  const guessed = snap.guessed_index === index;
  const complete = phase === 'complete_correct' || phase === 'complete_wrong';
  const waitingPartner = phase === 'waiting_partner';

  let badge: string | undefined;
  if (complete) {
    if (isLie) badge = 'Lie';
    else if (guessed) badge = 'Guess';
  } else if (waitingPartner) {
    if (isLie) badge = 'Your lie';
    else badge = `${partnerName}'s options`;
  }

  const borderColor = complete && isLie ? 'rgba(34,197,94,0.45)' : guessed ? 'rgba(236,72,153,0.45)' : theme.border;
  const backgroundColor =
    complete && isLie
      ? 'rgba(34,197,94,0.1)'
      : guessed
        ? 'rgba(236,72,153,0.1)'
        : waitingPartner && !isLie
          ? 'rgba(6,182,212,0.06)'
          : theme.surfaceSubtle;

  const body = (
    <View
      style={[
        styles.statementRow,
        {
          borderColor,
          backgroundColor,
          opacity: disabled && interactive ? 0.55 : 1,
        },
      ]}
    >
      <View style={[styles.statementIndex, { backgroundColor: theme.muted }]}>
        <Text style={[styles.statementIndexText, { color: theme.text }]}>{statementLabel(index)}</Text>
      </View>
      <View style={styles.statementBody}>
        <Text style={[styles.statementText, { color: theme.text }]} numberOfLines={4}>
          {text}
        </Text>
        {badge ? (
          <View style={[styles.badge, { backgroundColor: 'rgba(255,255,255,0.06)' }]}>
            <Text style={[styles.badgeText, { color: isLie ? theme.success : theme.neonPink }]}>{badge}</Text>
          </View>
        ) : null}
      </View>
      {interactive ? (
        <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} style={styles.statementChevron} />
      ) : complete && (isLie || guessed) ? (
        <Ionicons
          name={isLie ? 'checkmark-circle' : 'help-circle'}
          size={20}
          color={isLie ? theme.success : theme.neonPink}
          style={styles.statementChevron}
        />
      ) : null}
    </View>
  );

  if (interactive && !isStarter) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`Guess statement ${statementLabel(index)}`}
        style={({ pressed }) => [{ alignSelf: 'stretch', opacity: pressed && !disabled ? 0.9 : 1 }]}
      >
        {body}
      </Pressable>
    );
  }

  return body;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  accentBar: { height: 3, width: '100%' },
  inner: { padding: spacing.md, gap: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  titleTextCol: { flex: 1, minWidth: 0 },
  kicker: { fontSize: 10, fontWeight: '600', letterSpacing: 0.2 },
  title: { fontSize: 16, fontWeight: '700', marginTop: 2 },
  expiredStatus: { textAlign: 'center', fontSize: 13, lineHeight: 18, paddingVertical: spacing.sm },
  statusStrip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  statusIconCircle: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  statusStripText: { flex: 1, minWidth: 0, gap: 4 },
  statusHeadline: { fontSize: 16, fontWeight: '700' },
  statusDetail: { fontSize: 13, lineHeight: 18 },
  submittingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
  },
  submittingTextCol: { flex: 1, gap: 2 },
  submittingTitle: { fontSize: 15, fontWeight: '600' },
  submittingSub: { fontSize: 12, lineHeight: 16 },
  outcomeBlock: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.sm + 2,
    gap: spacing.sm,
  },
  outcomeTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  outcomeTopText: { flex: 1, minWidth: 0, gap: 6 },
  outcomeTitle: { fontSize: 17, fontWeight: '700' },
  outcomeSubtitle: { fontSize: 13, lineHeight: 19 },
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
  statementsBlock: { gap: spacing.sm },
  statementRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    width: '100%',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.sm + 2,
  },
  statementIndex: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  statementIndexText: { fontSize: 14, fontWeight: '700' },
  statementBody: { flex: 1, minWidth: 0, gap: 6 },
  statementText: { fontSize: 14, lineHeight: 19 },
  statementChevron: { marginLeft: 'auto', marginTop: 4, alignSelf: 'center' },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  waitingFootnote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  waitingFootnoteText: { flex: 1, fontSize: 12, lineHeight: 17 },
  time: { fontSize: 11, marginTop: 2 },
});
