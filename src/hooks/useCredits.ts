import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface Credits {
  extraTime: number;
  extendedVibe: number;
}

export const useCredits = () => {
  const { user } = useAuth();
  const [credits, setCredits] = useState<Credits>({ extraTime: 0, extendedVibe: 0 });
  const [isLoading, setIsLoading] = useState(true);

  const fetchCredits = useCallback(async () => {
    if (!user?.id) return;

    const { data } = await supabase
      .from("user_credits")
      .select("extra_time_credits, extended_vibe_credits")
      .eq("user_id", user.id)
      .maybeSingle();

    if (data) {
      setCredits({
        extraTime: data.extra_time_credits,
        extendedVibe: data.extended_vibe_credits,
      });
    }
    setIsLoading(false);
  }, [user?.id]);

  useEffect(() => {
    fetchCredits();
  }, [fetchCredits]);

  // Atomic credit deduction via RPC
  const useExtraTime = useCallback(async (): Promise<boolean> => {
    if (!user?.id || credits.extraTime <= 0) return false;

    const { data, error } = await supabase.rpc("deduct_credit", {
      p_user_id: user.id,
      p_credit_type: "extra_time",
    });

    if (!error && data === true) {
      setCredits((prev) => ({ ...prev, extraTime: prev.extraTime - 1 }));
      return true;
    }
    return false;
  }, [user?.id, credits.extraTime]);

  const useExtendedVibe = useCallback(async (): Promise<boolean> => {
    if (!user?.id || credits.extendedVibe <= 0) return false;

    const { data, error } = await supabase.rpc("deduct_credit", {
      p_user_id: user.id,
      p_credit_type: "extended_vibe",
    });

    if (!error && data === true) {
      setCredits((prev) => ({ ...prev, extendedVibe: prev.extendedVibe - 1 }));
      return true;
    }
    return false;
  }, [user?.id, credits.extendedVibe]);

  return { credits, isLoading, useExtraTime, useExtendedVibe, refetch: fetchCredits };
};
