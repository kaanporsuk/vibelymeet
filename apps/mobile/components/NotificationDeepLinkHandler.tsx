/**
 * Handles push notification opened (click) and foreground display.
 * Maps OneSignal additionalData.deep_link to Expo Router routes.
 */
import { useEffect } from 'react';
import { router } from 'expo-router';
import type { NotificationClickEvent } from 'react-native-onesignal';

let OneSignal: typeof import('react-native-onesignal').OneSignal | null = null;
try {
  OneSignal = require('react-native-onesignal').OneSignal;
} catch {
  OneSignal = null;
}

function getDeepLinkFromNotification(notification: { additionalData?: object }): string | null {
  const data = notification.additionalData as Record<string, string> | undefined;
  if (!data) return null;
  const link = data.deep_link ?? data.url ?? null;
  if (typeof link !== 'string' || !link) return null;
  // Strip origin if present (e.g. https://vibelymeet.com/chat/xxx -> /chat/xxx)
  if (link.startsWith('http')) {
    try {
      const path = new URL(link).pathname || '/';
      return path === '' ? '/' : path;
    } catch {
      return link;
    }
  }
  return link.startsWith('/') ? link : `/${link}`;
}

export function NotificationDeepLinkHandler() {
  useEffect(() => {
    if (!OneSignal?.Notifications) return;

    const handleClick = (event: NotificationClickEvent) => {
      const link = getDeepLinkFromNotification(event.notification);
      if (!link) return;

      // Map deep link paths to Expo Router routes
      if (link.startsWith('/chat/')) {
        const userId = link.replace(/^\/chat\/?/, '').split('/')[0];
        if (userId) router.push(`/chat/${userId}` as any);
      } else if (link.includes('/event/') && link.includes('/lobby')) {
        const parts = link.split('/');
        const eventIdx = parts.indexOf('event');
        const eventId = eventIdx >= 0 ? parts[eventIdx + 1] : null;
        if (eventId) router.push(`/event/${eventId}/lobby` as any);
      } else if (link.startsWith('/date/')) {
        const sessionId = link.replace(/^\/date\/?/, '').split('/')[0];
        if (sessionId) router.push(`/date/${sessionId}` as any);
      } else if (link.startsWith('/events/')) {
        const eventId = link.replace(/^\/events\/?/, '').split('/')[0];
        if (eventId) router.push(`/(tabs)/events/${eventId}` as any);
      } else if (link === '/matches' || link.startsWith('/matches')) {
        router.push('/(tabs)/matches' as any);
      } else if (link === '/profile' || link.startsWith('/profile')) {
        router.push('/(tabs)/profile' as any);
      } else if (link === '/premium' || link.startsWith('/premium')) {
        router.push('/premium' as any);
      } else if (link === '/schedule' || link.startsWith('/schedule')) {
        router.push('/schedule' as any);
      } else if (link === '/settings' || link.startsWith('/settings')) {
        router.push('/settings' as any);
      } else if (link.startsWith('/user/')) {
        const userId = link.replace(/^\/user\/?/, '').split('/')[0];
        if (userId) router.push(`/user/${userId}` as any);
      } else {
        router.push('/(tabs)' as any);
      }
    };

    const handleForegroundWillDisplay = () => {
      // Let the notification display as system banner (default behavior).
      // To suppress: event.preventDefault() and show custom in-app UI.
    };

    OneSignal.Notifications.addEventListener('click', handleClick);
    OneSignal.Notifications.addEventListener('foregroundWillDisplay', handleForegroundWillDisplay);

    return () => {
      OneSignal?.Notifications.removeEventListener('click', handleClick);
      OneSignal?.Notifications.removeEventListener('foregroundWillDisplay', handleForegroundWillDisplay);
    };
  }, []);

  return null;
}
