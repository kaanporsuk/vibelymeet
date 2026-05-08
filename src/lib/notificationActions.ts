import { resolveNotificationActionToWebRoute, type NotificationAction } from "@clientShared/notifications";

export function resolveNotificationActionRoute(action: NotificationAction | unknown): string | null {
  return resolveNotificationActionToWebRoute(action);
}
