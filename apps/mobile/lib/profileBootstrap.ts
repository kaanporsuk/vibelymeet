import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

const DEFAULT_BOOTSTRAP_AGE = 18;
const DEFAULT_BOOTSTRAP_GENDER = 'prefer_not_to_say';

export type EnsureProfileExistsReason =
  | 'auth_context_session'
  | 'auth_context_state_change'
  | 'sign_in_screen_effect'
  | 'email_signup';

function pickBootstrapName(user: User): string {
  const md = user.user_metadata ?? {};
  const rawName =
    (typeof md.full_name === 'string' && md.full_name) ||
    (typeof md.name === 'string' && md.name) ||
    '';
  return rawName.trim();
}

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

    const isPhoneAuth = !!user.phone;
    const payload = {
      id: user.id,
      name: pickBootstrapName(user),
      age: DEFAULT_BOOTSTRAP_AGE,
      gender: DEFAULT_BOOTSTRAP_GENDER,
      birth_date: null as string | null,
      phone_number: isPhoneAuth ? user.phone : null,
      phone_verified: isPhoneAuth,
      phone_verified_at: isPhoneAuth ? new Date().toISOString() : null,
    };

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
