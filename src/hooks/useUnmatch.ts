import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface UnmatchParams {
  matchId: string;
  userId?: string;
}

export const useUnmatch = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ matchId }: UnmatchParams) => {
      // Delete messages first (due to foreign key constraint)
      const { error: messagesError } = await supabase
        .from("messages")
        .delete()
        .eq("match_id", matchId);

      if (messagesError) {
        console.error("Error deleting messages:", messagesError);
        throw messagesError;
      }

      // Delete date proposals for this match
      const { error: proposalsError } = await supabase
        .from("date_proposals")
        .delete()
        .eq("match_id", matchId);

      if (proposalsError) {
        console.error("Error deleting proposals:", proposalsError);
        // Non-critical, continue
      }

      // Delete the match
      const { error: matchError } = await supabase
        .from("matches")
        .delete()
        .eq("id", matchId);

      if (matchError) {
        console.error("Error deleting match:", matchError);
        throw matchError;
      }

      return { success: true };
    },
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

// Hook to block a user (prevents future matching)
export const useBlockUser = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      blockedUserId,
      reason,
    }: {
      blockedUserId: string;
      reason?: string;
    }) => {
      // For now, just log - would need a blocked_users table in production
      console.log("Blocking user:", blockedUserId, "Reason:", reason);
      
      // In production, you'd insert into a blocked_users table:
      // const { error } = await supabase
      //   .from("blocked_users")
      //   .insert({ blocked_user_id: blockedUserId, reason });

      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["matches"] });
      toast.success("User blocked", {
        description: "You won't see each other again",
      });
    },
    onError: (error) => {
      console.error("Block error:", error);
      toast.error("Failed to block user");
    },
  });
};
