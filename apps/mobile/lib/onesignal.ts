/**
 * OneSignal push integration for mobile. Same backend contract as web: send-notification
 * targets user_id; we store mobile_onesignal_player_id in notification_preferences so
 * backend can deliver to this device (web uses onesignal_player_id).
 *
 * Provider boundary: OneSignal owns remote push delivery, foreground display decisions,
 * click lifecycle, and native OS permission/status checks.
 */
import { Platform } from 'react-native';
import { OneSignal } from 'react-native-onesignal';
import { supabase } from '@/lib/supabase';
import { getOsPushPermissionState } from '@/lib/osPushPermission';
import { recordPushDeliveryTelemetry } from '@/lib/pushDeliveryTelemetry';
import type { PushSdkHealth, PushSyncResult } from '@clientShared/pushDeliveryHealth';

const APP_ID = process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID ?? '';
const PLAYER_ID_SYNC_ATTEMPTS = 8;
const PLAYER_ID_INITIAL_RETRY_MS = 500;
const PLAYER_ID_MAX_RETRY_MS = 3000;

let initialized = false;
let overLimitTagWritesSuppressed = false;
let lastAppliedTagDigest: string | null = null;
let activeIdentityUserId: string | null = null;
let identityGeneration = 0;

function syncResult(
  code: PushSyncResult['code'],
  playerId: string | null = null,
  message?: string,
): PushSyncResult {
  return { code, synced: code === 'synced', playerId, message };
}

function playerIdRetryDelay(attempt: number): number {
  return Math.min(PLAYER_ID_MAX_RETRY_MS, Math.round(PLAYER_ID_INITIAL_RETRY_MS * Math.pow(1.65, attempt)));
}

export function getNativeOneSignalClientSnapshot(): {
  appIdConfigured: boolean;
  initialized: boolean;
  sdkStatus: PushSdkHealth;
} {
  const appIdConfigured = APP_ID.trim().length > 0;
  return {
    appIdConfigured,
    initialized,
    sdkStatus: !appIdConfigured ? 'app_id_missing' : initialized ? 'ready' : 'pending',
  };
}

export function getOneSignalIdentityGeneration(): number {
  return identityGeneration;
}

export function isCurrentOneSignalIdentity(userId: string, generation: number): boolean {
  return activeIdentityUserId === userId && identityGeneration === generation;
}

export async function getCurrentNativePlayerId(): Promise<string | null> {
  if (!APP_ID) return null;
  try {
    return await OneSignal.User.pushSubscription.getIdAsync();
  } catch {
    return null;
  }
}

export async function getCurrentNativePushSubscribed(): Promise<boolean | null> {
  if (!APP_ID) return null;
  try {
    return await OneSignal.User.pushSubscription.getOptedInAsync();
  } catch {
    return null;
  }
}

/** Dev-only: OneSignal subscription snapshot — not authoritative for durable backend registration. */
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
    recordPushDeliveryTelemetry('push_registration_sync_result', {
      platform: 'native',
      surface: 'sdk_init',
      sdk_status: 'init_failed',
      sync_result_code: 'init_failed',
    });
  }
}

export function bindOneSignalExternalUser(userId: string): number {
  if (activeIdentityUserId !== userId) {
    identityGeneration += 1;
    activeIdentityUserId = userId;
  }
  const generation = identityGeneration;
  if (!APP_ID || !userId) return generation;
  try {
    OneSignal.login(userId);
  } catch (e) {
    console.warn('[Vibely] OneSignal login failed:', e);
  }
  return generation;
}

/** Login + subscription id + Supabase upsert (no OS permission prompt). */
async function pushSubscriptionToBackend(userId: string): Promise<PushSyncResult> {
  pushSyncDevLog('pushSubscriptionToBackend:start', { userId });
  if (!APP_ID) return syncResult('app_id_missing');
  const generation = bindOneSignalExternalUser(userId);
  if (!initialized) initOneSignal();

  let subscriptionId: string | null = null;
  for (let i = 0; i < PLAYER_ID_SYNC_ATTEMPTS; i += 1) {
    subscriptionId = await OneSignal.User.pushSubscription.getIdAsync();
    if (subscriptionId) break;
    await new Promise((r) => setTimeout(r, playerIdRetryDelay(i)));
  }

  if (!isCurrentOneSignalIdentity(userId, generation)) {
    return syncResult('stale_identity', subscriptionId);
  }
  if (!subscriptionId) return syncResult('no_player_id_after_retry');
  const subscribed = await getCurrentNativePushSubscribed();
  if (!isCurrentOneSignalIdentity(userId, generation)) {
    return syncResult('stale_identity', subscriptionId);
  }

  const { error } = await supabase.from('notification_preferences').upsert(
    {
      user_id: userId,
      mobile_onesignal_player_id: subscriptionId,
      mobile_onesignal_subscribed: subscribed === true,
    },
    { onConflict: 'user_id' }
  );
  if (error) {
    console.warn('[Vibely] Failed to save mobile push id:', error);
    return syncResult('upsert_failed', subscriptionId, error.message);
  }
  if (!isCurrentOneSignalIdentity(userId, generation)) {
    return syncResult('stale_identity', subscriptionId);
  }
  if (subscribed !== true) {
    return syncResult('sdk_not_ready', subscriptionId, 'OneSignal native subscription is not opted in yet.');
  }
  pushSyncDevLog('pushSubscriptionToBackend:ok', { userId, subscriptionId });
  return syncResult('synced', subscriptionId);
}

