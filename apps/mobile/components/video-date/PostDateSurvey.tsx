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
import { MatchCelebrationScreen } from '@/components/match/MatchCelebrationScreen';
import { supabase } from '@/lib/supabase';

type Props = {
  sessionId: string;
  userId: string;
  partnerId: string;
  partnerName: string;
  partnerImage: string | null;
  eventId: string | undefined;
  onSubmitVerdict: (liked: boolean) => Promise<SubmitVerdictAndCheckMutualResult>;
  onMutualMatch: () => void;
  /** Called when user taps "Start Chatting"; receives the match_id if available. */
  onStartChatting?: (matchId?: string) => void;
  onDone: () => void;
};

type CelebrationData = {
  sharedVibes: string[];
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
  userId,
  partnerId,
  partnerName,
  partnerImage,
  onSubmitVerdict,
  onMutualMatch,
  onStartChatting,
  onDone,
}: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const [step, setStep] = useState<'verdict' | 'celebration' | 'done'>('verdict');
  const [submitting, setSubmitting] = useState(false);
  const [verdictError, setVerdictError] = useState<string | null>(null);
  const [celebrationData, setCelebrationData] = useState<CelebrationData | null>(null);
  const [matchId, setMatchId] = useState<string | undefined>(undefined);

  // Fetch shared vibes when celebration step is reached
  useEffect(() => {
    if (step !== 'celebration' || !userId || !partnerId) return;
    let cancelled = false;

    const fetchShared = async () => {
      const [{ data: myVibes }, { data: partnerVibes }] = await Promise.all([
        supabase.from('profile_vibes').select('vibe_tags(label)').eq('profile_id', userId),
        supabase.from('profile_vibes').select('vibe_tags(label)').eq('profile_id', partnerId),
      ]);
      if (cancelled) return;

      const extractLabels = (rows: unknown[] | null): string[] =>
        (rows ?? [])
          .map((v: unknown) => {
            const raw = (v as { vibe_tags: { label: string } | { label: string }[] | null }).vibe_tags;
            const tag = Array.isArray(raw) ? raw[0] : raw;
            return tag?.label ?? null;
          })
          .filter((l): l is string => !!l);

      const shared = extractLabels(myVibes).filter((l) => extractLabels(partnerVibes).includes(l));
      setCelebrationData({ sharedVibes: shared });
    };

    fetchShared();
    return () => { cancelled = true; };
  }, [step, userId, partnerId]);

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
        setMatchId(result.match_id);
        setStep('celebration');
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
      <MatchCelebrationScreen
        partnerName={partnerName}
        partnerImage={partnerImage}
        sharedVibes={celebrationData?.sharedVibes}
        onStartChatting={() => {
          if (onStartChatting) {
            onStartChatting(matchId);
          } else {
            onMutualMatch();
          }
        }}
        onKeepVibing={onMutualMatch}
      />
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
});
