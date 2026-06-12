/**
 * Native pre-flight gate for `/date/[id]` navigation.
 *
 * Centralises the "is the backend actually startable for this session right now?" check that
 * Ready Gate / lobby / standalone Ready / rescue retries previously duplicated. Mirrors the web
 * `SessionRouteHydration` policy: refuse to enter `/date` until backend truth already says
 * startable, or a Ready Gate/date-route owner has already prepared a fresh handoff.
 *
 * This helper is deliberately read-only. It may route to date/ready/survey/lobby, but it must not
 * call `prepare_date_entry`; Ready Gate overlay, standalone `/ready/[id]`, and explicit date-route
 * recovery are the only native prepare owners.
 *
 * Reuses (does NOT duplicate):
 *  - `fetchVideoSessionDateEntryTruth`
 *  - `decideVideoSessionRouteFromTruth`
 *  - `canAttemptDailyRoomFromVideoSessionTruth`
 *  - `videoSessionRowReadyGateEligible`
 *  - prepared-entry handoff cache inspection
 *  - `readyGateHref` / `eventLobbyHref` / `tabsRootHref`
 *
 * Does NOT mark or clear the date-entry transition latch (shared navigation
 * intents) — `navigateToDateSessionGuarded` owns marking after a successful
 * `router.replace/push`, and `/date/[id].tsx` owns clearing on recovery /
 * cleanup. Keeping the latch contract isolated to those two surfaces avoids duplicate writes.
 */
import type { Href } from 'expo-router';
import { RC_CATEGORY, rcBreadcrumb } from '@/lib/nativeRcDiagnostics';
import { vdbg } from '@/lib/vdbg';
import {
  fetchVideoSessionDateEntryTruth,
  type VideoSessionDateEntryTruth,
} from '@/lib/videoDateApi';
import { peekPreparedVideoDateEntryHandoff } from '@clientShared/matching/videoDatePrepareEntry';
import {
  canAttemptDailyRoomFromVideoSessionTruth,
  decideVideoSessionRouteFromTruth,
  videoSessionRowReadyGateEligible,
  type VideoSessionTruthRouteDecision,
} from '@clientShared/matching/activeSession';
import { decideCanonicalVideoDateRoute } from '@clientShared/matching/videoDateRouteDecision';
import {
  eventLobbyHref,
  readyGateHref,
  tabsRootHref,
  videoDateHref,
} from '@/lib/activeSessionRoutes';

export type EnsureStartableOk = {
  ok: true;
  reason: 'already_startable' | 'fresh_prepared_handoff';
  truth: VideoSessionDateEntryTruth | null;
};

export type EnsureStartableNotReady = {
  ok: false;
  recommend: 'ready';
  recommendHref: Href;
  reason: string;
  truth: VideoSessionDateEntryTruth | null;
};

export type EnsureStartablePendingSurvey = {
  ok: false;
  recommend: 'survey';
  recommendHref: Href;
  reason: string;
  truth: VideoSessionDateEntryTruth | null;
};

export type EnsureStartableTerminal = {
  ok: false;
  recommend: 'ended' | 'lobby' | 'tabs';
  recommendHref: Href;
  reason: string;
  truth: VideoSessionDateEntryTruth | null;
};

export type EnsureStartableResult =
  | EnsureStartableOk
  | EnsureStartableNotReady
  | EnsureStartablePendingSurvey
  | EnsureStartableTerminal;

export type EnsureVideoDateStartableParams = {
  sessionId: string;
  /** Free-form caller tag for breadcrumbs (e.g. `lobby_navigate`, `ready_standalone_both_ready`). */
  source: string;
  userId?: string | null;
};

function lobbyOrTabsHref(eventId?: string | null): {
  recommend: 'lobby' | 'tabs';
  href: Href;
} {
  if (eventId) return { recommend: 'lobby', href: eventLobbyHref(eventId) };
  return { recommend: 'tabs', href: tabsRootHref() };
}

function emit(
  message:
    | 'ensure_video_date_startable_before'
    | 'ensure_video_date_startable_after'
    | 'prepared_handoff_pre_nav_found'
    | 'ready_gate_pre_nav_deferred_to_prepare_owner',
  payload: Record<string, unknown>,
) {
  rcBreadcrumb(RC_CATEGORY.videoDateEntry, message, payload);
  vdbg(message, payload);
}

function snapshotTruth(truth: VideoSessionDateEntryTruth | null): Record<string, unknown> {
  return {
    has_truth: Boolean(truth),
    vs_state: truth?.state ?? null,
    vs_phase: truth?.phase ?? null,
    entry_started_at: Boolean(truth?.entry_started_at),
    ready_gate_status: truth?.ready_gate_status ?? null,
    ready_gate_expires_at:
      truth?.ready_gate_expires_at == null ? null : String(truth.ready_gate_expires_at),
  };
}

function pendingSurveyRecommendation(
  sessionId: string,
  userId: string | null,
  source: string,
  truth: VideoSessionDateEntryTruth | null,
): EnsureStartablePendingSurvey | null {
  const canonical = decideCanonicalVideoDateRoute({
    sessionId,
    eventId: truth?.event_id ?? null,
    truth,
  });
  if (canonical.target !== 'survey' || !canonical.sessionId) return null;

  emit('ensure_video_date_startable_after', {
    session_id: sessionId,
    user_id: userId,
    source,
    ok: false,
    reason: 'pending_survey',
    canonical_reason: canonical.reason,
    recommend: 'survey',
    ...snapshotTruth(truth),
  });
  return {
    ok: false,
    recommend: 'survey',
    recommendHref: videoDateHref(canonical.sessionId),
    reason: 'pending_survey',
    truth,
  };
}

