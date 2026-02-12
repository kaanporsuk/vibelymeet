import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface DeckProfile {
  profile_id: string;
  name: string;
  age: number;
  gender: string;
  avatar_url: string | null;
  photos: string[] | null;
  bio: string | null;
  job: string | null;
  location: string | null;
  height_cm: number | null;
  tagline: string | null;
  looking_for: string | null;
  video_intro_url: string | null;
  queue_status: string | null;
  has_met_before: boolean;
  is_already_connected: boolean;
  has_super_vibed: boolean;
}

interface UseEventDeckOptions {
  eventId: string;
  enabled?: boolean;
}

export const useEventDeck = ({ eventId, enabled = true }: UseEventDeckOptions) => {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ["event-deck", eventId, user?.id],
    queryFn: async () => {
      if (!user?.id || !eventId) return [];

      const { data, error } = await supabase.rpc("get_event_deck", {
        p_event_id: eventId,
        p_user_id: user.id,
        p_limit: 50,
      });

      if (error) {
        console.error("Error fetching deck:", error);
        throw error;
      }

      return (data as unknown as DeckProfile[]) || [];
    },
    enabled: enabled && !!user?.id && !!eventId,
    refetchInterval: 15000, // Refresh every 15s to get new arrivals
    staleTime: 10000,
  });

  return {
    profiles: query.data || [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
};
