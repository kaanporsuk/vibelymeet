import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { captureSupabaseError } from "@/lib/errorTracking";
import { collapseVibeGameRowsForWeb, type WebHydratedGameSessionView } from "@/lib/webChatGameSessions";

export interface Message {
  id: string;
  text: string;
  sender: "me" | "them";
  time: string;
  createdAt: string;
  audioUrl?: string;
  audioDuration?: number;
  videoUrl?: string;
  videoDuration?: number;
  messageKind?: "text" | "date_suggestion" | "date_suggestion_event" | "vibe_game_session";
  refId?: string | null;
  structuredPayload?: Record<string, unknown> | null;
  gameSessionView?: WebHydratedGameSessionView;
}

type ChatOtherUser = {
  id: string;
  name: string | null;
  age: number | null;
  avatar_url: string | null;
  photos: unknown;
  last_seen_at: string | null;
  photo_verified: boolean | null;
} | null;

export const useMessages = (otherUserId: string, currentUserId?: string) => {
  return useQuery({
    queryKey: ["messages", otherUserId, currentUserId],
    queryFn: async (): Promise<{ messages: Message[]; matchId: string | null; otherUser: ChatOtherUser }> => {
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
        .select(
          "id, match_id, sender_id, content, created_at, read_at, audio_url, audio_duration_seconds, video_url, video_duration_seconds, message_kind, ref_id, structured_payload",
        )
        .eq("match_id", match.id)
        .order("created_at", { ascending: true });

      if (msgError) throw msgError;

      const { data: otherUser } = await supabase
        .from("profiles")
        .select("id, name, age, avatar_url, photos, last_seen_at, photo_verified")
        .eq("id", otherUserId)
        .maybeSingle();

      const collapsedRows = collapseVibeGameRowsForWeb((messages || []).map((msg) => ({
        id: msg.id,
        sender_id: msg.sender_id,
        content: msg.content,
        created_at: msg.created_at,
        read_at: msg.read_at,
        audio_url: msg.audio_url,
        audio_duration_seconds: msg.audio_duration_seconds,
        video_url: msg.video_url,
        video_duration_seconds: msg.video_duration_seconds,
        message_kind: (msg as { message_kind?: string }).message_kind ?? "text",
        ref_id: (msg as { ref_id?: string | null }).ref_id ?? null,
        structured_payload: (msg as { structured_payload?: unknown }).structured_payload ?? null,
      })));

      return {
        matchId: match.id,
        otherUser,
        messages: collapsedRows.map((row) => {
          const mk = (row.message_kind || "text") as string;
          return {
            id: row.id,
            text: row.content,
            sender: row.sender_id === currentUserId ? ("me" as const) : ("them" as const),
            time: new Date(row.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            createdAt: row.created_at,
            audioUrl: row.audio_url || undefined,
            audioDuration: row.audio_duration_seconds || undefined,
            videoUrl: row.video_url || undefined,
            videoDuration: row.video_duration_seconds || undefined,
            messageKind:
              mk === "date_suggestion" || mk === "date_suggestion_event" || mk === "vibe_game_session"
                ? (mk as Message["messageKind"])
                : ("text" as const),
            refId: row.ref_id,
            structuredPayload: row.structured_payload ?? null,
            gameSessionView: row.game_session_view,
          };
        }),
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

      const { data, error } = await supabase.functions.invoke("send-message", {
        body: {
          match_id: matchId,
          content,
        },
      });

      if (error) {
        captureSupabaseError("send-message", error);
        throw error;
      }

      const payload = data as { message?: unknown } | null | undefined;
      return payload?.message;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      queryClient.invalidateQueries({ queryKey: ["matches"] });
    },
  });
};
