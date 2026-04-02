import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import { toast } from "sonner";
import * as Sentry from "@sentry/react";
import { trackEvent } from "@/lib/analytics";
import {
  type SwipeSessionStageResult,
  videoSessionIdFromSwipePayload,
} from "@shared/matching/videoSessionFlow";

interface UseSwipeActionOptions {
  eventId: string;
  /**
   * Mutual vibe opened ready gate immediately (`video_sessions.id`).
   * @deprecated Prefer `onVideoSessionReady` — same callback shape.
   */
  onMatch?: (videoSessionId: string) => void;
  /** Same as `onMatch`; honest name for session-stage id. */
  onVideoSessionReady?: (videoSessionId: string) => void;
  /**
   * Queued session created (`video_sessions.id`); partner will enter lobby when free.
   * @deprecated Prefer `onVideoSessionQueued`
   */
  onMatchQueued?: (videoSessionId: string) => void;
  onVideoSessionQueued?: (videoSessionId: string) => void;
}

export const useSwipeAction = ({
  eventId,
  onMatch,
  onVideoSessionReady,
  onMatchQueued,
  onVideoSessionQueued,
}: UseSwipeActionOptions) => {
  const { user } = useUserProfile();
  const [isProcessing, setIsProcessing] = useState(false);

  const swipe = useCallback(
    async (targetId: string, swipeType: "vibe" | "pass" | "super_vibe"): Promise<SwipeSessionStageResult | null> => {
      if (!user?.id || !eventId) return null;
      if (!navigator.onLine) {
        toast.error("You're offline — swipes need a connection");
        return null;
      }

      setIsProcessing(true);
      try {
        const { data, error } = await supabase.functions.invoke("swipe-actions", {
          body: {
            event_id: eventId,
            target_id: targetId,
            swipe_type: swipeType,
          },
        });

        if (error) {
          console.error("Swipe error:", error);
          toast.error("Something went wrong. Try again.");
          return null;
        }

        const raw = data as unknown as SwipeSessionStageResult;
        if (raw && typeof raw === "object" && raw.success === false) {
          toast.error(raw.message || "Unable to complete swipe");
          return null;
        }

        const outcome =
          raw.result === "swipe_recorded" ? "vibe_recorded" : raw.result;

        trackEvent("swipe", {
          event_id: eventId,
          swipe_type: swipeType,
          result: outcome,
        });
        const sessionId = videoSessionIdFromSwipePayload(raw);

        switch (raw.result) {
          case "match":
            Sentry.addBreadcrumb({
              category: "matching",
              message: "Mutual vibe — video session / ready gate created",
              level: "info",
            });
            if (raw.immediate && sessionId) {
              onVideoSessionReady?.(sessionId);
              onMatch?.(sessionId);
            }
            return raw;

          case "match_queued":
            toast("Video date queued — it’ll start when your partner is free 💚", {
              duration: 3000,
            });
            if (sessionId) {
              onVideoSessionQueued?.(sessionId);
              onMatchQueued?.(sessionId);
            }
            return raw;

          case "super_vibe_sent":
            toast("Super Vibe sent! ✨", { duration: 2000 });
            return raw;

          case "no_credits":
            toast("Get Super Vibes to stand out! ✨", { duration: 2500 });
            return raw;

          case "limit_reached":
            toast("You've used all 3 Super Vibes for this event.", { duration: 2500 });
            return raw;

          case "already_super_vibed_recently":
            toast("You've already sent them a Super Vibe recently.", { duration: 2500 });
            return raw;

          case "already_matched":
            return raw;

          case "blocked":
          case "reported":
            toast("This person is not available for matching.", { duration: 2000 });
            return raw;

          case "vibe_recorded":
          case "swipe_recorded":
            return raw;

          default:
            return raw;
        }
      } catch (err) {
        console.error("Swipe error:", err);
        toast.error("Something went wrong.");
        return null;
      } finally {
        setIsProcessing(false);
      }
    },
    [user?.id, eventId, onMatch, onVideoSessionReady, onMatchQueued, onVideoSessionQueued]
  );

  return { swipe, isProcessing };
};
