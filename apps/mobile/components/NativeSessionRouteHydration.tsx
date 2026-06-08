import { useEffect, useRef } from "react";
import { router, usePathname } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { useSessionHydration } from "@/context/SessionHydrationContext";
import { videoDateHref } from "@/lib/activeSessionRoutes";
import {
  isDateEntryTransitionActive,
  markVideoDateRouteOwned,
} from "@/lib/dateEntryTransitionLatch";
import { fetchVideoSessionDateEntryTruthCoalesced } from "@/lib/videoDateApi";
import { RC_CATEGORY, rcBreadcrumb } from "@/lib/nativeRcDiagnostics";
import { videoSessionHasPostDateSurveyTruth } from "@clientShared/matching/activeSession";
import {
  canonicalVideoDateRouteLogDetail,
  decideCanonicalVideoDateRoute,
} from "@clientShared/matching/videoDateRouteDecision";

/**
 * Stack-level owner for `/date/[id]` when `useActiveSession` is **ready_gate** for that id →
 * `readyGateHref` (see `activeSessionRoutes`). Date screen still applies server truth first.
 *
 * **Defense-in-depth:** `app/date/[id].tsx` checks `ended_at` and `in_ready_gate` via Supabase.
 * **Ended sessions:** date screen owns terminal redirect to lobby/tabs.
 */
export function NativeSessionRouteHydration() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { activeSession, hydrated } = useSessionHydration();
  const lastActiveVideoKey = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.id || !hydrated || !pathname) return;
    const m = pathname.match(/\/date\/([^/]+)/);
    const sid = m?.[1] ?? null;

    if (activeSession?.kind === "video" && activeSession.sessionId) {
      markVideoDateRouteOwned(activeSession.sessionId, user.id);
      if (sid !== activeSession.sessionId) {
        const key = `${activeSession.sessionId}:${activeSession.queueStatus}:${pathname}`;
        if (lastActiveVideoKey.current === key) return;
        lastActiveVideoKey.current = key;
        const target = videoDateHref(activeSession.sessionId);
        rcBreadcrumb(
          RC_CATEGORY.videoDateEntry,
          "active_video_route_owner_redirect",
          {
            session_id: activeSession.sessionId,
            event_id: activeSession.eventId,
            queue_status: activeSession.queueStatus,
            pathname,
            target: String(target),
            force_survey: activeSession.queueStatus === "in_survey",
          },
        );
        router.replace(target);
        return;
      }
      lastActiveVideoKey.current = null;
    } else {
      lastActiveVideoKey.current = null;
    }

    if (!sid) return;

    if (activeSession?.sessionId !== sid || activeSession.kind !== "ready_gate")
      return;

    if (isDateEntryTransitionActive(sid)) {
      markVideoDateRouteOwned(sid, user.id);
      rcBreadcrumb(RC_CATEGORY.videoDateEntry, "navigate_to_date_blocked", {
        session_id: sid,
        reason: "date_entry_latch",
      });
      return;
    }

    let cancelled = false;
    void (async () => {
      const vs = await fetchVideoSessionDateEntryTruthCoalesced(sid);
      if (cancelled) return;
      // Do not navigate on unknown server state — stale `ready_gate` ER is safer than bouncing when vs is missing.
      if (!vs) {
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, "navigate_to_date_blocked", {
          session_id: sid,
          reason: "video_sessions_row_unavailable",
        });
        return;
      }
      const canonicalRoute = decideCanonicalVideoDateRoute({
        sessionId: sid,
        eventId: activeSession.eventId,
        truth: vs,
        registration: {
          queue_status: activeSession.queueStatus,
          current_room_id: sid,
          event_id: activeSession.eventId,
        },
      });
      const canonicalLog = canonicalVideoDateRouteLogDetail(canonicalRoute, {
        sourceSurface: "native_session_route_hydration",
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
          markVideoDateRouteOwned(sid, user.id);
        }
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, "navigate_to_date_blocked", {
          session_id: sid,
          reason: pendingSurveyTerminalEncounter
            ? "pending_survey_terminal_encounter"
            : "video_sessions_ended",
          ...canonicalLog,
          canonical_target: canonicalRoute.target,
          canonical_reason: canonicalRoute.reason,
          vs_state: vs?.state ?? null,
          vs_phase: vs?.phase ?? null,
          survey_required: pendingSurveyTerminalEncounter,
        });
        return;
      }
      if (canonicalRoute.target === "date") {
        markVideoDateRouteOwned(sid, user.id);
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, "navigate_to_date_blocked", {
          session_id: sid,
          reason: canAttemptDaily
            ? "video_sessions_daily_startable"
            : "video_sessions_handshake_or_date",
          ...canonicalLog,
          canonical_target: canonicalRoute.target,
          canonical_reason: canonicalRoute.reason,
          can_attempt_daily: canAttemptDaily,
          routed_to: "date",
          handshake_started_at: Boolean(vs?.handshake_started_at),
          vs_state: vs?.state ?? null,
          vs_phase: vs?.phase ?? null,
          ready_gate_status: vs?.ready_gate_status ?? null,
          ready_gate_expires_at:
            vs?.ready_gate_expires_at == null
              ? null
              : String(vs.ready_gate_expires_at),
        });
        return;
      }
      if (canonicalRoute.target === "ready_gate") {
        markVideoDateRouteOwned(sid, user.id);
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, "navigate_to_date_blocked", {
          session_id: sid,
          reason: "ready_gate_bounce_suppressed_date_owner",
          source: "native_session_route_hydration",
          can_attempt_daily: canAttemptDaily,
          ...canonicalLog,
          canonical_target: canonicalRoute.target,
          canonical_reason: canonicalRoute.reason,
          ready_gate_status: vs?.ready_gate_status ?? null,
          ready_gate_expires_at:
            vs?.ready_gate_expires_at == null
              ? null
              : String(vs.ready_gate_expires_at),
          routed_to: "date",
        });
        return;
      }
      rcBreadcrumb(RC_CATEGORY.videoDateEntry, "navigate_to_date_blocked", {
        session_id: sid,
        reason: "video_sessions_not_ready_gate_eligible",
        ...canonicalLog,
        canonical_target: canonicalRoute.target,
        canonical_reason: canonicalRoute.reason,
        vs_state: vs?.state ?? null,
        vs_phase: vs?.phase ?? null,
        ready_gate_status: vs?.ready_gate_status ?? null,
      });
      return;
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id, hydrated, pathname, activeSession]);

  return null;
}
