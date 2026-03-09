import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

export interface BlockedUser {
  id: string;
  blocker_id: string;
  blocked_id: string;
  reason: string | null;
  created_at: string;
}

export const useBlockUser = () => {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();

  const { data: blockedUsers = [] } = useQuery({
    queryKey: ["blocked-users", userId],
    queryFn: async (): Promise<BlockedUser[]> => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from("blocked_users")
        .select("*")
        .eq("blocker_id", userId);

      if (error) throw error;
      return (data || []) as BlockedUser[];
    },
    enabled: !!userId,
  });

  const blockMutation = useMutation({
    mutationFn: async ({ blockedId, matchId, reason }: { blockedId: string; matchId?: string; reason?: string }) => {
      if (!userId) throw new Error("Not authenticated");

      // 1. Insert into blocked_users
      const { error: blockError } = await supabase
        .from("blocked_users")
        .insert({
          blocker_id: userId,
          blocked_id: blockedId,
          reason: reason || null,
        });

      if (blockError) {
        // Ignore duplicate (already blocked)
        if (!blockError.message.includes("duplicate") && !blockError.message.includes("unique")) {
          throw blockError;
        }
      }

      // 2. Remove match + messages if matchId provided
      if (matchId) {
        // Delete messages first (FK constraint)
        await supabase.from("messages").delete().eq("match_id", matchId);
        // Delete date proposals
        await supabase.from("date_proposals").delete().eq("match_id", matchId);
        // Delete mutes
        await supabase.from("match_mutes").delete().eq("match_id", matchId).eq("user_id", userId);
        await supabase.from("match_notification_mutes").delete().eq("match_id", matchId).eq("user_id", userId);
        // Delete match
        await supabase.from("matches").delete().eq("id", matchId);
      }

      return { blockedId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blocked-users"] });
      queryClient.invalidateQueries({ queryKey: ["matches"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-matches"] });
      queryClient.invalidateQueries({ queryKey: ["match-mutes"] });
    },
  });

  const unblockMutation = useMutation({
    mutationFn: async ({ blockedId }: { blockedId: string }) => {
      if (!userId) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("blocked_users")
        .delete()
        .eq("blocker_id", userId)
        .eq("blocked_id", blockedId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blocked-users"] });
    },
  });

  const blockUser = (blockedId: string, userName: string, reason?: string, matchId?: string) => {
    blockMutation.mutate({ blockedId, reason, matchId }, {
      onSuccess: () => {
        toast.success(`${userName} blocked`, {
          description: "They won't be able to contact you or see your profile",
        });
      },
      onError: () => {
        toast.error("Failed to block user");
      },
    });
  };

  const unblockUser = (blockedId: string, userName: string) => {
    unblockMutation.mutate({ blockedId }, {
      onSuccess: () => {
        toast.success(`${userName} unblocked`);
      },
      onError: () => {
        toast.error("Failed to unblock user");
      },
    });
  };

  const isUserBlocked = (targetUserId: string): boolean => {
    return blockedUsers.some((block) => block.blocked_id === targetUserId);
  };

  return {
    blockUser,
    unblockUser,
    isUserBlocked,
    blockedUsers,
    isBlocking: blockMutation.isPending,
    isUnblocking: unblockMutation.isPending,
  };
};
