import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";

export type ClientFeatureFlagKey = "media_v2_video" | "media_v2_photo" | "media_v2_voice";

export const CLIENT_FEATURE_FLAG_TTL_MS = 60_000;

type CachedFlag = {
  enabled: boolean;
  expiresAtMs: number;
};

const flagCache = new Map<string, CachedFlag>();
const inFlight = new Map<string, Promise<boolean>>();

function cacheKey(flag: ClientFeatureFlagKey, userId: string) {
  return `${userId}:${flag}`;
}

async function fetchFeatureFlag(flag: ClientFeatureFlagKey, userId: string, force = false): Promise<boolean> {
  const key = cacheKey(flag, userId);
  const now = Date.now();
  const cached = flagCache.get(key);
  if (!force && cached && cached.expiresAtMs > now) return cached.enabled;

  const existing = inFlight.get(key);
  if (existing) return existing;

  const request = (async () => {
    let enabled = false;
    try {
      const { data, error } = await supabase.rpc("evaluate_client_feature_flag", {
        p_flag: flag,
        p_user: userId,
      });
      enabled = error ? false : data === true;
    } catch {
      enabled = false;
    }
    flagCache.set(key, { enabled, expiresAtMs: Date.now() + CLIENT_FEATURE_FLAG_TTL_MS });
    return enabled;
  })();

  inFlight.set(key, request);
  try {
    return await request;
  } finally {
    if (inFlight.get(key) === request) inFlight.delete(key);
  }
}

export function clearClientFeatureFlagCacheForTests() {
  flagCache.clear();
  inFlight.clear();
}

export function useFeatureFlag(flag: ClientFeatureFlagKey) {
  const { user } = useUserProfile();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["client-feature-flag", flag, userId] as const, [flag, userId]);
  const query = useQuery({
    queryKey,
    enabled: !!userId,
    staleTime: CLIENT_FEATURE_FLAG_TTL_MS,
    gcTime: CLIENT_FEATURE_FLAG_TTL_MS * 5,
    queryFn: () => fetchFeatureFlag(flag, userId!, false),
    placeholderData: false,
  });

  useEffect(() => {
    if (!userId || typeof document === "undefined") return undefined;
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      void fetchFeatureFlag(flag, userId, true).then((enabled) => {
        queryClient.setQueryData(queryKey, enabled);
      });
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [flag, queryClient, queryKey, userId]);

  return {
    enabled: query.data === true,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}
