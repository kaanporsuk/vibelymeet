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

  const refetchDeletionState = useCallback(async () => {
    if (!userId) {
      setPendingDeletion(null);
      return;
    }
    const { data } = await supabase
      .from('account_deletion_requests')
      .select('id, scheduled_deletion_at, status')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .maybeSingle();
    setPendingDeletion(data as DeletionRequest | null);
  }, [userId]);

  useEffect(() => {
    refetchDeletionState();
  }, [refetchDeletionState]);

  const cancelDeletion = useCallback(async (): Promise<boolean> => {
    if (!userId) return false;
    setIsCancelling(true);
    try {
      const authRes = await supabase.auth.getSession();
      const session = authRes.data?.session ?? null;
      if (!session) {
        setIsCancelling(false);
        return false;
      }
      const { data: invokeData, error } = await supabase.functions.invoke('cancel-deletion', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = invokeData as { success?: boolean; error?: string } | null;
      if (error || !result?.success) {
        setIsCancelling(false);
        return false;
      }
      setPendingDeletion(null);
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      setIsCancelling(false);
      return true;
    } catch {
      setIsCancelling(false);
      return false;
    }
  }, [userId, queryClient]);

  return { pendingDeletion, cancelDeletion, isCancelling, refetchDeletionState };
}
