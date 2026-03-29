import { supabase } from '@/lib/supabase';

/** Profile IDs that are not hidden from discovery (excludes paused, suspended, etc.). */
export async function filterVisibleProfileIds(profileIds: string[]): Promise<Set<string>> {
  if (profileIds.length === 0) return new Set();
  const unique = [...new Set(profileIds)];
  const results = await Promise.all(
    unique.map(async (id) => {
      const { data, error } = await supabase.rpc('is_profile_hidden', { p_profile_id: id });
      if (error) return { id, hidden: false };
      return { id, hidden: data === true };
    })
  );
  return new Set(results.filter((r) => !r.hidden).map((r) => r.id));
}
