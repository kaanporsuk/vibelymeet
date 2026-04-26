import * as Location from 'expo-location';
import { supabase as defaultSupabase } from '@/lib/supabase';
import {
  readLocationPermissionSnapshot,
  requestLocationPermissionSnapshot,
} from '@/lib/useLocationPermission';

export type DeviceCoords = { lat: number; lng: number };

export type DeviceLocationCaptureResult =
  | { status: 'success'; coords: DeviceCoords }
  | { status: 'permission_denied'; canAskAgain: boolean | null }
  | { status: 'permission_error'; error: Error | null }
  | { status: 'services_disabled' }
  | { status: 'gps_failed'; error: Error | null };

export type ReverseGeocodeResult =
  | { status: 'success'; location: string; country: string; coords: DeviceCoords }
  | { status: 'geocode_failed'; error: Error | null };

export type SaveProfileLocationResult =
  | { status: 'success'; coords: DeviceCoords; location: string; country: string }
  | { status: 'permission_denied'; canAskAgain: boolean | null }
  | { status: 'permission_error'; error: Error | null }
  | { status: 'services_disabled' }
  | { status: 'gps_failed'; error: Error | null }
  | { status: 'geocode_failed'; error: Error | null }
  | { status: 'backend_failed'; error: Error | null; message?: string };

export type ClearSavedLocationResult =
  | { status: 'success' }
  | { status: 'backend_failed'; error: Error | null; message?: string };

type SupabaseClientLike = typeof defaultSupabase;

function toError(value: unknown, fallback: string): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string' && value.trim()) return new Error(value);
  return new Error(fallback);
}

function normalizeGeocodeResponse(data: unknown, fallbackCoords: DeviceCoords): ReverseGeocodeResult {
  if (!data || typeof data !== 'object') {
    return { status: 'geocode_failed', error: new Error('geocode_empty_response') };
  }

  const row = data as {
    error?: unknown;
    city?: unknown;
    country?: unknown;
    formatted?: unknown;
    lat?: unknown;
    lng?: unknown;
  };
  if (row.error) return { status: 'geocode_failed', error: toError(row.error, 'geocode_failed') };

  const city = typeof row.city === 'string' ? row.city.trim() : '';
  const country = typeof row.country === 'string' ? row.country.trim() : '';
  const formatted = typeof row.formatted === 'string' ? row.formatted.trim() : '';
  const location = city && country ? `${city}, ${country}` : formatted;
  if (!location || !country) {
    return { status: 'geocode_failed', error: new Error('geocode_missing_city_country') };
  }

  const lat = typeof row.lat === 'number' && Number.isFinite(row.lat) ? row.lat : fallbackCoords.lat;
  const lng = typeof row.lng === 'number' && Number.isFinite(row.lng) ? row.lng : fallbackCoords.lng;
  return { status: 'success', location, country, coords: { lat, lng } };
}

export async function captureCurrentDeviceLocation({
  requestPermission = false,
  accuracy = Location.Accuracy.Balanced,
}: {
  requestPermission?: boolean;
  accuracy?: Location.Accuracy;
} = {}): Promise<DeviceLocationCaptureResult> {
  const permission = requestPermission
    ? await requestLocationPermissionSnapshot()
    : await readLocationPermissionSnapshot();

  if (permission.status === 'unknown') {
    return { status: 'permission_error', error: permission.error };
  }

  if (permission.servicesEnabled === false) {
    return { status: 'services_disabled' };
  }

  if (permission.status !== Location.PermissionStatus.GRANTED) {
    return { status: 'permission_denied', canAskAgain: permission.canAskAgain };
  }

  try {
    const pos = await Location.getCurrentPositionAsync({ accuracy });
    return {
      status: 'success',
      coords: {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      },
    };
  } catch (e) {
    return { status: 'gps_failed', error: toError(e, 'gps_failed') };
  }
}

export async function reverseGeocodeDeviceLocation({
  client = defaultSupabase,
  coords,
}: {
  client?: SupabaseClientLike;
  coords: DeviceCoords;
}): Promise<ReverseGeocodeResult> {
  try {
    const { data, error } = await client.functions.invoke('geocode', {
      body: { lat: coords.lat, lng: coords.lng },
    });
    if (error) return { status: 'geocode_failed', error: toError(error, 'geocode_failed') };
    return normalizeGeocodeResponse(data, coords);
  } catch (e) {
    return { status: 'geocode_failed', error: toError(e, 'geocode_failed') };
  }
}

export async function saveCurrentDeviceLocationToProfile({
  client = defaultSupabase,
  userId,
  requestPermission = true,
  accuracy = Location.Accuracy.Balanced,
}: {
  client?: SupabaseClientLike;
  userId?: string | null;
  requestPermission?: boolean;
  accuracy?: Location.Accuracy;
} = {}): Promise<SaveProfileLocationResult> {
  const capture = await captureCurrentDeviceLocation({ requestPermission, accuracy });
  if (capture.status !== 'success') return capture;

  const geocode = await reverseGeocodeDeviceLocation({ client, coords: capture.coords });
  if (geocode.status !== 'success') return geocode;

  let effectiveUserId = userId ?? null;
  if (!effectiveUserId) {
    try {
      const { data, error } = await client.auth.getUser();
      if (error) return { status: 'backend_failed', error: toError(error, 'auth_user_fetch_failed') };
      effectiveUserId = data.user?.id ?? null;
    } catch (e) {
      return { status: 'backend_failed', error: toError(e, 'auth_user_fetch_failed') };
    }
  }

  if (!effectiveUserId) {
    return { status: 'backend_failed', error: new Error('missing_user_id'), message: 'missing_user_id' };
  }

  try {
    const { data, error } = await client.rpc('update_profile_location', {
      p_user_id: effectiveUserId,
      p_location: geocode.location,
      p_lat: geocode.coords.lat,
      p_lng: geocode.coords.lng,
      p_country: geocode.country,
    });
    if (error) return { status: 'backend_failed', error: toError(error, 'location_update_failed') };

    const result = data as { success?: boolean; error?: string } | null;
    if (!result?.success) {
      return {
        status: 'backend_failed',
        error: new Error(result?.error ?? 'location_update_failed'),
        message: result?.error,
      };
    }

    return {
      status: 'success',
      coords: geocode.coords,
      location: geocode.location,
      country: geocode.country,
    };
  } catch (e) {
    return { status: 'backend_failed', error: toError(e, 'location_update_failed') };
  }
}

export async function clearSavedLocationData({
  client = defaultSupabase,
}: {
  client?: SupabaseClientLike;
} = {}): Promise<ClearSavedLocationResult> {
  try {
    const { data, error } = await client.rpc('clear_my_location_data');
    if (error) return { status: 'backend_failed', error: toError(error, 'clear_location_failed') };
    const result = data as { success?: boolean; error?: string } | null;
    if (!result?.success) {
      return {
        status: 'backend_failed',
        error: new Error(result?.error ?? 'clear_location_failed'),
        message: result?.error,
      };
    }
    return { status: 'success' };
  } catch (e) {
    return { status: 'backend_failed', error: toError(e, 'clear_location_failed') };
  }
}
