import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { VerdictScreen } from "./survey/VerdictScreen";
import { HighlightsScreen } from "./survey/HighlightsScreen";
import { SafetyScreen } from "./survey/SafetyScreen";
import { MutualMatchCelebration } from "./survey/MutualMatchCelebration";
import { EventEndedModal } from "@/components/events/EventEndedModal";
import { useAuth } from "@/contexts/AuthContext";
import { useEventStatus } from "@/hooks/useEventStatus";
import { useEventLifecycle } from "@/hooks/useEventLifecycle";
import { useMatchQueue } from "@/hooks/useMatchQueue";
import { supabase } from "@/integrations/supabase/client";
import { sendNotification } from "@/lib/notifications";
import { trackEvent } from "@/lib/analytics";

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
  const { user } = useAuth();
  const { setStatus } = useEventStatus({ eventId });
  const [step, setStep] = useState<SurveyStep>("verdict");
  const [feedbackId, setFeedbackId] = useState<string | null>(null);
  const [showEventEnded, setShowEventEnded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isParticipant1, setIsParticipant1] = useState(false);
  const [surveyStatus, setSurveyStatus] = useState<string>("in_survey");

  // Determine if current user is participant_1 or participant_2
  useEffect(() => {
    if (!sessionId || !user?.id) return;
    const detect = async () => {
      const { data } = await supabase
        .from("video_sessions")
        .select("participant_1_id")
        .eq("id", sessionId)
        .maybeSingle();
      if (data) setIsParticipant1(data.participant_1_id === user.id);
    };
    detect();
  }, [sessionId, user?.id]);

  const { checkEventActive } = useEventLifecycle({ eventId });

  // FIX 4 & 5: Queue drain with proper status tracking
  const handleQueueMatch = useCallback(
    (matchId: string, _queuePartnerId: string) => {
      toast("You have a match waiting! 💚", { duration: 2000 });
      if (eventId) {
        navigate(`/event/${eventId}/lobby?pendingMatch=${matchId}`);
      } else {
        navigate("/home");
      }
    },
    [navigate, eventId]
  );

  useMatchQueue({
    eventId,
    currentStatus: surveyStatus,
    onMatchReady: handleQueueMatch,
  });

  // FIX 3: Navigate to lobby, not event details
  const finishSurvey = useCallback(async () => {
    const active = await checkEventActive();

    if (active) {
      setStatus("browsing");
      setSurveyStatus("browsing");
      toast("Back in the mix! 💚", { duration: 2000 });
      if (eventId) {
        navigate(`/event/${eventId}/lobby`);
      } else {
        navigate("/home");
      }
    } else {
      setStatus("offline");
      setShowEventEnded(true);
    }
  }, [navigate, eventId, setStatus, checkEventActive]);

  // Screen 1: Verdict (mandatory)
  const handleVerdict = useCallback(
    async (liked: boolean) => {
      if (!user?.id || isSubmitting) return;
      setIsSubmitting(true);

      try {
        const likedField = isParticipant1 ? "participant_1_liked" : "participant_2_liked";
        await supabase
          .from("video_sessions")
          .update({ [likedField]: liked })
          .eq("id", sessionId);

        const { data: feedback, error } = await supabase
          .from("date_feedback")
          .upsert(
            {
              session_id: sessionId,
              user_id: user.id,
              target_id: partnerId,
              liked,
            },
            { onConflict: "session_id,user_id" }
          )
          .select("id")
          .single();

        if (error) throw error;
        if (feedback) setFeedbackId(feedback.id);

        trackEvent('post_date_survey_completed', { session_id: sessionId, verdict: liked ? 'vibe' : 'pass' });

        const { data: result } = await supabase.rpc("check_mutual_vibe_and_match", {
          p_session_id: sessionId,
        });

        if ((result as any)?.mutual) {
          setStep("celebration");
          if (navigator.vibrate) {
            navigator.vibrate([50, 100, 50, 100, 100]);
          }
          // Notify partner about mutual match
          sendNotification({
            user_id: partnerId,
            category: "new_match",
            title: "It's a match! 🎉",
            body: `You and ${partnerName} both vibed!`,
            data: { url: "/matches" },
          });
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
    [user?.id, sessionId, partnerId, isSubmitting, isParticipant1]
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
    async (reason: string, details: string) => {
      if (!user?.id) return;

      try {
        await supabase.from("user_reports").insert({
          reporter_id: user.id,
          reported_id: partnerId,
          reason,
          details: details || null,
        });
        toast.success("Report submitted. We'll review it promptly.");
      } catch (err) {
        console.error("Error submitting report:", err);
        toast.error("Failed to submit report.");
      }
    },
    [user?.id, partnerId]
  );

  const handleBlock = useCallback(async () => {
    if (!user?.id) return;

    try {
      await supabase.from("blocked_users").insert({
        blocker_id: user.id,
        blocked_id: partnerId,
      });
      toast.success("User blocked.");
    } catch (err) {
      console.error("Error blocking user:", err);
    }
  }, [user?.id, partnerId]);

  const handleReportFromVerdict = useCallback(() => {
    setStep("safety");
  }, []);

  if (!isOpen) return null;

  if (showEventEnded) {
    return <EventEndedModal isOpen={true} />;
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
                  step === s || (step === "celebration" && s === "verdict")
                    ? "w-8 bg-primary"
                    : i <
                      ["verdict", "highlights", "safety"].indexOf(
                        step === "celebration" ? "verdict" : step
                      )
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

              {step === "celebration" && (
                <MutualMatchCelebration
                  key="celebration"
                  partnerName={partnerName}
                  partnerImage={partnerImage}
                  onContinue={() => setStep("highlights")}
                />
              )}

              {step === "highlights" && (
                <HighlightsScreen
                  key="highlights"
                  onComplete={handleHighlights}
                  onSkip={() => setStep("safety")}
                />
              )}

              {step === "safety" && (
                <SafetyScreen
                  key="safety"
                  partnerId={partnerId}
                  onComplete={handleSafety}
                  onSkip={finishSurvey}
                  onReport={handleReport}
                  onBlock={handleBlock}
                />
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
