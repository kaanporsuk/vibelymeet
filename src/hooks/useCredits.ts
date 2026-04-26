import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";

interface Credits {
  extraTime: number;
  extendedVibe: number;
}

export const useCredits = () => {
  const { user } = useUserProfile();
  const [credits, setCredits] = useState<Credits>({ extraTime: 0, extendedVibe: 0 });
  const [isLoading, setIsLoading] = useState(true);

  const fetchCredits = useCallback(async () => {
    if (!user?.id) {
      setCredits({ extraTime: 0, extendedVibe: 0 });
      setIsLoading(false);
      return;
    }

    const { data } = await supabase
      .from("user_credits")
      .select("extra_time_credits, extended_vibe_credits")
      .eq("user_id", user.id)
      .maybeSingle();

    setCredits(
      data
        ? { extraTime: data.extra_time_credits, extendedVibe: data.extended_vibe_credits }
        : { extraTime: 0, extendedVibe: 0 }
    );
    setIsLoading(false);
  }, [user?.id]);

  useEffect(() => {
    fetchCredits();
  }, [fetchCredits]);

  return { credits, isLoading, refetch: fetchCredits };
};
