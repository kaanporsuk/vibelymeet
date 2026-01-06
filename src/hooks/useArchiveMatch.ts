import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const DEMO_USER_ID = "b2222222-2222-2222-2222-222222222222";

export const useArchiveMatch = () => {
  const queryClient = useQueryClient();

  const archiveMutation = useMutation({
    mutationFn: async ({ matchId, userId = DEMO_USER_ID }: { matchId: string; userId?: string }) => {
      const { error } = await supabase
        .from("matches")
        .update({ 
          archived_at: new Date().toISOString(),
          archived_by: userId 
        })
        .eq("id", matchId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["matches"] });
      queryClient.invalidateQueries({ queryKey: ["archived-matches"] });
    },
  });

  const unarchiveMutation = useMutation({
    mutationFn: async ({ matchId }: { matchId: string }) => {
      const { error } = await supabase
        .from("matches")
        .update({ 
          archived_at: null,
          archived_by: null 
        })
        .eq("id", matchId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["matches"] });
      queryClient.invalidateQueries({ queryKey: ["archived-matches"] });
    },
  });

  const archiveMatch = (matchId: string, userName: string) => {
    archiveMutation.mutate({ matchId }, {
      onSuccess: () => {
        toast.success(`${userName} archived`, {
          description: "You can find them in archived matches",
          action: {
            label: "Undo",
            onClick: () => unarchiveMutation.mutate({ matchId }),
          },
        });
      },
      onError: () => {
        toast.error("Failed to archive match");
      },
    });
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
    unarchiveMatch,
    isArchiving: archiveMutation.isPending,
    isUnarchiving: unarchiveMutation.isPending,
  };
};
