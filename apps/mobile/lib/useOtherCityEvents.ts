/**
 * Other-city events summary for premium nudge — same RPC as web useOtherCityEvents.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

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
      const { data: profile } = await supabase
        .from('profiles')
        .select('location_data')
        .eq('id', viewerProfileId)
        .maybeSingle();
      const locationData = profile?.location_data as { lat?: number; lng?: number } | null;
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
