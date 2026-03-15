/**
 * RevenueCat webhook: sync native (iOS/Android) subscription events to canonical subscriptions table.
 * app_user_id must be the Supabase auth user id (set via Purchases.logIn(app_user_id) in the app).
 * Requires REVENUECAT_WEBHOOK_AUTHORIZATION secret; configure the same value in RevenueCat dashboard.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type RCEvent = {
  type?: string
  id?: string
  app_user_id?: string
  original_app_user_id?: string
  product_id?: string
  expiration_at_ms?: number | null
  purchased_at_ms?: number
  period_type?: string
  environment?: string
  store?: string
}

function toPeriodEnd(ms: number | null | undefined): string | null {
  if (ms == null) return null
  return new Date(ms).toISOString()
}

function planFromProductId(productId: string | undefined): string | null {
  if (!productId) return null
  const lower = productId.toLowerCase()
  if (lower.includes('annual') || lower.includes('yearly')) return 'annual'
  if (lower.includes('monthly') || lower.includes('month')) return 'monthly'
  return productId
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization')
  const expectedAuth = Deno.env.get('REVENUECAT_WEBHOOK_AUTHORIZATION')
  if (!expectedAuth || expectedAuth.trim() === '') {
    console.error('RevenueCat webhook: REVENUECAT_WEBHOOK_AUTHORIZATION secret is not set')
    return new Response(
      JSON.stringify({ success: false, error: 'Webhook not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
  if (authHeader !== expectedAuth && authHeader !== `Bearer ${expectedAuth}`) {
    return new Response(
      JSON.stringify({ success: false, error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const payload = await req.json() as { event?: RCEvent } & RCEvent
    const event: RCEvent = payload.event ?? payload

    const eventType = event.type
    const appUserId = event.app_user_id ?? event.original_app_user_id

    // TEST and TRANSFER may have no app_user_id per RevenueCat docs; acknowledge and skip DB write
    if ((eventType === 'TEST' || eventType === 'TRANSFER') && !appUserId) {
      console.log(`RevenueCat webhook ${eventType} (no app_user_id): acknowledged`)
      return new Response(
        JSON.stringify({ success: true, received: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if (!appUserId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing app_user_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const provider = 'revenuecat'
    const plan = planFromProductId(event.product_id)
    const currentPeriodEnd = toPeriodEnd(event.expiration_at_ms ?? undefined)
    const isTrialing = event.period_type === 'TRIAL'

    switch (eventType) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'UNCANCELLATION':
      case 'SUBSCRIPTION_EXTENDED':
      case 'TEMPORARY_ENTITLEMENT_GRANT': {
        const { error } = await supabase.from('subscriptions').upsert(
          {
            user_id: appUserId,
            provider,
            status: isTrialing ? 'trialing' : 'active',
            plan,
            current_period_end: currentPeriodEnd,
            rc_product_id: event.product_id ?? null,
            rc_original_app_user_id: event.original_app_user_id ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,provider' }
        )
        if (error) {
          console.error('RevenueCat webhook upsert error:', error)
          return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
        break
      }

      case 'CANCELLATION':
      case 'EXPIRATION': {
        const status = eventType === 'EXPIRATION' ? 'inactive' : 'canceled'
        const { error } = await supabase
          .from('subscriptions')
          .update({
            status,
            current_period_end: currentPeriodEnd,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', appUserId)
          .eq('provider', provider)
        if (error) {
          console.error('RevenueCat webhook update error:', error)
          return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
        break
      }

      case 'BILLING_ISSUE': {
        const { error } = await supabase
          .from('subscriptions')
          .update({
            status: 'past_due',
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', appUserId)
          .eq('provider', provider)
        if (error) console.error('RevenueCat webhook billing_issue update error:', error)
        break
      }

      case 'TEST':
        break

      default:
        console.log(`RevenueCat webhook unhandled type: ${eventType}`)
    }

    return new Response(
      JSON.stringify({ success: true, received: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('RevenueCat webhook error:', error)
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
