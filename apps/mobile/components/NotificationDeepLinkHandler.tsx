/**
 * Routes OneSignal notification opens into expo-router when payload includes a path.
 * Expects `additionalData.url` (matches web/send-notification `data.url`) or `launchURL`.
 * Foreground: suppress message notifications when already viewing that chat thread.
 */
import { useEffect } from 'react';
import { router, usePathname, type Href } from 'expo-router';
import { OneSignal, NotificationWillDisplayEvent } from 'react-native-onesignal';
import { notificationRouteRef } from '@/lib/notificationRouteRef';

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

/** Keeps notificationRouteRef in sync for foreground suppression. */
export function NotificationRouteTracker() {
  const pathname = usePathname();
  useEffect(() => {
    notificationRouteRef.current = pathname || '/';
  }, [pathname]);
  return null;
}

export function NotificationDeepLinkHandler() {
  useEffect(() => {
    const onClick = (event: unknown) => {
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
        router.push(`/settings/ticket/${data.ticket_id}`);
        return;
      }
      const href = hrefFromPayload(additionalData, launchURL);
      if (href) {
        router.push(href);
      }
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
        const path = notificationRouteRef.current;
        if (chatPeerProfileId && cat === 'messages' && path === `/chat/${chatPeerProfileId}`) {
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
  }, []);

  return null;
}
