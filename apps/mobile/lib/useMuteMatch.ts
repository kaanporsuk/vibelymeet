/**
 * Mute match notifications — match_mutes + match_notification_mutes. Parity with web useMuteMatch.
 */
import { addHours, addDays, addWeeks } from 'date-fns';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type MuteDuration = '1hour' | '1day' | '1week' | 'forever';

export type MatchMute = {
  id: string;
  match_id: string;
  user_id: string;
  muted_until: string;
  created_at: string;
};

function getMutedUntilDate(duration: MuteDuration): Date {
  const now = new Date();
  switch (duration) {
    case '1hour':
      return addHours(now, 1);
    case '1day':
      return addDays(now, 1);
    case '1week':
      return addWeeks(now, 1);
    case 'forever':
      return new Date(9999, 11, 31, 23, 59, 59);
    default:
      return addDays(now, 1);
  }
}

export function getMuteDurationLabel(duration: MuteDuration): string {
  switch (duration) {
    case '1hour':
      return '1 hour';
    case '1day':
      return '1 day';
    case '1week':
      return '1 week';
    case 'forever':
      return 'indefinitely';
    default:
      return '1 day';
  }
}

export function useMuteMatch(userId: string | null | undefined) {
  const queryClient = useQueryClient();

  const { data: mutes = [] } = useQuery({
    queryKey: ['match-mutes', userId],
    queryFn: async (): Promise<MatchMute[]> => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from('match_mutes')
        .select('*')
        .eq('user_id', userId)
        .gt('muted_until', new Date().toISOString());
      if (error) throw error;
      return (data || []) as MatchMute[];
    },
    enabled: !!userId,
  });

  const muteMutation = useMutation({
    mutationFn: async ({ matchId, duration }: { matchId: string; duration: MuteDuration }) => {
      if (!userId) throw new Error('Not authenticated');
      const mutedUntil = getMutedUntilDate(duration).toISOString();

      const { error } = await supabase.from('match_mutes').upsert(
        { match_id: matchId, user_id: userId, muted_until: mutedUntil },
        { onConflict: 'match_id,user_id' }
      );

      if (error) {
        await supabase.from('match_mutes').delete().eq('match_id', matchId).eq('user_id', userId);
        const { error: insertError } = await supabase.from('match_mutes').insert({
          match_id: matchId,
          user_id: userId,
          muted_until: mutedUntil,
        });
        if (insertError) throw insertError;
      }

      const { error: muteError } = await supabase.from('match_notification_mutes').upsert(
        { match_id: matchId, user_id: userId, muted_until: mutedUntil },
        { onConflict: 'match_id,user_id' }
      );
      if (muteError && __DEV__) console.warn('[useMuteMatch] mute upsert failed:', muteError.message);
      return { duration };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['match-mutes'] });
    },
  });

  const unmuteMutation = useMutation({
    mutationFn: async ({ matchId }: { matchId: string }) => {
      if (!userId) throw new Error('Not authenticated');
      const { error } = await supabase.from('match_mutes').delete().eq('match_id', matchId).eq('user_id', userId);
      if (error) throw error;
      const { error: notifMuteError } = await supabase
        .from('match_notification_mutes')
        .delete()
        .eq('match_id', matchId)
        .eq('user_id', userId);
      if (notifMuteError && __DEV__) {
        console.warn('[useMuteMatch] notification mute delete failed:', notifMuteError.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['match-mutes'] });
    },
  });

  const isMatchMuted = (matchId: string) => mutes.some((m) => m.match_id === matchId);

  return {
    muteMatch: muteMutation.mutateAsync,
    unmuteMatch: unmuteMutation.mutateAsync,
    isMatchMuted,
    mutes,
    isMuting: muteMutation.isPending,
    isUnmuting: unmuteMutation.isPending,
  };
}
