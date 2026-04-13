import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useUserProfile } from "@/contexts/AuthContext";
import { useSessionHydration } from "@/contexts/NotificationContext";
import { supabase } from "@/integrations/supabase/client";

/**
 * Backend-truth-first: reconcile URL with registration + video_sessions before relying on local route state.
 * Redirects when `/date/:id` contradicts backend (still in Ready Gate, or session already ended).
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
      return;
    }

    let cancelled = false;
    void (async () => {
      const { data: vs } = await supabase
        .from("video_sessions")
        .select("ended_at, event_id")
        .eq("id", sessionIdFromUrl)
        .maybeSingle();

      if (cancelled || !vs?.ended_at) return;

      if (vs.event_id) {
        navigate(`/event/${encodeURIComponent(vs.event_id)}/lobby`, { replace: true });
      } else {
        navigate("/home", { replace: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id, hydrated, activeSession, location.pathname, navigate]);

  return null;
}
