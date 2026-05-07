import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import {
  getFlatCapabilities,
  type FlatCapabilities,
} from '@shared/tiers';

type EntitlementsContextValue = FlatCapabilities & {
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
};

const EntitlementsContext = createContext<EntitlementsContextValue | null>(null);

export function EntitlementsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;

  const query = useQuery({
    queryKey: ['entitlements', userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<FlatCapabilities> => {
      if (!userId) {
        return getFlatCapabilities('free');
      }

      const { data, error } = await supabase.rpc('get_user_tier_capabilities', {
        p_user_id: userId,
      });
      if (error) throw error;
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('Entitlement capabilities were not returned by the backend');
      }
      return data as unknown as FlatCapabilities;
    },
  });

  useEffect(() => {
    if (!userId) return;

    const profileChannel = supabase
      .channel(`entitlements-profile-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${userId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['entitlements', userId] });
        },
      )
      .subscribe();

    const configChannel = supabase
      .channel('entitlements-config-native')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tier_config_overrides',
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['entitlements'] });
          void queryClient.invalidateQueries({ queryKey: ['tier-capabilities'] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(profileChannel);
      supabase.removeChannel(configChannel);
    };
  }, [queryClient, userId]);

  const value = useMemo<EntitlementsContextValue>(() => {
    const capabilities = query.data ?? getFlatCapabilities('free');
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

  const showEntitlementsError = !!userId && query.isError;

  return (
    <EntitlementsContext.Provider value={value}>
      {children}
      {showEntitlementsError ? (
        <View accessibilityRole="alert" style={styles.entitlementErrorBanner}>
          <Text style={styles.entitlementErrorText}>
            Tier benefits could not be verified. Premium gates are using safe defaults.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              void query.refetch();
            }}
            style={styles.entitlementErrorButton}
          >
            <Text style={styles.entitlementErrorButtonText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
    </EntitlementsContext.Provider>
  );
}

export function useEntitlementsContext(): EntitlementsContextValue {
  const context = useContext(EntitlementsContext);
  if (!context) throw new Error('useEntitlements must be used within EntitlementsProvider');
  return context;
}

const styles = StyleSheet.create({
  entitlementErrorBanner: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    zIndex: 1000,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.55)',
    backgroundColor: 'rgba(18, 18, 24, 0.96)',
  },
  entitlementErrorText: {
    flex: 1,
    color: '#f8fafc',
    fontSize: 12,
    lineHeight: 16,
  },
  entitlementErrorButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  entitlementErrorButtonText: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '700',
  },
});
