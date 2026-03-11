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

/**
 * Request permission and register this device's push subscription ID with the backend.
 * Call after user is authenticated. Backend send-notification will include this device
 * when delivering to user_id (multi-device: web + mobile).
 */
export async function registerPushWithBackend(userId: string): Promise<boolean> {
  if (!APP_ID) return false;
  try {
    const granted = await OneSignal.Notifications.requestPermission(false);
    if (!granted) return false;
    OneSignal.login(userId);
    // Subscription ID may be available after a short delay
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
  } catch (e) {
    console.warn('[Vibely] registerPushWithBackend error:', e);
    return false;
  }
}

export function logoutOneSignal(): void {
  try {
    OneSignal.logout();
  } catch {}
}
