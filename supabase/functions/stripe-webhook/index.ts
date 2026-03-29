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
            const { error: idemErr } = await supabase
              .from('stripe_credit_checkout_grants')
              .insert({
                checkout_session_id: session.id,
                user_id: creditUserId,
              })

            if (idemErr?.code === '23505') {
              break
            }
            if (idemErr) {
              console.error('stripe_credit_checkout_grants insert error:', idemErr)
              break
            }

            let grantError: { message: string } | null = null

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
              const { error: upErr } = await supabase
                .from('user_credits')
                .update({
                  extra_time_credits: newExtra,
                  extended_vibe_credits: newExtended,
                  updated_at: new Date().toISOString(),
                })
                .eq('user_id', creditUserId)
              if (upErr) grantError = upErr
            } else {
              const { error: insErr } = await supabase
                .from('user_credits')
                .insert({
                  user_id: creditUserId,
                  extra_time_credits: extraTime,
                  extended_vibe_credits: extendedVibe,
                })
              if (insErr) grantError = insErr
            }

            if (grantError) {
              console.error('Credit grant failed:', grantError)
              await supabase
                .from('stripe_credit_checkout_grants')
                .delete()
                .eq('checkout_session_id', session.id)
              break
            }

            const adjustmentRows: {
              admin_id: null
              user_id: string
              credit_type: string
              previous_value: number
              new_value: number
              adjustment_reason: string
            }[] = []
            if (extraTime > 0) {
              adjustmentRows.push({
                admin_id: null,
                user_id: creditUserId,
                credit_type: 'extra_time',
                previous_value: prevExtra,
                new_value: newExtra,
                adjustment_reason: `stripe_checkout:${packId}:session:${session.id}`,
              })
            }
            if (extendedVibe > 0) {
              adjustmentRows.push({
                admin_id: null,
                user_id: creditUserId,
                credit_type: 'extended_vibe',
                previous_value: prevExtended,
                new_value: newExtended,
                adjustment_reason: `stripe_checkout:${packId}:session:${session.id}`,
              })
            }
            if (adjustmentRows.length > 0) {
              const { error: adjErr } = await supabase.from('credit_adjustments').insert(adjustmentRows)
              if (adjErr) console.error('credit_adjustments insert failed:', adjErr)
            }

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
          provider: 'stripe',
          stripe_customer_id: session.customer as string,
          stripe_subscription_id: subscriptionId,
          status: subscription.status,
          plan: plan,
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,provider' })

        const planMeta = (plan || 'premium') as string
        const tier = planMeta.toLowerCase().includes('vip') ? 'vip' : 'premium'
        await supabase
          .from('profiles')
          .update({ subscription_tier: tier })
          .eq('id', userId)

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
          provider: 'stripe',
          stripe_customer_id: subscription.customer as string,
          stripe_subscription_id: subscription.id,
          status: subscription.status,
          plan: plan,
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,provider' })

        if (subscription.status === 'active' || subscription.status === 'trialing') {
          const price = subscription.items.data[0]?.price as { lookup_key?: string | null } | undefined
          const tierPlanHint = (subscription.metadata?.plan || price?.lookup_key || 'premium') as string
          const tier = tierPlanHint.toLowerCase().includes('vip') ? 'vip' : 'premium'
          await supabase
            .from('profiles')
            .update({ subscription_tier: tier })
            .eq('id', userId)
        } else {
          const { data: profileRow } = await supabase
            .from('profiles')
            .select('premium_until')
            .eq('id', userId)
            .maybeSingle()
          const adminActive = profileRow?.premium_until &&
            new Date(profileRow.premium_until) > new Date()
          await supabase
            .from('profiles')
            .update({ subscription_tier: adminActive ? 'premium' : 'free' })
            .eq('id', userId)
        }

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
          .eq('provider', 'stripe')

        const { data: profile } = await supabase
          .from('profiles')
          .select('premium_until')
          .eq('id', userId)
          .maybeSingle()
        const adminActive = profile?.premium_until && new Date(profile.premium_until) > new Date()
        await supabase
          .from('profiles')
          .update({ subscription_tier: adminActive ? 'premium' : 'free' })
          .eq('id', userId)

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
          .eq('provider', 'stripe')

        break
      }

      default:
        break
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
