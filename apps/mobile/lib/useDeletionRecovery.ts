/**
 * Deletion recovery — parity with web: detect pending account_deletion_requests, cancel via cancel-deletion Edge Function.
 */
import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type DeletionRequest = {
  id: string;
  scheduled_deletion_at: string;
  status: string;
};

export function useDeletionRecovery(userId: string | null | undefined) {
  const queryClient = useQueryClient();
  const [pendingDeletion, setPendingDeletion] = useState<DeletionRequest | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [deletionStateError, setDeletionStateError] = useState<string | null>(null);
  const [cancelDeletionError, setCancelDeletionError] = useState<string | null>(null);

  const refetchDeletionState = useCallback(async () => {
    if (!userId) {
      setPendingDeletion(null);
      setDeletionStateError(null);
      return;
    }
    const { data, error } = await supabase
      .from('account_deletion_requests')
      .select('id, scheduled_deletion_at, status')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .maybeSingle();
    if (error) {
      setDeletionStateError('We couldn’t load your scheduled deletion status. Try again in a moment.');
      if (__DEV__) console.warn('[useDeletionRecovery] fetch failed:', error.message);
      return;
    }
    setDeletionStateError(null);
    setPendingDeletion(data as DeletionRequest | null);
  }, [userId]);

  useEffect(() => {
    refetchDeletionState();
  }, [refetchDeletionState]);

  const clearCancelDeletionError = useCallback(() => {
    setCancelDeletionError(null);
  }, []);

  const clearDeletionStateError = useCallback(() => {
    setDeletionStateError(null);
  }, []);

  const cancelDeletion = useCallback(async (): Promise<boolean> => {
    setCancelDeletionError(null);
    if (!userId) return false;
    setIsCancelling(true);
    try {
      const authRes = await supabase.auth.getSession();
      const session = authRes.data?.session ?? null;
      if (!session) {
        setCancelDeletionError('Sign in again to cancel deletion.');
        setIsCancelling(false);
        return false;
      }
      const { data: invokeData, error } = await supabase.functions.invoke('cancel-deletion', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = invokeData as { success?: boolean; error?: string } | null;
      if (error) {
        setCancelDeletionError(error.message || 'Couldn’t cancel deletion. Try again.');
        setIsCancelling(false);
        return false;
      }
      if (!result?.success) {
        setCancelDeletionError(result?.error || 'Couldn’t cancel deletion. Try again.');
        setIsCancelling(false);
        return false;
      }
      setPendingDeletion(null);
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      setIsCancelling(false);
      return true;
    } catch {
      setCancelDeletionError('Something went wrong. Check your connection and try again.');
      setIsCancelling(false);
      return false;
    }
  }, [userId, queryClient]);

  return {
    pendingDeletion,
    cancelDeletion,
    isCancelling,
    refetchDeletionState,
    deletionStateError,
    cancelDeletionError,
    clearDeletionStateError,
    clearCancelDeletionError,
  };
}
