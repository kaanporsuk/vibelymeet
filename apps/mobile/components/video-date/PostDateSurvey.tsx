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
import { LinearGradient } from 'expo-linear-gradient';
import { useQueryClient } from '@tanstack/react-query';
import { typography, spacing, radius, shadows } from '@/constants/theme';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { trackEvent } from '@/lib/analytics';
import { submitNativePostDateOutboxItem } from '@/lib/postDateOutbox/execute';
import { LobbyPostDateEvents } from '@clientShared/analytics/lobbyToPostDateJourney';
import type { SubmitVerdictAndCheckMutualResult } from '@/lib/videoDateApi';
import { submitPostDateReportWithOutbox, updateParticipantStatus } from '@/lib/videoDateApi';
import { drainMatchQueue, fetchEventDeck, getQueuedMatchCount, type EventDeckFetchResult } from '@/lib/eventsApi';
import { MatchCelebrationScreen } from '@/components/match/MatchCelebrationScreen';
import { supabase } from '@/lib/supabase';
import { deckCardUrl } from '@/lib/imageUrl';
import { videoSessionIdFromDrainPayload } from '@shared/matching/videoSessionFlow';
import {
  getPostDateSurveyContinuityDecision,
  isPostDateEventNearlyOver,
  normalizeServerPostDateNextSurface,
  secondsUntilPostDateEventEnd,
  type PostDateContinuityDecision,
} from '@clientShared/matching/postDateContinuity';
import {
  getVideoDateJourneyEventName,
  type VideoDateJourneyEvent,
} from '@clientShared/matching/videoDateDiagnostics';
import {
  mapPostDateSafetyCategoryToReasonId,
} from '../../../../shared/safety/submitUserReportRpc';
import type { PostDateSafetyReportPayload } from '../../../../shared/postDateOutbox/types';
import {
  getVideoDateMicroVerdictCopy,
  getVideoDateMicroVerdictRemainingSeconds,
} from '../../../../shared/matching/videoDateMicroVerdict';
import { getVideoDateDeckPrefetchItems } from '../../../../shared/matching/videoDateDeckPrefetch';
import {
  createVideoDateSessionChannel,
  type VideoDateSessionBroadcastEvent,
} from '../../../../shared/matching/videoDateSessionChannel';
import {
  POST_DATE_VERDICT_CONFIRM_TIMEOUT_MS,
  confirmationResultFromVerdictBroadcast,
  derivePostDateSurveyStepFromVerdict,
  isVideoDateVerdictConfirmEnabled,
  normalizePostDateVerdictConfirmationResult,
  type PostDateVerdictUiState,
} from '../../../../shared/matching/postDateVerdictConfirmation';

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
  onVideoDateReady?: (videoSessionId: string) => void;
  onDone: () => void;
};

type SurveyStep = 'verdict' | 'celebration' | 'awaiting_partner' | 'highlights' | 'safety' | 'done';

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
}) => {
  const accent =
    decision.tone === 'last_chance'
      ? '#f59e0b'
      : decision.tone === 'ready'
        ? theme.success
        : decision.tone === 'ended'
          ? theme.mutedForeground
          : theme.tint;

  return (
    <View
      style={[
        styles.continuityStrip,
        {
          borderColor: withNativeAlpha(accent, 0.28),
          backgroundColor:
            decision.tone === 'last_chance'
              ? withNativeAlpha('#f59e0b', 0.1)
              : decision.tone === 'ready'
                ? withNativeAlpha(theme.success, 0.1)
                : withNativeAlpha(theme.surfaceSubtle, 0.92),
        },
      ]}
    >
      <View style={[styles.continuityRail, { backgroundColor: accent }]} />
      <View style={styles.continuityCopy}>
        <View style={styles.continuityTitleRow}>
          <View style={[styles.continuityDot, { backgroundColor: accent }]} />
          <Text style={[styles.continuityTitle, { color: theme.text }]} numberOfLines={1}>
            {decision.title}
          </Text>
        </View>
        <Text style={[styles.continuityMessage, { color: theme.mutedForeground }]}>{decision.message}</Text>
      </View>
    </View>
  );
};

