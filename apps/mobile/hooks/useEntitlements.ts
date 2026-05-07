import { useEntitlementsContext } from '@/context/EntitlementsContext';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { getFlatCapabilities, type FlatCapabilities } from '@shared/tiers';

export { getUserBadge } from '@shared/tiers';

export function useEntitlements() {
  return useEntitlementsContext();
}

export function useTierCapabilities(tierId: string | null | undefined) {
  const normalizedTier = tierId || 'free';

  return useQuery({
    queryKey: ['tier-capabilities', normalizedTier],
    staleTime: 60_000,
    queryFn: async (): Promise<FlatCapabilities> => {
      const { data, error } = await supabase.rpc('get_tier_capabilities', {
        p_tier_id: normalizedTier,
      });
      if (error) throw error;
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('Tier capabilities were not returned by the backend');
      }
      return data as unknown as FlatCapabilities;
    },
    placeholderData: getFlatCapabilities(normalizedTier),
  });
}
