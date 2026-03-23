import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type DateSuggestionRevisionRow = {
  id: string;
  date_suggestion_id: string;
  revision_number: number;
  proposed_by: string;
  date_type_key: string;
  time_choice_key: string;
  place_mode_key: string;
  venue_text: string | null;
  optional_message: string | null;
  schedule_share_enabled: boolean;
  starts_at: string | null;
  ends_at: string | null;
  time_block: string | null;
  agreed_field_flags: Record<string, boolean> | null;
  created_at: string;
};

export type DateSuggestionRow = {
  id: string;
  match_id: string;
  proposer_id: string;
  recipient_id: string;
  status: string;
  current_revision_id: string | null;
  draft_payload: Record<string, unknown> | null;
  expires_at: string | null;
  schedule_share_expires_at: string | null;
  expiring_soon_sent_at: string | null;
  date_plan_id: string | null;
  created_at: string;
  updated_at: string;
};

export type DatePlanRow = {
  id: string;
  date_suggestion_id: string;
  match_id: string;
  starts_at: string | null;
  ends_at: string | null;
  venue_label: string | null;
  date_type_key: string | null;
  status: string;
  completion_initiated_by: string | null;
  completion_initiated_at: string | null;
  completion_confirmed_by: string | null;
  completion_confirmed_at: string | null;
};

export type DatePlanParticipantRow = {
  id: string;
  date_plan_id: string;
  user_id: string;
  calendar_title: string;
  calendar_issued_at: string;
};

export type DateSuggestionWithRelations = DateSuggestionRow & {
  revisions: DateSuggestionRevisionRow[];
  date_plan: (DatePlanRow & { participants?: DatePlanParticipantRow[] }) | null;
};

export function useMatchDateSuggestions(matchId: string | null | undefined) {
  return useQuery({
    queryKey: ["date-suggestions", matchId],
    queryFn: async (): Promise<DateSuggestionWithRelations[]> => {
      if (!matchId) return [];
      const { data: suggestions, error: sErr } = await supabase
        .from("date_suggestions")
        .select(
          `
          id,
          match_id,
          proposer_id,
          recipient_id,
          status,
          current_revision_id,
          draft_payload,
          expires_at,
          schedule_share_expires_at,
          expiring_soon_sent_at,
          date_plan_id,
          created_at,
          updated_at
        `,
        )
        .eq("match_id", matchId)
        .order("created_at", { ascending: false });

      if (sErr) throw sErr;
      const list = suggestions ?? [];
      if (list.length === 0) return [];

      const ids = list.map((s) => s.id);
      const planIds = list.map((s) => s.date_plan_id).filter(Boolean) as string[];

      const { data: revs } = await supabase
        .from("date_suggestion_revisions")
        .select("*")
        .in("date_suggestion_id", ids)
        .order("revision_number", { ascending: true });

      const { data: plans } =
        planIds.length > 0
          ? await supabase.from("date_plans").select("*").in("id", planIds)
          : { data: [] as DatePlanRow[] };

      const { data: parts } =
        planIds.length > 0
          ? await supabase.from("date_plan_participants").select("*").in("date_plan_id", planIds)
          : { data: [] as DatePlanParticipantRow[] };

      const revBySid = new Map<string, DateSuggestionRevisionRow[]>();
      for (const r of revs ?? []) {
        const sid = (r as DateSuggestionRevisionRow).date_suggestion_id;
        if (!revBySid.has(sid)) revBySid.set(sid, []);
        revBySid.get(sid)!.push(r as DateSuggestionRevisionRow);
      }

      const planById = new Map<string, DatePlanRow>();
      for (const p of plans ?? []) {
        planById.set((p as DatePlanRow).id, p as DatePlanRow);
      }

      const partsByPlan = new Map<string, DatePlanParticipantRow[]>();
      for (const p of parts ?? []) {
        const pid = (p as DatePlanParticipantRow).date_plan_id;
        if (!partsByPlan.has(pid)) partsByPlan.set(pid, []);
        partsByPlan.get(pid)!.push(p as DatePlanParticipantRow);
      }

      return list.map((s) => {
        const row = s as DateSuggestionRow;
        const plan = row.date_plan_id ? planById.get(row.date_plan_id) : null;
        return {
          ...row,
          revisions: revBySid.get(row.id) ?? [],
          date_plan: plan
            ? {
                ...plan,
                participants: partsByPlan.get(plan.id) ?? [],
              }
            : null,
        };
      });
    },
    enabled: !!matchId,
  });
}

export function useInvalidateDateSuggestions() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["date-suggestions"] });
}
