/**
 * OneSignal push integration for mobile. Same backend contract as web: send-notification
 * targets user_id; we store mobile_onesignal_player_id in notification_preferences so
 * backend can deliver to this device (web uses onesignal_player_id).
 */
import { OneSignal } from 'react-native-onesignal';
import * as Notifications from 'expo-notifications';
import { PermissionStatus } from 'expo-modules-core';
import { supabase } from '@/lib/supabase';

const APP_ID = process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID ?? '';

let initialized = false;

/** Dev-only: OneSignal subscription snapshot — not authoritative for OS permission (use expo-notifications). */
export async function logOneSignalPushDiagnostics(context: string): Promise<void> {
  if (!__DEV__ || !APP_ID) return;
  try {
    const subscriptionId = await OneSignal.User.pushSubscription.getIdAsync();
    let optedIn: boolean | undefined;
    try {
      optedIn = await (OneSignal.User.pushSubscription as { getOptedInAsync?: () => Promise<boolean> })
        .getOptedInAsync?.();
    } catch {
      optedIn = undefined;
    }
    console.log(`[Vibely][push][onesignal] ${context}`, { subscriptionId, optedIn });
  } catch (e) {
    console.log(`[Vibely][push][onesignal] ${context}`, e);
  }
}

function pushSyncDevLog(message: string, extra?: Record<string, unknown>): void {
  if (!__DEV__) return;
  if (extra) console.log(`[Vibely][push][sync] ${message}`, extra);
  else console.log(`[Vibely][push][sync] ${message}`);
}

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
  pushSyncDevLog('pushSubscriptionToBackend:start', { userId });
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
  pushSyncDevLog('pushSubscriptionToBackend:ok', { userId, subscriptionId });
  return true;
}

/**
 * Sync OneSignal subscription ID to notification_preferences after permission is already granted.
 * Does not call requestPermission — use after OS permission is granted (e.g. syncBackendAfterPushGrant).
 */
export async function syncPushSubscriptionToBackend(userId: string): Promise<boolean> {
  if (!APP_ID) return false;
  pushSyncDevLog('syncPushSubscriptionToBackend', { userId });
  try {
    return await pushSubscriptionToBackend(userId);
  } catch (e) {
    console.warn('[Vibely] syncPushSubscriptionToBackend error:', e);
    return false;
  }
}

/**
 * Register this device's push subscription with the backend when OS permission is already granted.
 * Does not prompt — call only after expo OS permission is granted.
 */
export async function registerPushWithBackend(userId: string): Promise<boolean> {
  if (!APP_ID) return false;
  pushSyncDevLog('registerPushWithBackend (sync-only, no OS prompt)', { userId });
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== PermissionStatus.GRANTED) return false;
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
  pushSyncDevLog('syncPushWithBackendIfPermissionGranted', { userId });
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== PermissionStatus.GRANTED) return false;
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

// Keep OneSignal segmentation tags intentionally small and durable.
const DURABLE_SEGMENTATION_TAG_KEYS = [
  'onboarding_complete',
  'has_photos',
  'is_premium',
  'subscription_tier',
] as const;

// Legacy/high-churn keys to delete before writes (two-step apply to avoid per-user limit failures).
const OBSOLETE_OR_EPHEMERAL_TAG_KEYS = [
  'user_id',
  'city',
  'signup_date',
] as const;

function looksLikeTagLimitError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /tag.*limit|limit.*tag|too many tags|too_many_tags|tags per user/i.test(msg);
}

function oneSignalTagWriteWarn(stage: string, error: unknown, extra?: Record<string, unknown>): void {
  const payload = {
    stage,
    overLimit: looksLikeTagLimitError(error),
    error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
    ...(extra ?? {}),
  };
  if (__DEV__) {
    console.warn('[Vibely][onesignal-tags]', payload);
    return;
  }
  console.warn('[Vibely] OneSignal tag write failed:', payload);
}

async function removeOneSignalTags(keys: readonly string[]): Promise<void> {
  if (!keys.length) return;
  const userAny = OneSignal.User as unknown as {
    removeTags?: (tagKeys: string[]) => Promise<void> | void;
    removeTag?: (tagKey: string) => Promise<void> | void;
  };
  try {
    if (typeof userAny.removeTags === 'function') {
      await userAny.removeTags([...keys]);
      return;
    }
    if (typeof userAny.removeTag === 'function') {
      await Promise.all(keys.map((k) => userAny.removeTag?.(k)));
    }
  } catch (error) {
    oneSignalTagWriteWarn('remove_obsolete_tags', error, { keys });
  }
}

/**
 * Set OneSignal user tags for segmentation (e.g. Incomplete Profile, Inactive 3 Days).
 * Call after login and whenever profile changes. All values are stringified for OneSignal.
 */
export async function setOneSignalTags(input: OneSignalTagsInput): Promise<void> {
  if (!APP_ID) return;
  try {
    const tier =
      (input.subscriptionTier ?? '').toString().trim().toLowerCase() || 'free';
    const tags: Record<(typeof DURABLE_SEGMENTATION_TAG_KEYS)[number], string> = {
      onboarding_complete: input.onboardingComplete === true ? 'true' : 'false',
      has_photos: input.hasPhotos === true ? 'true' : 'false',
      is_premium: input.isPremium === true ? 'true' : 'false',
      subscription_tier: tier,
    };
    // OneSignal docs: when user is at/over tag limit, delete first then add in a second request.
    await removeOneSignalTags(OBSOLETE_OR_EPHEMERAL_TAG_KEYS);
    await OneSignal.User.addTags(tags);
  } catch (e) {
    oneSignalTagWriteWarn('add_durable_tags', e, {
      durableKeys: DURABLE_SEGMENTATION_TAG_KEYS,
      obsoleteKeys: OBSOLETE_OR_EPHEMERAL_TAG_KEYS,
    });
  }
}
