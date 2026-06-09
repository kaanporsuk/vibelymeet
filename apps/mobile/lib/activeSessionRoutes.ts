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
 * | `ready_gate` | `/ready/[sessionId]` | Ready Gate surface. |
 * | `video` | `/date/[sessionId]` | Handshake, `in_date`, or terminal `in_survey` recovery — Date stack owns Daily and survey. |
 *
 * **Ended / terminal:** `in_survey` is modeled as `ActiveSession.kind === 'video'` so the Date
 * stack can recover the post-date survey. Non-survey ended rows are still handled by route guards.
 */
import type { Href } from 'expo-router';
import type { ActiveSession } from './useActiveSession';
import {
  nativePathForCanonicalVideoDateRoute,
  type VideoDateCanonicalRouteDecision,
} from '@clientShared/matching/videoDateRouteDecision';

export function eventLobbyHref(eventId: string): Href {
  return `/event/${eventId}/lobby` as Href;
}

/** After post-date survey: lets the lobby show the same lightweight success cue as web (then strip the flag). */
export function eventLobbyHrefPostSurveyComplete(eventId: string): Href {
  return `/event/${eventId}/lobby?postSurveyComplete=1` as Href;
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
    case 'ready_gate':
      return readyGateHref(session.sessionId);
    case 'video':
      return videoDateHref(session.sessionId);
  }
}

export function hrefForCanonicalVideoDateRoute(
  decision: VideoDateCanonicalRouteDecision,
): Href {
  return nativePathForCanonicalVideoDateRoute(decision) as Href;
}
