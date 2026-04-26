/**
 * Native pre-flight gate for `/date/[id]` navigation.
 *
 * Centralises the "is the backend actually startable for this session right now?" check that
 * Ready Gate / lobby / standalone Ready / rescue retries previously duplicated. Mirrors the web
 * `SessionRouteHydration` policy: refuse to enter `/date` until either the canonical
 * `video_sessions` row already says startable, or `prepare_date_entry` has just succeeded and a
 * fresh refetch confirms startability. On `READY_GATE_NOT_READY` from `prepare_date_entry`, runs a
 * short bounded refetch loop to absorb backend / replica lag.
 *
 * Reuses (does NOT duplicate):
 *  - `fetchVideoSessionDateEntryTruth`
 *  - `decideVideoSessionRouteFromTruth`
 *  - `canAttemptDailyRoomFromVideoSessionTruth`
 *  - `videoSessionRowReadyGateEligible`
 *  - `prepareVideoDateEntry`
 *  - `readyGateHref` / `eventLobbyHref` / `tabsRootHref`
 *
 * Does NOT mark or clear `dateEntryTransitionLatch` — `navigateToDateSessionGuarded` owns marking
 * after a successful `router.replace/push`, and `/date/[id].tsx` owns clearing on recovery /
 * cleanup. Keeping the latch contract isolated to those two surfaces avoids duplicate writes.
 */
import type { Href } from 'expo-router';
import { RC_CATEGORY, rcBreadcrumb } from '@/lib/nativeRcDiagnostics';
import { vdbg } from '@/lib/vdbg';
import {
  fetchVideoSessionDateEntryTruth,
  type VideoSessionDateEntryTruth,
} from '@/lib/videoDateApi';
import { prepareVideoDateEntry } from '@/lib/videoDatePrepareEntry';
import {
  canAttemptDailyRoomFromVideoSessionTruth,
  decideVideoSessionRouteFromTruth,
  videoSessionRowReadyGateEligible,
  type VideoSessionTruthRouteDecision,
} from '@clientShared/matching/activeSession';
import {
  eventLobbyHref,
  readyGateHref,
  tabsRootHref,
} from '@/lib/activeSessionRoutes';

const PREPARE_ENTRY_PRENAV_TIMEOUT_MS = 4_000;
/** Two short refetches absorb sub-500ms replica lag without making nav feel slow. */
const READY_GATE_RACE_RETRY_BACKOFFS_MS = [220, 320];

export type EnsureStartableOk = {
  ok: true;
  reason:
    | 'already_startable'
    | 'startable_after_handshake'
    | 'startable_after_retry';
  truth: VideoSessionDateEntryTruth | null;
};

export type EnsureStartableNotReady = {
  ok: false;
  recommend: 'ready';
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
    | 'enter_handshake_pre_nav_attempt'
    | 'enter_handshake_pre_nav_recovered_by_truth'
    | 'ready_gate_not_ready_retry_start'
    | 'ready_gate_not_ready_retry_success'
    | 'ready_gate_not_ready_retry_exhausted',
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
    handshake_started_at: Boolean(truth?.handshake_started_at),
    ready_gate_status: truth?.ready_gate_status ?? null,
    ready_gate_expires_at:
      truth?.ready_gate_expires_at == null ? null : String(truth.ready_gate_expires_at),
  };
}

function withPrepareTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error('prepare_date_entry_timeout')), timeoutMs);
    void promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
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

  let truth = await fetchVideoSessionDateEntryTruth(sessionId);
  let decision: VideoSessionTruthRouteDecision = decideVideoSessionRouteFromTruth(truth);
  let canAttemptDaily = canAttemptDailyRoomFromVideoSessionTruth(truth);

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
    emit('enter_handshake_pre_nav_attempt', {
      session_id: sessionId,
      user_id: userId,
      source,
      ready_gate_status: truth?.ready_gate_status ?? null,
      ready_gate_expires_at:
        truth?.ready_gate_expires_at == null ? null : String(truth.ready_gate_expires_at),
    });

    let prepareOk = false;
    let prepareCode: string | null = null;
    try {
      const prepared = await withPrepareTimeout(
        prepareVideoDateEntry(sessionId, {
          eventId: truth?.event_id ?? null,
          source: `pre_nav_${source}`,
        }),
        PREPARE_ENTRY_PRENAV_TIMEOUT_MS,
      );
      prepareOk = prepared.ok === true;
      prepareCode = prepared.ok === true ? null : prepared.code;
    } catch (err) {
      prepareOk = false;
      prepareCode = err instanceof Error ? err.message : 'exception';
    }

    if (prepareOk) {
      truth = await fetchVideoSessionDateEntryTruth(sessionId);
      decision = decideVideoSessionRouteFromTruth(truth);
      canAttemptDaily = canAttemptDailyRoomFromVideoSessionTruth(truth);
      if (canAttemptDaily || decision === 'navigate_date') {
        emit('enter_handshake_pre_nav_recovered_by_truth', {
          session_id: sessionId,
          user_id: userId,
          source,
          can_attempt_daily: canAttemptDaily,
          decision,
          ...snapshotTruth(truth),
        });
        emit('ensure_video_date_startable_after', {
          session_id: sessionId,
          user_id: userId,
          source,
          ok: true,
          reason: 'startable_after_handshake',
          ...snapshotTruth(truth),
        });
        return { ok: true, reason: 'startable_after_handshake', truth };
      }
    }

    // Either prepare failed (often READY_GATE_NOT_READY due to replica lag) or it succeeded
    // but a refetch immediately afterwards has not yet observed the new state. Short bounded
    // refetch loop absorbs that window without retrying the RPC itself.
    if (prepareCode === 'READY_GATE_NOT_READY' || !prepareOk) {
      emit('ready_gate_not_ready_retry_start', {
        session_id: sessionId,
        user_id: userId,
        source,
        handshake_code: prepareCode,
      });
      for (let i = 0; i < READY_GATE_RACE_RETRY_BACKOFFS_MS.length; i++) {
        const delay = READY_GATE_RACE_RETRY_BACKOFFS_MS[i];
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
        truth = await fetchVideoSessionDateEntryTruth(sessionId);
        decision = decideVideoSessionRouteFromTruth(truth);
        canAttemptDaily = canAttemptDailyRoomFromVideoSessionTruth(truth);
        if (canAttemptDaily || decision === 'navigate_date') {
          emit('ready_gate_not_ready_retry_success', {
            session_id: sessionId,
            user_id: userId,
            source,
            attempt: i + 1,
            backoff_ms: delay,
            decision,
            ...snapshotTruth(truth),
          });
          emit('ensure_video_date_startable_after', {
            session_id: sessionId,
            user_id: userId,
            source,
            ok: true,
            reason: 'startable_after_retry',
            ...snapshotTruth(truth),
          });
          return { ok: true, reason: 'startable_after_retry', truth };
        }
      }
      emit('ready_gate_not_ready_retry_exhausted', {
        session_id: sessionId,
        user_id: userId,
        source,
        last_decision: decision,
        last_can_attempt_daily: canAttemptDaily,
        ...snapshotTruth(truth),
      });
    }
  }

  if (decision === 'navigate_ready') {
    emit('ensure_video_date_startable_after', {
      session_id: sessionId,
      user_id: userId,
      source,
      ok: false,
      reason: 'navigate_ready_after_retry',
      recommend: 'ready',
      ...snapshotTruth(truth),
    });
    return {
      ok: false,
      recommend: 'ready',
      recommendHref: readyGateHref(sessionId),
      reason: 'navigate_ready_after_retry',
      truth,
    };
  }

  if (decision === 'ended') {
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
