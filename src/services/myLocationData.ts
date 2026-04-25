import { supabase } from "@/integrations/supabase/client";

export type MyLocationData = {
  location_data: { lat: number; lng: number } | null;
  location: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
};

function normalizeLocationData(row: Record<string, unknown> | null | undefined): MyLocationData | null {
  if (!row) return null;
  const lat = typeof row.lat === "number" && Number.isFinite(row.lat) ? row.lat : null;
  const lng = typeof row.lng === "number" && Number.isFinite(row.lng) ? row.lng : null;
  const locationData = lat != null && lng != null ? { lat, lng } : null;

  return {
    location_data: locationData,
    location: typeof row.location === "string" ? row.location : null,
    country: typeof row.country === "string" ? row.country : null,
    lat,
    lng,
  };
}

export async function fetchMyLocationData(): Promise<MyLocationData | null> {
  const { data, error } = await supabase.rpc("get_my_location_data");
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return normalizeLocationData(row as Record<string, unknown> | null | undefined);
}
