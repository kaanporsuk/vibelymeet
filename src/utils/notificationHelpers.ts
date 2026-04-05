import { supabase } from "@/integrations/supabase/client";

/**
 * Check if a user has muted notifications for a specific match.
 * match_notification_mutes is the canonical mute table.
 * Auto-cleans expired mutes.
 */
export const isUserMutedForMatch = async (matchId: string, userId: string): Promise<boolean> => {
  const { data: notifMute } = await supabase
    .from("match_notification_mutes")
    .select("id, muted_until")
    .eq("match_id", matchId)
    .eq("user_id", userId)
    .maybeSingle();

  if (notifMute) {
    const mutedUntil = notifMute.muted_until ? new Date(notifMute.muted_until) : null;
    if (!mutedUntil || mutedUntil > new Date()) {
      return true;
    }
    // Expired — clean up
    await supabase
      .from("match_notification_mutes")
      .delete()
      .eq("id", notifMute.id);
  }

  return false;
};
