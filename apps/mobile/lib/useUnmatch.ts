/**
 * Unmatch — delete messages, date_proposals, match. Parity with web useUnmatch.
 * useUndoableUnmatch: show snackbar with Undo for 5s before executing.
 */
import { useRef, useCallback, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

async function deleteMatchCascade(matchId: string) {
  const { error: messagesError } = await supabase.from('messages').delete().eq('match_id', matchId);
  if (messagesError) throw messagesError;
  const { error: dateProposalsError } = await supabase.from('date_proposals').delete().eq('match_id', matchId);
  if (dateProposalsError) throw dateProposalsError;
  const { error: notifMutesError } = await supabase.from('match_notification_mutes').delete().eq('match_id', matchId);
  if (notifMutesError) throw notifMutesError;
  const { error: matchMutesError } = await supabase.from('match_mutes').delete().eq('match_id', matchId);
  if (matchMutesError && __DEV__) console.warn('[useUnmatch] legacy match_mutes delete failed:', matchMutesError.message);
  const { error: matchError } = await supabase.from('matches').delete().eq('id', matchId);
  if (matchError) throw matchError;
  return { success: true };
}

export function useUnmatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ matchId }: { matchId: string }) => deleteMatchCascade(matchId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['matches'] });
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      queryClient.invalidateQueries({ queryKey: ['date-proposals'] });
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
  const [hasPendingUnmatch, setHasPendingUnmatch] = useState(false);

  useEffect(() => {
    return () => {
      if (pendingRef.current) {
        clearTimeout(pendingRef.current.timeoutId);
        pendingRef.current = null;
      }
    };
  }, []);

  const performUnmatch = useCallback(
    async (matchId: string) => {
      try {
        await deleteMatchCascade(matchId);
        queryClient.invalidateQueries({ queryKey: ['matches'] });
        queryClient.invalidateQueries({ queryKey: ['messages'] });
        queryClient.invalidateQueries({ queryKey: ['date-proposals'] });
        options?.onUnmatchComplete?.();
      } catch (err) {
        if (__DEV__) console.warn('[useUndoableUnmatch] unmatch failed:', err);
      }
    },
    [queryClient, options]
  );

  const cancelPending = useCallback(() => {
    if (pendingRef.current) {
      clearTimeout(pendingRef.current.timeoutId);
      pendingRef.current = null;
    }
    setHasPendingUnmatch(false);
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
        setHasPendingUnmatch(false);
      }, 5000);
      pendingRef.current = { matchId, timeoutId };
      setHasPendingUnmatch(true);
    },
    [performUnmatch]
  );

  return { initiateUnmatch, cancelPending, hasPendingUnmatch };
}
