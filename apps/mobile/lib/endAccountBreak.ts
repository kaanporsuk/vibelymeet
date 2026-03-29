import { supabase } from '@/lib/supabase';

/** Clears account / discovery pause — same fields as Account settings “End break”. */
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
