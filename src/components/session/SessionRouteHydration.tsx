import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useUserProfile } from "@/contexts/AuthContext";
import { vdbg } from "@/lib/vdbg";
import { useSessionHydration } from "@/contexts/SessionHydrationContext";
import { supabase } from "@/integrations/supabase/client";
import {
  clearDateEntryTransition,
  clearVideoDateRouteOwnership,
  isDateEntryTransitionActive,
  markVideoDateRouteOwned,
} from "@/lib/dateEntryTransitionLatch";
import { videoSessionHasPostDateSurveyTruth } from "@clientShared/matching/activeSession";
import {
  canonicalVideoDateRouteLogDetail,
  decideCanonicalVideoDateRoute,
} from "@clientShared/matching/videoDateRouteDecision";

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
      const { data: vs, error } = await supabase
        .from("video_sessions")
        .select(
          "ended_at, ended_reason, state, phase, handshake_started_at, date_started_at, participant_1_joined_at, participant_2_joined_at, participant_1_remote_seen_at, participant_2_remote_seen_at, ready_gate_status, ready_gate_expires_at, daily_room_name, daily_room_url",
        )
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

      const canonicalRoute = decideCanonicalVideoDateRoute({
        sessionId: sessionIdFromUrl,
        eventId: activeSession.eventId,
        truth: vs,
        registration: {
          queue_status: activeSession.queueStatus,
          current_room_id: sessionIdFromUrl,
          event_id: activeSession.eventId,
        },
      });
      const canonicalLog = canonicalVideoDateRouteLogDetail(canonicalRoute, {
        sourceSurface: "session_route_hydration",
        sourceAction: "date_route_guard",
      });
      const canAttemptDaily = canonicalRoute.canAttemptDaily;

      if (
        canonicalRoute.target === "ended" ||
        canonicalRoute.target === "survey"
      ) {
        const pendingSurveyTerminalEncounter =
          canonicalRoute.target === "survey" || videoSessionHasPostDateSurveyTruth(vs);
        if (pendingSurveyTerminalEncounter) {
          markVideoDateRouteOwned(sessionIdFromUrl, user.id);
          if (routeState?.forceSurvey !== true) {
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
        } else {
          clearDateEntryTransition(sessionIdFromUrl);
        }
        routeHydrationDebug("blocked ready_gate bounce; video session ended", {
          sessionId: sessionIdFromUrl,
          pendingSurveyTerminalEncounter,
        });
        vdbg("route_hydration_ready_gate_bounce_blocked", {
          sessionId: sessionIdFromUrl,
          userId: user.id,
          eventId: activeSession.eventId,
          reason: pendingSurveyTerminalEncounter
            ? "pending_survey_terminal_encounter"
            : "video_session_ended",
          ...canonicalLog,
          canonicalTarget: canonicalRoute.target,
          canonicalReason: canonicalRoute.reason,
          endedAt: vs.ended_at,
          latchActive: latchActiveAtStart,
        });
        return;
      }

      if (canonicalRoute.target === "date") {
        markVideoDateRouteOwned(sessionIdFromUrl, user.id);
        routeHydrationDebug(
          "blocked ready_gate bounce; video session is date-capable",
          {
            sessionId: sessionIdFromUrl,
            state: vs.state,
            phase: vs.phase,
            handshakeStarted: Boolean(vs.handshake_started_at),
            canAttemptDaily,
          },
        );
        vdbg("route_hydration_ready_gate_bounce_blocked", {
          sessionId: sessionIdFromUrl,
          userId: user.id,
          eventId: activeSession.eventId,
          reason: canAttemptDaily
            ? "video_session_daily_startable"
            : "video_session_handshake_or_date",
          ...canonicalLog,
          canonicalTarget: canonicalRoute.target,
          canonicalReason: canonicalRoute.reason,
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
        markVideoDateRouteOwned(sessionIdFromUrl, user.id);
        routeHydrationDebug(
          "blocked ready_gate bounce during date-entry latch",
          {
            sessionId: sessionIdFromUrl,
          },
        );
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

      if (canonicalRoute.target === "ready_gate") {
        clearDateEntryTransition(sessionIdFromUrl);
        clearVideoDateRouteOwnership(sessionIdFromUrl, user.id);
        const key = `${sessionIdFromUrl}:ready_gate`;
        if (lastReadyGateRedirectKey.current === key) return;
        lastReadyGateRedirectKey.current = key;
        const target = `/ready/${encodeURIComponent(sessionIdFromUrl)}`;
        routeHydrationDebug(
          "redirecting date route back to canonical Ready Gate",
          {
            sessionId: sessionIdFromUrl,
            eventId: activeSession.eventId,
            canonicalReason: canonicalRoute.reason,
            target,
          },
        );
        vdbg("route_hydration_ready_gate_canonical_redirect", {
          sessionId: sessionIdFromUrl,
          userId: user.id,
          eventId: activeSession.eventId,
          reason: "canonical_ready_gate_not_date_capable",
          ...canonicalLog,
          canonicalTarget: canonicalRoute.target,
          canonicalReason: canonicalRoute.reason,
          target,
          latchActive: latchActiveAtStart,
          state: vs.state,
          phase: vs.phase,
          handshakeStarted: Boolean(vs.handshake_started_at),
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
        reason: canonicalRoute.reason,
        ...canonicalLog,
        canonicalTarget: canonicalRoute.target,
        latchActive: false,
        state: vs.state,
        phase: vs.phase,
        handshakeStarted: Boolean(vs.handshake_started_at),
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
