import { useEffect, useRef, useState } from 'react';
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
} from '@/lib/gamesApi';

type Props = {
  view: NativeHydratedGameSessionView;
  matchId: string;
  currentUserId: string;
  partnerName: string;
  timeLabel: string;
};

export function WouldRatherBubble({ view, matchId, currentUserId, partnerName, timeLabel }: Props) {
  const theme = Colors[useColorScheme()];
  const snap = view.foldedSnapshot;
  if (snap.game_type !== 'would_rather') return null;

  const isStarter = view.starterUserId === currentUserId;
  const complete = snap.status === 'complete';
  const { mutateAsync, isPending } = useSendWouldRatherChoice();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const tapGuard = useRef(false);

  const canBuildVote = buildWouldRatherReceiverVoteParams(view, matchId, 'A') != null;
  const actionable = canBuildVote && !complete;
  const optionRowsDisabled = !actionable || isPending;

  useEffect(() => {
    setSubmitError(null);
  }, [view.gameSessionId, view.latestMessageId, view.updatedAt, snap.receiver_vote, snap.status]);

  let statusHeadline: string;
  let statusDetail: string;
  if (complete) {
    statusHeadline = snap.is_match === true ? 'Same pick' : 'Different picks';
    statusDetail =
      snap.is_match === true ? 'You lined up on this one.' : 'Still a fun compare — no wrong answers.';
  } else if (isPending) {
    statusHeadline = 'Sending…';
    statusDetail = 'Hang tight — updating this round.';
  } else if (view.canCurrentUserActNext && actionable) {
    statusHeadline = 'Your turn';
    statusDetail = `Tap A or B to choose — ${partnerName} already picked.`;
  } else if (isStarter) {
    statusHeadline = `Waiting on ${partnerName}`;
    statusDetail = 'They still need to choose.';
  } else if (view.canCurrentUserActNext && !canBuildVote) {
    statusHeadline = 'Your turn';
    statusDetail = 'This prompt is incomplete — refresh the thread.';
  } else {
    statusHeadline = 'In progress';
    statusDetail = 'Session is still open.';
  }

  const starterPicked = snap.sender_vote;
  const receiverPicked = snap.receiver_vote;

  const handlePick = async (vote: 'A' | 'B') => {
    if (tapGuard.current || isPending) return;
    if (!canBuildVote) return;
    tapGuard.current = true;
    setSubmitError(null);
    try {
      const result = await mutateAsync({ view, matchId, receiverVote: vote });
      if (!result.ok) {
        setSubmitError(formatSendGameEventError(result.error));
      }
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      tapGuard.current = false;
    }
  };

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.surface,
          borderColor: 'rgba(255,255,255,0.1)',
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
            <Text style={[styles.title, { color: theme.text }]}>Would you rather</Text>
          </View>
        </View>

        <View style={[styles.statusPill, { backgroundColor: theme.secondary }]}>
          <Text style={[styles.statusHeadline, { color: theme.text }]}>{statusHeadline}</Text>
          <Text style={[styles.statusDetail, { color: theme.textSecondary }]}>{statusDetail}</Text>
        </View>

        {isPending ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={theme.neonPink} />
            <Text style={[styles.loadingLabel, { color: theme.textSecondary }]}>Submitting pick…</Text>
          </View>
        ) : null}

        {submitError ? (
          <View style={[styles.errorBanner, { borderColor: theme.dangerSoft, backgroundColor: theme.dangerSoft }]}>
            <Ionicons name="alert-circle-outline" size={18} color={theme.danger} />
            <Text style={[styles.errorText, { color: theme.text }]}>{submitError}</Text>
          </View>
        ) : null}

        <View style={styles.optionsBlock}>
          <OptionRow
            label="A"
            text={snap.option_a}
            theme={theme}
            highlightVote={starterPicked === 'A' || receiverPicked === 'A'}
            voteLabel={optionVoteLabel('A', snap, complete, isStarter, partnerName)}
            interactive={actionable}
            disabled={optionRowsDisabled}
            onPress={() => void handlePick('A')}
          />
          <OptionRow
            label="B"
            text={snap.option_b}
            theme={theme}
            highlightVote={starterPicked === 'B' || receiverPicked === 'B'}
            voteLabel={optionVoteLabel('B', snap, complete, isStarter, partnerName)}
            interactive={actionable}
            disabled={optionRowsDisabled}
            onPress={() => void handlePick('B')}
          />
        </View>

        {complete ? (
          <View style={[styles.resultBanner, { borderColor: theme.border }]}>
            <Ionicons
              name={snap.is_match ? 'heart' : 'ellipse-outline'}
              size={18}
              color={snap.is_match ? theme.neonPink : theme.textSecondary}
            />
            <Text style={[styles.resultText, { color: theme.textSecondary }]}>
              {snap.is_match
                ? 'You both chose the same side.'
                : (() => {
                    const youPick = isStarter ? starterPicked : (receiverPicked ?? '?');
                    const themPick = isStarter ? (receiverPicked ?? '?') : starterPicked;
                    return `You chose ${youPick} · ${partnerName} chose ${themPick}`;
                  })()}
            </Text>
          </View>
        ) : null}

        <Text style={[styles.time, { color: theme.textSecondary }]}>{timeLabel}</Text>
      </View>
    </View>
  );
}

