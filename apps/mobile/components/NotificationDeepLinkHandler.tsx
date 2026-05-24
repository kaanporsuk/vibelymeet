/**
 * Routes OneSignal notification opens into expo-router when payload includes a path.
 * Expects `additionalData.url` (matches web/send-notification `data.url`) or `launchURL`.
 * Foreground: suppress message notifications when already viewing that chat thread.
 * When unauthenticated, queues the path until session is ready (see `pendingNotificationDeepLink`).
 */
import { useEffect, useRef } from 'react';
import type { Session } from '@supabase/supabase-js';
import { router, usePathname, type Href } from 'expo-router';
import { OneSignal, NotificationWillDisplayEvent } from 'react-native-onesignal';
import type { EntryStateResponse } from '@shared/entryState';
import { notificationRouteRef } from '@/lib/notificationRouteRef';
import { RC_CATEGORY, rcBreadcrumb } from '@/lib/nativeRcDiagnostics';
import { useAuth } from '@/context/AuthContext';
import {
  eventLobbyHref,
  readyGateHref,
  tabsRootHref,
  videoDateHref,
} from '@/lib/activeSessionRoutes';
import { drainMatchQueue } from '@/lib/eventsApi';
import { supabase } from '@/lib/supabase';
import { fetchVideoDateSnapshot } from '@/lib/videoDateSnapshot';
import { fetchVideoSessionDateEntryTruth } from '@/lib/videoDateApi';
import {
  videoSessionHasPostDateSurveyTruth,
} from '@clientShared/matching/activeSession';
import {
  adviseVideoDateSnapshotRecovery,
  adviseVideoSessionTruthRecovery,
} from '@clientShared/matching/videoDateRecoveryAdvisor';
import { clearDateEntryTransition, markVideoDateEntryPipelineStarted } from '@/lib/dateEntryTransitionLatch';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import {
  clearPendingNotificationDeepLink,
  queueNotificationDeepLinkPath,
  takePendingNotificationDeepLinkPath,
} from '@/lib/pendingNotificationDeepLink';
import { classifyPushDeepLink, recordPushDeliveryTelemetry } from '@/lib/pushDeliveryTelemetry';
import { resolveNotificationActionRoute } from '@/lib/notificationActions';

/**
 * Matches `EntryStateRouteGate`: only then is expo-router allowed to show protected stacks
 * without redirecting to auth / onboarding / recovery (avoids queued-link churn).
 */
function isEntryReadyForNotificationDeepLink(
  session: Session | null,
  loading: boolean,
  entryStateLoading: boolean,
  entryState: EntryStateResponse | null
): boolean {
  if (loading || entryStateLoading) return false;
  if (!session) return false;
  if (!entryState) return false;
  if (entryState.state === 'incomplete') return false;
  return entryState.state === 'complete';
}

function hrefFromPayload(additionalData: Record<string, unknown> | undefined, launchURL?: string): Href | null {
  const raw =
    (additionalData && typeof additionalData.url === 'string' && additionalData.url) ||
    (additionalData && typeof additionalData.deep_link === 'string' && additionalData.deep_link) ||
    (additionalData && typeof additionalData.deepLink === 'string' && additionalData.deepLink) ||
    (launchURL && launchURL.trim() ? launchURL.trim() : '');

  if (!raw) return null;
  if (raw.startsWith('/')) return raw as Href;
  try {
    const u = new URL(raw);
    const path = u.pathname && u.pathname !== '/' ? u.pathname : '/';
    if (path.startsWith('/')) return path as Href;
  } catch {
    /* ignore */
  }
  return null;
}

function rawHrefFromPayload(additionalData: Record<string, unknown> | undefined, launchURL?: string): string | null {
  const raw =
    (additionalData && typeof additionalData.url === 'string' && additionalData.url) ||
    (additionalData && typeof additionalData.deep_link === 'string' && additionalData.deep_link) ||
    (additionalData && typeof additionalData.deepLink === 'string' && additionalData.deepLink) ||
    (launchURL && launchURL.trim() ? launchURL.trim() : '');
  return raw || null;
}

