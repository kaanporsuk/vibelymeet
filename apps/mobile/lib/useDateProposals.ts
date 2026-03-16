/**
 * Fetches accepted date proposals for the current user (parity with web schedule/reminders source).
 * Used by dashboard date reminders; does not create or respond to proposals.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type DateProposalRow = {
  id: string;
  proposed_date: string;
  time_block: string;
  activity: string;
  status: string;
  proposer_id: string;
  recipient_id: string;
  match_id: string;
};

export type DateProposal = {
  id: string;
  date: Date;
  mode: 'video' | 'in-person';
  status: 'pending' | 'accepted' | 'declined';
  senderName?: string;
  senderAvatar?: string;
  matchId?: string;
};

function mapActivity(activity: string): 'video' | 'in-person' {
  const a = (activity || '').toLowerCase();
  if (a === 'video' || a === 'virtual') return 'video';
  return 'in-person';
}

export function useDateProposals(userId: string | null | undefined) {
  return useQuery({
    queryKey: ['date-proposals', userId],
    enabled: !!userId,
    queryFn: async (): Promise<DateProposal[]> => {
      if (!userId) return [];
      const now = new Date().toISOString();
      const { data: rows, error } = await supabase
        .from('date_proposals')
        .select('id, proposed_date, time_block, activity, status, proposer_id, recipient_id, match_id')
        .or(`proposer_id.eq.${userId},recipient_id.eq.${userId}`)
        .eq('status', 'accepted')
        .gt('proposed_date', now)
        .order('proposed_date', { ascending: true });

      if (error) throw error;
      const list = (rows ?? []) as DateProposalRow[];
      const ids = [...new Set(list.map((r) => (r.recipient_id === userId ? r.proposer_id : r.recipient_id)))];
      let names: Record<string, string> = {};
      let avatars: Record<string, string> = {};
      if (ids.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, name, avatar_url')
          .in('id', ids);
        if (profiles) {
          for (const p of profiles as { id: string; name?: string; avatar_url?: string }[]) {
            names[p.id] = p.name ?? 'Your match';
            avatars[p.id] = p.avatar_url ?? '';
          }
        }
      }
      return list.map((r) => {
        const otherId = r.recipient_id === userId ? r.proposer_id : r.recipient_id;
        return {
          id: r.id,
          date: new Date(r.proposed_date),
          mode: mapActivity(r.activity),
          status: r.status as DateProposal['status'],
          senderName: names[otherId],
          senderAvatar: avatars[otherId] || undefined,
          matchId: r.match_id,
        };
      });
    },
  });
}
