/**
 * Archive / unarchive match through the server-owned per-user archive contract.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

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

export function useArchiveMatch(userId: string | null | undefined) {
  const queryClient = useQueryClient();

  const archiveMutation = useMutation({
    mutationFn: async ({ matchId }: { matchId: string }) => {
      if (!userId) throw new Error('Not authenticated');
      const { data, error } = await supabase.rpc('set_match_archive_state', {
        p_match_id: matchId,
        p_archived: true,
      });
      if (error) throw error;
      assertMatchActionSucceeded(data, 'Failed to archive match');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['matches'] });
      queryClient.invalidateQueries({ queryKey: ['unread-home'] });
      queryClient.invalidateQueries({ queryKey: ['unread-home-info-bar'] });
    },
  });

  const unarchiveMutation = useMutation({
    mutationFn: async ({ matchId }: { matchId: string }) => {
      if (!userId) throw new Error('Not authenticated');
      const { data, error } = await supabase.rpc('set_match_archive_state', {
        p_match_id: matchId,
        p_archived: false,
      });
      if (error) throw error;
      assertMatchActionSucceeded(data, 'Failed to unarchive match');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['matches'] });
      queryClient.invalidateQueries({ queryKey: ['unread-home'] });
      queryClient.invalidateQueries({ queryKey: ['unread-home-info-bar'] });
    },
  });

  return {
    archiveMatch: archiveMutation.mutateAsync,
    unarchiveMatch: unarchiveMutation.mutateAsync,
    isArchiving: archiveMutation.isPending,
    isUnarchiving: unarchiveMutation.isPending,
  };
}
