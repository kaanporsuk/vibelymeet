import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  decideVideoSessionRouteFromTruth,
  inferVideoQueueStatusFromSessionTruth,
  pickRegistrationForActiveSession,
  type ActiveSessionBase,
} from "@clientShared/matching/activeSession";

export type ActiveSession = ActiveSessionBase;

type UseActiveSessionOptions = {
  /** When set, only return a session for this event (lobby-scoped hydration). */
  eventId?: string | null;
};

async function findPendingReconnectGraceSurveySession(
  userId: string,
  eventFilter: string | null
): Promise<{ sessionId: string; eventId: string; partnerName: string | null } | null> {
  const endedQuery = supabase
    .from("video_sessions")
    .select("id, event_id, participant_1_id, participant_2_id, ended_at, ended_reason, date_started_at")
    .eq("ended_reason", "reconnect_grace_expired")
    .not("date_started_at", "is", null)
    .or(`participant_1_id.eq.${userId},participant_2_id.eq.${userId}`)
    .order("ended_at", { ascending: false, nullsFirst: false })
    .limit(5);
  if (eventFilter) endedQuery.eq("event_id", eventFilter);
  const { data: endedRows, error: endedError } = await endedQuery;
  if (endedError || !endedRows?.length) return null;

  for (const row of endedRows) {
    const sessionId = row.id as string;
    const eventId = row.event_id as string | null;
    if (!eventId) continue;
    const { data: verdict } = await supabase
      .from("date_feedback")
      .select("id")
      .eq("session_id", sessionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (verdict) continue;

    const partnerId =
      row.participant_1_id === userId
        ? (row.participant_2_id as string | null)
        : (row.participant_1_id as string | null);
    let partnerName: string | null = null;
    if (partnerId) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("name")
        .eq("id", partnerId)
        .maybeSingle();
      partnerName = profile?.name ?? null;
    }

    return { sessionId, eventId, partnerName };
  }

  return null;
}

