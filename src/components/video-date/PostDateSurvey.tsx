import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { vdbg, vdbgRedirect } from "@/lib/vdbg";

import { VerdictScreen } from "./survey/VerdictScreen";
import { HighlightsScreen } from "./survey/HighlightsScreen";
import { SafetyScreen } from "./survey/SafetyScreen";
import { EventEndedModal } from "@/components/events/EventEndedModal";
import MatchSuccessModal from "@/components/match/MatchSuccessModal";
import { useUserProfile } from "@/contexts/AuthContext";
import { useEventStatus } from "@/hooks/useEventStatus";
import { useEventLifecycle } from "@/hooks/useEventLifecycle";
import { useMatchQueue } from "@/hooks/useMatchQueue";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/analytics";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";
import { buildEventLobbyPendingSessionUrl } from "@shared/matching/videoSessionFlow";
import {
  getPostDateSurveyContinuityDecision,
  isPostDateEventNearlyOver,
  secondsUntilPostDateEventEnd,
  type PostDateContinuityDecision,
} from "@clientShared/matching/postDateContinuity";
import {
  getVideoDateJourneyEventName,
  type VideoDateJourneyEvent,
} from "@clientShared/matching/videoDateDiagnostics";
import {
  mapPostDateSafetyCategoryToReasonId,
  submitUserReportRpc,
} from "@clientShared/safety/submitUserReportRpc";

interface PostDateSurveyProps {
  isOpen: boolean;
  sessionId: string;
  partnerId: string;
  partnerName: string;
  partnerImage: string;
  eventId?: string;
}

