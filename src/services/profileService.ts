import { supabase } from "@/integrations/supabase/client";
import {
  assertNoDirectProfileLocationWrites,
  normalizeRelationshipIntent,
} from "@shared/profileContracts";
import type { EventDiscoveryPrefs } from "@shared/eventDiscoveryContracts";
import { parseEventDiscoveryPrefs, serializeEventDiscoveryPrefs } from "@shared/eventDiscoveryContracts";
import { fetchMyProfileSettings } from "@/services/myProfileSettings";
import { parseMediaCaptions, type MediaCaptions } from "../../shared/media/captions";

// Frontend profile interface (camelCase)
export interface ProfileData {
  id: string;
  updatedAt: string | null;
  name: string;
  birthDate: Date | null;
  age: number | null;
  zodiac: string | null;
  gender: string;
  interestedIn: string[];
  tagline: string | null;
  heightCm: number | null;
  location: string | null;
  locationData: { lat: number; lng: number } | null;
  job: string | null;
  company: string | null;
  aboutMe: string | null;
  /** @deprecated Use relationshipIntent instead */
  lookingFor: string | null;
  relationshipIntent: string | null;
  vibes: string[];
  lifestyle: Record<string, string>;
  prompts: { question: string; answer: string }[];
  photos: string[];
  avatarUrl: string | null;
  
  bunnyVideoUid: string | null;
  bunnyVideoStatus: string;
  vibeVideoPlaybackRef: string | null;
  vibeCaption: string;
  vibeVideoCaptions: MediaCaptions | null;
  photoVerified: boolean;
  phoneVerified: boolean;
  stats: {
    events: number;
    matches: number;
    conversations: number;
  };
  /** Server-computed profile completeness (0–100). Read-only from DB. */
  vibeScore: number;
  vibeScoreLabel: string;
  onboardingComplete?: boolean;
  preferredAgeMin: number | null;
  preferredAgeMax: number | null;
  eventDiscoveryPrefs: EventDiscoveryPrefs;
}

export const MY_PROFILE_STALE_TIME_MS = 5 * 60_000;
export const PROFILE_LIVE_COUNTS_STALE_TIME_MS = 30_000;

export const myProfileQueryKey = (userId: string) => ["my-profile", userId] as const;
export const profileLiveCountsQueryKey = (userId: string) => ["profile-live-counts", userId] as const;

type BackendOwnedProfileUpdateFields =
  | "location"
  | "locationData"
  | "bunnyVideoUid"
  | "bunnyVideoStatus"
  | "vibeVideoPlaybackRef"
  | "vibeScore"
  | "vibeScoreLabel"
  | "stats"
  | "photoVerified"
  | "phoneVerified";

/** Fields excluded from generic profile table writes are backend-owned or RPC-owned. */
export type ProfileUpdatePayload = Omit<Partial<ProfileData>, BackendOwnedProfileUpdateFields | "vibeCaption"> & {
  vibeCaption?: string | null;
};

// Database profile interface (snake_case)
interface DbProfile {
  id: string;
  updated_at?: string | null;
  name: string;
  birth_date: string | null;
  age: number;
  gender: string;
  interested_in: string[] | null;
  tagline: string | null;
  height_cm: number | null;
  location: string | null;
  location_data?: { lat: number; lng: number } | null;
  job: string | null;
  company: string | null;
  about_me: string | null;
  /** @deprecated Use relationship_intent instead */
  looking_for: string | null;
  relationship_intent: string | null;
  onboarding_complete?: boolean | null;
  lifestyle: Record<string, string> | null;
  prompts: { question: string; answer: string }[] | null;
  photos: string[] | null;
  avatar_url: string | null;
  
  bunny_video_uid: string | null;
  bunny_video_status: string;
  vibe_video_playback_ref?: string | null;
  vibe_caption?: string | null;
  vibe_video_captions?: unknown;
  photo_verified: boolean | null;
  phone_verified: boolean | null;
  events_attended?: number | null;
  total_matches: number | null;
  total_conversations: number | null;
  vibe_score?: number | null;
  vibe_score_label?: string | null;
  preferred_age_min?: number | null;
  preferred_age_max?: number | null;
  event_discovery_prefs?: unknown;
}

