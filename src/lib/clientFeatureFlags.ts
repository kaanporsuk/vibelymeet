import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/analytics";
import {
  ALL_CLIENT_FEATURE_FLAGS,
  CLIENT_FEATURE_FLAG_TELEMETRY_EVENT,
  CLIENT_FEATURE_FLAG_STORAGE_KEY,
  LEGACY_CLIENT_FEATURE_FLAG_TELEMETRY_EVENT,
  clearClientFeatureFlagCache as clearCoreClientFeatureFlagCache,
  clearPersistedClientFeatureFlagCache,
  evaluateClientFeatureFlag,
  getCachedClientFeatureFlag,
  hydrateClientFeatureFlagCache,
  hydrateClientFeatureFlagCacheFromString,
  prefetchClientFeatureFlags,
  shouldRefreshClientFeatureFlag,
  failClosedUploadEvaluation,
  withUploadFlagTimeout,
  type ClientFeatureFlagEvaluation,
  type ClientFeatureFlagKey,
  type ClientFeatureFlagStorage,
  type ClientFeatureFlagTelemetryEvent,
} from "@clientShared/featureFlags/clientFeatureFlagCore";

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
} from "@clientShared/featureFlags/clientFeatureFlagCore";

let webHydrated = false;

function getWebFeatureFlagStorage(): ClientFeatureFlagStorage | null {
  if (typeof window === "undefined") return null;
  try {
    const storage = window.localStorage;
    if (!storage) return null;
    return {
      getItem: (key) => storage.getItem(key),
      setItem: (key, value) => storage.setItem(key, value),
      removeItem: (key) => storage.removeItem(key),
    };
  } catch {
    return null;
  }
}

export function hydrateWebClientFeatureFlagCache(): void {
  if (webHydrated) return;
  webHydrated = true;
  try {
    hydrateClientFeatureFlagCacheFromString(getWebFeatureFlagStorage()?.getItem(CLIENT_FEATURE_FLAG_STORAGE_KEY) as string | null);
  } catch {
    /* ignore unavailable localStorage */
  }
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
    platform: "web",
  };
  const eventNames = event.flag.startsWith("media_v2_")
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
  const { data, error } = await supabase.rpc("evaluate_client_feature_flag_detail" as never, {
    p_flag: flag,
    p_user: userId,
  } as never);
  if (error) throw error;
  return data;
}

async function fetchFlagsBatch(flags: readonly ClientFeatureFlagKey[], userId: string): Promise<unknown> {
  const { data, error } = await supabase.rpc("evaluate_client_feature_flags" as never, {
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
  hydrateWebClientFeatureFlagCache();
  return evaluateClientFeatureFlag({
    flag,
    userId,
    force,
    fetchDetail: fetchFlagDetail,
    storage: getWebFeatureFlagStorage(),
    emitEvaluation: emitFlagEvaluation,
  });
}

export async function prefetchClientFeatureFlagsForUser(
  userId: string,
  flags: readonly ClientFeatureFlagKey[] = ALL_CLIENT_FEATURE_FLAGS,
): Promise<ClientFeatureFlagEvaluation[]> {
  hydrateWebClientFeatureFlagCache();
  return prefetchClientFeatureFlags({
    flags,
    userId,
    fetchBatch: fetchFlagsBatch,
    fetchDetail: fetchFlagDetail,
    storage: getWebFeatureFlagStorage(),
    emitEvaluation: emitFlagEvaluation,
  });
}

export async function hydrateClientFeatureFlagsForWeb(): Promise<void> {
  webHydrated = true;
  await hydrateClientFeatureFlagCache(getWebFeatureFlagStorage());
}

export async function clearClientFeatureFlagCache(): Promise<void> {
  webHydrated = false;
  await clearPersistedClientFeatureFlagCache(getWebFeatureFlagStorage());
}

export function clearClientFeatureFlagCacheForTests(): void {
  webHydrated = false;
  clearCoreClientFeatureFlagCache();
}

export async function evaluateClientFeatureFlagForUpload(
  flag: ClientFeatureFlagKey,
  options: { userId?: string | null } = {},
): Promise<ClientFeatureFlagEvaluation> {
  try {
    const userId = Object.prototype.hasOwnProperty.call(options, "userId")
      ? options.userId ?? null
      : (await withUploadFlagTimeout(supabase.auth.getSession())).data.session?.user?.id ?? null;
    if (!userId) return failClosedUploadEvaluation(flag);
    return await withUploadFlagTimeout(fetchClientFeatureFlag(flag, userId, true));
  } catch {
    return failClosedUploadEvaluation(flag);
  }
}
