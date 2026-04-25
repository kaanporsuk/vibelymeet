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

function isMissingLocationRpcError(error: unknown): boolean {
  const err = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  const code = typeof err?.code === "string" ? err.code : "";
  const text = [err?.message, err?.details, err?.hint]
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .toLowerCase();

  return (
    code === "PGRST202" ||
    code === "42883" ||
    text.includes("schema cache") ||
    text.includes("could not find the function") ||
    (text.includes("get_my_location_data") && text.includes("does not exist"))
  );
}

async function fetchMyLocationDataFallback(): Promise<MyLocationData | null> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!user?.id) return null;

  // TODO(distance-visibility-stage-2): remove this self-only compatibility path
  // when profiles.location_data is revoked in the Stage 2 enforcement migration.
  const { data, error } = await supabase
    .from("profiles")
    .select("location_data, location, country")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw error;
  return normalizeLocationData(data as Record<string, unknown> | null | undefined);
}

export async function fetchMyLocationData(): Promise<MyLocationData | null> {
  const { data, error } = await supabase.rpc("get_my_location_data");
  if (error) {
    if (isMissingLocationRpcError(error)) return fetchMyLocationDataFallback();
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return normalizeLocationData(row as Record<string, unknown> | null | undefined);
}
