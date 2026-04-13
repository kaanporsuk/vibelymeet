import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useUserProfile } from "@/contexts/AuthContext";
import { useSessionHydration } from "@/contexts/SessionHydrationContext";

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

    if (activeSession?.sessionId === sessionIdFromUrl && activeSession.kind === "ready_gate") {
      const key = `${sessionIdFromUrl}:ready_gate`;
      if (lastReadyGateRedirectKey.current === key) return;
      lastReadyGateRedirectKey.current = key;

      navigate(`/event/${encodeURIComponent(activeSession.eventId)}/lobby`, { replace: true });
    }
  }, [user?.id, hydrated, activeSession, location.pathname, navigate]);

  return null;
}
