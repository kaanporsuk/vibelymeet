/**
 * RevenueCat webhook: sync native (iOS/Android) subscription events to canonical subscriptions table.
 * app_user_id must be the Supabase auth user id (set via Purchases.logIn(app_user_id) in the app).
 * Requires REVENUECAT_WEBHOOK_AUTHORIZATION secret; configure the same value in RevenueCat dashboard.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  downgradeRevenueCatSubscriptionRow,
  upsertActiveRevenueCatSubscription,
} from '../_shared/revenuecatSubscription.ts'

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization')
  const expectedAuth = Deno.env.get('REVENUECAT_WEBHOOK_AUTHORIZATION')
  if (!expectedAuth || expectedAuth.trim() === '') {
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

    if ((eventType === 'TEST' || eventType === 'TRANSFER') && !appUserId) {
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

    switch (eventType) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'UNCANCELLATION':
      case 'SUBSCRIPTION_EXTENDED':
      case 'TEMPORARY_ENTITLEMENT_GRANT':
      case 'TRANSFER':
      case 'PRODUCT_CHANGE': {
        if (!event.product_id?.trim()) break
        const { error } = await upsertActiveRevenueCatSubscription(supabase, appUserId, {
          productId: event.product_id,
          expirationAtMs: event.expiration_at_ms,
          periodType: event.period_type ?? null,
          originalAppUserId: event.original_app_user_id ?? null,
        })
        if (error) {
          return new Response(
            JSON.stringify({ success: false, error }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
        break
      }

      case 'CANCELLATION':
      case 'EXPIRATION': {
        const { error } = await downgradeRevenueCatSubscriptionRow(
          supabase,
          appUserId,
          eventType === 'EXPIRATION' ? 'EXPIRATION' : 'CANCELLATION',
          event.expiration_at_ms
        )
        if (error) {
          return new Response(
            JSON.stringify({ success: false, error }),
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
          .eq('provider', 'revenuecat')
        if (error) {
          return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
        break
      }

      case 'TEST':
        break

      default:
        break
    }

    return new Response(
      JSON.stringify({ success: true, received: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
