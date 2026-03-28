import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import {
  mergeTierWithOverrides,
  type FlatCapabilities,
  type TierConfigOverride,
} from '@shared/tiers';

export { getUserBadge } from '@shared/tiers';

export function useEntitlements(): FlatCapabilities & { isLoading: boolean; refetch: () => Promise<void> } {
  const { user } = useAuth();
  const [tier, setTier] = useState<string>('free');
  const [overrides, setOverrides] = useState<TierConfigOverride[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    if (!user?.id) {
      setTier('free');
      setOverrides([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const [tierRes, overrideRes] = await Promise.all([
      supabase.from('profiles').select('subscription_tier').eq('id', user.id).maybeSingle(),
      supabase.from('tier_config_overrides').select('tier_id, capability_key, value'),
    ]);
    setTier(tierRes.data?.subscription_tier || 'free');
    if (overrideRes.error) {
      console.warn('[useEntitlements] tier_config_overrides:', overrideRes.error.message);
      setOverrides([]);
    } else {
      setOverrides((overrideRes.data || []) as TierConfigOverride[]);
    }
    setIsLoading(false);
  }, [user?.id]);

  useEffect(() => {
    void fetchAll();

    if (!user?.id) return;

    const profileChannel = supabase
      .channel(`entitlements-profile-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${user.id}`,
        },
        (payload) => {
          const newTier = (payload.new as { subscription_tier?: string })?.subscription_tier;
          if (newTier) setTier(newTier);
        }
      )
      .subscribe();

    const configChannel = supabase
      .channel('entitlements-config-native')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tier_config_overrides',
        },
        async () => {
          const { data } = await supabase
            .from('tier_config_overrides')
            .select('tier_id, capability_key, value');
          setOverrides((data || []) as TierConfigOverride[]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(profileChannel);
      supabase.removeChannel(configChannel);
    };
  }, [user?.id, fetchAll]);

  const capabilities = useMemo(() => mergeTierWithOverrides(tier, overrides), [tier, overrides]);
  return { ...capabilities, isLoading, refetch: fetchAll };
}
