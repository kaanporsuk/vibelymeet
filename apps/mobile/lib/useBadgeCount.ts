/**
 * App badge count (iOS/Android) — unread messages + unviewed daily drops for today.
 * Sets OneSignal badge and refetches when app comes to foreground.
 */
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { DAILY_DROP_ACTIONABLE_STATUSES } from '@/lib/dailyDropSchedule';

let OneSignal: any = null;
try {
  OneSignal = require('react-native-onesignal').OneSignal ?? require('react-native-onesignal').default;
} catch {}

export function useBadgeCount(): number {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: badgeCount = 0 } = useQuery({
    queryKey: ['badge-count', user?.id],
    queryFn: async () => {
      if (!user?.id) return 0;

      // Count unread messages (received by me, not yet read)
      const { count: unreadMessages } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .neq('sender_id', user.id)
        .is('read_at', null);

      // Unviewed actionable drops (same rule as Daily Drop tab badge; no local calendar / hour gate)
      const nowIso = new Date().toISOString();
      const actionable = [...DAILY_DROP_ACTIONABLE_STATUSES];
      const { count: countA } = await supabase
        .from('daily_drops')
        .select('id', { count: 'exact', head: true })
        .eq('user_a_id', user.id)
        .gt('expires_at', nowIso)
        .in('status', actionable)
        .or('user_a_viewed.is.null,user_a_viewed.eq.false');
      const { count: countB } = await supabase
        .from('daily_drops')
        .select('id', { count: 'exact', head: true })
        .eq('user_b_id', user.id)
        .gt('expires_at', nowIso)
        .in('status', actionable)
        .or('user_b_viewed.is.null,user_b_viewed.eq.false');

      const unviewedDrops = (countA ?? 0) + (countB ?? 0);
      return (unreadMessages ?? 0) + unviewedDrops;
    },
    enabled: !!user?.id,
    refetchInterval: 30000, // refresh every 30s
  });

  // Set the app badge via OneSignal
  useEffect(() => {
    if (OneSignal?.Notifications) {
      try {
        OneSignal.Notifications.setBadgeCount(badgeCount);
      } catch {}
    }
  }, [badgeCount]);

  // Refetch badge when app comes to foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        queryClient.invalidateQueries({ queryKey: ['badge-count'] });
        queryClient.invalidateQueries({ queryKey: ['unread-message-count'] });
      }
    });
    return () => sub.remove();
  }, [queryClient]);

  return badgeCount;
}
