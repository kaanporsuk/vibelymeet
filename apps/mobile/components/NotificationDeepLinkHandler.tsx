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
import { supabase } from '@/lib/supabase';
import {
  clearPendingNotificationDeepLink,
  queueNotificationDeepLinkPath,
  takePendingNotificationDeepLinkPath,
} from '@/lib/pendingNotificationDeepLink';

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
  if (!peer || typeof base !== 'string') return base;
  if (base.startsWith('/chat/')) {
    return `/chat/${peer}` as Href;
  }
  return base;
}

/**
 * If payload targets /date/:id, align with backend truth:
 * ended session → event lobby (or home); still in_ready_gate → /ready/:id; otherwise keep /date.
 */
async function reconcileHrefWithRegistration(href: string, userId: string): Promise<string> {
  const m = href.match(/^\/date\/([^/?#]+)/);
  if (!m) return href;
  const sid = m[1];

  const { data: vs } = await supabase
    .from('video_sessions')
    .select('event_id, ended_at')
    .eq('id', sid)
    .maybeSingle();

  if (!vs) return href;

  if (vs.ended_at != null) {
    if (vs.event_id) return `/event/${vs.event_id}/lobby`;
    return '/(tabs)';
  }

  if (!vs.event_id) return href;

  const { data: reg } = await supabase
    .from('event_registrations')
    .select('queue_status')
    .eq('profile_id', userId)
    .eq('event_id', vs.event_id)
    .maybeSingle();

  if (reg?.queue_status === 'in_ready_gate') {
    return `/ready/${sid}`;
  }

  return href;
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
      const href = (await reconcileHrefWithRegistration(pending, user.id)) as Href;
      rcBreadcrumb(RC_CATEGORY.notifDeepLink, 'notification_pending_navigate', {
        href: String(href),
      });
      router.push(href);
    })();
  }, [user?.id, entryReady]);

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
        if (data?.type === 'support_reply' && typeof data.ticket_id === 'string') {
          const ticketPath = `/settings/ticket/${data.ticket_id}`;
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
        let href = resolveNotificationHref(additionalData, launchURL);
        if (!href) {
          if (additionalData && typeof additionalData === 'object') {
            rcBreadcrumb(RC_CATEGORY.notifDeepLink, 'notification_tap_no_href', {
              has_url_key: typeof (additionalData as Record<string, unknown>).url === 'string',
            });
          }
          return;
        }
        const pathStr = String(href);
        if (!user?.id || !entryReady) {
          queueNotificationDeepLinkPath(pathStr);
          rcBreadcrumb(RC_CATEGORY.notifDeepLink, 'notification_tap_queued', { href: pathStr });
          return;
        }
        href = (await reconcileHrefWithRegistration(pathStr, user.id)) as Href;
        rcBreadcrumb(RC_CATEGORY.notifDeepLink, 'notification_tap_navigate', {
          href: String(href),
        });
        router.push(href);
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
  }, [user?.id, entryReady]);

  return null;
}
