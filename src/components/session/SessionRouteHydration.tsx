import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useUserProfile } from "@/contexts/AuthContext";
import { useSessionHydration } from "@/contexts/NotificationContext";

/**
 * Backend-truth-first: reconcile URL with registration + video_sessions before relying on local route state.
 * Minimal redirects — only when backend clearly contradicts `/date/:id` (still in Ready Gate).
 */
export function SessionRouteHydration() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useUserProfile();
  const { activeSession, hydrated } = useSessionHydration();
  const lastRedirectKey = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.id || !hydrated) return;

    const m = location.pathname.match(/^\/date\/([^/]+)\/?$/);
    if (!m) return;
    const sessionIdFromUrl = m[1];

    if (activeSession?.sessionId !== sessionIdFromUrl) return;

    if (activeSession.kind !== "ready_gate") return;

    const key = `${sessionIdFromUrl}:ready_gate`;
    if (lastRedirectKey.current === key) return;
    lastRedirectKey.current = key;

    navigate(`/event/${encodeURIComponent(activeSession.eventId)}/lobby`, { replace: true });
  }, [user?.id, hydrated, activeSession, location.pathname, navigate]);

  return null;
}
