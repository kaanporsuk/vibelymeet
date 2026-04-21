/**
 * Canonical native push sync on app foreground (logged-in users).
 * Player ID + pause suppression only — does not upsert push_enabled (use explicit opt-in flows for that).
 */
import { syncPushWithBackendIfPermissionGranted } from '@/lib/onesignal';
import { syncNativePushSuppressionWithBackend } from '@/lib/notificationPause';
import { pushPermDevLog } from '@/lib/osPushPermission';

const foregroundSyncInFlightByUser = new Map<string, Promise<void>>();

export async function syncNativePushDeliveryOnForeground(
  userId: string,
  reason = 'unspecified',
): Promise<void> {
  const existing = foregroundSyncInFlightByUser.get(userId);
  if (existing) {
    if (__DEV__) {
      pushPermDevLog('syncNativePushDeliveryOnForeground:skipped', {
        userId,
        reason,
        skipReason: 'foreground_sync_in_flight',
      });
    }
    return existing;
  }

  const run = (async () => {
    if (__DEV__) pushPermDevLog('syncNativePushDeliveryOnForeground:start', { userId, reason });
    await syncPushWithBackendIfPermissionGranted(userId);
    await syncNativePushSuppressionWithBackend(userId);
    if (__DEV__) pushPermDevLog('syncNativePushDeliveryOnForeground:done', { userId, reason });
  })().finally(() => {
    foregroundSyncInFlightByUser.delete(userId);
  });

  foregroundSyncInFlightByUser.set(userId, run);
  return run;
}