type SurveyStep = "verdict" | "celebration" | "highlights" | "safety";
const SURVEY_DRAIN_SOFT_WAIT_MS = 1800;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PostDateContinuityStrip = ({ decision }: { decision: PostDateContinuityDecision }) => {
  const toneClass =
    decision.tone === "ready"
      ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
      : decision.tone === "last_chance"
        ? "border-amber-400/30 bg-amber-500/10 text-amber-100"
        : decision.tone === "ended"
          ? "border-white/15 bg-white/[0.06] text-white/70"
          : "border-white/12 bg-white/[0.05] text-white/75";

  return (
    <div className={`mb-3 rounded-2xl border px-3.5 py-3 ${toneClass}`} aria-live="polite">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-35" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-current opacity-80" />
        </span>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">{decision.title}</p>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-white/55">{decision.message}</p>
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
  const [step, setStep] = useState<SurveyStep>("verdict");
  const [showEventEnded, setShowEventEnded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
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

  useEffect(() => {
    if (!isOpen || !sessionId) return;
    if (surveyShellImpressionRef.current) return;
    surveyShellImpressionRef.current = true;
    trackEvent(LobbyPostDateEvents.POST_DATE_SURVEY_IMPRESSION, {
      platform: "web",
      session_id: sessionId,
      event_id: eventId,
    });
  }, [isOpen, sessionId, eventId]);

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
    setCelebrationData(null);
  }, [sessionId]);

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

  const { isEventActive, eventEndsAt, checkEventActive } = useEventLifecycle({ eventId });

  /**
   * Post-date survey is intentionally anchored on `/date/:sessionId` (not lobby `useActiveSession`).
   * We still poll `drain_match_queue` here as a fallback when realtime lags — see `enableSurveyPhaseDrain`.
   */
  const secondsUntilEventEnd = useMemo(
    () => secondsUntilPostDateEventEnd(eventEndsAt),
    [eventEndsAt]
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
      toast("Your next date is ready — head to the event lobby 💚", { duration: 2000 });
      if (eventId) {
        const target = `${buildEventLobbyPendingSessionUrl(eventId, videoSessionId)}&postSurveyComplete=1`;
        trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_ROUTE_TAKEN, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId,
          action: "ready_gate",
          route: "event_lobby_pending_ready_gate",
          video_session_id: videoSessionId,
        });
        vdbgRedirect(target, "survey_queue_match_ready", { sessionId, eventId, pendingVideoSession: videoSessionId });
        navigate(target);
      } else {
        trackEvent(LobbyPostDateEvents.POST_DATE_CONTINUITY_ROUTE_TAKEN, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId,
          action: "home",
          route: "home",
          video_session_id: videoSessionId,
        });
        vdbgRedirect("/home", "survey_queue_match_ready", { sessionId, pendingVideoSession: videoSessionId });
        navigate("/home");
      }
    },
    [navigate, eventId, sessionId]
  );

  const { queuedCount, isDraining } = useMatchQueue({
    eventId,
    currentStatus: surveyStatus,
    enableSurveyPhaseDrain: true,
    onVideoSessionReady: handleQueueMatch,
  });

  const continuityDecision = useMemo(
    () =>
      getPostDateSurveyContinuityDecision({
        isDrainingQueue: isDraining,
        queuedCount,
        isSubmittingSurvey: isFinishingSurvey,
        eventActive: isEventActive,
        secondsUntilEventEnd,
        hasEventId: Boolean(eventId),
      }),
    [eventId, isDraining, queuedCount, isFinishingSurvey, isEventActive, secondsUntilEventEnd]
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
      setIsSubmitting(true);

      trackEvent(
        liked ? LobbyPostDateEvents.KEEP_THE_VIBE_YES_TAP : LobbyPostDateEvents.KEEP_THE_VIBE_NO_TAP,
        {
          platform: "web",
          session_id: sessionId,
          event_id: eventId,
        }
      );

      try {
        const { data, error } = await supabase.functions.invoke("post-date-verdict", {
          body: { session_id: sessionId, liked },
        });

        if (error) throw error;

        const result = data as {
          success?: boolean;
          error?: string;
          code?: string;
          mutual?: boolean;
          verdict_recorded?: boolean;
        } | null;

        if (result && result.success === false) {
          const code = result.code ?? result.error;
          toast.error(
            code === "blocked_pair"
              ? "You can't submit feedback for this date."
              : code === "not_participant"
              ? "You can't submit feedback for this date."
              : code === "session_not_found"
                ? "This date session is no longer available."
                : "Something went wrong. Please try again.",
          );
          return;
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

        if (result?.mutual) {
          setStep("celebration");
          if (navigator.vibrate) {
            navigator.vibrate([50, 100, 50, 100, 100]);
          }
        } else {
          setStep("highlights");
        }
      } catch (err) {
        console.error("Error recording verdict:", err);
        toast.error("Something went wrong. Please try again.");
      } finally {
        setIsSubmitting(false);
      }
    },
    [user?.id, sessionId, eventId, isSubmitting, logJourney]
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
        await supabase
          .from("date_feedback")
          .update({
            tag_chemistry: data.tagChemistry,
            tag_fun: data.tagFun,
            tag_smart: data.tagSmart,
            tag_respectful: data.tagRespectful,
            energy: data.energy,
            conversation_flow: data.conversationFlow,
          })
          .eq("session_id", sessionId)
          .eq("user_id", user.id);
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

      try {
        await supabase
          .from("date_feedback")
          .update({
            photo_accurate: data.photoAccurate,
            honest_representation: data.honestRepresentation,
          })
          .eq("session_id", sessionId)
          .eq("user_id", user.id);
      } catch (err) {
        console.error("Error saving safety data:", err);
      }

      await finishSurvey();
    },
    [user?.id, sessionId, finishSurvey]
  );

  const handleReport = useCallback(
    async (reason: string, details: string, alsoBlock: boolean) => {
      if (!user?.id) return;

      const mapped = mapPostDateSafetyCategoryToReasonId(reason);
      const result = await submitUserReportRpc(supabase, {
        reportedId: partnerId,
        reason: mapped,
        details: details || null,
        alsoBlock,
      });
      if (!result.ok) {
        if ("error" in result && result.error === "rate_limited") {
          toast.error("Too many reports in a short time. Try again later.");
        } else {
          toast.error("Failed to submit report.");
        }
        return;
      }
      toast.success(
        alsoBlock
          ? "Report submitted and user blocked. We'll review it promptly."
          : "Report submitted. We'll review it promptly."
      );
    },
    [user?.id, partnerId]
  );

  const handleReportFromVerdict = useCallback(() => {
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

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto py-6"
      >
        <motion.div
          initial={{ backdropFilter: "blur(0px)" }}
          animate={{ backdropFilter: "blur(24px)" }}
          className="absolute inset-0 bg-background/90"
        />

        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 30 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="relative z-10 w-full max-w-md mx-4"
        >
          <div className="flex justify-center gap-2 mb-4">
            {["verdict", "highlights", "safety"].map((s, i) => (
              <div
                key={s}
                className={`h-1.5 rounded-full transition-all ${
                  step === s
                    ? "w-8 bg-primary"
                    : i <
                      ["verdict", "highlights", "safety"].indexOf(step)
                    ? "w-4 bg-primary/40"
                    : "w-4 bg-secondary/50"
                }`}
              />
            ))}
          </div>

          <PostDateContinuityStrip decision={continuityDecision} />

          <div className="glass-card p-6 overflow-hidden">
            <AnimatePresence mode="wait">
              {step === "verdict" && (
                <VerdictScreen
                  key="verdict"
                  partnerName={partnerName}
                  partnerImage={partnerImage}
                  onVerdict={handleVerdict}
                  onReport={handleReportFromVerdict}
                />
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
                    void finishSurvey();
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
