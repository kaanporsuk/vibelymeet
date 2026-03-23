import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ScheduleSlot = {
  slot_key: string;
  slot_date: string;
  time_block: string;
  status: string;
};

/** Live windows for the next 14 days when a 48h share grant exists (viewer = current user). */
export function useSharedPartnerSchedule(
  matchId: string | null | undefined,
  partnerUserId: string | null | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["shared-schedule", matchId, partnerUserId],
    queryFn: async (): Promise<ScheduleSlot[]> => {
      if (!matchId || !partnerUserId) return [];
      const { data, error } = await supabase.rpc("get_shared_schedule_for_date_planning", {
        p_match_id: matchId,
        p_subject_user_id: partnerUserId,
      });
      if (error) throw error;
      const parsed = data as { slots?: ScheduleSlot[] } | null;
      const raw = parsed?.slots;
      if (Array.isArray(raw)) return raw as ScheduleSlot[];
      return [];
    },
    enabled: !!matchId && !!partnerUserId && enabled,
    staleTime: 30_000,
  });
}
