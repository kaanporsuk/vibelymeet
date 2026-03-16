/**
 * Date proposals for chat — create and list. Parity with web date_proposals table.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type TimeBlock = 'morning' | 'afternoon' | 'evening' | 'night';

export type DateProposalRow = {
  id: string;
  match_id: string;
  proposer_id: string;
  recipient_id: string;
  proposed_date: string;
  time_block: string;
  activity: string;
  status: string;
  created_at: string;
  responded_at: string | null;
};

const TIME_BLOCK_LABELS: Record<TimeBlock, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  night: 'Night',
};

export function getTimeBlockLabel(block: TimeBlock): string {
  return TIME_BLOCK_LABELS[block] ?? block;
}

export function useDateProposals(matchId: string | null, currentUserId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['date-proposals', matchId, currentUserId],
    queryFn: async (): Promise<DateProposalRow[]> => {
      if (!matchId || !currentUserId) return [];
      const { data, error } = await supabase
        .from('date_proposals')
        .select('id, match_id, proposer_id, recipient_id, proposed_date, time_block, activity, status, created_at, responded_at')
        .eq('match_id', matchId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as DateProposalRow[];
    },
    enabled: !!matchId && !!currentUserId && enabled,
  });
}

export function useCreateDateProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      matchId,
      proposerId,
      recipientId,
      proposedDate,
      timeBlock,
      activity,
    }: {
      matchId: string;
      proposerId: string;
      recipientId: string;
      proposedDate: string;
      timeBlock: TimeBlock;
      activity: string;
    }) => {
      const { data, error } = await supabase
        .from('date_proposals')
        .insert({
          match_id: matchId,
          proposer_id: proposerId,
          recipient_id: recipientId,
          proposed_date: proposedDate,
          time_block: timeBlock,
          activity: activity.trim() || "Let's vibe! 💜",
          status: 'pending',
        })
        .select('id')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ['date-proposals', v.matchId] });
      qc.invalidateQueries({ queryKey: ['messages'] });
    },
  });
}
