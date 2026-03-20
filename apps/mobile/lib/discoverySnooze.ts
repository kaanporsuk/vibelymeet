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