// Zodiac sign calculation from birth date
export const getZodiacSign = (birthDate: Date): string => {
  const month = birthDate.getMonth() + 1;
  const day = birthDate.getDate();

  if ((month === 3 && day >= 21) || (month === 4 && day <= 19)) return "Aries";
  if ((month === 4 && day >= 20) || (month === 5 && day <= 20)) return "Taurus";
  if ((month === 5 && day >= 21) || (month === 6 && day <= 20)) return "Gemini";
  if ((month === 6 && day >= 21) || (month === 7 && day <= 22)) return "Cancer";
  if ((month === 7 && day >= 23) || (month === 8 && day <= 22)) return "Leo";
  if ((month === 8 && day >= 23) || (month === 9 && day <= 22)) return "Virgo";
  if ((month === 9 && day >= 23) || (month === 10 && day <= 22)) return "Libra";
  if ((month === 10 && day >= 23) || (month === 11 && day <= 21)) return "Scorpio";
  if ((month === 11 && day >= 22) || (month === 12 && day <= 21)) return "Sagittarius";
  if ((month === 12 && day >= 22) || (month === 1 && day <= 19)) return "Capricorn";
  if ((month === 1 && day >= 20) || (month === 2 && day <= 18)) return "Aquarius";
  return "Pisces";
};

export const getZodiacEmoji = (sign: string): string => {
  const emojis: Record<string, string> = {
    Aries: "♈",
    Taurus: "♉",
    Gemini: "♊",
    Cancer: "♋",
    Leo: "♌",
    Virgo: "♍",
    Libra: "♎",
    Scorpio: "♏",
    Sagittarius: "♐",
    Capricorn: "♑",
    Aquarius: "♒",
    Pisces: "♓",
  };
  return emojis[sign] || "⭐";
};

// Calculate age from birth date
export const calculateAge = (birthDate: Date): number => {
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
};

// Convert DB profile to frontend format
export const dbToProfile = (dbProfile: DbProfile, vibes: string[] = []): ProfileData => {
  const birthDate = dbProfile.birth_date ? new Date(dbProfile.birth_date) : null;
  const age = birthDate ? calculateAge(birthDate) : dbProfile.age;
  const zodiac = birthDate ? getZodiacSign(birthDate) : null;

  return {
    id: dbProfile.id,
    updatedAt: dbProfile.updated_at ?? null,
    name: dbProfile.name,
    birthDate,
    age,
    zodiac,
    gender: dbProfile.gender,
    interestedIn: dbProfile.interested_in || [],
    tagline: dbProfile.tagline,
    heightCm: dbProfile.height_cm,
    location: dbProfile.location,
    locationData: dbProfile.location_data as { lat: number; lng: number } | null,
    job: dbProfile.job,
    company: dbProfile.company,
    aboutMe: dbProfile.about_me,
    lookingFor: dbProfile.relationship_intent ?? dbProfile.looking_for,
    relationshipIntent: dbProfile.relationship_intent ?? dbProfile.looking_for ?? null,
    vibes,
    lifestyle: (dbProfile.lifestyle as Record<string, string>) || {},
    prompts: (dbProfile.prompts as { question: string; answer: string }[]) || [],
    photos: dbProfile.photos || [],
    avatarUrl: dbProfile.avatar_url,
    
    bunnyVideoUid: dbProfile.bunny_video_uid || null,
    bunnyVideoStatus: dbProfile.bunny_video_status || "none",
    vibeVideoPlaybackRef:
      typeof dbProfile.vibe_video_playback_ref === "string" && dbProfile.vibe_video_playback_ref.trim().length > 0
        ? dbProfile.vibe_video_playback_ref.trim()
        : null,
    vibeCaption: dbProfile.vibe_caption || "",
    vibeVideoCaptions: parseMediaCaptions(dbProfile.vibe_video_captions),
    photoVerified: dbProfile.photo_verified || false,
    phoneVerified: dbProfile.phone_verified || false,
    stats: {
      events: dbProfile.events_attended || 0,
      matches: dbProfile.total_matches || 0,
      conversations: dbProfile.total_conversations || 0,
    },
    vibeScore: dbProfile.vibe_score ?? 0,
    vibeScoreLabel: dbProfile.vibe_score_label ?? "New",
    onboardingComplete: dbProfile.onboarding_complete ?? undefined,
    preferredAgeMin: dbProfile.preferred_age_min ?? null,
    preferredAgeMax: dbProfile.preferred_age_max ?? null,
    eventDiscoveryPrefs: parseEventDiscoveryPrefs(dbProfile.event_discovery_prefs),
  };
};

