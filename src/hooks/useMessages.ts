import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Message {
  id: string;
  text: string;
  sender: "me" | "them";
  time: string;
}

export const useMessages = (otherUserId: string, currentUserId?: string) => {
  return useQuery({
    queryKey: ["messages", otherUserId, currentUserId],
    queryFn: async (): Promise<{ messages: Message[]; matchId: string | null; otherUser: any }> => {
      if (!currentUserId) return { messages: [], matchId: null, otherUser: null };

      const { data: match, error: matchError } = await supabase
        .from("matches")
        .select("id")
        .or(
          `and(profile_id_1.eq.${currentUserId},profile_id_2.eq.${otherUserId}),and(profile_id_1.eq.${otherUserId},profile_id_2.eq.${currentUserId})`
        )
        .maybeSingle();

      if (matchError) throw matchError;
      if (!match) return { messages: [], matchId: null, otherUser: null };

      const { data: messages, error: msgError } = await supabase
        .from("messages")
        .select("id, match_id, sender_id, content, created_at, read_at")
        .eq("match_id", match.id)
        .order("created_at", { ascending: true });

      if (msgError) throw msgError;

      const { data: otherUser } = await supabase
        .from("profiles")
        .select("id, name, age, avatar_url")
        .eq("id", otherUserId)
        .maybeSingle();

      return {
        matchId: match.id,
        otherUser,
        messages: (messages || []).map((msg) => ({
          id: msg.id,
          text: msg.content,
          sender: msg.sender_id === currentUserId ? "me" : "them",
          time: new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        })),
      };
    },
    enabled: !!otherUserId && !!currentUserId,
  });
};

export const useSendMessage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ matchId, content }: { matchId: string; content: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("messages")
        .insert({
          match_id: matchId,
          sender_id: user.id,
          content,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      queryClient.invalidateQueries({ queryKey: ["matches"] });
    },
  });
};
