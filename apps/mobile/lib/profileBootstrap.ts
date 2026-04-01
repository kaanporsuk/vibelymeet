import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { buildBootstrapProfileInsert, pickBootstrapName } from '@shared/profileContracts';

export type EnsureProfileExistsReason =
  | 'auth_context_session'
  | 'auth_context_state_change'
  | 'sign_in_screen_effect'
  | 'email_signup';

export async function ensureBootstrapProfileExists(
  user: User,
  reason: EnsureProfileExistsReason,
): Promise<{ ok: true; created: boolean } | { ok: false; reason: string }> {
  try {
    const { data: existing, error: existingError } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();

    if (existingError) {
      console.warn('[profile-bootstrap] profile lookup failed', {
        reason,
        userId: user.id,
        message: existingError.message,
      });
      return { ok: false, reason: 'profile_lookup_failed' };
    }
    if (existing) return { ok: true, created: false };

    const payload = buildBootstrapProfileInsert({
      userId: user.id,
      name: pickBootstrapName(user.user_metadata as Record<string, unknown> | undefined),
      phoneNumber: user.phone ?? null,
    });

    const { error: insertError } = await supabase.from('profiles').insert(payload);
    if (insertError) {
      console.warn('[profile-bootstrap] insert failed', {
        reason,
        userId: user.id,
        message: insertError.message,
      });
      return { ok: false, reason: 'profile_insert_failed' };
    }

    return { ok: true, created: true };
  } catch (error) {
    console.warn('[profile-bootstrap] unexpected failure', {
      reason,
      userId: user.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: 'profile_insert_unexpected' };
  }
}
