/**
 * OneSignal notification opens can fire before the app is ready to honor protected routes.
 * Queue the in-app path until **session + entry state** match `EntryStateRouteGate` (see
 * `NotificationDeepLinkHandler`); clear on sign-out.
 */

let pendingPath: string | null = null;

export function queueNotificationDeepLinkPath(path: string): void {
  if (!path.startsWith('/')) return;
  pendingPath = path;
}

export function takePendingNotificationDeepLinkPath(): string | null {
  const p = pendingPath;
  pendingPath = null;
  return p;
}

export function clearPendingNotificationDeepLink(): void {
  pendingPath = null;
}
