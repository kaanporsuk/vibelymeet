/**
 * OneSignal notification opens can fire before Supabase session is hydrated (cold start / resume).
 * Queue the in-app path and navigate once `user.id` is available; clear on sign-out.
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
