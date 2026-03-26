import { supabase } from '@/lib/supabase';

export class DateSuggestionDomainError extends Error {
  code: string;
  suggestionId: string | null;
  status: string | null;

  constructor(
    code: string,
    message: string,
    opts?: { suggestionId?: string | null; status?: string | null }
  ) {
    super(message);
    this.name = 'DateSuggestionDomainError';
    this.code = code;
    this.suggestionId = opts?.suggestionId ?? null;
    this.status = opts?.status ?? null;
  }
}

export async function dateSuggestionApply(
  action: string,
  payload: Record<string, unknown>
): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke('date-suggestion-actions', {
    body: { action, payload },
  });
  if (error) throw error;
  const result = data as {
    ok?: boolean;
    error?: string;
    error_code?: string;
    suggestion_id?: string;
    status?: string;
  };
  if (result?.ok === false) {
    const code = result.error_code || result.error || 'date_suggestion_action_failed';
    if (code === 'active_suggestion_exists') {
      throw new DateSuggestionDomainError(
        code,
        'You already have an active date suggestion in this chat.',
        { suggestionId: result.suggestion_id ?? null, status: result.status ?? null }
      );
    }
    throw new DateSuggestionDomainError(code, result.error || 'date_suggestion_action_failed', {
      suggestionId: result.suggestion_id ?? null,
      status: result.status ?? null,
    });
  }
  return data;
}
