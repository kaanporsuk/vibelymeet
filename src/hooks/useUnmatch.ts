import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface UnmatchParams {
  matchId: string;
  userId?: string;
}

type MatchActionRpcResult = {
  success?: boolean;
  code?: string;
  error?: string;
};

const assertMatchActionSucceeded = (result: unknown, fallback: string) => {
  const payload = result as MatchActionRpcResult | null;
  if (!payload?.success) {
    throw new Error(payload?.error || payload?.code || fallback);
  }
};

const unmatchViaRpc = async (matchId: string) => {
  const { data, error } = await supabase.rpc("unmatch_match", {
    p_match_id: matchId,
  });

  if (error) throw error;
  assertMatchActionSucceeded(data, "Failed to unmatch");
  return data;
};

// Standard unmatch mutation (immediate deletion)
export const useUnmatch = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ matchId }: UnmatchParams) => unmatchViaRpc(matchId),
    onSuccess: () => {
      // Invalidate matches queries to refresh the list
      queryClient.invalidateQueries({ queryKey: ["matches"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-matches"] });
      queryClient.invalidateQueries({ queryKey: ["profile-live-counts"] });
      queryClient.invalidateQueries({ queryKey: ["unread-home"] });
      queryClient.invalidateQueries({ queryKey: ["unread-home-info-bar"] });
    },
    onError: (error) => {
      console.error("Unmatch error:", error);
      toast.error("Failed to unmatch", {
        description: "Please try again later",
      });
    },
  });
};

// Undo-able unmatch with 5-second delay
interface UndoableUnmatchOptions {
  /** `matchId` is always passed so callers need not close over screen state. */
  onUnmatchComplete?: (matchId: string) => void;
  onUndo?: () => void;
}

export const useUndoableUnmatch = (options?: UndoableUnmatchOptions) => {
  const queryClient = useQueryClient();
  const mountedRef = useRef(true);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const pendingUnmatchRef = useRef<{
    matchId: string;
    timeoutId: NodeJS.Timeout;
    toastId: string | number;
  } | null>(null);

  const performUnmatch = useCallback(async (matchId: string) => {
    try {
      await unmatchViaRpc(matchId);

      queryClient.invalidateQueries({ queryKey: ["matches"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-matches"] });
      queryClient.invalidateQueries({ queryKey: ["profile-live-counts"] });
      queryClient.invalidateQueries({ queryKey: ["unread-home"] });
      queryClient.invalidateQueries({ queryKey: ["unread-home-info-bar"] });

      if (mountedRef.current) {
        optionsRef.current?.onUnmatchComplete?.(matchId);
      }
    } catch (error) {
      console.error("Unmatch error:", error);
      if (mountedRef.current) {
        toast.error("Failed to unmatch", {
          description: "Please try again later",
        });
      }
    }
  }, [queryClient]);

  const undoUnmatch = useCallback(() => {
    if (pendingUnmatchRef.current) {
      clearTimeout(pendingUnmatchRef.current.timeoutId);
      toast.dismiss(pendingUnmatchRef.current.toastId);
      pendingUnmatchRef.current = null;

      queryClient.invalidateQueries({ queryKey: ["matches"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-matches"] });
      queryClient.invalidateQueries({ queryKey: ["profile-live-counts"] });

      if (mountedRef.current) {
        toast.success("Unmatch cancelled", {
          description: "Your match has been restored",
          duration: 2000,
        });
        optionsRef.current?.onUndo?.();
      }
    }
  }, [queryClient]);

  const initiateUnmatch = useCallback((matchId: string, userName: string) => {
    if (pendingUnmatchRef.current) {
      clearTimeout(pendingUnmatchRef.current.timeoutId);
      toast.dismiss(pendingUnmatchRef.current.toastId);
    }

    const toastId = toast(`Unmatched with ${userName}`, {
      description: "This action will complete in 5 seconds",
      duration: 5000,
      action: {
        label: "Undo",
        onClick: () => {
          undoUnmatch();
        },
      },
      onDismiss: () => {
        // If dismissed without undo, the timeout will still run
      },
    });

    const timeoutId = setTimeout(() => {
      void performUnmatch(matchId).finally(() => {
        pendingUnmatchRef.current = null;
      });
    }, 5000);

    pendingUnmatchRef.current = {
      matchId,
      timeoutId,
      toastId,
    };

    return true;
  }, [performUnmatch, undoUnmatch]);

  const cancelPendingUnmatch = useCallback(() => {
    if (pendingUnmatchRef.current) {
      clearTimeout(pendingUnmatchRef.current.timeoutId);
      toast.dismiss(pendingUnmatchRef.current.toastId);
      pendingUnmatchRef.current = null;
    }
  }, []);

  return {
    initiateUnmatch,
    undoUnmatch,
    cancelPendingUnmatch,
    hasPendingUnmatch: () => pendingUnmatchRef.current !== null,
  };
};

// Re-export useBlockUser from its dedicated module for backward compatibility
export { useBlockUser } from "@/hooks/useBlockUser";
