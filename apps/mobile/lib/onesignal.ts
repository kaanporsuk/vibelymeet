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

export function bindOneSignalExternalUser(userId: string): void {
  if (!APP_ID || !userId) return;
  try {
    OneSignal.login(userId);
  } catch (e) {
    console.warn('[Vibely] OneSignal login failed:', e);
  }
}

/** Login + subscription id + Supabase upsert (no OS permission prompt). */
async function pushSubscriptionToBackend(userId: string): Promise<boolean> {
  bindOneSignalExternalUser(userId);
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
 * Sync OneSignal subscription ID to notification_preferences after permission is already granted.
 * Does not call requestPermission — use from flows that already prompted (e.g. requestPushPermissionsAfterPrompt).
 */
export async function syncPushSubscriptionToBackend(userId: string): Promise<boolean> {
  if (!APP_ID) return false;
  try {
    return await pushSubscriptionToBackend(userId);
  } catch (e) {
    console.warn('[Vibely] syncPushSubscriptionToBackend error:', e);
    return false;
  }
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

/**
 * Suppress OneSignal push at the SDK level (optOut) or restore delivery (optIn).
 * Maps to OneSignal v5 User.pushSubscription — the public name matches common docs (disablePush).
 */
export function setNativePushSuppressed(suppress: boolean): void {
  disablePush(suppress);
}

/** Alias for OneSignal delivery gate docs — uses push subscription optOut/optIn under the hood. */
export function disablePush(disable: boolean): void {
  if (!APP_ID) return;
  try {
    if (disable) {
      OneSignal.User.pushSubscription.optOut();
    } else {
      OneSignal.User.pushSubscription.optIn();
    }
  } catch (e) {
    console.warn('[Vibely] disablePush failed:', e);
  }
}

/** Profile-like shape for OneSignal tags (all tag values must be strings). */
export type OneSignalTagsInput = {
  userId: string;
  onboardingComplete?: boolean;
  hasPhotos?: boolean;
  /** True when billable sub active/trialing OR profiles.is_premium (see useBackendSubscription). */
  isPremium?: boolean;
  /** profiles.subscription_tier (free | premium | vip) via useEntitlements tierId. */
  subscriptionTier?: string | null;
  city?: string | null;
  signupDate?: string | null; // YYYY-MM-DD or ISO string (we take date part)
};

/**
 * Set OneSignal user tags for segmentation (e.g. Incomplete Profile, Inactive 3 Days).
 * Call after login and whenever profile changes. All values are stringified for OneSignal.
 */
export function setOneSignalTags(input: OneSignalTagsInput): void {
  if (!APP_ID) return;
  try {
    const signupDate =
      input.signupDate != null
        ? (input.signupDate.includes('T') ? input.signupDate.split('T')[0] : input.signupDate)
        : '';
    const tier =
      (input.subscriptionTier ?? '').toString().trim().toLowerCase() || 'free';
    const tags: Record<string, string> = {
      user_id: input.userId,
      onboarding_complete: input.onboardingComplete === true ? 'true' : 'false',
      has_photos: input.hasPhotos === true ? 'true' : 'false',
      is_premium: input.isPremium === true ? 'true' : 'false',
      subscription_tier: tier,
      city: (input.city ?? '').toString().trim(),
      signup_date: signupDate,
    };
    OneSignal.User.addTags(tags);
  } catch (e) {
    if (__DEV__) console.warn('[Vibely] setOneSignalTags error:', e);
  }
}
