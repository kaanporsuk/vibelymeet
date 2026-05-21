import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/analytics";
import { isDateNavigationSuppressedAfterManualExit } from "@/lib/dateNavigationGuard";
import { isActiveSessionContextShadowEnabled } from "@/lib/runtimeFlags";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";
import {
  activeSessionDirectFallbackStaleReason,
  canAttemptDailyRoomFromVideoSessionTruth,
  decideVideoSessionRouteFromTruth,
  getVideoSessionPartnerIdForUser,
  inferVideoQueueStatusFromSessionTruth,
  isActiveSessionDirectFallbackFresh,
  normalizeReadyGateTransitionActiveSessionTruth,
  pickRecoverablePendingPostDateSurveySession,
  pickRegistrationForActiveSession,
  readyGateTransitionResultHasDateCapableTruth,
  readyGateTransitionResultReadyGateEligible,
  videoSessionHasPostDateSurveyTruth,
  videoSessionHasRecoverablePostDateSurveyTruth,
  type ActiveSessionBase,
} from "@clientShared/matching/activeSession";

export type ActiveSession = ActiveSessionBase;

type UseActiveSessionOptions = {
  /** When set, only return a session for this event (lobby-scoped hydration). */
  eventId?: string | null;
  /** Disable network hydration while keeping hook call order stable for flagged consumers. */
  enabled?: boolean;
};

const ACTIVE_SESSION_POLL_MS = 30_000;

type StaleActiveSessionPayload = {
  reason: string;
  eventId?: string | null;
  sessionId?: string | null;
  queueStatus?: string | null;
  currentPartnerPresent?: boolean | null;
};

type EmitStaleActiveSessionDetected = (payload: StaleActiveSessionPayload) => void;

type ActiveSessionVideoTruth = Parameters<typeof decideVideoSessionRouteFromTruth>[0] & {
  id?: string | null;
  event_id?: string | null;
  participant_1_id?: string | null;
  participant_2_id?: string | null;
};

function isReadyGateSuppressionActive(
  suppressedUntil: unknown,
  suppressedSessionId: unknown,
  sessionId: string,
  nowMs = Date.now(),
): boolean {
  if (suppressedSessionId !== sessionId) return false;
  const value = suppressedUntil;
  if (typeof value !== "string" || !value) return false;
  const suppressedUntilMs = Date.parse(value);
  return Number.isFinite(suppressedUntilMs) && suppressedUntilMs > nowMs;
}

async function isReadyGateSuppressedForSession(
  userId: string,
  eventId: string,
  sessionId: string,
  nowMs: number,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("event_registrations")
    .select("current_room_id, ready_gate_suppressed_until, ready_gate_suppressed_session_id")
    .eq("profile_id", userId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) return false;
  if (!data) return false;
  if (data.current_room_id && data.current_room_id !== sessionId) return false;
  return isReadyGateSuppressionActive(
    data.ready_gate_suppressed_until,
    (data as Record<string, unknown>).ready_gate_suppressed_session_id,
    sessionId,
    nowMs,
  );
}

type ShadowRpcError = {
  message?: string;
};

type ShadowRpcResult = {
  data: unknown;
  error: ShadowRpcError | null;
};

type ShadowActiveSessionSnapshot = {
  kind: string | null;
  sessionId: string | null;
  eventId: string | null;
  queueStatus: string | null;
};

function normalizeUnknownActiveSession(value: unknown): ShadowActiveSessionSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const kind = typeof row.kind === "string" ? row.kind : null;
  const sessionId =
    typeof row.sessionId === "string"
      ? row.sessionId
      : typeof row.session_id === "string"
        ? row.session_id
        : null;
  const eventId =
    typeof row.eventId === "string"
      ? row.eventId
      : typeof row.event_id === "string"
        ? row.event_id
        : null;
  const queueStatus =
    typeof row.queueStatus === "string"
      ? row.queueStatus
      : typeof row.queue_status === "string"
        ? row.queue_status
        : null;

  if (!kind && !sessionId && !eventId && !queueStatus) return null;
  return { kind, sessionId, eventId, queueStatus };
}

function normalizeShadowRpcActiveSession(data: unknown): ShadowActiveSessionSnapshot | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  return normalizeUnknownActiveSession(row.active_session ?? row.activeSession ?? null);
}

function activeSessionSnapshot(activeSession: ActiveSession | null): ShadowActiveSessionSnapshot | null {
  if (!activeSession) return null;
  return {
    kind: activeSession.kind,
    sessionId: activeSession.sessionId,
    eventId: activeSession.eventId,
    queueStatus: activeSession.queueStatus ?? null,
  };
}

function activeSessionShadowKey(activeSession: ShadowActiveSessionSnapshot | null): string {
  if (!activeSession) return "null";
  return [
    activeSession.kind ?? "none",
    activeSession.sessionId ?? "none",
    activeSession.eventId ?? "none",
    activeSession.queueStatus ?? "none",
  ].join(":");
}

