import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface UseEventLifecycleOptions {
  eventId: string | undefined;
  onEventEnded?: () => void;
}

export const useEventLifecycle = ({ eventId, onEventEnded }: UseEventLifecycleOptions) => {
  const [isEventActive, setIsEventActive] = useState(true);
  const [eventEndsAt, setEventEndsAt] = useState<Date | null>(null);

  // Fetch event timing
  useEffect(() => {
    if (!eventId) return;

    const fetchEvent = async () => {
      const { data } = await supabase
        .from("events")
        .select("event_date, duration_minutes, status")
        .eq("id", eventId)
        .maybeSingle();

      if (!data) return;

      const endsAt = new Date(
        new Date(data.event_date).getTime() + (data.duration_minutes || 60) * 60000
      );
      setEventEndsAt(endsAt);

      const now = new Date();
      if (now >= endsAt || data.status === "ended") {
        setIsEventActive(false);
        onEventEnded?.();
      }
    };

    fetchEvent();
  }, [eventId]);

  // Poll for event end every 30s
  useEffect(() => {
    if (!eventEndsAt || !isEventActive) return;

    const interval = setInterval(() => {
      if (new Date() >= eventEndsAt) {
        setIsEventActive(false);
        onEventEnded?.();
        clearInterval(interval);
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [eventEndsAt, isEventActive, onEventEnded]);

  // Listen for admin manually ending the event
  useEffect(() => {
    if (!eventId || !isEventActive) return;

    const channel = supabase
      .channel(`event-lifecycle-${eventId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "events",
          filter: `id=eq.${eventId}`,
        },
        (payload) => {
          const event = payload.new as any;
          if (event.status === "ended") {
            setIsEventActive(false);
            onEventEnded?.();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, isEventActive, onEventEnded]);

  const checkEventActive = useCallback(async (): Promise<boolean> => {
    if (!eventId) return false;

    const { data } = await supabase
      .from("events")
      .select("event_date, duration_minutes, status")
      .eq("id", eventId)
      .maybeSingle();

    if (!data) return false;

    if (data.status === "ended") return false;

    const endsAt = new Date(
      new Date(data.event_date).getTime() + (data.duration_minutes || 60) * 60000
    );
    return new Date() < endsAt;
  }, [eventId]);

  return { isEventActive, eventEndsAt, checkEventActive };
};
