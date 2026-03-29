import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import { END_ACCOUNT_BREAK_PROFILE_UPDATE } from "@/lib/endAccountBreak";

export const useUserRegistrations = () => {
  const { user } = useUserProfile();

  return useQuery({
    queryKey: ["user-registrations", user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<string[]> => {
      if (!user?.id) return [];
      
      const { data, error } = await supabase
        .from("event_registrations")
        .select("event_id")
        .eq("profile_id", user.id);

      if (error) throw error;

      return (data || []).map((reg) => reg.event_id);
    },
  });
};

export const useRegisterForEvent = () => {
  const { user, refreshProfile } = useUserProfile();
  const queryClient = useQueryClient();

  const registerForEvent = async (eventId: string): Promise<boolean> => {
    if (!user?.id) return false;

    if (user.isPaused) {
      const endBreak = window.confirm(
        "You're on a break and hidden from discovery. End your break to register for this event?"
      );
      if (!endBreak) return false;
      const { error: upErr } = await supabase
        .from("profiles")
        .update(END_ACCOUNT_BREAK_PROFILE_UPDATE)
        .eq("id", user.id);
      if (upErr) return false;
      await refreshProfile();
      await queryClient.invalidateQueries({ queryKey: ["event-attendees"] });
    }

    const { data, error } = await supabase.rpc("register_for_event", {
      p_event_id: eventId,
    });
    if (error) return false;
    const result = data as { success?: boolean; error?: string } | null;
    return result?.success === true;
  };

  const unregisterFromEvent = async (eventId: string): Promise<boolean> => {
    if (!user?.id) return false;

    const { error } = await supabase
      .from("event_registrations")
      .delete()
      .eq("event_id", eventId)
      .eq("profile_id", user.id);

    return !error;
  };

  return { registerForEvent, unregisterFromEvent };
};
