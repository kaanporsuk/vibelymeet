import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import {
  parseEventDeckProfiles,
  type EventDeckProfile as DeckProfile,
} from "@shared/eventProfileAdapters";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";

export type { DeckProfile };

interface UseEventDeckOptions {
  eventId: string;
  enabled?: boolean;
}

export const useEventDeck = ({ eventId, enabled = true }: UseEventDeckOptions) => {
  const { user } = useUserProfile();
  const deckDealV2 = useFeatureFlag("video_date.deck_deal_v2");

  const query = useQuery({
    queryKey: ["event-deck", eventId, user?.id, deckDealV2.enabled ? "deck_v2" : "deck_v1"],
    queryFn: async () => {
      const viewerProfileId = user?.id;
      if (!viewerProfileId || !eventId) return [];

      const { data, error } = await supabase.rpc(deckDealV2.enabled ? "get_event_deck_v2" : "get_event_deck", {
        p_event_id: eventId,
        p_user_id: viewerProfileId,
        p_limit: deckDealV2.enabled ? 1 : 50,
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
