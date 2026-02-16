import { supabase } from "@/integrations/supabase/client";

/**
 * Resolve a photo path to a displayable URL.
 * - If the path starts with 'http', use it directly (already a full URL).
 * - Otherwise, resolve it via Supabase Storage public URL.
 */
export const resolvePhotoUrl = (path: string | null | undefined): string => {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  return supabase.storage.from('profile-photos').getPublicUrl(path).data.publicUrl;
};