function optionVoteLabel(
  side: 'A' | 'B',
  snap: WouldRatherSnapshot,
  complete: boolean,
  viewerIsStarter: boolean,
  partnerName: string
): string | undefined {
  const starterOnSide = snap.sender_vote === side;
  const receiverOnSide = snap.receiver_vote === side;
  if (!starterOnSide && !receiverOnSide) return undefined;
  if (complete) {
    if (starterOnSide && receiverOnSide) return 'Both picked';
    if (starterOnSide) return viewerIsStarter ? 'Your pick' : `${partnerName}'s pick`;
    return viewerIsStarter ? `${partnerName}'s pick` : 'Your pick';
  }
  if (starterOnSide) return viewerIsStarter ? 'Your pick' : `${partnerName}'s pick`;
  return undefined;
}

function OptionRow({
  label,
  text,
  theme,
  highlightVote,
  voteLabel,
  interactive,
  disabled,
  onPress,
}: {
  label: string;
  text: string;
  theme: (typeof Colors)['light'];
  highlightVote: boolean;
  voteLabel?: string;
  interactive?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  const body = (
    <View
      style={[
        styles.optionRow,
        {
          borderColor: highlightVote ? 'rgba(236,72,153,0.35)' : theme.border,
          backgroundColor: highlightVote ? 'rgba(236,72,153,0.06)' : theme.surfaceSubtle,
          opacity: disabled && interactive ? 0.55 : 1,
        },
      ]}
    >
      <View style={[styles.optionLetter, { backgroundColor: theme.muted }]}>
        <Text style={[styles.optionLetterText, { color: theme.text }]}>{label}</Text>
      </View>
      <View style={styles.optionBody}>
        <Text style={[styles.optionText, { color: theme.text }]} numberOfLines={4}>
          {text}
        </Text>
        {voteLabel ? (
          <Text style={[styles.optionBadge, { color: theme.neonPink }]}>{voteLabel}</Text>
        ) : null}
      </View>
      {interactive ? (
        <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} style={styles.optionChevron} />
      ) : null}
    </View>
  );

  if (interactive && onPress) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`Choose option ${label}`}
        style={({ pressed }) => [
          { alignSelf: 'stretch', opacity: pressed && !disabled ? 0.88 : 1 },
        ]}
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
  statusPill: {
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: 4,
  },
  statusHeadline: {
    fontSize: 15,
    fontWeight: '600',
  },
  statusDetail: {
    fontSize: 13,
    lineHeight: 18,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  loadingLabel: {
    fontSize: 13,
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
    gap: 4,
  },
  optionText: {
    fontSize: 15,
    lineHeight: 21,
  },
  optionBadge: {
    fontSize: 12,
    fontWeight: '600',
  },
  optionChevron: {
    marginLeft: 'auto',
    marginTop: 4,
    alignSelf: 'center',
  },
  resultBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  resultText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  time: {
    fontSize: 11,
    marginTop: 2,
  },
});
