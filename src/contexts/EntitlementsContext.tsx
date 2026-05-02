import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import {
  mergeTierWithOverrides,
  type FlatCapabilities,
  type TierConfigOverride,
} from "@shared/tiers";

type EntitlementsContextValue = FlatCapabilities & {
  isLoading: boolean;
  refetch: () => Promise<void>;
};

const EntitlementsContext = createContext<EntitlementsContextValue | null>(null);

export function EntitlementsProvider({ children }: { children: ReactNode }) {
  const { user } = useUserProfile();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;

  const query = useQuery({
    queryKey: ["entitlements", userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      if (!userId) {
        return { tier: "free", overrides: [] as TierConfigOverride[] };
      }

      const [tierRes, overrideRes] = await Promise.all([
        supabase.from("profiles").select("subscription_tier").eq("id", userId).maybeSingle(),
        supabase.from("tier_config_overrides").select("tier_id, capability_key, value"),
      ]);

      return {
        tier: tierRes.data?.subscription_tier || "free",
        overrides: overrideRes.error ? [] : ((overrideRes.data || []) as TierConfigOverride[]),
      };
    },
  });

  useEffect(() => {
    if (!userId) return;

    const profileChannel = supabase
      .channel(`entitlements-profile-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${userId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["entitlements", userId] });
        }
      )
      .subscribe();

    const configChannel = supabase
      .channel("entitlements-config")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tier_config_overrides",
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["entitlements"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(profileChannel);
      supabase.removeChannel(configChannel);
    };
  }, [queryClient, userId]);

  const value = useMemo<EntitlementsContextValue>(() => {
    const capabilities = mergeTierWithOverrides(query.data?.tier ?? "free", query.data?.overrides ?? []);
    return {
      ...capabilities,
      isLoading: !!userId && query.isLoading,
      refetch: async () => {
        await query.refetch();
      },
    };
  }, [query, userId]);

  return <EntitlementsContext.Provider value={value}>{children}</EntitlementsContext.Provider>;
}

export function useEntitlementsContext(): EntitlementsContextValue {
  const context = useContext(EntitlementsContext);
  if (!context) {
    throw new Error("useEntitlements must be used within EntitlementsProvider");
  }
  return context;
}
