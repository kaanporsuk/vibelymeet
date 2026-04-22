/**
 * Post-date survey: verdict → (celebration if mutual) → optional highlights → optional safety → lobby.
 * Parity with web `PostDateSurvey` (server-owned verdict + date_feedback + `submit_user_report`).
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Image,
  ActivityIndicator,
  ScrollView,
  TextInput,
  Alert,
} from 'react-native';
import { typography, spacing, radius } from '@/constants/theme';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { trackEvent } from '@/lib/analytics';
import type { SubmitVerdictAndCheckMutualResult } from '@/lib/videoDateApi';
import { updateParticipantStatus } from '@/lib/videoDateApi';
import { MatchCelebrationScreen } from '@/components/match/MatchCelebrationScreen';
import { supabase } from '@/lib/supabase';
import {
  getVideoDateJourneyEventName,
  type VideoDateJourneyEvent,
} from '@clientShared/matching/videoDateDiagnostics';
import {
  mapPostDateSafetyCategoryToReasonId,
  submitUserReportRpc,
} from '../../../../shared/safety/submitUserReportRpc';

type Props = {
  sessionId: string;
  userId: string;
  partnerId: string;
  partnerName: string;
  partnerImage: string | null;
  eventId: string | undefined;
  onSubmitVerdict: (liked: boolean) => Promise<SubmitVerdictAndCheckMutualResult>;
  onMutualMatch: () => void;
  onStartChatting?: (otherProfileId?: string) => void;
  onDone: () => void;
};

type SurveyStep = 'verdict' | 'celebration' | 'highlights' | 'safety' | 'done';

type CelebrationData = {
  sharedVibes: string[];
};

const REPORT_CATEGORIES = [
  'Inappropriate behavior',
  'Fake photos',
  'Harassment',
  'Spam',
  'Other',
] as const;

const ACCURACY_OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'not_sure', label: 'Not sure' },
  { value: 'no', label: 'No' },
];

const ENERGY_OPTIONS = ['Calm', 'Energetic', 'Intense'] as const;
const FLOW_OPTIONS = ['Naturally', 'Took effort', 'One-sided'] as const;

const TAGS = [
  { key: 'tagChemistry' as const, label: 'Chemistry', emoji: '🔥' },
  { key: 'tagFun' as const, label: 'Fun', emoji: '🎉' },
  { key: 'tagSmart' as const, label: 'Smart', emoji: '🧠' },
  { key: 'tagRespectful' as const, label: 'Respectful', emoji: '🤝' },
];

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

async function isEventStillActive(eventId: string): Promise<boolean> {
  const { data } = await supabase
    .from('events')
    .select('event_date, duration_minutes, status')
    .eq('id', eventId)
    .maybeSingle();
  if (!data) return false;
  const endsAt = new Date(
    new Date(data.event_date as string).getTime() + (data.duration_minutes || 60) * 60000
  );
  return new Date() < endsAt && data.status !== 'ended';
}

export function PostDateSurvey({
  sessionId,
  userId,
  partnerId,
  partnerName,
  partnerImage,
  eventId,
  onSubmitVerdict,
  onMutualMatch,
  onStartChatting,
  onDone,
}: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const [step, setStep] = useState<SurveyStep>('verdict');
  const [submitting, setSubmitting] = useState(false);
  const [verdictError, setVerdictError] = useState<string | null>(null);
  const [celebrationData, setCelebrationData] = useState<CelebrationData | null>(null);

  const [tagSel, setTagSel] = useState({
    tagChemistry: false,
    tagFun: false,
    tagSmart: false,
    tagRespectful: false,
  });
  const [energy, setEnergy] = useState<string | null>(null);
  const [flow, setFlow] = useState<string | null>(null);

  const [photoAccurate, setPhotoAccurate] = useState<string | null>(null);
  const [honest, setHonest] = useState<string | null>(null);
  const [comfortable, setComfortable] = useState<string | null>(null);
  const [showReportFlow, setShowReportFlow] = useState(false);
  const [reportCategory, setReportCategory] = useState<string | null>(null);
  const [reportDetails, setReportDetails] = useState('');
  const [wantsBlock, setWantsBlock] = useState(false);
  const [safetySubmitted, setSafetySubmitted] = useState(false);

  const finishSurveyRef = useRef<() => Promise<void>>(async () => {});
  const loggedJourneyRef = useRef<Set<string>>(new Set());

  const logJourney = useCallback(
    (event: VideoDateJourneyEvent, payload?: Record<string, unknown>, dedupeKey?: string) => {
      const key = dedupeKey ?? event;
      if (loggedJourneyRef.current.has(key)) return;
      loggedJourneyRef.current.add(key);
      trackEvent(getVideoDateJourneyEventName(event), {
        platform: 'native',
        session_id: sessionId,
        event_id: eventId,
        ...(payload ?? {}),
      });
    },
    [sessionId, eventId]
  );

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

    void fetchShared();
    return () => {
      cancelled = true;
    };
  }, [step, userId, partnerId]);

  const finishSurvey = useCallback(async () => {
    logJourney('survey_completed', { source: 'finish_survey' }, 'survey_completed');
    if (eventId) {
      const active = await isEventStillActive(eventId);
      if (active) {
        await updateParticipantStatus(eventId, 'browsing');
        onDone();
        return;
      }
      await updateParticipantStatus(eventId, 'offline');
      Alert.alert('Event ended', 'This event has ended.', [{ text: 'OK', onPress: onDone }]);
      return;
    }
    onDone();
  }, [eventId, onDone, logJourney]);

  useEffect(() => {
    finishSurveyRef.current = finishSurvey;
  }, [finishSurvey]);

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
      logJourney('survey_completed', { source: 'verdict_submitted', verdict: liked ? 'vibe' : 'pass' }, 'survey_completed');
      if (result.mutual) {
        logJourney('mutual_match_detected', { source: 'post_date_verdict' }, 'mutual_match_detected');
        setStep('celebration');
      } else {
        setStep('highlights');
      }
    } catch {
      setVerdictError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const persistHighlights = async () => {
    const conversationFlow =
      flow === 'Naturally' ? 'natural' : flow === 'Took effort' ? 'effort' : flow === 'One-sided' ? 'one_sided' : null;
    await supabase
      .from('date_feedback')
      .update({
        tag_chemistry: tagSel.tagChemistry,
        tag_fun: tagSel.tagFun,
        tag_smart: tagSel.tagSmart,
        tag_respectful: tagSel.tagRespectful,
        energy: energy?.toLowerCase() || null,
        conversation_flow: conversationFlow,
      })
      .eq('session_id', sessionId)
      .eq('user_id', userId);
  };

  const persistSafety = async () => {
    await supabase
      .from('date_feedback')
      .update({
        photo_accurate: photoAccurate,
        honest_representation: honest,
      })
      .eq('session_id', sessionId)
      .eq('user_id', userId);
  };

  const handleHighlightsSubmit = async () => {
    try {
      await persistHighlights();
    } catch {
      /* best-effort */
    }
    setStep('safety');
  };

  const handleSafetyComplete = async () => {
    try {
      await persistSafety();
    } catch {
      /* best-effort */
    }
    await finishSurveyRef.current();
  };

  const handleReportSubmit = async () => {
    if (!reportCategory) return;
    const mapped = mapPostDateSafetyCategoryToReasonId(reportCategory);
    const result = await submitUserReportRpc(supabase, {
      reportedId: partnerId,
      reason: mapped,
      details: reportDetails || null,
      alsoBlock: wantsBlock,
    });
    if (!result.ok) {
      const msg =
        'error' in result && result.error === 'rate_limited'
          ? 'Too many reports. Try again later.'
          : 'Could not submit.';
      Alert.alert('Report', msg);
      return;
    }
    setSafetySubmitted(true);
  };

  const needsExpanded =
    photoAccurate === 'no' || honest === 'no' || comfortable === 'off';

  if (step === 'celebration') {
    return (
      <MatchCelebrationScreen
        partnerName={partnerName}
        partnerImage={partnerImage}
        sharedVibes={celebrationData?.sharedVibes}
        onStartChatting={() => {
          logJourney('chat_cta_pressed', { source: 'survey_celebration', other_profile_id: partnerId });
          if (onStartChatting) {
            onStartChatting(partnerId);
          } else {
            onMutualMatch();
          }
        }}
        onKeepVibing={() => setStep('highlights')}
      />
    );
  }

  if (step === 'done') return null;

  if (step === 'highlights') {
    return (
      <ScrollView
        style={[styles.container, { backgroundColor: theme.background }]}
        contentContainerStyle={styles.scrollPad}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.title, { color: theme.text }]}>What stood out?</Text>
        <Text style={[styles.sub, { color: theme.mutedForeground }]}>Helps us find you better matches</Text>
        <View style={styles.tagGrid}>
          {TAGS.map((t) => (
            <Pressable
              key={t.key}
              onPress={() => setTagSel((s) => ({ ...s, [t.key]: !s[t.key] }))}
              style={[
                styles.tagBtn,
                {
                  borderColor: tagSel[t.key] ? theme.tint : theme.border,
                  backgroundColor: tagSel[t.key] ? `${theme.tint}22` : theme.muted,
                },
              ]}
            >
              <Text style={{ color: theme.text }}>
                {t.emoji} {t.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.sectionLabel, { color: theme.text }]}>Their energy felt:</Text>
        <View style={styles.rowWrap}>
          {ENERGY_OPTIONS.map((opt) => (
            <Pressable
              key={opt}
              onPress={() => setEnergy((e) => (e === opt ? null : opt))}
              style={[styles.pill, { borderColor: energy === opt ? theme.tint : theme.border }]}
            >
              <Text style={{ color: theme.mutedForeground }}>{opt}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.sectionLabel, { color: theme.text }]}>Conversation flowed:</Text>
        <View style={styles.rowWrap}>
          {FLOW_OPTIONS.map((opt) => (
            <Pressable
              key={opt}
              onPress={() => setFlow((f) => (f === opt ? null : opt))}
              style={[styles.pill, { borderColor: flow === opt ? theme.tint : theme.border }]}
            >
              <Text style={{ color: theme.mutedForeground, fontSize: 13 }}>{opt}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable style={[styles.primaryBtn, { backgroundColor: theme.tint }]} onPress={() => void handleHighlightsSubmit()}>
          <Text style={styles.primaryBtnText}>Continue</Text>
        </Pressable>
        <Pressable onPress={() => setStep('safety')}>
          <Text style={[styles.skip, { color: theme.mutedForeground }]}>Skip</Text>
        </Pressable>
      </ScrollView>
    );
  }

  if (step === 'safety') {
    if (safetySubmitted) {
      return (
        <View style={[styles.container, { backgroundColor: theme.background, justifyContent: 'center' }]}>
          <Text style={[styles.title, { color: theme.text }]}>Thanks for keeping Vibely safe</Text>
          <Text style={[styles.sub, { color: theme.mutedForeground }]}>We&apos;ll review this promptly.</Text>
          <Pressable
            style={[styles.primaryBtn, { backgroundColor: theme.tint, marginTop: spacing.lg }]}
            onPress={() => void handleSafetyComplete()}
          >
            <Text style={styles.primaryBtnText}>Back to the event 💚</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <ScrollView
        style={[styles.container, { backgroundColor: theme.background }]}
        contentContainerStyle={styles.scrollPad}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.title, { color: theme.text }]}>Quick safety check</Text>
        <Text style={[styles.sub, { color: theme.mutedForeground }]}>Optional but helps the community</Text>

        <Text style={[styles.qLabel, { color: theme.text }]}>Did they look like their photos?</Text>
        <View style={styles.rowWrap}>
          {ACCURACY_OPTIONS.map((o) => (
            <Pressable
              key={o.value}
              onPress={() => setPhotoAccurate(o.value)}
              style={[styles.pill, { borderColor: photoAccurate === o.value ? theme.tint : theme.border }]}
            >
              <Text style={{ color: theme.mutedForeground }}>{o.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.qLabel, { color: theme.text }]}>Did they represent themselves honestly?</Text>
        <View style={styles.rowWrap}>
          {ACCURACY_OPTIONS.map((o) => (
            <Pressable
              key={o.value}
              onPress={() => setHonest(o.value)}
              style={[styles.pill, { borderColor: honest === o.value ? theme.tint : theme.border }]}
            >
              <Text style={{ color: theme.mutedForeground }}>{o.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.qLabel, { color: theme.text }]}>Did anything make you uncomfortable?</Text>
        <View style={styles.rowWrap}>
          <Pressable
            onPress={() => setComfortable('good')}
            style={[styles.pill, { borderColor: comfortable === 'good' ? theme.tint : theme.border }]}
          >
            <Text style={{ color: theme.mutedForeground }}>No, all good</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setComfortable('off');
              setShowReportFlow(true);
            }}
            style={[styles.pill, { borderColor: comfortable === 'off' ? theme.danger : theme.border }]}
          >
            <Text style={{ color: theme.danger }}>Something felt off</Text>
          </Pressable>
        </View>

        {(needsExpanded || showReportFlow) && (
          <View style={[styles.reportBox, { borderColor: theme.border }]}>
            <Text style={{ color: theme.text, marginBottom: spacing.sm }}>Would you like to report this user?</Text>
            <View style={styles.rowWrap}>
              {REPORT_CATEGORIES.map((cat) => (
                <Pressable
                  key={cat}
                  onPress={() => setReportCategory((c) => (c === cat ? null : cat))}
                  style={[styles.pill, { borderColor: reportCategory === cat ? theme.danger : theme.border }]}
                >
                  <Text style={{ color: theme.mutedForeground, fontSize: 12 }}>{cat}</Text>
                </Pressable>
              ))}
            </View>
            {reportCategory ? (
              <TextInput
                style={[styles.textArea, { color: theme.text, borderColor: theme.border, backgroundColor: theme.muted }]}
                placeholder="Tell us more (optional)..."
                placeholderTextColor={theme.mutedForeground}
                value={reportDetails}
                onChangeText={setReportDetails}
                multiline
                maxLength={500}
              />
            ) : null}
            <Pressable
              onPress={() => setWantsBlock((w) => !w)}
              style={styles.blockRow}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: wantsBlock }}
            >
              <View style={[styles.checkbox, { borderColor: theme.border, backgroundColor: wantsBlock ? theme.tint : 'transparent' }]} />
              <Text style={{ color: theme.mutedForeground, flex: 1, fontSize: 12 }}>
                Block them from future events
              </Text>
            </Pressable>
            {reportCategory ? (
              <Pressable
                style={[styles.primaryBtn, { backgroundColor: theme.danger, marginTop: spacing.sm }]}
                onPress={() => void handleReportSubmit()}
              >
                <Text style={styles.primaryBtnText}>Submit Report</Text>
              </Pressable>
            ) : null}
          </View>
        )}

        <Pressable style={[styles.primaryBtn, { backgroundColor: theme.tint }]} onPress={() => void handleSafetyComplete()}>
          <Text style={styles.primaryBtnText}>Done — back to the event 💚</Text>
        </Pressable>
        <Pressable onPress={() => void finishSurveyRef.current()}>
          <Text style={[styles.skip, { color: theme.mutedForeground }]}>Skip</Text>
        </Pressable>
      </ScrollView>
    );
  }

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
          onPress={() => void handleVerdict(true)}
          style={({ pressed }) => [styles.vibeBtn, { backgroundColor: theme.tint }, pressed && styles.pressed]}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.vibeBtnText}>💜 Vibe</Text>
          )}
        </Pressable>
        <Pressable
          disabled={submitting}
          onPress={() => void handleVerdict(false)}
          style={({ pressed }) => [
            styles.passBtn,
            { borderColor: theme.border, backgroundColor: theme.muted },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.passBtnText, { color: theme.mutedForeground }]}>✕ Pass</Text>
        </Pressable>
      </View>
      <Pressable onPress={() => setStep('safety')} style={styles.reportLink}>
        <Text style={{ color: theme.mutedForeground, fontSize: 12 }}>⚠ Report an issue</Text>
      </Pressable>
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
  scrollPad: {
    padding: spacing.xl,
    paddingBottom: spacing['3xl'],
  },
  title: {
    ...typography.titleMD,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  sub: {
    ...typography.body,
    textAlign: 'center',
    marginBottom: spacing.lg,
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
  reportLink: {
    marginTop: spacing.lg,
    padding: spacing.sm,
  },
  tagGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
    justifyContent: 'center',
  },
  tagBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  sectionLabel: {
    alignSelf: 'flex-start',
    fontWeight: '600',
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  qLabel: {
    alignSelf: 'flex-start',
    fontWeight: '600',
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  primaryBtn: {
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.xl,
    alignItems: 'center',
    width: '100%',
  },
  primaryBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
  skip: {
    textAlign: 'center',
    marginTop: spacing.md,
    padding: spacing.sm,
  },
  reportBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: radius.lg,
    width: '100%',
  },
  textArea: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  blockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
  },
});
