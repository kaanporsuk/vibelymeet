import Stripe from 'https://esm.sh/stripe@14.21.0'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.88.0'
import { getCreditPack } from '../_shared/creditPacks.ts'
import { recordPaymentObservability } from '../_shared/paymentObservability.ts'
import {
  corsHeadersForRequest,
  isBrowserOriginRejected,
  jsonResponse,
  preflightResponse,
  requestOriginOrDefault,
} from '../_shared/cors.ts'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
})

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return preflightResponse(req)
  }
  if (isBrowserOriginRejected(req)) {
    return jsonResponse(req, { success: false, error: 'origin_not_allowed' }, { status: 403 })
  }
  const corsHeaders = corsHeadersForRequest(req)

  let observedUserId: string | null = null
  let observedPackId: string | null = null

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'No authorization header' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )

    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    observedUserId = user.id

    const { packId } = await req.json()
    observedPackId = typeof packId === 'string' ? packId : null

    const pack = getCreditPack(packId)
    if (!pack) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid pack ID' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const origin = requestOriginOrDefault(req)

    // Get or create Stripe customer (web uses Stripe provider)
    const { data: subData } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .eq('provider', 'stripe')
      .maybeSingle()

    let customerId = subData?.stripe_customer_id

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      })
      customerId = customer.id
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `Vibely ${pack.name}`,
            description: pack.description,
          },
          unit_amount: Math.round(pack.priceEur * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${origin}/credits/success?pack=${packId}`,
      cancel_url: `${origin}/credits?cancelled=true`,
      metadata: {
        type: 'credits_pack',
        supabase_user_id: user.id,
        pack_id: packId,
        extra_time_credits: String(pack.grants.extra_time_credits),
        extended_vibe_credits: String(pack.grants.extended_vibe_credits),
      },
    })

    await recordPaymentObservability(supabase, {
      category: 'checkout_session_created',
      status: 'created',
      result: 'credits_checkout_created',
      checkout_session_id: session.id,
      stripe_customer_id: customerId,
      user_id: user.id,
      pack_id: packId,
      amount: Math.round(pack.priceEur * 100),
      currency: 'eur',
      metadata_summary: {
        mode: 'payment',
        type: 'credits_pack',
        extra_time_credits: pack.grants.extra_time_credits,
        extended_vibe_credits: pack.grants.extended_vibe_credits,
      },
    })

    return new Response(
      JSON.stringify({ success: true, url: session.url }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await recordPaymentObservability(supabase, {
      category: 'checkout_session_failed',
      status: 'failed',
      result: 'credits_checkout_failed',
      error_code: message,
      user_id: observedUserId,
      pack_id: observedPackId,
      metadata_summary: { mode: 'payment', type: 'credits_pack' },
    })
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
