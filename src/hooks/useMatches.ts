import { useQuery, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import { formatDistanceToNow } from "date-fns";
import { getImageUrl, avatarUrl as avatarPreset } from "@/utils/imageUrl";
import {
  bestMatchSortKey,
  compatibilityPercent,
  type MatchScoreInput,
} from "@/utils/matchSortScore";
import type { ConversationPreview } from "../../shared/chat/conversationListPreview";
import {
  conversationPreviewSearchText,
  getConversationPreview,
  getEmptyConversationPreview,
} from "../../shared/chat/conversationListPreview";

/** Row shape for `.from("profiles").select(...)` in this hook (intent fields for scoring + display). */
type MatchesListProfileRow = {
  id: string;
  name: string | null;
  age: number | null;
  avatar_url: string | null;
  photos: string[] | null;
  photo_verified: boolean | null;
  about_me: string | null;
  job: string | null;
  location: string | null;
  height_cm: number | null;
  looking_for: string | null;
  relationship_intent: string | null;
  prompts: unknown;
  lifestyle: unknown;
  tagline: string | null;
};

function profileIntentForMatch(
  p: Pick<MatchesListProfileRow, "relationship_intent" | "looking_for"> | undefined,
): string | null {
  return p?.relationship_intent ?? p?.looking_for ?? null;
}

/** Latest message row shape from matches list query (one row per match). */
type MatchLatestMessageRow = {
  match_id: string;
  content: string | null;
  created_at: string;
  read_at: string | null;
  sender_id: string;
  message_kind: string | null;
  audio_url: string | null;
  video_url: string | null;
  structured_payload: unknown;
};

export interface Match {
  id: string;
  name: string;
  age: number;
  image: string;
  conversationPreview: ConversationPreview;
  /** Substring search for “matched on message” (includes `you` when preview prefix is You). */
  messageSearchHaystack: string;
  time: string;
  unread: boolean;
  vibes: string[];
  /** Canonical relationship-intent id for client-side search/display, with legacy fallback applied at fetch time. */
  looking_for: string | null;
  isNew: boolean;
  matchId: string;
  photoVerified?: boolean;
  isArchived?: boolean;
  eventName?: string;
  photos?: string[];
  about_me?: string | null;
  job?: string | null;
  location?: string | null;
  height?: number | null;
  prompts?: { question: string; answer: string }[];
  
  lifestyle?: Record<string, string>;
  tagline?: string | null;
  /** Deterministic sort key for "Best Match" (larger = stronger). */
  bestMatchScore: number;
  /** Same inputs as bestMatchScore; row / drawer compatibility %. */
  compatibilityPercent: number;
}

const PAGE_SIZE = 20;

export const useMatches = () => {
  const { user } = useUserProfile();
  const userId = user?.id;
  const queryClient = useQueryClient();

  // Realtime subscription for new matches
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`matches-realtime-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "matches",
        },
        (payload) => {
          const row = payload.new as any;
          if (row.profile_id_1 === userId || row.profile_id_2 === userId) {
            queryClient.invalidateQueries({ queryKey: ["matches"] });
            queryClient.invalidateQueries({ queryKey: ["dashboard-matches"] });
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "matches",
        },
        (payload) => {
          const row = payload.new as any;
          if (row.profile_id_1 === userId || row.profile_id_2 === userId) {
            queryClient.invalidateQueries({ queryKey: ["matches"] });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);

  return useQuery({
    queryKey: ["matches", userId],
    queryFn: async (): Promise<Match[]> => {
      if (!userId) return [];

      const { data: matches, error } = await supabase
        .from("matches")
        .select(`
          id,
          matched_at,
          last_message_at,
          profile_id_1,
          profile_id_2,
          archived_at,
          archived_by,
          event_id
        `)
        .or(`profile_id_1.eq.${userId},profile_id_2.eq.${userId}`)
        .order("last_message_at", { ascending: false, nullsFirst: false });

      if (error) throw error;
      if (!matches?.length) return [];

      const otherProfileIds = matches.map((m) =>
        m.profile_id_1 === userId ? m.profile_id_2 : m.profile_id_1
      );

      const eventIds = matches
        .map((m) => m.event_id)
        .filter(Boolean) as string[];

      const profileIdsForFetch = [...otherProfileIds, userId];

      const [profilesResult, vibesResult, messagesResult, eventsResult] =
        await Promise.all([
          supabase
            .from("profiles")
            .select(
              "id, name, age, avatar_url, photos, photo_verified, about_me, job, location, height_cm, looking_for, relationship_intent, prompts, lifestyle, tagline"
            )
            .in("id", profileIdsForFetch),
          supabase
            .from("profile_vibes")
            .select("profile_id, vibe_tags(label)")
            .in("profile_id", profileIdsForFetch),
          supabase
            .from("messages")
            .select(
              "match_id, content, created_at, read_at, sender_id, message_kind, audio_url, video_url, structured_payload"
            )
            .in(
              "match_id",
              matches.map((m) => m.id)
            )
            .order("created_at", { ascending: false }),
          eventIds.length > 0
            ? supabase
                .from("events")
                .select("id, title")
                .in("id", eventIds)
            : Promise.resolve({ data: [] }),
        ]);

      const profiles = (profilesResult.data || []) as MatchesListProfileRow[];
      const profileVibes = vibesResult.data || [];
      const lastMessages = messagesResult.data || [];
      const events = eventsResult.data || [];

      const messagesByMatch: Record<string, MatchLatestMessageRow> = {};
      lastMessages.forEach((msg) => {
        const row = msg as MatchLatestMessageRow;
        if (!messagesByMatch[row.match_id]) {
          messagesByMatch[row.match_id] = row;
        }
      });

      const vibesByProfile: Record<string, string[]> = {};
      profileVibes.forEach((pv: any) => {
        if (!vibesByProfile[pv.profile_id]) {
          vibesByProfile[pv.profile_id] = [];
        }
        if (pv.vibe_tags?.label) {
          const lbl = pv.vibe_tags.label as string;
          if (!vibesByProfile[pv.profile_id].includes(lbl)) {
            vibesByProfile[pv.profile_id].push(lbl);
          }
        }
      });

      const viewerProfile = profiles.find((p) => p.id === userId);
      const viewerVibes = vibesByProfile[userId] ?? [];
      const viewerLookingFor = profileIntentForMatch(viewerProfile);

      const eventsById: Record<string, string> = {};
      events.forEach((e: any) => {
        eventsById[e.id] = e.title;
      });

      return matches.map((match) => {
        const otherProfileId =
          match.profile_id_1 === userId
            ? match.profile_id_2
            : match.profile_id_1;
        const profile = profiles.find((p) => p.id === otherProfileId);
        const otherVibes = vibesByProfile[otherProfileId] ?? [];
        const scoreInput: MatchScoreInput = {
          viewerVibeLabels: viewerVibes,
          otherVibeLabels: otherVibes,
          viewerLookingFor,
          otherLookingFor: profileIntentForMatch(profile),
          hasSharedEventContext: !!match.event_id,
        };
        const bestMatchScore = bestMatchSortKey(scoreInput);
        const compatibilityPct = compatibilityPercent(scoreInput);
        const lastMsg = messagesByMatch[match.id];
        const matchedAt = new Date(match.matched_at);
        const isNew =
          Date.now() - matchedAt.getTime() < 24 * 60 * 60 * 1000;
        const isArchived =
          match.archived_by === userId && match.archived_at !== null;

        // Use first photo or avatar, resolve via Bunny CDN helper
        const photoArr = profile?.photos ?? undefined;
        const rawImage =
          (photoArr && photoArr.length > 0 ? photoArr[0] : null) ||
          profile?.avatar_url ||
          "";
        const image = avatarPreset(rawImage);

        // Resolve all photos via CDN helper
        const resolvedPhotos = (photoArr || []).map((p: string) => getImageUrl(p));

        // Parse prompts from JSON
        const rawPrompts = profile?.prompts;
        const parsedPrompts = Array.isArray(rawPrompts) ? rawPrompts : [];

        const conversationPreview = lastMsg
          ? getConversationPreview(
              {
                content: lastMsg.content,
                message_kind: lastMsg.message_kind,
                audio_url: lastMsg.audio_url,
                video_url: lastMsg.video_url,
                sender_id: lastMsg.sender_id,
                structured_payload: lastMsg.structured_payload,
              },
              userId,
            )
          : getEmptyConversationPreview();

        return {
          id: otherProfileId,
          name: profile?.name || "Unknown",
          age: profile?.age || 0,
          image,
          conversationPreview,
          messageSearchHaystack: conversationPreviewSearchText(conversationPreview),
          time: lastMsg
            ? formatDistanceToNow(new Date(lastMsg.created_at), {
                addSuffix: false,
              })
            : "new",
          unread: lastMsg
            ? !lastMsg.read_at && lastMsg.sender_id !== userId
            : false,
          vibes: otherVibes,
          looking_for: profileIntentForMatch(profile),
          isNew,
          matchId: match.id,
          photoVerified: !!profile?.photo_verified,
          isArchived,
          bestMatchScore,
          compatibilityPercent: compatibilityPct,
          eventName: match.event_id
            ? eventsById[match.event_id] || undefined
            : undefined,
          photos: resolvedPhotos.length > 0 ? resolvedPhotos : undefined,
          about_me: profile?.about_me ?? null,
          job: profile?.job ?? null,
          location: profile?.location ?? null,
          height: profile?.height_cm ?? null,
          prompts: parsedPrompts as { question: string; answer: string }[],
          
          lifestyle:
            profile?.lifestyle && typeof profile.lifestyle === "object" && !Array.isArray(profile.lifestyle)
              ? (profile.lifestyle as Record<string, string>)
              : undefined,
          tagline: profile?.tagline ?? null,
        };
      });
    },
    enabled: !!userId,
  });
};

export const useDashboardMatches = () => {
  const { user } = useUserProfile();
  const userId = user?.id;

  return useQuery({
    queryKey: ["dashboard-matches", userId],
    queryFn: async () => {
      if (!userId) return [];

      const { data: matches, error } = await supabase
        .from("matches")
        .select("id, matched_at, profile_id_1, profile_id_2")
        .or(`profile_id_1.eq.${userId},profile_id_2.eq.${userId}`)
        .order("matched_at", { ascending: false })
        .limit(5);

      if (error) throw error;
      if (!matches?.length) return [];

      const otherProfileIds = matches.map((m) =>
        m.profile_id_1 === userId ? m.profile_id_2 : m.profile_id_1
      );

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, name, avatar_url")
        .in("id", otherProfileIds);

      return matches.map((match) => {
        const otherProfileId =
          match.profile_id_1 === userId
            ? match.profile_id_2
            : match.profile_id_1;
        const profile = profiles?.find((p) => p.id === otherProfileId);
        const matchedAt = new Date(match.matched_at);
        const isNew =
          Date.now() - matchedAt.getTime() < 24 * 60 * 60 * 1000;

        const rawImage = profile?.avatar_url || "";
        const image = avatarPreset(rawImage);

        return {
          id: otherProfileId,
          name: profile?.name || "Unknown",
          image,
          isNew,
        };
      });
    },
    enabled: !!userId,
  });
};
