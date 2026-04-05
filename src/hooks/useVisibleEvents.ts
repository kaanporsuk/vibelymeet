import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import type { SelectedCity } from "@/components/events/EventsFilterBar";

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
  is_waitlisted: boolean;
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

export type UseVisibleEventsOptions = {
  /** GPS from the device/browser — preferred for Nearby mode */
  deviceLat?: number | null;
  deviceLng?: number | null;
  locationMode?: "nearby" | "city";
  selectedCity?: SelectedCity | null;
  /** User list radius (km); applied server-side when a reference point exists */
  filterRadiusKm?: number | null;
};

/**
 * Fetches events via `get_visible_events` (visibility + scope + optional radius).
 * Premium browse coordinates are enforced server-side from subscriptions/admin — not from client flags.
 */
export const useVisibleEvents = (options?: UseVisibleEventsOptions) => {
  const { user } = useUserProfile();
  const o = options ?? {};

  return useQuery({
    queryKey: [
      "visible-events",
      user?.id,
      o.deviceLat ?? null,
      o.deviceLng ?? null,
      o.locationMode ?? "nearby",
      o.selectedCity?.lat ?? null,
      o.selectedCity?.lng ?? null,
      o.filterRadiusKm ?? null,
    ],
    queryFn: async (): Promise<VisibleEvent[]> => {
      const viewerProfileId = user?.id;
      if (!viewerProfileId) return [];

      const { data: profile } = await supabase
        .from("profiles")
        .select("location_data")
        .eq("id", viewerProfileId)
        .maybeSingle();

      const locationData = profile?.location_data as { lat?: number; lng?: number } | null;
      const profileLat = locationData?.lat ?? null;
      const profileLng = locationData?.lng ?? null;

      const p_user_lat = (o.deviceLat ?? profileLat) ?? undefined;
      const p_user_lng = (o.deviceLng ?? profileLng) ?? undefined;

      const mode = o.locationMode ?? "nearby";
      let p_browse_lat: number | null = null;
      let p_browse_lng: number | null = null;
      if (mode === "city" && o.selectedCity) {
        p_browse_lat = o.selectedCity.lat;
        p_browse_lng = o.selectedCity.lng;
      }

      const hasRefPoint =
        (mode === "city" && !!o.selectedCity) ||
        (mode === "nearby" && p_user_lat != null && p_user_lng != null);

      const fr =
        hasRefPoint && o.filterRadiusKm != null && o.filterRadiusKm > 0
          ? o.filterRadiusKm
          : null;

      const { data, error } = await supabase.rpc("get_visible_events", {
        p_user_id: viewerProfileId,
        p_user_lat: p_user_lat ?? null,
        p_user_lng: p_user_lng ?? null,
        p_is_premium: false,
        p_browse_lat,
        p_browse_lng,
        p_filter_radius_km: fr,
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
      const viewerProfileId = user?.id;
      if (!viewerProfileId) return [];

      const { data: profile } = await supabase
        .from("profiles")
        .select("location_data")
        .eq("id", viewerProfileId)
        .maybeSingle();

      const locationData = profile?.location_data as { lat?: number; lng?: number } | null;

      const { data, error } = await supabase.rpc("get_other_city_events", {
        p_user_id: viewerProfileId,
        p_user_lat: locationData?.lat ?? undefined,
        p_user_lng: locationData?.lng ?? undefined,
      });

      if (error) throw error;
      return (data || []) as OtherCityEvent[];
    },
    enabled: !!user?.id,
  });
};
