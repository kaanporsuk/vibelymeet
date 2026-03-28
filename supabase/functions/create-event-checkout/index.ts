import Stripe from 'https://esm.sh/stripe@14.21.0'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
})

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

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

    const { eventId, eventTitle, price, currency = 'eur' } = await req.json()

    if (!eventId || !eventTitle || price === undefined) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required fields: eventId, eventTitle, price' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Guard: check user is not already registered
    const { data: existing } = await supabase
      .from('event_registrations')
      .select('id')
      .eq('event_id', eventId)
      .eq('profile_id', user.id)
      .maybeSingle()

    if (existing) {
      return new Response(
        JSON.stringify({ success: false, error: 'Already registered for this event' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Guard: enforce premium-only event visibility
    const { data: eventData } = await supabase
      .from('events')
      .select('visibility')
      .eq('id', eventId)
      .maybeSingle()

    if (eventData?.visibility === 'premium' || eventData?.visibility === 'vip') {
      const { data: userTier, error: tierErr } = await supabase
        .rpc('get_user_tier', { p_user_id: user.id })

      if (tierErr) {
        return new Response(
          JSON.stringify({ success: false, error: 'Could not verify subscription tier' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const effectiveTier = (userTier as string) || 'free'
      const eventVisibility = eventData.visibility as string

      const ACCESS_MAP: Record<string, string[]> = {
        free: ['free'],
        premium: ['free', 'premium'],
        vip: ['free', 'premium', 'vip'],
      }

      const accessibleTiers = ACCESS_MAP[effectiveTier] || ACCESS_MAP.free

      if (!accessibleTiers.includes(eventVisibility)) {
        const requiredLabel = eventVisibility === 'vip' ? 'VIP' : 'Premium'
        return new Response(
          JSON.stringify({
            success: false,
            error: `This event requires a ${requiredLabel} subscription`,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // Get or create Stripe customer
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
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency,
          product_data: {
            name: `Vibely Event Ticket`,
            description: eventTitle,
          },
          unit_amount: Math.round(price * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${req.headers.get('origin')}/event-payment/success?event_id=${eventId}`,
      cancel_url: `${req.headers.get('origin')}/events/${eventId}`,
      metadata: {
        type: 'event_ticket',
        supabase_user_id: user.id,
        event_id: eventId,
      },
    })

    return new Response(
      JSON.stringify({ success: true, url: session.url }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})