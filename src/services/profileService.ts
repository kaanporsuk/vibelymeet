import { supabase } from "@/integrations/supabase/client";

export type OnboardingStage =
  | "none"
  | "auth_complete"
  | "identity"
  | "details"
  | "media"
  | "complete";

// Frontend profile interface (camelCase)
export interface ProfileData {
  id: string;
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
  vibeCaption: string;
  vibeVideoStatus: string | null;
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
  onboardingStage?: OnboardingStage;
}

// Database profile interface (snake_case)
interface DbProfile {
  id: string;
  name: string;
  birth_date: string | null;
  age: number;
  gender: string;
  interested_in: string[] | null;
  tagline: string | null;
  height_cm: number | null;
  location: string | null;
  location_data: { lat: number; lng: number } | null;
  job: string | null;
  company: string | null;
  about_me: string | null;
  /** @deprecated Use relationship_intent instead */
  looking_for: string | null;
  relationship_intent: string | null;
  onboarding_complete?: boolean | null;
  onboarding_stage?: string | null;
  lifestyle: Record<string, string> | null;
  prompts: { question: string; answer: string }[] | null;
  photos: string[] | null;
  avatar_url: string | null;
  
  bunny_video_uid: string | null;
  bunny_video_status: string;
  photo_verified: boolean | null;
  phone_verified: boolean | null;
  events_attended: number | null;
  total_matches: number | null;
  total_conversations: number | null;
  vibe_score?: number | null;
  vibe_score_label?: string | null;
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
    
    bunnyVideoUid: (dbProfile as any).bunny_video_uid || null,
    bunnyVideoStatus: (dbProfile as any).bunny_video_status || "none",
    vibeCaption: (dbProfile as any).vibe_caption || "",
    vibeVideoStatus: (dbProfile as any).vibe_video_status || null,
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
    onboardingStage: (dbProfile.onboarding_stage as OnboardingStage | null | undefined) ?? undefined,
  };
};

// Convert frontend profile to DB format
export const profileToDb = (profile: Partial<ProfileData>): Record<string, unknown> => {
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
  if (profile.location !== undefined) dbData.location = profile.location;
  if (profile.locationData !== undefined) dbData.location_data = profile.locationData;
  if (profile.job !== undefined) dbData.job = profile.job;
  if (profile.company !== undefined) dbData.company = profile.company;
  if (profile.aboutMe !== undefined) dbData.about_me = profile.aboutMe;
  if (profile.lookingFor !== undefined || profile.relationshipIntent !== undefined) {
    const intent = profile.relationshipIntent ?? profile.lookingFor ?? null;
    dbData.looking_for = intent;
    dbData.relationship_intent = intent;
  }
  if (profile.lifestyle !== undefined) dbData.lifestyle = profile.lifestyle;
  if (profile.prompts !== undefined) dbData.prompts = profile.prompts;
  if (profile.photos !== undefined) dbData.photos = profile.photos;
  if (profile.avatarUrl !== undefined) dbData.avatar_url = profile.avatarUrl;
  
  if (profile.vibeCaption !== undefined) dbData.vibe_caption = profile.vibeCaption;
  if (profile.vibeVideoStatus !== undefined) dbData.vibe_video_status = profile.vibeVideoStatus;

  return dbData;
};

// Fetch current user's profile
export const fetchMyProfile = async (): Promise<ProfileData | null> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [profileResult, vibesResult, eventsCountResult, matchesCountResult, convosCountResult] = await Promise.all([
    supabase.from("profiles").select("id, name, birth_date, age, gender, interested_in, tagline, height_cm, location, location_data, job, company, about_me, looking_for, relationship_intent, onboarding_complete, onboarding_stage, lifestyle, prompts, photos, avatar_url, bunny_video_uid, bunny_video_status, vibe_caption, vibe_video_status, photo_verified, phone_verified, events_attended, total_matches, total_conversations, is_premium, premium_until, vibe_score, vibe_score_label").eq("id", user.id).maybeSingle(),
    supabase.from("profile_vibes").select("vibe_tags(label)").eq("profile_id", user.id),
    supabase.from("event_registrations").select("*", { count: "exact", head: true }).eq("profile_id", user.id),
    supabase.from("matches").select("*", { count: "exact", head: true }).or(`profile_id_1.eq.${user.id},profile_id_2.eq.${user.id}`),
    supabase.from("matches").select("*", { count: "exact", head: true }).or(`profile_id_1.eq.${user.id},profile_id_2.eq.${user.id}`).not("last_message_at", "is", null),
  ]);

  if (profileResult.error) throw profileResult.error;
  if (!profileResult.data) return null;

  type VibeRow = { vibe_tags: any };
  const vibes =
    (vibesResult.data as VibeRow[] | null)?.map((v) => {
      const vt = v.vibe_tags;
      if (!vt) return undefined;
      if (Array.isArray(vt)) {
        return vt[0]?.label as string | undefined;
      }
      return (vt as { label: string }).label;
    }).filter(Boolean) as string[] || [];

  const profileData = dbToProfile(profileResult.data as unknown as DbProfile, vibes);

  // Override static counters with real counts
  profileData.stats = {
    events: eventsCountResult.count ?? 0,
    matches: matchesCountResult.count ?? 0,
    conversations: convosCountResult.count ?? 0,
  };

  // Photos are now resolved via getImageUrl() at render time — no signed URL refresh needed

  return profileData;
};

// Update current user's profile
export const updateMyProfile = async (updates: Partial<ProfileData>): Promise<void> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

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
export const createProfile = async (profileData: Partial<ProfileData>): Promise<void> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

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
