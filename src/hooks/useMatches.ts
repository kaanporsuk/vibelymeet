import { useQuery } from "@tanstack/react-query";
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
}

// Demo user ID for now (until auth is implemented)
const DEMO_USER_ID = "b2222222-2222-2222-2222-222222222222";

export const useMatches = (userId: string = DEMO_USER_ID) => {
  return useQuery({
    queryKey: ["matches", userId],
    queryFn: async (): Promise<Match[]> => {
      // Get all matches where user is either profile_1 or profile_2
      const { data: matches, error } = await supabase
        .from("matches")
        .select(`
          id,
          matched_at,
          last_message_at,
          profile_id_1,
          profile_id_2
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
        .select("id, name, age, gender, job, height_cm, location, bio, avatar_url, photos, events_attended, total_matches, total_conversations, updated_at")
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
        };
      });
    },
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
