import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useUserProfile } from "@/contexts/AuthContext";
import { vdbg } from "@/lib/vdbg";
import { useSessionHydration } from "@/contexts/SessionHydrationContext";
import { supabase } from "@/integrations/supabase/client";
import { clearDateEntryTransition, isDateEntryTransitionActive } from "@/lib/dateEntryTransitionLatch";
import {
  canAttemptDailyRoomFromVideoSessionTruth,
  decideVideoSessionRouteFromTruth,
} from "@clientShared/matching/activeSession";

function routeHydrationDebug(message: string, data?: Record<string, unknown>) {
  if (!import.meta.env.DEV) return;
  console.log(`[SessionRouteHydration] ${message}`, data ?? {});
}

/**
 * Primary URL-level owner for `/date/:id` when hydrated active session says **ready_gate**
 * for the same session id → send user to event lobby (where Ready Gate overlay opens).
 *
 * **Defense-in-depth:** `VideoDate` still enforces participant / `in_ready_gate` / `ended_at`
 * during its load effect so deep links work before hydration completes (race window).
 *
 * **Ended sessions:** corrected in `VideoDate` load (toast + navigate), not here — avoids
 * duplicate `video_sessions` ended checks racing the same screen.
 */
export function SessionRouteHydration() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useUserProfile();
  const { activeSession, hydrated } = useSessionHydration();
  const lastReadyGateRedirectKey = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.id || !hydrated) return;

    const m = location.pathname.match(/^\/date\/([^/]+)\/?$/);
    if (!m) {
      lastReadyGateRedirectKey.current = null;
      return;
    }
    const sessionIdFromUrl = m[1];

    if (activeSession?.sessionId !== sessionIdFromUrl || activeSession.kind !== "ready_gate") return;

    const latchActiveAtStart = isDateEntryTransitionActive(sessionIdFromUrl);

    let cancelled = false;
    void (async () => {
      const { data: vs, error } = await supabase
        .from("video_sessions")
        .select("ended_at, state, phase, handshake_started_at, date_started_at, ready_gate_status, ready_gate_expires_at")
        .eq("id", sessionIdFromUrl)
        .maybeSingle();

      if (cancelled) return;

      vdbg("route_hydration_date_guard", {
        sessionId: sessionIdFromUrl,
        userId: user.id,
        eventId: activeSession.eventId,
        activeSessionKind: activeSession.kind,
        activeSessionQueueStatus: activeSession.queueStatus,
        latchActive: latchActiveAtStart,
        row: vs ?? null,
        error: error ? { code: error.code, message: error.message } : null,
      });

      if (error || !vs) {
        routeHydrationDebug("blocked ready_gate bounce; video session unavailable", {
          sessionId: sessionIdFromUrl,
          error: error?.message,
        });
        vdbg("route_hydration_ready_gate_bounce_blocked", {
          sessionId: sessionIdFromUrl,
          userId: user.id,
          eventId: activeSession.eventId,
          reason: "video_session_unavailable",
          latchActive: latchActiveAtStart,
        });
        return;
      }

      const truthDecision = decideVideoSessionRouteFromTruth(vs);
      const canAttemptDaily = canAttemptDailyRoomFromVideoSessionTruth(vs);

      if (truthDecision === "ended") {
        clearDateEntryTransition(sessionIdFromUrl);
        routeHydrationDebug("blocked ready_gate bounce; video session ended", {
          sessionId: sessionIdFromUrl,
        });
        vdbg("route_hydration_ready_gate_bounce_blocked", {
          sessionId: sessionIdFromUrl,
          userId: user.id,
          eventId: activeSession.eventId,
          reason: "video_session_ended",
          endedAt: vs.ended_at,
          latchActive: latchActiveAtStart,
        });
        return;
      }

      if (canAttemptDaily || truthDecision === "navigate_date") {
        routeHydrationDebug("blocked ready_gate bounce; video session is date-capable", {
          sessionId: sessionIdFromUrl,
          state: vs.state,
          phase: vs.phase,
          handshakeStarted: Boolean(vs.handshake_started_at),
          canAttemptDaily,
        });
        vdbg("route_hydration_ready_gate_bounce_blocked", {
          sessionId: sessionIdFromUrl,
          userId: user.id,
          eventId: activeSession.eventId,
          reason: canAttemptDaily ? "video_session_daily_startable" : "video_session_handshake_or_date",
          canAttemptDaily,
          routed_to: "date",
          state: vs.state,
          phase: vs.phase,
          handshakeStarted: Boolean(vs.handshake_started_at),
          readyGateStatus: vs.ready_gate_status ?? null,
          readyGateExpiresAt: vs.ready_gate_expires_at ?? null,
          latchActive: latchActiveAtStart,
        });
        return;
      }

      if (latchActiveAtStart || isDateEntryTransitionActive(sessionIdFromUrl)) {
        routeHydrationDebug("blocked ready_gate bounce during date-entry latch", {
          sessionId: sessionIdFromUrl,
        });
        vdbg("route_hydration_ready_gate_bounce_blocked", {
          sessionId: sessionIdFromUrl,
          userId: user.id,
          eventId: activeSession.eventId,
          reason: "date_entry_latch",
          latchActive: true,
          state: vs.state,
          phase: vs.phase,
          handshakeStarted: Boolean(vs.handshake_started_at),
        });
        return;
      }

      const key = `${sessionIdFromUrl}:ready_gate`;
      if (lastReadyGateRedirectKey.current === key) return;
      lastReadyGateRedirectKey.current = key;
      routeHydrationDebug("redirecting date route back to ready gate lobby", {
        sessionId: sessionIdFromUrl,
        eventId: activeSession.eventId,
      });
      vdbg("route_hydration_ready_gate_bounce", {
        sessionId: sessionIdFromUrl,
        userId: user.id,
        eventId: activeSession.eventId,
        reason: "ready_gate_active_without_date_latch_or_handshake",
        latchActive: false,
        state: vs.state,
        phase: vs.phase,
        handshakeStarted: Boolean(vs.handshake_started_at),
      });
      navigate(`/event/${encodeURIComponent(activeSession.eventId)}/lobby`, { replace: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id, hydrated, activeSession, location.pathname, navigate]);

  return null;
}
