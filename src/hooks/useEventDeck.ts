import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import {
  parseEventDeckProfiles,
  type EventDeckProfile as DeckProfile,
} from "@shared/eventProfileAdapters";
import { VIDEO_DATE_DECK_BUFFER_LIMIT } from "@clientShared/matching/videoDateInstantExperience";

export type { DeckProfile };

interface UseEventDeckOptions {
  eventId: string;
  enabled?: boolean;
}

export const useEventDeck = ({ eventId, enabled = true }: UseEventDeckOptions) => {
  const { user } = useUserProfile();

  const query = useQuery({
    queryKey: ["event-deck", eventId, user?.id, "deck_v2"],
    queryFn: async () => {
      const viewerProfileId = user?.id;
      if (!viewerProfileId || !eventId) return [];

      const { data, error } = await supabase.rpc("get_event_deck_v2", {
        p_event_id: eventId,
        p_user_id: viewerProfileId,
        p_limit: VIDEO_DATE_DECK_BUFFER_LIMIT,
      });

      if (error) {
        console.error("Error fetching deck:", error);
        throw error;
      }

      return parseEventDeckProfiles(data);
    },
    enabled: enabled && !!user?.id && !!eventId,
    refetchInterval: () =>
      typeof document === "undefined" || document.visibilityState === "visible" ? 15_000 : false,
    refetchIntervalInBackground: false,
    staleTime: 10000,
  });

  const profiles = query.data || [];

  return {
    profiles,
    isLoading: query.isLoading || (query.isFetching && profiles.length === 0),
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
