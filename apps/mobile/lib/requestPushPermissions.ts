/**
 * First-time push flow after in-app prompt: uses expo OS state so we never call
 * OneSignal.requestPermission when the user has already denied (avoids generic SDK “Open Settings” alert).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { OneSignal } from 'react-native-onesignal';
import { supabase } from '@/lib/supabase';
import { disablePush, syncPushSubscriptionToBackend } from '@/lib/onesignal';
import { PAUSED_UNTIL_KEY } from '@/lib/notificationPause';
import { getOsPushPermissionState } from '@/lib/osPushPermission';

export const VIBELY_PUSH_PERMISSION_ASKED_KEY = 'vibely_push_permission_asked';

const APP_ID = process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID ?? '';

export type PushPromptResult =
  | { outcome: 'granted' }
  | { outcome: 'already_denied' }
  | { outcome: 'denied_after_sheet' }
  | { outcome: 'no_app_id' };

/** Shared success path after OS permission is granted (prefs + OneSignal subscription; no prompts). */
export async function syncBackendAfterPushGrant(userId: string): Promise<void> {
  const stored = await AsyncStorage.getItem(PAUSED_UNTIL_KEY);
  const isPaused = !!(stored && new Date(stored) > new Date());
  if (!isPaused) {
    disablePush(false);
  }
  await supabase.from('notification_preferences').upsert(
    { user_id: userId, push_enabled: true },
    { onConflict: 'user_id' }
  );
  await syncPushSubscriptionToBackend(userId);
}

export async function requestPushPermissionsAfterPrompt(userId: string): Promise<PushPromptResult> {
  await AsyncStorage.setItem(VIBELY_PUSH_PERMISSION_ASKED_KEY, 'true');
  if (!APP_ID) {
    return { outcome: 'no_app_id' };
  }

  const os = await getOsPushPermissionState();
  if (os === 'denied') {
    await supabase.from('notification_preferences').upsert(
      { user_id: userId, push_enabled: false },
      { onConflict: 'user_id' }
    );
    return { outcome: 'already_denied' };
  }
  if (os === 'granted') {
    await syncBackendAfterPushGrant(userId);
    return { outcome: 'granted' };
  }

  const granted = await OneSignal.Notifications.requestPermission(false);
  if (granted) {
    await syncBackendAfterPushGrant(userId);
    return { outcome: 'granted' };
  }
  await supabase.from('notification_preferences').upsert(
    { user_id: userId, push_enabled: false },
    { onConflict: 'user_id' }
  );
  return { outcome: 'denied_after_sheet' };
}
