/**
 * Other-city events summary for premium nudge — same RPC as web useOtherCityEvents.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { fetchMyLocationData } from '@/lib/myLocationData';

export type OtherCityEvent = {
  city: string;
  country: string | null;
  event_count: number;
  sample_cover: string | null;
};

export function useOtherCityEvents(viewerProfileId: string | null | undefined) {
  return useQuery({
    queryKey: ['other-city-events', viewerProfileId],
    queryFn: async (): Promise<OtherCityEvent[]> => {
      if (!viewerProfileId) return [];
      const profile = await fetchMyLocationData().catch(() => null);
      const locationData = profile?.location_data;
      const { data, error } = await supabase.rpc('get_other_city_events', {
        p_user_id: viewerProfileId,
        p_user_lat: locationData?.lat ?? undefined,
        p_user_lng: locationData?.lng ?? undefined,
      });
      if (error) throw error;
      return (data || []) as OtherCityEvent[];
    },
    enabled: !!viewerProfileId,
  });
}
