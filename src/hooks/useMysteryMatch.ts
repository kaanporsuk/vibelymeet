import { useState, useCallback, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface UseMysteryMatchOptions {
  eventId: string | undefined;
  onMatchFound?: (sessionId: string, partnerId: string) => void;
}

export const useMysteryMatch = ({ eventId, onMatchFound }: UseMysteryMatchOptions) => {
  const { user } = useAuth();
  const [isSearching, setIsSearching] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const findMysteryMatch = useCallback(async () => {
    if (!eventId || !user?.id) return;

    setIsSearching(true);

    try {
      const { data, error } = await supabase.rpc("find_mystery_match", {
        p_event_id: eventId,
        p_user_id: user.id,
      });

      if (error) {
        console.error("Mystery match error:", error);
        toast.error("Something went wrong. Try again.");
        setIsSearching(false);
        return;
      }

      const result = data as any;

      if (result?.success && result.session_id) {
        toast("Mystery Match found! 🎲", { duration: 2000 });
        onMatchFound?.(result.session_id, result.partner_id);
        setIsSearching(false);
      } else {
        // No one available
        setIsSearching(false);
        setIsWaiting(true);
        toast("No one available right now. We'll keep checking! ⏳", { duration: 3000 });

        // Start periodic check every 30s
        intervalRef.current = setInterval(async () => {
          const { data: retryData } = await supabase.rpc("find_mystery_match", {
            p_event_id: eventId,
            p_user_id: user.id,
          });

          const retryResult = retryData as any;
          if (retryResult?.success && retryResult.session_id) {
            toast("A Mystery Match is available! 🎲", { duration: 3000 });
            onMatchFound?.(retryResult.session_id, retryResult.partner_id);
            setIsWaiting(false);
            if (intervalRef.current) {
              clearInterval(intervalRef.current);
              intervalRef.current = null;
            }
          }
        }, 30000);
      }
    } catch (err) {
      console.error("Mystery match error:", err);
      setIsSearching(false);
    }
  }, [eventId, user?.id, onMatchFound]);

  const cancelSearch = useCallback(() => {
    setIsWaiting(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return { findMysteryMatch, cancelSearch, isSearching, isWaiting };
};
