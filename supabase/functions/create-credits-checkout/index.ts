import Stripe from 'https://esm.sh/stripe@14.21.0'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
})

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const CREDIT_PACKS = {
  extra_time_3: {
    name: '3× Extra Time',
    description: 'Extend your video date by +2 min, 3 times',
    price: 2.99,
    grants: { extra_time_credits: 3, extended_vibe_credits: 0 },
  },
  extended_vibe_3: {
    name: '3× Extended Vibe',
    description: 'Extend your video date by +5 min, 3 times',
    price: 4.99,
    grants: { extra_time_credits: 0, extended_vibe_credits: 3 },
  },
  bundle_3_3: {
    name: 'Vibe Bundle',
    description: '3× Extra Time (+2 min) + 3× Extended Vibe (+5 min)',
    price: 5.99,
    grants: { extra_time_credits: 3, extended_vibe_credits: 3 },
  },
}

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
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

    const { packId } = await req.json()

    const pack = CREDIT_PACKS[packId as keyof typeof CREDIT_PACKS]
    if (!pack) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid pack ID' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get or create Stripe customer
    const { data: subData } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
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
          currency: 'eur',
          product_data: {
            name: `Vibely ${pack.name}`,
            description: pack.description,
          },
          unit_amount: Math.round(pack.price * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${req.headers.get('origin')}/credits/success?pack=${packId}`,
      cancel_url: `${req.headers.get('origin')}/credits?cancelled=true`,
      metadata: {
        type: 'credits_pack',
        supabase_user_id: user.id,
        pack_id: packId,
        extra_time_credits: String(pack.grants.extra_time_credits),
        extended_vibe_credits: String(pack.grants.extended_vibe_credits),
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
