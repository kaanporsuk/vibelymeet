import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { DAILY_DROP_ACTIONABLE_STATUSES } from '@/lib/dailyDropSchedule';

/** Matches tab dot: unviewed actionable Daily Drop (active_*, not expired). */
export function useDailyDropTabBadge(userId: string | null | undefined): boolean {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!userId) {
      setShow(false);
      return;
    }
    let cancelled = false;
    const check = async () => {
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

      if (cancelled) return;
      if (error || !data) {
        setShow(false);
        return;
      }
      const isA = data.user_a_id === userId;
      const viewed = isA ? data.user_a_viewed : data.user_b_viewed;
      setShow(!viewed);
    };
    check();
    const t = setInterval(check, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [userId]);

  return show;
}
