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

/**
 * Event deck swipes via `swipe-actions` → `handle_swipe`.
 * Expected `result` values include match, match_queued, vibe_recorded, swipe_recorded, super_vibe_sent,
 * limit_reached, already_super_vibed_recently, already_matched, blocked, reported, pass_recorded, etc.
 * Legacy `no_credits` is not returned by current `handle_swipe` (super vibe uses per-event limits only).
 */
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
              toast.success("It's a match! Opening Ready Gate…", { duration: 2800 });
              onVideoSessionReady?.(sessionId);
              onMatch?.(sessionId);
            } else {
              toast.success("It's a match! Ready Gate will open in a moment.", { duration: 2800 });
            }
            return raw;

          case "match_queued":
            toast.success(
              "You're matched! We'll bring you to Ready Gate when your partner is free — keep browsing.",
              { duration: 4000 }
            );
            if (sessionId) {
              onVideoSessionQueued?.(sessionId);
              onMatchQueued?.(sessionId);
            }
            return raw;

          case "super_vibe_sent":
            toast("Super Vibe sent! ✨", { duration: 2000 });
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

          case "event_not_active":
            toast("This event is no longer active.", { duration: 3500 });
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
