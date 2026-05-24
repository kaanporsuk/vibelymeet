import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import {
  parseEventDeckResponse,
  type EventDeckFetchResult,
  type EventDeckProfile as DeckProfile,
} from "@shared/eventProfileAdapters";
import { VIDEO_DATE_DECK_BUFFER_LIMIT } from "@clientShared/matching/videoDateInstantExperience";

export type { DeckProfile };
export type { EventDeckFetchResult };

interface UseEventDeckOptions {
  eventId: string;
  enabled?: boolean;
  refetchIntervalMs?: number | false;
}

export async function fetchEventDeck(eventId: string, viewerProfileId: string): Promise<EventDeckFetchResult> {
  if (!viewerProfileId || !eventId) {
    return parseEventDeckResponse({ ok: false, profiles: [], deck_state: { reason: "unknown", retryable: false } });
  }

  const { data, error } = await supabase.rpc("get_event_deck_v3" as never, {
    p_event_id: eventId,
    p_user_id: viewerProfileId,
    p_limit: VIDEO_DATE_DECK_BUFFER_LIMIT,
  } as never);

  if (error) {
    console.error("Error fetching deck:", error);
    throw error;
  }

  return parseEventDeckResponse(data);
}

export const useEventDeck = ({ eventId, enabled = true, refetchIntervalMs }: UseEventDeckOptions) => {
  const { user } = useUserProfile();

  const query = useQuery({
    queryKey: ["event-deck", eventId, user?.id, "deck_v3"],
    queryFn: async (): Promise<EventDeckFetchResult> => {
      const viewerProfileId = user?.id;
      if (!viewerProfileId || !eventId) {
        return parseEventDeckResponse({ ok: false, profiles: [], deck_state: { reason: "unknown", retryable: false } });
      }
      return fetchEventDeck(eventId, viewerProfileId);
    },
    enabled: enabled && !!user?.id && !!eventId,
    refetchInterval: () => {
      if (refetchIntervalMs === false) return false;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return false;
      return refetchIntervalMs ?? 15_000;
    },
    refetchIntervalInBackground: false,
    staleTime: 10000,
  });

  const deckResult = query.data ?? null;
  const profiles = deckResult?.profiles || [];

  return {
    profiles,
    deckState: deckResult?.deckState ?? null,
    deckOk: deckResult?.ok ?? false,
    isLoading: query.isLoading || (query.isFetching && profiles.length === 0),
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
