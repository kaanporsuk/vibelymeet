/**
 * Canonical native push sync on app foreground (logged-in users).
 * Player ID + pause suppression only — does not upsert push_enabled (use explicit opt-in flows for that).
 */
import { syncPushWithBackendIfPermissionGranted } from '@/lib/onesignal';
import { syncNativePushSuppressionWithBackend } from '@/lib/notificationPause';
import { pushPermDevLog } from '@/lib/osPushPermission';

export async function syncNativePushDeliveryOnForeground(userId: string): Promise<void> {
  if (__DEV__) pushPermDevLog('syncNativePushDeliveryOnForeground:start', { userId });
  await syncPushWithBackendIfPermissionGranted(userId);
  await syncNativePushSuppressionWithBackend(userId);
  if (__DEV__) pushPermDevLog('syncNativePushDeliveryOnForeground:done', { userId });
}
