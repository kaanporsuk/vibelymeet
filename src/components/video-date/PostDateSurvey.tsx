import { useState, useCallback, useEffect, useRef } from "react";
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
  const [surveyStatus, setSurveyStatus] = useState<string>("in_survey");
  const loggedJourneyEventsRef = useRef<Set<string>>(new Set());
  const surveyShellImpressionRef = useRef(false);
  const verdictStepImpressionRef = useRef(false);

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

  // Data for the polished mutual-match celebration
  const [celebrationData, setCelebrationData] = useState<{
    partnerAge: number;
    sharedVibes: string[];
  } | null>(null);

  useEffect(() => {
    if (step !== "celebration" || !user?.id) return;
    let cancelled = false;

    const fetchCelebrationData = async () => {
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
    };

    fetchCelebrationData();
    return () => { cancelled = true; };
  }, [step, user?.id, partnerId]);

  const { checkEventActive } = useEventLifecycle({ eventId });

  /**
   * Post-date survey is intentionally anchored on `/date/:sessionId` (not lobby `useActiveSession`).
   * We still poll `drain_match_queue` here as a fallback when realtime lags — see `enableSurveyPhaseDrain`.
   */
  const handleQueueMatch = useCallback(
    (videoSessionId: string, _queuePartnerId: string) => {
      toast("Your next date is ready — head to the event lobby 💚", { duration: 2000 });
      if (eventId) {
        const target = buildEventLobbyPendingSessionUrl(eventId, videoSessionId);
        vdbgRedirect(target, "survey_queue_match_ready", { sessionId, eventId, pendingVideoSession: videoSessionId });
        navigate(target);
      } else {
        vdbgRedirect("/home", "survey_queue_match_ready", { sessionId, pendingVideoSession: videoSessionId });
        navigate("/home");
      }
    },
    [navigate, eventId, sessionId]
  );

  useMatchQueue({
    eventId,
    currentStatus: surveyStatus,
    enableSurveyPhaseDrain: true,
    onVideoSessionReady: handleQueueMatch,
  });

  const finishSurvey = useCallback(async () => {
    const active = await checkEventActive();

    if (active) {
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
        const target = `/event/${eventId}/lobby`;
        vdbgRedirect(target, "survey_finish", { sessionId, eventId, lobbyRefresh: true });
        navigate(target, { state: { lobbyRefresh: true } });
      } else {
        trackEvent(LobbyPostDateEvents.POST_DATE_SURVEY_COMPLETE_RETURN, {
          platform: "web",
          session_id: sessionId,
          event_id: eventId,
          destination: "home",
        });
        vdbgRedirect("/home", "survey_finish", { sessionId });
        navigate("/home");
      }
    } else {
      trackEvent(LobbyPostDateEvents.POST_DATE_SURVEY_COMPLETE_RETURN, {
        platform: "web",
        session_id: sessionId,
        event_id: eventId,
        destination: "offline",
      });
      setStatus("offline");
      setShowEventEnded(true);
    }
  }, [navigate, eventId, sessionId, setStatus, checkEventActive, logJourney]);

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

      finishSurvey();
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
        matchData={celebrationData ? {
          name: partnerName,
          age: celebrationData.partnerAge,
          avatar: partnerImage,
          sharedVibes: celebrationData.sharedVibes,
          // vibeScore intentionally omitted — no authoritative backend field without schema changes
        } : undefined}
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
                    trackEvent(LobbyPostDateEvents.POST_DATE_SURVEY_SKIP, {
                      platform: "web",
                      session_id: sessionId,
                      event_id: eventId,
                      step: "safety",
                    });
                    void finishSurvey();
                  }}
                  onReport={handleReport}
                />
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
