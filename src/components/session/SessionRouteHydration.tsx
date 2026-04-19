import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useUserProfile } from "@/contexts/AuthContext";
import { useSessionHydration } from "@/contexts/SessionHydrationContext";
import { supabase } from "@/integrations/supabase/client";
import { clearDateEntryTransition, isDateEntryTransitionActive } from "@/lib/dateEntryTransitionLatch";

function sessionIndicatesHandshakeOrDate(
  row: { state?: string | null; phase?: string | null; handshake_started_at?: string | null } | null
): boolean {
  return Boolean(
    row &&
      (row.state === "handshake" ||
        row.state === "date" ||
        row.phase === "handshake" ||
        row.phase === "date" ||
        row.handshake_started_at)
  );
}

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

    if (isDateEntryTransitionActive(sessionIdFromUrl)) {
      routeHydrationDebug("blocked ready_gate bounce during date-entry latch", {
        sessionId: sessionIdFromUrl,
      });
      return;
    }

    let cancelled = false;
    void (async () => {
      const { data: vs, error } = await supabase
        .from("video_sessions")
        .select("ended_at, state, phase, handshake_started_at")
        .eq("id", sessionIdFromUrl)
        .maybeSingle();

      if (cancelled) return;

      if (error || !vs) {
        routeHydrationDebug("blocked ready_gate bounce; video session unavailable", {
          sessionId: sessionIdFromUrl,
          error: error?.message,
        });
        return;
      }

      if (vs.ended_at) {
        clearDateEntryTransition(sessionIdFromUrl);
        routeHydrationDebug("blocked ready_gate bounce; video session ended", {
          sessionId: sessionIdFromUrl,
        });
        return;
      }

      if (sessionIndicatesHandshakeOrDate(vs)) {
        routeHydrationDebug("blocked ready_gate bounce; video session is date-capable", {
          sessionId: sessionIdFromUrl,
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
      navigate(`/event/${encodeURIComponent(activeSession.eventId)}/lobby`, { replace: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id, hydrated, activeSession, location.pathname, navigate]);

  return null;
}
