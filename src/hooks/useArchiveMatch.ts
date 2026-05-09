import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useUserProfile } from "@/contexts/AuthContext";

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

export const useArchiveMatch = () => {
  const { user } = useUserProfile();
  const userId = user?.id;
  const queryClient = useQueryClient();

  const archiveMutation = useMutation({
    mutationFn: async ({ matchId }: { matchId: string }) => {
      if (!userId) throw new Error("Not authenticated");
      const { data, error } = await supabase.rpc("set_match_archive_state", {
        p_match_id: matchId,
        p_archived: true,
      });

      if (error) throw error;
      assertMatchActionSucceeded(data, "Failed to archive match");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["matches"] });
      queryClient.invalidateQueries({ queryKey: ["archived-matches"] });
    },
  });

  const unarchiveMutation = useMutation({
    mutationFn: async ({ matchId }: { matchId: string }) => {
      if (!userId) throw new Error("Not authenticated");
      const { data, error } = await supabase.rpc("set_match_archive_state", {
        p_match_id: matchId,
        p_archived: false,
      });

      if (error) throw error;
      assertMatchActionSucceeded(data, "Failed to unarchive match");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["matches"] });
      queryClient.invalidateQueries({ queryKey: ["archived-matches"] });
    },
  });

  const showArchiveSuccessToast = (matchId: string, userName: string) => {
    toast.success(`${userName} archived`, {
      description: "You can find them in archived matches",
      action: {
        label: "Undo",
        onClick: () => unarchiveMutation.mutate({ matchId }),
      },
    });
  };

  const archiveMatch = (matchId: string, userName: string) => {
    archiveMutation.mutate({ matchId }, {
      onSuccess: () => showArchiveSuccessToast(matchId, userName),
      onError: () => {
        toast.error("Failed to archive match");
      },
    });
  };

  const archiveMatchAsync = async (matchId: string, userName: string) => {
    try {
      await archiveMutation.mutateAsync({ matchId });
      showArchiveSuccessToast(matchId, userName);
    } catch (error) {
      toast.error("Failed to archive match");
      throw error;
    }
  };

  const unarchiveMatch = (matchId: string, userName: string) => {
    unarchiveMutation.mutate({ matchId }, {
      onSuccess: () => {
        toast.success(`${userName} restored to matches`);
      },
      onError: () => {
        toast.error("Failed to unarchive match");
      },
    });
  };

  return {
    archiveMatch,
    archiveMatchAsync,
    unarchiveMatch,
    isArchiving: archiveMutation.isPending,
    isUnarchiving: unarchiveMutation.isPending,
  };
};
