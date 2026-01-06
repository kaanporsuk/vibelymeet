import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";

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
}

// Demo user ID for now (until auth is implemented)
const DEMO_USER_ID = "b2222222-2222-2222-2222-222222222222";
const PAGE_SIZE = 20;

export const useMatches = (userId: string = DEMO_USER_ID) => {
  return useQuery({
    queryKey: ["matches", userId],
    queryFn: async (): Promise<Match[]> => {
      // Get all matches where user is either profile_1 or profile_2
      // Filter out archived matches for current user
      const { data: matches, error } = await supabase
        .from("matches")
        .select(`
          id,
          matched_at,
          last_message_at,
          profile_id_1,
          profile_id_2,
          archived_at,
          archived_by
        `)
        .or(`profile_id_1.eq.${userId},profile_id_2.eq.${userId}`)
        .order("last_message_at", { ascending: false, nullsFirst: false });

      if (error) throw error;
      if (!matches?.length) return [];

      // Get the other user's profile for each match
      const otherProfileIds = matches.map((m) =>
        m.profile_id_1 === userId ? m.profile_id_2 : m.profile_id_1
      );

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, name, age, gender, job, height_cm, location, bio, avatar_url, photos, photo_verified, events_attended, total_matches, total_conversations, updated_at")
        .in("id", otherProfileIds);

      // Get vibes for these profiles
      const { data: profileVibes } = await supabase
        .from("profile_vibes")
        .select("profile_id, vibe_tags(label)")
        .in("profile_id", otherProfileIds);

      // Get last message for each match
      const { data: lastMessages } = await supabase
        .from("messages")
        .select("match_id, content, created_at, read_at, sender_id")
        .in("match_id", matches.map((m) => m.id))
        .order("created_at", { ascending: false });

      // Group messages by match
      const messagesByMatch: Record<string, any> = {};
      lastMessages?.forEach((msg) => {
        if (!messagesByMatch[msg.match_id]) {
          messagesByMatch[msg.match_id] = msg;
        }
      });

      // Group vibes by profile
      const vibesByProfile: Record<string, string[]> = {};
      profileVibes?.forEach((pv: any) => {
        if (!vibesByProfile[pv.profile_id]) {
          vibesByProfile[pv.profile_id] = [];
        }
        if (pv.vibe_tags?.label) {
          vibesByProfile[pv.profile_id].push(pv.vibe_tags.label);
        }
      });

      return matches.map((match) => {
        const otherProfileId = match.profile_id_1 === userId ? match.profile_id_2 : match.profile_id_1;
        const profile = profiles?.find((p) => p.id === otherProfileId);
        const lastMsg = messagesByMatch[match.id];
        const matchedAt = new Date(match.matched_at);
        const isNew = Date.now() - matchedAt.getTime() < 24 * 60 * 60 * 1000; // Within 24 hours
        const isArchived = match.archived_by === userId && match.archived_at !== null;

        return {
          id: otherProfileId,
          name: profile?.name || "Unknown",
          age: profile?.age || 0,
          image: profile?.avatar_url || "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200",
          lastMessage: lastMsg?.content || "Start a conversation!",
          time: lastMsg ? formatDistanceToNow(new Date(lastMsg.created_at), { addSuffix: false }) : "new",
          unread: lastMsg ? !lastMsg.read_at && lastMsg.sender_id !== userId : false,
          vibes: vibesByProfile[otherProfileId]?.slice(0, 2) || [],
          isNew,
          matchId: match.id,
          photoVerified: !!(profile as any)?.photo_verified,
          isArchived,
        };
      });
    },
  });
};

// Infinite scroll version for larger datasets
export const useInfiniteMatches = (userId: string = DEMO_USER_ID) => {
  return useInfiniteQuery({
    queryKey: ["infinite-matches", userId],
    queryFn: async ({ pageParam = 0 }): Promise<{ matches: Match[]; nextCursor: number | null }> => {
      const from = pageParam * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data: matches, error } = await supabase
        .from("matches")
        .select(`
          id,
          matched_at,
          last_message_at,
          profile_id_1,
          profile_id_2,
          archived_at,
          archived_by
        `)
        .or(`profile_id_1.eq.${userId},profile_id_2.eq.${userId}`)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .range(from, to);

      if (error) throw error;
      if (!matches?.length) return { matches: [], nextCursor: null };

      const otherProfileIds = matches.map((m) =>
        m.profile_id_1 === userId ? m.profile_id_2 : m.profile_id_1
      );

      const [profilesResult, vibesResult, messagesResult] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, name, age, avatar_url, photo_verified")
          .in("id", otherProfileIds),
        supabase
          .from("profile_vibes")
          .select("profile_id, vibe_tags(label)")
          .in("profile_id", otherProfileIds),
        supabase
          .from("messages")
          .select("match_id, content, created_at, read_at, sender_id")
          .in("match_id", matches.map((m) => m.id))
          .order("created_at", { ascending: false }),
      ]);

      const profiles = profilesResult.data || [];
      const profileVibes = vibesResult.data || [];
      const lastMessages = messagesResult.data || [];

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

      const formattedMatches = matches.map((match) => {
        const otherProfileId = match.profile_id_1 === userId ? match.profile_id_2 : match.profile_id_1;
        const profile = profiles.find((p) => p.id === otherProfileId);
        const lastMsg = messagesByMatch[match.id];
        const matchedAt = new Date(match.matched_at);
        const isNew = Date.now() - matchedAt.getTime() < 24 * 60 * 60 * 1000;
        const isArchived = match.archived_by === userId && match.archived_at !== null;

        return {
          id: otherProfileId,
          name: profile?.name || "Unknown",
          age: profile?.age || 0,
          image: profile?.avatar_url || "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200",
          lastMessage: lastMsg?.content || "Start a conversation!",
          time: lastMsg ? formatDistanceToNow(new Date(lastMsg.created_at), { addSuffix: false }) : "new",
          unread: lastMsg ? !lastMsg.read_at && lastMsg.sender_id !== userId : false,
          vibes: vibesByProfile[otherProfileId]?.slice(0, 2) || [],
          isNew,
          matchId: match.id,
          photoVerified: !!profile?.photo_verified,
          isArchived,
        };
      });

      return {
        matches: formattedMatches,
        nextCursor: matches.length === PAGE_SIZE ? pageParam + 1 : null,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: 0,
  });
};

export const useDashboardMatches = (userId: string = DEMO_USER_ID) => {
  return useQuery({
    queryKey: ["dashboard-matches", userId],
    queryFn: async () => {
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
        const otherProfileId = match.profile_id_1 === userId ? match.profile_id_2 : match.profile_id_1;
        const profile = profiles?.find((p) => p.id === otherProfileId);
        const matchedAt = new Date(match.matched_at);
        const isNew = Date.now() - matchedAt.getTime() < 24 * 60 * 60 * 1000;

        return {
          id: otherProfileId,
          name: profile?.name || "Unknown",
          image: profile?.avatar_url || "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200",
          isNew,
        };
      });
    },
  });
};