/** Chat routes must use the other user profile id; prefer `other_user_id` when present (Daily Drop / match payloads). */
function resolveNotificationHref(
  additionalData: Record<string, unknown> | undefined,
  launchURL?: string | undefined
): Href | null {
  const peer =
    typeof additionalData?.other_user_id === 'string' && additionalData.other_user_id.length > 0
      ? additionalData.other_user_id
      : null;
  const base = hrefFromPayload(additionalData, launchURL);
  if (!base || typeof base !== 'string') return resolveNotificationActionRoute(additionalData?.action);
  if (!peer) return base;
  if (base.startsWith('/chat/')) {
    return `/chat/${peer}` as Href;
  }
  return base;
}

const LOBBY_IDLE_STATUSES = new Set(['browsing', 'idle', 'offline']);

/**
 * If payload targets /date/:id, align with backend truth:
 * ended session → event lobby (or home); still in_ready_gate → /ready/:id;
 * queued session + registration still browsing/idle → stamp foreground, drain, re-check, then /ready, /date, or lobby;
 * otherwise fail closed to lobby/tabs. Date notifications must not bypass
 * provider-prepared truth.
 */
async function reconcileHrefWithRegistration(
  href: string,
  userId: string,
  options?: { drainMatchQueueV2?: boolean; snapshotRecoveryV2?: boolean },
): Promise<Href> {
  const m = href.match(/^\/date\/([^/?#]+)/);
  if (!m) return href as Href;
  const sid = m[1];

  if (options?.snapshotRecoveryV2 === true) {
    const snapshot = await fetchVideoDateSnapshot(sid, { includeToken: false });
    const recovery = adviseVideoDateSnapshotRecovery(snapshot, {
      expectedSessionId: sid,
      platform: 'native',
      surface: 'notification_deep_link',
    });
    if (recovery.action === 'go_date' || recovery.action === 'go_survey') {
      markVideoDateEntryPipelineStarted(recovery.sessionId);
      rcBreadcrumb(RC_CATEGORY.notifDeepLink, 'date_route_snapshot_recovery', {
        session_id: recovery.sessionId,
        event_id: recovery.eventId,
        decision: recovery.action === 'go_survey' ? 'navigate_survey' : 'navigate_date',
        reason: recovery.reason,
        routed_to: 'date',
      });
      return videoDateHref(recovery.sessionId);
    }
    if (recovery.action === 'go_ready_gate' && recovery.reason === 'ready_gate') {
      clearDateEntryTransition(recovery.sessionId);
      rcBreadcrumb(RC_CATEGORY.notifDeepLink, 'date_route_snapshot_recovery', {
        session_id: recovery.sessionId,
        event_id: recovery.eventId,
        decision: 'navigate_ready',
        reason: recovery.reason,
        routed_to: 'ready',
      });
      return readyGateHref(recovery.sessionId);
    }
    if (recovery.action === 'go_lobby' && recovery.reason === 'not_date_ready') {
      clearDateEntryTransition(recovery.sessionId ?? sid);
      rcBreadcrumb(RC_CATEGORY.notifDeepLink, 'date_route_snapshot_recovery', {
        session_id: recovery.sessionId ?? sid,
        event_id: recovery.eventId,
        decision: 'stay_lobby',
        reason: recovery.reason,
        routed_to: 'lobby',
      });
      return eventLobbyHref(recovery.eventId);
    }
    if (recovery.action === 'go_home' && recovery.reason === 'missing_event') {
      clearDateEntryTransition(sid);
      return tabsRootHref();
    }
    if (recovery.action === 'invalid') {
      clearDateEntryTransition(sid);
      rcBreadcrumb(RC_CATEGORY.notifDeepLink, 'date_route_snapshot_rejected', {
        session_id: sid,
        reason: recovery.reason,
      });
      return tabsRootHref();
    }
    // Retryable failures, queued rescue, and non-survey terminal states fall
    // through to legacy truth so queue drain and stale-ended recovery stay intact.
  }

  const { data: vs } = await supabase
    .from('video_sessions')
    .select('event_id, ended_at, ended_reason, state, phase, handshake_started_at, date_started_at, participant_1_joined_at, participant_2_joined_at, ready_gate_status, ready_gate_expires_at, daily_room_name, daily_room_url, participant_1_id, participant_2_id')
    .eq('id', sid)
    .maybeSingle();

  if (!vs) return tabsRootHref();

  const p1 = vs.participant_1_id as string | null | undefined;
  const p2 = vs.participant_2_id as string | null | undefined;
  const isParticipant = userId === p1 || userId === p2;
  if (!isParticipant) return tabsRootHref();

  if (vs.ended_at != null) {
    if (videoSessionHasPostDateSurveyTruth(vs)) {
      const { data: verdict } = await supabase
        .from('date_feedback')
        .select('id')
        .eq('session_id', sid)
        .eq('user_id', userId)
        .maybeSingle();

      if (!verdict) {
        rcBreadcrumb(RC_CATEGORY.notifDeepLink, 'date_route_decision', {
          session_id: sid,
          event_id: vs.event_id == null ? null : String(vs.event_id),
          decision: 'ended',
          reason: 'pending_survey_terminal_encounter',
          routed_to: 'date',
          survey_required: true,
          ended_at: String(vs.ended_at),
          ended_reason: vs.ended_reason == null ? null : String(vs.ended_reason),
        });
        return videoDateHref(sid);
      }
    }

    if (vs.event_id) return eventLobbyHref(vs.event_id as string);
    return tabsRootHref();
  }

  if (!vs.event_id) return tabsRootHref();

  const fetchReg = async () => {
    const { data: reg } = await supabase
      .from('event_registrations')
      .select('queue_status, current_room_id')
      .eq('profile_id', userId)
      .eq('event_id', vs.event_id)
      .maybeSingle();
    return reg;
  };

  let reg = await fetchReg();
  let truth = await fetchVideoSessionDateEntryTruth(sid);
  let recovery = adviseVideoSessionTruthRecovery({
    sessionId: sid,
    eventId: String(vs.event_id),
    truth,
    platform: 'native',
    surface: 'notification_deep_link',
  });
  let truthDecision = recovery.routeDecision;
  let canAttemptDaily = recovery.canAttemptDaily === true;

  const emitDecision = (
    decision: 'navigate_date' | 'navigate_ready' | 'stay_lobby' | 'ended',
    reason: string | null,
    routedTo: 'date' | 'ready' | 'lobby'
  ) => {
    rcBreadcrumb(RC_CATEGORY.notifDeepLink, 'date_route_decision', {
      session_id: sid,
      event_id: String(vs.event_id),
      decision,
      can_attempt_daily: canAttemptDaily,
      reason,
      routed_to: routedTo,
      queue_status: reg?.queue_status ?? null,
      current_room_id: reg?.current_room_id ?? null,
      vs_state: truth?.state ?? null,
      vs_phase: truth?.phase ?? null,
      handshake_started_at: Boolean(truth?.handshake_started_at),
      ready_gate_status: truth?.ready_gate_status ?? null,
      ready_gate_expires_at: truth?.ready_gate_expires_at == null ? null : String(truth.ready_gate_expires_at),
    });
  };

  const needsQueuedRescue =
    vs.ready_gate_status === 'queued' &&
    reg != null &&
    LOBBY_IDLE_STATUSES.has(String(reg.queue_status));

  if (needsQueuedRescue && truthDecision === 'stay_lobby') {
    rcBreadcrumb(RC_CATEGORY.notifDeepLink, 'queued_session_rescue_start', {
      session_id: sid,
      event_id: String(vs.event_id),
    });
    try {
      await supabase.rpc('mark_lobby_foreground', { p_event_id: vs.event_id as string });
    } catch {
      /* best-effort — drain still runs */
    }
    await drainMatchQueue(vs.event_id as string, userId, {
      drainMatchQueueV2: options?.drainMatchQueueV2 === true,
      sourceAction: 'notification_queued_session_rescue',
      sourceSurface: 'notification_deep_link',
    });
    reg = await fetchReg();
    truth = await fetchVideoSessionDateEntryTruth(sid);
    recovery = adviseVideoSessionTruthRecovery({
      sessionId: sid,
      eventId: String(vs.event_id),
      truth,
      platform: 'native',
      surface: 'notification_deep_link',
    });
    truthDecision = recovery.routeDecision;
    canAttemptDaily = recovery.canAttemptDaily === true;
  }

  if (recovery.action === 'show_terminal') {
    // Stale latch from a previous attempt would otherwise block `/date` route guards on
    // re-entry; clear here so the lobby/tabs landing is clean.
    clearDateEntryTransition(sid);
    emitDecision('ended', 'session_ended', 'lobby');
    return eventLobbyHref(vs.event_id as string);
  }
  if (recovery.action === 'go_date') {
    markVideoDateEntryPipelineStarted(sid);
    emitDecision('navigate_date', null, 'date');
    return videoDateHref(sid);
  }
  if (recovery.action === 'go_ready_gate') {
    clearDateEntryTransition(sid);
    emitDecision('navigate_ready', 'video_truth_not_startable', 'ready');
    return readyGateHref(sid);
  }
  if (recovery.action === 'go_lobby') {
    clearDateEntryTransition(sid);
    emitDecision('stay_lobby', 'video_truth_not_startable', 'lobby');
    rcBreadcrumb(RC_CATEGORY.notifDeepLink, needsQueuedRescue ? 'queued_session_rescue_fallback_lobby' : 'date_link_fallback_lobby', {
      session_id: sid,
      queue_status: reg?.queue_status ?? null,
      ready_gate_status_after: truth?.ready_gate_status ?? null,
    });
    return eventLobbyHref(vs.event_id as string);
  }

  clearDateEntryTransition(sid);
  emitDecision('stay_lobby', 'unknown_video_truth_decision', 'lobby');
  return eventLobbyHref(vs.event_id as string);
}

/** Keeps notificationRouteRef in sync for foreground suppression. */
export function NotificationRouteTracker() {
  const pathname = usePathname();
  useEffect(() => {
    notificationRouteRef.current = pathname || '/';
  }, [pathname]);
  return null;
}

export function NotificationDeepLinkHandler() {
  const { user, session, loading, entryState, entryStateLoading } = useAuth();
  const drainQueueV2 = useFeatureFlag('video_date.outbox_v2.drain_match_queue');
  const snapshotV2 = useFeatureFlag('video_date.snapshot_v2');
  const prevUserIdRef = useRef<string | undefined>(undefined);

  const entryReady = isEntryReadyForNotificationDeepLink(
    session,
    loading,
    entryStateLoading,
    entryState
  );

  useEffect(() => {
    const prev = prevUserIdRef.current;
    if (prev && !user?.id) {
      clearPendingNotificationDeepLink();
    }
    prevUserIdRef.current = user?.id ?? undefined;
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || !entryReady) return;
    const pending = takePendingNotificationDeepLinkPath();
    if (!pending) return;
    void (async () => {
      const href = await reconcileHrefWithRegistration(pending, user.id, {
        drainMatchQueueV2: drainQueueV2.enabled,
        snapshotRecoveryV2: snapshotV2.enabled,
      });
      rcBreadcrumb(RC_CATEGORY.notifDeepLink, 'notification_pending_navigate', {
        href: String(href),
      });
      router.push(href);
    })();
  }, [drainQueueV2.enabled, snapshotV2.enabled, user?.id, entryReady]);

  useEffect(() => {
    const onClick = (event: unknown) => {
      void (async () => {
        const e = event as {
          notification?: { additionalData?: Record<string, unknown>; launchURL?: string };
          additionalData?: Record<string, unknown>;
          launchURL?: string;
        };
        const n = e?.notification ?? e;
        const additionalData = n?.additionalData ?? e?.additionalData;
        const launchURL = n?.launchURL ?? e?.launchURL;
        const data = additionalData as Record<string, unknown> | undefined;
        const rawHref = rawHrefFromPayload(additionalData, launchURL);
        const tapDeepLink = classifyPushDeepLink(rawHref);
        recordPushDeliveryTelemetry('push_notification_tap', {
          platform: 'native',
          surface: 'onesignal_click',
          ...tapDeepLink,
        });
        if (data?.type === 'support_reply' && typeof data.ticket_id === 'string') {
          const ticketPath = `/settings/ticket/${data.ticket_id}`;
          recordPushDeliveryTelemetry('push_notification_deeplink_result', {
            platform: 'native',
            surface: 'onesignal_click',
            ...classifyPushDeepLink(ticketPath),
          });
          if (!user?.id || !entryReady) {
            queueNotificationDeepLinkPath(ticketPath);
            rcBreadcrumb(RC_CATEGORY.notifDeepLink, 'notification_tap_queued', {
              href: ticketPath,
            });
            return;
          }
          router.push(ticketPath as Href);
          return;
        }
        const resolved = resolveNotificationHref(additionalData, launchURL);
        if (!resolved) {
          if (additionalData && typeof additionalData === 'object') {
            rcBreadcrumb(RC_CATEGORY.notifDeepLink, 'notification_tap_no_href', {
              has_url_key: typeof (additionalData as Record<string, unknown>).url === 'string',
            });
          }
          recordPushDeliveryTelemetry('push_notification_deeplink_result', {
            platform: 'native',
            surface: 'onesignal_click',
            ...tapDeepLink,
          });
          return;
        }
        const pathStr = String(resolved);
        recordPushDeliveryTelemetry('push_notification_deeplink_result', {
          platform: 'native',
          surface: 'onesignal_click',
          ...classifyPushDeepLink(pathStr),
        });
        if (!user?.id || !entryReady) {
          queueNotificationDeepLinkPath(pathStr);
          rcBreadcrumb(RC_CATEGORY.notifDeepLink, 'notification_tap_queued', { href: pathStr });
          return;
        }
        const nextHref = await reconcileHrefWithRegistration(pathStr, user.id, {
          drainMatchQueueV2: drainQueueV2.enabled,
          snapshotRecoveryV2: snapshotV2.enabled,
        });
        rcBreadcrumb(RC_CATEGORY.notifDeepLink, 'notification_tap_navigate', {
          href: String(nextHref),
        });
        router.push(nextHref);
      })();
    };

    const onForeground = (event: NotificationWillDisplayEvent) => {
      try {
        const n = event.getNotification();
        const raw = n.additionalData as Record<string, unknown> | undefined;
        // Chat routes use the other user's profile_id in the path (/chat/:profileId), not match_id
        const chatPeerProfileId =
          typeof raw?.sender_id === 'string'
            ? raw.sender_id
            : typeof raw?.other_user_id === 'string'
              ? raw.other_user_id
              : undefined;
        const cat = typeof raw?.category === 'string' ? raw.category : undefined;
        const isDateSuggestionCat = cat?.startsWith('date_suggestion_') ?? false;
        const path = notificationRouteRef.current;
        if (
          chatPeerProfileId &&
          path === `/chat/${chatPeerProfileId}` &&
          (cat === 'messages' ||
            cat === 'new_match' ||
            cat === 'match_call' ||
            isDateSuggestionCat)
        ) {
          rcBreadcrumb(RC_CATEGORY.notifDeepLink, 'foreground_suppressed_same_thread', {
            category: cat ?? null,
          });
          event.preventDefault();
          return;
        }
        n.display();
      } catch {
        /* default presentation if display fails */
      }
    };

    OneSignal.Notifications.addEventListener('click', onClick);
    OneSignal.Notifications.addEventListener('foregroundWillDisplay', onForeground);

    return () => {
      OneSignal.Notifications.removeEventListener('click', onClick);
      OneSignal.Notifications.removeEventListener('foregroundWillDisplay', onForeground);
    };
  }, [drainQueueV2.enabled, snapshotV2.enabled, user?.id, entryReady]);

  return null;
}
