import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import { trackEvent } from '@/lib/analytics';
import {
  ALL_CLIENT_FEATURE_FLAGS,
  CLIENT_FEATURE_FLAG_TELEMETRY_EVENT,
  LEGACY_CLIENT_FEATURE_FLAG_TELEMETRY_EVENT,
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
  CLIENT_FEATURE_FLAG_TELEMETRY_EVENT,
  CLIENT_FEATURE_FLAG_TTL_MS,
  LEGACY_CLIENT_FEATURE_FLAG_TELEMETRY_EVENT,
  clientFeatureFlagQueryKey,
  getCachedClientFeatureFlag,
  shouldRefreshClientFeatureFlag,
  type ClientFeatureFlagEvaluation,
  type ClientFeatureFlagKey,
} from '@clientShared/featureFlags/clientFeatureFlagCore';
import { createBatchedFlagDetailFetcher } from '@clientShared/featureFlags/batchedFlagDetailFetcher';

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
  const payload = {
    flag: event.flag,
    enabled: event.enabled,
    source: event.source,
    latency_ms: event.latencyMs,
    user_id_bucket: event.userIdBucket,
    bucket: event.bucket,
    rollout_bps: event.rolloutBps,
    platform: nativePlatform(),
  };
  const eventNames = event.flag.startsWith('media_v2_')
    ? [LEGACY_CLIENT_FEATURE_FLAG_TELEMETRY_EVENT, CLIENT_FEATURE_FLAG_TELEMETRY_EVENT]
    : [CLIENT_FEATURE_FLAG_TELEMETRY_EVENT];
  for (const eventName of eventNames) {
    try {
      trackEvent(eventName, payload);
    } catch {
      /* analytics failures must not change feature flag behavior */
    }
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

// Concurrent cache misses (e.g. the /date mount burst) coalesce into one
// evaluate_client_feature_flags call instead of one detail RPC per flag.
const fetchFlagDetailBatched = createBatchedFlagDetailFetcher({
  fetchBatch: fetchFlagsBatch,
  fetchDetail: fetchFlagDetail,
});

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
    fetchDetail: fetchFlagDetailBatched,
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
    const userId = Object.prototype.hasOwnProperty.call(options, 'userId')
      ? options.userId ?? null
      : (await withUploadFlagTimeout(supabase.auth.getSession())).data.session?.user?.id ?? null;
    if (!userId) return failClosedUploadEvaluation(flag);
    return await withUploadFlagTimeout(fetchClientFeatureFlag(flag, userId, true));
  } catch {
    return failClosedUploadEvaluation(flag);
  }
}
