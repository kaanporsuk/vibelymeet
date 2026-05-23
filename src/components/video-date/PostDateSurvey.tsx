import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { vdbg, vdbgRedirect } from "@/lib/vdbg";

import { Button } from "@/components/ui/button";
import { VerdictScreen } from "./survey/VerdictScreen";
import { HighlightsScreen } from "./survey/HighlightsScreen";
import { SafetyScreen } from "./survey/SafetyScreen";
import { EventEndedModal } from "@/components/events/EventEndedModal";
import MatchSuccessModal from "@/components/match/MatchSuccessModal";
import { cn } from "@/lib/utils";
import { useUserProfile } from "@/contexts/AuthContext";
import { useEventStatus } from "@/hooks/useEventStatus";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { fetchEventDeck, type EventDeckFetchResult } from "@/hooks/useEventDeck";
import { useEventLifecycle } from "@/hooks/useEventLifecycle";
import { useMatchQueue } from "@/hooks/useMatchQueue";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/analytics";
import { deckCardUrl } from "@/utils/imageUrl";
import { submitWebPostDateOutboxItem } from "@/lib/postDateOutbox/execute";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";
import type { PostDateSafetyReportPayload } from "@clientShared/postDateOutbox/types";
import {
  getPostDateSurveyContinuityDecision,
  isPostDateEventNearlyOver,
  normalizeServerPostDateNextSurface,
  secondsUntilPostDateEventEnd,
  shouldEnablePostDateSurveyQueueDrain,
  type PostDateContinuityDecision,
} from "@clientShared/matching/postDateContinuity";
import {
  getVideoDateJourneyEventName,
  type VideoDateJourneyEvent,
} from "@clientShared/matching/videoDateDiagnostics";
import {
  mapPostDateSafetyCategoryToReasonId,
} from "@clientShared/safety/submitUserReportRpc";
import {
  getVideoDateMicroVerdictCopy,
  getVideoDateMicroVerdictRemainingSeconds,
} from "@clientShared/matching/videoDateMicroVerdict";
import { getVideoDateDeckPrefetchItems } from "@clientShared/matching/videoDateDeckPrefetch";

interface PostDateSurveyProps {
  isOpen: boolean;
  sessionId: string;
  partnerId: string;
  partnerName: string;
  partnerImage: string;
  eventId?: string;
}

type SurveyStep = "verdict" | "celebration" | "awaiting_partner" | "highlights" | "safety";
const SURVEY_DRAIN_SOFT_WAIT_MS = 1800;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PostDateContinuityStrip = ({ decision }: { decision: PostDateContinuityDecision }) => {
  const toneClass = {
    ready: "border-emerald-400/25 bg-emerald-500/[0.08] text-emerald-100",
    last_chance: "border-amber-400/25 bg-amber-500/[0.08] text-amber-100",
    ended: "border-white/[0.12] bg-white/[0.045] text-white/70",
    checking: "border-primary/25 bg-primary/[0.07] text-violet-100",
    empty: "border-white/10 bg-white/[0.045] text-white/[0.72]",
  }[decision.tone];

  const railClass = {
    ready: "from-emerald-300 via-emerald-400 to-neon-cyan",
    last_chance: "from-amber-300 via-amber-400 to-neon-yellow",
    ended: "from-white/35 via-white/25 to-white/10",
    checking: "from-primary via-accent to-neon-cyan",
    empty: "from-white/35 via-primary/50 to-white/15",
  }[decision.tone];

  return (
    <div
      className={cn(
        "mb-3 overflow-hidden rounded-[1.35rem] border px-3.5 py-3 shadow-[0_18px_48px_-34px_rgba(0,0,0,0.9)] backdrop-blur-xl",
        toneClass,
      )}
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 h-9 w-1 shrink-0 rounded-full bg-gradient-to-b", railClass)} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-30" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-current opacity-85" />
            </span>
            <p className="truncate text-[10px] font-bold uppercase tracking-[0.18em]">{decision.title}</p>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-white/[0.56]">{decision.message}</p>
        </div>
      </div>
    </div>
  );
};

