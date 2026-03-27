import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { MessageReactionRow } from '../../../shared/chat/messageReactionModel';

export function useMessageReactions(matchId: string | null | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['message-reactions', matchId],
    queryFn: async (): Promise<MessageReactionRow[]> => {
      if (!matchId) return [];
      const { data, error } = await supabase
        .from('message_reactions')
        .select('message_id, profile_id, emoji')
        .eq('match_id', matchId);
      if (error) throw error;
      return (data ?? []) as MessageReactionRow[];
    },
    enabled: !!matchId,
  });

  useEffect(() => {
    if (!matchId) return;
    const channel = supabase
      .channel(`message-reactions-${matchId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'message_reactions',
          filter: `match_id=eq.${matchId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['message-reactions', matchId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [matchId, queryClient]);

  return query;
}
