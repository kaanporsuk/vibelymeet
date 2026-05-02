import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/analytics";
import { isDateNavigationSuppressedAfterManualExit } from "@/lib/dateNavigationGuard";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";
import {
  activeSessionDirectFallbackStaleReason,
  canAttemptDailyRoomFromVideoSessionTruth,
  decideVideoSessionRouteFromTruth,
  getVideoSessionPartnerIdForUser,
  inferVideoQueueStatusFromSessionTruth,
  isActiveSessionDirectFallbackFresh,
  pickRecoverablePendingPostDateSurveySession,
  pickRegistrationForActiveSession,
  videoSessionHasPostDateSurveyTruth,
  videoSessionHasRecoverablePostDateSurveyTruth,
  type ActiveSessionBase,
} from "@clientShared/matching/activeSession";

export type ActiveSession = ActiveSessionBase;

type UseActiveSessionOptions = {
  /** When set, only return a session for this event (lobby-scoped hydration). */
  eventId?: string | null;
};

type StaleActiveSessionPayload = {
  reason: string;
  eventId?: string | null;
  sessionId?: string | null;
  queueStatus?: string | null;
  currentPartnerPresent?: boolean | null;
};

type EmitStaleActiveSessionDetected = (payload: StaleActiveSessionPayload) => void;

async function fetchPartnerNameForViewer(partnerId: string): Promise<string | null> {
  const { data: profile, error } = await supabase.rpc("get_profile_for_viewer", {
    p_target_id: partnerId,
  });

  if (error) {
    if (import.meta.env.DEV) console.warn("[useActiveSession] partner query failed:", error.message);
    return null;
  }

  return (profile as { name?: string | null } | null)?.name ?? null;
}

async function findPendingPostDateSurveySession(
  userId: string,
  eventFilter: string | null,
  emitStaleActiveSessionDetected?: EmitStaleActiveSessionDetected,
): Promise<{ sessionId: string; eventId: string; partnerName: string | null; endedReason: string | null } | null> {
  const nowMs = Date.now();
  const endedQuery = supabase
    .from("video_sessions")
    .select("id, event_id, participant_1_id, participant_2_id, ended_at, ended_reason, date_started_at")
    .not("ended_at", "is", null)
    .not("date_started_at", "is", null)
    .or(`participant_1_id.eq.${userId},participant_2_id.eq.${userId}`)
    .order("ended_at", { ascending: false, nullsFirst: false })
    .limit(10);
  if (eventFilter) endedQuery.eq("event_id", eventFilter);
  const { data: endedRows, error: endedError } = await endedQuery;
  if (endedError || !endedRows?.length) return null;

  const candidateRows = endedRows.filter((row) => videoSessionHasPostDateSurveyTruth(row));
  const candidateSessionIds = candidateRows
    .map((row) => row.id)
    .filter((sessionId): sessionId is string => Boolean(sessionId));
  if (!candidateSessionIds.length) return null;

  const { data: verdictRows, error: verdictError } = await supabase
    .from("date_feedback")
    .select("session_id")
    .eq("user_id", userId)
    .in("session_id", candidateSessionIds);
  if (verdictError) return null;

  const feedbackSessionIdsForUser = new Set(
    (verdictRows ?? [])
      .map((row) => row.session_id)
      .filter((sessionId): sessionId is string => Boolean(sessionId)),
  );
  const staleSurvey = candidateRows.find(
    (row) =>
      row.id &&
      getVideoSessionPartnerIdForUser(row, userId) &&
      !feedbackSessionIdsForUser.has(row.id) &&
      !videoSessionHasRecoverablePostDateSurveyTruth(row, nowMs),
  );
  if (staleSurvey) {
    emitStaleActiveSessionDetected?.({
      reason: "pending_survey_recovery_stale",
      eventId: staleSurvey.event_id ?? null,
      sessionId: staleSurvey.id ?? null,
      queueStatus: "in_survey",
      currentPartnerPresent: Boolean(getVideoSessionPartnerIdForUser(staleSurvey, userId)),
    });
  }

  const pendingSurvey = pickRecoverablePendingPostDateSurveySession(
    candidateRows,
    feedbackSessionIdsForUser,
    userId,
    nowMs,
  );
  if (!pendingSurvey?.id || !pendingSurvey.event_id) return null;

  const partnerId = getVideoSessionPartnerIdForUser(pendingSurvey, userId);
  let partnerName: string | null = null;
  if (partnerId) {
    partnerName = await fetchPartnerNameForViewer(partnerId);
  }

  return {
    sessionId: pendingSurvey.id,
    eventId: pendingSurvey.event_id,
    partnerName,
    endedReason: pendingSurvey.ended_reason ?? null,
  };
}

