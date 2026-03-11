import { useQuery, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import { formatDistanceToNow } from "date-fns";
import { getImageUrl, avatarUrl as avatarPreset } from "@/utils/imageUrl";

export interface Match {
  id: string;
  name: string;
  age: number;
  image: string;
  lastMessage: string | null;
  time: string;
  unread: boolean;
  vibes: string[];
  isNew: boolean;
  matchId: string;
  photoVerified?: boolean;
  isArchived?: boolean;
  eventName?: string;
  photos?: string[];
  bio?: string | null;
  job?: string | null;
  location?: string | null;
  height?: number | null;
  prompts?: { question: string; answer: string }[];
  
  lifestyle?: Record<string, string>;
  tagline?: string | null;
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

      const [profilesResult, vibesResult, messagesResult, eventsResult] =
        await Promise.all([
          supabase
            .from("profiles")
            .select(
              "id, name, age, avatar_url, photos, photo_verified, bio, job, location, height_cm, looking_for, prompts, lifestyle, tagline"
            )
            .in("id", otherProfileIds),
          supabase
            .from("profile_vibes")
            .select("profile_id, vibe_tags(label)")
            .in("profile_id", otherProfileIds),
          supabase
            .from("messages")
            .select("match_id, content, created_at, read_at, sender_id")
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

      const profiles = profilesResult.data || [];
      const profileVibes = vibesResult.data || [];
      const lastMessages = messagesResult.data || [];
      const events = eventsResult.data || [];

      const messagesByMatch: Record<string, any> = {};
      lastMessages.forEach((msg) => {
        if (!messagesByMatch[msg.match_id]) {
          messagesByMatch[msg.match_id] = msg;
        }
      });

      const vibesByProfile: Record<string, string[]> = {};
      profileVibes.forEach((pv: any) => {
        if (!vibesByProfile[pv.profile_id]) {
          vibesByProfile[pv.profile_id] = [];
        }
        if (pv.vibe_tags?.label) {
          vibesByProfile[pv.profile_id].push(pv.vibe_tags.label);
        }
      });

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
        const lastMsg = messagesByMatch[match.id];
        const matchedAt = new Date(match.matched_at);
        const isNew =
          Date.now() - matchedAt.getTime() < 24 * 60 * 60 * 1000;
        const isArchived =
          match.archived_by === userId && match.archived_at !== null;

        // Use first photo or avatar, resolve via Bunny CDN helper
        const photoArr = (profile as any)?.photos as string[] | undefined;
        const rawImage =
          (photoArr && photoArr.length > 0 ? photoArr[0] : null) ||
          profile?.avatar_url ||
          "";
        const image = avatarPreset(rawImage);

        // Resolve all photos via CDN helper
        const resolvedPhotos = (photoArr || []).map((p: string) => getImageUrl(p));

        // Parse prompts from JSON
        const rawPrompts = (profile as any)?.prompts;
        const parsedPrompts = Array.isArray(rawPrompts) ? rawPrompts : [];

        return {
          id: otherProfileId,
          name: profile?.name || "Unknown",
          age: profile?.age || 0,
          image,
          lastMessage: lastMsg?.content || null,
          time: lastMsg
            ? formatDistanceToNow(new Date(lastMsg.created_at), {
                addSuffix: false,
              })
            : "new",
          unread: lastMsg
            ? !lastMsg.read_at && lastMsg.sender_id !== userId
            : false,
          vibes: vibesByProfile[otherProfileId]?.slice(0, 2) || [],
          isNew,
          matchId: match.id,
          photoVerified: !!(profile as any)?.photo_verified,
          isArchived,
          eventName: match.event_id
            ? eventsById[match.event_id] || undefined
            : undefined,
          photos: resolvedPhotos.length > 0 ? resolvedPhotos : undefined,
          bio: (profile as any)?.bio || null,
          job: (profile as any)?.job || null,
          location: (profile as any)?.location || null,
          height: (profile as any)?.height_cm || null,
          prompts: parsedPrompts as { question: string; answer: string }[],
          
          lifestyle: (profile as any)?.lifestyle as Record<string, string> || undefined,
          tagline: (profile as any)?.tagline || null,
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
