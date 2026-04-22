import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { vdbg } from "@/lib/vdbg";
import { useUserProfile } from "@/contexts/AuthContext";
import { trackEvent } from "@/lib/analytics";
import { VIDEO_DATE_RECONNECT_SYNC_OUTCOMES } from "@clientShared/matching/videoDateDiagnostics";
import { nextConvergenceDelayMs } from "@clientShared/matching/convergenceScheduling";

export type VideoDatePhase = "handshake" | "date" | "ended";

interface UseReconnectionOptions {
  sessionId: string | undefined;
  isConnected: boolean;
  phase: VideoDatePhase;
  onReconnected?: () => void;
  /** Fired when server ends session due to reconnect grace expiry only */
  onGraceExpired?: () => void;
}

type SyncPayload = {
  reconnect_grace_ends_at: string | null;
  ended: boolean;
  ended_reason: string | null;
  partner_marked_away: boolean;
};

export const useReconnection = ({
  sessionId,
  isConnected,
  phase,
  onReconnected,
  onGraceExpired,
}: UseReconnectionOptions) => {
  const { user } = useUserProfile();
  const [graceTimeLeft, setGraceTimeLeft] = useState(0);
  /** True when Daily reports partner left or server marks partner away */
  const [inReconnectGraceUi, setInReconnectGraceUi] = useState(false);
  /** After we've had at least one Daily connected state (used for partner-away RPC + reconnect return). */
  const hadConnectedOnceRef = useRef(false);
  const prevIsConnectedRef = useRef(false);
  const onGraceExpiredRef = useRef(onGraceExpired);
  const onReconnectedRef = useRef(onReconnected);
  const graceExpiredFiredRef = useRef(false);
  const graceWindowStartedRef = useRef(false);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncCountRef = useRef(0);
  const syncWindowStartedAtRef = useRef<number | null>(null);
  const requestSyncReconnectRef = useRef<(reason: string) => void>(() => {});

  useEffect(() => {
    onGraceExpiredRef.current = onGraceExpired;
    onReconnectedRef.current = onReconnected;
  }, [onGraceExpired, onReconnected]);

  const fetchSync = useCallback(async (): Promise<SyncPayload | null> => {
    if (!sessionId) return null;
    const args = {
      p_session_id: sessionId,
      p_action: "sync_reconnect",
    };
    vdbg("video_date_transition_before", { action: "sync_reconnect", args });
    const { data, error } = await supabase.rpc("video_date_transition", args);
    vdbg("video_date_transition_after", {
      action: "sync_reconnect",
      ok: !error,
      payload: data ?? null,
      error: error ? { code: error.code, message: error.message } : null,
    });
    if (error) return null;
    const p = data as {
      success?: boolean;
      reconnect_grace_ends_at?: string | null;
      ended?: boolean;
      ended_reason?: string | null;
      partner_marked_away?: boolean;
    } | null;
    return {
      reconnect_grace_ends_at: p?.reconnect_grace_ends_at ?? null,
      ended: p?.ended === true,
      ended_reason: p?.ended_reason ?? null,
      partner_marked_away: p?.partner_marked_away === true,
    };
  }, [sessionId]);

  const clearSyncTimer = useCallback(() => {
    if (!syncTimerRef.current) return;
    clearTimeout(syncTimerRef.current);
    syncTimerRef.current = null;
  }, []);

  const nextSyncDelayMs = useCallback((elapsedMs: number) => nextConvergenceDelayMs(elapsedMs), []);

  // Server-owned reconnect truth: event-driven immediate sync + bounded backoff while uncertain.
  useEffect(() => {
    if (!sessionId || phase === "ended") return;
    let cancelled = false;
    let inFlight = false;

    const stopLoop = (reason: string) => {
      clearSyncTimer();
      if (syncWindowStartedAtRef.current !== null) {
        vdbg("sync_reconnect_loop_stop", {
          sessionId,
          phase,
          reason,
          totalSyncCount: syncCountRef.current,
          elapsedMs: Date.now() - syncWindowStartedAtRef.current,
        });
      }
      syncWindowStartedAtRef.current = null;
    };

    const scheduleBackoff = (reason: string) => {
      if (cancelled) return;
      const startedAt = syncWindowStartedAtRef.current ?? Date.now();
      syncWindowStartedAtRef.current = startedAt;
      const delayMs = nextSyncDelayMs(Math.max(0, Date.now() - startedAt));
      clearSyncTimer();
      vdbg("sync_reconnect_schedule", {
        sessionId,
        phase,
        reason,
        mode: "backoff",
        delayMs,
        totalSyncCount: syncCountRef.current,
      });
      syncTimerRef.current = setTimeout(() => {
        void runSync(reason, "backoff");
      }, delayMs);
    };

    const runSync = async (reason: string, mode: "immediate" | "backoff") => {
      if (cancelled) return;
      if (inFlight) {
        vdbg("sync_reconnect_skip", { sessionId, phase, reason, mode, skip: "in_flight" });
        return;
      }
      inFlight = true;
      syncCountRef.current += 1;
      vdbg("sync_reconnect_fire", {
        sessionId,
        phase,
        reason,
        mode,
        totalSyncCount: syncCountRef.current,
      });
      try {
        const r = await fetchSync();
        if (cancelled) return;
        if (!r) {
          vdbg("sync_reconnect_result", {
            sessionId,
            phase,
            reason,
            mode,
            outcome: VIDEO_DATE_RECONNECT_SYNC_OUTCOMES.RPC_ERROR,
          });
          scheduleBackoff("rpc_error");
          return;
        }

        if (r.ended) {
          vdbg("sync_reconnect_result", {
            sessionId,
            phase,
            reason,
            mode,
            outcome: VIDEO_DATE_RECONNECT_SYNC_OUTCOMES.ENDED,
            endedReason: r.ended_reason ?? null,
          });
          if (r.ended_reason === "reconnect_grace_expired" && !graceExpiredFiredRef.current) {
            graceExpiredFiredRef.current = true;
            if (graceWindowStartedRef.current) {
              trackEvent("video_date_reconnect_grace_expired", {
                session_id: sessionId,
                phase,
              });
              graceWindowStartedRef.current = false;
            }
            onGraceExpiredRef.current?.();
          }
          setInReconnectGraceUi(false);
          setGraceTimeLeft(0);
          stopLoop("session_ended");
          return;
        }

        graceExpiredFiredRef.current = false;

        const hasGrace = !!r.reconnect_grace_ends_at;
        const show = hasGrace && r.partner_marked_away;
        setInReconnectGraceUi(show);
        vdbg("sync_reconnect_result", {
          sessionId,
          phase,
          reason,
          mode,
          outcome: VIDEO_DATE_RECONNECT_SYNC_OUTCOMES.OK,
          hasGrace,
          partnerMarkedAway: r.partner_marked_away,
        });

        if (hasGrace && r.reconnect_grace_ends_at) {
          const sec = Math.max(
            0,
            Math.ceil((new Date(r.reconnect_grace_ends_at).getTime() - Date.now()) / 1000),
          );
          setGraceTimeLeft(sec);
          scheduleBackoff(show ? "reconnect_grace_active" : "grace_active_partner_not_marked_away");
          return;
        }

        setGraceTimeLeft(0);
        stopLoop("truth_stable_no_grace");
      } finally {
        inFlight = false;
      }
    };

    requestSyncReconnectRef.current = (reason: string) => {
      if (cancelled) return;
      if (syncWindowStartedAtRef.current === null) {
        syncWindowStartedAtRef.current = Date.now();
      }
      void runSync(reason, "immediate");
    };

    requestSyncReconnectRef.current("mount_or_phase_change");
    return () => {
      cancelled = true;
      clearSyncTimer();
      requestSyncReconnectRef.current = () => {};
    };
  }, [sessionId, phase, fetchSync, clearSyncTimer, nextSyncDelayMs]);

  useEffect(() => {
    syncCountRef.current = 0;
    syncWindowStartedAtRef.current = null;
    clearSyncTimer();
  }, [sessionId, clearSyncTimer]);

  useEffect(() => {
    const prev = prevIsConnectedRef.current;
    prevIsConnectedRef.current = isConnected;

    if (!isConnected) {
      return;
    }

    if (!hadConnectedOnceRef.current) {
      hadConnectedOnceRef.current = true;
      return;
    }

    // Disconnected → connected again: clear our away slot (partner may have reported us while we were gone).
    if (!prev && sessionId && phase !== "ended") {
      if (graceWindowStartedRef.current) {
        trackEvent("video_date_reconnect_returned", {
          session_id: sessionId,
          phase,
        });
        graceWindowStartedRef.current = false;
      }
      const args = {
        p_session_id: sessionId,
        p_action: "mark_reconnect_return",
      };
      vdbg("video_date_transition_before", { action: "mark_reconnect_return", args });
      void (async () => {
        try {
          const { data, error } = await supabase.rpc("video_date_transition", args);
          vdbg("video_date_transition_after", {
            action: "mark_reconnect_return",
            ok: !error,
            payload: data ?? null,
            error: error ? { code: error.code, message: error.message } : null,
          });
        } catch (error) {
          vdbg("video_date_transition_after", {
            action: "mark_reconnect_return",
            ok: false,
            error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
          });
        }
      })();
      setInReconnectGraceUi(false);
      onReconnectedRef.current?.();
      requestSyncReconnectRef.current("daily_reconnected");
    }
  }, [isConnected, sessionId, phase]);

  const startGraceWindow = useCallback(() => {
    if (!hadConnectedOnceRef.current || !sessionId || phase === "ended") return;
    if (graceWindowStartedRef.current) return;

    graceWindowStartedRef.current = true;
    setInReconnectGraceUi(true);
    trackEvent("video_date_reconnect_grace_started", {
      session_id: sessionId,
      phase,
    });

    const args = {
      p_session_id: sessionId,
      p_action: "mark_reconnect_partner_away",
    };
    vdbg("video_date_transition_before", { action: "mark_reconnect_partner_away", args });
    void (async () => {
      try {
        const { data, error } = await supabase.rpc("video_date_transition", args);
        vdbg("video_date_transition_after", {
          action: "mark_reconnect_partner_away",
          ok: !error,
          payload: data ?? null,
          error: error ? { code: error.code, message: error.message } : null,
        });
      } catch (error) {
        vdbg("video_date_transition_after", {
          action: "mark_reconnect_partner_away",
          ok: false,
          error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
        });
      }
    })();
    requestSyncReconnectRef.current("partner_marked_away");
  }, [sessionId, phase]);

  const checkActiveSession = useCallback(async (): Promise<{
    hasActiveSession: boolean;
    sessionId?: string;
    eventId?: string;
  }> => {
    if (!user?.id) return { hasActiveSession: false };

    const { data: reg } = await supabase
      .from("event_registrations")
      .select("event_id, current_room_id, queue_status")
      .eq("profile_id", user.id)
      .in("queue_status", ["in_handshake", "in_date"])
      .maybeSingle();

    if (reg?.current_room_id) {
      const { data: session } = await supabase
        .from("video_sessions")
        .select("id, ended_at")
        .eq("id", reg.current_room_id)
        .is("ended_at", null)
        .maybeSingle();

      if (session) {
        return {
          hasActiveSession: true,
          sessionId: session.id,
          eventId: reg.event_id,
        };
      }
    }

    return { hasActiveSession: false };
  }, [user?.id]);

  const isPartnerDisconnected = inReconnectGraceUi;
  const isTimerPaused = inReconnectGraceUi;

  return {
    isPartnerDisconnected,
    graceTimeLeft,
    isTimerPaused,
    startGraceWindow,
    checkActiveSession,
  };
};
