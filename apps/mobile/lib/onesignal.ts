/**
 * OneSignal push integration for mobile. Same backend contract as web:
 * send-notification targets user_id; devices register durable subscription rows
 * in push_subscriptions while mirroring legacy notification_preferences fields.
 *
 * Provider boundary: OneSignal owns remote push delivery, foreground display decisions,
 * click lifecycle, and native OS permission/status checks.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { OneSignal } from 'react-native-onesignal';
import { supabase } from '@/lib/supabase';
import {
  getOsPushPermissionState,
  requestOsPushPermission,
  type OsPushPermissionState,
  type OsPushRequestResult,
} from '@/lib/osPushPermission';
import { recordPushDeliveryTelemetry } from '@/lib/pushDeliveryTelemetry';
import type { PushSdkHealth, PushSyncResult } from '@clientShared/pushDeliveryHealth';

const APP_ID = (process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID ?? '').trim();
const PLAYER_ID_SYNC_ATTEMPTS = 8;
const PLAYER_ID_INITIAL_RETRY_MS = 500;
const PLAYER_ID_MAX_RETRY_MS = 3000;
const NATIVE_PUSH_SUBSCRIPTION_ID_CACHE_KEY = 'vibely.native_push_subscription_id_by_user.v1';

export type NativeOneSignalNotificationOpenSnapshot = {
  receivedAt: string;
  route: string | null;
  rawHref: string | null;
  category: string | null;
  type: string | null;
  actionKind: string | null;
  payload: Record<string, unknown> | null;
};

export type NativeOneSignalDiagnostics = {
  appIdConfigured: boolean;
  initialized: boolean;
  sdkStatus: PushSdkHealth;
  permissionState: OsPushPermissionState | 'unknown';
  subscriptionId: string | null;
  subscriptionIdPresent: boolean;
  optedIn: boolean | null;
  activeIdentityUserId: string | null;
  lastLoggedInUserId: string | null;
  sdkExternalUserId: string | null;
  currentSupabaseUserId: string | null;
  identityMatchesSession: boolean | null;
  lastNotificationOpen: NativeOneSignalNotificationOpenSnapshot | null;
};

type NativeOneSignalRuntimeState = {
  initializedAppId: string | null;
  initAttemptedAppId: string | null;
  initFailedAppId: string | null;
  nativeEventListenersAppId: string | null;
  overLimitTagWritesSuppressed: boolean;
  lastAppliedTagDigest: string | null;
  activeIdentityUserId: string | null;
  lastLoggedInUserId: string | null;
  identityGeneration: number;
  permissionGrantedSyncInFlightByUser: Map<string, Promise<PushSyncResult>>;
  lastNotificationOpen: NativeOneSignalNotificationOpenSnapshot | null;
  diagnosticsListeners: Set<() => void>;
};

type GlobalWithNativeOneSignalState = typeof globalThis & {
  __vibelyNativeOneSignalState?: NativeOneSignalRuntimeState;
};

const runtimeState = ((globalThis as GlobalWithNativeOneSignalState).__vibelyNativeOneSignalState ??= {
  initializedAppId: null,
  initAttemptedAppId: null,
  initFailedAppId: null,
  nativeEventListenersAppId: null,
  overLimitTagWritesSuppressed: false,
  lastAppliedTagDigest: null,
  activeIdentityUserId: null,
  lastLoggedInUserId: null,
  identityGeneration: 0,
  permissionGrantedSyncInFlightByUser: new Map<string, Promise<PushSyncResult>>(),
  lastNotificationOpen: null,
  diagnosticsListeners: new Set<() => void>(),
});

runtimeState.initAttemptedAppId ??= null;
runtimeState.initFailedAppId ??= null;
runtimeState.nativeEventListenersAppId ??= null;
runtimeState.overLimitTagWritesSuppressed ??= false;
runtimeState.lastAppliedTagDigest ??= null;
runtimeState.activeIdentityUserId ??= null;
runtimeState.lastLoggedInUserId ??= null;
runtimeState.identityGeneration ??= 0;
runtimeState.permissionGrantedSyncInFlightByUser ??= new Map<string, Promise<PushSyncResult>>();
runtimeState.lastNotificationOpen ??= null;
runtimeState.diagnosticsListeners ??= new Set<() => void>();

type PushSubscriptionRpcError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

type StoredSubscriptionIdCache = Record<string, string>;

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

function nativePushPlatform(): 'ios' | 'android' | 'native' {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return 'native';
}

async function readStoredSubscriptionIds(): Promise<StoredSubscriptionIdCache> {
  try {
    const raw = await AsyncStorage.getItem(NATIVE_PUSH_SUBSCRIPTION_ID_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as StoredSubscriptionIdCache)
      : {};
  } catch {
    return {};
  }
}

async function rememberNativePushSubscriptionId(userId: string, subscriptionId: string): Promise<void> {
  try {
    const next = await readStoredSubscriptionIds();
    next[userId] = subscriptionId;
    await AsyncStorage.setItem(NATIVE_PUSH_SUBSCRIPTION_ID_CACHE_KEY, JSON.stringify(next));
  } catch {
    /* AsyncStorage is best-effort only */
  }
}

