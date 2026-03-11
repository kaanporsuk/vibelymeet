/**
 * Canonical subscription state from backend (Stripe + RevenueCat).
 * Same source of truth as web: subscriptions table, profiles.is_premium.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type SubscriptionStatus = 'active' | 'inactive' | 'past_due' | 'canceled' | 'trialing';
export type SubscriptionPlan = 'monthly' | 'annual' | null;

export function useBackendSubscription(userId: string | null | undefined) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['backend-subscription', userId],
    queryFn: async () => {
      if (!userId) return { isPremium: false, plan: null as SubscriptionPlan, currentPeriodEnd: null as string | null };
      const { data: rows } = await supabase
        .from('subscriptions')
        .select('status, plan, current_period_end, provider')
        .eq('user_id', userId)
        .order('current_period_end', { ascending: false, nullsFirst: false });
      const active = (rows ?? []).find((r) => r.status === 'active' || r.status === 'trialing');
      if (active) {
        return {
          isPremium: true,
          plan: (active.plan as SubscriptionPlan) ?? null,
          currentPeriodEnd: active.current_period_end ?? null,
          provider: active.provider ?? 'stripe',
        };
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_premium')
        .eq('id', userId)
        .maybeSingle();
      return {
        isPremium: profile?.is_premium ?? false,
        plan: null as SubscriptionPlan,
        currentPeriodEnd: null as string | null,
        provider: null as string | null,
      };
    },
    enabled: !!userId,
  });
  return {
    isPremium: data?.isPremium ?? false,
    plan: data?.plan ?? null,
    currentPeriodEnd: data?.currentPeriodEnd ?? null,
    provider: data?.provider ?? null,
    isLoading,
    refetch,
  };
}
