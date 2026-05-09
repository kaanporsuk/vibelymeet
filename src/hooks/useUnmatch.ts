import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useCallback } from "react";
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
  onUnmatchComplete?: () => void;
  onUndo?: () => void;
}

export const useUndoableUnmatch = (options?: UndoableUnmatchOptions) => {
  const queryClient = useQueryClient();
  const pendingUnmatchRef = useRef<{
    matchId: string;
    timeoutId: NodeJS.Timeout;
    toastId: string | number;
  } | null>(null);

  const performUnmatch = useCallback(async (matchId: string) => {
    try {
      await unmatchViaRpc(matchId);

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ["matches"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-matches"] });

      options?.onUnmatchComplete?.();
    } catch (error) {
      console.error("Unmatch error:", error);
      toast.error("Failed to unmatch", {
        description: "Please try again later",
      });
    }
  }, [queryClient, options]);

  const undoUnmatch = useCallback(() => {
    if (pendingUnmatchRef.current) {
      clearTimeout(pendingUnmatchRef.current.timeoutId);
      toast.dismiss(pendingUnmatchRef.current.toastId);
      pendingUnmatchRef.current = null;
      
      // Restore UI by invalidating queries
      queryClient.invalidateQueries({ queryKey: ["matches"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-matches"] });
      
      toast.success("Unmatch cancelled", {
        description: "Your match has been restored",
        duration: 2000,
      });
      
      options?.onUndo?.();
    }
  }, [queryClient, options]);

  const initiateUnmatch = useCallback((matchId: string, userName: string) => {
    // Cancel any existing pending unmatch
    if (pendingUnmatchRef.current) {
      clearTimeout(pendingUnmatchRef.current.timeoutId);
      toast.dismiss(pendingUnmatchRef.current.toastId);
    }

    // Show toast with undo button
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

    // Set timeout to perform actual deletion
    const timeoutId = setTimeout(() => {
      performUnmatch(matchId);
      pendingUnmatchRef.current = null;
    }, 5000);

    pendingUnmatchRef.current = {
      matchId,
      timeoutId,
      toastId,
    };

    // Return immediately - the unmatch will happen after 5 seconds
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
