import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { addHours, addDays, addWeeks } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";

export type MuteDuration = "1hour" | "1day" | "1week" | "forever";

export interface MatchMute {
  id: string;
  match_id: string;
  user_id: string;
  muted_until: string;
  created_at: string;
}

const getMutedUntilDate = (duration: MuteDuration): Date => {
  const now = new Date();
  switch (duration) {
    case "1hour":
      return addHours(now, 1);
    case "1day":
      return addDays(now, 1);
    case "1week":
      return addWeeks(now, 1);
    case "forever":
      return new Date(9999, 11, 31, 23, 59, 59);
    default:
      return addDays(now, 1);
  }
};

const getDurationLabel = (duration: MuteDuration): string => {
  switch (duration) {
    case "1hour":
      return "1 hour";
    case "1day":
      return "1 day";
    case "1week":
      return "1 week";
    case "forever":
      return "indefinitely";
    default:
      return "1 day";
  }
};

export const useMuteMatch = () => {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();

  const { data: mutes = [] } = useQuery({
    queryKey: ["match-mutes", userId],
    queryFn: async (): Promise<MatchMute[]> => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from("match_mutes")
        .select("*")
        .eq("user_id", userId)
        .gt("muted_until", new Date().toISOString());

      if (error) throw error;
      return (data || []) as MatchMute[];
    },
    enabled: !!userId,
  });

  const muteMutation = useMutation({
    mutationFn: async ({ matchId, duration }: { matchId: string; duration: MuteDuration }) => {
      if (!userId) throw new Error("Not authenticated");
      const mutedUntil = getMutedUntilDate(duration);
      const mutedUntilIso = mutedUntil.toISOString();

      // Write to match_mutes (primary table)
      const { error } = await supabase
        .from("match_mutes")
        .upsert({
          match_id: matchId,
          user_id: userId,
          muted_until: mutedUntilIso,
        }, {
          onConflict: "match_id,user_id",
        });

      if (error) {
        await supabase
          .from("match_mutes")
          .delete()
          .eq("match_id", matchId)
          .eq("user_id", userId);

        const { error: insertError } = await supabase
          .from("match_mutes")
          .insert({
            match_id: matchId,
            user_id: userId,
            muted_until: mutedUntilIso,
          });

        if (insertError) throw insertError;
      }

      // Also sync to match_notification_mutes (checked by send-notification edge function)
      await supabase
        .from("match_notification_mutes")
        .upsert({
          match_id: matchId,
          user_id: userId,
          muted_until: mutedUntilIso,
        }, {
          onConflict: "match_id,user_id",
        }).then(() => {}).catch(() => {});

      return { duration };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["match-mutes"] });
    },
  });

  const unmuteMutation = useMutation({
    mutationFn: async ({ matchId }: { matchId: string }) => {
      if (!userId) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("match_mutes")
        .delete()
        .eq("match_id", matchId)
        .eq("user_id", userId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["match-mutes"] });
    },
  });

  const muteMatch = (matchId: string, userName: string, duration: MuteDuration) => {
    muteMutation.mutate({ matchId, duration }, {
      onSuccess: () => {
        toast.success(`${userName} muted for ${getDurationLabel(duration)}`, {
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

  const getMuteExpiry = (matchId: string): Date | null => {
    const mute = mutes.find((m) => m.match_id === matchId);
    return mute ? new Date(mute.muted_until) : null;
  };

  return {
    muteMatch,
    unmuteMatch,
    isMatchMuted,
    getMuteExpiry,
    mutes,
    isMuting: muteMutation.isPending,
    isUnmuting: unmuteMutation.isPending,
  };
};
