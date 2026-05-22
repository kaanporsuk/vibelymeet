import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { myProfileQueryKey, profileLiveCountsQueryKey } from '@/lib/profileApi';
import { supabase } from '@/lib/supabase';

/** Keeps native profile counters fresh from the source tables that maintain the profile read model. */
export function useProfileCountsRealtime(userId: string | null | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    const invalidateProfileCounters = () => {
      queryClient.invalidateQueries({ queryKey: profileLiveCountsQueryKey(userId) });
      queryClient.invalidateQueries({ queryKey: myProfileQueryKey(userId) });
    };

    const channel = supabase
      .channel(`profile-counts-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'event_registrations', filter: `profile_id=eq.${userId}` },
        invalidateProfileCounters
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
        invalidateProfileCounters
      );

    for (const filter of [`profile_id_1=eq.${userId}`, `profile_id_2=eq.${userId}`]) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches', filter },
        invalidateProfileCounters
      );
    }

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, userId]);
}
