import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import {
  getFlatCapabilities,
  type FlatCapabilities,
} from "@shared/tiers";

type EntitlementsContextValue = FlatCapabilities & {
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
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
    queryFn: async (): Promise<FlatCapabilities> => {
      if (!userId) {
        return getFlatCapabilities("free");
      }

      const { data, error } = await supabase.rpc("get_user_tier_capabilities", {
        p_user_id: userId,
      });
      if (error) throw error;
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("Entitlement capabilities were not returned by the backend");
      }
      return data as unknown as FlatCapabilities;
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
          void queryClient.invalidateQueries({ queryKey: ["tier-capabilities"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(profileChannel);
      supabase.removeChannel(configChannel);
    };
  }, [queryClient, userId]);

  const value = useMemo<EntitlementsContextValue>(() => {
    const capabilities = query.data ?? getFlatCapabilities("free");
    return {
      ...capabilities,
      isLoading: !!userId && query.isLoading,
      isError: query.isError,
      error: query.error instanceof Error ? query.error : null,
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
