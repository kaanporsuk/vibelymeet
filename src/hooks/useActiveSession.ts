import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  pickRegistrationForActiveSession,
  type ActiveSessionBase,
} from "@shared/matching/activeSession";

export type ActiveSession = ActiveSessionBase;

type UseActiveSessionOptions = {
  /** When set, only return a session for this event (lobby-scoped hydration). */
  eventId?: string | null;
};

export function useActiveSession(
  userId: string | null | undefined,
  options?: UseActiveSessionOptions
): {
  activeSession: ActiveSession | null;
  hydrated: boolean;
  refetch: () => Promise<void>;
} {
  const eventFilter = options?.eventId ?? null;
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const check = useCallback(async () => {
    if (!userId) {
      if (mounted.current) {
        setActiveSession(null);
        setHydrated(true);
      }
      return;
    }

    const { data: regs, error: regError } = await supabase
      .from("event_registrations")
      .select("event_id, current_room_id, queue_status, current_partner_id")
      .eq("profile_id", userId)
      .in("queue_status", ["in_handshake", "in_date", "in_ready_gate"])
      .not("current_room_id", "is", null);

    if (regError) {
      if (import.meta.env.DEV) console.warn("[useActiveSession] reg query failed:", regError.message);
      if (mounted.current) {
        setActiveSession(null);
        setHydrated(true);
      }
      return;
    }

    const reg = pickRegistrationForActiveSession(regs ?? []);

    if (!reg?.current_room_id) {
      if (mounted.current) {
        setActiveSession(null);
        setHydrated(true);
      }
      return;
    }

    if (eventFilter && reg.event_id !== eventFilter) {
      if (mounted.current) {
        setActiveSession(null);
        setHydrated(true);
      }
      return;
    }

    const { data: session, error: sessionError } = await supabase
      .from("video_sessions")
      .select("id, ended_at")
      .eq("id", reg.current_room_id)
      .is("ended_at", null)
      .maybeSingle();

    if (sessionError) {
      if (import.meta.env.DEV) console.warn("[useActiveSession] session query failed:", sessionError.message);
      if (mounted.current) {
        setActiveSession(null);
        setHydrated(true);
      }
      return;
    }

    if (!session) {
      if (mounted.current) {
        setActiveSession(null);
        setHydrated(true);
      }
      return;
    }

    let partnerName: string | null = null;
    if (reg.current_partner_id) {
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("name")
        .eq("id", reg.current_partner_id)
        .maybeSingle();
      if (profileError && import.meta.env.DEV) {
        console.warn("[useActiveSession] partner query failed:", profileError.message);
      } else {
        partnerName = profile?.name ?? null;
      }
    }

    const qs = reg.queue_status;
    const base = {
      sessionId: session.id,
      eventId: reg.event_id as string,
      partnerName,
    };

    if (mounted.current) {
      if (qs === "in_ready_gate") {
        setActiveSession({ kind: "ready_gate", ...base, queueStatus: "in_ready_gate" });
      } else if (qs === "in_handshake" || qs === "in_date") {
        setActiveSession({ kind: "video", ...base, queueStatus: qs });
      } else {
        setActiveSession(null);
      }
      setHydrated(true);
    }
  }, [userId, eventFilter]);

  useEffect(() => {
    void check();
  }, [check]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [check]);

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`active-session-reg-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "event_registrations",
          filter: `profile_id=eq.${userId}`,
        },
        () => {
          void check();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, check]);

  const stable = useMemo(
    () => ({ activeSession, hydrated, refetch: check }),
    [activeSession, hydrated, check]
  );

  return stable;
}