export const PostDateSurvey = ({
  isOpen,
  sessionId,
  partnerId,
  partnerName,
  partnerImage,
  eventId,
}: PostDateSurveyProps) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useUserProfile();
  const { setStatus } = useEventStatus({ eventId });
  const microVerdictV2 = useFeatureFlag("video_date.micro_verdict_v2");
  const submitVerdictV3 = useFeatureFlag("video_date.outbox_v2.submit_verdict");
  const postDateInstantNextV2 = useFeatureFlag("video_date.post_date_instant_next_v2");
  const [step, setStep] = useState<SurveyStep>("verdict");
  const [showEventEnded, setShowEventEnded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [verdictError, setVerdictError] = useState<string | null>(null);
  const [verdictRetryable, setVerdictRetryable] = useState(false);
  const [lastVerdictAttempt, setLastVerdictAttempt] = useState<boolean | null>(null);
  const [isFinishingSurvey, setIsFinishingSurvey] = useState(false);
  const [surveyStatus, setSurveyStatus] = useState<string>("in_survey");
  // Data for the polished mutual-match celebration
  const [celebrationData, setCelebrationData] = useState<{
    partnerAge: number;
    sharedVibes: string[];
  } | null>(null);
  const loggedJourneyEventsRef = useRef<Set<string>>(new Set());
  const surveyShellImpressionRef = useRef(false);
  const verdictStepImpressionRef = useRef(false);
  const finishSurveyInFlightRef = useRef(false);
  const queuedNavigationStartedRef = useRef(false);
  const reportBeforeVerdictRef = useRef(false);
  const reportPassVerdictSavedRef = useRef(false);
  const verdictOpenedAtMsRef = useRef(Date.now());
  const instantNextPrefetchKeyRef = useRef<string | null>(null);
  const [microVerdictNowMs, setMicroVerdictNowMs] = useState(Date.now());

  useEffect(() => {
    if (!isOpen || !sessionId) return;
    verdictOpenedAtMsRef.current = Date.now();
    setMicroVerdictNowMs(Date.now());
    if (surveyShellImpressionRef.current) return;
    surveyShellImpressionRef.current = true;
    trackEvent(LobbyPostDateEvents.POST_DATE_SURVEY_IMPRESSION, {
      platform: "web",
      session_id: sessionId,
      event_id: eventId,
    });
    trackEvent(LobbyPostDateEvents.SURVEY_NEXT_GATE_CHECK_STARTED, {
      platform: "web",
      session_id: sessionId,
      event_id: eventId,
      source_surface: "post_date_survey",
      source_action: "survey_opened",
      outcome: "no_op",
    });
  }, [isOpen, sessionId, eventId]);

  useEffect(() => {
    if (!microVerdictV2.enabled || !isOpen || step !== "verdict") return undefined;
    const interval = window.setInterval(() => setMicroVerdictNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [isOpen, microVerdictV2.enabled, step]);

  const microVerdictRemainingSeconds = useMemo(
    () => getVideoDateMicroVerdictRemainingSeconds(verdictOpenedAtMsRef.current, microVerdictNowMs),
    [microVerdictNowMs],
  );

  useEffect(() => {
    if (!isOpen || step !== "verdict" || !sessionId) return;
    if (verdictStepImpressionRef.current) return;
    verdictStepImpressionRef.current = true;
    trackEvent(LobbyPostDateEvents.KEEP_THE_VIBE_IMPRESSION, {
      platform: "web",
      session_id: sessionId,
      event_id: eventId,
    });
  }, [eventId, isOpen, sessionId, step]);

  useEffect(() => {
    surveyShellImpressionRef.current = false;
    verdictStepImpressionRef.current = false;
    finishSurveyInFlightRef.current = false;
    queuedNavigationStartedRef.current = false;
    reportBeforeVerdictRef.current = false;
    reportPassVerdictSavedRef.current = false;
    setCelebrationData(null);
  }, [sessionId]);

  useEffect(() => {
    if (!postDateInstantNextV2.enabled || !isOpen || !eventId || !user?.id) return;
    const key = `${eventId}:${user.id}:${sessionId}`;
    if (instantNextPrefetchKeyRef.current === key) return;
    instantNextPrefetchKeyRef.current = key;
    trackEvent("post_date_instant_next_prewarm_started", {
      platform: "web",
      session_id: sessionId,
      event_id: eventId,
      source_surface: "post_date_survey",
    });
    void queryClient
      .prefetchQuery({
        queryKey: ["event-deck", eventId, user.id, "deck_v3"],
        queryFn: () => fetchEventDeck(eventId, user.id),
        staleTime: 10_000,
      })
      .then(() => {
        const profiles = queryClient.getQueryData<EventDeckFetchResult>([
          "event-deck",
          eventId,
          user.id,
          "deck_v3",
        ])?.profiles ?? [];
        for (const item of getVideoDateDeckPrefetchItems(profiles)) {
          const src = deckCardUrl(item.source);
          if (!src) continue;
          const image = new Image();
          image.decoding = "async";
          image.src = src;
        }
        trackEvent("post_date_instant_next_prewarm_result", {
          platform: "web",
          session_id: sessionId,
          event_id: eventId,
          outcome: "success",
          deck_count: profiles.length,
        });
      })
      .catch(() => {
        trackEvent("post_date_instant_next_prewarm_result", {
          platform: "web",
          session_id: sessionId,
          event_id: eventId,
          outcome: "failure",
        });
      });
  }, [eventId, isOpen, postDateInstantNextV2.enabled, queryClient, sessionId, user?.id]);

  const logJourney = useCallback(
    (event: VideoDateJourneyEvent, payload?: Record<string, unknown>, dedupeKey?: string) => {
      const key = dedupeKey ?? event;
      if (loggedJourneyEventsRef.current.has(key)) return;
      loggedJourneyEventsRef.current.add(key);
      trackEvent(getVideoDateJourneyEventName(event), {
        platform: "web",
        session_id: sessionId,
        event_id: eventId,
        ...(payload ?? {}),
      });
      vdbg(`journey_${event}`, { sessionId, eventId: eventId ?? null, ...(payload ?? {}) });
    },
    [sessionId, eventId]
  );

  useEffect(() => {
    if (step !== "celebration" || !user?.id) return;
    let cancelled = false;

    const fetchCelebrationData = async () => {
      try {
        const [{ data: partnerProfile }, { data: myVibes }] =
          await Promise.all([
            supabase.rpc("get_profile_for_viewer", { p_target_id: partnerId }),
            supabase.from("profile_vibes").select("vibe_tags(label)").eq("profile_id", user.id),
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

        const partnerRow = partnerProfile as { age?: number | null; vibes?: string[] | null } | null;
        const myLabels = extractLabels(myVibes);
        const partnerLabels = Array.isArray(partnerRow?.vibes)
          ? partnerRow.vibes.filter((label): label is string => typeof label === "string" && label.trim().length > 0)
          : [];
        const shared = myLabels.filter((l) => partnerLabels.includes(l));

        setCelebrationData({
          partnerAge: partnerRow?.age ?? 0,
          sharedVibes: shared,
        });
      } catch {
        if (!cancelled) {
          setCelebrationData({ partnerAge: 0, sharedVibes: [] });
        }
      }
    };

    fetchCelebrationData();
    return () => { cancelled = true; };
  }, [step, user?.id, partnerId]);

  const {
    isEventActive,
    eventEndsAt,
    isResolved: isEventLifecycleResolved,
    checkEventActive,
  } = useEventLifecycle({ eventId });

  /**
   * Post-date survey is intentionally anchored on `/date/:sessionId` (not lobby `useActiveSession`).
   * We still poll `drain_match_queue` here as a fallback when realtime lags — see `enableSurveyPhaseDrain`.
   */
  const secondsUntilEventEnd = useMemo(
    () => secondsUntilPostDateEventEnd(eventEndsAt),
    [eventEndsAt]
  );
  const surveyQueueDrainEnabled = useMemo(
    () =>
      shouldEnablePostDateSurveyQueueDrain({
        hasEventId: Boolean(eventId),
        eventLifecycleResolved: isEventLifecycleResolved,
        eventActive: isEventActive,
        secondsUntilEventEnd,
      }),
    [eventId, isEventActive, isEventLifecycleResolved, secondsUntilEventEnd],
  );

  const handleQueueMatch = useCallback(
    (videoSessionId: string, _queuePartnerId: string) => {
      if (queuedNavigationStartedRef.current) return;
      queuedNavigationStartedRef.current = true;
      trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_NEXT_ACTION_DECIDED, {
        platform: "web",
        session_id: sessionId,
        event_id: eventId,
        action: "ready_gate",
        source: "survey_queue_drain",
        video_session_id: videoSessionId,
      });
      trackEvent(LobbyPostDateEvents.SURVEY_NEXT_GATE_CHECK_RESULT, {
        platform: "web",
        session_id: sessionId,
        event_id: eventId,
        source_surface: "post_date_survey",
        source_action: "survey_queue_drain",
        outcome: "success",
        reason_code: "queue_drain_found",
        next_session_id: videoSessionId,
      });
      trackEvent(LobbyPostDateEvents.SURVEY_NEXT_GATE_CONVERSION, {
        platform: "web",
        session_id: sessionId,
        event_id: eventId,
        source_surface: "post_date_survey",
        source_action: "ready_gate_from_survey_drain",
        outcome: "success",
        next_session_id: videoSessionId,
      });
      toast("Your next date is ready 💚", { duration: 2000 });
      const target = `/ready/${encodeURIComponent(videoSessionId)}`;
      trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_ROUTE_TAKEN, {
        platform: "web",
        session_id: sessionId,
        event_id: eventId,
        action: "ready_gate",
        route: "ready_gate",
        video_session_id: videoSessionId,
      });
      vdbgRedirect(target, "survey_queue_match_ready", { sessionId, eventId, readyGateSessionId: videoSessionId });
      navigate(target, { replace: true });
    },
    [navigate, eventId, sessionId]
  );

  const { queuedCount, isDraining } = useMatchQueue({
    eventId,
    currentStatus: surveyStatus,
    enabled: surveyQueueDrainEnabled,
    enableSurveyPhaseDrain: true,
    sourceSurface: "post_date_survey",
    suppressDrainReasonToasts: true,
    onVideoSessionReady: handleQueueMatch,
  });

  const continuityDecision = useMemo(
    () =>
      getPostDateSurveyContinuityDecision({
        isDrainingQueue: isDraining,
        queuedCount,
        isSubmittingSurvey: isFinishingSurvey,
        eventActive: isEventActive,
        eventLifecycleResolved: isEventLifecycleResolved,
        secondsUntilEventEnd,
        hasEventId: Boolean(eventId),
      }),
    [eventId, isDraining, queuedCount, isFinishingSurvey, isEventActive, isEventLifecycleResolved, secondsUntilEventEnd]
  );

  const finishSurvey = useCallback(async () => {
    if (finishSurveyInFlightRef.current || queuedNavigationStartedRef.current) return;
    finishSurveyInFlightRef.current = true;
    setIsFinishingSurvey(true);
    trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_SURVEY_COMPLETE, {
      platform: "web",
      session_id: sessionId,
      event_id: eventId,
      decision_at_submit: continuityDecision.action,
      queued_count: queuedCount,
      seconds_until_event_end: secondsUntilEventEnd,
    });
    try {
      if (isDraining) {
        await sleep(SURVEY_DRAIN_SOFT_WAIT_MS);
        if (queuedNavigationStartedRef.current) return;
      }

      const { data: nextData, error: nextError } = await supabase.rpc("resolve_post_date_next_surface", {
        p_session_id: sessionId,
      });
      const serverNext = normalizeServerPostDateNextSurface(nextData);
      if (!nextError && serverNext) {
        const nextEventId = serverNext.eventId ?? eventId;
        const nextSessionId = serverNext.nextSessionId ?? serverNext.sessionId ?? sessionId;
        trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_NEXT_ACTION_DECIDED, {
          platform: "web",
          session_id: sessionId,
          event_id: nextEventId,
          action: serverNext.action,
          source: "survey_finish_server_continuity",
          reason_code: serverNext.reason,
          next_session_id: serverNext.nextSessionId,
          match_id: serverNext.matchId,
          seconds_until_event_end: serverNext.secondsUntilEventEnd,
        });
        trackEvent(LobbyPostDateEvents.SURVEY_NEXT_GATE_CHECK_RESULT, {
          platform: "web",
          session_id: sessionId,
          event_id: nextEventId,
          source_surface: "post_date_survey",
          source_action: "survey_finish_server_continuity",
          outcome: "success",
          reason_code: serverNext.reason ?? serverNext.action,
          next_session_id: serverNext.nextSessionId,
        });

        if (serverNext.action === "ready_gate" && nextSessionId) {
          queuedNavigationStartedRef.current = true;
          const target = `/ready/${encodeURIComponent(nextSessionId)}`;
          trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_ROUTE_TAKEN, {
            platform: "web",
            session_id: sessionId,
            event_id: nextEventId,
            action: "ready_gate",
            route: "ready_gate",
            video_session_id: nextSessionId,
          });
          vdbgRedirect(target, "survey_finish_server_ready_gate", { sessionId, eventId: nextEventId, nextSessionId });
          navigate(target, { replace: true });
          return;
        }

        if (serverNext.action === "survey") {
          setStep("verdict");
          return;
        }

        if (serverNext.action === "video_date" && nextSessionId) {
          const target = `/date/${nextSessionId}`;
          trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_ROUTE_TAKEN, {
            platform: "web",
            session_id: sessionId,
            event_id: nextEventId,
            action: "video_date",
            route: "date",
            video_session_id: nextSessionId,
          });
          vdbgRedirect(target, "survey_finish_server_video_date", { sessionId, eventId: nextEventId, nextSessionId });
          navigate(target);
          return;
        }

        if (serverNext.action === "chat") {
          const target = `/chat/${serverNext.targetId ?? partnerId}`;
          trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_ROUTE_TAKEN, {
            platform: "web",
            session_id: sessionId,
            event_id: nextEventId,
            action: "chat",
            route: "chat",
            match_id: serverNext.matchId,
          });
          vdbgRedirect(target, "survey_finish_server_chat", { sessionId, eventId: nextEventId, matchId: serverNext.matchId });
          navigate(target);
          return;
        }

        if (serverNext.action === "lobby" && nextEventId) {
          logJourney("survey_completed", { source: "finish_survey_server_lobby" }, "survey_completed");
          setStatus("browsing");
          setSurveyStatus("browsing");
          toast("You're back in the lobby — keep browsing 💚", { duration: 2000 });
          const target = `/event/${nextEventId}/lobby?postSurveyComplete=1`;
          trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_ROUTE_TAKEN, {
            platform: "web",
            session_id: sessionId,
            event_id: nextEventId,
            action: "lobby",
            route: "event_lobby",
            seconds_until_event_end: serverNext.secondsUntilEventEnd,
          });
          vdbgRedirect(target, "survey_finish_server_lobby", { sessionId, eventId: nextEventId, lobbyRefresh: true });
          navigate(target, { state: { lobbyRefresh: true } });
          return;
        }

        if (serverNext.action === "wrap_up") {
          trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_ROUTE_TAKEN, {
            platform: "web",
            session_id: sessionId,
            event_id: nextEventId,
            action: "event_ended",
            route: "event_ended_modal",
            reason_code: serverNext.reason,
          });
          setStatus("offline");
          setShowEventEnded(true);
          return;
        }

        if (serverNext.action === "home") {
          vdbgRedirect("/home", "survey_finish_server_home", { sessionId });
          navigate("/home");
          return;
        }
      }

      const active = await checkEventActive();
      if (queuedNavigationStartedRef.current) return;

      if (active) {
        const nextAction = isPostDateEventNearlyOver(secondsUntilEventEnd) ? "last_chance" : "fresh_deck";
        trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_NEXT_ACTION_DECIDED, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId,
          action: nextAction,
          source: "survey_finish_event_active",
          queued_count: queuedCount,
          seconds_until_event_end: secondsUntilEventEnd,
        });
        trackEvent(LobbyPostDateEvents.SURVEY_NEXT_GATE_CHECK_RESULT, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId,
          source_surface: "post_date_survey",
          source_action: "survey_finish_event_active",
          outcome: "no_op",
          reason_code: nextAction,
          queued_count: queuedCount,
          seconds_until_event_end: secondsUntilEventEnd,
        });
        logJourney("survey_completed", { source: "finish_survey_active_event" }, "survey_completed");
        trackEvent(LobbyPostDateEvents.POST_DATE_SURVEY_COMPLETE_RETURN, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId,
          destination: "lobby",
        });
        setStatus("browsing");
        setSurveyStatus("browsing");
        toast("You're back in the lobby — keep browsing 💚", { duration: 2000 });
        if (eventId) {
          const target = `/event/${eventId}/lobby?postSurveyComplete=1`;
          trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_ROUTE_TAKEN, {
            platform: "web",
            session_id: sessionId,
            event_id: eventId,
            action: nextAction,
            route: "event_lobby",
            queued_count: queuedCount,
            seconds_until_event_end: secondsUntilEventEnd,
          });
          vdbgRedirect(target, "survey_finish", { sessionId, eventId, lobbyRefresh: true });
          navigate(target, { state: { lobbyRefresh: true } });
        } else {
          trackEvent(LobbyPostDateEvents.POST_DATE_SURVEY_COMPLETE_RETURN, {
            platform: "web",
            session_id: sessionId,
            event_id: eventId,
            destination: "home",
          });
          trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_ROUTE_TAKEN, {
            platform: "web",
            session_id: sessionId,
            event_id: eventId,
            action: "home",
            route: "home",
          });
          vdbgRedirect("/home", "survey_finish", { sessionId });
          navigate("/home");
        }
      } else {
        trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_NEXT_ACTION_DECIDED, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId,
          action: "event_ended",
          source: "survey_finish_event_inactive",
          queued_count: queuedCount,
          seconds_until_event_end: secondsUntilEventEnd,
        });
        trackEvent(LobbyPostDateEvents.SURVEY_NEXT_GATE_CHECK_RESULT, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId,
          source_surface: "post_date_survey",
          source_action: "survey_finish_event_inactive",
          outcome: "blocked",
          reason_code: "event_ended",
          queued_count: queuedCount,
          seconds_until_event_end: secondsUntilEventEnd,
        });
        trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_ROUTE_TAKEN, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId,
          action: "event_ended",
          route: "event_ended_modal",
        });
        trackEvent(LobbyPostDateEvents.POST_DATE_SURVEY_COMPLETE_RETURN, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId,
          destination: "offline",
        });
        setStatus("offline");
        setShowEventEnded(true);
      }
    } finally {
      if (!queuedNavigationStartedRef.current) {
        finishSurveyInFlightRef.current = false;
        setIsFinishingSurvey(false);
      }
    }
  }, [
    navigate,
    eventId,
    sessionId,
    partnerId,
    setStatus,
    checkEventActive,
    logJourney,
    isDraining,
    continuityDecision.action,
    queuedCount,
    secondsUntilEventEnd,
  ]);

  // Screen 1: Verdict (mandatory) — single backend path (RPC via Edge: persist + mutual match + server push when new match)
  const handleVerdict = useCallback(
    async (liked: boolean) => {
      if (!user?.id || isSubmitting) return;
      const previousStep = step;
      const optimisticStep: SurveyStep = liked ? "awaiting_partner" : "highlights";
      let optimisticallyAdvanced = false;
      setIsSubmitting(true);
      setVerdictError(null);
      setVerdictRetryable(false);
      setLastVerdictAttempt(liked);
      if (postDateInstantNextV2.enabled) {
        setStep(optimisticStep);
        optimisticallyAdvanced = true;
        trackEvent("post_date_verdict_optimistic_started", {
          platform: "web",
          session_id: sessionId,
          event_id: eventId,
          verdict: liked ? "vibe" : "pass",
          optimistic_step: optimisticStep,
        });
      }

      trackEvent(
        liked ? LobbyPostDateEvents.KEEP_THE_VIBE_YES_TAP : LobbyPostDateEvents.KEEP_THE_VIBE_NO_TAP,
        {
          platform: "web",
          session_id: sessionId,
          event_id: eventId,
        }
      );

      try {
        const result = await submitWebPostDateOutboxItem({
          userId: user.id,
          sessionId,
          eventId,
          payload: {
            kind: "verdict",
            liked,
            backendVersion: submitVerdictV3.enabled ? "v3" : "v2",
          },
        });

        if (result && result.success === false) {
          const code = result.code ?? result.error;
          trackEvent(LobbyPostDateEvents.POST_DATE_VERDICT_SUBMIT_FAILED, {
            platform: "web",
            session_id: sessionId,
            event_id: eventId,
            reason: code,
          });
          setVerdictRetryable(!["blocked_pair", "not_participant", "session_not_found"].includes(String(code)));
          setVerdictError(
            code === "blocked_pair"
              ? "You can't submit feedback for this date."
              : code === "not_participant"
              ? "You can't submit feedback for this date."
              : code === "session_not_found"
                ? "This date session is no longer available."
                : "Something went wrong. Please try again.",
          );
          if (postDateInstantNextV2.enabled) {
            if (optimisticallyAdvanced) setStep(previousStep);
            trackEvent("post_date_verdict_optimistic_rollback", {
              platform: "web",
              session_id: sessionId,
              event_id: eventId,
              reason: code,
              rollback_step: previousStep,
            });
          }
          return;
        }
        if (postDateInstantNextV2.enabled) {
          trackEvent("post_date_verdict_optimistic_confirmed", {
            platform: "web",
            session_id: sessionId,
            event_id: eventId,
            verdict: liked ? "vibe" : "pass",
          });
        }

        trackEvent(LobbyPostDateEvents.POST_DATE_SURVEY_SUBMIT, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId,
          verdict: liked ? "vibe" : "pass",
        });
        trackEvent(LobbyPostDateEvents.VIDEO_DATE_SURVEY_SUBMITTED, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId,
          verdict: liked ? "vibe" : "pass",
        });
        logJourney("survey_completed", { source: "verdict_submitted", verdict: liked ? "vibe" : "pass" }, "survey_completed");

        trackEvent(LobbyPostDateEvents.MUTUAL_VIBE_OUTCOME, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId,
          outcome: result?.mutual ? "mutual" : "not_mutual",
        });

        if (result?.partner_verdict_recorded && !result?.awaiting_partner_verdict) {
          trackEvent(LobbyPostDateEvents.POST_DATE_PENDING_VERDICT_COMPLETED, {
            platform: "web",
            session_id: sessionId,
            event_id: eventId,
            outcome: result?.mutual ? "mutual" : "not_mutual",
          });
        }

        if (result?.mutual) {
          setVerdictRetryable(false);
          setStep("celebration");
          if (navigator.vibrate) {
            navigator.vibrate([50, 100, 50, 100, 100]);
          }
        } else if (result?.awaiting_partner_verdict) {
          setVerdictRetryable(false);
          trackEvent(LobbyPostDateEvents.POST_DATE_VERDICT_PENDING_PARTNER, {
            platform: "web",
            session_id: sessionId,
            event_id: eventId,
          });
          trackEvent(LobbyPostDateEvents.POST_DATE_HALF_VERDICT_SAVED, {
            platform: "web",
            session_id: sessionId,
            event_id: eventId,
          });
          trackEvent(LobbyPostDateEvents.POST_DATE_HALF_VERDICT_PENDING, {
            platform: "web",
            session_id: sessionId,
            event_id: eventId,
          });
          setStep("awaiting_partner");
        } else {
          setVerdictRetryable(false);
          setStep("highlights");
        }
      } catch (err) {
        console.error("Error recording verdict:", err);
        setVerdictRetryable(true);
        setVerdictError("Couldn't save your answer. Tap to retry.");
        if (postDateInstantNextV2.enabled) {
          if (optimisticallyAdvanced) setStep(previousStep);
          trackEvent("post_date_verdict_optimistic_rollback", {
            platform: "web",
            session_id: sessionId,
            event_id: eventId,
            reason: "exception",
            rollback_step: previousStep,
          });
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [user?.id, sessionId, eventId, isSubmitting, logJourney, postDateInstantNextV2.enabled, submitVerdictV3.enabled, step]
  );

  const recordReportPassVerdict = useCallback(
    async (report?: PostDateSafetyReportPayload | null) => {
      if (!user?.id || reportPassVerdictSavedRef.current) return true;
      const result = await submitWebPostDateOutboxItem({
        userId: user.id,
        sessionId,
        eventId,
        payload: {
          kind: "verdict",
          liked: false,
          report: report ?? null,
          backendVersion: submitVerdictV3.enabled ? "v3" : "v2",
        },
      });
      if (result.success === false) {
        trackEvent(LobbyPostDateEvents.POST_DATE_VERDICT_SUBMIT_FAILED, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId,
          reason: result.code ?? result.error ?? "report_pass_verdict_failed",
        });
        return false;
      }
      reportPassVerdictSavedRef.current = true;
      trackEvent(LobbyPostDateEvents.POST_DATE_SURVEY_SUBMIT, {
        platform: "web",
        session_id: sessionId,
        event_id: eventId,
        verdict: "pass",
        source: "report_before_verdict",
      });
      return true;
    },
    [eventId, sessionId, submitVerdictV3.enabled, user?.id],
  );

  // Screen 2: Highlights (optional)
  const handleHighlights = useCallback(
    async (data: {
      tagChemistry: boolean;
      tagFun: boolean;
      tagSmart: boolean;
      tagRespectful: boolean;
      energy: string | null;
      conversationFlow: string | null;
    }) => {
      if (!user?.id) return;

      try {
        await supabase.rpc("update_post_date_feedback_details", {
          p_session_id: sessionId,
          p_patch: {
            tag_chemistry: data.tagChemistry,
            tag_fun: data.tagFun,
            tag_smart: data.tagSmart,
            tag_respectful: data.tagRespectful,
            energy: data.energy,
            conversation_flow: data.conversationFlow,
          },
        });
      } catch (err) {
        console.error("Error saving highlights:", err);
      }

      setStep("safety");
    },
    [user?.id, sessionId]
  );

  // Screen 3: Safety (optional)
  const handleSafety = useCallback(
    async (data: { photoAccurate: string | null; honestRepresentation: string | null }) => {
      if (!user?.id) return;

      if (reportBeforeVerdictRef.current && !reportPassVerdictSavedRef.current) {
        const ok = await recordReportPassVerdict(null);
        if (!ok) {
          toast.error("Couldn't save your answer. Check your connection and try again.");
          return;
        }
      }

      try {
        await supabase.rpc("update_post_date_feedback_details", {
          p_session_id: sessionId,
          p_patch: {
            photo_accurate: data.photoAccurate,
            honest_representation: data.honestRepresentation,
          },
        });
      } catch (err) {
        console.error("Error saving safety data:", err);
      }

      await finishSurvey();
    },
    [user?.id, sessionId, finishSurvey, recordReportPassVerdict]
  );

  const handleReport = useCallback(
    async (reason: string, details: string, alsoBlock: boolean) => {
      if (!user?.id) return;

      const mapped = mapPostDateSafetyCategoryToReasonId(reason);
      const reportPayload: PostDateSafetyReportPayload = {
        reason: mapped,
        details: details || null,
        alsoBlock,
      };
      const result = reportBeforeVerdictRef.current && !reportPassVerdictSavedRef.current
        ? await submitWebPostDateOutboxItem({
            userId: user.id,
            sessionId,
            eventId,
            payload: {
              kind: "verdict",
              liked: false,
              report: reportPayload,
              backendVersion: submitVerdictV3.enabled ? "v3" : "v2",
            },
          })
        : await submitWebPostDateOutboxItem({
            userId: user.id,
            sessionId,
            eventId,
            payload: { kind: "report", report: reportPayload },
          });
      if (result.success === false) {
        if (result.error === "rate_limited" || result.code === "rate_limited") {
          toast.error("Too many reports in a short time. Try again later.");
        } else {
          toast.error("Failed to submit report.");
        }
        return;
      }
      if (reportBeforeVerdictRef.current) {
        reportPassVerdictSavedRef.current = true;
      }
      toast.success(
        alsoBlock
          ? "Report submitted and user blocked. We'll review it promptly."
          : "Report submitted. We'll review it promptly."
      );
    },
    [user?.id, sessionId, eventId, submitVerdictV3.enabled]
  );

  const handleReportFromVerdict = useCallback(() => {
    reportBeforeVerdictRef.current = true;
    setStep("safety");
  }, []);

  if (!isOpen) return null;

  if (showEventEnded) {
    return <EventEndedModal isOpen={true} />;
  }

  // Celebration step: use the full-screen polished modal wired to real production data.
  // onClose → continue to highlights; onStartChatting → go directly to chat.
  if (step === "celebration") {
    return (
      <MatchSuccessModal
        isOpen={true}
        onClose={() => setStep("highlights")}
        onStartChatting={() => {
          logJourney("chat_cta_pressed", { source: "survey_celebration", other_profile_id: partnerId });
          navigate(`/chat/${partnerId}`);
        }}
        isMatchDataLoading={!celebrationData}
        matchData={{
          name: partnerName,
          age: celebrationData?.partnerAge,
          avatar: partnerImage,
          sharedVibes: celebrationData?.sharedVibes ?? [],
          // vibeScore intentionally omitted — no authoritative backend field without schema changes
        }}
        userData={{
          name: user?.name ?? "You",
          avatar: user?.avatarUrl ?? "",
        }}
      />
    );
  }

  const surveyProgressSteps = ["verdict", "highlights", "safety"] as const;
  const currentProgressIndex =
    step === "awaiting_partner"
      ? 0
      : Math.max(0, surveyProgressSteps.indexOf(step as (typeof surveyProgressSteps)[number]));

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto px-4 py-4 sm:py-6"
        style={{
          minHeight: "100dvh",
          paddingTop: "max(1rem, env(safe-area-inset-top))",
          paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
        }}
      >
        <motion.div
          initial={{ backdropFilter: "blur(0px)" }}
          animate={{ backdropFilter: "blur(24px)" }}
          className="absolute inset-0 bg-[linear-gradient(180deg,hsl(var(--background)/0.96),hsl(var(--background)/0.9)_48%,hsl(var(--background)/0.98))]"
        />

        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 30 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="relative z-10 w-full max-w-[26.5rem]"
        >
          <div className="mb-3 flex justify-center gap-2" aria-label="Post-date check-in progress">
            {surveyProgressSteps.map((s, i) => (
              <div
                key={s}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
                  i === currentProgressIndex
                    ? "w-10 bg-gradient-to-r from-primary to-accent shadow-[0_0_18px_hsl(var(--primary)/0.45)]"
                    : i < currentProgressIndex
                      ? "w-5 bg-primary/45"
                      : "w-5 bg-white/[0.08]",
                )}
              />
            ))}
          </div>

          <PostDateContinuityStrip decision={continuityDecision} />

          <div className="relative overflow-hidden rounded-[2rem] border border-white/[0.12] bg-[linear-gradient(180deg,hsl(var(--card)/0.9),hsl(var(--background)/0.96))] p-5 shadow-[0_28px_90px_-38px_rgba(0,0,0,0.95),0_0_48px_-30px_hsl(var(--primary)/0.7)] backdrop-blur-2xl sm:p-6">
            <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/35 to-transparent" />
            <AnimatePresence mode="wait">
              {step === "verdict" && (
                <motion.div key="verdict" className="space-y-3">
                  <VerdictScreen
                    partnerName={partnerName}
                    partnerImage={partnerImage}
                    onVerdict={handleVerdict}
                    onReport={handleReportFromVerdict}
                    isSubmitting={isSubmitting}
                  />
                  {microVerdictV2.enabled && (
                    <p className="text-center text-xs leading-relaxed text-white/[0.5]" aria-live="polite">
                      {getVideoDateMicroVerdictCopy(microVerdictRemainingSeconds)}
                    </p>
                  )}
                  {verdictError && (
                    <div
                      role="alert"
                      className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-center text-sm text-destructive"
                    >
                      <p>{verdictError}</p>
                      {verdictRetryable && lastVerdictAttempt !== null && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isSubmitting}
                          onClick={() => {
                            trackEvent(LobbyPostDateEvents.POST_DATE_VERDICT_SUBMIT_RETRY, {
                              platform: "web",
                              session_id: sessionId,
                              event_id: eventId,
                            });
                            void handleVerdict(lastVerdictAttempt);
                          }}
                          className="h-8 rounded-full border-destructive/40 bg-background/80 text-xs text-foreground hover:bg-background"
                        >
                          Try again
                        </Button>
                      )}
                    </div>
                  )}
                  {isSubmitting && (
                    <p className="text-center text-xs text-muted-foreground">Saving your answer...</p>
                  )}
                </motion.div>
              )}

              {step === "awaiting_partner" && (
                <motion.div
                  key="awaiting_partner"
                  initial={{ opacity: 0, x: 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -40 }}
                  className="flex flex-col items-center space-y-5 py-6 text-center"
                >
                  <h2 className="text-xl font-display font-bold text-foreground">Awaiting your match&apos;s verdict</h2>
                  <p className="text-sm text-muted-foreground">
                    Your answer is saved. We&apos;ll only create a match if your date also vibes.
                  </p>
                  <Button type="button" onClick={() => setStep("highlights")} className="rounded-full px-6">
                    Continue
                  </Button>
                </motion.div>
              )}

              {step === "highlights" && (
                <HighlightsScreen
                  key="highlights"
                  onComplete={handleHighlights}
                  onSkip={() => {
                    trackEvent(LobbyPostDateEvents.POST_DATE_SURVEY_SKIP, {
                      platform: "web",
                      session_id: sessionId,
                      event_id: eventId,
                      step: "highlights",
                    });
                    setStep("safety");
                  }}
                />
              )}

              {step === "safety" && (
                <SafetyScreen
                  key="safety"
                  onComplete={handleSafety}
                  onSkip={() => {
                    if (isFinishingSurvey) return;
                    trackEvent(LobbyPostDateEvents.POST_DATE_SURVEY_SKIP, {
                      platform: "web",
                      session_id: sessionId,
                      event_id: eventId,
                      step: "safety",
                    });
                    void (async () => {
                      if (reportBeforeVerdictRef.current && !reportPassVerdictSavedRef.current) {
                        const ok = await recordReportPassVerdict(null);
                        if (!ok) {
                          toast.error("Couldn't save your answer. Check your connection and try again.");
                          return;
                        }
                      }
                      await finishSurvey();
                    })();
                  }}
                  onReport={handleReport}
                  isBusy={isFinishingSurvey}
                  pendingMessage={isFinishingSurvey || isDraining ? continuityDecision.message : undefined}
                />
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
