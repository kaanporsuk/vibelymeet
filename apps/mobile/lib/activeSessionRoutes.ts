/**
 * Canonical **in-app paths** for `ActiveSession` (`useActiveSession`) and shared builders for
 * the same routes used by notification reconcile, native `/date` hydration, and lobby realtime.
 *
 * | Source of truth | Where it applies |
 * |-----------------|------------------|
 * | `ActiveSession` | Home / schedule CTAs, banner rejoin — user is in a live matching phase. |
 * | `video_sessions` + `event_registrations` | Notification `/date` reconcile, date/ready screen guards (ended, stale ER). |
 *
 * Policy (non-terminal):
 *
 * | State (`ActiveSession.kind`) | Route | Notes |
 * |------------------------------|-------|-------|
 * | *(null)* | — | No session CTA; deep links use async server reconcile. |
 * | `syncing` | `/event/[eventId]/lobby` | Queued mutual — lobby convergence; **not** a live Daily call. |
 * | `ready_gate` | `/ready/[sessionId]` | Ready Gate surface. |
 * | `video` | `/date/[sessionId]` | Handshake / `in_date` — Daily date stack. |
 *
 * **Ended / terminal:** not modeled as `ActiveSession`. Guards on date/ready/native hydration own
 * redirect to `eventLobbyHref` or `tabsRootHref` using `video_sessions.ended_at` and registration rows.
 */
import type { Href } from 'expo-router';
import type { ActiveSession } from './useActiveSession';

export function eventLobbyHref(eventId: string): Href {
  return `/event/${eventId}/lobby` as Href;
}

export function readyGateHref(sessionId: string): Href {
  return `/ready/${sessionId}` as Href;
}

export function videoDateHref(sessionId: string): Href {
  return `/date/${sessionId}` as Href;
}

export function tabsRootHref(): Href {
  return '/(tabs)' as Href;
}

/** Home reminder tap, schedule join, ActiveCallBanner rejoin — single policy for non-null session. */
export function hrefForActiveSession(session: ActiveSession): Href {
  switch (session.kind) {
    case 'syncing':
      return eventLobbyHref(session.eventId);
    case 'ready_gate':
      return readyGateHref(session.sessionId);
    case 'video':
      return videoDateHref(session.sessionId);
  }
}
