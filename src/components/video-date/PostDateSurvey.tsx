import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
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
import { useEventLifecycle } from "@/hooks/useEventLifecycle";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/analytics";
import { submitWebPostDateOutboxItem } from "@/lib/postDateOutbox/execute";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";
import type {
  PostDateOutboxResultPayload,
  PostDateSafetyReportPayload,
} from "@clientShared/postDateOutbox/types";
import {
  getPostDateSurveyContinuityDecision,
  isPostDateEventNearlyOver,
  normalizeServerPostDateNextSurface,
  secondsUntilPostDateEventEnd,
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
import {
  createVideoDateSessionChannel,
  type VideoDateSessionBroadcastEvent,
} from "@clientShared/matching/videoDateSessionChannel";
import {
  POST_DATE_VERDICT_CONFIRM_TIMEOUT_MS,
  confirmationResultFromVerdictBroadcast,
  derivePostDateSurveyStepFromVerdict,
  isVideoDateVerdictConfirmEnabled,
  normalizePostDateVerdictConfirmationResult,
  type PostDateVerdictUiState,
} from "@clientShared/matching/postDateVerdictConfirmation";
import {
  canonicalVideoDateRouteLogDetail,
  decideCanonicalVideoDateRoute,
  webPathForCanonicalVideoDateRoute,
} from "@clientShared/matching/videoDateRouteDecision";

interface PostDateSurveyProps {
  isOpen: boolean;
  sessionId: string;
  partnerId: string;
  partnerName: string;
  partnerImage: string;
  eventId?: string;
}

type SurveyStep = "verdict" | "celebration" | "awaiting_partner" | "highlights" | "safety";

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
  const { user } = useUserProfile();
  const { setStatus } = useEventStatus({ eventId });
  const microVerdictV2 = useFeatureFlag("video_date.micro_verdict_v2");
  const submitVerdictV3 = useFeatureFlag("video_date.outbox_v2.submit_verdict");
  const verdictConfirmV2 = useFeatureFlag("video_date.verdict_confirm_v2");
  const verdictConfirmV1 = useFeatureFlag("video_date.verdict_confirm_v1");
  const [step, setStep] = useState<SurveyStep>("verdict");
  const [showEventEnded, setShowEventEnded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [verdictUiState, setVerdictUiState] = useState<PostDateVerdictUiState>("idle");
  const [verdictError, setVerdictError] = useState<string | null>(null);
  const [verdictRetryable, setVerdictRetryable] = useState(false);
  const [lastVerdictAttempt, setLastVerdictAttempt] = useState<boolean | null>(null);
  const [isFinishingSurvey, setIsFinishingSurvey] = useState(false);
  const [, setSurveyStatus] = useState<string>("in_survey");
  // Data for the polished mutual-match celebration
  const [celebrationData, setCelebrationData] = useState<{
    partnerAge: number;
    sharedVibes: string[];
  } | null>(null);
  const loggedJourneyEventsRef = useRef<Set<string>>(new Set());
  const surveyShellImpressionRef = useRef(false);
  const verdictStepImpressionRef = useRef(false);
  const finishSurveyInFlightRef = useRef(false);
  const reportBeforeVerdictRef = useRef(false);
  const reportPassVerdictSavedRef = useRef(false);
  const pendingVerdictConfirmRef = useRef<{
    minSessionSeq: number | null;
    resolve: (confirmedResult: unknown | null) => void;
  } | null>(null);
  const verdictConfirmTimeoutRef = useRef<number | null>(null);
  const highlightsSaveInFlightRef = useRef(false);
  const safetySaveInFlightRef = useRef(false);
  const safetyReportInFlightRef = useRef(false);
  const verdictOpenedAtMsRef = useRef(Date.now());
  const [microVerdictNowMs, setMicroVerdictNowMs] = useState(Date.now());
  const verdictConfirmEnabled = useMemo(
    () => isVideoDateVerdictConfirmEnabled(verdictConfirmV2, verdictConfirmV1),
    [verdictConfirmV1, verdictConfirmV2],
  );

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

  const clearVerdictConfirmTimeout = useCallback(() => {
    if (verdictConfirmTimeoutRef.current !== null) {
      window.clearTimeout(verdictConfirmTimeoutRef.current);
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
    const { data, error } = await supabase.rpc("resolve_post_date_next_surface", {
      p_session_id: sessionId,
    });
    const nextSurface = !error ? normalizeServerPostDateNextSurface(data) : null;
    if (!nextSurface || nextSurface.action === "survey") return null;
    const base = result && typeof result === "object" && !Array.isArray(result)
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
        verdictConfirmTimeoutRef.current = window.setTimeout(() => {
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

  const confirmActorFeedbackRow = useCallback(
    async (liked: boolean, source: string): Promise<boolean> => {
      if (!user?.id) return false;
      for (let attempt = 1; attempt <= 6; attempt += 1) {
        const { data, error } = await supabase
          .from("date_feedback")
          .select("session_id,user_id,liked,created_at")
          .eq("session_id", sessionId)
          .eq("user_id", user.id)
          .maybeSingle();
        if (!error && data && data.liked === liked) {
          return true;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 250 * attempt));
      }
      trackEvent(LobbyPostDateEvents.POST_DATE_VERDICT_SUBMIT_FAILED, {
        platform: "web",
        session_id: sessionId,
        event_id: eventId,
        reason: "date_feedback_row_missing_after_verdict",
        source,
      });
      return false;
    },
    [eventId, sessionId, user?.id],
  );

  const applyConfirmedVerdictStep = useCallback((result: unknown) => {
    const nextStep = derivePostDateSurveyStepFromVerdict(result);
    setVerdictUiState(nextStep === "awaiting_partner" ? "awaiting_partner" : "confirmed");
    setStep(nextStep);
    if (nextStep === "celebration" && navigator.vibrate) {
      navigator.vibrate([50, 100, 50, 100, 100]);
    }
  }, []);

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
    reportBeforeVerdictRef.current = false;
    reportPassVerdictSavedRef.current = false;
    highlightsSaveInFlightRef.current = false;
    safetySaveInFlightRef.current = false;
    safetyReportInFlightRef.current = false;
    setVerdictUiState("idle");
    setVerdictError(null);
    setVerdictRetryable(false);
    resolvePendingVerdictConfirm(null);
    setCelebrationData(null);
  }, [resolvePendingVerdictConfirm, sessionId]);

  useEffect(() => {
    if (!isOpen || !sessionId || !verdictConfirmEnabled) return undefined;
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
  }, [isOpen, resolvePendingVerdictConfirm, sessionId, verdictConfirmEnabled]);

  useEffect(() => {
    return () => {
      resolvePendingVerdictConfirm(null);
      clearVerdictConfirmTimeout();
    };
  }, [clearVerdictConfirmTimeout, resolvePendingVerdictConfirm]);

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

  const secondsUntilEventEnd = useMemo(
    () => secondsUntilPostDateEventEnd(eventEndsAt),
    [eventEndsAt]
  );

  const continuityDecision = useMemo(
    () =>
      getPostDateSurveyContinuityDecision({
        isSubmittingSurvey: isFinishingSurvey,
        eventActive: isEventActive,
        eventLifecycleResolved: isEventLifecycleResolved,
        secondsUntilEventEnd,
        hasEventId: Boolean(eventId),
      }),
    [eventId, isFinishingSurvey, isEventActive, isEventLifecycleResolved, secondsUntilEventEnd]
  );

  const finishSurvey = useCallback(async () => {
    if (finishSurveyInFlightRef.current) return;
    finishSurveyInFlightRef.current = true;
    setIsFinishingSurvey(true);
    trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_SURVEY_COMPLETE, {
      platform: "web",
      session_id: sessionId,
      event_id: eventId,
      decision_at_submit: continuityDecision.action,
      seconds_until_event_end: secondsUntilEventEnd,
    });
    try {
      const { data: nextData, error: nextError } = await supabase.rpc("resolve_post_date_next_surface", {
        p_session_id: sessionId,
      });
      const serverNext = normalizeServerPostDateNextSurface(nextData);
      if (!nextError && serverNext) {
        if (serverNext.action === "ready_gate" || serverNext.action === "video_date") {
          trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_NEXT_ACTION_DECIDED, {
            platform: "web",
            session_id: sessionId,
            event_id: serverNext.eventId ?? eventId,
            action: "fresh_deck",
            source: "survey_finish_server_continuity",
            reason_code: "removed_auto_next_target_ignored",
            removed_action: serverNext.action,
          });
        } else {
          const nextEventId = serverNext.eventId ?? eventId;
          const nextSessionId = serverNext.nextSessionId ?? serverNext.sessionId ?? sessionId;
          const canonicalNextRoute = decideCanonicalVideoDateRoute({
            sessionId: nextSessionId,
            eventId: nextEventId,
            truth: null,
            serverNextSurface: {
              ...serverNext,
              targetId: serverNext.targetId ?? partnerId,
            },
          });
          const canonicalNextLog = canonicalVideoDateRouteLogDetail(canonicalNextRoute, {
            sourceSurface: "post_date_survey",
            sourceAction: "survey_finish_server_continuity",
          });
          trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_NEXT_ACTION_DECIDED, {
            platform: "web",
            session_id: sessionId,
            event_id: nextEventId,
            action: serverNext.action,
            source: "survey_finish_server_continuity",
            reason_code: serverNext.reason,
            ...canonicalNextLog,
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

          if (canonicalNextRoute.target === "survey") {
            setStep("verdict");
            return;
          }

          if (canonicalNextRoute.target === "chat") {
            const target = webPathForCanonicalVideoDateRoute(canonicalNextRoute);
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

          if (canonicalNextRoute.target === "lobby" && nextEventId) {
            logJourney("survey_completed", { source: "finish_survey_server_lobby" }, "survey_completed");
            setStatus("browsing");
            setSurveyStatus("browsing");
            toast("You're back in the lobby — keep browsing 💚", { duration: 2000 });
            const target = `${webPathForCanonicalVideoDateRoute(canonicalNextRoute)}?postSurveyComplete=1`;
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

          if (canonicalNextRoute.target === "ended") {
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

          if (canonicalNextRoute.target === "home") {
            const target = webPathForCanonicalVideoDateRoute(canonicalNextRoute);
            vdbgRedirect(target, "survey_finish_server_home", { sessionId });
            navigate(target);
            return;
          }
        }
      }

      const active = await checkEventActive();

      if (active) {
        const nextAction = isPostDateEventNearlyOver(secondsUntilEventEnd) ? "last_chance" : "fresh_deck";
        trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_NEXT_ACTION_DECIDED, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId,
          action: nextAction,
          source: "survey_finish_event_active",
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
      finishSurveyInFlightRef.current = false;
      setIsFinishingSurvey(false);
    }
  }, [
    navigate,
    eventId,
    sessionId,
    partnerId,
    setStatus,
    checkEventActive,
    logJourney,
    continuityDecision.action,
    secondsUntilEventEnd,
  ]);

  // Screen 1: Verdict (mandatory) — single backend path (RPC via Edge: persist + mutual match + server push when new match)
  const handleVerdict = useCallback(
    async (liked: boolean) => {
      if (!user?.id || isSubmitting || verdictUiState === "submitting" || verdictUiState === "confirmed") return;
      setIsSubmitting(true);
      setVerdictUiState("submitting");
      setVerdictError(null);
      setVerdictRetryable(false);
      setLastVerdictAttempt(liked);

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
          setVerdictUiState("retryable_failed");
          return;
        }
        const confirmedResult = verdictConfirmEnabled ? await waitForVerdictConfirmation(result) : result;
        if (!confirmedResult) {
          setVerdictRetryable(true);
          setVerdictError("Couldn't confirm your answer. Tap to retry.");
          setVerdictUiState("retryable_failed");
          return;
        }
        const feedbackRowConfirmed = await confirmActorFeedbackRow(liked, "verdict_submitted");
        if (!feedbackRowConfirmed) {
          setVerdictRetryable(true);
          setVerdictError("Couldn't confirm your answer. Tap to retry.");
          setVerdictUiState("retryable_failed");
          return;
        }
        const confirmedVerdict = normalizePostDateVerdictConfirmationResult(confirmedResult);

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
          outcome: confirmedVerdict.mutual ? "mutual" : "not_mutual",
        });

        if (confirmedVerdict.partnerVerdictRecorded && !confirmedVerdict.awaitingPartnerVerdict) {
          trackEvent(LobbyPostDateEvents.POST_DATE_PENDING_VERDICT_COMPLETED, {
            platform: "web",
            session_id: sessionId,
            event_id: eventId,
            outcome: confirmedVerdict.mutual ? "mutual" : "not_mutual",
          });
        }

        if (confirmedVerdict.mutual) {
          setVerdictRetryable(false);
        } else if (confirmedVerdict.awaitingPartnerVerdict) {
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
        } else {
          setVerdictRetryable(false);
        }
        applyConfirmedVerdictStep(confirmedResult);
      } catch (err) {
        console.error("Error recording verdict:", err);
        setVerdictRetryable(true);
        setVerdictError("Couldn't save your answer. Tap to retry.");
        setVerdictUiState("retryable_failed");
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      user?.id,
      sessionId,
      eventId,
      isSubmitting,
      verdictUiState,
      logJourney,
      verdictConfirmEnabled,
      submitVerdictV3.enabled,
      waitForVerdictConfirmation,
      applyConfirmedVerdictStep,
      confirmActorFeedbackRow,
    ]
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
      if (verdictConfirmEnabled) {
        const confirmed = await waitForVerdictConfirmation(result);
        if (!confirmed) {
          trackEvent(LobbyPostDateEvents.POST_DATE_VERDICT_SUBMIT_FAILED, {
            platform: "web",
            session_id: sessionId,
            event_id: eventId,
            reason: "report_pass_confirmation_failed",
            source: "report_before_verdict",
          });
          return false;
        }
      }
      if (!(await confirmActorFeedbackRow(false, "report_before_verdict"))) {
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
    [
      confirmActorFeedbackRow,
      eventId,
      sessionId,
      submitVerdictV3.enabled,
      user?.id,
      verdictConfirmEnabled,
      waitForVerdictConfirmation,
    ],
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
      if (!user?.id || highlightsSaveInFlightRef.current) return;
      highlightsSaveInFlightRef.current = true;

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
      } finally {
        highlightsSaveInFlightRef.current = false;
      }

      setStep("safety");
    },
    [user?.id, sessionId]
  );

  // Screen 3: Safety (optional)
  const handleSafety = useCallback(
    async (data: { photoAccurate: string | null; honestRepresentation: string | null }) => {
      if (!user?.id || safetySaveInFlightRef.current || safetyReportInFlightRef.current) return;
      safetySaveInFlightRef.current = true;
      try {
        if (reportBeforeVerdictRef.current && !reportPassVerdictSavedRef.current) {
          const ok = await recordReportPassVerdict(null);
          if (!ok) {
            toast.error("Couldn't save your answer. Check your connection and try again.");
            return;
          }
        }
        await supabase.rpc("update_post_date_feedback_details", {
          p_session_id: sessionId,
          p_patch: {
            photo_accurate: data.photoAccurate,
            honest_representation: data.honestRepresentation,
          },
        });
        await finishSurvey();
      } catch (err) {
        console.error("Error saving safety data:", err);
      } finally {
        safetySaveInFlightRef.current = false;
      }
    },
    [user?.id, sessionId, finishSurvey, recordReportPassVerdict]
  );

  const handleReport = useCallback(
    async (reason: string, details: string, alsoBlock: boolean) => {
      if (!user?.id || safetyReportInFlightRef.current || safetySaveInFlightRef.current || isFinishingSurvey) return false;
      safetyReportInFlightRef.current = true;

      const mapped = mapPostDateSafetyCategoryToReasonId(reason);
      const reportPayload: PostDateSafetyReportPayload = {
        reason: mapped,
        details: details || null,
        alsoBlock,
      };

      try {
        const result: PostDateOutboxResultPayload = reportBeforeVerdictRef.current && !reportPassVerdictSavedRef.current
          ? await recordReportPassVerdict(reportPayload).then((ok) =>
              ok ? { success: true } : { success: false, error: "report_pass_verdict_failed" },
            )
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
          return false;
        }
        toast.success(
          alsoBlock
            ? "Report submitted and user blocked. We'll review it promptly."
            : "Report submitted. We'll review it promptly."
        );
        return true;
      } catch {
        toast.error("Failed to submit report.");
        return false;
      } finally {
        safetyReportInFlightRef.current = false;
      }
    },
    [user?.id, sessionId, eventId, isFinishingSurvey, recordReportPassVerdict]
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
                          disabled={isSubmitting || verdictUiState === "submitting"}
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
                  {(isSubmitting || verdictUiState === "submitting") && (
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
                    if (highlightsSaveInFlightRef.current) return;
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
                    if (isFinishingSurvey || safetySaveInFlightRef.current || safetyReportInFlightRef.current) return;
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
                  isBusy={isFinishingSurvey || safetySaveInFlightRef.current || safetyReportInFlightRef.current}
                  pendingMessage={isFinishingSurvey ? continuityDecision.message : undefined}
                />
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
