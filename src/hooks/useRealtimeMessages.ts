/**
 * Realtime thread invalidation. Incoming message sound is intentionally not wired here — see
 * `src/lib/chatIncomingSound.ts` for defer rationale and a future hook point.
 */
import { useEffect, useCallback, useRef, useState } from "react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSupabaseSessionReady } from "@/hooks/useRealtimeDateScheduleState";
import { threadMessagesQueryKey } from "../../shared/chat/queryKeys";
import {
  hydrateChatRowsForDisplay,
  type ChatRawMessageRow,
  type ChatThreadPage,
} from "@/hooks/useMessages";

interface UseRealtimeMessagesOptions {
  matchId: string | null;
  /** Partner profile id for this thread — required for scoped cache invalidation */
  threadOtherUserId: string | null | undefined;
  /** Current user id — required for scoped cache invalidation */
  threadCurrentUserId: string | null | undefined;
  enabled?: boolean;
}

export const useRealtimeMessages = ({
  matchId,
  threadOtherUserId,
  threadCurrentUserId,
  enabled = true,
}: UseRealtimeMessagesOptions) => {
  const queryClient = useQueryClient();
  const hasSession = useSupabaseSessionReady(threadCurrentUserId, enabled);
  const [retryNonce, setRetryNonce] = useState(0);
  const retryCountRef = useRef(0);

  const invalidateMessages = useCallback(() => {
    if (threadOtherUserId && threadCurrentUserId) {
      queryClient.invalidateQueries({
        queryKey: threadMessagesQueryKey(threadOtherUserId, threadCurrentUserId),
        exact: true,
      });
    }
    queryClient.invalidateQueries({ queryKey: ["matches"] });
    if (matchId) {
      queryClient.invalidateQueries({ queryKey: ["date-suggestions", matchId] });
    }
  }, [queryClient, matchId, threadOtherUserId, threadCurrentUserId]);

  const patchMessage = useCallback(
    (raw: unknown, event: "INSERT" | "UPDATE") => {
      if (!threadOtherUserId || !threadCurrentUserId) {
        invalidateMessages();
        return;
      }
      const row = normalizeRealtimeMessageRow(raw);
      if (!row) {
        invalidateMessages();
        return;
      }

      // Game rows are collapsed across multiple DB events, so a direct single-row patch can
      // leave stale presentation state. Keep those on the conservative refetch path.
      if (row.message_kind === "vibe_game") {
        invalidateMessages();
        return;
      }

      void hydrateChatRowsForDisplay([row], threadCurrentUserId)
        .then(([message]) => {
          if (!message) {
            invalidateMessages();
            return;
          }

          const queryKey = threadMessagesQueryKey(threadOtherUserId, threadCurrentUserId);
          let patched = false;
          queryClient.setQueryData<InfiniteData<ChatThreadPage>>(queryKey, (prev) => {
            if (!prev?.pages?.length) return prev;
            let foundExisting = false;
            const pages = prev.pages.map((page, index) => {
              const existingIndex = page.messages.findIndex((m) => m.id === message.id);
              if (existingIndex >= 0) {
                foundExisting = true;
                patched = true;
                const messages = [...page.messages];
                messages[existingIndex] = message;
                return { ...page, messages };
              }
              if (event === "INSERT" && index === 0) {
                patched = true;
                return {
                  ...page,
                  messages: [...page.messages, message].sort(
                    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
                  ),
                };
              }
              return page;
            });

            if (event === "UPDATE" && !foundExisting) return prev;
            return { ...prev, pages };
          });

          if (!patched) invalidateMessages();
        })
        .catch(() => invalidateMessages());

      queryClient.invalidateQueries({ queryKey: ["matches"] });
      if (
        matchId &&
        (row.message_kind === "date_suggestion" || row.message_kind === "date_suggestion_event")
      ) {
        queryClient.invalidateQueries({ queryKey: ["date-suggestions", matchId] });
      }
    },
    [invalidateMessages, matchId, queryClient, threadCurrentUserId, threadOtherUserId],
  );

  useEffect(() => {
    if (!matchId || !enabled || !threadCurrentUserId || !hasSession) return;

    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryAttempted = false;

    // Subscribe to new messages for this match
    const channel = supabase
      .channel(`messages:${matchId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `match_id=eq.${matchId}`
        },
        (payload) => {
          patchMessage(payload.new, "INSERT");
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `match_id=eq.${matchId}`
        },
        (payload) => {
          patchMessage(payload.new, "UPDATE");
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          retryAttempted = false;
          retryCountRef.current = 0;
          return;
        }
        if (status === "CHANNEL_ERROR") {
          invalidateMessages();
          if (import.meta.env.DEV) {
            console.warn("[useRealtimeMessages] channel error", { matchId });
          }
          if (!retryAttempted && retryCountRef.current < 2) {
            retryAttempted = true;
            retryCountRef.current += 1;
            retryTimer = setTimeout(() => setRetryNonce((value) => value + 1), 1500);
          }
        }
      });

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      supabase.removeChannel(channel);
    };
  }, [matchId, enabled, hasSession, invalidateMessages, patchMessage, retryNonce, threadCurrentUserId]);

  return { invalidateMessages };
};

function normalizeRealtimeMessageRow(raw: unknown): ChatRawMessageRow | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Partial<ChatRawMessageRow>;
  if (typeof row.id !== "string" || !row.id) return null;
  if (typeof row.match_id !== "string" || !row.match_id) return null;
  if (typeof row.sender_id !== "string" || !row.sender_id) return null;
  return {
    id: row.id,
    match_id: row.match_id,
    sender_id: row.sender_id,
    content: typeof row.content === "string" ? row.content : "",
    created_at: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
    read_at: typeof row.read_at === "string" ? row.read_at : null,
    audio_url: typeof row.audio_url === "string" ? row.audio_url : null,
    audio_duration_seconds:
      typeof row.audio_duration_seconds === "number" ? row.audio_duration_seconds : null,
    video_url: typeof row.video_url === "string" ? row.video_url : null,
    video_duration_seconds:
      typeof row.video_duration_seconds === "number" ? row.video_duration_seconds : null,
    message_kind: typeof row.message_kind === "string" ? row.message_kind : "text",
    ref_id: typeof row.ref_id === "string" ? row.ref_id : null,
    structured_payload:
      row.structured_payload && typeof row.structured_payload === "object" && !Array.isArray(row.structured_payload)
        ? row.structured_payload as Record<string, unknown>
        : null,
  };
}
