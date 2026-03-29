import { supabase } from '@/lib/supabase';

/** When snooze end time has passed, restore discovery to visible and sync discoverable for web. */
export async function clearExpiredDiscoverySnoozeIfNeeded(userId: string | null | undefined): Promise<void> {
  if (!userId) return;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('discovery_mode, discovery_snooze_until')
    .eq('id', userId)
    .maybeSingle();

  if (error || !profile) return;

  const mode = profile.discovery_mode as string | null | undefined;
  const until = profile.discovery_snooze_until as string | null | undefined;

  if (mode === 'snoozed' && until && new Date(until) <= new Date()) {
    await supabase
      .from('profiles')
      .update({
        discovery_mode: 'visible',
        discovery_snooze_until: null,
        discoverable: true,
      })
      .eq('id', userId);
  }
}

/** When timed account break ends, restore visibility (keeps legacy is_paused in sync). */
export async function clearExpiredAccountPauseIfNeeded(userId: string | null | undefined): Promise<void> {
  if (!userId) return;

  const { data, error } = await supabase
    .from('profiles')
    .select('account_paused, account_paused_until')
    .eq('id', userId)
    .maybeSingle();

  if (error || !data) return;

  const paused = data.account_paused as boolean | null | undefined;
  const until = data.account_paused_until as string | null | undefined;

  if (paused && until && new Date(until) <= new Date()) {
    await supabase
      .from('profiles')
      .update({
        account_paused: false,
        account_paused_until: null,
        is_paused: false,
        paused_until: null,
        paused_at: null,
        pause_reason: null,
        discoverable: true,
        discovery_mode: 'visible',
      })
      .eq('id', userId);
  }
}