function shadowSnapshotsMatch(
  legacy: ShadowActiveSessionSnapshot | null,
  shadow: ShadowActiveSessionSnapshot | null,
): boolean {
  return activeSessionShadowKey(legacy) === activeSessionShadowKey(shadow);
}

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
    .select("id, event_id, participant_1_id, participant_2_id, ended_at, ended_reason, date_started_at, participant_1_joined_at, participant_2_joined_at, state, phase")
    .not("ended_at", "is", null)
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

async function syncReadyGateActiveSession(
  truth: ActiveSessionVideoTruth,
  userId: string,
  base: {
    sessionId: string;
    eventId: string;
    partnerName: string | null;
  },
  emitStaleActiveSessionDetected?: EmitStaleActiveSessionDetected,
): Promise<{ activeSession: ActiveSession | null; reason: string }> {
  const { data, error } = await supabase.rpc("ready_gate_transition", {
    p_session_id: base.sessionId,
    p_action: "sync",
    p_reason: "active_session_hydration",
  });

  if (error) {
    emitStaleActiveSessionDetected?.({
      reason: "ready_gate_sync_failed",
      eventId: base.eventId,
      sessionId: base.sessionId,
      queueStatus: "in_ready_gate",
      currentPartnerPresent: Boolean(getVideoSessionPartnerIdForUser(truth, userId)),
    });
    return { activeSession: null, reason: "ready_gate_sync_failed" };
  }

  const syncTruth = normalizeReadyGateTransitionActiveSessionTruth(data);
  const nowMs = Date.now();
  const canAttemptDaily = canAttemptDailyRoomFromVideoSessionTruth(truth, nowMs);
  const freshDateRoute =
    (canAttemptDaily || readyGateTransitionResultHasDateCapableTruth(syncTruth)) &&
    isActiveSessionDirectFallbackFresh(truth, nowMs);

  if (freshDateRoute) {
    return {
      activeSession: {
        kind: "video",
        ...base,
        queueStatus: inferVideoQueueStatusFromSessionTruth(truth),
      },
      reason: "ready_gate_sync_date_capable",
    };
  }

  const mergedTruth = {
    ...truth,
    ready_gate_status: syncTruth?.ready_gate_status ?? syncTruth?.status ?? truth?.ready_gate_status,
    ready_gate_expires_at: syncTruth?.ready_gate_expires_at ?? truth?.ready_gate_expires_at,
  };

  if (
    readyGateTransitionResultReadyGateEligible(syncTruth, nowMs) &&
    decideVideoSessionRouteFromTruth(mergedTruth, nowMs) === "navigate_ready"
  ) {
    return {
      activeSession: { kind: "ready_gate", ...base, queueStatus: "in_ready_gate" },
      reason: "ready_gate_sync_valid",
    };
  }

  emitStaleActiveSessionDetected?.({
    reason:
      syncTruth?.reason ??
      syncTruth?.error_code ??
      syncTruth?.code ??
      syncTruth?.error ??
      "ready_gate_sync_not_startable",
    eventId: base.eventId,
    sessionId: base.sessionId,
    queueStatus: "in_ready_gate",
    currentPartnerPresent: Boolean(getVideoSessionPartnerIdForUser(truth, userId)),
  });
  return { activeSession: null, reason: "ready_gate_sync_not_startable" };
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
  if (
    decision === "navigate_ready" &&
    !canAttemptDaily &&
    await isReadyGateSuppressedForSession(userId, candidate.event_id as string, candidate.id as string, nowMs)
  ) {
    return null;
  }

  const partnerId =
    candidate.participant_1_id === userId
        ? (candidate.participant_2_id as string | null)
        : (candidate.participant_1_id as string | null);
  let partnerName: string | null = null;
  if (partnerId) {
    partnerName = await fetchPartnerNameForViewer(partnerId);
  }

  const base = {
    sessionId: candidate.id as string,
    eventId: candidate.event_id as string,
    partnerName,
  };

  if (canAttemptDaily || decision === "navigate_date") {
    return {
      kind: "video",
      ...base,
      queueStatus: inferVideoQueueStatusFromSessionTruth(candidate),
    };
  }

  const synced = await syncReadyGateActiveSession(candidate, userId, base, emitStaleActiveSessionDetected);
  return synced.activeSession;
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
  const enabled = options?.enabled ?? true;
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const mounted = useRef(true);
  const lastHydrationDebugKey = useRef<string | null>(null);
  const staleActiveSessionEventKeyRef = useRef<string | null>(null);
  const checkInFlightRef = useRef<Promise<void> | null>(null);
  const checkQueuedRef = useRef(false);
  const shadowCompareKeyRef = useRef<string | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const commitActiveSession = useCallback((next: ActiveSession | null, reason: string) => {
    if (!mounted.current || !enabledRef.current) return;
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

  const runCheck = useCallback(async () => {
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
      const pendingSurvey = await findPendingPostDateSurveySession(userId, eventFilter, emitStaleActiveSessionDetected);
      if (pendingSurvey) {
        commitActiveSession(
          activeSessionFromPendingSurvey(pendingSurvey),
          pendingSurveyHydrationReason(pendingSurvey)
        );
        return;
      }
      const directSession = await findDirectVideoSessionFallback(userId, eventFilter, emitStaleActiveSessionDetected);
      if (directSession) {
        commitActiveSession(directSession, "direct_video_session_fallback");
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

    if (reg.queue_status === "in_ready_gate") {
      const pendingSurvey = await findPendingPostDateSurveySession(userId, eventFilter, emitStaleActiveSessionDetected);
      if (pendingSurvey) {
        commitActiveSession(
          activeSessionFromPendingSurvey(pendingSurvey),
          pendingSurveyHydrationReason(pendingSurvey)
        );
        return;
      }
      if (
        await isReadyGateSuppressedForSession(
          userId,
          reg.event_id as string,
          reg.current_room_id as string,
          Date.now(),
        )
      ) {
        commitActiveSession(null, "ready_gate_suppressed_after_manual_exit");
        return;
      }
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
        const synced = await syncReadyGateActiveSession(
          session,
          userId,
          base,
          emitStaleActiveSessionDetected,
        );
        commitActiveSession(synced.activeSession, synced.reason);
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
        const synced = await syncReadyGateActiveSession(
          session,
          userId,
          base,
          emitStaleActiveSessionDetected,
        );
        commitActiveSession(synced.activeSession, synced.reason);
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

  const check = useCallback(async () => {
    if (!enabled) return;

    if (checkInFlightRef.current) {
      checkQueuedRef.current = true;
      return checkInFlightRef.current;
    }

    const task = (async () => {
      do {
        checkQueuedRef.current = false;
        await runCheck();
      } while (mounted.current && enabled && checkQueuedRef.current);
    })().finally(() => {
      checkInFlightRef.current = null;
    });

    checkInFlightRef.current = task;
    return task;
  }, [enabled, runCheck]);

  useEffect(() => {
    if (!enabled) {
      setActiveSession(null);
      setHydrated(false);
      return;
    }
    void check();
  }, [enabled, check]);

  useEffect(() => {
    if (!enabled) return;
    const onVis = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [enabled, check]);

  useEffect(() => {
    if (!enabled || !userId) return;

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
  }, [enabled, userId, check]);

  useEffect(() => {
    if (!enabled || !userId || !eventFilter) return;

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
  }, [enabled, userId, eventFilter, check]);

  useEffect(() => {
    if (!enabled || !userId) return;
    const intervalId = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void check();
    }, ACTIVE_SESSION_POLL_MS);
    return () => clearInterval(intervalId);
  }, [enabled, userId, check]);

  useEffect(() => {
    if (!enabled || !hydrated || !userId || !isActiveSessionContextShadowEnabled()) return;
    const legacySnapshot = activeSessionSnapshot(activeSession);
    const compareKey = `${userId}:${eventFilter ?? "*"}:${activeSessionShadowKey(legacySnapshot)}`;
    if (shadowCompareKeyRef.current === compareKey) return;
    shadowCompareKeyRef.current = compareKey;

    let cancelled = false;
    void (async () => {
      const rpc = supabase.rpc as unknown as (
        fn: "get_active_session_context",
        args: { p_event_id: string | null },
      ) => Promise<ShadowRpcResult>;
      const { data, error } = await rpc("get_active_session_context", { p_event_id: eventFilter });
      if (cancelled) return;

      if (error) {
        trackEvent("active_session_context_shadow_error", {
          platform: "web",
          scoped_event_id: eventFilter,
          legacy_session_present: Boolean(legacySnapshot),
          message: error.message ?? "unknown",
        });
        return;
      }

      const shadowSnapshot = normalizeShadowRpcActiveSession(data);
      if (!shadowSnapshotsMatch(legacySnapshot, shadowSnapshot)) {
        trackEvent("active_session_context_shadow_mismatch", {
          platform: "web",
          scoped_event_id: eventFilter,
          legacy_kind: legacySnapshot?.kind ?? null,
          legacy_session_present: Boolean(legacySnapshot?.sessionId),
          legacy_event_id: legacySnapshot?.eventId ?? null,
          legacy_queue_status: legacySnapshot?.queueStatus ?? null,
          shadow_kind: shadowSnapshot?.kind ?? null,
          shadow_session_present: Boolean(shadowSnapshot?.sessionId),
          shadow_event_id: shadowSnapshot?.eventId ?? null,
          shadow_queue_status: shadowSnapshot?.queueStatus ?? null,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeSession, enabled, eventFilter, hydrated, userId]);

  const stable = useMemo(
    () => ({ activeSession, hydrated, refetch: check }),
    [activeSession, hydrated, check]
  );

  return stable;
}