// Convert frontend profile to DB format (does not map location fields — use `update_profile_location` RPC).
export const profileToDb = (profile: ProfileUpdatePayload): Record<string, unknown> => {
  const dbData: Record<string, unknown> = {};

  if (profile.name !== undefined) dbData.name = profile.name;
  if (profile.birthDate !== undefined) {
    dbData.birth_date = profile.birthDate?.toISOString().split("T")[0] || null;
    // Also update age for backwards compatibility
    if (profile.birthDate) {
      dbData.age = calculateAge(profile.birthDate);
    }
  }
  if (profile.gender !== undefined) dbData.gender = profile.gender;
  if (profile.interestedIn !== undefined) dbData.interested_in = profile.interestedIn;
  if (profile.tagline !== undefined) dbData.tagline = profile.tagline;
  if (profile.heightCm !== undefined) dbData.height_cm = profile.heightCm;
  if (profile.job !== undefined) dbData.job = profile.job;
  if (profile.company !== undefined) dbData.company = profile.company;
  if (profile.aboutMe !== undefined) dbData.about_me = profile.aboutMe;
  if (profile.lookingFor !== undefined || profile.relationshipIntent !== undefined) {
    const rawIntent = profile.relationshipIntent ?? profile.lookingFor ?? null;
    const normalizedIntent =
      typeof rawIntent === "string" && rawIntent.trim().length > 0
        ? normalizeRelationshipIntent(rawIntent)
        : null;

    dbData.looking_for = normalizedIntent;
    dbData.relationship_intent = normalizedIntent;
  }
  if (profile.lifestyle !== undefined) dbData.lifestyle = profile.lifestyle;
  if (profile.prompts !== undefined) dbData.prompts = profile.prompts;
  if (profile.photos !== undefined) dbData.photos = profile.photos;
  if (profile.avatarUrl !== undefined) dbData.avatar_url = profile.avatarUrl;
  
  if (profile.vibeCaption !== undefined) dbData.vibe_caption = profile.vibeCaption;
  if (profile.preferredAgeMin !== undefined) dbData.preferred_age_min = profile.preferredAgeMin;
  if (profile.preferredAgeMax !== undefined) dbData.preferred_age_max = profile.preferredAgeMax;
  if (profile.eventDiscoveryPrefs !== undefined) {
    dbData.event_discovery_prefs = serializeEventDiscoveryPrefs(profile.eventDiscoveryPrefs);
  }

  return dbData;
};

export const fetchProfileLiveCounts = async (userId: string): Promise<ProfileData["stats"]> => {
  const [eventsCountResult, matchesCountResult, convosCountResult] = await Promise.all([
    supabase.from("event_registrations").select("id", { count: "exact", head: true }).eq("profile_id", userId),
    supabase.from("matches").select("id", { count: "exact", head: true }).or(`profile_id_1.eq.${userId},profile_id_2.eq.${userId}`),
    supabase.from("matches").select("id", { count: "exact", head: true }).or(`profile_id_1.eq.${userId},profile_id_2.eq.${userId}`).not("last_message_at", "is", null),
  ]);

  const countError = eventsCountResult.error ?? matchesCountResult.error ?? convosCountResult.error;
  if (countError) throw countError;

  return {
    events: eventsCountResult.count ?? 0,
    matches: matchesCountResult.count ?? 0,
    conversations: convosCountResult.count ?? 0,
  };
};

// Fetch current user's profile using the already-known auth user id.
// Keep exact coordinates and live counts out of this hot read; callers fetch those separately.
export const fetchMyProfile = async (userId: string): Promise<ProfileData | null> => {
  if (!userId) return null;

  const [profileRow, vibesResult] = await Promise.all([
    fetchMyProfileSettings(),
    supabase.from("profile_vibes").select("vibe_tags(label)").eq("profile_id", userId),
  ]);
  if (!profileRow) return null;
  if (profileRow.id !== userId) return null;

  type VibeRow = { vibe_tags: { label: string } | { label: string }[] | null };
  const vibes =
    (vibesResult.data as VibeRow[] | null)?.map((v) => {
      const vt = v.vibe_tags;
      if (!vt) return undefined;
      if (Array.isArray(vt)) {
        return vt[0]?.label as string | undefined;
      }
      return (vt as { label: string }).label;
    }).filter(Boolean) as string[] || [];

  const profileData = dbToProfile(
    {
      ...(profileRow as unknown as DbProfile),
      location_data: null,
    },
    vibes,
  );

  // Photos are now resolved via getImageUrl() at render time — no signed URL refresh needed

  return profileData;
};

