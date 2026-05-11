import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Resolves whether the current authenticated user owns an active
 * schedule_share_grants row attached to a SPECIFIC date suggestion (as
 * subject). This is the grant-backed authority the server uses to
 * authorize `edit_schedule_share_slots`; the UI mirrors the same gate so
 * the "Edit selected blocks" affordance only shows when the caller can
 * actually use it.
 *
 * RLS policy `schedule_share_grants_select_parties` permits the caller
 * to read their own grants (viewer_user_id = auth.uid() OR
 * subject_user_id = auth.uid()), so this is a direct table read rather
 * than an additional RPC.
 *
 * Scoped to suggestionId — match-level grants from older suggestions on
 * the same match do NOT enable Edit on a different suggestion.
 */
export function useCallerScheduleShareGrant(
  matchId: string | null | undefined,
  suggestionId: string | null | undefined,
  currentUserId: string | null | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [
      "caller-schedule-share-grant",
      matchId,
      suggestionId,
      currentUserId,
    ],
    queryFn: async (): Promise<{ hasGrant: boolean }> => {
      if (!matchId || !suggestionId || !currentUserId) {
        return { hasGrant: false };
      }
      const { data, error } = await supabase
        .from("schedule_share_grants")
        .select("id, expires_at")
        .eq("match_id", matchId)
        .eq("subject_user_id", currentUserId)
        .eq("source_date_suggestion_id", suggestionId)
        .gt("expires_at", new Date().toISOString())
        .limit(1)
        .maybeSingle();
      if (error) {
        // Treat error as "no grant" — keeps the UI conservative and avoids
        // flashing Edit when we can't prove the grant exists. Server-side
        // grant-owner enforcement remains the authority.
        return { hasGrant: false };
      }
      return { hasGrant: Boolean(data?.id) };
    },
    enabled:
      Boolean(matchId) &&
      Boolean(suggestionId) &&
      Boolean(currentUserId) &&
      enabled,
    staleTime: 30_000,
  });
}
