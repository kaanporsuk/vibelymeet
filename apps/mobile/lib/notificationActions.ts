import type { Href } from 'expo-router';
import { resolveNotificationActionToNativeRoute, type NotificationAction } from '@clientShared/notifications';

export function resolveNotificationActionRoute(action: NotificationAction | unknown): Href | null {
  const route = resolveNotificationActionToNativeRoute(action);
  return route ? (route as Href) : null;
}
