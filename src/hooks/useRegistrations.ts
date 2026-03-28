import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";

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
  const { user } = useUserProfile();

  const registerForEvent = async (eventId: string): Promise<boolean> => {
    if (!user?.id) return false;

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
