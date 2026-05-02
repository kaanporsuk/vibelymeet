import Stripe from 'https://esm.sh/stripe@14.21.0'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
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
  let observedCustomerId: string | null = null

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

    const { data: sub } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .eq('provider', 'stripe')
      .maybeSingle()

    if (!sub?.stripe_customer_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'No billing account found' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    observedCustomerId = sub.stripe_customer_id

    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${requestOriginOrDefault(req)}/settings`,
    })

    await recordPaymentObservability(supabase, {
      category: 'portal_session_created',
      status: 'created',
      result: 'stripe_portal_session_created',
      stripe_customer_id: sub.stripe_customer_id,
      user_id: user.id,
      metadata_summary: { destination: 'settings' },
    })

    return new Response(
      JSON.stringify({ success: true, url: session.url }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await recordPaymentObservability(supabase, {
      category: 'portal_session_failed',
      status: 'failed',
      result: 'stripe_portal_session_failed',
      error_code: message,
      stripe_customer_id: observedCustomerId,
      user_id: observedUserId,
    })
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
