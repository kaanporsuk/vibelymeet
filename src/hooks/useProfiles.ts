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
  bio: string | null;
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
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", profileId)
        .maybeSingle();

      if (error) throw error;
      if (!profile) return null;

      // Fetch vibes
      const { data: vibes } = await supabase
        .from("profile_vibes")
        .select("vibe_tags(label)")
        .eq("profile_id", profileId);

      return {
        id: profile.id,
        name: profile.name,
        age: profile.age,
        gender: profile.gender,
        job: profile.job,
        heightCm: profile.height_cm,
        location: profile.location,
        bio: profile.bio,
        avatarUrl: profile.avatar_url,
        photos: profile.photos || [],
        vibes: vibes?.map((v: any) => v.vibe_tags?.label).filter(Boolean) || [],
        stats: {
          events: profile.events_attended || 0,
          matches: profile.total_matches || 0,
          conversations: profile.total_conversations || 0,
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
        .select("*")
        .order("label");

      if (error) throw error;
      return data || [];
    },
  });
};
