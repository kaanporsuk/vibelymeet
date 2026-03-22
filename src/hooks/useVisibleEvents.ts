import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";

export interface VisibleEvent {
  id: string;
  title: string;
  description: string | null;
  cover_image: string;
  event_date: string;
  duration_minutes: number;
  max_attendees: number;
  current_attendees: number;
  tags: string[];
  status: string;
  city: string | null;
  country: string | null;
  scope: string;
  latitude: number | null;
  longitude: number | null;
  radius_km: number | null;
  distance_km: number | null;
  is_registered: boolean;
  computed_status: string;
  is_recurring: boolean;
  parent_event_id: string | null;
  occurrence_number: number | null;
  language?: string | null;
}

export interface OtherCityEvent {
  city: string;
  country: string | null;
  event_count: number;
  sample_cover: string | null;
}

export const useVisibleEvents = () => {
  const { user } = useUserProfile();

  return useQuery({
    queryKey: ["visible-events", user?.id],
    queryFn: async (): Promise<VisibleEvent[]> => {
      if (!user?.id) return [];

      const { data: profile } = await supabase
        .from("profiles")
        .select("location_data")
        .eq("id", user.id)
        .maybeSingle();

      const locationData = profile?.location_data as { lat?: number; lng?: number } | null;

      const { data, error } = await supabase.rpc("get_visible_events", {
        p_user_id: user.id,
        p_user_lat: locationData?.lat ?? undefined,
        p_user_lng: locationData?.lng ?? undefined,
        p_is_premium: false,
        p_browse_lat: null,
        p_browse_lng: null,
      });

      if (error) throw error;
      return (data || []) as VisibleEvent[];
    },
    enabled: !!user?.id,
  });
};

export const useOtherCityEvents = () => {
  const { user } = useUserProfile();

  return useQuery({
    queryKey: ["other-city-events", user?.id],
    queryFn: async (): Promise<OtherCityEvent[]> => {
      if (!user?.id) return [];

      const { data: profile } = await supabase
        .from("profiles")
        .select("location_data")
        .eq("id", user.id)
        .maybeSingle();

      const locationData = profile?.location_data as { lat?: number; lng?: number } | null;

      const { data, error } = await supabase.rpc("get_other_city_events", {
        p_user_id: user.id,
        p_user_lat: locationData?.lat ?? undefined,
        p_user_lng: locationData?.lng ?? undefined,
      });

      if (error) throw error;
      return (data || []) as OtherCityEvent[];
    },
    enabled: !!user?.id,
  });
};
