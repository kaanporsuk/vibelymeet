/**
 * Block user through the server-owned safety RPC. Cleanup is transactional in Postgres.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type BlockedUser = {
  id: string;
  blocker_id: string;
  blocked_id: string;
  reason: string | null;
  created_at: string;
  display_name: string | null;
  avatar_url: string | null;
  photo_url: string | null;
};

type BlockRpcResult = {
  success?: boolean;
  code?: string;
  error?: string;
};

export function useBlockUser(userId: string | null | undefined) {
  const queryClient = useQueryClient();

  const invalidateBlockEffects = () => {
    queryClient.invalidateQueries({ queryKey: ['blocked-users'] });
    queryClient.invalidateQueries({ queryKey: ['matches'] });
    queryClient.invalidateQueries({ queryKey: ['messages'] });
    queryClient.invalidateQueries({ queryKey: ['match-mutes'] });
    queryClient.invalidateQueries({ queryKey: ['daily-drop'] });
    queryClient.invalidateQueries({ queryKey: ['daily-drops'] });
    queryClient.invalidateQueries({ queryKey: ['date-suggestions'] });
    queryClient.invalidateQueries({ queryKey: ['event-vibes-received'] });
    queryClient.invalidateQueries({ queryKey: ['event-vibes-sent'] });
  };

  const blockedUsersQuery = useQuery({
    queryKey: ['blocked-users', userId],
    queryFn: async (): Promise<BlockedUser[]> => {
      if (!userId) return [];
      const { data, error } = await supabase.rpc('get_my_blocked_users');
      if (error) throw error;
      return (data || []) as BlockedUser[];
    },
    enabled: !!userId,
  });
  const {
    data: blockedUsers = [],
    error: blockedUsersError,
    isLoading: isBlockedUsersLoading,
    isRefetching: isBlockedUsersRefetching,
    refetch: refetchBlockedUsers,
  } = blockedUsersQuery;

  const blockMutation = useMutation({
    mutationFn: async ({ blockedId, matchId, reason }: { blockedId: string; matchId?: string; reason?: string }) => {
      if (!userId) throw new Error('Not authenticated');

      const { data, error } = await supabase.rpc('block_user_with_cleanup', {
        p_blocked_id: blockedId,
        p_match_id: matchId ?? null,
        p_reason: reason ?? null,
      });
      if (error) throw error;

      const result = data as BlockRpcResult | null;
      if (result?.success === false) {
        throw new Error(result.error || result.code || 'Block failed');
      }
      return { blockedId };
    },
    onSuccess: invalidateBlockEffects,
  });

  const unblockMutation = useMutation({
    mutationFn: async ({ blockedId }: { blockedId: string }) => {
      if (!userId) throw new Error('Not authenticated');
      const { data, error } = await supabase.rpc('unblock_user', { p_blocked_id: blockedId });
      if (error) throw error;
      const result = data as BlockRpcResult | null;
      if (result?.success === false) {
        throw new Error(result.error || result.code || 'Unblock failed');
      }
    },
    onSuccess: invalidateBlockEffects,
  });

  const isUserBlocked = (targetUserId: string) => blockedUsers.some((b) => b.blocked_id === targetUserId);

  return {
    blockUser: blockMutation.mutateAsync,
    unblockUser: unblockMutation.mutateAsync,
    isUserBlocked,
    blockedUsers,
    blockedUsersError,
    isBlockedUsersLoading,
    isBlockedUsersRefetching,
    refetchBlockedUsers,
    isBlocking: blockMutation.isPending,
    isUnblocking: unblockMutation.isPending,
  };
}
