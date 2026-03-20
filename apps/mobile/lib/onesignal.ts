/**
 * OneSignal push integration for mobile. Same backend contract as web: send-notification
 * targets user_id; we store mobile_onesignal_player_id in notification_preferences so
 * backend can deliver to this device (web uses onesignal_player_id).
 */
import { OneSignal } from 'react-native-onesignal';
import { supabase } from '@/lib/supabase';

const APP_ID = process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID ?? '';

let initialized = false;

export function initOneSignal(): void {
  if (initialized || !APP_ID) return;
  try {
    OneSignal.initialize(APP_ID);
    initialized = true;
  } catch (e) {
    console.warn('[Vibely] OneSignal init failed:', e);
  }
}

/** Login + subscription id + Supabase upsert (assumes push permission already handled). */
async function pushSubscriptionToBackend(userId: string): Promise<boolean> {
  OneSignal.login(userId);
  let subscriptionId: string | null = await OneSignal.User.pushSubscription.getIdAsync();
  if (!subscriptionId) {
    await new Promise((r) => setTimeout(r, 1500));
    subscriptionId = await OneSignal.User.pushSubscription.getIdAsync();
  }
  if (!subscriptionId) return false;
  const { error } = await supabase.from('notification_preferences').upsert(
    {
      user_id: userId,
      mobile_onesignal_player_id: subscriptionId,
      mobile_onesignal_subscribed: true,
    },
    { onConflict: 'user_id' }
  );
  if (error) {
    console.warn('[Vibely] Failed to save mobile push id:', error);
    return false;
  }
  return true;
}

/**
 * Request permission and register this device's push subscription ID with the backend.
 * Use from settings / permission flows where the user may still need the OS prompt.
 */
export async function registerPushWithBackend(userId: string): Promise<boolean> {
  if (!APP_ID) return false;
  try {
    const granted = await OneSignal.Notifications.requestPermission(false);
    if (!granted) return false;
    return await pushSubscriptionToBackend(userId);
  } catch (e) {
    console.warn('[Vibely] registerPushWithBackend error:', e);
    return false;
  }
}

/**
 * Re-register with backend only if OS permission is already granted (no prompt).
 * Use on login so returning users get player ID refreshed without nagging deniers.
 */
export async function syncPushWithBackendIfPermissionGranted(userId: string): Promise<boolean> {
  if (!APP_ID) return false;
  try {
    const granted = await OneSignal.Notifications.getPermissionAsync();
    if (!granted) return false;
    return await pushSubscriptionToBackend(userId);
  } catch (e) {
    console.warn('[Vibely] syncPushWithBackendIfPermissionGranted error:', e);
    return false;
  }
}

export function logoutOneSignal(): void {
  try {
    OneSignal.logout();
  } catch {}
}
