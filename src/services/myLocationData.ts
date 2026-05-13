import { supabase } from "@/integrations/supabase/client";

export type MyLocationData = {
  location_data: { lat: number; lng: number } | null;
  location: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
};

const MY_LOCATION_CACHE_TTL_MS = 60_000;
let cachedLocationData: { value: MyLocationData | null; expiresAtMs: number } | null = null;
let locationDataInFlight: Promise<MyLocationData | null> | null = null;
let locationDataCacheVersion = 0;

export function clearMyLocationDataCache(): void {
  locationDataCacheVersion += 1;
  cachedLocationData = null;
  locationDataInFlight = null;
}

function normalizeLocationData(row: Record<string, unknown> | null | undefined): MyLocationData | null {
  if (!row) return null;
  const rawLocationData =
    row.location_data && typeof row.location_data === "object" && !Array.isArray(row.location_data)
      ? (row.location_data as { lat?: unknown; lng?: unknown })
      : null;
  const lat = readFiniteCoord(row.lat) ?? readFiniteCoord(rawLocationData?.lat);
  const lng = readFiniteCoord(row.lng) ?? readFiniteCoord(rawLocationData?.lng);
  const locationData = lat != null && lng != null ? { lat, lng } : null;

  return {
    location_data: locationData,
    location: typeof row.location === "string" ? row.location : null,
    country: typeof row.country === "string" ? row.country : null,
    lat,
    lng,
  };
}

function readFiniteCoord(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?[0-9]+(\.[0-9]+)?$/.test(value.trim())) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export async function fetchMyLocationData(): Promise<MyLocationData | null> {
  const now = Date.now();
  if (cachedLocationData && cachedLocationData.expiresAtMs > now) {
    return cachedLocationData.value;
  }
  if (locationDataInFlight) return locationDataInFlight;

  const cacheVersion = locationDataCacheVersion;
  const request = Promise.resolve(supabase.rpc("get_my_location_data"))
    .then(({ data, error }) => {
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      const value = normalizeLocationData(row as Record<string, unknown> | null | undefined);
      if (cacheVersion === locationDataCacheVersion) {
        cachedLocationData = {
          value,
          expiresAtMs: Date.now() + MY_LOCATION_CACHE_TTL_MS,
        };
      }
      return value;
    })
    .finally(() => {
      if (locationDataInFlight === request) locationDataInFlight = null;
    });

  locationDataInFlight = request;
  return locationDataInFlight;
}
