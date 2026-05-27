import Stripe from 'https://esm.sh/stripe@14.21.0'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.88.0'
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
  let observedPlan: string | null = null

  try {
    // Get authenticated user
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

    const { plan } = await req.json()
    observedPlan = typeof plan === 'string' ? plan : null
    if (!plan || !['monthly', 'annual'].includes(plan)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid plan. Must be monthly or annual.' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const priceId = plan === 'monthly'
      ? Deno.env.get('STRIPE_MONTHLY_PRICE_ID')!
      : Deno.env.get('STRIPE_ANNUAL_PRICE_ID')!

    // Get or create Stripe customer (web uses Stripe provider)
    const { data: existingSub } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .eq('provider', 'stripe')
      .maybeSingle()

    let customerId = existingSub?.stripe_customer_id

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      })
      customerId = customer.id
    }

    const origin = requestOriginOrDefault(req)

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${origin}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/subscription/cancel`,
      metadata: {
        supabase_user_id: user.id,
        plan,
      },
      subscription_data: {
        metadata: {
          supabase_user_id: user.id,
          plan,
        },
      },
    })

    await recordPaymentObservability(supabase, {
      category: 'checkout_session_created',
      status: 'created',
      result: 'subscription_checkout_created',
      checkout_session_id: session.id,
      stripe_customer_id: customerId,
      user_id: user.id,
      plan,
      metadata_summary: { mode: 'subscription' },
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
      result: 'subscription_checkout_failed',
      error_code: message,
      user_id: observedUserId,
      plan: observedPlan,
      metadata_summary: { mode: 'subscription' },
    })
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