export async function ensureVideoDateStartableBeforeNavigation(
  params: EnsureVideoDateStartableParams,
): Promise<EnsureStartableResult> {
  const { sessionId, source } = params;
  const userId = params.userId ?? null;

  emit('ensure_video_date_startable_before', {
    session_id: sessionId,
    user_id: userId,
    source,
  });

  const truth = await fetchVideoSessionDateEntryTruth(sessionId);
  const initialSurvey = pendingSurveyRecommendation(sessionId, userId, source, truth);
  if (initialSurvey) return initialSurvey;

  const decision: VideoSessionTruthRouteDecision = decideVideoSessionRouteFromTruth(truth);
  const canAttemptDaily = canAttemptDailyRoomFromVideoSessionTruth(truth);

  if (canAttemptDaily || decision === 'navigate_date') {
    emit('ensure_video_date_startable_after', {
      session_id: sessionId,
      user_id: userId,
      source,
      ok: true,
      reason: 'already_startable',
      can_attempt_daily: canAttemptDaily,
      decision,
      ...snapshotTruth(truth),
    });
    return { ok: true, reason: 'already_startable', truth };
  }

  if (decision === 'ended') {
    const fallback = lobbyOrTabsHref(truth?.event_id);
    emit('ensure_video_date_startable_after', {
      session_id: sessionId,
      user_id: userId,
      source,
      ok: false,
      reason: 'session_ended',
      recommend: 'ended',
      ...snapshotTruth(truth),
    });
    return {
      ok: false,
      recommend: 'ended',
      recommendHref: fallback.href,
      reason: 'session_ended',
      truth,
    };
  }

  if (decision === 'stay_lobby' || !truth) {
    const fallback = lobbyOrTabsHref(truth?.event_id);
    emit('ensure_video_date_startable_after', {
      session_id: sessionId,
      user_id: userId,
      source,
      ok: false,
      reason: !truth ? 'truth_unavailable' : 'stay_lobby',
      recommend: fallback.recommend,
      ...snapshotTruth(truth),
    });
    return {
      ok: false,
      recommend: fallback.recommend,
      recommendHref: fallback.href,
      reason: !truth ? 'truth_unavailable' : 'stay_lobby',
      truth,
    };
  }

  // decision === 'navigate_ready' here.
  if (videoSessionRowReadyGateEligible(truth)) {
    if (userId) {
      const handoff = peekPreparedVideoDateEntryHandoff(sessionId, userId);
      if (handoff.ok === true) {
        emit('prepared_handoff_pre_nav_found', {
          session_id: sessionId,
          user_id: userId,
          source,
          entry_attempt_id: handoff.envelope.entryAttemptId,
          video_date_trace_id: handoff.envelope.videoDateTraceId,
          ...snapshotTruth(truth),
        });
        emit('ensure_video_date_startable_after', {
          session_id: sessionId,
          user_id: userId,
          source,
          ok: true,
          reason: 'fresh_prepared_handoff',
          entry_attempt_id: handoff.envelope.entryAttemptId,
          video_date_trace_id: handoff.envelope.videoDateTraceId,
          ...snapshotTruth(truth),
        });
        return { ok: true, reason: 'fresh_prepared_handoff', truth };
      }
    }

    emit('ready_gate_pre_nav_deferred_to_prepare_owner', {
      session_id: sessionId,
      user_id: userId,
      source,
      ready_gate_status: truth?.ready_gate_status ?? null,
      ready_gate_expires_at:
        truth?.ready_gate_expires_at == null ? null : String(truth.ready_gate_expires_at),
    });
  }

  if (decision === 'navigate_ready') {
    emit('ensure_video_date_startable_after', {
      session_id: sessionId,
      user_id: userId,
      source,
      ok: false,
      reason: 'navigate_ready',
      recommend: 'ready',
      ...snapshotTruth(truth),
    });
    return {
      ok: false,
      recommend: 'ready',
      recommendHref: readyGateHref(sessionId),
      reason: 'navigate_ready',
      truth,
    };
  }

  if (decision === 'ended') {
    const finalSurvey = pendingSurveyRecommendation(sessionId, userId, source, truth);
    if (finalSurvey) return finalSurvey;

    const fallback = lobbyOrTabsHref(truth?.event_id);
    emit('ensure_video_date_startable_after', {
      session_id: sessionId,
      user_id: userId,
      source,
      ok: false,
      reason: 'ended_after_retry',
      recommend: 'ended',
      ...snapshotTruth(truth),
    });
    return {
      ok: false,
      recommend: 'ended',
      recommendHref: fallback.href,
      reason: 'ended_after_retry',
      truth,
    };
  }

  const fallback = lobbyOrTabsHref(truth?.event_id);
  emit('ensure_video_date_startable_after', {
    session_id: sessionId,
    user_id: userId,
    source,
    ok: false,
    reason: 'stay_lobby_after_retry',
    recommend: fallback.recommend,
    ...snapshotTruth(truth),
  });
  return {
    ok: false,
    recommend: fallback.recommend,
    recommendHref: fallback.href,
    reason: 'stay_lobby_after_retry',
    truth,
  };
}
