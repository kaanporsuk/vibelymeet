import { useEffect, useRef } from "react";
import { router, usePathname } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { useSessionHydration } from "@/context/SessionHydrationContext";
import { readyGateHref, videoDateHref } from "@/lib/activeSessionRoutes";
import {
  isDateEntryTransitionActive,
  markVideoDateRouteOwned,
  videoDateNavigationIntents,
} from "@/lib/videoDateNavigationIntents";
import { fetchVideoSessionDateEntryTruthCoalesced } from "@/lib/videoDateApi";
import { RC_CATEGORY, rcBreadcrumb } from "@/lib/nativeRcDiagnostics";
import { canonicalVideoDateRouteLogDetail } from "@clientShared/matching/videoDateRouteDecision";
import { decideVideoDateSurfaceRoute } from "@clientShared/videoDate/routeDecision";

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
      // Video Date decisions are delegated to the shared controller's single
      // surface-route decision (intents marked/cleared inside); this component
      // keeps only native navigation effects — it never re-navigates onto the
      // same /date route (native remounts are the incident class), so the only
      // router action here is the canonical Ready Gate bounce.
      const decision = decideVideoDateSurfaceRoute({
        surface: "route_hydration",
        sessionId: sid,
        profileId: user.id,
        intents: videoDateNavigationIntents,
        canonicalInput: {
          eventId: activeSession.eventId,
          truth: vs,
          registration: {
            queue_status: activeSession.queueStatus,
            current_room_id: sid,
            event_id: activeSession.eventId,
          },
        },
      });
      const canonicalLog = decision.canonical
        ? canonicalVideoDateRouteLogDetail(decision.canonical, {
            sourceSurface: "native_session_route_hydration",
            sourceAction: "date_route_guard",
          })
        : {};
      const canAttemptDaily = decision.canonical?.canAttemptDaily ?? false;
      if (decision.target === "survey" || decision.target === "ended") {
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, "navigate_to_date_blocked", {
          session_id: sid,
          reason:
            decision.target === "survey"
              ? "pending_survey_terminal_encounter"
              : "video_sessions_ended",
          ...canonicalLog,
          canonical_target: decision.canonical?.target ?? null,
          canonical_reason: decision.reason,
          vs_state: vs?.state ?? null,
          vs_phase: vs?.phase ?? null,
          survey_required: decision.target === "survey",
        });
        return;
      }
      if (decision.target === "date") {
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, "navigate_to_date_blocked", {
          session_id: sid,
          reason:
            decision.suppressedBy === "entry_latch"
              ? "date_entry_latch"
              : decision.suppressedBy === "route_ownership"
                ? "date_route_ownership"
                : canAttemptDaily
                  ? "video_sessions_daily_startable"
                  : "video_sessions_entry_or_date",
          ...canonicalLog,
          canonical_target: decision.canonical?.target ?? null,
          canonical_reason: decision.reason,
          can_attempt_daily: canAttemptDaily,
          routed_to: "date",
          entry_started_at: Boolean(vs?.entry_started_at),
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
      if (decision.target === "ready") {
        const target = readyGateHref(sid);
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, "route_bounced_to_ready", {
          session_id: sid,
          reason: "canonical_ready_gate_not_date_capable",
          source: "native_session_route_hydration",
          can_attempt_daily: canAttemptDaily,
          ...canonicalLog,
          canonical_target: decision.canonical?.target ?? null,
          canonical_reason: decision.reason,
          ready_gate_status: vs?.ready_gate_status ?? null,
          ready_gate_expires_at:
            vs?.ready_gate_expires_at == null
              ? null
              : String(vs.ready_gate_expires_at),
          routed_to: "ready",
          target: String(target),
        });
        router.replace(target);
        return;
      }
      rcBreadcrumb(RC_CATEGORY.videoDateEntry, "navigate_to_date_blocked", {
        session_id: sid,
        reason: "video_sessions_not_ready_gate_eligible",
        ...canonicalLog,
        canonical_target: decision.canonical?.target ?? null,
        canonical_reason: decision.reason,
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
