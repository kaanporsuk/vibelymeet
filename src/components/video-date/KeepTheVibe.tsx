import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Clock, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { VideoDateExtendOutcome } from "@clientShared/matching/videoDateExtensionSpend";
import { trackEvent } from "@/lib/analytics";
import {
  LobbyPostDateEvents,
  bucketCreditsRemaining,
} from "@clientShared/analytics/lobbyToPostDateJourney";

interface KeepTheVibeProps {
  extraTimeCredits: number;
  extendedVibeCredits: number;
  onExtend: (minutes: number, type: "extra_time" | "extended_vibe") => Promise<VideoDateExtendOutcome>;
  analyticsSessionId: string | undefined;
  analyticsEventId: string | undefined;
}

export const KeepTheVibe = ({
  extraTimeCredits,
  extendedVibeCredits,
  onExtend,
  analyticsSessionId,
  analyticsEventId,
}: KeepTheVibeProps) => {
  const [isExtending, setIsExtending] = useState(false);
  const hasCredits = extraTimeCredits > 0 || extendedVibeCredits > 0;
  const creditsSum = extraTimeCredits + extendedVibeCredits;
  const creditsState = bucketCreditsRemaining(creditsSum);

  const withCreditsImpRef = useRef(false);
  const noCreditsImpRef = useRef(false);

  useEffect(() => {
    if (!analyticsSessionId) return;
    if (hasCredits) {
      if (withCreditsImpRef.current) return;
      withCreditsImpRef.current = true;
      trackEvent(LobbyPostDateEvents.EXTEND_DATE_CTA_IMPRESSION, {
        platform: "web",
        session_id: analyticsSessionId,
        event_id: analyticsEventId,
        credits_state: creditsState,
      });
    } else {
      if (noCreditsImpRef.current) return;
      noCreditsImpRef.current = true;
      trackEvent(LobbyPostDateEvents.EXTEND_DATE_NO_CREDITS_IMPRESSION, {
        platform: "web",
        session_id: analyticsSessionId,
        event_id: analyticsEventId,
        credits_state: creditsState,
      });
    }
  }, [analyticsEventId, analyticsSessionId, creditsState, hasCredits]);

  useEffect(() => {
    withCreditsImpRef.current = false;
    noCreditsImpRef.current = false;
  }, [analyticsSessionId]);

  const handleExtend = async (minutes: number, type: "extra_time" | "extended_vibe") => {
    if (isExtending) return;
    setIsExtending(true);

    trackEvent(LobbyPostDateEvents.EXTEND_DATE_CTA_TAP, {
      platform: "web",
      session_id: analyticsSessionId,
      event_id: analyticsEventId,
      cta_name: type === "extra_time" ? "extra_time" : "extended_vibe",
      credits_state: creditsState,
    });

    const outcome = await onExtend(minutes, type);
    if (outcome.ok === true) {
      trackEvent(LobbyPostDateEvents.EXTEND_DATE_SUCCESS, {
        platform: "web",
        session_id: analyticsSessionId,
        event_id: analyticsEventId,
        credit_type: type,
        minutes_added: outcome.minutesAdded ?? minutes,
        credits_state: bucketCreditsRemaining(Math.max(0, creditsSum - 1)),
      });
      const minutesLabel = Number.isInteger(outcome.minutesAdded)
        ? String(outcome.minutesAdded)
        : outcome.minutesAdded.toFixed(1);
      toast.success(
        `${minutesLabel} extra ${outcome.minutesAdded === 1 ? "minute" : "minutes"} added!`,
        { duration: 2500 },
      );
    } else if (outcome.ok === false) {
      trackEvent(LobbyPostDateEvents.EXTEND_DATE_FAILURE, {
        platform: "web",
        session_id: analyticsSessionId,
        event_id: analyticsEventId,
        reason: outcome.silent ? "silent" : "spend_failed",
      });
      if (!outcome.silent && outcome.userMessage) {
        toast.error(outcome.userMessage);
      }
    }

    setIsExtending(false);
  };

  const handleGetCreditsTap = () => {
    trackEvent(LobbyPostDateEvents.EXTEND_DATE_CTA_TAP, {
      platform: "web",
      session_id: analyticsSessionId,
      event_id: analyticsEventId,
      cta_name: "get_credits",
      credits_state: creditsState,
    });
    window.open("/credits", "_blank");
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-2"
    >
      {hasCredits ? (
        <div className="flex items-center gap-1.5">
          <AnimatePresence>
            {extraTimeCredits > 0 && (
              <motion.button
                key="extra-time"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                whileTap={{ scale: 0.9 }}
                disabled={isExtending}
                onClick={() => handleExtend(2, "extra_time")}
                aria-label={`Add 2 minutes with Extra Time credit, ${extraTimeCredits} remaining`}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-card/70 backdrop-blur-md border border-white/10 text-xs font-medium text-foreground hover:bg-card/90 transition-colors disabled:opacity-50"
              >
                {isExtending ? (
                  <Loader2 className="w-3 h-3 text-primary animate-spin" aria-hidden />
                ) : (
                  <Clock className="w-3 h-3 text-primary" />
                )}
                +2 min
                <span className="text-muted-foreground">({extraTimeCredits})</span>
              </motion.button>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {extendedVibeCredits > 0 && (
              <motion.button
                key="extended-vibe"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                whileTap={{ scale: 0.9 }}
                disabled={isExtending}
                onClick={() => handleExtend(5, "extended_vibe")}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-card/70 backdrop-blur-md border border-white/10 text-xs font-medium text-foreground hover:bg-card/90 transition-colors disabled:opacity-50"
              >
                {isExtending ? (
                  <Loader2 className="w-3 h-3 text-accent animate-spin" aria-hidden />
                ) : (
                  <Sparkles className="w-3 h-3 text-accent" />
                )}
                +5 min
                <span className="text-muted-foreground">({extendedVibeCredits})</span>
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1 max-w-[220px]">
          <p className="text-[9px] text-muted-foreground text-center leading-snug">
            Extra Time adds <span className="text-foreground/90 font-medium">+2 min</span>. Extended Vibe adds{" "}
            <span className="text-foreground/90 font-medium">+5 min</span>.
          </p>
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={handleGetCreditsTap}
            aria-label="Get video date credits (opens in a new tab)"
            className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-card/70 backdrop-blur-md border border-primary/30 text-xs font-medium text-foreground hover:bg-card/90 transition-colors"
          >
            <Sparkles className="w-3 h-3 text-primary" />
            Get Credits
          </motion.button>
          <span className="text-[9px] text-muted-foreground text-center">Opens in a new tab — your date continues</span>
        </div>
      )}
    </motion.div>
  );
};
