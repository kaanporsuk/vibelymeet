import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import type { NativeHydratedGameSessionView } from '@/lib/chatGameSessions';
import type { WouldRatherSnapshot } from '@/lib/vibelyGamesTypes';
import {
  buildWouldRatherReceiverVoteParams,
  formatSendGameEventError,
  useSendWouldRatherChoice,
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

/** UI phases derived only from folded snapshot + hydration flags (no invented game rules). */
type BubblePhase =
  | 'expired'
  | 'complete_match'
  | 'complete_split'
  | 'submitting'
  | 'actionable'
  | 'waiting_partner'
  | 'invalid_context'
  | 'ambiguous';

type CompletePhase = Extract<BubblePhase, 'complete_match' | 'complete_split'>;
type NonCompleteNonSubmittingPhase = Exclude<BubblePhase, CompletePhase | 'submitting' | 'expired'>;

function derivePhase(
  snap: WouldRatherSnapshot,
  complete: boolean,
  isPending: boolean,
  actionable: boolean,
  canBuildVote: boolean,
  canActNext: boolean,
  isStarter: boolean,
  receiverPicked: boolean,
  isExpired: boolean
): BubblePhase {
  if (isExpired) return 'expired';
  if (complete) {
    const match = snap.is_match === true || (snap.receiver_vote != null && snap.sender_vote === snap.receiver_vote);
    return match ? 'complete_match' : 'complete_split';
  }
  if (isPending) return 'submitting';
  if (actionable) return 'actionable';
  if (canActNext && !canBuildVote) return 'invalid_context';
  if (isStarter && !receiverPicked) return 'waiting_partner';
  return 'ambiguous';
}

function optionSnippet(snap: WouldRatherSnapshot, side: 'A' | 'B', maxLen = 52): string {
  const raw = side === 'A' ? snap.option_a : snap.option_b;
  if (raw.length <= maxLen) return raw;
  return `${raw.slice(0, maxLen - 1)}…`;
}

function isCompletePhase(phase: BubblePhase): phase is CompletePhase {
  return phase === 'complete_match' || phase === 'complete_split';
}

function isNonCompleteNonSubmittingPhase(phase: BubblePhase): phase is NonCompleteNonSubmittingPhase {
  return phase !== 'complete_match' && phase !== 'complete_split' && phase !== 'submitting' && phase !== 'expired';
}

export function WouldRatherBubble({ view, matchId, currentUserId, partnerName, timeLabel, invalidateScope }: Props) {
  const theme = Colors[useColorScheme()];
  const snap = view.foldedSnapshot;
  const wouldRatherSnap = snap.game_type === 'would_rather' ? snap : null;

  const { mutateAsync, isPending } = useSendWouldRatherChoice();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const tapGuard = useRef(false);

  useEffect(() => {
    if (!wouldRatherSnap) return;
    setSubmitError(null);
  }, [
    view.gameSessionId,
    view.latestMessageId,
    view.updatedAt,
    wouldRatherSnap?.receiver_vote,
    wouldRatherSnap?.status,
    wouldRatherSnap?.is_match,
  ]);

  if (!wouldRatherSnap) return null;

  const creationMs = view.createdAt ? new Date(view.createdAt).getTime() : NaN;
  const isExpired =
    wouldRatherSnap.status === 'active' &&
    Number.isFinite(creationMs) &&
    Date.now() - creationMs > EXPIRY_MS;

  const isStarter = view.starterUserId === currentUserId;
  const complete = wouldRatherSnap.status === 'complete';

  const canBuildVote = buildWouldRatherReceiverVoteParams(view, matchId, 'A') != null;
  const actionable = canBuildVote && !complete && !isExpired;
  const optionRowsDisabled = !actionable || isPending;

  const receiverPicked = wouldRatherSnap.receiver_vote != null;
  const phase = derivePhase(
    wouldRatherSnap,
    complete,
    isPending,
    actionable,
    canBuildVote,
    view.canCurrentUserActNext,
    isStarter,
    receiverPicked,
    isExpired
  );

  const handlePick = async (vote: 'A' | 'B') => {
    if (isExpired) return;
    if (tapGuard.current || isPending) return;
    if (!canBuildVote) return;
    tapGuard.current = true;
    setSubmitError(null);
    try {
      const result = await mutateAsync({ view, matchId, receiverVote: vote, invalidateScope });
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
      <StatusStrip
        phase={phase}
        partnerName={partnerName}
        theme={theme}
        senderVote={wouldRatherSnap.sender_vote}
      />
    ) : null;

  const completeHero = isCompletePhase(phase) ? (
    <CompleteOutcomeBlock
      snap={wouldRatherSnap}
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
        {
          backgroundColor: theme.surface,
          borderColor: 'rgba(255,255,255,0.1)',
          opacity: isExpired ? 0.5 : 1,
        },
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
          <View style={[styles.iconWrap, { backgroundColor: 'rgba(139,92,246,0.2)' }]}>
            <Ionicons name="shuffle-outline" size={20} color={theme.neonViolet} />
          </View>
          <View style={styles.titleTextCol}>
            <Text style={[styles.kicker, { color: theme.textSecondary }]}>Vibe Arcade</Text>
            <Text style={[styles.title, { color: theme.text }]}>Would You Rather?</Text>
          </View>
        </View>

        {completeHero}
        {statusStrip}

        {phase === 'submitting' ? (
          <View style={[styles.submittingRow, { backgroundColor: theme.secondary }]}>
            <ActivityIndicator size="small" color={theme.neonPink} />
            <View style={styles.submittingTextCol}>
              <Text style={[styles.submittingTitle, { color: theme.text }]}>Sending your pick</Text>
              <Text style={[styles.submittingSub, { color: theme.textSecondary }]}>
                This usually takes a moment.
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

        {phase === 'expired' ? (
          <>
            <View style={styles.optionsBlock}>
              <View style={[styles.optionRow, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
                <View style={[styles.optionLetter, { backgroundColor: theme.muted }]}>
                  <Text style={[styles.optionLetterText, { color: theme.text }]}>A</Text>
                </View>
                <View style={styles.optionBody}>
                  <Text style={[styles.optionText, { color: theme.text }]} numberOfLines={4}>
                    {wouldRatherSnap.option_a}
                  </Text>
                </View>
              </View>
              <View style={[styles.optionRow, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
                <View style={[styles.optionLetter, { backgroundColor: theme.muted }]}>
                  <Text style={[styles.optionLetterText, { color: theme.text }]}>B</Text>
                </View>
                <View style={styles.optionBody}>
                  <Text style={[styles.optionText, { color: theme.text }]} numberOfLines={4}>
                    {wouldRatherSnap.option_b}
                  </Text>
                </View>
              </View>
            </View>
            <Text style={[styles.expiredStatus, { color: theme.textSecondary }]}>This challenge expired</Text>
          </>
        ) : (
          <View style={styles.optionsBlock}>
            <OptionRow
              label="A"
              text={wouldRatherSnap.option_a}
              theme={theme}
              side="A"
              snap={wouldRatherSnap}
              complete={complete}
              isStarter={isStarter}
              partnerName={partnerName}
              interactive={actionable}
              disabled={optionRowsDisabled}
              phase={phase}
              onPress={() => void handlePick('A')}
            />
            <OptionRow
              label="B"
              text={wouldRatherSnap.option_b}
              theme={theme}
              side="B"
              snap={wouldRatherSnap}
              complete={complete}
              isStarter={isStarter}
              partnerName={partnerName}
              interactive={actionable}
              disabled={optionRowsDisabled}
              phase={phase}
              onPress={() => void handlePick('B')}
            />
          </View>
        )}

        {phase === 'waiting_partner' ? (
          <View style={[styles.waitingFootnote, { borderColor: theme.border }]}>
            <Ionicons name="ellipse-outline" size={14} color={theme.neonCyan} />
            <Text style={[styles.waitingFootnoteText, { color: theme.textSecondary }]}>
              The other side is still open for {partnerName}. When they choose, you will both see the full
              result.
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
  senderVote,
  theme,
}: {
  phase: NonCompleteNonSubmittingPhase;
  partnerName: string;
  senderVote: 'A' | 'B';
  theme: (typeof Colors)['light'];
}) {
  const cfg: Record<
    NonCompleteNonSubmittingPhase,
    { icon: ComponentProps<typeof Ionicons>['name']; headline: string; detail: string; bg: string; iconColor: string }
  > = {
    actionable: {
      icon: 'hand-left-outline',
      headline: 'Your turn to answer',
      detail: `${partnerName} already chose option ${senderVote}. Tap A or B for yourself.`,
      bg: 'rgba(6,182,212,0.12)',
      iconColor: theme.neonCyan,
    },
    waiting_partner: {
      icon: 'hourglass-outline',
      headline: `Waiting on ${partnerName}`,
      detail: 'Your pick is in. They still need to choose a side.',
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

function voteSnippet(snap: WouldRatherSnapshot, v: 'A' | 'B' | undefined | null): string {
  if (v === 'A' || v === 'B') return optionSnippet(snap, v);
  return '—';
}

function CompleteOutcomeBlock({
  snap,
  theme,
  partnerName,
  isStarter,
  phase,
}: {
  snap: WouldRatherSnapshot;
  theme: (typeof Colors)['light'];
  partnerName: string;
  isStarter: boolean;
  phase: 'complete_match' | 'complete_split';
}) {
  const match = phase === 'complete_match';
  const youVote = isStarter ? snap.sender_vote : snap.receiver_vote;
  const themVote = isStarter ? snap.receiver_vote : snap.sender_vote;

  return (
    <View
      style={[
        styles.outcomeBlock,
        {
          borderColor: match ? 'rgba(236,72,153,0.45)' : 'rgba(139,92,246,0.35)',
          backgroundColor: match ? 'rgba(236,72,153,0.08)' : 'rgba(139,92,246,0.07)',
        },
      ]}
    >
      <View style={styles.outcomeTop}>
        <Ionicons
          name={match ? 'heart' : 'git-compare-outline'}
          size={26}
          color={match ? theme.neonPink : theme.neonViolet}
        />
        <View style={styles.outcomeTopText}>
          <Text style={[styles.outcomeTitle, { color: theme.text }]}>
            {match ? 'Same wavelength' : 'Two honest picks'}
          </Text>
          <Text style={[styles.outcomeSubtitle, { color: theme.textSecondary }]}>
            {match
              ? `You and ${partnerName} chose the same letter — no right or wrong, just alignment.`
              : `Different letters — still a great compare. Here is how each of you landed.`}
          </Text>
        </View>
      </View>
      <View style={[styles.outcomePicksRow, { borderTopColor: 'rgba(255,255,255,0.08)' }]}>
        <View style={styles.outcomePickCol}>
          <Text style={[styles.outcomePickLabel, { color: theme.textSecondary }]}>You</Text>
          <Text style={[styles.outcomePickLetter, { color: theme.text }]}>{youVote ?? '—'}</Text>
          <Text style={[styles.outcomePickSnippet, { color: theme.textSecondary }]} numberOfLines={2}>
            {voteSnippet(snap, youVote)}
          </Text>
        </View>
        <View style={[styles.outcomeDivider, { backgroundColor: 'rgba(255,255,255,0.12)' }]} />
        <View style={styles.outcomePickCol}>
          <Text style={[styles.outcomePickLabel, { color: theme.textSecondary }]}>{partnerName}</Text>
          <Text style={[styles.outcomePickLetter, { color: theme.text }]}>{themVote ?? '—'}</Text>
          <Text style={[styles.outcomePickSnippet, { color: theme.textSecondary }]} numberOfLines={2}>
            {voteSnippet(snap, themVote)}
          </Text>
        </View>
      </View>
    </View>
  );
}

function OptionRow({
  label,
  text,
  theme,
  side,
  snap,
  complete,
  isStarter,
  partnerName,
  interactive,
  disabled,
  phase,
  onPress,
}: {
  label: string;
  text: string;
  theme: (typeof Colors)['light'];
  side: 'A' | 'B';
  snap: WouldRatherSnapshot;
  complete: boolean;
  isStarter: boolean;
  partnerName: string;
  interactive: boolean;
  disabled: boolean;
  phase: BubblePhase;
  onPress: () => void;
}) {
  const starterOnSide = snap.sender_vote === side;
  const receiverOnSide = snap.receiver_vote === side;
  const picked = starterOnSide || receiverOnSide;
  const yourPick = (isStarter && starterOnSide) || (!isStarter && receiverOnSide);
  const partnerPick = complete && ((isStarter && receiverOnSide) || (!isStarter && starterOnSide));

  const waitingPartnerOpen = phase === 'waiting_partner' && !starterOnSide && isStarter;

  let badge: string | undefined;
  if (complete) {
    if (starterOnSide && receiverOnSide) badge = 'Both';
    else if (yourPick) badge = 'You';
    else if (partnerPick) badge = partnerName;
  } else if (yourPick) badge = 'Your pick';
  else if (phase === 'waiting_partner' && waitingPartnerOpen) badge = 'Their move';

  const borderColor = picked
    ? 'rgba(236,72,153,0.42)'
    : waitingPartnerOpen
      ? 'rgba(6,182,212,0.35)'
      : theme.border;
  const backgroundColor = picked
    ? 'rgba(236,72,153,0.09)'
    : waitingPartnerOpen
      ? 'rgba(6,182,212,0.06)'
      : theme.surfaceSubtle;
  const dashStyle = waitingPartnerOpen ? { borderStyle: 'dashed' as const } : {};

  const body = (
    <View
      style={[
        styles.optionRow,
        {
          borderColor,
          backgroundColor,
          opacity: disabled && interactive ? 0.55 : 1,
        },
        dashStyle,
      ]}
    >
      <View style={[styles.optionLetter, { backgroundColor: theme.muted }]}>
        <Text style={[styles.optionLetterText, { color: theme.text }]}>{label}</Text>
      </View>
      <View style={styles.optionBody}>
        <Text style={[styles.optionText, { color: theme.text }]} numberOfLines={4}>
          {text}
        </Text>
        {badge ? (
          <View style={[styles.badge, { backgroundColor: 'rgba(255,255,255,0.06)' }]}>
            <Text style={[styles.badgeText, { color: theme.neonPink }]}>{badge}</Text>
          </View>
        ) : null}
      </View>
      {interactive ? (
        <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} style={styles.optionChevron} />
      ) : complete && picked ? (
        <Ionicons name="checkmark-circle" size={20} color={theme.neonPink} style={styles.optionChevron} />
      ) : null}
    </View>
  );

  if (interactive) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`Choose option ${label}`}
        style={({ pressed }) => [{ alignSelf: 'stretch', opacity: pressed && !disabled ? 0.88 : 1 }]}
      >
        {body}
      </Pressable>
    );
  }

  return body;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  accentBar: {
    height: 3,
    width: '100%',
  },
  inner: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleTextCol: {
    flex: 1,
    minWidth: 0,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 2,
  },
  expiredStatus: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  outcomeBlock: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: spacing.md,
  },
  outcomeTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  outcomeTopText: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  outcomeTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  outcomeSubtitle: {
    fontSize: 13,
    lineHeight: 19,
  },
  outcomePicksRow: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  outcomePickCol: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  outcomeDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
  },
  outcomePickLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  outcomePickLetter: {
    fontSize: 22,
    fontWeight: '800',
  },
  outcomePickSnippet: {
    fontSize: 12,
    lineHeight: 16,
  },
  statusStrip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  statusIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusStripText: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  statusHeadline: {
    fontSize: 16,
    fontWeight: '700',
  },
  statusDetail: {
    fontSize: 13,
    lineHeight: 18,
  },
  submittingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
  },
  submittingTextCol: {
    flex: 1,
    gap: 2,
  },
  submittingTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  submittingSub: {
    fontSize: 12,
    lineHeight: 16,
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
  errorText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  optionsBlock: {
    gap: spacing.sm,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    width: '100%',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  optionLetter: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionLetterText: {
    fontSize: 14,
    fontWeight: '700',
  },
  optionBody: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  optionText: {
    fontSize: 15,
    lineHeight: 21,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  optionChevron: {
    marginLeft: 'auto',
    marginTop: 4,
    alignSelf: 'center',
  },
  waitingFootnote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  waitingFootnoteText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  time: {
    fontSize: 11,
    marginTop: 2,
  },
});
