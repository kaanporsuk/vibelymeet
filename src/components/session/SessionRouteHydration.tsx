import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useUserProfile } from "@/contexts/AuthContext";
import { vdbg } from "@/lib/vdbg";
import { useSessionHydration } from "@/contexts/SessionHydrationContext";
import { supabase } from "@/integrations/supabase/client";
import {
  isDateEntryTransitionActive,
  markVideoDateRouteOwned,
  videoDateNavigationIntents,
} from "@/lib/videoDateNavigationIntents";
import { fetchVideoDateSessionRow } from "@/lib/videoDateSessionRow";
import { canonicalVideoDateRouteLogDetail } from "@clientShared/matching/videoDateRouteDecision";
import { decideVideoDateSurfaceRoute } from "@clientShared/videoDate/routeDecision";

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
  const lastActiveVideoRedirectKey = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.id || !hydrated) return;

    const m = location.pathname.match(/^\/date\/([^/]+)\/?$/);
    const sessionIdFromUrl = m?.[1] ?? null;
    const routeState =
      location.state && typeof location.state === "object"
        ? (location.state as { forceSurvey?: unknown })
        : null;
    if (!m) {
      lastReadyGateRedirectKey.current = null;
    }

    if (activeSession?.kind === "video" && activeSession.sessionId) {
      markVideoDateRouteOwned(activeSession.sessionId, user.id);
      const forceSurvey = activeSession.queueStatus === "in_survey";
      if (sessionIdFromUrl !== activeSession.sessionId) {
        const key = [
          activeSession.sessionId,
          activeSession.queueStatus,
          location.pathname,
          forceSurvey ? "force_survey" : "active_video",
        ].join(":");
        if (lastActiveVideoRedirectKey.current === key) return;
        lastActiveVideoRedirectKey.current = key;
        const target = `/date/${encodeURIComponent(activeSession.sessionId)}`;
        routeHydrationDebug("redirecting to active video date owner", {
          sessionId: activeSession.sessionId,
          eventId: activeSession.eventId,
          queueStatus: activeSession.queueStatus,
          forceSurvey,
          target,
          currentPath: location.pathname,
        });
        vdbg("route_hydration_active_video_redirect", {
          sessionId: activeSession.sessionId,
          userId: user.id,
          eventId: activeSession.eventId,
          queueStatus: activeSession.queueStatus,
          forceSurvey,
          currentPath: location.pathname,
          target,
        });
        navigate(target, {
          replace: true,
          state: {
            source: "session_route_hydration_active_video",
            forceSurvey,
          },
        });
        return;
      }
      if (forceSurvey && routeState?.forceSurvey !== true) {
        const key = [
          activeSession.sessionId,
          activeSession.queueStatus,
          location.pathname,
          "same_route_force_survey",
        ].join(":");
        if (lastActiveVideoRedirectKey.current === key) return;
        lastActiveVideoRedirectKey.current = key;
        const target = `/date/${encodeURIComponent(activeSession.sessionId)}`;
        routeHydrationDebug("pinning active video same-route survey owner", {
          sessionId: activeSession.sessionId,
          eventId: activeSession.eventId,
          queueStatus: activeSession.queueStatus,
          target,
        });
        vdbg("route_hydration_active_video_same_session_survey", {
          sessionId: activeSession.sessionId,
          userId: user.id,
          eventId: activeSession.eventId,
          queueStatus: activeSession.queueStatus,
          currentPath: location.pathname,
          target,
        });
        navigate(target, {
          replace: true,
          state: {
            source: "session_route_hydration_active_video_same_session_survey",
            forceSurvey: true,
          },
        });
        return;
      }
      lastActiveVideoRedirectKey.current = null;
    } else {
      lastActiveVideoRedirectKey.current = null;
    }

    if (!sessionIdFromUrl) return;

    if (
      activeSession?.sessionId !== sessionIdFromUrl ||
      activeSession.kind !== "ready_gate"
    )
      return;

    const latchActiveAtStart = isDateEntryTransitionActive(sessionIdFromUrl);

    let cancelled = false;
    void (async () => {
      const { data: vs, error } = await fetchVideoDateSessionRow(sessionIdFromUrl);

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
        routeHydrationDebug(
          "blocked ready_gate bounce; video session unavailable",
          {
            sessionId: sessionIdFromUrl,
            error: error?.message,
          },
        );
        vdbg("route_hydration_ready_gate_bounce_blocked", {
          sessionId: sessionIdFromUrl,
          userId: user.id,
          eventId: activeSession.eventId,
          reason: "video_session_unavailable",
          latchActive: latchActiveAtStart,
        });
        return;
      }

      // Video Date decisions are delegated to the shared controller's single
      // surface-route decision; this component keeps only navigation effects.
      const decision = decideVideoDateSurfaceRoute({
        surface: "route_hydration",
        sessionId: sessionIdFromUrl,
        profileId: user.id,
        intents: videoDateNavigationIntents,
        routeStateForceSurvey: routeState?.forceSurvey === true,
        canonicalInput: {
          eventId: activeSession.eventId,
          truth: vs,
          registration: {
            queue_status: activeSession.queueStatus,
            current_room_id: sessionIdFromUrl,
            event_id: activeSession.eventId,
          },
        },
      });
      const canonicalLog = decision.canonical
        ? canonicalVideoDateRouteLogDetail(decision.canonical, {
            sourceSurface: "session_route_hydration",
            sourceAction: "date_route_guard",
          })
        : {};

      if (decision.target === "survey") {
        if (decision.navigate) {
          const target = `/date/${encodeURIComponent(sessionIdFromUrl)}`;
          routeHydrationDebug("pinning ended date route to survey owner", {
            sessionId: sessionIdFromUrl,
            target,
          });
          navigate(target, {
            replace: true,
            state: {
              source: "session_route_hydration_terminal_survey",
              forceSurvey: true,
            },
          });
        }
        vdbg("route_hydration_ready_gate_bounce_blocked", {
          sessionId: sessionIdFromUrl,
          userId: user.id,
          eventId: activeSession.eventId,
          reason: "pending_survey_terminal_encounter",
          ...canonicalLog,
          endedAt: vs.ended_at,
          latchActive: latchActiveAtStart,
        });
        return;
      }

      if (decision.target === "ended") {
        routeHydrationDebug("blocked ready_gate bounce; video session ended", {
          sessionId: sessionIdFromUrl,
        });
        vdbg("route_hydration_ready_gate_bounce_blocked", {
          sessionId: sessionIdFromUrl,
          userId: user.id,
          eventId: activeSession.eventId,
          reason: "video_session_ended",
          ...canonicalLog,
          endedAt: vs.ended_at,
          latchActive: latchActiveAtStart,
        });
        return;
      }

      if (decision.target === "date") {
        routeHydrationDebug("blocked ready_gate bounce; date route stays owned", {
          sessionId: sessionIdFromUrl,
          state: vs.state,
          phase: vs.phase,
          entryStarted: Boolean(vs.entry_started_at),
          suppressedBy: decision.suppressedBy,
        });
        vdbg("route_hydration_ready_gate_bounce_blocked", {
          sessionId: sessionIdFromUrl,
          userId: user.id,
          eventId: activeSession.eventId,
          reason:
            decision.suppressedBy === "entry_latch"
              ? "date_entry_latch"
              : decision.suppressedBy === "route_ownership"
                ? "date_route_ownership"
                : decision.canonical?.canAttemptDaily
                  ? "video_session_daily_startable"
                  : "video_session_entry_or_date",
          ...canonicalLog,
          routed_to: "date",
          state: vs.state,
          phase: vs.phase,
          entryStarted: Boolean(vs.entry_started_at),
          readyGateStatus: vs.ready_gate_status ?? null,
          readyGateExpiresAt: vs.ready_gate_expires_at ?? null,
          latchActive: latchActiveAtStart,
        });
        return;
      }

      if (decision.target === "ready") {
        const key = `${sessionIdFromUrl}:ready_gate`;
        if (lastReadyGateRedirectKey.current === key) return;
        lastReadyGateRedirectKey.current = key;
        const target = `/ready/${encodeURIComponent(sessionIdFromUrl)}`;
        routeHydrationDebug(
          "redirecting date route back to canonical Ready Gate",
          {
            sessionId: sessionIdFromUrl,
            eventId: activeSession.eventId,
            canonicalReason: decision.reason,
            target,
          },
        );
        vdbg("route_hydration_ready_gate_canonical_redirect", {
          sessionId: sessionIdFromUrl,
          userId: user.id,
          eventId: activeSession.eventId,
          reason: "canonical_ready_gate_not_date_capable",
          ...canonicalLog,
          target,
          latchActive: latchActiveAtStart,
          state: vs.state,
          phase: vs.phase,
          entryStarted: Boolean(vs.entry_started_at),
          readyGateStatus: vs.ready_gate_status ?? null,
          readyGateExpiresAt: vs.ready_gate_expires_at ?? null,
        });
        navigate(target, {
          replace: true,
          state: {
            source: "session_route_hydration_ready_gate_canonical",
          },
        });
        return;
      }

      const key = `${sessionIdFromUrl}:lobby`;
      if (lastReadyGateRedirectKey.current === key) return;
      lastReadyGateRedirectKey.current = key;
      const target = `/event/${encodeURIComponent(activeSession.eventId)}/lobby`;
      routeHydrationDebug("redirecting date route back to canonical surface", {
        sessionId: sessionIdFromUrl,
        eventId: activeSession.eventId,
        target,
      });
      vdbg("route_hydration_ready_gate_bounce", {
        sessionId: sessionIdFromUrl,
        userId: user.id,
        eventId: activeSession.eventId,
        reason: decision.reason,
        ...canonicalLog,
        latchActive: false,
        state: vs.state,
        phase: vs.phase,
        entryStarted: Boolean(vs.entry_started_at),
      });
      navigate(target, { replace: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    user?.id,
    hydrated,
    activeSession,
    location.pathname,
    location.state,
    navigate,
  ]);

  return null;
}
