/**
 * Unmatch — delete messages, date_proposals, match. Parity with web useUnmatch.
 * useUndoableUnmatch: show snackbar with Undo for 5s before executing.
 */
import { useRef, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function useUnmatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ matchId }: { matchId: string }) => {
      const { error: messagesError } = await supabase.from('messages').delete().eq('match_id', matchId);
      if (messagesError) throw messagesError;

      const { error: dateProposalsError } = await supabase.from('date_proposals').delete().eq('match_id', matchId);
      if (dateProposalsError) throw dateProposalsError;

      const { error: matchError } = await supabase.from('matches').delete().eq('id', matchId);
      if (matchError) throw matchError;

      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['matches'] });
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });
}

export type UndoableUnmatchOptions = {
  onUnmatchComplete?: () => void;
  onUndo?: () => void;
};

export function useUndoableUnmatch(options?: UndoableUnmatchOptions) {
  const queryClient = useQueryClient();
  const pendingRef = useRef<{ matchId: string; timeoutId: ReturnType<typeof setTimeout> } | null>(null);

  const performUnmatch = useCallback(
    async (matchId: string) => {
      try {
        const { error: messagesError } = await supabase.from('messages').delete().eq('match_id', matchId);
        if (messagesError) throw messagesError;
        const { error: dateProposalsError } = await supabase.from('date_proposals').delete().eq('match_id', matchId);
        if (dateProposalsError) throw dateProposalsError;
        const { error: matchError } = await supabase.from('matches').delete().eq('id', matchId);
        if (matchError) throw matchError;
        queryClient.invalidateQueries({ queryKey: ['matches'] });
        queryClient.invalidateQueries({ queryKey: ['messages'] });
        options?.onUnmatchComplete?.();
      } catch (e) {
        console.error('Unmatch error:', e);
      }
    },
    [queryClient, options]
  );

  const cancelPending = useCallback(() => {
    if (pendingRef.current) {
      clearTimeout(pendingRef.current.timeoutId);
      pendingRef.current = null;
    }
    queryClient.invalidateQueries({ queryKey: ['matches'] });
    options?.onUndo?.();
  }, [queryClient, options]);

  const initiateUnmatch = useCallback(
    (matchId: string) => {
      if (pendingRef.current) {
        clearTimeout(pendingRef.current.timeoutId);
      }
      const timeoutId = setTimeout(() => {
        performUnmatch(matchId);
        pendingRef.current = null;
      }, 5000);
      pendingRef.current = { matchId, timeoutId };
    },
    [performUnmatch]
  );

  return { initiateUnmatch, cancelPending, hasPendingUnmatch: () => pendingRef.current !== null };
}
