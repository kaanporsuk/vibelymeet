/**
 * Realtime thread invalidation. Incoming message sound is intentionally not wired here — see
 * `src/lib/chatIncomingSound.ts` for defer rationale and a future hook point.
 */
import { useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { threadMessagesQueryKey } from "../../shared/chat/queryKeys";

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

  useEffect(() => {
    if (!matchId || !enabled) return;

    // Subscribe to new messages for this match
    const channel = supabase
      .channel(`messages-${matchId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `match_id=eq.${matchId}`
        },
        (_payload) => {
          invalidateMessages();
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
        (_payload) => {
          invalidateMessages();
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.error('[useRealtimeMessages] channel error for match', matchId);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [matchId, enabled, invalidateMessages]);

  return { invalidateMessages };
};
