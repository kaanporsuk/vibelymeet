/**
 * Post-date survey: verdict → (celebration if mutual) → optional highlights → optional safety → lobby.
 * Parity with web `PostDateSurvey` (server-owned verdict + date_feedback + `submit_user_report`).
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
import { LobbyPostDateEvents } from '@clientShared/analytics/lobbyToPostDateJourney';
import type { SubmitVerdictAndCheckMutualResult } from '@/lib/videoDateApi';
import { updateParticipantStatus } from '@/lib/videoDateApi';
import { drainMatchQueue, getQueuedMatchCount } from '@/lib/eventsApi';
import { MatchCelebrationScreen } from '@/components/match/MatchCelebrationScreen';
import { supabase } from '@/lib/supabase';
import { videoSessionIdFromDrainPayload } from '@shared/matching/videoSessionFlow';
import {
  getPostDateSurveyContinuityDecision,
  isPostDateEventNearlyOver,
  secondsUntilPostDateEventEnd,
  type PostDateContinuityDecision,
} from '@clientShared/matching/postDateContinuity';
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
  onQueuedVideoSessionReady?: (videoSessionId: string) => void;
  onDone: () => void;
};

type SurveyStep = 'verdict' | 'celebration' | 'highlights' | 'safety' | 'done';

type CelebrationData = {
  sharedVibes: string[];
};

type EventContinuationSnapshot = {
  active: boolean;
  endsAtIso: string | null;
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
    case 'blocked_pair':
      return "You can't submit feedback for this date.";
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

async function getEventContinuationSnapshot(eventId: string): Promise<EventContinuationSnapshot> {
  const { data } = await supabase
    .from('events')
    .select('event_date, duration_minutes, status')
    .eq('id', eventId)
    .maybeSingle();
  if (!data) return { active: false, endsAtIso: null };
  const endsAt = new Date(
    new Date(data.event_date as string).getTime() + (data.duration_minutes || 60) * 60000
  );
  return {
    active: new Date() < endsAt && data.status !== 'ended',
    endsAtIso: endsAt.toISOString(),
  };
}

const ContinuityStrip = ({
  decision,
  theme,
}: {
  decision: PostDateContinuityDecision;
  theme: (typeof Colors)[keyof typeof Colors];
}) => (
  <View
    style={[
      styles.continuityStrip,
      {
        borderColor:
          decision.tone === 'last_chance'
            ? withNativeAlpha('#f59e0b', 0.38)
            : decision.tone === 'ready'
              ? withNativeAlpha(theme.success, 0.36)
              : theme.border,
        backgroundColor:
          decision.tone === 'last_chance'
            ? withNativeAlpha('#f59e0b', 0.12)
            : decision.tone === 'ready'
              ? withNativeAlpha(theme.success, 0.12)
              : theme.surfaceSubtle,
      },
    ]}
  >
    <View style={styles.continuityTitleRow}>
      <View
        style={[
          styles.continuityDot,
          {
            backgroundColor:
              decision.tone === 'last_chance'
                ? '#f59e0b'
                : decision.tone === 'ready'
                  ? theme.success
                  : theme.tint,
          },
        ]}
      />
      <Text style={[styles.continuityTitle, { color: theme.text }]}>{decision.title}</Text>
    </View>
    <Text style={[styles.continuityMessage, { color: theme.mutedForeground }]}>{decision.message}</Text>
  </View>
);

function withNativeAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) return hex;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
  onQueuedVideoSessionReady,
  onDone,
}: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const [step, setStep] = useState<SurveyStep>('verdict');
  const [submitting, setSubmitting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [isDrainingQueue, setIsDrainingQueue] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [eventContinuation, setEventContinuation] = useState<EventContinuationSnapshot | null>(null);
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
  const finishSurveyInFlightRef = useRef(false);
  const queuedNavigationStartedRef = useRef(false);
  const loggedJourneyRef = useRef<Set<string>>(new Set());
  const shellImpressionRef = useRef(false);
  const verdictImpressionRef = useRef(false);

  useEffect(() => {
    shellImpressionRef.current = false;
    verdictImpressionRef.current = false;
    finishSurveyInFlightRef.current = false;
    queuedNavigationStartedRef.current = false;
    setCelebrationData(null);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || shellImpressionRef.current) return;
    shellImpressionRef.current = true;
    trackEvent(LobbyPostDateEvents.POST_DATE_SURVEY_IMPRESSION, {
      platform: 'native',
      session_id: sessionId,
      event_id: eventId,
    });
    trackEvent(LobbyPostDateEvents.SURVEY_NEXT_GATE_CHECK_STARTED, {
      platform: 'native',
      session_id: sessionId,
      event_id: eventId,
      source_surface: 'post_date_survey',
      source_action: 'survey_opened',
      outcome: 'no_op',
    });
  }, [eventId, sessionId]);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    void (async () => {
      const [continuation, count] = await Promise.all([
        getEventContinuationSnapshot(eventId),
        getQueuedMatchCount(eventId, userId),
      ]);
      if (cancelled) return;
      setEventContinuation(continuation);
      setQueuedCount(count);
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, userId, sessionId]);

  useEffect(() => {
    if (step !== 'verdict' || !sessionId || verdictImpressionRef.current) return;
    verdictImpressionRef.current = true;
    trackEvent(LobbyPostDateEvents.KEEP_THE_VIBE_IMPRESSION, {
      platform: 'native',
      session_id: sessionId,
      event_id: eventId,
    });
  }, [eventId, sessionId, step]);

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
    if (!eventId || step !== 'safety' || queuedNavigationStartedRef.current) return;
    let cancelled = false;
    setIsDrainingQueue(true);
    void (async () => {
      try {
        const result = await drainMatchQueue(eventId, userId);
        if (cancelled) return;
        const nextSessionId = videoSessionIdFromDrainPayload(result ?? undefined);
        if (result?.found && nextSessionId) {
          queuedNavigationStartedRef.current = true;
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_QUEUE_DRAIN_FOUND, {
            platform: 'native',
            event_id: eventId,
            session_id: nextSessionId,
            source_surface: 'post_date_survey',
            source_action: 'survey_queue_drain',
          });
          trackEvent(LobbyPostDateEvents.SURVEY_NEXT_GATE_CHECK_RESULT, {
            platform: 'native',
            session_id: sessionId,
            event_id: eventId,
            source_surface: 'post_date_survey',
            source_action: 'survey_queue_drain',
            outcome: 'success',
            reason_code: 'queue_drain_found',
            next_session_id: nextSessionId,
          });
          trackEvent(LobbyPostDateEvents.SURVEY_NEXT_GATE_CONVERSION, {
            platform: 'native',
            session_id: sessionId,
            event_id: eventId,
            source_surface: 'post_date_survey',
            source_action: 'ready_gate_from_survey_drain',
            outcome: 'success',
            next_session_id: nextSessionId,
          });
          trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_NEXT_ACTION_DECIDED, {
            platform: 'native',
            session_id: sessionId,
            event_id: eventId,
            action: 'ready_gate',
            source: 'survey_queue_drain',
            video_session_id: nextSessionId,
          });
          trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_ROUTE_TAKEN, {
            platform: 'native',
            session_id: sessionId,
            event_id: eventId,
            action: 'ready_gate',
            route: 'event_lobby_pending_ready_gate',
            video_session_id: nextSessionId,
          });
          onQueuedVideoSessionReady?.(nextSessionId);
        } else {
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_QUEUE_DRAIN_NOT_FOUND, {
            platform: 'native',
            event_id: eventId,
            source_surface: 'post_date_survey',
            source_action: 'survey_queue_drain',
            reason_code: result?.queued ? 'queued_not_promoted' : 'no_queued_session',
          });
        }
      } finally {
        if (!cancelled && eventId) {
          const count = await getQueuedMatchCount(eventId, userId);
          if (!cancelled) setQueuedCount(count);
        }
        if (!cancelled) setIsDrainingQueue(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, onQueuedVideoSessionReady, step, userId]);

  useEffect(() => {
    if (step !== 'celebration' || !userId || !partnerId) return;
    let cancelled = false;

    const fetchShared = async () => {
      try {
        const [{ data: myVibes }, { data: partnerProfile }] = await Promise.all([
          supabase.from('profile_vibes').select('vibe_tags(label)').eq('profile_id', userId),
          supabase.rpc('get_profile_for_viewer', { p_target_id: partnerId }),
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

        const partnerRow = partnerProfile as { vibes?: string[] | null } | null;
        const partnerLabels = Array.isArray(partnerRow?.vibes)
          ? partnerRow.vibes.filter((label): label is string => typeof label === 'string' && label.trim().length > 0)
          : [];
        const shared = extractLabels(myVibes).filter((l) => partnerLabels.includes(l));
        setCelebrationData({ sharedVibes: shared });
      } catch {
        if (!cancelled) setCelebrationData({ sharedVibes: [] });
      }
    };

    void fetchShared();
    return () => {
      cancelled = true;
    };
  }, [step, userId, partnerId]);

  const secondsUntilEventEnd = useMemo(
    () => secondsUntilPostDateEventEnd(eventContinuation?.endsAtIso),
    [eventContinuation?.endsAtIso]
  );

  const continuityDecision = useMemo(
    () =>
      getPostDateSurveyContinuityDecision({
        isDrainingQueue,
        queuedCount,
        isSubmittingSurvey: finishing,
        eventActive: eventContinuation?.active ?? true,
        secondsUntilEventEnd,
        hasEventId: Boolean(eventId),
      }),
    [eventId, eventContinuation?.active, finishing, isDrainingQueue, queuedCount, secondsUntilEventEnd]
  );

  const finishSurvey = useCallback(async () => {
    if (finishSurveyInFlightRef.current || queuedNavigationStartedRef.current) return;
    finishSurveyInFlightRef.current = true;
    setFinishing(true);
    trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_SURVEY_COMPLETE, {
      platform: 'native',
      session_id: sessionId,
      event_id: eventId,
      decision_at_submit: continuityDecision.action,
      queued_count: queuedCount,
      seconds_until_event_end: secondsUntilEventEnd,
    });
    try {
      logJourney('survey_completed', { source: 'finish_survey' }, 'survey_completed');
      trackEvent(LobbyPostDateEvents.POST_DATE_SURVEY_COMPLETE_RETURN, {
        platform: 'native',
        session_id: sessionId,
        event_id: eventId,
        destination: eventId ? 'lobby' : 'home',
      });
      if (eventId) {
        if (isDrainingQueue) {
          await new Promise((resolve) => setTimeout(resolve, 1800));
          if (queuedNavigationStartedRef.current) return;
        }
        const continuation = await getEventContinuationSnapshot(eventId);
        setEventContinuation(continuation);
        const active = continuation.active;
        if (queuedNavigationStartedRef.current) return;
        if (active) {
          const nextSeconds = secondsUntilPostDateEventEnd(continuation.endsAtIso);
          const action = isPostDateEventNearlyOver(nextSeconds) ? 'last_chance' : 'fresh_deck';
          trackEvent(LobbyPostDateEvents.SURVEY_NEXT_GATE_CHECK_RESULT, {
            platform: 'native',
            session_id: sessionId,
            event_id: eventId,
            source_surface: 'post_date_survey',
            source_action: 'survey_finish_event_active',
            outcome: 'no_op',
            reason_code: action,
            queued_count: queuedCount,
            seconds_until_event_end: nextSeconds,
          });
          trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_NEXT_ACTION_DECIDED, {
            platform: 'native',
            session_id: sessionId,
            event_id: eventId,
            action,
            source: 'survey_finish_event_active',
            queued_count: queuedCount,
            seconds_until_event_end: nextSeconds,
          });
          trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_ROUTE_TAKEN, {
            platform: 'native',
            session_id: sessionId,
            event_id: eventId,
            action,
            route: 'event_lobby',
            queued_count: queuedCount,
            seconds_until_event_end: nextSeconds,
          });
          await updateParticipantStatus(eventId, 'browsing');
          onDone();
          return;
        }
        trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_NEXT_ACTION_DECIDED, {
          platform: 'native',
          session_id: sessionId,
          event_id: eventId,
          action: 'event_ended',
          source: 'survey_finish_event_inactive',
          queued_count: queuedCount,
        });
        trackEvent(LobbyPostDateEvents.SURVEY_NEXT_GATE_CHECK_RESULT, {
          platform: 'native',
          session_id: sessionId,
          event_id: eventId,
          source_surface: 'post_date_survey',
          source_action: 'survey_finish_event_inactive',
          outcome: 'blocked',
          reason_code: 'event_ended',
          queued_count: queuedCount,
        });
        trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_ROUTE_TAKEN, {
          platform: 'native',
          session_id: sessionId,
          event_id: eventId,
          action: 'event_ended',
          route: 'event_ended_alert',
        });
        await updateParticipantStatus(eventId, 'offline');
        Alert.alert('Event ended', 'This event has ended.', [{ text: 'OK', onPress: onDone }]);
        return;
      }
      trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_ROUTE_TAKEN, {
        platform: 'native',
        session_id: sessionId,
        event_id: eventId,
        action: 'home',
        route: 'events_home',
      });
      onDone();
    } finally {
      if (!queuedNavigationStartedRef.current) {
        finishSurveyInFlightRef.current = false;
        setFinishing(false);
      }
    }
  }, [
    eventId,
    onDone,
    logJourney,
    sessionId,
    isDrainingQueue,
    continuityDecision.action,
    queuedCount,
    secondsUntilEventEnd,
  ]);

  useEffect(() => {
    finishSurveyRef.current = finishSurvey;
  }, [finishSurvey]);

  const handleVerdict = async (liked: boolean) => {
    if (submitting) return;
    setSubmitting(true);
    setVerdictError(null);
    trackEvent(liked ? LobbyPostDateEvents.KEEP_THE_VIBE_YES_TAP : LobbyPostDateEvents.KEEP_THE_VIBE_NO_TAP, {
      platform: 'native',
      session_id: sessionId,
      event_id: eventId,
    });
    try {
      const result = await onSubmitVerdict(liked);
      if (!result.ok) {
        setVerdictError(verdictFailureUserMessage(result));
        return;
      }
      trackEvent(LobbyPostDateEvents.POST_DATE_SURVEY_SUBMIT, {
        platform: 'native',
        session_id: sessionId,
        event_id: eventId,
        verdict: liked ? 'vibe' : 'pass',
      });
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_SURVEY_SUBMITTED, {
        platform: 'native',
        session_id: sessionId,
        event_id: eventId,
        verdict: liked ? 'vibe' : 'pass',
      });
      logJourney('survey_completed', { source: 'verdict_submitted', verdict: liked ? 'vibe' : 'pass' }, 'survey_completed');
      trackEvent(LobbyPostDateEvents.MUTUAL_VIBE_OUTCOME, {
        platform: 'native',
        session_id: sessionId,
        event_id: eventId,
        outcome: result.mutual ? 'mutual' : 'not_mutual',
      });
      if (result.mutual) {
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
    if (finishing) return;
    try {
      await persistSafety();
    } catch {
      /* best-effort */
    }
    await finishSurveyRef.current();
  };

  const handleSafetySkip = async () => {
    if (finishing) return;
    trackEvent(LobbyPostDateEvents.POST_DATE_SURVEY_SKIP, {
      platform: 'native',
      session_id: sessionId,
      event_id: eventId,
      step: 'safety',
    });
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
        isLoadingSharedVibes={!celebrationData}
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
        <ContinuityStrip decision={continuityDecision} theme={theme} />
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
        <Pressable
          onPress={() => {
            trackEvent(LobbyPostDateEvents.POST_DATE_SURVEY_SKIP, {
              platform: 'native',
              session_id: sessionId,
              event_id: eventId,
              step: 'highlights',
            });
            setStep('safety');
          }}
        >
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
          <ContinuityStrip decision={continuityDecision} theme={theme} />
          <Pressable
            style={[styles.primaryBtn, { backgroundColor: theme.tint, marginTop: spacing.lg }]}
            disabled={finishing}
            onPress={() => void handleSafetyComplete()}
          >
            {finishing ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Back to the event 💚</Text>}
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
        <ContinuityStrip decision={continuityDecision} theme={theme} />

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

        <Pressable
          style={[styles.primaryBtn, { backgroundColor: theme.tint }, finishing && { opacity: 0.7 }]}
          disabled={finishing}
          onPress={() => void handleSafetyComplete()}
        >
          {finishing ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Done — back to the event 💚</Text>}
        </Pressable>
        <Pressable
          disabled={finishing}
          onPress={() => void handleSafetySkip()}
        >
          <Text style={[styles.skip, { color: theme.mutedForeground }]}>
            {finishing ? 'Returning...' : 'Skip'}
          </Text>
        </Pressable>
        {finishing || isDrainingQueue ? (
          <Text style={[styles.pendingText, { color: theme.mutedForeground }]}>
            {continuityDecision.message}
          </Text>
        ) : null}
      </ScrollView>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Text style={[styles.title, { color: theme.text }]}>How was your date with {partnerName}?</Text>
      <ContinuityStrip decision={continuityDecision} theme={theme} />
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
  continuityStrip: {
    width: '100%',
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  continuityTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  continuityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  continuityTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    flex: 1,
  },
  continuityMessage: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.xs,
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
  pendingText: {
    textAlign: 'center',
    fontSize: 12,
    marginTop: spacing.xs,
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
