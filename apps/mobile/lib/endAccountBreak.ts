import { supabase } from '@/lib/supabase';

/** Clears account / discovery pause — same fields as Account settings “End break”. */
// SAFETY CONTRACT: This update clears pause/discovery flags ONLY.
// It NEVER touches is_suspended, suspension_reason, or any
// trust & safety state. Moderation actions are independent of breaks.
export const END_ACCOUNT_BREAK_PROFILE_UPDATE = {
  account_paused: false,
  account_paused_until: null,
  is_paused: false,
  paused_until: null,
  paused_at: null,
  pause_reason: null,
  discoverable: true,
  discovery_mode: 'visible' as const,
};

export function endAccountBreakForUser(userId: string) {
  return supabase.from('profiles').update(END_ACCOUNT_BREAK_PROFILE_UPDATE).eq('id', userId);
}