function withNativeAlpha(hex: string, alpha: number): string {
  if (hex.startsWith('hsl(')) {
    return hex.replace(/^hsl\(/, 'hsla(').replace(/\)$/, `, ${alpha})`);
  }
  if (hex.startsWith('rgb(')) {
    return hex.replace(/^rgb\(/, 'rgba(').replace(/\)$/, `, ${alpha})`);
  }
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
  onVideoDateReady,
  onDone,
}: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const queryClient = useQueryClient();
  const microVerdictV2 = useFeatureFlag('video_date.micro_verdict_v2');
  const drainQueueV2 = useFeatureFlag('video_date.outbox_v2.drain_match_queue');
  const submitVerdictV3 = useFeatureFlag('video_date.outbox_v2.submit_verdict');
  const postDateInstantNextV2 = useFeatureFlag('video_date.post_date_instant_next_v2');
  const verdictConfirmV2 = useFeatureFlag('video_date.verdict_confirm_v2');
  const verdictConfirmV1 = useFeatureFlag('video_date.verdict_confirm_v1');
  const [step, setStep] = useState<SurveyStep>('verdict');
  const [submitting, setSubmitting] = useState(false);
  const [verdictUiState, setVerdictUiState] = useState<PostDateVerdictUiState>('idle');
  const [finishing, setFinishing] = useState(false);
  const [isDrainingQueue, setIsDrainingQueue] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [eventContinuation, setEventContinuation] = useState<EventContinuationSnapshot | null>(null);
  const [verdictError, setVerdictError] = useState<string | null>(null);
  const [verdictRetryable, setVerdictRetryable] = useState(false);
  const [lastVerdictAttempt, setLastVerdictAttempt] = useState<boolean | null>(null);
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
  const [reportSubmitting, setReportSubmitting] = useState(false);

  const finishSurveyRef = useRef<() => Promise<void>>(async () => {});
  const finishSurveyInFlightRef = useRef(false);
  const queuedNavigationStartedRef = useRef(false);
  const queuedDrainAttemptKeyRef = useRef<string | null>(null);
  const loggedJourneyRef = useRef<Set<string>>(new Set());
  const shellImpressionRef = useRef(false);
  const verdictImpressionRef = useRef(false);
  const reportBeforeVerdictRef = useRef(false);
  const reportPassVerdictSavedRef = useRef(false);
  const verdictOpenedAtMsRef = useRef(Date.now());
  const instantNextPrefetchKeyRef = useRef<string | null>(null);
  const pendingVerdictConfirmRef = useRef<{
    minSessionSeq: number | null;
    resolve: (confirmedResult: unknown | null) => void;
  } | null>(null);
  const verdictConfirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightsSaveInFlightRef = useRef(false);
  const safetySaveInFlightRef = useRef(false);
  const safetyReportInFlightRef = useRef(false);
  const [microVerdictNowMs, setMicroVerdictNowMs] = useState(Date.now());
  const verdictConfirmEnabled = useMemo(
    () => isVideoDateVerdictConfirmEnabled(verdictConfirmV2, verdictConfirmV1),
    [verdictConfirmV1, verdictConfirmV2],
  );

  const clearVerdictConfirmTimeout = useCallback(() => {
    if (verdictConfirmTimeoutRef.current) {
      clearTimeout(verdictConfirmTimeoutRef.current);
      verdictConfirmTimeoutRef.current = null;
    }
  }, []);

  const resolvePendingVerdictConfirm = useCallback((confirmedResult: unknown | null) => {
    const pending = pendingVerdictConfirmRef.current;
    if (!pending) return;
    pendingVerdictConfirmRef.current = null;
    clearVerdictConfirmTimeout();
    pending.resolve(confirmedResult);
  }, [clearVerdictConfirmTimeout]);

  const confirmVerdictWithServerNextSurface = useCallback(async (result: unknown) => {
    const { data, error } = await supabase.rpc('resolve_post_date_next_surface', {
      p_session_id: sessionId,
    });
    const nextSurface = !error ? normalizeServerPostDateNextSurface(data) : null;
    if (!nextSurface || nextSurface.action === 'survey') return null;
    const base = result && typeof result === 'object' && !Array.isArray(result)
      ? result as Record<string, unknown>
      : {};
    return {
      ...base,
      success: true,
      committed: true,
      next_surface: nextSurface,
    };
  }, [sessionId]);

  const waitForVerdictConfirmation = useCallback(
    async (result: unknown): Promise<unknown | null> => {
      const normalized = normalizePostDateVerdictConfirmationResult(result);
      if (normalized.committed) return result;

      return new Promise<unknown | null>((resolve) => {
        pendingVerdictConfirmRef.current = {
          minSessionSeq: normalized.sessionSeq,
          resolve,
        };
        verdictConfirmTimeoutRef.current = setTimeout(() => {
          verdictConfirmTimeoutRef.current = null;
          pendingVerdictConfirmRef.current = null;
          void confirmVerdictWithServerNextSurface(result)
            .then(resolve)
            .catch(() => resolve(null));
        }, POST_DATE_VERDICT_CONFIRM_TIMEOUT_MS);
      });
    },
    [confirmVerdictWithServerNextSurface],
  );

  const applyConfirmedVerdictStep = useCallback((result: unknown) => {
    const nextStep = derivePostDateSurveyStepFromVerdict(result);
    setVerdictUiState(nextStep === 'awaiting_partner' ? 'awaiting_partner' : 'confirmed');
    setStep(nextStep);
  }, []);

  useEffect(() => {
    shellImpressionRef.current = false;
    verdictImpressionRef.current = false;
    finishSurveyInFlightRef.current = false;
    queuedNavigationStartedRef.current = false;
    queuedDrainAttemptKeyRef.current = null;
    reportBeforeVerdictRef.current = false;
    reportPassVerdictSavedRef.current = false;
    highlightsSaveInFlightRef.current = false;
    safetySaveInFlightRef.current = false;
    safetyReportInFlightRef.current = false;
    verdictOpenedAtMsRef.current = Date.now();
    setMicroVerdictNowMs(Date.now());
    setCelebrationData(null);
    setVerdictUiState('idle');
    setVerdictError(null);
    setVerdictRetryable(false);
    setReportSubmitting(false);
    resolvePendingVerdictConfirm(null);
  }, [resolvePendingVerdictConfirm, sessionId]);

  useEffect(() => {
    if (!sessionId || !userId || !verdictConfirmEnabled) return undefined;
    const subscription = createVideoDateSessionChannel(supabase, {
      sessionId,
      onEvent: (event: VideoDateSessionBroadcastEvent) => {
        const pending = pendingVerdictConfirmRef.current;
        if (!pending) return;
        const confirmation = confirmationResultFromVerdictBroadcast(event, pending.minSessionSeq);
        if (confirmation) {
          resolvePendingVerdictConfirm(confirmation);
        }
      },
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [resolvePendingVerdictConfirm, sessionId, userId, verdictConfirmEnabled]);

  useEffect(() => {
    return () => {
      resolvePendingVerdictConfirm(null);
      clearVerdictConfirmTimeout();
    };
  }, [clearVerdictConfirmTimeout, resolvePendingVerdictConfirm]);

  useEffect(() => {
    if (!microVerdictV2.enabled || step !== 'verdict') return undefined;
    const interval = setInterval(() => setMicroVerdictNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [microVerdictV2.enabled, step]);

  const microVerdictRemainingSeconds = useMemo(
    () => getVideoDateMicroVerdictRemainingSeconds(verdictOpenedAtMsRef.current, microVerdictNowMs),
    [microVerdictNowMs],
  );

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
    if (!postDateInstantNextV2.enabled || !eventId || !userId) return;
    const key = `${eventId}:${userId}:${sessionId}`;
    if (instantNextPrefetchKeyRef.current === key) return;
    instantNextPrefetchKeyRef.current = key;
    trackEvent('post_date_instant_next_prewarm_started', {
      platform: 'native',
      session_id: sessionId,
      event_id: eventId,
      source_surface: 'post_date_survey',
    });
    void queryClient
      .prefetchQuery({
        queryKey: ['event-deck', eventId, userId, 'deck_v3'],
        queryFn: () => fetchEventDeck(eventId, userId),
        staleTime: 10_000,
      })
      .then(() => {
        const profiles = queryClient.getQueryData<EventDeckFetchResult>([
          'event-deck',
          eventId,
          userId,
          'deck_v3',
        ])?.profiles ?? [];
        for (const item of getVideoDateDeckPrefetchItems(profiles)) {
          const src = deckCardUrl(item.source);
          if (src) void Image.prefetch(src);
        }
        trackEvent('post_date_instant_next_prewarm_result', {
          platform: 'native',
          session_id: sessionId,
          event_id: eventId,
          outcome: 'success',
          deck_count: profiles.length,
        });
      })
      .catch(() => {
        trackEvent('post_date_instant_next_prewarm_result', {
          platform: 'native',
          session_id: sessionId,
          event_id: eventId,
          outcome: 'failure',
        });
      });
  }, [eventId, postDateInstantNextV2.enabled, queryClient, sessionId, userId]);

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
    if (!eventId || !userId || queuedNavigationStartedRef.current) return;
    const drainKey = `${sessionId}:${eventId}:${userId}:${drainQueueV2.enabled ? 'v2' : 'legacy'}`;
    if (queuedDrainAttemptKeyRef.current === drainKey) return;
    queuedDrainAttemptKeyRef.current = drainKey;
    let cancelled = false;
    setIsDrainingQueue(true);
    void (async () => {
      try {
        const result = await drainMatchQueue(eventId, userId, {
          drainMatchQueueV2: drainQueueV2.enabled,
          sourceAction: 'survey_queue_drain',
          sourceSurface: 'post_date_survey',
        });
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
            route: 'ready_gate',
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
  }, [drainQueueV2.enabled, eventId, onQueuedVideoSessionReady, sessionId, userId]);

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
      if (isDrainingQueue) {
        await new Promise((resolve) => setTimeout(resolve, 1800));
        if (queuedNavigationStartedRef.current) return;
      }

      const { data: nextData, error: nextError } = await supabase.rpc('resolve_post_date_next_surface', {
        p_session_id: sessionId,
      });
      const serverNext = normalizeServerPostDateNextSurface(nextData);
      if (!nextError && serverNext) {
        const nextEventId = serverNext.eventId ?? eventId;
        const nextSessionId = serverNext.nextSessionId ?? serverNext.sessionId ?? sessionId;
        trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_NEXT_ACTION_DECIDED, {
          platform: 'native',
          session_id: sessionId,
          event_id: nextEventId,
          action: serverNext.action,
          source: 'survey_finish_server_continuity',
          reason_code: serverNext.reason,
          next_session_id: serverNext.nextSessionId,
          match_id: serverNext.matchId,
          seconds_until_event_end: serverNext.secondsUntilEventEnd,
        });
        trackEvent(LobbyPostDateEvents.SURVEY_NEXT_GATE_CHECK_RESULT, {
          platform: 'native',
          session_id: sessionId,
          event_id: nextEventId,
          source_surface: 'post_date_survey',
          source_action: 'survey_finish_server_continuity',
          outcome: 'success',
          reason_code: serverNext.reason ?? serverNext.action,
          next_session_id: serverNext.nextSessionId,
        });

        if (serverNext.action === 'ready_gate' && nextSessionId && onQueuedVideoSessionReady) {
          queuedNavigationStartedRef.current = true;
          trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_ROUTE_TAKEN, {
            platform: 'native',
            session_id: sessionId,
            event_id: nextEventId,
            action: 'ready_gate',
            route: 'ready_gate',
            video_session_id: nextSessionId,
          });
          onQueuedVideoSessionReady(nextSessionId);
          return;
        }

        if (serverNext.action === 'video_date' && nextSessionId) {
          queuedNavigationStartedRef.current = true;
          trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_ROUTE_TAKEN, {
            platform: 'native',
            session_id: sessionId,
            event_id: nextEventId,
            action: 'video_date',
            route: 'date',
            video_session_id: nextSessionId,
          });
          if (onVideoDateReady) {
            onVideoDateReady(nextSessionId);
          } else {
            onQueuedVideoSessionReady?.(nextSessionId);
          }
          return;
        }

        if (serverNext.action === 'survey') {
          setStep('verdict');
          return;
        }

        if (serverNext.action === 'chat') {
          trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_ROUTE_TAKEN, {
            platform: 'native',
            session_id: sessionId,
            event_id: nextEventId,
            action: 'chat',
            route: 'chat',
            match_id: serverNext.matchId,
          });
          if (onStartChatting) {
            onStartChatting(serverNext.targetId ?? partnerId);
          } else {
            onMutualMatch();
          }
          return;
        }

        if (serverNext.action === 'lobby') {
          trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_ROUTE_TAKEN, {
            platform: 'native',
            session_id: sessionId,
            event_id: nextEventId,
            action: 'lobby',
            route: 'event_lobby',
            seconds_until_event_end: serverNext.secondsUntilEventEnd,
          });
          if (nextEventId) await updateParticipantStatus(nextEventId, 'browsing');
          onDone();
          return;
        }

        if (serverNext.action === 'wrap_up') {
          trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_ROUTE_TAKEN, {
            platform: 'native',
            session_id: sessionId,
            event_id: nextEventId,
            action: 'event_ended',
            route: 'event_ended_alert',
            reason_code: serverNext.reason,
          });
          if (nextEventId) await updateParticipantStatus(nextEventId, 'offline');
          Alert.alert('Event ended', 'This event has ended.', [{ text: 'OK', onPress: onDone }]);
          return;
        }

        if (serverNext.action === 'home') {
          onDone();
          return;
        }
      }

      if (eventId) {
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
    onMutualMatch,
    onQueuedVideoSessionReady,
    onVideoDateReady,
    onStartChatting,
    logJourney,
    partnerId,
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
    if (submitting || verdictUiState === 'submitting' || verdictUiState === 'confirmed') return;
    const previousStep = step;
    const optimisticStep: SurveyStep = liked ? 'awaiting_partner' : 'highlights';
    const canOptimisticallyAdvanceVerdict = postDateInstantNextV2.enabled && !verdictConfirmEnabled;
    let optimisticallyAdvanced = false;
    setSubmitting(true);
    setVerdictUiState('submitting');
    setVerdictError(null);
    setVerdictRetryable(false);
    setLastVerdictAttempt(liked);
    if (canOptimisticallyAdvanceVerdict) {
      setStep(optimisticStep);
      optimisticallyAdvanced = true;
      trackEvent('post_date_verdict_optimistic_started', {
        platform: 'native',
        session_id: sessionId,
        event_id: eventId,
        verdict: liked ? 'vibe' : 'pass',
        optimistic_step: optimisticStep,
      });
    }
    trackEvent(liked ? LobbyPostDateEvents.KEEP_THE_VIBE_YES_TAP : LobbyPostDateEvents.KEEP_THE_VIBE_NO_TAP, {
      platform: 'native',
      session_id: sessionId,
      event_id: eventId,
    });
    try {
      let result: SubmitVerdictAndCheckMutualResult | null = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        result = await onSubmitVerdict(liked);
        if (result.ok || attempt === 3) {
          if (result.ok && attempt > 1) {
            trackEvent(LobbyPostDateEvents.POST_DATE_VERDICT_SUBMIT_SUCCESS_AFTER_RETRY, {
              platform: 'native',
              session_id: sessionId,
              event_id: eventId,
              attempt,
            });
          }
          break;
        }
        trackEvent(LobbyPostDateEvents.POST_DATE_VERDICT_SUBMIT_RETRY, {
          platform: 'native',
          session_id: sessionId,
          event_id: eventId,
          attempt,
          reason: result.reason,
        });
        await new Promise((resolve) => setTimeout(resolve, 350 * 2 ** (attempt - 1)));
      }
      if (!result) {
        setVerdictRetryable(true);
        setVerdictError("Couldn't save your answer. Tap to retry.");
        setVerdictUiState('retryable_failed');
        if (optimisticallyAdvanced) {
          setStep(previousStep);
          trackEvent('post_date_verdict_optimistic_rollback', {
            platform: 'native',
            session_id: sessionId,
            event_id: eventId,
            reason: 'missing_result',
            rollback_step: previousStep,
          });
        }
        return;
      }
      if (!result.ok) {
        trackEvent(LobbyPostDateEvents.POST_DATE_VERDICT_SUBMIT_FAILED, {
          platform: 'native',
          session_id: sessionId,
          event_id: eventId,
          reason: result.reason,
          code: result.reason === 'backend' ? result.code : undefined,
        });
        setVerdictRetryable(
          result.reason !== 'backend' ||
            !['blocked_pair', 'not_participant', 'session_not_found'].includes(result.code),
        );
        setVerdictError(verdictFailureUserMessage(result));
        if (optimisticallyAdvanced) {
          setStep(previousStep);
          trackEvent('post_date_verdict_optimistic_rollback', {
            platform: 'native',
            session_id: sessionId,
            event_id: eventId,
            reason: result.reason,
            rollback_step: previousStep,
          });
        }
        setVerdictUiState('retryable_failed');
        return;
      }
      setVerdictRetryable(false);
      const confirmedResult = verdictConfirmEnabled ? await waitForVerdictConfirmation(result) : result;
      if (!confirmedResult) {
        setVerdictRetryable(true);
        setVerdictError("Couldn't confirm your answer. Tap to retry.");
        setVerdictUiState('retryable_failed');
        if (optimisticallyAdvanced) {
          setStep(previousStep);
          trackEvent('post_date_verdict_optimistic_rollback', {
            platform: 'native',
            session_id: sessionId,
            event_id: eventId,
            reason: 'confirmation_timeout',
            rollback_step: previousStep,
          });
        }
        return;
      }
      const confirmedVerdict = normalizePostDateVerdictConfirmationResult(confirmedResult);
      if (optimisticallyAdvanced) {
        trackEvent('post_date_verdict_optimistic_confirmed', {
          platform: 'native',
          session_id: sessionId,
          event_id: eventId,
          verdict: liked ? 'vibe' : 'pass',
        });
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
        outcome: confirmedVerdict.mutual ? 'mutual' : 'not_mutual',
      });
      if (confirmedVerdict.partnerVerdictRecorded && !confirmedVerdict.awaitingPartnerVerdict) {
        trackEvent(LobbyPostDateEvents.POST_DATE_PENDING_VERDICT_COMPLETED, {
          platform: 'native',
          session_id: sessionId,
          event_id: eventId,
          outcome: confirmedVerdict.mutual ? 'mutual' : 'not_mutual',
        });
      }
      if (!confirmedVerdict.mutual && confirmedVerdict.awaitingPartnerVerdict) {
        trackEvent(LobbyPostDateEvents.POST_DATE_VERDICT_PENDING_PARTNER, {
          platform: 'native',
          session_id: sessionId,
          event_id: eventId,
        });
        trackEvent(LobbyPostDateEvents.POST_DATE_HALF_VERDICT_SAVED, {
          platform: 'native',
          session_id: sessionId,
          event_id: eventId,
        });
        trackEvent(LobbyPostDateEvents.POST_DATE_HALF_VERDICT_PENDING, {
          platform: 'native',
          session_id: sessionId,
          event_id: eventId,
        });
      }
      applyConfirmedVerdictStep(confirmedResult);
    } catch {
      trackEvent(LobbyPostDateEvents.POST_DATE_VERDICT_SUBMIT_FAILED, {
        platform: 'native',
        session_id: sessionId,
        event_id: eventId,
        reason: 'exception',
      });
      setVerdictRetryable(true);
      setVerdictError("Couldn't save your answer. Tap to retry.");
      setVerdictUiState('retryable_failed');
      if (optimisticallyAdvanced) {
        setStep(previousStep);
        trackEvent('post_date_verdict_optimistic_rollback', {
          platform: 'native',
          session_id: sessionId,
          event_id: eventId,
          reason: 'exception',
          rollback_step: previousStep,
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const persistHighlights = async () => {
    const conversationFlow =
      flow === 'Naturally' ? 'natural' : flow === 'Took effort' ? 'effort' : flow === 'One-sided' ? 'one_sided' : null;
    await supabase.rpc('update_post_date_feedback_details', {
      p_session_id: sessionId,
      p_patch: {
        tag_chemistry: tagSel.tagChemistry,
        tag_fun: tagSel.tagFun,
        tag_smart: tagSel.tagSmart,
        tag_respectful: tagSel.tagRespectful,
        energy: energy?.toLowerCase() || null,
        conversation_flow: conversationFlow,
      },
    });
  };

  const persistSafety = async () => {
    await supabase.rpc('update_post_date_feedback_details', {
      p_session_id: sessionId,
      p_patch: {
        photo_accurate: photoAccurate,
        honest_representation: honest,
      },
    });
  };

  const handleHighlightsSubmit = async () => {
    if (highlightsSaveInFlightRef.current) return;
    highlightsSaveInFlightRef.current = true;
    try {
      await persistHighlights();
    } catch {
      /* best-effort */
    } finally {
      highlightsSaveInFlightRef.current = false;
    }
    setStep('safety');
  };

  const handleHighlightsSkip = () => {
    if (highlightsSaveInFlightRef.current) return;
    trackEvent(LobbyPostDateEvents.POST_DATE_SURVEY_SKIP, {
      platform: 'native',
      session_id: sessionId,
      event_id: eventId,
      step: 'highlights',
    });
    setStep('safety');
  };

  const handleSafetyComplete = async () => {
    if (finishing || safetySaveInFlightRef.current || safetyReportInFlightRef.current) return;
    safetySaveInFlightRef.current = true;
    try {
      if (reportBeforeVerdictRef.current && !reportPassVerdictSavedRef.current) {
        const ok = await recordReportPassVerdict(null);
        if (!ok) {
          Alert.alert('Feedback', "Couldn't save your answer. Check your connection and try again.");
          return;
        }
      }
      await persistSafety();
      await finishSurveyRef.current();
    } catch {
      /* best-effort */
    } finally {
      safetySaveInFlightRef.current = false;
    }
  };

  const handleSafetySkip = async () => {
    if (finishing || safetySaveInFlightRef.current || safetyReportInFlightRef.current) return;
    safetySaveInFlightRef.current = true;
    trackEvent(LobbyPostDateEvents.POST_DATE_SURVEY_SKIP, {
      platform: 'native',
      session_id: sessionId,
      event_id: eventId,
      step: 'safety',
    });
    try {
      if (reportBeforeVerdictRef.current && !reportPassVerdictSavedRef.current) {
        const ok = await recordReportPassVerdict(null);
        if (!ok) {
          Alert.alert('Feedback', "Couldn't save your answer. Check your connection and try again.");
          return;
        }
      }
      await finishSurveyRef.current();
    } finally {
      safetySaveInFlightRef.current = false;
    }
  };

  const recordReportPassVerdict = async (report?: PostDateSafetyReportPayload | null): Promise<boolean> => {
    if (reportPassVerdictSavedRef.current) return true;
    const result = report
      ? await submitNativePostDateOutboxItem({
          userId,
          sessionId,
          eventId,
          payload: {
            kind: 'verdict',
            liked: false,
            report,
            backendVersion: submitVerdictV3.enabled ? 'v3' : 'v2',
          },
        })
      : await onSubmitVerdict(false);
    if ('ok' in result && !result.ok) {
      trackEvent(LobbyPostDateEvents.POST_DATE_VERDICT_SUBMIT_FAILED, {
        platform: 'native',
        session_id: sessionId,
        event_id: eventId,
        reason: result.reason,
        code: result.reason === 'backend' ? result.code : undefined,
        source: 'report_before_verdict',
      });
      return false;
    }
    if (!('ok' in result) && result.success === false) {
      trackEvent(LobbyPostDateEvents.POST_DATE_VERDICT_SUBMIT_FAILED, {
        platform: 'native',
        session_id: sessionId,
        event_id: eventId,
        reason: result.error ?? result.code ?? 'report_pass_verdict_failed',
        code: result.code,
        source: 'report_before_verdict',
      });
      return false;
    }
    if (verdictConfirmEnabled) {
      const confirmed = await waitForVerdictConfirmation(result);
      if (!confirmed) {
        trackEvent(LobbyPostDateEvents.POST_DATE_VERDICT_SUBMIT_FAILED, {
          platform: 'native',
          session_id: sessionId,
          event_id: eventId,
          reason: 'report_pass_confirmation_failed',
          source: 'report_before_verdict',
        });
        return false;
      }
    }
    reportPassVerdictSavedRef.current = true;
    trackEvent(LobbyPostDateEvents.POST_DATE_SURVEY_SUBMIT, {
      platform: 'native',
      session_id: sessionId,
      event_id: eventId,
      verdict: 'pass',
      source: 'report_before_verdict',
    });
    return true;
  };

  const handleReportSubmit = async () => {
    if (!reportCategory || safetyReportInFlightRef.current || safetySaveInFlightRef.current || finishing) return;
    safetyReportInFlightRef.current = true;
    setReportSubmitting(true);
    const mapped = mapPostDateSafetyCategoryToReasonId(reportCategory);
    const reportPayload: PostDateSafetyReportPayload = {
      reason: mapped,
      details: reportDetails || null,
      alsoBlock: wantsBlock,
    };
    try {
      const result = reportBeforeVerdictRef.current && !reportPassVerdictSavedRef.current
        ? { ok: await recordReportPassVerdict(reportPayload) }
        : await submitPostDateReportWithOutbox(sessionId, userId, reportPayload);
      if (!result.ok) {
        const msg =
          'error' in result && result.error === 'rate_limited'
            ? 'Too many reports. Try again later.'
            : 'Could not submit.';
        Alert.alert('Report', msg);
        return;
      }
      setSafetySubmitted(true);
    } catch {
      Alert.alert('Report', 'Could not submit.');
    } finally {
      safetyReportInFlightRef.current = false;
      setReportSubmitting(false);
    }
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

  if (step === 'awaiting_partner') {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <Text style={[styles.title, { color: theme.text }]}>Awaiting your match&apos;s verdict</Text>
        <Text style={[styles.sub, { color: theme.mutedForeground }]}>
          Your answer is saved. We&apos;ll only create a match if your date also vibes.
        </Text>
        <ContinuityStrip decision={continuityDecision} theme={theme} />
        <Pressable
          style={[styles.primaryBtn, { backgroundColor: theme.tint, marginTop: spacing.lg }]}
          onPress={() => setStep('highlights')}
        >
          <Text style={styles.primaryBtnText}>Continue</Text>
        </Pressable>
      </View>
    );
  }

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
        <Pressable onPress={handleHighlightsSkip}>
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
            disabled={finishing || reportSubmitting}
            onPress={() => void handleSafetyComplete()}
          >
            {finishing || reportSubmitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>Back to the event 💚</Text>
            )}
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
                style={[
                  styles.primaryBtn,
                  { backgroundColor: theme.danger, marginTop: spacing.sm },
                  reportSubmitting && styles.disabledAction,
                ]}
                disabled={reportSubmitting || finishing}
                onPress={() => void handleReportSubmit()}
              >
                {reportSubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Submit Report</Text>}
              </Pressable>
            ) : null}
          </View>
        )}

        <Pressable
          style={[styles.primaryBtn, { backgroundColor: theme.tint }, finishing && { opacity: 0.7 }]}
          disabled={finishing || reportSubmitting}
          onPress={() => void handleSafetyComplete()}
        >
          {finishing || reportSubmitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>Done — back to the event 💚</Text>
          )}
        </Pressable>
        <Pressable
          disabled={finishing || reportSubmitting}
          onPress={() => void handleSafetySkip()}
        >
          <Text style={[styles.skip, { color: theme.mutedForeground }]}>
            {finishing || reportSubmitting ? 'Returning...' : 'Skip'}
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

  const partnerInitial = (partnerName.trim()[0] ?? '?').toUpperCase();

  return (
    <LinearGradient
      colors={[withNativeAlpha(theme.tint, 0.16), theme.background, theme.background] as const}
      locations={[0, 0.44, 1]}
      style={styles.verdictBackdrop}
    >
      <View style={styles.verdictShell}>
        <ContinuityStrip decision={continuityDecision} theme={theme} />
        <View
          style={[
            styles.verdictPanel,
            {
              borderColor: theme.glassBorder,
              backgroundColor: withNativeAlpha(theme.surface, 0.9),
            },
          ]}
        >
          <View style={styles.avatarStage}>
            <View style={[styles.avatarHalo, { backgroundColor: withNativeAlpha(theme.tint, 0.18) }]} />
            <LinearGradient
              colors={[theme.tint, theme.neonPink, theme.neonCyan] as const}
              style={styles.avatarRing}
            >
              {partnerImage ? (
                <Image source={{ uri: partnerImage }} style={styles.verdictAvatar} />
              ) : (
                <View style={[styles.verdictAvatarFallback, { backgroundColor: theme.muted }]}>
                  <Text style={[styles.verdictAvatarInitial, { color: theme.text }]}>{partnerInitial}</Text>
                </View>
              )}
            </LinearGradient>
          </View>

          <Text style={[styles.verdictEyebrow, { color: theme.mutedForeground }]}>Private check-in</Text>
          <Text style={[styles.verdictTitle, { color: theme.text }]}>Keep the vibe with {partnerName}?</Text>
          <Text style={[styles.verdictSub, { color: theme.mutedForeground }]}>
            If you both choose Vibe, the match opens. Otherwise, this stays quiet.
          </Text>
          {microVerdictV2.enabled ? (
            <Text
              style={[styles.microVerdictText, { color: theme.mutedForeground }]}
              accessibilityLiveRegion="polite"
            >
              {getVideoDateMicroVerdictCopy(microVerdictRemainingSeconds)}
            </Text>
          ) : null}

          {verdictError ? (
            <View style={[styles.errorWrap, styles.verdictErrorWrap]}>
              <Text style={[styles.errorBanner, { color: theme.danger }]} accessibilityLiveRegion="polite">
                {verdictError}
              </Text>
              {verdictRetryable && lastVerdictAttempt !== null ? (
                <Pressable
                  disabled={submitting || verdictUiState === 'submitting'}
                  onPress={() => void handleVerdict(lastVerdictAttempt)}
                  style={[
                    styles.retryBtn,
                    { borderColor: theme.danger, backgroundColor: theme.surface },
                    submitting && { opacity: 0.7 },
                  ]}
                >
                  <Text style={[styles.retryBtnText, { color: theme.text }]}>Try again</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <View style={styles.buttons}>
            <Pressable
              disabled={submitting || verdictUiState === 'submitting'}
              onPress={() => void handleVerdict(true)}
              accessibilityRole="button"
              accessibilityLabel={`Vibe with ${partnerName}`}
              style={({ pressed }) => [
                styles.vibeBtn,
                (submitting || verdictUiState === 'submitting') && styles.disabledAction,
                pressed && !submitting && verdictUiState !== 'submitting' && styles.pressed,
              ]}
            >
              <LinearGradient
                colors={[theme.tint, theme.neonPink] as const}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.vibeBtnGradient}
              />
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <View style={styles.actionLabelRow}>
                  <Text style={styles.vibeBtnIcon}>♥</Text>
                  <Text style={styles.vibeBtnText}>Vibe</Text>
                </View>
              )}
            </Pressable>
            <Pressable
              disabled={submitting || verdictUiState === 'submitting'}
              onPress={() => void handleVerdict(false)}
              accessibilityRole="button"
              accessibilityLabel={`Pass on ${partnerName}`}
              style={({ pressed }) => [
                styles.passBtn,
                {
                  borderColor: withNativeAlpha('#ffffff', 0.08),
                  backgroundColor: withNativeAlpha('#ffffff', 0.055),
                },
                (submitting || verdictUiState === 'submitting') && styles.disabledAction,
                pressed && !submitting && verdictUiState !== 'submitting' && styles.pressed,
              ]}
            >
              <Text style={[styles.passBtnIcon, { color: theme.mutedForeground }]}>×</Text>
              <Text style={[styles.passBtnText, { color: theme.text }]}>Pass</Text>
            </Pressable>
          </View>

          <Pressable
            disabled={submitting || verdictUiState === 'submitting'}
            onPress={() => {
              reportBeforeVerdictRef.current = true;
              setShowReportFlow(true);
              setStep('safety');
            }}
            style={[styles.reportLink, (submitting || verdictUiState === 'submitting') && styles.disabledAction]}
          >
            <Text style={{ color: theme.mutedForeground, fontSize: 12 }}>Report an issue</Text>
          </Pressable>
        </View>
      </View>
    </LinearGradient>
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
  verdictBackdrop: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  verdictShell: {
    width: '100%',
    maxWidth: 430,
    alignSelf: 'center',
  },
  verdictPanel: {
    width: '100%',
    borderWidth: 1,
    borderRadius: radius['3xl'],
    paddingHorizontal: spacing.xl,
    paddingTop: spacing['2xl'],
    paddingBottom: spacing.xl,
    alignItems: 'center',
    overflow: 'hidden',
    ...shadows.card,
  },
  avatarStage: {
    width: 124,
    height: 124,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  avatarHalo: {
    position: 'absolute',
    width: 124,
    height: 124,
    borderRadius: 62,
    opacity: 0.9,
    transform: [{ scale: 1.05 }],
    ...shadows.glowPink,
  },
  avatarRing: {
    width: 106,
    height: 106,
    borderRadius: 53,
    padding: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verdictAvatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  verdictAvatarFallback: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verdictAvatarInitial: {
    ...typography.titleXL,
  },
  verdictEyebrow: {
    ...typography.overline,
    textAlign: 'center',
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  verdictTitle: {
    ...typography.titleXL,
    textAlign: 'center',
    lineHeight: 28,
    marginBottom: spacing.sm,
  },
  verdictSub: {
    ...typography.bodySecondary,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 286,
    marginBottom: spacing.xl,
  },
  microVerdictText: {
    ...typography.caption,
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 286,
    marginTop: -spacing.md,
    marginBottom: spacing.lg,
  },
  verdictErrorWrap: {
    marginTop: -spacing.sm,
    marginBottom: spacing.lg,
  },
  continuityStrip: {
    width: '100%',
    borderWidth: 1,
    borderRadius: radius['2xl'],
    padding: spacing.md,
    marginBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  continuityRail: {
    width: 4,
    height: 38,
    borderRadius: radius.pill,
    marginTop: 1,
  },
  continuityCopy: {
    flex: 1,
    minWidth: 0,
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
    paddingHorizontal: spacing.md,
  },
  errorWrap: {
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  retryBtn: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  retryBtnText: {
    fontSize: 13,
    fontWeight: '700',
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
    alignSelf: 'center',
  },
  vibeBtn: {
    height: 64,
    borderRadius: radius['2xl'],
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...shadows.glowPink,
  },
  vibeBtnGradient: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius['2xl'],
  },
  actionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  vibeBtnIcon: {
    color: '#fff',
    fontSize: 25,
    lineHeight: 28,
  },
  vibeBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  passBtn: {
    height: 56,
    borderRadius: radius['2xl'],
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  passBtnIcon: {
    fontSize: 24,
    lineHeight: 26,
    fontWeight: '300',
  },
  passBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.9,
  },
  disabledAction: {
    opacity: 0.58,
  },
  reportLink: {
    marginTop: spacing.lg,
    padding: spacing.sm,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
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
