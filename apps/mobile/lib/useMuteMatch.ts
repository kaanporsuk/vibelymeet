/**
 * Mute match notifications through the canonical server-owned RPCs.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
  getMatchMuteDurationLabel,
  type MatchMuteDuration,
} from '../../../shared/chat/matchMuteDurations';

export type MuteDuration = MatchMuteDuration;

export type MatchMute = {
  id: string;
  match_id: string;
  user_id: string;
  muted_until: string | null;
  created_at: string | null;
};

export function getMuteDurationLabel(duration: MuteDuration): string {
  return getMatchMuteDurationLabel(duration);
}

type MatchActionRpcResult = {
  success?: boolean;
  code?: string;
  error?: string;
};

function assertMatchActionSucceeded(result: unknown, fallback: string) {
  const payload = result as MatchActionRpcResult | null;
  if (!payload?.success) {
    throw new Error(payload?.error || payload?.code || fallback);
  }
}

export function useMuteMatch(userId: string | null | undefined) {
  const queryClient = useQueryClient();

  const { data: mutes = [] } = useQuery({
    queryKey: ['match-mutes', userId],
    queryFn: async (): Promise<MatchMute[]> => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from('match_notification_mutes')
        .select('*')
        .eq('user_id', userId)
        .or(`muted_until.is.null,muted_until.gt.${new Date().toISOString()}`);
      if (error) throw error;
      return (data || []) as MatchMute[];
    },
    enabled: !!userId,
  });

  const muteMutation = useMutation({
    mutationFn: async ({ matchId, duration }: { matchId: string; duration: MuteDuration }) => {
      if (!userId) throw new Error('Not authenticated');
      const { data, error } = await supabase.rpc('set_match_notification_mute', {
        p_match_id: matchId,
        p_duration: duration,
      });
      if (error) throw error;
      assertMatchActionSucceeded(data, 'Failed to mute notifications');
      return { duration };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['match-mutes'] });
    },
  });

  const unmuteMutation = useMutation({
    mutationFn: async ({ matchId }: { matchId: string }) => {
      if (!userId) throw new Error('Not authenticated');
      const { data, error } = await supabase.rpc('clear_match_notification_mute', {
        p_match_id: matchId,
      });
      if (error) throw error;
      assertMatchActionSucceeded(data, 'Failed to unmute notifications');
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
