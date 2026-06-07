import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/analytics";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";

type UseMysteryMatchOptions = {
  eventId: string | undefined;
  onMatchFound?: (sessionId: string, partnerId: string) => void;
  enabled?: boolean;
};

type MysteryMatchResult = {
  success?: boolean;
  video_session_id?: string;
  session_id?: string;
  match_id?: string;
  event_id?: string;
  partner_id?: string;
  ready_gate_status?: string;
  session_source?: string;
} | null;

function mysteryMatchSessionId(result: MysteryMatchResult): string | null {
  return result?.video_session_id ?? result?.session_id ?? result?.match_id ?? null;
}

export function useMysteryMatch({
  eventId,
  onMatchFound,
  enabled = true,
}: UseMysteryMatchOptions) {
  const [isSearching, setIsSearching] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventIdRef = useRef(eventId);
  const userIdRef = useRef<string | null>(null);

  const stopWaitingLoop = useCallback(() => {
    if (!intervalRef.current) return;
    clearInterval(intervalRef.current);
    intervalRef.current = null;
  }, []);

  const resetSearchAndWaiting = useCallback(() => {
    setIsSearching(false);
    setIsWaiting(false);
    stopWaitingLoop();
  }, [stopWaitingLoop]);

  const trackOutcome = useCallback((outcome: "matched" | "waiting" | "error") => {
    const currentEventId = eventIdRef.current;
    if (!currentEventId) return;
    trackEvent(LobbyPostDateEvents.MYSTERY_MATCH_OUTCOME, {
      platform: "web",
      event_id: currentEventId,
      outcome,
    });
  }, []);

  const handleResult = useCallback(
    (result: MysteryMatchResult): boolean => {
      const sessionId = mysteryMatchSessionId(result);
      if (!result?.success || !sessionId) return false;
      trackOutcome("matched");
      onMatchFound?.(sessionId, result.partner_id ?? "");
      resetSearchAndWaiting();
      return true;
    },
    [onMatchFound, resetSearchAndWaiting, trackOutcome],
  );

  const startWaitingLoop = useCallback(() => {
    if (
      intervalRef.current ||
      !userIdRef.current ||
      !eventIdRef.current ||
      !enabled
    ) {
      return;
    }

    intervalRef.current = setInterval(async () => {
      if (!eventIdRef.current || !userIdRef.current) {
        stopWaitingLoop();
        return;
      }

      try {
        const { data, error } = await supabase.rpc("find_mystery_match", {
          p_event_id: eventIdRef.current,
          p_user_id: userIdRef.current,
        });

        if (error) {
          if (import.meta.env.DEV) {
            console.warn("[useMysteryMatch] retry failed:", error.message);
          }
          trackOutcome("error");
          resetSearchAndWaiting();
          return;
        }

        handleResult(data as MysteryMatchResult);
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn("[useMysteryMatch] retry error:", err);
        }
        trackOutcome("error");
        resetSearchAndWaiting();
      }
    }, 8_000);
  }, [
    enabled,
    handleResult,
    resetSearchAndWaiting,
    stopWaitingLoop,
    trackOutcome,
  ]);

  useEffect(() => {
    eventIdRef.current = eventId;
    if (!eventId) {
      resetSearchAndWaiting();
    }
  }, [eventId, resetSearchAndWaiting]);

  useEffect(() => {
    if (!enabled) {
      resetSearchAndWaiting();
      return;
    }
    if (isWaiting) {
      startWaitingLoop();
    }
  }, [enabled, isWaiting, resetSearchAndWaiting, startWaitingLoop]);

  const findMysteryMatch = useCallback(async () => {
    if (!enabled || intervalRef.current || isWaiting) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!eventId || !user?.id) return;
    eventIdRef.current = eventId;
    userIdRef.current = user.id;
    setIsSearching(true);

    try {
      const { data, error } = await supabase.rpc("find_mystery_match", {
        p_event_id: eventId,
        p_user_id: user.id,
      });

      if (error) {
        trackOutcome("error");
        setIsSearching(false);
        return;
      }

      if (handleResult(data as MysteryMatchResult)) return;

      trackOutcome("waiting");
      setIsSearching(false);
      setIsWaiting(true);
      startWaitingLoop();
    } catch {
      trackOutcome("error");
      setIsSearching(false);
    }
  }, [enabled, eventId, handleResult, isWaiting, startWaitingLoop, trackOutcome]);

  const cancelSearch = useCallback(() => {
    if (eventIdRef.current) {
      trackEvent(LobbyPostDateEvents.MYSTERY_MATCH_CANCEL, {
        platform: "web",
        event_id: eventIdRef.current,
      });
    }
    resetSearchAndWaiting();
  }, [resetSearchAndWaiting]);

  useEffect(() => {
    return () => {
      stopWaitingLoop();
    };
  }, [stopWaitingLoop]);

  return { findMysteryMatch, cancelSearch, isSearching, isWaiting };
}
