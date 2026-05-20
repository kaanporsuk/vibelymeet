import { useCallback, useEffect, useMemo } from 'react';
import { AppState } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import {
  CLIENT_FEATURE_FLAG_FOREGROUND_REFRESH_MS,
  CLIENT_FEATURE_FLAG_TTL_MS,
  clientFeatureFlagQueryKey,
  clearClientFeatureFlagCache,
  clearClientFeatureFlagCacheForTests,
  fetchClientFeatureFlag,
  getCachedClientFeatureFlag,
  hydrateNativeClientFeatureFlagCache,
  shouldRefreshClientFeatureFlag,
  type ClientFeatureFlagEvaluation,
  type ClientFeatureFlagKey,
} from '@/lib/clientFeatureFlags';

export {
  CLIENT_FEATURE_FLAG_TTL_MS,
  clearClientFeatureFlagCache,
  clearClientFeatureFlagCacheForTests,
  CLIENT_FEATURE_FLAG_FOREGROUND_REFRESH_MS,
  type ClientFeatureFlagKey,
} from '@/lib/clientFeatureFlags';

export function useFeatureFlag(flag: ClientFeatureFlagKey) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => clientFeatureFlagQueryKey(flag, userId), [flag, userId]);
  const initialData = useMemo<ClientFeatureFlagEvaluation | undefined>(() => {
    if (!userId) return undefined;
    return getCachedClientFeatureFlag(flag, userId) ?? undefined;
  }, [flag, userId]);

  useEffect(() => {
    if (!userId) return;
    void hydrateNativeClientFeatureFlagCache().then(() => {
      const cached = getCachedClientFeatureFlag(flag, userId);
      if (cached) queryClient.setQueryData(queryKey, cached);
    });
  }, [flag, queryClient, queryKey, userId]);

  const query = useQuery({
    queryKey,
    enabled: !!userId,
    staleTime: CLIENT_FEATURE_FLAG_TTL_MS,
    gcTime: CLIENT_FEATURE_FLAG_TTL_MS * 5,
    queryFn: () => fetchClientFeatureFlag(flag, userId!, false),
    initialData,
    initialDataUpdatedAt: initialData?.fetchedAtMs,
  });

  const refreshFlag = useCallback(() => {
    if (!userId) return;
    void fetchClientFeatureFlag(flag, userId, true)
      .then((evaluation) => {
        queryClient.setQueryData(queryKey, evaluation);
      })
      .catch(() => undefined);
  }, [flag, queryClient, queryKey, userId]);

  useEffect(() => {
    if (!userId) return undefined;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      if (!shouldRefreshClientFeatureFlag(flag, userId)) return;
      refreshFlag();
    });
    return () => subscription.remove();
  }, [flag, refreshFlag, userId]);

  useEffect(() => {
    if (!userId) return undefined;
    const refreshIntervalId = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      refreshFlag();
    }, CLIENT_FEATURE_FLAG_FOREGROUND_REFRESH_MS);
    return () => clearInterval(refreshIntervalId);
  }, [refreshFlag, userId]);

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
