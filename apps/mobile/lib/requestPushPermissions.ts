/**
 * First-time push permission flow after in-app prompt (OneSignal v5: Notifications.requestPermission).
 * Does not use legacy promptForPushNotificationsWithUserResponse (not in RN SDK v5).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { OneSignal } from 'react-native-onesignal';
import { supabase } from '@/lib/supabase';
import { disablePush, syncPushSubscriptionToBackend } from '@/lib/onesignal';
import { PAUSED_UNTIL_KEY } from '@/lib/notificationPause';

export const VIBELY_PUSH_PERMISSION_ASKED_KEY = 'vibely_push_permission_asked';

const APP_ID = process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID ?? '';

export async function requestPushPermissionsAfterPrompt(userId: string): Promise<boolean> {
  await AsyncStorage.setItem(VIBELY_PUSH_PERMISSION_ASKED_KEY, 'true');
  if (!APP_ID) return false;
  const granted = await OneSignal.Notifications.requestPermission(false);
  if (granted) {
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
  } else {
    await supabase.from('notification_preferences').upsert(
      { user_id: userId, push_enabled: false },
      { onConflict: 'user_id' }
    );
  }
  return granted;
}
