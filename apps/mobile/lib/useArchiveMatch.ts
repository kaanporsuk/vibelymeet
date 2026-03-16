/**
 * Archive / unarchive match — update matches.archived_at. Parity with web useArchiveMatch.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function useArchiveMatch(userId: string | null | undefined) {
  const queryClient = useQueryClient();

  const archiveMutation = useMutation({
    mutationFn: async ({ matchId }: { matchId: string }) => {
      if (!userId) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('matches')
        .update({ archived_at: new Date().toISOString(), archived_by: userId })
        .eq('id', matchId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['matches'] });
    },
  });

  const unarchiveMutation = useMutation({
    mutationFn: async ({ matchId }: { matchId: string }) => {
      const { error } = await supabase.from('matches').update({ archived_at: null, archived_by: null }).eq('id', matchId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['matches'] });
    },
  });

  return {
    archiveMatch: archiveMutation.mutateAsync,
    unarchiveMatch: unarchiveMutation.mutateAsync,
    isArchiving: archiveMutation.isPending,
    isUnarchiving: unarchiveMutation.isPending,
  };
}