function activeSessionFromPendingSurvey(
  pendingSurvey: NonNullable<Awaited<ReturnType<typeof findPendingPostDateSurveySession>>>
): ActiveSession {
  return {
    kind: "video",
    sessionId: pendingSurvey.sessionId,
    eventId: pendingSurvey.eventId,
    partnerName: pendingSurvey.partnerName,
    queueStatus: "in_survey",
  };
}

function pendingSurveyHydrationReason(
  pendingSurvey: NonNullable<Awaited<ReturnType<typeof findPendingPostDateSurveySession>>>
): string {
  return pendingSurvey.endedReason === "reconnect_grace_expired"
    ? "reconnect_grace_pending_survey"
    : "pending_post_date_survey";
}

async function findDirectVideoSessionFallback(
  userId: string,
  eventFilter: string | null,
  emitStaleActiveSessionDetected?: EmitStaleActiveSessionDetected,
): Promise<ActiveSession | null> {
  const nowMs = Date.now();
  const query = supabase
    .from("video_sessions")
    .select(
      "id, event_id, participant_1_id, participant_2_id, ended_at, state, phase, handshake_started_at, date_started_at, date_extra_seconds, ready_gate_status, ready_gate_expires_at, reconnect_grace_ends_at, started_at, state_updated_at, participant_1_joined_at, participant_2_joined_at, daily_room_name, daily_room_url"
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
    rows.find(
      (row) =>
        (canAttemptDailyRoomFromVideoSessionTruth(row, nowMs) ||
          decideVideoSessionRouteFromTruth(row, nowMs) === "navigate_date") &&
        isActiveSessionDirectFallbackFresh(row, nowMs)
    ) ??
    rows.find(
      (row) =>
        decideVideoSessionRouteFromTruth(row, nowMs) === "navigate_ready" &&
        isActiveSessionDirectFallbackFresh(row, nowMs)
    ) ??
    null;

  if (!candidate?.id || !candidate.event_id) {
    const staleCandidate = rows.find((row) => activeSessionDirectFallbackStaleReason(row, nowMs));
    if (staleCandidate) {
      emitStaleActiveSessionDetected?.({
        reason: "direct_video_session_fallback_stale",
        eventId: staleCandidate.event_id ?? null,
        sessionId: staleCandidate.id ?? null,
        queueStatus: null,
        currentPartnerPresent: Boolean(getVideoSessionPartnerIdForUser(staleCandidate, userId)),
      });
    }
    return null;
  }

  const decision = decideVideoSessionRouteFromTruth(candidate, nowMs);
  const canAttemptDaily = canAttemptDailyRoomFromVideoSessionTruth(candidate, nowMs);
  if (!canAttemptDaily && decision !== "navigate_date" && decision !== "navigate_ready") return null;

  const partnerId =
    candidate.participant_1_id === userId
        ? (candidate.participant_2_id as string | null)
        : (candidate.participant_1_id as string | null);
  let partnerName: string | null = null;
  if (partnerId) {
    partnerName = await fetchPartnerNameForViewer(partnerId);
  }

  return canAttemptDaily || decision === "navigate_date"
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
  const staleActiveSessionEventKeyRef = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const commitActiveSession = useCallback((next: ActiveSession | null, reason: string) => {
    if (!mounted.current) return;
    const visibleNext =
      next?.kind === "video" && isDateNavigationSuppressedAfterManualExit(next.sessionId)
        ? null
        : next;
    setActiveSession(visibleNext);
    setHydrated(true);

    if (import.meta.env.DEV) {
      const key = visibleNext
        ? `${visibleNext.kind}:${visibleNext.sessionId}:${visibleNext.eventId}:${visibleNext.queueStatus}:${reason}`
        : `null:${reason}`;
      if (lastHydrationDebugKey.current !== key) {
        lastHydrationDebugKey.current = key;
        console.log("[useActiveSession] hydration result", {
          reason,
          kind: visibleNext?.kind ?? null,
          sessionId: visibleNext?.sessionId ?? null,
          eventId: visibleNext?.eventId ?? null,
          queueStatus: visibleNext?.queueStatus ?? null,
          scopedEventId: eventFilter,
          suppressedManualExitSessionId: next !== visibleNext ? next?.sessionId ?? null : null,
        });
      }
    }
  }, [eventFilter]);

  const emitStaleActiveSessionDetected = useCallback(
    (payload: {
      reason: string;
      eventId?: string | null;
      sessionId?: string | null;
      queueStatus?: string | null;
      currentPartnerPresent?: boolean | null;
    }) => {
      const key = `${payload.reason}:${payload.eventId ?? "none"}:${payload.sessionId ?? "none"}:${payload.queueStatus ?? "none"}`;
      if (staleActiveSessionEventKeyRef.current === key) return;
      staleActiveSessionEventKeyRef.current = key;
      trackEvent(LobbyPostDateEvents.STALE_ACTIVE_SESSION_DETECTED, {
        platform: "web",
        source_surface: "use_active_session",
        scoped_event_id: eventFilter,
        event_id: payload.eventId ?? null,
        session_id: payload.sessionId ?? null,
        queue_status: payload.queueStatus ?? null,
        current_partner_present: payload.currentPartnerPresent ?? null,
        reason: payload.reason,
        reason_code: payload.reason,
      });
    },
    [eventFilter]
  );

  const check = useCallback(async () => {
    if (!userId) {
      commitActiveSession(null, "missing_user");
      return;
    }

    // Normal post-date end clears current_room_id, so registration lookup is followed by
    // participant-scoped ended-session recovery before falling back to lobby/dashboard.
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
      const directSession = await findDirectVideoSessionFallback(userId, eventFilter, emitStaleActiveSessionDetected);
      if (directSession) {
        commitActiveSession(directSession, "direct_video_session_fallback");
        return;
      }
      const pendingSurvey = await findPendingPostDateSurveySession(userId, eventFilter, emitStaleActiveSessionDetected);
      if (pendingSurvey) {
        commitActiveSession(
          activeSessionFromPendingSurvey(pendingSurvey),
          pendingSurveyHydrationReason(pendingSurvey)
        );
      } else {
        commitActiveSession(null, "no_active_registration_room");
      }
      return;
    }

    if (eventFilter && reg.event_id !== eventFilter) {
      emitStaleActiveSessionDetected({
        reason: "different_event_registration_room",
        eventId: reg.event_id as string | null,
        sessionId: reg.current_room_id as string | null,
        queueStatus: reg.queue_status as string | null,
        currentPartnerPresent: Boolean(reg.current_partner_id),
      });
      commitActiveSession(null, "different_event");
      return;
    }

    const { data: session, error: sessionError } = await supabase
      .from("video_sessions")
      .select("id, event_id, participant_1_id, participant_2_id, ended_at, ended_reason, state, phase, handshake_started_at, date_started_at, date_extra_seconds, ready_gate_status, ready_gate_expires_at, reconnect_grace_ends_at, started_at, state_updated_at, participant_1_joined_at, participant_2_joined_at, daily_room_name, daily_room_url")
      .eq("id", reg.current_room_id)
      .maybeSingle();

    if (sessionError) {
      if (import.meta.env.DEV) console.warn("[useActiveSession] session query failed:", sessionError.message);
      const directSession = await findDirectVideoSessionFallback(userId, eventFilter, emitStaleActiveSessionDetected);
      if (directSession) {
        commitActiveSession(directSession, "direct_video_session_fallback_after_session_query_failed");
      } else {
        const pendingSurvey = await findPendingPostDateSurveySession(userId, eventFilter, emitStaleActiveSessionDetected);
        if (pendingSurvey) {
          commitActiveSession(
            activeSessionFromPendingSurvey(pendingSurvey),
            pendingSurveyHydrationReason(pendingSurvey)
          );
        } else {
          commitActiveSession(null, "session_query_failed");
        }
      }
      return;
    }

    if (!session) {
      const directSession = await findDirectVideoSessionFallback(userId, eventFilter, emitStaleActiveSessionDetected);
      if (directSession) {
        commitActiveSession(directSession, "direct_video_session_fallback_after_session_missing");
      } else {
        const pendingSurvey = await findPendingPostDateSurveySession(userId, eventFilter, emitStaleActiveSessionDetected);
        if (pendingSurvey) {
          commitActiveSession(
            activeSessionFromPendingSurvey(pendingSurvey),
            pendingSurveyHydrationReason(pendingSurvey)
          );
        } else {
          emitStaleActiveSessionDetected({
            reason: "registration_points_to_missing_session",
            eventId: reg.event_id as string | null,
            sessionId: reg.current_room_id as string | null,
            queueStatus: reg.queue_status as string | null,
            currentPartnerPresent: Boolean(reg.current_partner_id),
          });
          commitActiveSession(null, "session_missing_or_ended");
        }
      }
      return;
    }

    let partnerName: string | null = null;
    if (reg.current_partner_id) {
      partnerName = await fetchPartnerNameForViewer(reg.current_partner_id as string);
    }

    const qs = reg.queue_status;
    const base = {
      sessionId: session.id,
      eventId: reg.event_id as string,
      partnerName,
    };
    const nowMs = Date.now();
    const truthDecision = decideVideoSessionRouteFromTruth(session, nowMs);
    const canAttemptDaily = canAttemptDailyRoomFromVideoSessionTruth(session, nowMs);
    const freshDateRoute =
      (canAttemptDaily || truthDecision === "navigate_date") &&
      isActiveSessionDirectFallbackFresh(session, nowMs);
    const staleFallbackReason = activeSessionDirectFallbackStaleReason(session, nowMs);

    if (truthDecision === "ended") {
      const directSession = await findDirectVideoSessionFallback(userId, eventFilter, emitStaleActiveSessionDetected);
      if (directSession) {
        commitActiveSession(directSession, "direct_video_session_fallback_after_registration_ended");
      } else {
        const pendingSurvey = await findPendingPostDateSurveySession(userId, eventFilter, emitStaleActiveSessionDetected);
        if (pendingSurvey) {
          commitActiveSession(
            activeSessionFromPendingSurvey(pendingSurvey),
            pendingSurveyHydrationReason(pendingSurvey)
          );
        } else {
          emitStaleActiveSessionDetected({
            reason: "registration_points_to_ended_session",
            eventId: reg.event_id as string | null,
            sessionId: session.id as string | null,
            queueStatus: qs as string | null,
            currentPartnerPresent: Boolean(reg.current_partner_id),
          });
          commitActiveSession(null, "session_missing_or_ended");
        }
      }
      return;
    }

    if (qs === "in_ready_gate") {
      if (freshDateRoute) {
        const inferredQs = inferVideoQueueStatusFromSessionTruth(session);
        commitActiveSession(
          { kind: "video", ...base, queueStatus: inferredQs },
          "ready_gate_stale_registration_session_truth"
        );
      } else if (truthDecision === "navigate_ready") {
        commitActiveSession({ kind: "ready_gate", ...base, queueStatus: "in_ready_gate" }, "ready_gate_registration");
      } else {
        const directSession = await findDirectVideoSessionFallback(userId, eventFilter, emitStaleActiveSessionDetected);
        if (directSession) {
          commitActiveSession(directSession, "direct_video_session_fallback_after_registration_not_startable");
        } else {
          emitStaleActiveSessionDetected({
            reason: "registration_session_not_startable",
            eventId: reg.event_id as string | null,
            sessionId: session.id as string | null,
            queueStatus: qs as string | null,
            currentPartnerPresent: Boolean(reg.current_partner_id),
          });
          commitActiveSession(null, "session_not_startable");
        }
      }
    } else if (qs === "in_handshake" || qs === "in_date") {
      if (!freshDateRoute && truthDecision === "navigate_ready") {
        commitActiveSession(
          { kind: "ready_gate", ...base, queueStatus: "in_ready_gate" },
          "video_registration_truth_ready_gate"
        );
      } else if (freshDateRoute) {
        commitActiveSession({ kind: "video", ...base, queueStatus: qs }, "video_registration");
      } else {
        if (staleFallbackReason) {
          emitStaleActiveSessionDetected({
            reason: staleFallbackReason,
            eventId: reg.event_id as string | null,
            sessionId: session.id as string | null,
            queueStatus: qs as string | null,
            currentPartnerPresent: Boolean(reg.current_partner_id),
          });
        }
        const directSession = await findDirectVideoSessionFallback(
          userId,
          eventFilter,
          emitStaleActiveSessionDetected,
        );
        if (directSession) {
          commitActiveSession(directSession, "direct_video_session_fallback_after_registration_stale");
        } else {
          const pendingSurvey = await findPendingPostDateSurveySession(
            userId,
            eventFilter,
            emitStaleActiveSessionDetected,
          );
          if (pendingSurvey) {
            commitActiveSession(
              activeSessionFromPendingSurvey(pendingSurvey),
              pendingSurveyHydrationReason(pendingSurvey)
            );
          } else {
            commitActiveSession(null, staleFallbackReason ?? "video_registration_not_routeable");
          }
        }
      }
    } else if (qs === "in_survey") {
      const surveyBaseEligible =
        videoSessionHasPostDateSurveyTruth(session) &&
        Boolean(getVideoSessionPartnerIdForUser(session, userId));
      const hasRecoverableSurvey =
        surveyBaseEligible && videoSessionHasRecoverablePostDateSurveyTruth(session, nowMs);
      const { data: feedback, error: feedbackError } = surveyBaseEligible
        ? await supabase
            .from("date_feedback")
            .select("id")
            .eq("session_id", session.id)
            .eq("user_id", userId)
            .maybeSingle()
        : { data: null, error: null };

      if (feedbackError) {
        if (import.meta.env.DEV) {
          console.warn("[useActiveSession] survey feedback query failed:", feedbackError.message);
        }
        commitActiveSession(null, "pending_survey_feedback_query_failed");
        return;
      }

      if (hasRecoverableSurvey && !feedback) {
        commitActiveSession({ kind: "video", ...base, queueStatus: qs }, "video_registration_survey");
      } else {
        emitStaleActiveSessionDetected({
          reason: surveyBaseEligible && !hasRecoverableSurvey
            ? "pending_survey_recovery_stale"
            : "registration_survey_not_recoverable",
          eventId: reg.event_id as string | null,
          sessionId: session.id as string | null,
          queueStatus: qs as string | null,
          currentPartnerPresent: Boolean(reg.current_partner_id),
        });
        commitActiveSession(null, feedback ? "pending_survey_feedback_exists" : "registration_survey_not_recoverable");
      }
    } else {
      emitStaleActiveSessionDetected({
        reason: "unsupported_registration_status",
        eventId: reg.event_id as string | null,
        sessionId: session.id as string | null,
        queueStatus: qs as string | null,
        currentPartnerPresent: Boolean(reg.current_partner_id),
      });
      commitActiveSession(null, "unsupported_registration_status");
    }
  }, [userId, eventFilter, commitActiveSession, emitStaleActiveSessionDetected]);

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

    const maybeCheckForScopedEvent = (payload: {
      new?: Record<string, unknown> | null;
      old?: Record<string, unknown> | null;
    }) => {
      const row = payload.new ?? payload.old ?? null;
      if (row?.event_id !== eventFilter) return;
      void check();
    };

    const channel = supabase.channel(`active-session-video-${userId}-${eventFilter}`);
    // Realtime cannot OR participant columns in one filter, so active-session
    // hydration listens to each participant side and keeps the polling fallback.
    for (const filter of [`participant_1_id=eq.${userId}`, `participant_2_id=eq.${userId}`]) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "video_sessions",
          filter,
        },
        maybeCheckForScopedEvent
      );
    }
    channel.subscribe();

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
