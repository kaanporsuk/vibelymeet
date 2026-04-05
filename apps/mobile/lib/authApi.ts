import { supabase } from '@/lib/supabase';
import { normalizeContractError } from '@/lib/contractErrors';
import {
  resolveEntryState as resolveSharedEntryState,
  type EntryStateResponse,
} from '@shared/entryState';

export type OnboardingStatus = 'complete' | 'incomplete' | 'unknown';

export async function signInWithEmail(email: string, password: string): Promise<{ ok: true } | { ok: false; error: ReturnType<typeof normalizeContractError> }> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { ok: false, error: normalizeContractError(error, 'auth_sign_in_failed', 'Sign in failed.') };
  }
  return { ok: true };
}

export async function requestPasswordReset(email: string, redirectTo: string): Promise<{ ok: true } | { ok: false; error: ReturnType<typeof normalizeContractError> }> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) {
    return { ok: false, error: normalizeContractError(error, 'auth_reset_request_failed', 'Could not send reset email.') };
  }
  return { ok: true };
}

export async function updatePassword(newPassword: string): Promise<{ ok: true } | { ok: false; error: ReturnType<typeof normalizeContractError> }> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    return { ok: false, error: normalizeContractError(error, 'auth_password_update_failed', 'Could not update password.') };
  }
  return { ok: true };
}

export async function resolveEntryState(): Promise<EntryStateResponse> {
  return resolveSharedEntryState(supabase);
}