async function findDirectVideoSessionFallback(
  userId: string,
  eventFilter: string | null
): Promise<ActiveSession | null> {
  const query = supabase
    .from("video_sessions")
    .select(
      "id, event_id, participant_1_id, participant_2_id, ended_at, state, phase, handshake_started_at, date_started_at, ready_gate_status, ready_gate_expires_at"
    )
    .or(`participant_1_id.eq.${userId},participant_2_id.eq.${userId}`)
    .is("ended_at", null)
    .order("handshake_started_at", { ascending: false, nullsFirst: false })
    .order("ready_gate_expires_at", { ascending: false, nullsFirst: false })
    .limit(10);
  if (eventFilter) query.eq("event_id", eventFilter);

  const { data: rows, error } = await query;
  if (error || !rows?.length) return null;

  const candidate =
    rows.find((row) => decideVideoSessionRouteFromTruth(row) === "navigate_date") ??
    rows.find((row) => decideVideoSessionRouteFromTruth(row) === "navigate_ready") ??
    null;

  if (!candidate?.id || !candidate.event_id) return null;

  const decision = decideVideoSessionRouteFromTruth(candidate);
  if (decision !== "navigate_date" && decision !== "navigate_ready") return null;

  const partnerId =
    candidate.participant_1_id === userId
      ? (candidate.participant_2_id as string | null)
      : (candidate.participant_1_id as string | null);
  let partnerName: string | null = null;
  if (partnerId) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("name")
      .eq("id", partnerId)
      .maybeSingle();
    partnerName = profile?.name ?? null;
  }

  return decision === "navigate_date"
    ? {
        kind: "video",
        sessionId: candidate.id as string,
        eventId: candidate.event_id as string,
        partnerName,
        queueStatus: inferVideoQueueStatusFromSessionTruth(candidate),
      }
    : {
        kind: "ready_gate",
        sessionId: candidate.id as string,
        eventId: candidate.event_id as string,
        partnerName,
        queueStatus: "in_ready_gate",
      };
}

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
  const lastHydrationDebugKey = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const commitActiveSession = useCallback((next: ActiveSession | null, reason: string) => {
    if (!mounted.current) return;
    setActiveSession(next);
    setHydrated(true);

    if (import.meta.env.DEV) {
      const key = next
        ? `${next.kind}:${next.sessionId}:${next.eventId}:${next.queueStatus}:${reason}`
        : `null:${reason}`;
      if (lastHydrationDebugKey.current !== key) {
        lastHydrationDebugKey.current = key;
        console.log("[useActiveSession] hydration result", {
          reason,
          kind: next?.kind ?? null,
          sessionId: next?.sessionId ?? null,
          eventId: next?.eventId ?? null,
          queueStatus: next?.queueStatus ?? null,
          scopedEventId: eventFilter,
        });
      }
    }
  }, [eventFilter]);

  const check = useCallback(async () => {
    if (!userId) {
      commitActiveSession(null, "missing_user");
      return;
    }

    // Intentional: plain `in_survey` with `current_room_id` null (normal post-date end) is not surfaced here.
    // Survey UX lives on `/date/:id` until verdict/flow completes; see `VideoDate` + `PostDateSurvey`.
    const { data: regs, error: regError } = await supabase
      .from("event_registrations")
      .select("event_id, current_room_id, queue_status, current_partner_id")
      .eq("profile_id", userId)
      .in("queue_status", ["in_handshake", "in_date", "in_survey", "in_ready_gate"])
      .not("current_room_id", "is", null);

    if (regError) {
      if (import.meta.env.DEV) console.warn("[useActiveSession] reg query failed:", regError.message);
      commitActiveSession(null, "reg_query_failed");
      return;
    }

    const reg = pickRegistrationForActiveSession(regs ?? []);

    if (!reg?.current_room_id) {
      const directSession = await findDirectVideoSessionFallback(userId, eventFilter);
      if (directSession) {
        commitActiveSession(directSession, "direct_video_session_fallback");
        return;
      }
      const reconnectSurvey = await findPendingReconnectGraceSurveySession(userId, eventFilter);
      if (reconnectSurvey) {
        commitActiveSession(
          {
            kind: "video",
            sessionId: reconnectSurvey.sessionId,
            eventId: reconnectSurvey.eventId,
            partnerName: reconnectSurvey.partnerName,
            queueStatus: "in_survey",
          },
          "reconnect_grace_pending_survey"
        );
      } else {
        commitActiveSession(null, "no_active_registration_room");
      }
      return;
    }

    if (eventFilter && reg.event_id !== eventFilter) {
      commitActiveSession(null, "different_event");
      return;
    }

    const { data: session, error: sessionError } = await supabase
      .from("video_sessions")
      .select("id, ended_at, state, phase, handshake_started_at, date_started_at")
      .eq("id", reg.current_room_id)
      .maybeSingle();

    if (sessionError) {
      if (import.meta.env.DEV) console.warn("[useActiveSession] session query failed:", sessionError.message);
      const directSession = await findDirectVideoSessionFallback(userId, eventFilter);
      if (directSession) {
        commitActiveSession(directSession, "direct_video_session_fallback_after_session_query_failed");
      } else {
        commitActiveSession(null, "session_query_failed");
      }
      return;
    }

    if (!session) {
      const directSession = await findDirectVideoSessionFallback(userId, eventFilter);
      if (directSession) {
        commitActiveSession(directSession, "direct_video_session_fallback_after_session_missing");
      } else {
        commitActiveSession(null, "session_missing_or_ended");
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
    const truthDecision = decideVideoSessionRouteFromTruth(session);

    if (truthDecision === "ended") {
      const directSession = await findDirectVideoSessionFallback(userId, eventFilter);
      if (directSession) {
        commitActiveSession(directSession, "direct_video_session_fallback_after_registration_ended");
      } else {
        commitActiveSession(null, "session_missing_or_ended");
      }
      return;
    }

    if (qs === "in_ready_gate") {
      if (truthDecision === "navigate_date") {
        const inferredQs = inferVideoQueueStatusFromSessionTruth(session);
        commitActiveSession(
          { kind: "video", ...base, queueStatus: inferredQs },
          "ready_gate_stale_registration_session_truth"
        );
      } else if (truthDecision === "navigate_ready") {
        commitActiveSession({ kind: "ready_gate", ...base, queueStatus: "in_ready_gate" }, "ready_gate_registration");
      } else {
        const directSession = await findDirectVideoSessionFallback(userId, eventFilter);
        if (directSession) {
          commitActiveSession(directSession, "direct_video_session_fallback_after_registration_not_startable");
        } else {
          commitActiveSession(null, "session_not_startable");
        }
      }
    } else if (qs === "in_handshake" || qs === "in_date") {
      if (truthDecision === "navigate_ready") {
        commitActiveSession(
          { kind: "ready_gate", ...base, queueStatus: "in_ready_gate" },
          "video_registration_truth_ready_gate"
        );
      } else {
        commitActiveSession({ kind: "video", ...base, queueStatus: qs }, "video_registration");
      }
    } else if (qs === "in_survey") {
      commitActiveSession({ kind: "video", ...base, queueStatus: qs }, "video_registration");
    } else {
      commitActiveSession(null, "unsupported_registration_status");
    }
  }, [userId, eventFilter, commitActiveSession]);

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

  useEffect(() => {
    if (!userId || !eventFilter) return;

    const channel = supabase
      .channel(`active-session-video-${userId}-${eventFilter}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "video_sessions",
          filter: `event_id=eq.${eventFilter}`,
        },
        () => {
          void check();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, eventFilter, check]);

  useEffect(() => {
    if (!userId) return;
    const intervalId = setInterval(() => {
      void check();
    }, 8000);
    return () => clearInterval(intervalId);
  }, [userId, check]);

  const stable = useMemo(
    () => ({ activeSession, hydrated, refetch: check }),
    [activeSession, hydrated, check]
  );

  return stable;
}
