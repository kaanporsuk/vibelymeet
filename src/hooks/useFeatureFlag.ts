import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useUserProfile } from "@/contexts/AuthContext";
import {
  CLIENT_FEATURE_FLAG_TTL_MS,
  clientFeatureFlagQueryKey,
  clearClientFeatureFlagCache,
  clearClientFeatureFlagCacheForTests,
  fetchClientFeatureFlag,
  getCachedClientFeatureFlag,
  hydrateWebClientFeatureFlagCache,
  shouldRefreshClientFeatureFlag,
  type ClientFeatureFlagEvaluation,
  type ClientFeatureFlagKey,
} from "@/lib/clientFeatureFlags";

export {
  CLIENT_FEATURE_FLAG_TTL_MS,
  clearClientFeatureFlagCache,
  clearClientFeatureFlagCacheForTests,
  type ClientFeatureFlagKey,
} from "@/lib/clientFeatureFlags";

export function useFeatureFlag(flag: ClientFeatureFlagKey) {
  const { user } = useUserProfile();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => clientFeatureFlagQueryKey(flag, userId), [flag, userId]);
  const initialData = useMemo<ClientFeatureFlagEvaluation | undefined>(() => {
    if (!userId) return undefined;
    hydrateWebClientFeatureFlagCache();
    return getCachedClientFeatureFlag(flag, userId) ?? undefined;
  }, [flag, userId]);

  const query = useQuery({
    queryKey,
    enabled: !!userId,
    staleTime: CLIENT_FEATURE_FLAG_TTL_MS,
    gcTime: CLIENT_FEATURE_FLAG_TTL_MS * 5,
    queryFn: () => fetchClientFeatureFlag(flag, userId!, false),
    initialData,
    initialDataUpdatedAt: initialData?.fetchedAtMs,
  });

  useEffect(() => {
    if (!userId || typeof document === "undefined") return undefined;
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (!shouldRefreshClientFeatureFlag(flag, userId)) return;
      void fetchClientFeatureFlag(flag, userId, true).then((evaluation) => {
        queryClient.setQueryData(queryKey, evaluation);
      });
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [flag, queryClient, queryKey, userId]);

  return {
    enabled: query.data?.enabled === true,
    source: query.data?.source,
    bucket: query.data?.bucket ?? null,
    rolloutBps: query.data?.rolloutBps ?? null,
    userIdBucket: query.data?.userIdBucket ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}
