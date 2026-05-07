import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { resolveEventLifecycle } from "@/lib/eventLifecycle";

type EventLifecyclePayload = {
  status?: string | null;
  event_date?: string | null;
  duration_minutes?: number | null;
  ended_at?: string | null;
};

interface UseEventLifecycleOptions {
  eventId: string | undefined;
  onEventEnded?: () => void;
}

export const useEventLifecycle = ({ eventId, onEventEnded }: UseEventLifecycleOptions) => {
  const [isEventActive, setIsEventActive] = useState(false);
  const [eventEndsAt, setEventEndsAt] = useState<Date | null>(null);
  const [isResolved, setIsResolved] = useState(!eventId);

  // Fetch event timing
  useEffect(() => {
    if (!eventId) {
      setIsEventActive(false);
      setEventEndsAt(null);
      setIsResolved(true);
      return;
    }

    let cancelled = false;

    const fetchEvent = async () => {
      setIsResolved(false);
      setIsEventActive(false);

      const { data, error } = await supabase
        .from("events")
        .select("event_date, duration_minutes, status, ended_at")
        .eq("id", eventId)
        .maybeSingle();

      if (cancelled) return;

      if (error || !data) {
        setEventEndsAt(null);
        setIsEventActive(false);
        setIsResolved(true);
        return;
      }

      const lifecycle = resolveEventLifecycle(data);
      setEventEndsAt(lifecycle.endsAt);
      setIsEventActive(lifecycle.isLive);
      setIsResolved(true);
      if (lifecycle.isEnded) {
        onEventEnded?.();
      }
    };

    void fetchEvent();
    return () => {
      cancelled = true;
    };
  }, [eventId, onEventEnded]);

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
    if (!eventId) return;

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
          const event = payload.new as EventLifecyclePayload;
          const lifecycle = resolveEventLifecycle(event);
          setEventEndsAt(lifecycle.endsAt);
          setIsEventActive(lifecycle.isLive);
          setIsResolved(true);
          if (lifecycle.isEnded) {
            onEventEnded?.();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, onEventEnded]);

  const checkEventActive = useCallback(async (): Promise<boolean> => {
    if (!eventId) return false;

    const { data, error } = await supabase
      .from("events")
      .select("event_date, duration_minutes, status, ended_at")
      .eq("id", eventId)
      .maybeSingle();

    if (error || !data) {
      setEventEndsAt(null);
      setIsEventActive(false);
      setIsResolved(true);
      return false;
    }

    const lifecycle = resolveEventLifecycle(data);
    setEventEndsAt(lifecycle.endsAt);
    setIsEventActive(lifecycle.isLive);
    setIsResolved(true);
    return lifecycle.isLive;
  }, [eventId]);

  return { isEventActive, eventEndsAt, isResolved, checkEventActive };
};
