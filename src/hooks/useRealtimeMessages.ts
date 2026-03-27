import { useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface UseRealtimeMessagesOptions {
  matchId: string | null;
  enabled?: boolean;
}

export const useRealtimeMessages = ({ matchId, enabled = true }: UseRealtimeMessagesOptions) => {
  const queryClient = useQueryClient();

  const invalidateMessages = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["messages"] });
    queryClient.invalidateQueries({ queryKey: ["matches"] });
    queryClient.invalidateQueries({ queryKey: ["date-suggestions"] });
  }, [queryClient]);

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
