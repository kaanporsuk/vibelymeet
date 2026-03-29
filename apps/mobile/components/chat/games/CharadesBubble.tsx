import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, TextInput } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import type { NativeHydratedGameSessionView } from '@/lib/chatGameSessions';
import type { CharadesSnapshot } from '@/lib/vibelyGamesTypes';
import {
  buildCharadesGuessParams,
  formatSendGameEventError,
  useSendCharadesChoice,
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
  | 'complete'
  | 'submitting'
  | 'actionable'
  | 'waiting_partner'
  | 'invalid_context'
  | 'ambiguous';

type NonCompleteNonSubmittingPhase = Exclude<BubblePhase, 'complete' | 'submitting' | 'expired'>;

function derivePhase(
  snap: CharadesSnapshot,
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
  if (isStarter && snap.is_guessed !== true) return 'waiting_partner';
  return 'ambiguous';
}

function isNonCompleteNonSubmittingPhase(phase: BubblePhase): phase is NonCompleteNonSubmittingPhase {
  return phase !== 'complete' && phase !== 'submitting' && phase !== 'expired';
}

export function CharadesBubble({ view, matchId, currentUserId, partnerName, timeLabel, invalidateScope }: Props) {
  const theme = Colors[useColorScheme()];
  const snap = view.foldedSnapshot;
  const charadesSnap = snap.game_type === 'charades' ? snap : null;

  const { mutateAsync, isPending } = useSendCharadesChoice();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [guessText, setGuessText] = useState('');
  const tapGuard = useRef(false);

  useEffect(() => {
    if (!charadesSnap) return;
    setSubmitError(null);
    setGuessText('');
  }, [
    view.gameSessionId,
    view.latestMessageId,
    view.updatedAt,
    charadesSnap?.status,
    charadesSnap?.guesses?.length,
    charadesSnap?.is_guessed,
  ]);

  if (!charadesSnap) return null;

  const creationMs = view.createdAt ? new Date(view.createdAt).getTime() : NaN;
  const isExpired =
    charadesSnap.status === 'active' &&
    Number.isFinite(creationMs) &&
    Date.now() - creationMs > EXPIRY_MS;

  const isStarter = view.starterUserId === currentUserId;
  const complete = charadesSnap.status === 'complete';

  const canBuild = buildCharadesGuessParams(view, matchId, guessText) != null;
  const actionable = !complete && !isExpired && view.canCurrentUserActNext;
  const canSubmit = actionable && canBuild && !isPending;
  const phase = derivePhase(
    charadesSnap,
    complete,
    isPending,
    actionable,
    canBuild,
    view.canCurrentUserActNext,
    isStarter,
    isExpired
  );

  const handleGuess = async () => {
    if (tapGuard.current || isPending) return;
    if (!canBuild) return;
    tapGuard.current = true;
    setSubmitError(null);
    try {
      const result = await mutateAsync({ view, matchId, guess: guessText.trim(), invalidateScope });
      if (!result.ok) {
        setSubmitError(formatSendGameEventError(result.error));
      } else {
        setGuessText('');
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
        { backgroundColor: theme.surface, borderColor: 'rgba(255,255,255,0.1)', opacity: isExpired ? 0.5 : 1 },
      ]}
    >
      <LinearGradient
        colors={[theme.neonViolet, theme.neonPink]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.accentBar}
      />
      <View style={styles.inner}>
        <View style={styles.titleRow}>
          <View style={[styles.iconWrap, { backgroundColor: 'rgba(139,92,246,0.2)' }]}>
            <Ionicons name="happy-outline" size={20} color={theme.neonViolet} />
          </View>
          <View style={styles.titleTextCol}>
            <Text style={[styles.kicker, { color: theme.textSecondary }]}>Vibe Arcade</Text>
            <Text style={[styles.title, { color: theme.text }]}>Emoji Charades</Text>
          </View>
        </View>

        {phase === 'complete' ? (
          <CompleteBlock theme={theme} partnerName={partnerName} isStarter={isStarter} answer={charadesSnap.answer} />
        ) : phase !== 'expired' && isNonCompleteNonSubmittingPhase(phase) ? (
          <StatusStrip phase={phase} partnerName={partnerName} theme={theme} />
        ) : null}

        <View style={styles.emojiRow}>
          {charadesSnap.emojis.map((emoji, idx) => (
            <View key={`${emoji}-${idx}`} style={[styles.emojiChip, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
              <Text style={styles.emojiText}>{emoji}</Text>
            </View>
          ))}
        </View>

        {phase === 'expired' ? (
          <Text style={[styles.expiredStatus, { color: theme.textSecondary }]}>This challenge expired</Text>
        ) : null}

        {phase === 'actionable' ? (
          <View style={[styles.inputCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
            <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>Your guess</Text>
            <TextInput
              value={guessText}
              onChangeText={(t) => {
                setGuessText(t);
                if (submitError) setSubmitError(null);
              }}
              placeholder="Guess the movie/song..."
              placeholderTextColor={theme.textSecondary}
              editable={!isPending}
              maxLength={500}
              style={[
                styles.guessInput,
                {
                  color: theme.text,
                  borderColor: theme.border,
                  backgroundColor: theme.surface,
                },
              ]}
            />
            <Pressable
              onPress={() => void handleGuess()}
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
                <Text style={[styles.submitBtnText, { color: theme.primaryForeground }]}>Submit guess</Text>
              )}
            </Pressable>
          </View>
        ) : null}

        {phase === 'submitting' ? (
          <View style={[styles.submittingRow, { backgroundColor: theme.secondary }]}>
            <ActivityIndicator size="small" color={theme.neonPink} />
            <Text style={[styles.submittingText, { color: theme.text }]}>Checking your guess…</Text>
          </View>
        ) : null}

        {charadesSnap.guesses.length > 0 && phase !== 'complete' && phase !== 'expired' ? (
          <View style={[styles.guessHistory, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
            <Text style={[styles.guessHistoryLabel, { color: theme.textSecondary }]}>Latest guess</Text>
            <Text style={[styles.guessHistoryText, { color: theme.text }]}>{charadesSnap.guesses[charadesSnap.guesses.length - 1]}</Text>
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
      icon: 'search-outline',
      title: 'Your turn to guess',
      detail: `Try to guess ${partnerName}'s title from the emoji clue.`,
      bg: 'rgba(6,182,212,0.12)',
      iconColor: theme.neonCyan,
    },
    waiting_partner: {
      icon: 'hourglass-outline',
      title: `Waiting on ${partnerName}`,
      detail: 'Challenge sent. Waiting for a correct guess.',
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

function CompleteBlock({
  theme,
  partnerName,
  isStarter,
  answer,
}: {
  theme: (typeof Colors)['light'];
  partnerName: string;
  isStarter: boolean;
  answer: string;
}) {
  return (
    <View style={[styles.completeBlock, { borderColor: 'rgba(34,197,94,0.45)', backgroundColor: 'rgba(34,197,94,0.1)' }]}>
      <Ionicons name="checkmark-circle" size={22} color={theme.success} />
      <View style={styles.statusTextWrap}>
        <Text style={[styles.statusTitle, { color: theme.text }]}>
          {isStarter ? `${partnerName} guessed it` : 'You guessed it'}
        </Text>
        <Text style={[styles.statusDetail, { color: theme.textSecondary }]}>Answer: {answer}</Text>
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
  emojiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  emojiChip: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiText: { fontSize: 26 },
  expiredStatus: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: spacing.xs },
  inputCard: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: spacing.sm,
  },
  inputLabel: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  guessInput: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 15,
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
  guessHistory: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 2,
  },
  guessHistoryLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  guessHistoryText: { fontSize: 14, lineHeight: 18 },
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