async function readRememberedNativePushSubscriptionId(userId: string): Promise<string | null> {
  const value = (await readStoredSubscriptionIds())[userId];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function forgetRememberedNativePushSubscriptionId(userId: string): Promise<void> {
  try {
    const next = await readStoredSubscriptionIds();
    delete next[userId];
    await AsyncStorage.setItem(NATIVE_PUSH_SUBSCRIPTION_ID_CACHE_KEY, JSON.stringify(next));
  } catch {
    /* AsyncStorage is best-effort only */
  }
}

function isMissingPushSubscriptionRpc(error: PushSubscriptionRpcError | null | undefined): boolean {
  if (!error) return false;
  const haystack = `${error.code ?? ''} ${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`;
  return /42883|PGRST202|Could not find the function|register_onesignal_push_subscription|unregister_onesignal_push_subscription/i.test(haystack);
}

function emitOneSignalDiagnosticsChanged(): void {
  for (const listener of runtimeState.diagnosticsListeners) {
    try {
      listener();
    } catch {
      /* diagnostics listeners must never affect push flows */
    }
  }
}

function isOneSignalInitialized(): boolean {
  return Boolean(APP_ID && runtimeState.initializedAppId === APP_ID);
}

function currentSdkStatus(): PushSdkHealth {
  if (!APP_ID) return 'app_id_missing';
  if (runtimeState.initFailedAppId === APP_ID && !isOneSignalInitialized()) return 'init_failed';
  return isOneSignalInitialized() ? 'ready' : 'pending';
}

function registerOneSignalRuntimeEventListeners(): void {
  if (!APP_ID || runtimeState.nativeEventListenersAppId === APP_ID) return;
  try {
    OneSignal.User.pushSubscription.addEventListener('change', () => {
      emitOneSignalDiagnosticsChanged();
    });
    OneSignal.User.addEventListener('change', () => {
      emitOneSignalDiagnosticsChanged();
    });
    runtimeState.nativeEventListenersAppId = APP_ID;
  } catch (e) {
    if (__DEV__) {
      console.warn('[Vibely] OneSignal runtime listener registration failed:', e);
    }
  }
}

function ensureOneSignalInitialized(): boolean {
  if (!APP_ID) return false;
  if (isOneSignalInitialized()) {
    registerOneSignalRuntimeEventListeners();
    return true;
  }
  if (runtimeState.initFailedAppId === APP_ID || runtimeState.initAttemptedAppId === APP_ID) return false;
  initOneSignal();
  return isOneSignalInitialized();
}

export function getNativeOneSignalClientSnapshot(): {
  appIdConfigured: boolean;
  initialized: boolean;
  sdkStatus: PushSdkHealth;
} {
  const appIdConfigured = APP_ID.trim().length > 0;
  return {
    appIdConfigured,
    initialized: isOneSignalInitialized(),
    sdkStatus: appIdConfigured ? currentSdkStatus() : 'app_id_missing',
  };
}

export function subscribeNativeOneSignalDiagnostics(listener: () => void): () => void {
  runtimeState.diagnosticsListeners.add(listener);
  return () => {
    runtimeState.diagnosticsListeners.delete(listener);
  };
}

export function recordOneSignalNotificationOpenForDiagnostics(
  snapshot: NativeOneSignalNotificationOpenSnapshot,
): void {
  if (!__DEV__) return;
  runtimeState.lastNotificationOpen = snapshot;
  emitOneSignalDiagnosticsChanged();
}

export async function getNativeOneSignalDiagnostics(
  currentSupabaseUserId?: string | null,
): Promise<NativeOneSignalDiagnostics> {
  const client = getNativeOneSignalClientSnapshot();
  let permissionState: NativeOneSignalDiagnostics['permissionState'] = 'unknown';
  try {
    if (APP_ID) {
      permissionState = await getOsPushPermissionState();
    }
  } catch {
    permissionState = 'unknown';
  }

  const [subscriptionId, optedIn, sdkExternalUserId] = await Promise.all([
    getCurrentNativePlayerId(),
    getCurrentNativePushSubscribed(),
    getCurrentOneSignalExternalUserId(),
  ]);
  const sessionUserId = currentSupabaseUserId ?? null;
  const loggedInUserId = runtimeState.lastLoggedInUserId ?? sdkExternalUserId;

  return {
    ...client,
    permissionState,
    subscriptionId,
    subscriptionIdPresent: Boolean(subscriptionId),
    optedIn,
    activeIdentityUserId: runtimeState.activeIdentityUserId,
    lastLoggedInUserId: runtimeState.lastLoggedInUserId,
    sdkExternalUserId,
    currentSupabaseUserId: sessionUserId,
    identityMatchesSession: sessionUserId ? Boolean(loggedInUserId) && loggedInUserId === sessionUserId : null,
    lastNotificationOpen: runtimeState.lastNotificationOpen,
  };
}

export function getOneSignalIdentityGeneration(): number {
  return runtimeState.identityGeneration;
}

export function isCurrentOneSignalIdentity(userId: string, generation: number): boolean {
  return runtimeState.activeIdentityUserId === userId && runtimeState.identityGeneration === generation;
}

export async function getCurrentNativePlayerId(): Promise<string | null> {
  if (!APP_ID) return null;
  if (!ensureOneSignalInitialized()) return null;
  try {
    return await OneSignal.User.pushSubscription.getIdAsync();
  } catch {
    return null;
  }
}

export async function getCurrentNativePushSubscribed(): Promise<boolean | null> {
  if (!APP_ID) return null;
  if (!ensureOneSignalInitialized()) return null;
  try {
    return await OneSignal.User.pushSubscription.getOptedInAsync();
  } catch {
    return null;
  }
}

export async function getCurrentOneSignalExternalUserId(): Promise<string | null> {
  if (!APP_ID) return null;
  if (!ensureOneSignalInitialized()) return null;
  try {
    return await OneSignal.User.getExternalId();
  } catch {
    return null;
  }
}

/** Dev-only: OneSignal subscription snapshot — not authoritative for durable backend registration. */
export async function logOneSignalPushDiagnostics(context: string): Promise<void> {
  if (!__DEV__ || !APP_ID) return;
  try {
    const diagnostics = await getNativeOneSignalDiagnostics();
    console.log(`[Vibely][push][onesignal] ${context}`, diagnostics);
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
  if (isOneSignalInitialized() || !APP_ID || runtimeState.initAttemptedAppId === APP_ID) {
    if (isOneSignalInitialized()) registerOneSignalRuntimeEventListeners();
    return;
  }
  runtimeState.initAttemptedAppId = APP_ID;
  emitOneSignalDiagnosticsChanged();
  try {
    OneSignal.initialize(APP_ID);
    runtimeState.initializedAppId = APP_ID;
    runtimeState.initFailedAppId = null;
    registerOneSignalRuntimeEventListeners();
    emitOneSignalDiagnosticsChanged();
  } catch (e) {
    runtimeState.initFailedAppId = APP_ID;
    emitOneSignalDiagnosticsChanged();
    console.warn('[Vibely] OneSignal init failed:', e);
    recordPushDeliveryTelemetry('push_registration_sync_result', {
      platform: 'native',
      surface: 'sdk_init',
      sdk_status: 'init_failed',
      sync_result_code: 'init_failed',
    });
  }
}

export async function requestOneSignalPushPermission(): Promise<OsPushRequestResult> {
  if (!APP_ID || !ensureOneSignalInitialized()) {
    return { granted: false, osDenied: false };
  }
  const result = await requestOsPushPermission();
  emitOneSignalDiagnosticsChanged();
  return result;
}

export function bindOneSignalExternalUser(userId: string): number {
  const nextUserId = userId.trim();
  if (runtimeState.activeIdentityUserId !== nextUserId) {
    runtimeState.identityGeneration += 1;
    runtimeState.activeIdentityUserId = nextUserId || null;
    runtimeState.lastLoggedInUserId = null;
    emitOneSignalDiagnosticsChanged();
  }
  const generation = runtimeState.identityGeneration;
  if (!APP_ID || !nextUserId) return generation;
  if (!ensureOneSignalInitialized()) return generation;
  if (runtimeState.lastLoggedInUserId === nextUserId) return generation;
  try {
    OneSignal.login(nextUserId);
    if (isCurrentOneSignalIdentity(nextUserId, generation)) {
      runtimeState.lastLoggedInUserId = nextUserId;
      emitOneSignalDiagnosticsChanged();
    }
  } catch (e) {
    runtimeState.lastLoggedInUserId = null;
    emitOneSignalDiagnosticsChanged();
    console.warn('[Vibely] OneSignal login failed:', e);
  }
  return generation;
}

async function registerStoredPushSubscription(
  userId: string,
  subscriptionId: string,
  subscribed: boolean,
): Promise<string | null> {
  const { error } = await supabase.rpc('register_onesignal_push_subscription', {
    p_subscription_id: subscriptionId,
    p_platform: nativePushPlatform(),
    p_subscribed: subscribed,
  });

  if (!error) return null;

  if (!isMissingPushSubscriptionRpc(error as PushSubscriptionRpcError)) {
    return error.message;
  }

  const fallback = await supabase.from('notification_preferences').upsert(
    {
      user_id: userId,
      mobile_onesignal_player_id: subscriptionId,
      mobile_onesignal_subscribed: subscribed,
    },
    { onConflict: 'user_id' }
  );
  return fallback.error?.message ?? null;
}

async function unregisterStoredPushSubscription(
  userId: string,
  subscriptionId: string | null,
): Promise<string | null> {
  const { error } = await supabase.rpc('unregister_onesignal_push_subscription', {
    p_subscription_id: subscriptionId,
    p_platform: nativePushPlatform(),
  });

  if (!error) return null;

  if (!isMissingPushSubscriptionRpc(error as PushSubscriptionRpcError)) {
    return error.message;
  }

  let query = supabase
    .from('notification_preferences')
    .update({
      mobile_onesignal_player_id: null,
      mobile_onesignal_subscribed: false,
    })
    .eq('user_id', userId);

  if (subscriptionId) {
    query = query.eq('mobile_onesignal_player_id', subscriptionId);
  }

  const fallback = await query;
  return fallback.error?.message ?? null;
}

/** Login + subscription id + Supabase upsert (no OS permission prompt). */
async function pushSubscriptionToBackend(userId: string): Promise<PushSyncResult> {
  pushSyncDevLog('pushSubscriptionToBackend:start', { userId });
  if (!APP_ID) return syncResult('app_id_missing');
  if (!ensureOneSignalInitialized()) return syncResult('init_failed');
  const generation = bindOneSignalExternalUser(userId);

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

  const saveError = await registerStoredPushSubscription(userId, subscriptionId, subscribed === true);
  if (saveError) {
    console.warn('[Vibely] Failed to save mobile push id:', saveError);
    return syncResult('upsert_failed', subscriptionId, saveError);
  }
  if (!isCurrentOneSignalIdentity(userId, generation)) {
    return syncResult('stale_identity', subscriptionId);
  }
  await rememberNativePushSubscriptionId(userId, subscriptionId);
  if (subscribed !== true) {
    return syncResult('sdk_not_ready', subscriptionId, 'OneSignal native subscription is not opted in yet.');
  }
  pushSyncDevLog('pushSubscriptionToBackend:ok', { userId, subscriptionId });
  return syncResult('synced', subscriptionId);
}

/**
 * Sync OneSignal subscription ID to the backend after permission is already granted.
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
    if (!ensureOneSignalInitialized()) return syncResult('init_failed');
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
  const existing = runtimeState.permissionGrantedSyncInFlightByUser.get(userId);
  if (existing) {
    pushSyncDevLog('syncPushWithBackendIfPermissionGranted:coalesced', { userId });
    return existing;
  }
  pushSyncDevLog('syncPushWithBackendIfPermissionGranted', { userId });
  const run = (async () => {
    try {
      if (!ensureOneSignalInitialized()) return syncResult('init_failed');
      if ((await getOsPushPermissionState()) !== 'granted') return syncResult('permission_denied');
      return await pushSubscriptionToBackend(userId);
    } catch (e) {
      console.warn('[Vibely] syncPushWithBackendIfPermissionGranted error:', e);
      return syncResult('upsert_failed', null, e instanceof Error ? e.message : String(e));
    }
  })().finally(() => {
    runtimeState.permissionGrantedSyncInFlightByUser.delete(userId);
  });
  runtimeState.permissionGrantedSyncInFlightByUser.set(userId, run);
  return run;
}

export function logoutOneSignal(): void {
  runtimeState.identityGeneration += 1;
  runtimeState.activeIdentityUserId = null;
  runtimeState.lastLoggedInUserId = null;
  try {
    if (ensureOneSignalInitialized()) OneSignal.logout();
  } catch {}
  runtimeState.overLimitTagWritesSuppressed = false;
  runtimeState.lastAppliedTagDigest = null;
  emitOneSignalDiagnosticsChanged();
}

function optOutNativePushSubscriptionForLogout(): void {
  if (!APP_ID) return;
  try {
    if (!ensureOneSignalInitialized()) return;
    OneSignal.User.pushSubscription.optOut();
  } catch {}
}

export async function disconnectOneSignalForLogout(userId?: string | null): Promise<void> {
  runtimeState.identityGeneration += 1;
  runtimeState.activeIdentityUserId = null;
  runtimeState.lastLoggedInUserId = null;
  emitOneSignalDiagnosticsChanged();
  const liveSubscriptionId = await getCurrentNativePlayerId();
  const subscriptionId =
    liveSubscriptionId?.trim() || (userId ? await readRememberedNativePushSubscriptionId(userId) : null);
  if (userId) {
    const unregisterError = await unregisterStoredPushSubscription(userId, subscriptionId);
    if (unregisterError && __DEV__) {
      console.warn('[Vibely] Failed to unregister mobile push id:', unregisterError);
    }
    await forgetRememberedNativePushSubscriptionId(userId);
  }
  optOutNativePushSubscriptionForLogout();
  logoutOneSignal();
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
    if (!ensureOneSignalInitialized()) return;
    if (disable) {
      OneSignal.User.pushSubscription.optOut();
    } else {
      OneSignal.User.pushSubscription.optIn();
    }
    emitOneSignalDiagnosticsChanged();
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
  if (runtimeState.overLimitTagWritesSuppressed) {
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
    if (runtimeState.lastAppliedTagDigest === digest) {
      pushSyncDevLog('setOneSignalTags skipped', { reason: 'unchanged_tags' });
      return;
    }
    // OneSignal docs: when user is at/over tag limit, delete first then add in a second request.
    await removeOneSignalTags(OBSOLETE_OR_EPHEMERAL_TAG_KEYS);
    await OneSignal.User.addTags(tags);
    runtimeState.lastAppliedTagDigest = digest;
  } catch (e) {
    if (looksLikeTagLimitError(e)) {
      runtimeState.overLimitTagWritesSuppressed = true;
    }
    oneSignalTagWriteWarn('add_durable_tags', e, {
      durableKeys: DURABLE_SEGMENTATION_TAG_KEYS,
      obsoleteKeys: OBSOLETE_OR_EPHEMERAL_TAG_KEYS,
      overLimitTagWritesSuppressed: runtimeState.overLimitTagWritesSuppressed,
    });
  }
}
