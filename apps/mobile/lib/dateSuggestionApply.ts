import { supabase } from '@/lib/supabase';

export async function dateSuggestionApply(
  action: string,
  payload: Record<string, unknown>
): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke('date-suggestion-actions', {
    body: { action, payload },
  });
  if (error) throw error;
  const result = data as { ok?: boolean; error?: string };
  if (result?.ok === false) {
    throw new Error(result.error || 'date_suggestion_action_failed');
  }
  return data;
}
