/**
 * Shared RevenueCat → subscriptions / profiles sync helpers (Edge Functions only).
 * Use a service_role Supabase client — same authority as revenuecat-webhook.
 */

export function planFromProductId(productId: string | undefined): string | null {
  if (!productId) return null
  const lower = productId.toLowerCase()
  if (lower.includes('annual') || lower.includes('yearly')) return 'annual'
  if (lower.includes('monthly') || lower.includes('month')) return 'monthly'
  return productId
}

export function profileTierFromProductId(productId: string): 'vip' | 'premium' {
  return productId.toLowerCase().includes('vip') ? 'vip' : 'premium'
}

// deno-lint-ignore no-explicit-any
export async function upsertActiveRevenueCatSubscription(supabase: any, appUserId: string, input: {
  productId: string
  expirationAtMs: number | null | undefined
  periodType?: string | null
  originalAppUserId?: string | null
}): Promise<{ error: string | null }> {
  const isTrialing = input.periodType === 'TRIAL'
  const currentPeriodEnd =
    input.expirationAtMs != null && !Number.isNaN(Number(input.expirationAtMs))
      ? new Date(Number(input.expirationAtMs)).toISOString()
      : null
  const plan = planFromProductId(input.productId) ?? input.productId
  const { error } = await supabase.from('subscriptions').upsert(
    {
      user_id: appUserId,
      provider: 'revenuecat',
      status: isTrialing ? 'trialing' : 'active',
      plan,
      current_period_end: currentPeriodEnd,
      rc_product_id: input.productId,
      rc_original_app_user_id: input.originalAppUserId ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,provider' }
  )
  if (error) return { error: error.message }
  const tier = profileTierFromProductId(input.productId)
  const { error: pErr } = await supabase.from('profiles').update({ subscription_tier: tier }).eq('id', appUserId)
  if (pErr) return { error: pErr.message }
  return { error: null }
}

// deno-lint-ignore no-explicit-any
export async function downgradeRevenueCatSubscriptionRow(supabase: any, appUserId: string, eventType: 'EXPIRATION' | 'CANCELLATION', expirationAtMs: number | null | undefined): Promise<{ error: string | null }> {
  const status = eventType === 'EXPIRATION' ? 'inactive' : 'canceled'
  const currentPeriodEnd =
    expirationAtMs != null && !Number.isNaN(Number(expirationAtMs))
      ? new Date(Number(expirationAtMs)).toISOString()
      : null
  const { error } = await supabase
    .from('subscriptions')
    .update({
      status,
      current_period_end: currentPeriodEnd,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', appUserId)
    .eq('provider', 'revenuecat')
  if (error) return { error: error.message }
  const { data: profile } = await supabase.from('profiles').select('premium_until').eq('id', appUserId).maybeSingle()
  const adminActive = profile?.premium_until && new Date(profile.premium_until) > new Date()
  const { error: pErr } = await supabase
    .from('profiles')
    .update({ subscription_tier: adminActive ? 'premium' : 'free' })
    .eq('id', appUserId)
  if (pErr) return { error: pErr.message }
  return { error: null }
}

/** Pick best active entitlement from RevenueCat GET /v1/subscribers response JSON. */
export function pickActiveEntitlementFromSubscriberPayload(body: Record<string, unknown>): {
  productId: string
  expirationAtMs: number | null
  periodType?: string
} | null {
  const subscriber = body.subscriber as Record<string, unknown> | undefined
  const entitlements = (subscriber?.entitlements ?? body.entitlements) as Record<string, Record<string, unknown>> | undefined
  if (!entitlements || typeof entitlements !== 'object') return null
  const now = Date.now()
  let best: { productId: string; expirationAtMs: number | null; periodType?: string; rank: number } | null = null
  for (const [key, raw] of Object.entries(entitlements)) {
    const ent = raw
    const expStr = ent.expires_date as string | null | undefined
    const expiresMs = expStr ? new Date(expStr).getTime() : null
    if (expiresMs != null && !Number.isNaN(expiresMs) && expiresMs <= now) continue
    const productId = ent.product_identifier as string | undefined
    if (!productId) continue
    const kl = key.toLowerCase()
    const pl = productId.toLowerCase()
    const rank = kl.includes('vip') || pl.includes('vip') ? 2 : 1
    const candidate = {
      productId,
      expirationAtMs: expiresMs,
      periodType: ent.period_type as string | undefined,
      rank,
    }
    if (
      !best ||
      candidate.rank > best.rank ||
      (candidate.rank === best.rank && (candidate.expirationAtMs ?? Number.POSITIVE_INFINITY) > (best.expirationAtMs ?? Number.POSITIVE_INFINITY))
    ) {
      best = candidate
    }
  }
  if (!best) return null
  return { productId: best.productId, expirationAtMs: best.expirationAtMs, periodType: best.periodType }
}
