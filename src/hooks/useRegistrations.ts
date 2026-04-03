import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import { END_ACCOUNT_BREAK_PROFILE_UPDATE } from "@/lib/endAccountBreak";

export type UserEventAdmissionMap = {
  confirmedEventIds: string[];
  waitlistedEventIds: string[];
};

export const useUserRegistrations = () => {
  const { user } = useUserProfile();

  return useQuery({
    queryKey: ["user-registrations", user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<UserEventAdmissionMap> => {
      if (!user?.id) return { confirmedEventIds: [], waitlistedEventIds: [] };

      const { data, error } = await supabase
        .from("event_registrations")
        .select("event_id, admission_status")
        .eq("profile_id", user.id);

      if (error) throw error;

      const confirmedEventIds: string[] = [];
      const waitlistedEventIds: string[] = [];
      for (const row of data ?? []) {
        const ev = row.event_id as string;
        if (row.admission_status === "confirmed") confirmedEventIds.push(ev);
        else if (row.admission_status === "waitlisted") waitlistedEventIds.push(ev);
      }
      return { confirmedEventIds, waitlistedEventIds };
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
      await queryClient.invalidateQueries({ queryKey: ["event-attendee-preview"] });
    }

    const { data, error } = await supabase.rpc("register_for_event", {
      p_event_id: eventId,
    });
    if (error) return false;
    const result = data as { success?: boolean; error?: string } | null;
    if (result?.success === true) {
      await queryClient.invalidateQueries({ queryKey: ["event-registration-check"] });
    }
    return result?.success === true;
  };

  const unregisterFromEvent = async (eventId: string): Promise<boolean> => {
    if (!user?.id) return false;

    const { data, error } = await supabase.rpc("cancel_event_registration", {
      p_event_id: eventId,
    });
    if (error) return false;
    const result = data as { success?: boolean } | null;
    if (result?.success === true) {
      await queryClient.invalidateQueries({ queryKey: ["user-registrations", user.id] });
      await queryClient.invalidateQueries({ queryKey: ["event-registration-check"] });
      await queryClient.invalidateQueries({ queryKey: ["event-attendees"] });
      await queryClient.invalidateQueries({ queryKey: ["event-attendee-preview"] });
    }
    return result?.success === true;
  };

  return { registerForEvent, unregisterFromEvent };
};
