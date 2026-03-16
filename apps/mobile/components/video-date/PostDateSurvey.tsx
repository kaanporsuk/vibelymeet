/**
 * Post-date survey: Screen 1 (mandatory) — Did you vibe? Vibe or Pass.
 * Writes participant_X_liked and runs check_mutual_vibe_and_match.
 * If mutual: show celebration then navigate to matches/lobby. Else: warm message, navigate to lobby/dashboard.
 */

import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Image, ActivityIndicator } from 'react-native';
import { typography, spacing, radius } from '@/constants/theme';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type Props = {
  sessionId: string;
  userId: string;
  partnerId: string;
  partnerName: string;
  partnerImage: string | null;
  eventId: string | undefined;
  onSubmitVerdict: (liked: boolean) => Promise<{ mutual: boolean } | null>;
  onMutualMatch: () => void;
  onDone: () => void;
};

export function PostDateSurvey({
  partnerName,
  partnerImage,
  onSubmitVerdict,
  onMutualMatch,
  onDone,
}: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const [step, setStep] = useState<'verdict' | 'celebration' | 'done'>('verdict');
  const [submitting, setSubmitting] = useState(false);

  const handleVerdict = async (liked: boolean) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const result = await onSubmitVerdict(liked);
      if (result?.mutual) {
        setStep('celebration');
        setTimeout(() => {
          setStep('done');
          onMutualMatch();
        }, 2000);
      } else {
        setStep('done');
        onDone();
      }
    } catch {
      setSubmitting(false);
    }
    setSubmitting(false);
  };

  if (step === 'celebration') {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <Text style={[styles.celebrationTitle, { color: theme.text }]}>It's a match! 🎉</Text>
        <Text style={[styles.celebrationSub, { color: theme.mutedForeground }]}>You both vibed</Text>
      </View>
    );
  }

  if (step === 'done') return null;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Text style={[styles.title, { color: theme.text }]}>How was your date with {partnerName}?</Text>
      {partnerImage ? (
        <Image source={{ uri: partnerImage }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatarPlaceholder, { backgroundColor: theme.muted }]}>
          <Text style={[styles.avatarPlaceholderText, { color: theme.mutedForeground }]}>Photo</Text>
        </View>
      )}
      <View style={styles.buttons}>
        <Pressable
          disabled={submitting}
          onPress={() => handleVerdict(true)}
          style={({ pressed }) => [
            styles.vibeBtn,
            { backgroundColor: theme.tint },
            pressed && styles.pressed,
          ]}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.vibeBtnText}>💜 Vibe</Text>
          )}
        </Pressable>
        <Pressable
          disabled={submitting}
          onPress={() => handleVerdict(false)}
          style={({ pressed }) => [
            styles.passBtn,
            { borderColor: theme.border, backgroundColor: theme.muted },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.passBtnText, { color: theme.mutedForeground }]}>✕ Pass</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.xl,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    ...typography.titleMD,
    marginBottom: spacing.xl,
    textAlign: 'center',
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    marginBottom: spacing.xl,
  },
  avatarPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    marginBottom: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPlaceholderText: {
    fontSize: 14,
  },
  buttons: {
    width: '100%',
    maxWidth: 320,
    gap: spacing.md,
  },
  vibeBtn: {
    paddingVertical: spacing.lg,
    borderRadius: radius.xl,
    alignItems: 'center',
  },
  vibeBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  passBtn: {
    paddingVertical: spacing.md,
    borderRadius: radius.xl,
    borderWidth: 1,
    alignItems: 'center',
  },
  passBtnText: {
    fontSize: 16,
  },
  pressed: {
    opacity: 0.9,
  },
  celebrationTitle: {
    ...typography.titleLG,
    marginBottom: spacing.sm,
  },
  celebrationSub: {
    ...typography.body,
  },
});
