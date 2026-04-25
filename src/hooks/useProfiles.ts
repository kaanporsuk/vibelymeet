import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Profile {
  id: string;
  name: string;
  age: number;
  gender: string;
  job: string | null;
  heightCm: number | null;
  location: string | null;
  about_me: string | null;
  avatarUrl: string | null;
  photos: string[];
  vibes: string[];
  stats: {
    events: number;
    matches: number;
    conversations: number;
  };
}

export const useProfile = (profileId: string) => {
  return useQuery({
    queryKey: ["profile", profileId],
    queryFn: async (): Promise<Profile | null> => {
      const { data, error } = await supabase.rpc("get_profile_for_viewer", {
        p_target_id: profileId,
      });

      if (error) throw error;
      const profile = data as Record<string, unknown> | null;
      if (!profile || typeof profile.id !== "string") return null;
      const vibes = Array.isArray(profile.vibes)
        ? profile.vibes.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        : [];
      const photos = Array.isArray(profile.photos)
        ? profile.photos.filter((photo): photo is string => typeof photo === "string")
        : [];

      return {
        id: profile.id,
        name: typeof profile.name === "string" ? profile.name : "",
        age: typeof profile.age === "number" ? profile.age : 0,
        gender: typeof profile.gender === "string" ? profile.gender : "",
        job: typeof profile.job === "string" ? profile.job : null,
        heightCm: typeof profile.height_cm === "number" ? profile.height_cm : null,
        location: typeof profile.location === "string" ? profile.location : null,
        about_me: typeof profile.about_me === "string" ? profile.about_me : null,
        avatarUrl: typeof profile.avatar_url === "string" ? profile.avatar_url : null,
        photos,
        vibes,
        stats: {
          events: typeof profile.events_attended === "number" ? profile.events_attended : 0,
          matches: typeof profile.total_matches === "number" ? profile.total_matches : 0,
          conversations: typeof profile.total_conversations === "number" ? profile.total_conversations : 0,
        },
      };
    },
    enabled: !!profileId,
  });
};

export const useVibeTags = () => {
  return useQuery({
    queryKey: ["vibe-tags"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vibe_tags")
        .select("id, label, emoji, category")
        .order("label");

      if (error) throw error;
      return data || [];
    },
  });
};
