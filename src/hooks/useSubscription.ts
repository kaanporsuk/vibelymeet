import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";

export type SubscriptionStatus = 'active' | 'inactive' | 'past_due' | 'canceled' | 'trialing'
export type SubscriptionPlan = 'monthly' | 'annual' | null

interface Subscription {
  status: SubscriptionStatus
  plan: SubscriptionPlan
  current_period_end: string | null
}

export const useSubscription = () => {
  const { user } = useUserProfile();
  const [subscription, setSubscription] = useState<Subscription>({
    status: 'inactive',
    plan: null,
    current_period_end: null,
  })
  const [isLoading, setIsLoading] = useState(true)

  const fetchSubscription = useCallback(async () => {
    if (!user?.id) { setIsLoading(false); return }

    const { data: rows } = await supabase
      .from('subscriptions')
      .select('status, plan, current_period_end')
      .eq('user_id', user.id)
      .order('current_period_end', { ascending: false, nullsFirst: false })

    // Canonical: any active/trialing from Stripe or RevenueCat counts as premium
    const active = (rows ?? []).find((r) => r.status === 'active' || r.status === 'trialing')
    if (active) {
      setSubscription({
        status: active.status as SubscriptionStatus,
        plan: active.plan as SubscriptionPlan,
        current_period_end: active.current_period_end,
      })
    } else if (rows?.length) {
      setSubscription({
        status: (rows[0].status as SubscriptionStatus) ?? 'inactive',
        plan: (rows[0].plan as SubscriptionPlan) ?? null,
        current_period_end: rows[0].current_period_end ?? null,
      })
    }
    setIsLoading(false)
  }, [user?.id])

  useEffect(() => {
    fetchSubscription()

    if (!user?.id) return
    const channel = supabase
      .channel(`subscription-${user.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'subscriptions',
        filter: `user_id=eq.${user.id}`,
      }, () => fetchSubscription())
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [fetchSubscription, user?.id])

  const isPremium = subscription.status === 'active' || subscription.status === 'trialing'

  const startCheckout = async (plan: 'monthly' | 'annual') => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { success: false, error: 'Not authenticated' }

    const { data, error } = await supabase.functions.invoke('create-checkout-session', {
      body: { plan },
    })

    if (error || !data?.success) {
      return { success: false, error: data?.error || error?.message }
    }

    window.location.href = data.url
    return { success: true }
  }

  return { subscription, isPremium, isLoading, startCheckout, refetch: fetchSubscription }
}
