import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import { toast } from "sonner";
import * as Sentry from "@sentry/react";
import { trackEvent } from "@/lib/analytics";

interface SwipeResult {
  result: string;
  match_id?: string;
  immediate?: boolean;
}

interface UseSwipeActionOptions {
  eventId: string;
  onMatch?: (matchId: string) => void;
  onMatchQueued?: (matchId: string) => void;
}

export const useSwipeAction = ({ eventId, onMatch, onMatchQueued }: UseSwipeActionOptions) => {
  const { user } = useUserProfile();
  const [isProcessing, setIsProcessing] = useState(false);

  const swipe = useCallback(
    async (targetId: string, swipeType: "vibe" | "pass" | "super_vibe"): Promise<SwipeResult | null> => {
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

        const raw = data as unknown as SwipeResult & { success?: boolean; message?: string; error?: string };
        if (raw && typeof raw === "object" && raw.success === false) {
          toast.error(raw.message || "Unable to complete swipe");
          return null;
        }

        const result = raw as SwipeResult;
        const outcome =
          result.result === "swipe_recorded" ? "vibe_recorded" : result.result;

        trackEvent("swipe", {
          event_id: eventId,
          swipe_type: swipeType,
          result: outcome,
        });
        switch (result.result) {
          case "match":
            Sentry.addBreadcrumb({ category: "matching", message: "Mutual match created", level: "info" });
            if (result.immediate && result.match_id) {
              onMatch?.(result.match_id);
            }
            return result;

          case "match_queued":
            toast("You have a match waiting! It'll start when your partner is free 💚", {
              duration: 3000,
            });
            if (result.match_id) onMatchQueued?.(result.match_id);
            return result;

          case "super_vibe_sent":
            toast("Super Vibe sent! ✨", { duration: 2000 });
            return result;

          case "no_credits":
            toast("Get Super Vibes to stand out! ✨", { duration: 2500 });
            return result;

          case "limit_reached":
            toast("You've used all 3 Super Vibes for this event.", { duration: 2500 });
            return result;

          case "already_super_vibed_recently":
            toast("You've already sent them a Super Vibe recently.", { duration: 2500 });
            return result;

          case "already_matched":
            // Silently return — user already matched with this person
            return result;

          case "blocked":
          case "reported":
            toast("This person is not available for matching.", { duration: 2000 });
            return result;

          case "vibe_recorded":
          case "swipe_recorded":
            // Non-mutual vibe — notification handled server-side (`vibe_recorded` canonical; `swipe_recorded` legacy DB)
            return result;

          default:
            return result;
        }
      } catch (err) {
        console.error("Swipe error:", err);
        toast.error("Something went wrong.");
        return null;
      } finally {
        setIsProcessing(false);
      }
    },
    [user?.id, eventId, onMatch, onMatchQueued]
  );

  return { swipe, isProcessing };
};
