import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState, useRef } from "react";
import { trackEvent } from "@/lib/analytics";

/**
 * Profile `is_premium` / `premium_until` (incl. admin grants). Prefer `useEntitlements()` for feature gates;
 * keep this hook when you need `premium_until` for copy or analytics, not for tier capabilities.
 */
export const usePremium = () => {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
    });
  }, []);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["premium-status", userId],
    queryFn: async () => {
      if (!userId) return { is_premium: false, premium_until: null };
      const { data, error } = await supabase
        .from("profiles")
        .select("is_premium, premium_until")
        .eq("id", userId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!userId,
  });

  const prevPremium = useRef<boolean | null>(null);

  // Track premium activation
  useEffect(() => {
    const current = data?.is_premium ?? false;
    if (prevPremium.current === false && current) {
      trackEvent('premium_activated');
    }
    prevPremium.current = current;
  }, [data?.is_premium]);

  // Realtime subscription for instant updates
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`premium-${userId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${userId}` },
        () => { refetch(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, refetch]);

  return {
    isPremium: data?.is_premium ?? false,
    premiumUntil: data?.premium_until ? new Date(data.premium_until) : null,
    isLoading,
    refetch,
  };
};
