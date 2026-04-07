import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/Themed';
import { VibelyButton } from '@/components/ui';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

export default function CelebrationStep({
  submitting,
  completed,
  errorMessage,
  onRetry,
  onGoBackToEdit,
  vibeScore,
  vibeScoreLabel,
  onGoNow,
  onExploreEvents,
}: {
  submitting: boolean;
  completed: boolean;
  errorMessage: string | null;
  onRetry: () => void;
  /** When finalize fails, lets users leave the dead-end screen and fix answers (e.g. validation). */
  onGoBackToEdit?: () => void;
  vibeScore: number;
  vibeScoreLabel: string;
  onGoNow: () => void;
  onExploreEvents: () => void;
}) {
  const theme = Colors[useColorScheme()];

  if (submitting && !completed) {
    return (
      <View style={styles.root}>
        <Text style={[styles.h1, { color: theme.text }]}>Finishing your profile...</Text>
        <Text style={{ color: theme.textSecondary }}>One sec while we lock it in.</Text>
      </View>
    );
  }

  if (errorMessage && !completed) {
    return (
      <View style={styles.root}>
        <Text style={[styles.h1, { color: theme.text }]}>Couldn't save your profile.</Text>
        <Text style={{ color: theme.textSecondary, textAlign: 'center' }}>
          {errorMessage}
        </Text>
        <Text style={{ color: theme.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 4 }}>
          Check your connection, then try again. If something in your answers needs changing, go back one step.
        </Text>
        <VibelyButton label="Retry" onPress={onRetry} variant="gradient" />
        {onGoBackToEdit ? (
          <VibelyButton label="Go back to edit" onPress={onGoBackToEdit} variant="secondary" />
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Text style={styles.party}>🎉</Text>
      <Text style={[styles.h1, { color: theme.text }]}>You're in!</Text>
      <Text style={[styles.sub, { color: theme.textSecondary }]}>Your Vibe Score: {vibeScore} · {vibeScoreLabel}</Text>
      <VibelyButton label="Go to Now" onPress={onGoNow} variant="gradient" />
      <VibelyButton label="Explore events" onPress={onExploreEvents} variant="secondary" />
    </View>
  );
}

const styles = StyleSheet.create({ root: { gap: 12, alignItems: 'center' }, party: { fontSize: 56 }, h1: { fontSize: 34, fontWeight: '700' }, sub: { fontSize: 14 } });
