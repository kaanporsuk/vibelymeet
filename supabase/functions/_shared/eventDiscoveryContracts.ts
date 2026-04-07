/**
 * Persisted event discovery UI defaults (`profiles.event_discovery_prefs`) + validation helpers.
 * Premium city browse is still enforced only in `get_visible_events` — this JSON is never trusted server-side for entitlements.
 */

export const INTERESTED_IN_DECK_VALUES = ["men", "women", "everyone"] as const;
export type InterestedInDeckValue = (typeof INTERESTED_IN_DECK_VALUES)[number];

export type EventDiscoverySelectedCity = {
  name: string;
  country: string;
  lat: number;
  lng: number;
  region?: string | null;
};

export type EventDiscoveryPrefs = {
  locationMode: "nearby" | "city";
  distanceKm: number;
  selectedCity: EventDiscoverySelectedCity | null;
};

export const DEFAULT_EVENT_DISCOVERY_PREFS: EventDiscoveryPrefs = {
  locationMode: "nearby",
  distanceKm: 50,
  selectedCity: null,
};

const DISTANCE_PRESETS = [10, 25, 50, 100] as const;

export function clampDiscoveryDistanceKm(km: unknown): number {
  const n = typeof km === "number" && Number.isFinite(km) ? Math.round(km) : DEFAULT_EVENT_DISCOVERY_PREFS.distanceKm;
  return Math.min(100, Math.max(10, n));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseEventDiscoveryPrefs(raw: unknown): EventDiscoveryPrefs {
  if (!isRecord(raw)) return { ...DEFAULT_EVENT_DISCOVERY_PREFS };

  const mode = raw.locationMode === "city" ? "city" : "nearby";
  const distanceKm = clampDiscoveryDistanceKm(raw.distanceKm);

  let selectedCity: EventDiscoverySelectedCity | null = null;
  const sc = raw.selectedCity;
  if (isRecord(sc)) {
    const name = typeof sc.name === "string" ? sc.name.trim() : "";
    const country = typeof sc.country === "string" ? sc.country.trim() : "";
    const lat = typeof sc.lat === "number" && Number.isFinite(sc.lat) ? sc.lat : NaN;
    const lng = typeof sc.lng === "number" && Number.isFinite(sc.lng) ? sc.lng : NaN;
    const region = typeof sc.region === "string" ? sc.region : null;
    if (name && country && Number.isFinite(lat) && Number.isFinite(lng)) {
      selectedCity = { name, country, lat, lng, region };
    }
  }

  return {
    locationMode: mode,
    distanceKm,
    selectedCity,
  };
}

export function serializeEventDiscoveryPrefs(prefs: EventDiscoveryPrefs): Record<string, unknown> {
  return {
    locationMode: prefs.locationMode,
    distanceKm: clampDiscoveryDistanceKm(prefs.distanceKm),
    selectedCity: prefs.selectedCity
      ? {
          name: prefs.selectedCity.name,
          country: prefs.selectedCity.country,
          lat: prefs.selectedCity.lat,
          lng: prefs.selectedCity.lng,
          region: prefs.selectedCity.region ?? null,
        }
      : null,
  };
}

export function isInterestedInDeckValue(v: string): v is InterestedInDeckValue {
  return (INTERESTED_IN_DECK_VALUES as readonly string[]).includes(v);
}

/** Single-select deck value stored as `profiles.interested_in` one-element array (onboarding parity). */
export function normalizeInterestedInForProfile(selected: string): InterestedInDeckValue[] {
  const t = selected.trim().toLowerCase();
  if (t === "men" || t === "women" || t === "everyone") return [t];
  return ["everyone"];
}

export function firstInterestedInFromProfile(arr: string[] | null | undefined): InterestedInDeckValue {
  const v = arr?.[0]?.trim().toLowerCase();
  if (v === "men" || v === "women" || v === "everyone") return v;
  return "everyone";
}

const AGE_MIN_ALLOWED = 18;
const AGE_MAX_ALLOWED = 99;

export function clampAgePreference(n: unknown): number | null {
  if (n === null || n === undefined || n === "") return null;
  const x = typeof n === "number" ? n : typeof n === "string" ? parseInt(n, 10) : NaN;
  if (!Number.isFinite(x)) return null;
  const r = Math.round(x);
  if (r < AGE_MIN_ALLOWED || r > AGE_MAX_ALLOWED) return null;
  return r;
}

export function validateAgePreferencePair(min: number | null, max: number | null): { min: number | null; max: number | null } {
  let a = min;
  let b = max;
  if (a != null && b != null && a > b) {
    const t = a;
    a = b;
    b = t;
  }
  return { min: a, max: b };
}

export { DISTANCE_PRESETS };
