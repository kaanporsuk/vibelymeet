/**
 * After in-app prompt: expo OS state + single requestOsPushPermission path (no OneSignal.requestPermission).
 * Backend sync is separate from requesting OS permission.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { disablePush, syncPushSubscriptionToBackend } from '@/lib/onesignal';
import { PAUSED_UNTIL_KEY } from '@/lib/notificationPause';
import { getOsPushPermissionState, pushPermDevLog, requestOsPushPermission } from '@/lib/osPushPermission';

export const VIBELY_PUSH_PERMISSION_ASKED_KEY = 'vibely_push_permission_asked';

const APP_ID = process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID ?? '';

/**
 * Dashboard preprompt: only when user has never completed this wizard (no AsyncStorage value)
 * and OS permission is still undetermined. Denied/granted users must never get the auto modal.
 */
export async function shouldOfferDashboardPushPreprompt(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(VIBELY_PUSH_PERMISSION_ASKED_KEY);
    if (v != null && v !== '') return false;
    return (await getOsPushPermissionState()) === 'undetermined';
  } catch {
    return false;
  }
}

export type PushPromptResult =
  | { outcome: 'granted' }
  | { outcome: 'already_denied' }
  | { outcome: 'denied_after_sheet' }
  | { outcome: 'no_app_id' };

/** Shared success path after OS permission is granted (prefs + OneSignal subscription; no prompts). */
export async function syncBackendAfterPushGrant(userId: string): Promise<void> {
  if (__DEV__) pushPermDevLog('syncBackendAfterPushGrant', { userId });
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

  const { granted } = await requestOsPushPermission();
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
