/**
 * Block user — insert blocked_users; optionally remove messages/mutes/match. Parity with web useBlockUser.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type BlockedUser = {
  id: string;
  blocker_id: string;
  blocked_id: string;
  reason: string | null;
  created_at: string;
};

export function useBlockUser(userId: string | null | undefined) {
  const queryClient = useQueryClient();

  const { data: blockedUsers = [], isLoading: isBlockedUsersLoading } = useQuery({
    queryKey: ['blocked-users', userId],
    queryFn: async (): Promise<BlockedUser[]> => {
      if (!userId) return [];
      const { data, error } = await supabase.from('blocked_users').select('*').eq('blocker_id', userId);
      if (error) throw error;
      return (data || []) as BlockedUser[];
    },
    enabled: !!userId,
  });

  const blockMutation = useMutation({
    mutationFn: async ({ blockedId, matchId, reason }: { blockedId: string; matchId?: string; reason?: string }) => {
      if (!userId) throw new Error('Not authenticated');

      const { error: blockError } = await supabase.from('blocked_users').insert({
        blocker_id: userId,
        blocked_id: blockedId,
        reason: reason || null,
      });
      if (blockError && blockError.code !== '23505') {
        throw blockError;
      }

      if (matchId) {
        const { error: msgErr } = await supabase.from('messages').delete().eq('match_id', matchId);
        if (msgErr) throw msgErr;

        const { error: mnmErr } = await supabase.from('match_notification_mutes').delete().eq('match_id', matchId).eq('user_id', userId);
        if (mnmErr) throw mnmErr;

        const { error: matchErr } = await supabase.from('matches').delete().eq('id', matchId);
        if (matchErr) throw matchErr;
      }
      return { blockedId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blocked-users'] });
      queryClient.invalidateQueries({ queryKey: ['matches'] });
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });

  const unblockMutation = useMutation({
    mutationFn: async ({ blockedId }: { blockedId: string }) => {
      if (!userId) throw new Error('Not authenticated');
      const { error } = await supabase.from('blocked_users').delete().eq('blocker_id', userId).eq('blocked_id', blockedId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blocked-users'] });
    },
  });

  const isUserBlocked = (targetUserId: string) => blockedUsers.some((b) => b.blocked_id === targetUserId);

  return {
    blockUser: blockMutation.mutateAsync,
    unblockUser: unblockMutation.mutateAsync,
    isUserBlocked,
    blockedUsers,
    isBlockedUsersLoading,
    isBlocking: blockMutation.isPending,
    isUnblocking: unblockMutation.isPending,
  };
}
