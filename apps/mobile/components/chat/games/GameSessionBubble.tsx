import { View, Text, StyleSheet } from 'react-native';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { spacing, radius } from '@/constants/theme';
import type { NativeHydratedGameSessionView } from '@/lib/chatGameSessions';
import { CharadesBubble } from '@/components/chat/games/CharadesBubble';
import { IntuitionBubble } from '@/components/chat/games/IntuitionBubble';
import { RouletteBubble } from '@/components/chat/games/RouletteBubble';
import { ScavengerBubble } from '@/components/chat/games/ScavengerBubble';
import { TwoTruthsBubble } from '@/components/chat/games/TwoTruthsBubble';
import { WouldRatherBubble } from '@/components/chat/games/WouldRatherBubble';

type Props = {
  view: NativeHydratedGameSessionView;
  matchId: string;
  currentUserId: string;
  partnerName: string;
  timeLabel: string;
};

/**
 * Routes hydrated `vibe_game_session` rows to the right native renderer; safe generic fallback
 * for unsupported or mismatched game types.
 */
export function GameSessionBubble({ view, matchId, currentUserId, partnerName, timeLabel }: Props) {
  const theme = Colors[useColorScheme()];

  if (view.gameType === '2truths' && view.foldedSnapshot.game_type === '2truths') {
    return (
      <TwoTruthsBubble
        view={view}
        matchId={matchId}
        currentUserId={currentUserId}
        partnerName={partnerName}
        timeLabel={timeLabel}
      />
    );
  }

  if (view.gameType === 'intuition' && view.foldedSnapshot.game_type === 'intuition') {
    return (
      <IntuitionBubble
        view={view}
        matchId={matchId}
        currentUserId={currentUserId}
        partnerName={partnerName}
        timeLabel={timeLabel}
      />
    );
  }

  if (view.gameType === 'charades' && view.foldedSnapshot.game_type === 'charades') {
    return (
      <CharadesBubble
        view={view}
        matchId={matchId}
        currentUserId={currentUserId}
        partnerName={partnerName}
        timeLabel={timeLabel}
      />
    );
  }

  if (view.gameType === 'roulette' && view.foldedSnapshot.game_type === 'roulette') {
    return (
      <RouletteBubble
        view={view}
        matchId={matchId}
        currentUserId={currentUserId}
        partnerName={partnerName}
        timeLabel={timeLabel}
      />
    );
  }

  if (view.gameType === 'scavenger' && view.foldedSnapshot.game_type === 'scavenger') {
    return (
      <ScavengerBubble
        view={view}
        matchId={matchId}
        currentUserId={currentUserId}
        partnerName={partnerName}
        timeLabel={timeLabel}
      />
    );
  }

  if (view.gameType === 'would_rather' && view.foldedSnapshot.game_type === 'would_rather') {
    return (
      <WouldRatherBubble
        view={view}
        matchId={matchId}
        currentUserId={currentUserId}
        partnerName={partnerName}
        timeLabel={timeLabel}
      />
    );
  }

  const label =
    view.gameType != null
      ? `${view.gameType.replace(/_/g, ' ')} (coming soon)`
      : 'Game session';

  return (
    <View
      style={[
        styles.fallback,
        {
          borderColor: theme.border,
          backgroundColor: theme.surface,
        },
      ]}
    >
      <Text style={[styles.fallbackTitle, { color: theme.text }]}>🎮 {label}</Text>
      <Text style={[styles.fallbackMeta, { color: theme.textSecondary }]}>
        Status: {view.status}
        {view.canCurrentUserActNext ? ' · Your turn' : ''}
      </Text>
      <Text style={[styles.fallbackTime, { color: theme.textSecondary }]}>{timeLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    borderRadius: radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    gap: 6,
  },
  fallbackTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  fallbackMeta: {
    fontSize: 12,
  },
  fallbackTime: {
    fontSize: 11,
    marginTop: 4,
  },
});
