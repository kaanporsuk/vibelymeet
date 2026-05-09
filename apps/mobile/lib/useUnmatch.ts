/**
 * Unmatch through the server-owned atomic cleanup RPC. Parity with web useUnmatch.
 * useUndoableUnmatch: show snackbar with Undo for 5s before executing.
 */
import { useRef, useCallback, useState, useEffect } from 'react';
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

async function unmatchViaRpc(matchId: string) {
  const { data, error } = await supabase.rpc('unmatch_match', { p_match_id: matchId });
  if (error) throw error;
  assertMatchActionSucceeded(data, 'Failed to unmatch');
  return data;
}

export function useUnmatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ matchId }: { matchId: string }) => unmatchViaRpc(matchId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['matches'] });
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });
}

export type UndoableUnmatchOptions = {
  /** `matchId` is always passed so callers need not close over screen state. */
  onUnmatchComplete?: (matchId: string) => void;
  onUndo?: () => void;
};

export function useUndoableUnmatch(options?: UndoableUnmatchOptions) {
  const queryClient = useQueryClient();
  const pendingRef = useRef<{ matchId: string; timeoutId: ReturnType<typeof setTimeout> } | null>(null);
  const [hasPendingUnmatch, setHasPendingUnmatch] = useState(false);
  const mountedRef = useRef(true);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const performUnmatch = useCallback(async (matchId: string) => {
    try {
      await unmatchViaRpc(matchId);
      queryClient.invalidateQueries({ queryKey: ['matches'] });
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      if (mountedRef.current) {
        optionsRef.current?.onUnmatchComplete?.(matchId);
      }
    } catch (err) {
      if (__DEV__) console.warn('[useUndoableUnmatch] unmatch failed:', err);
    }
  }, [queryClient]);

  const cancelPending = useCallback(() => {
    if (pendingRef.current) {
      clearTimeout(pendingRef.current.timeoutId);
      pendingRef.current = null;
    }
    if (mountedRef.current) {
      setHasPendingUnmatch(false);
    }
    queryClient.invalidateQueries({ queryKey: ['matches'] });
    if (mountedRef.current) {
      optionsRef.current?.onUndo?.();
    }
  }, [queryClient]);

  const initiateUnmatch = useCallback(
    (matchId: string) => {
      if (pendingRef.current) {
        clearTimeout(pendingRef.current.timeoutId);
      }
      const timeoutId = setTimeout(() => {
        pendingRef.current = null;
        void performUnmatch(matchId).finally(() => {
          if (mountedRef.current) {
            setHasPendingUnmatch(false);
          }
        });
      }, 5000);
      pendingRef.current = { matchId, timeoutId };
      setHasPendingUnmatch(true);
    },
    [performUnmatch]
  );

  return { initiateUnmatch, cancelPending, hasPendingUnmatch };
}
