import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type DatePlanFeedbackStatus = {
  ok?: boolean;
  submitted?: boolean;
  report_requested?: boolean;
  error?: string;
};

export type SubmitDatePlanFeedbackInput = {
  planId: string;
  didMeet: "yes" | "no";
  feltSafe: "yes" | "not_really" | "report";
  wouldMeetAgain?: "yes" | "maybe" | "no" | null;
  profileAccurate?: "yes" | "somewhat" | "no" | null;
  freeText?: string | null;
};

export const datePlanFeedbackStatusQueryKey = (
  planId: string | null | undefined,
  userId: string | null | undefined,
) => ["date-plan-feedback-status", planId, userId] as const;

export function useDatePlanFeedbackStatus(
  planId: string | null | undefined,
  userId: string | null | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: datePlanFeedbackStatusQueryKey(planId, userId),
    queryFn: async (): Promise<DatePlanFeedbackStatus> => {
      if (!planId) return { ok: true, submitted: false, report_requested: false };
      const { data, error } = await supabase.rpc(
        "get_my_date_plan_feedback_status" as never,
        { p_plan_id: planId } as never,
      );
      if (error) throw error;
      return (data ?? { ok: true, submitted: false, report_requested: false }) as DatePlanFeedbackStatus;
    },
    enabled: Boolean(planId) && Boolean(userId) && enabled,
    staleTime: 30_000,
  });
}

export async function submitDatePlanFeedback(input: SubmitDatePlanFeedbackInput) {
  const { data, error } = await supabase.rpc(
    "submit_date_plan_feedback" as never,
    {
      p_plan_id: input.planId,
      p_did_meet: input.didMeet,
      p_felt_safe: input.feltSafe,
      p_would_meet_again: input.wouldMeetAgain ?? null,
      p_profile_accurate: input.profileAccurate ?? null,
      p_free_text: input.freeText ?? null,
    } as never,
  );
  if (error) throw error;
  const result = data as { ok?: boolean; error?: string; report_requested?: boolean } | null;
  if (result?.ok === false) {
    throw new Error(result.error || "date_plan_feedback_failed");
  }
  return result ?? { ok: true };
}
