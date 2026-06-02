/**
 * Master "All Notifications" switch — only touches push_enabled + OneSignal opt-in/out.
 * Never modifies category toggles or paused_until.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { disablePush, syncPushWithBackendIfPermissionGranted } from '@/lib/onesignal';
import { PAUSED_UNTIL_KEY } from '@/lib/notificationPause';
import { getStableOsPushPermissionState } from '@/lib/osPushPermission';

function syncPushAfterRestoringDelivery(userId: string): void {
  void import('@/lib/onesignal')
    .then(({ syncPushWithBackendIfPermissionGranted }) => syncPushWithBackendIfPermissionGranted(userId))
    .catch(() => undefined);
}

export async function applyMasterPushEnabled(userId: string, enabled: boolean): Promise<void> {
  if (!enabled) {
    const { error } = await supabase.from('notification_preferences').upsert(
      { user_id: userId, push_enabled: false },
      { onConflict: 'user_id' }
    );
    if (error) throw error;
    disablePush(true);
    return;
  }

  const osPermission = await getStableOsPushPermissionState('settings_master_switch_enable');
  if (osPermission !== 'granted') {
    throw new Error(
      osPermission === 'denied'
        ? 'Notifications are blocked in system settings. Open settings and allow notifications first.'
        : 'Allow notifications first, then turn on delivery.',
    );
  }

  const stored = await AsyncStorage.getItem(PAUSED_UNTIL_KEY);
  const isPaused = !!(stored && new Date(stored) > new Date());
  if (!isPaused) {
    disablePush(false);
  }
  const sync = await syncPushWithBackendIfPermissionGranted(userId);
  if (!sync.synced) {
    if (!isPaused) {
      disablePush(true);
    }
    throw new Error(sync.message ?? 'Push registration is still finishing. Try again in a moment.');
  }

  const { error } = await supabase.from('notification_preferences').upsert(
    { user_id: userId, push_enabled: true },
    { onConflict: 'user_id' }
  );
  if (error) {
    if (!isPaused) {
      disablePush(true);
    }
    throw error;
  }
  syncPushAfterRestoringDelivery(userId);
}
