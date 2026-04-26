import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { captureSupabaseError } from "@/lib/errorTracking";
import { collapseVibeGameRowsForWeb, type WebHydratedGameSessionView } from "@/lib/webChatGameSessions";
import { toRenderableMessageKind } from "../../shared/chat/messageRouting";
import { threadMessagesQueryKey, type ThreadInvalidateScope } from "../../shared/chat/queryKeys";
import { resolvePrimaryProfilePhotoPath } from "../../shared/profilePhoto/resolvePrimaryProfilePhotoPath";

export type { ThreadInvalidateScope };

/** Exported for web chat outbox (same invalidation as send mutations). */
export function invalidateAfterThreadMutation(qc: QueryClient, scope: ThreadInvalidateScope | undefined) {
  if (scope?.otherUserId && scope?.currentUserId) {
    qc.invalidateQueries({
      queryKey: threadMessagesQueryKey(scope.otherUserId, scope.currentUserId),
      exact: true,
    });
  }
  if (scope?.matchId) {
    qc.invalidateQueries({ queryKey: ["date-suggestions", scope.matchId] });
  }
  qc.invalidateQueries({ queryKey: ["matches"] });
}

export interface Message {
  id: string;
  text: string;
  sender: "me" | "them";
  time: string;
  createdAt: string;
  /** Partner read receipt for outbound messages (matches native `read_at` → status). */
  readAt?: string | null;
  audioUrl?: string;
  audioDuration?: number;
  videoUrl?: string;
  videoDuration?: number;
  messageKind?: "text" | "date_suggestion" | "date_suggestion_event" | "vibe_game_session" | "vibe_clip";
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
  is_online: boolean;
  photo_verified: boolean | null;
  subscription_tier: string | null;
} | null;

type ChatPresenceRow = {
  can_view_presence?: boolean | null;
  is_online?: boolean | null;
  last_seen_at?: string | null;
};

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

      const [messagesRes, otherUserRes, presenceRes] = await Promise.all([
        supabase
          .from("messages")
          .select(
            "id, match_id, sender_id, content, created_at, read_at, audio_url, audio_duration_seconds, video_url, video_duration_seconds, message_kind, ref_id, structured_payload",
          )
          .eq("match_id", match.id)
          .order("created_at", { ascending: true }),
        supabase
          .from("profiles")
          .select("id, name, age, avatar_url, photos, photo_verified, subscription_tier")
          .eq("id", otherUserId)
          .maybeSingle(),
        supabase
          .rpc("get_chat_partner_presence", { p_match_id: match.id })
          .maybeSingle(),
      ]);

      if (messagesRes.error) throw messagesRes.error;
      const messages = messagesRes.data || [];
      const otherUser = otherUserRes.data;
      const presenceData = presenceRes.data as ChatPresenceRow | null;
      const presence =
        !presenceRes.error && presenceData?.can_view_presence
          ? presenceData
          : null;

      const collapsedRows = collapseVibeGameRowsForWeb(messages.map((msg) => ({
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
        otherUser: otherUser
          ? {
              ...otherUser,
              avatar_url: resolvePrimaryProfilePhotoPath({
                photos: otherUser.photos,
                avatar_url: otherUser.avatar_url,
              }),
              last_seen_at: presence?.last_seen_at ?? null,
              is_online: presence?.is_online ?? false,
            }
          : null,
        messages: collapsedRows.map((row) => {
          return {
            id: row.id,
            text: row.content,
            sender: row.sender_id === currentUserId ? ("me" as const) : ("them" as const),
            time: new Date(row.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            createdAt: row.created_at,
            readAt: row.read_at,
            audioUrl: row.audio_url || undefined,
            audioDuration: row.audio_duration_seconds || undefined,
            videoUrl: row.video_url || undefined,
            videoDuration: row.video_duration_seconds || undefined,
            messageKind: toRenderableMessageKind(row.message_kind) as Message["messageKind"],
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
    mutationFn: async ({
      matchId,
      content,
      clientRequestId,
    }: {
      matchId: string;
      content: string;
      clientRequestId?: string;
      invalidateScope?: ThreadInvalidateScope;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const body: Record<string, string> = {
        match_id: matchId,
        content: content.trim(),
      };
      if (clientRequestId?.trim()) {
        body.client_request_id = clientRequestId.trim();
      }

      const { data, error } = await supabase.functions.invoke("send-message", {
        body,
      });

      if (error) {
        captureSupabaseError("send-message", error);
        throw error;
      }

      const payload = data as { success?: boolean; message?: unknown; error?: string } | null | undefined;
      if (!payload?.success) {
        throw new Error(payload?.error || "Send failed");
      }
      return payload.message;
    },
    onSuccess: (_data, variables) => {
      invalidateAfterThreadMutation(queryClient, variables.invalidateScope);
    },
  });
};

/** Canonical server-owned publish for Vibe Clip video messages. */
export const usePublishVibeClip = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      matchId: string;
      videoUrl: string;
      durationMs: number;
      clientRequestId: string;
      thumbnailUrl?: string | null;
      aspectRatio?: number | null;
      invalidateScope?: ThreadInvalidateScope;
    }) => {
      const body: Record<string, unknown> = {
        match_id: params.matchId,
        message_kind: "vibe_clip",
        video_url: params.videoUrl,
        duration_ms: params.durationMs,
        client_request_id: params.clientRequestId,
      };
      if (params.thumbnailUrl) body.thumbnail_url = params.thumbnailUrl;
      if (typeof params.aspectRatio === "number" && Number.isFinite(params.aspectRatio) && params.aspectRatio > 0) {
        body.aspect_ratio = params.aspectRatio;
      }

      const { data, error } = await supabase.functions.invoke("send-message", { body });
      if (error) {
        captureSupabaseError("publish-vibe-clip", error);
        throw error;
      }
      const payload = data as { success?: boolean; message?: unknown; error?: string } | null;
      if (!payload?.success) throw new Error(payload?.error || "Vibe Clip publish failed");
      return payload.message;
    },
    onSuccess: (_data, variables) => {
      invalidateAfterThreadMutation(queryClient, variables.invalidateScope);
    },
  });
};

/** Canonical server-owned publish for voice messages (after upload-voice). */
export const usePublishVoiceMessage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      matchId: string;
      audioUrl: string;
      durationSeconds: number;
      clientRequestId: string;
      invalidateScope?: ThreadInvalidateScope;
    }) => {
      const body: Record<string, unknown> = {
        match_id: params.matchId,
        message_kind: "voice",
        audio_url: params.audioUrl,
        audio_duration_seconds: Math.round(params.durationSeconds),
        client_request_id: params.clientRequestId,
      };

      const { data, error } = await supabase.functions.invoke("send-message", { body });
      if (error) {
        captureSupabaseError("publish-voice-message", error);
        throw error;
      }
      const payload = data as { success?: boolean; message?: unknown; error?: string } | null;
      if (!payload?.success) throw new Error(payload?.error || "Voice message publish failed");
      return payload.message;
    },
    onSuccess: (_data, variables) => {
      invalidateAfterThreadMutation(queryClient, variables.invalidateScope);
    },
  });
};
