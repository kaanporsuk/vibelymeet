import { useQuery } from '@tanstack/react-query';
import { AppState } from 'react-native';
import { supabase } from '@/lib/supabase';
import { DAILY_DROP_ACTIONABLE_STATUSES } from '@/lib/dailyDropSchedule';

export const dailyDropTabBadgeQueryKey = (userId: string | null | undefined) =>
  ['daily-drop-tab-badge', userId] as const;

/** Matches tab dot: unviewed actionable Daily Drop (active_*, not expired). */
export async function fetchDailyDropTabBadge(userId: string): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('daily_drops')
    .select('id, user_a_id, user_a_viewed, user_b_viewed, expires_at, status')
    .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
    .gt('expires_at', nowIso)
    .in('status', [...DAILY_DROP_ACTIONABLE_STATUSES])
    .order('drop_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return false;
  const isA = data.user_a_id === userId;
  const viewed = isA ? data.user_a_viewed : data.user_b_viewed;
  return !viewed;
}

export function useDailyDropTabBadge(userId: string | null | undefined): boolean {
  const { data = false } = useQuery({
    queryKey: dailyDropTabBadgeQueryKey(userId),
    enabled: !!userId,
    queryFn: () => fetchDailyDropTabBadge(userId!),
    refetchInterval: () => (AppState.currentState === 'active' ? 60_000 : false),
    refetchIntervalInBackground: false,
  });

  return data;
}
