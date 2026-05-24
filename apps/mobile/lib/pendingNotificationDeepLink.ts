/**
 * OneSignal notification opens can fire before the app is ready to honor protected routes.
 * Queue the in-app path until **session + entry state** match `EntryStateRouteGate` (see
 * `NotificationDeepLinkHandler`); clear on sign-out.
 */

export type PendingNotificationDeepLink = {
  path: string;
  allowOneShotSideEffects: boolean;
};

let pending: PendingNotificationDeepLink | null = null;

export function queueNotificationDeepLinkPath(
  path: string,
  options?: { allowOneShotSideEffects?: boolean },
): void {
  if (!path.startsWith('/')) return;
  pending = {
    path,
    allowOneShotSideEffects: options?.allowOneShotSideEffects !== false,
  };
}

export function takePendingNotificationDeepLinkPath(): PendingNotificationDeepLink | null {
  const value = pending;
  pending = null;
  return value;
}

export function clearPendingNotificationDeepLink(): void {
  pending = null;
}