// Update current user's profile
export const updateMyProfile = async (updates: ProfileUpdatePayload): Promise<void> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  assertNoDirectProfileLocationWrites(updates as Record<string, unknown>);
  const dbUpdates = profileToDb(updates);
  
  if (Object.keys(dbUpdates).length > 0) {
    const { error } = await supabase
      .from("profiles")
      .update(dbUpdates)
      .eq("id", user.id);

    if (error) throw error;
  }

  // Handle vibes separately - need to sync with profile_vibes table
  if (updates.vibes !== undefined) {
    await syncProfileVibes(user.id, updates.vibes);
  }
};

// Sync vibes with the profile_vibes junction table
export const syncProfileVibes = async (profileId: string, vibeLabels: string[]): Promise<void> => {
  // First, delete all existing vibes for this profile
  const { error: deleteError } = await supabase
    .from("profile_vibes")
    .delete()
    .eq("profile_id", profileId);

  if (deleteError) throw deleteError;

  if (vibeLabels.length === 0) return;

  // Get vibe tag IDs for the labels
  const { data: vibeTags, error: fetchError } = await supabase
    .from("vibe_tags")
    .select("id, label")
    .in("label", vibeLabels);

  if (fetchError) throw fetchError;
  if (!vibeTags || vibeTags.length === 0) return;

  // Insert new vibes
  const vibeInserts = vibeTags.map((tag) => ({
    profile_id: profileId,
    vibe_tag_id: tag.id,
  }));

  const { error: insertError } = await supabase
    .from("profile_vibes")
    .insert(vibeInserts);

  if (insertError) throw insertError;
};

// Create a new profile during onboarding
export const createProfile = async (profileData: ProfileUpdatePayload): Promise<void> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  assertNoDirectProfileLocationWrites(profileData as Record<string, unknown>);
  // Server-side age validation as safety net
  if (profileData.birthDate) {
    const age = calculateAge(profileData.birthDate);
    if (age < 18) {
      throw new Error("Must be 18 or older to create an account");
    }
  }

  const dbData = profileToDb(profileData);
  
  // Add required fields
  const insertData = {
    id: user.id,
    name: profileData.name || "",
    gender: profileData.gender || "",
    age: profileData.birthDate ? calculateAge(profileData.birthDate) : 18,
    ...dbData,
  };

  const { error } = await supabase
    .from("profiles")
    .upsert(insertData);

  if (error) throw error;

  // Handle vibes
  if (profileData.vibes && profileData.vibes.length > 0) {
    await syncProfileVibes(user.id, profileData.vibes);
  }
};

// Location auto-detect utilities
export interface GeoLocation {
  lat: number;
  lng: number;
  country: string;
  formatted: string;
}

export const detectLocation = (): Promise<GeolocationPosition> => {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported by your browser"));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 300000, // 5 minutes cache
    });
  });
};

export const reverseGeocode = async (lat: number, lng: number): Promise<GeoLocation> => {
  // Validate latitude and longitude are finite numbers
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('Latitude and longitude must be finite numbers.');
  }

  // Validate latitude bounds (-90 to 90)
  if (lat < -90 || lat > 90) {
    throw new Error(`Invalid latitude: ${lat}. Must be between -90 and 90.`);
  }

  // Validate longitude bounds (-180 to 180)
  if (lng < -180 || lng > 180) {
    throw new Error(`Invalid longitude: ${lng}. Must be between -180 and 180.`);
  }

  try {
    // Use our edge function to proxy the geocoding request (avoids CORS)
    const { data, error } = await supabase.functions.invoke('geocode', {
      body: { lat, lng },
    });

    if (error) {
      console.error("Geocode edge function error:", error);
      throw error;
    }

    if (data.error) {
      console.warn("Geocoding service issue:", data.error);
      // Use fallback if provided
      if (data.fallback) {
        return data.fallback;
      }
    }
    
    return {
      lat: data.lat,
      lng: data.lng,
      country: data.country || "Unknown",
      formatted: data.formatted || `${data.city}, ${data.country}`,
    };
  } catch (error) {
    console.error("Reverse geocoding error:", error);
    // Return a fallback for network errors
    return {
      lat,
      lng,
      country: "Unknown",
      formatted: "Location detected",
    };
  }
};

export const autoDetectLocation = async (): Promise<GeoLocation> => {
  const position = await detectLocation();
  const { latitude: lat, longitude: lng } = position.coords;
  return reverseGeocode(lat, lng);
};
