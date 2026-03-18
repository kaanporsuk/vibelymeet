/**
 * All date proposals for the current user — schedule screen (upcoming, pending, past).
 */
import { useQuery } from '@tanstack/react-query';
import { startOfDay } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { getTimeBlockLabel, type TimeBlock } from '@/lib/dateProposalsApi';

export type ScheduleProposalItem = {
  id: string;
  date: Date;
  mode: 'video' | 'in-person';
  timeBlock: string;
  timeBlockLabel: string;
  status: string;
  matchId: string;
  partnerName: string;
  isIncoming: boolean;
};

function mapActivity(activity: string): 'video' | 'in-person' {
  const a = (activity || '').toLowerCase();
  if (a === 'video' || a === 'virtual') return 'video';
  return 'in-person';
}

export function useScheduleProposals(userId: string | null | undefined) {
  return useQuery({
    queryKey: ['schedule-proposals-full', userId],
    enabled: !!userId,
    queryFn: async (): Promise<ScheduleProposalItem[]> => {
      if (!userId) return [];
      const { data: rows, error } = await supabase
        .from('date_proposals')
        .select('id, proposed_date, time_block, activity, status, proposer_id, recipient_id, match_id')
        .or(`proposer_id.eq.${userId},recipient_id.eq.${userId}`)
        .order('proposed_date', { ascending: false })
        .limit(100);
      if (error) throw error;
      const list = rows ?? [];
      const ids = [...new Set(list.map((r) => (r.recipient_id === userId ? r.proposer_id : r.recipient_id)))];
      const names: Record<string, string> = {};
      if (ids.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id, name').in('id', ids);
        if (profiles) {
          for (const p of profiles as { id: string; name?: string }[]) {
            names[p.id] = p.name ?? 'Your match';
          }
        }
      }
      return list.map((r) => {
        const otherId = r.recipient_id === userId ? r.proposer_id : r.recipient_id;
        const tb = (r.time_block || 'evening') as TimeBlock;
        return {
          id: r.id,
          date: new Date(r.proposed_date),
          mode: mapActivity(String(r.activity ?? '')),
          timeBlock: r.time_block ?? '',
          timeBlockLabel: getTimeBlockLabel(tb),
          status: r.status,
          matchId: r.match_id,
          partnerName: names[otherId] ?? 'Your match',
          isIncoming: r.recipient_id === userId && r.proposer_id !== userId,
        };
      });
    },
  });
}

export function partitionScheduleProposals(items: ScheduleProposalItem[], now = new Date()) {
  const today = startOfDay(now);
  const pending = items.filter((p) => p.status === 'pending');
  const upcomingAccepted = items.filter((p) => p.status === 'accepted' && p.date >= today);
  const past = items.filter(
    (p) => p.status === 'declined' || (p.status === 'accepted' && p.date < today),
  );
  return { pending, upcomingAccepted, past };
}

/** Map schedule accepted-upcoming rows to DateProposal shape for useDateReminders. */
export function toDateProposalsForReminders(upcoming: ScheduleProposalItem[]) {
  return upcoming.map((p) => ({
    id: p.id,
    date: p.date,
    mode: p.mode,
    status: 'accepted' as const,
    senderName: p.partnerName,
    matchId: p.matchId,
  }));
}