/**
 * Sync OneSignal subscription ID to notification_preferences after permission is already granted.
 * Does not call requestPermission — use after OS permission is granted (e.g. syncBackendAfterPushGrant).
 */
export async function syncPushSubscriptionToBackend(userId: string): Promise<PushSyncResult> {
  if (!APP_ID) return syncResult('app_id_missing');
  pushSyncDevLog('syncPushSubscriptionToBackend', { userId });
  try {
    return await pushSubscriptionToBackend(userId);
  } catch (e) {
    console.warn('[Vibely] syncPushSubscriptionToBackend error:', e);
    return syncResult('upsert_failed', null, e instanceof Error ? e.message : String(e));
  }
}

/**
 * Register this device's push subscription with the backend when OS permission is already granted.
 * Does not prompt — call only after expo OS permission is granted.
 */
export async function registerPushWithBackend(userId: string): Promise<PushSyncResult> {
  if (!APP_ID) return syncResult('app_id_missing');
  pushSyncDevLog('registerPushWithBackend (sync-only, no OS prompt)', { userId });
  try {
    if ((await getOsPushPermissionState()) !== 'granted') return syncResult('permission_denied');
    return await pushSubscriptionToBackend(userId);
  } catch (e) {
    console.warn('[Vibely] registerPushWithBackend error:', e);
    return syncResult('upsert_failed', null, e instanceof Error ? e.message : String(e));
  }
}

/**
 * Re-register with backend only if OS permission is already granted (no prompt).
 * Use on login so returning users get player ID refreshed without nagging deniers.
 */
export async function syncPushWithBackendIfPermissionGranted(userId: string): Promise<PushSyncResult> {
  if (!APP_ID) return syncResult('app_id_missing');
  pushSyncDevLog('syncPushWithBackendIfPermissionGranted', { userId });
  try {
    if ((await getOsPushPermissionState()) !== 'granted') return syncResult('permission_denied');
    return await pushSubscriptionToBackend(userId);
  } catch (e) {
    console.warn('[Vibely] syncPushWithBackendIfPermissionGranted error:', e);
    return syncResult('upsert_failed', null, e instanceof Error ? e.message : String(e));
  }
}

export function logoutOneSignal(): void {
  identityGeneration += 1;
  activeIdentityUserId = null;
  try {
    OneSignal.logout();
  } catch {}
  overLimitTagWritesSuppressed = false;
  lastAppliedTagDigest = null;
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
  return /entitlements.tag.limit|tag.*limit|limit.*tag|too many tags|too_many_tags|tags per user/i.test(msg);
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

function digestOneSignalTags(tags: Record<string, string>): string {
  return JSON.stringify(
    Object.keys(tags)
      .sort()
      .map((key) => [key, tags[key]])
  );
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
  // Native: skip SDK segmentation tags to avoid per-user tag limit noise; backend push prefs stay authoritative.
  if (Platform.OS !== 'web') {
    pushSyncDevLog('setOneSignalTags skipped', { reason: 'native_sdk_tags_disabled' });
    return;
  }
  if (overLimitTagWritesSuppressed) {
    pushSyncDevLog('setOneSignalTags skipped', { reason: 'over_limit_suppressed' });
    return;
  }
  try {
    const tier =
      (input.subscriptionTier ?? '').toString().trim().toLowerCase() || 'free';
    const tags: Record<(typeof DURABLE_SEGMENTATION_TAG_KEYS)[number], string> = {
      onboarding_complete: input.onboardingComplete === true ? 'true' : 'false',
      has_photos: input.hasPhotos === true ? 'true' : 'false',
      is_premium: input.isPremium === true ? 'true' : 'false',
      subscription_tier: tier,
    };
    const digest = digestOneSignalTags(tags);
    if (lastAppliedTagDigest === digest) {
      pushSyncDevLog('setOneSignalTags skipped', { reason: 'unchanged_tags' });
      return;
    }
    // OneSignal docs: when user is at/over tag limit, delete first then add in a second request.
    await removeOneSignalTags(OBSOLETE_OR_EPHEMERAL_TAG_KEYS);
    await OneSignal.User.addTags(tags);
    lastAppliedTagDigest = digest;
  } catch (e) {
    if (looksLikeTagLimitError(e)) {
      overLimitTagWritesSuppressed = true;
    }
    oneSignalTagWriteWarn('add_durable_tags', e, {
      durableKeys: DURABLE_SEGMENTATION_TAG_KEYS,
      obsoleteKeys: OBSOLETE_OR_EPHEMERAL_TAG_KEYS,
      overLimitTagWritesSuppressed,
    });
  }
}
