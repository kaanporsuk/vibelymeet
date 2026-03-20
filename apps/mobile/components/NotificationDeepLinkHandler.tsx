/**
 * Routes OneSignal notification opens into expo-router when payload includes a path.
 * Expects `additionalData.url` (matches web/send-notification `data.url`) or `launchURL`.
 */
import { useEffect } from 'react';
import { router, type Href } from 'expo-router';
import { OneSignal } from 'react-native-onesignal';

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
    const path = u.pathname && u.pathname !== '/' ? u.pathname : `/${u.host}`;
    if (path.startsWith('/')) return path as Href;
  } catch {
    /* ignore */
  }
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
      const href = hrefFromPayload(additionalData, launchURL);
      if (href) {
        router.push(href);
      }
    };

    const onForeground = (event: { getNotification: () => { display: () => void } }) => {
      try {
        event.getNotification().display();
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
