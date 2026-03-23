import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { captureSupabaseError } from "@/lib/errorTracking";

export type RevisionPayload = {
  date_type_key: string;
  time_choice_key: string;
  place_mode_key: string;
  venue_text?: string | null;
  optional_message?: string | null;
  schedule_share_enabled: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
  time_block?: string | null;
};

async function invokeAction(action: string, payload: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("date-suggestion-actions", {
    body: { action, payload },
  });
  if (error) {
    captureSupabaseError("date-suggestion-actions", error);
    throw error;
  }
  const result = data as { ok?: boolean; error?: string };
  if (result?.ok === false) {
    throw new Error(result.error || "date_suggestion_action_failed");
  }
  return data;
}

export function useDateSuggestionActions() {
  const qc = useQueryClient();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["date-suggestions"] });
    qc.invalidateQueries({ queryKey: ["messages"] });
    qc.invalidateQueries({ queryKey: ["matches"] });
  };

  return useMutation({
    mutationFn: async (vars: { action: string; payload: Record<string, unknown> }) => {
      return invokeAction(vars.action, vars.payload);
    },
    onSuccess: invalidate,
  });
}

export async function dateSuggestionApply(
  action: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke("date-suggestion-actions", {
    body: { action, payload },
  });
  if (error) {
    captureSupabaseError("date-suggestion-actions", error);
    throw error;
  }
  const result = data as { ok?: boolean; error?: string };
  if (result?.ok === false) {
    throw new Error(result.error || "date_suggestion_action_failed");
  }
  return data;
}
