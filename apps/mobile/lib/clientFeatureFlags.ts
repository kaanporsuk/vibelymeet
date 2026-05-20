import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import { trackEvent } from '@/lib/analytics';
import {
  ALL_CLIENT_FEATURE_FLAGS,
  clearClientFeatureFlagCache as clearCoreClientFeatureFlagCache,
  clearPersistedClientFeatureFlagCache,
  evaluateClientFeatureFlag,
  getCachedClientFeatureFlag,
  hydrateClientFeatureFlagCache,
  prefetchClientFeatureFlags,
  shouldRefreshClientFeatureFlag,
  failClosedUploadEvaluation,
  withUploadFlagTimeout,
  type ClientFeatureFlagEvaluation,
  type ClientFeatureFlagKey,
  type ClientFeatureFlagStorage,
  type ClientFeatureFlagTelemetryEvent,
} from '@clientShared/featureFlags/clientFeatureFlagCore';

export {
  ALL_CLIENT_FEATURE_FLAGS,
  CLIENT_FEATURE_FLAG_FOREGROUND_REFRESH_MS,
  CLIENT_FEATURE_FLAG_QUERY_KEY,
  CLIENT_FEATURE_FLAG_STORAGE_KEY,
  CLIENT_FEATURE_FLAG_TTL_MS,
  clientFeatureFlagQueryKey,
  getCachedClientFeatureFlag,
  shouldRefreshClientFeatureFlag,
  type ClientFeatureFlagEvaluation,
  type ClientFeatureFlagKey,
} from '@clientShared/featureFlags/clientFeatureFlagCore';

const nativeFeatureFlagStorage: ClientFeatureFlagStorage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};

let hydratePromise: Promise<void> | null = null;

export function hydrateNativeClientFeatureFlagCache(): Promise<void> {
  hydratePromise ??= hydrateClientFeatureFlagCache(nativeFeatureFlagStorage);
  return hydratePromise;
}

function nativePlatform() {
  return Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'native';
}

function emitFlagEvaluation(event: ClientFeatureFlagTelemetryEvent): void {
  try {
    trackEvent('media_v2_flag_evaluated', {
      flag: event.flag,
      enabled: event.enabled,
      source: event.source,
      latency_ms: event.latencyMs,
      user_id_bucket: event.userIdBucket,
      bucket: event.bucket,
      rollout_bps: event.rolloutBps,
      platform: nativePlatform(),
    });
  } catch {
    /* analytics failures must not change feature flag behavior */
  }
}

async function fetchFlagDetail(flag: ClientFeatureFlagKey, userId: string): Promise<unknown> {
  const { data, error } = await supabase.rpc('evaluate_client_feature_flag_detail' as never, {
    p_flag: flag,
    p_user: userId,
  } as never);
  if (error) throw error;
  return data;
}

async function fetchFlagsBatch(flags: readonly ClientFeatureFlagKey[], userId: string): Promise<unknown> {
  const { data, error } = await supabase.rpc('evaluate_client_feature_flags' as never, {
    p_flag_keys: [...flags],
    p_user: userId,
  } as never);
  if (error) throw error;
  return data;
}

export async function fetchClientFeatureFlag(
  flag: ClientFeatureFlagKey,
  userId: string,
  force = false,
): Promise<ClientFeatureFlagEvaluation> {
  await hydrateNativeClientFeatureFlagCache();
  return evaluateClientFeatureFlag({
    flag,
    userId,
    force,
    fetchDetail: fetchFlagDetail,
    storage: nativeFeatureFlagStorage,
    emitEvaluation: emitFlagEvaluation,
  });
}

export async function prefetchClientFeatureFlagsForUser(
  userId: string,
  flags: readonly ClientFeatureFlagKey[] = ALL_CLIENT_FEATURE_FLAGS,
): Promise<ClientFeatureFlagEvaluation[]> {
  await hydrateNativeClientFeatureFlagCache();
  return prefetchClientFeatureFlags({
    flags,
    userId,
    fetchBatch: fetchFlagsBatch,
    fetchDetail: fetchFlagDetail,
    storage: nativeFeatureFlagStorage,
    emitEvaluation: emitFlagEvaluation,
  });
}

export async function clearClientFeatureFlagCache(): Promise<void> {
  hydratePromise = null;
  await clearPersistedClientFeatureFlagCache(nativeFeatureFlagStorage);
}

export function clearClientFeatureFlagCacheForTests(): void {
  hydratePromise = null;
  clearCoreClientFeatureFlagCache();
}

export async function evaluateClientFeatureFlagForUpload(
  flag: ClientFeatureFlagKey,
  options: { userId?: string | null } = {},
): Promise<ClientFeatureFlagEvaluation> {
  try {
    const userId =
      options.userId ?? (await withUploadFlagTimeout(supabase.auth.getSession())).data.session?.user?.id ?? null;
    if (!userId) return failClosedUploadEvaluation(flag);
    return await withUploadFlagTimeout(fetchClientFeatureFlag(flag, userId, true));
  } catch {
    return failClosedUploadEvaluation(flag);
  }
}
