/**
 * Post-date survey: Screen 1 (mandatory) — Did you vibe? Vibe or Pass.
 * Verdict is submitted via `post-date-verdict` (backend single-writer); do not patch session/feedback here.
 */

import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Image, ActivityIndicator } from 'react-native';
import { typography, spacing, radius } from '@/constants/theme';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { trackEvent } from '@/lib/analytics';
import type { SubmitVerdictAndCheckMutualResult } from '@/lib/videoDateApi';

type Props = {
  sessionId: string;
  userId: string;
  partnerId: string;
  partnerName: string;
  partnerImage: string | null;
  eventId: string | undefined;
  onSubmitVerdict: (liked: boolean) => Promise<SubmitVerdictAndCheckMutualResult>;
  onMutualMatch: () => void;
  onDone: () => void;
};

function verdictFailureUserMessage(result: Extract<SubmitVerdictAndCheckMutualResult, { ok: false }>): string {
  if (result.reason === 'network') {
    return "Can't connect right now. Check your connection and try again.";
  }
  if (result.reason === 'unknown') {
    return 'Something went wrong. Please try again.';
  }
  switch (result.code) {
    case 'not_participant':
      return "You can't submit feedback for this date.";
    case 'session_not_found':
      return 'This date session is no longer available.';
    case 'invalid_request':
    case 'rpc_failed':
    case 'internal_error':
    case 'unauthorized':
    case 'forbidden':
    default:
      return 'Something went wrong. Please try again.';
  }
}

export function PostDateSurvey({
  sessionId,
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
  const [verdictError, setVerdictError] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleVerdict = async (liked: boolean) => {
    if (submitting) return;
    setSubmitting(true);
    setVerdictError(null);
    try {
      const result = await onSubmitVerdict(liked);
      if (!result.ok) {
        setVerdictError(verdictFailureUserMessage(result));
        return;
      }
      trackEvent('post_date_survey_completed', {
        session_id: sessionId,
        verdict: liked ? 'vibe' : 'pass',
      });
      if (result.mutual) {
        setStep('celebration');
        if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
          setStep('done');
          onMutualMatch();
          timeoutRef.current = null;
        }, 2000);
      } else {
        setStep('done');
        onDone();
      }
    } catch {
      setVerdictError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
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
      {verdictError ? (
        <Text style={[styles.errorBanner, { color: theme.danger }]} accessibilityLiveRegion="polite">
          {verdictError}
        </Text>
      ) : null}
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
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  errorBanner: {
    ...typography.body,
    textAlign: 'center',
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.md,
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
