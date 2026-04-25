import { supabase } from "@/integrations/supabase/client";

export type UserProfileView = {
  id: string;
  name: string | null;
  age: number | null;
  birth_date: string | null;
  gender: string | null;
  tagline: string | null;
  location: string | null;
  job: string | null;
  height_cm: number | null;
  about_me: string | null;
  /** @deprecated Compatibility-only fallback. Prefer relationship_intent. */
  looking_for: string | null;
  relationship_intent: string | null;
  photos: string[] | null;
  avatar_url: string | null;
  bunny_video_uid: string | null;
  bunny_video_status: string | null;
  vibe_caption: string | null;
  lifestyle: Record<string, string> | null;
  prompts: Array<{ question: string; answer: string }> | null;
  photo_verified: boolean | null;
  vibe_score: number | null;
  vibe_score_label: string | null;
  is_premium: boolean | null;
  vibes: string[];
};

function normalizePrompts(raw: unknown): Array<{ question: string; answer: string }> | null {
  if (!raw || !Array.isArray(raw)) return null;
  const out: Array<{ question: string; answer: string }> = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const q = (p as { question?: unknown }).question;
    const a = (p as { answer?: unknown }).answer;
    out.push({
      question: typeof q === "string" ? q : "",
      answer: typeof a === "string" ? a : "",
    });
  }
  return out.length > 0 ? out : null;
}

export async function fetchUserProfile(profileId: string): Promise<UserProfileView | null> {
  if (!profileId) return null;

  const { data: rawData, error } = await supabase.rpc("get_profile_for_viewer", {
    p_target_id: profileId,
  });

  if (error) return null;
  if (rawData === null || rawData === undefined) return null;
  if (typeof rawData !== "object" || Array.isArray(rawData)) return null;
  const row = rawData as Record<string, unknown>;
  if (typeof row.id !== "string") return null;

  const photosRaw = row.photos;
  const photos = Array.isArray(photosRaw)
    ? photosRaw.filter((p): p is string => typeof p === "string")
    : null;

  const vibeScore =
    row.vibe_score === null || row.vibe_score === undefined
      ? null
      : typeof row.vibe_score === "number"
        ? row.vibe_score
        : null;
  const vibeScoreLabel = typeof row.vibe_score_label === "string" ? row.vibe_score_label : null;
  const vibes = Array.isArray(row.vibes)
    ? row.vibes.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];

  return {
    id: row.id as string,
    name: typeof row.name === "string" ? row.name : null,
    age: typeof row.age === "number" ? row.age : row.age === null ? null : null,
    birth_date: typeof row.birth_date === "string" ? row.birth_date : row.birth_date === null ? null : null,
    gender: typeof row.gender === "string" ? row.gender : row.gender === null ? null : null,
    tagline: typeof row.tagline === "string" ? row.tagline : row.tagline === null ? null : null,
    location: typeof row.location === "string" ? row.location : row.location === null ? null : null,
    job: typeof row.job === "string" ? row.job : row.job === null ? null : null,
    height_cm: typeof row.height_cm === "number" ? row.height_cm : row.height_cm === null ? null : null,
    about_me: typeof row.about_me === "string" ? row.about_me : row.about_me === null ? null : null,
    looking_for: typeof row.looking_for === "string" ? row.looking_for : row.looking_for === null ? null : null,
    relationship_intent:
      typeof row.relationship_intent === "string"
        ? row.relationship_intent
        : row.relationship_intent === null
          ? null
          : null,
    photos,
    avatar_url: typeof row.avatar_url === "string" ? row.avatar_url : row.avatar_url === null ? null : null,
    bunny_video_uid: typeof row.bunny_video_uid === "string" ? row.bunny_video_uid : row.bunny_video_uid === null ? null : null,
    bunny_video_status:
      typeof row.bunny_video_status === "string" ? row.bunny_video_status : row.bunny_video_status === null ? null : null,
    vibe_caption: typeof row.vibe_caption === "string" ? row.vibe_caption : row.vibe_caption === null ? null : null,
    lifestyle:
      row.lifestyle && typeof row.lifestyle === "object" && !Array.isArray(row.lifestyle)
        ? (row.lifestyle as Record<string, string>)
        : row.lifestyle === null
          ? null
          : null,
    prompts: normalizePrompts(row.prompts),
    photo_verified: typeof row.photo_verified === "boolean" ? row.photo_verified : row.photo_verified === null ? null : null,
    vibe_score: vibeScore,
    vibe_score_label: vibeScoreLabel,
    is_premium: typeof row.is_premium === "boolean" ? row.is_premium : row.is_premium === null ? null : null,
    vibes,
  };
}
