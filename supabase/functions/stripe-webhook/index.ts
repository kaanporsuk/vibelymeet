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
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.text()
    const signature = req.headers.get('stripe-signature')

    if (!signature) {
      return new Response(
        JSON.stringify({ success: false, error: 'No stripe signature' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verify webhook signature
    let event: Stripe.Event
    try {
      event = stripe.webhooks.constructEvent(
        body,
        signature,
        Deno.env.get('STRIPE_WEBHOOK_SECRET')!
      )
    } catch (err) {
      return new Response(
        JSON.stringify({ success: false, error: `Webhook signature verification failed: ${err.message}` }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const userId = session.metadata?.supabase_user_id

        // Handle event ticket purchase
        if (session.metadata?.type === 'event_ticket') {
          const eventId = session.metadata?.event_id

        if (userId && eventId) {
            // Register user for event (uses profile_id column)
            await supabase
              .from('event_registrations')
              .upsert({
                profile_id: userId,
                event_id: eventId,
                payment_status: 'paid',
              }, { onConflict: 'event_id,profile_id' })
          }
          break
        }

        // Handle credit pack purchase
        if (session.metadata?.type === 'credits_pack') {
          const creditUserId = session.metadata?.supabase_user_id
          const packId = session.metadata?.pack_id || 'unknown'
          const extraTime = parseInt(session.metadata?.extra_time_credits || '0')
          const extendedVibe = parseInt(session.metadata?.extended_vibe_credits || '0')

          if (creditUserId) {
            const { data: existing } = await supabase
              .from('user_credits')
              .select('extra_time_credits, extended_vibe_credits')
              .eq('user_id', creditUserId)
              .maybeSingle()

            const prevExtra = existing?.extra_time_credits ?? 0
            const prevExtended = existing?.extended_vibe_credits ?? 0
            const newExtra = prevExtra + extraTime
            const newExtended = prevExtended + extendedVibe

            if (existing) {
              await supabase
                .from('user_credits')
                .update({
                  extra_time_credits: newExtra,
                  extended_vibe_credits: newExtended,
                  updated_at: new Date().toISOString(),
                })
                .eq('user_id', creditUserId)
            } else {
              await supabase
                .from('user_credits')
                .insert({
                  user_id: creditUserId,
                  extra_time_credits: extraTime,
                  extended_vibe_credits: extendedVibe,
                })
            }

            // Log the purchase to credit_adjustments (note: webhook has no admin_id)
            // We use a placeholder system ID or skip admin_id since this is a purchase
            // The credit_adjustments table requires admin_id, so we log separately
            console.log(`Credits granted: user=${creditUserId}, pack=${packId}, extra_time=+${extraTime}, extended_vibe=+${extendedVibe}`)

            // Send purchase confirmation notification
            try {
              const notifResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-notification`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                },
                body: JSON.stringify({
                  user_id: creditUserId,
                  category: 'credits_subscription',
                  title: 'Credits added! ⚡',
                  body: `${packId} pack purchased`,
                  data: { url: '/settings' },
                }),
              })
              await notifResponse.text()
            } catch (e) {
              console.error('Notification send failed:', e)
            }
          }
          break
        }

        // Handle subscription checkout
        const plan = session.metadata?.plan

        if (!userId || session.mode !== 'subscription') break

        const subscriptionId = session.subscription as string
        const subscription = await stripe.subscriptions.retrieve(subscriptionId)

        await supabase.from('subscriptions').upsert({
          user_id: userId,
          stripe_customer_id: session.customer as string,
          stripe_subscription_id: subscriptionId,
          status: subscription.status,
          plan: plan,
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' })

        // Sync is_premium flag on profile
        await supabase.from('profiles').update({ is_premium: true }).eq('id', userId)

        break
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        const userId = subscription.metadata?.supabase_user_id

        if (!userId) break

        const plan = subscription.metadata?.plan || 
          (subscription.items.data[0]?.price.id === Deno.env.get('STRIPE_ANNUAL_PRICE_ID') 
            ? 'annual' 
            : 'monthly')

        await supabase.from('subscriptions').upsert({
          user_id: userId,
          stripe_customer_id: subscription.customer as string,
          stripe_subscription_id: subscription.id,
          status: subscription.status,
          plan: plan,
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' })

        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        const userId = subscription.metadata?.supabase_user_id

        if (!userId) break

        await supabase.from('subscriptions')
          .update({
            status: 'canceled',
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId)

        // Sync is_premium flag on profile
        await supabase.from('profiles').update({ is_premium: false }).eq('id', userId)

        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const subscriptionId = invoice.subscription as string

        if (!subscriptionId) break

        const subscription = await stripe.subscriptions.retrieve(subscriptionId)
        const userId = subscription.metadata?.supabase_user_id

        if (!userId) break

        await supabase.from('subscriptions')
          .update({
            status: 'past_due',
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId)

        break
      }

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    return new Response(
      JSON.stringify({ success: true, received: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
