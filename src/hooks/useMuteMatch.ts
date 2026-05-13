import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useUserProfile } from "@/contexts/AuthContext";
import {
  getMatchMuteDurationLabel,
  type MatchMuteDuration,
} from "../../shared/chat/matchMuteDurations";

export type MuteDuration = MatchMuteDuration;

export interface MatchMute {
  id: string;
  match_id: string;
  user_id: string;
  muted_until: string | null;
  created_at: string | null;
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

export const useMuteMatch = () => {
  const { user } = useUserProfile();
  const userId = user?.id;
  const queryClient = useQueryClient();

  const { data: mutes = [] } = useQuery({
    queryKey: ["match-mutes", userId],
    queryFn: async (): Promise<MatchMute[]> => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from("match_notification_mutes")
        .select("id, match_id, user_id, muted_until, created_at")
        .eq("user_id", userId)
        .or(`muted_until.is.null,muted_until.gt.${new Date().toISOString()}`);

      if (error) throw error;
      return (data || []) as MatchMute[];
    },
    enabled: !!userId,
  });

  const muteMutation = useMutation({
    mutationFn: async ({ matchId, duration }: { matchId: string; duration: MuteDuration }) => {
      if (!userId) throw new Error("Not authenticated");
      const { data, error } = await supabase.rpc("set_match_notification_mute", {
        p_match_id: matchId,
        p_duration: duration,
      });

      if (error) throw error;
      assertMatchActionSucceeded(data, "Failed to mute notifications");
      return { duration };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["match-mutes"] });
    },
  });

  const unmuteMutation = useMutation({
    mutationFn: async ({ matchId }: { matchId: string }) => {
      if (!userId) throw new Error("Not authenticated");
      const { data, error } = await supabase.rpc("clear_match_notification_mute", {
        p_match_id: matchId,
      });

      if (error) throw error;
      assertMatchActionSucceeded(data, "Failed to unmute notifications");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["match-mutes"] });
    },
  });

  const muteMatch = (matchId: string, userName: string, duration: MuteDuration) => {
    muteMutation.mutate({ matchId, duration }, {
      onSuccess: () => {
        toast.success(`${userName} muted for ${getMatchMuteDurationLabel(duration)}`, {
          description: "You won't receive notifications from them",
        });
      },
      onError: () => {
        toast.error("Failed to mute notifications");
      },
    });
  };

  const unmuteMatch = (matchId: string, userName: string) => {
    unmuteMutation.mutate({ matchId }, {
      onSuccess: () => {
        toast.success(`Notifications from ${userName} unmuted`);
      },
      onError: () => {
        toast.error("Failed to unmute notifications");
      },
    });
  };

  const isMatchMuted = (matchId: string): boolean => {
    return mutes.some((mute) => mute.match_id === matchId);
  };

  return {
    muteMatch,
    unmuteMatch,
    isMatchMuted,
    mutes,
    isMuting: muteMutation.isPending,
    isUnmuting: unmuteMutation.isPending,
  };
};
