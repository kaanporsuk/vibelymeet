import Stripe from 'https://esm.sh/stripe@14.21.0'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
})

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function pickAdmissionStatus(result: unknown): string | null {
  const root = asRecord(result)
  if (!root) return null
  if (typeof root.admission_status === 'string') return root.admission_status
  const nested = asRecord(root.result)
  if (nested && typeof nested.admission_status === 'string') return nested.admission_status
  return null
}

function pickResultCode(result: unknown): string {
  const root = asRecord(result)
  if (!root) return 'ok'
  if (typeof root.outcome === 'string') return root.outcome
  if (typeof root.action === 'string') return root.action
  const nested = asRecord(root.result)
  if (nested && typeof nested.action === 'string') return nested.action
  return 'ok'
}

function logLifecycle(payload: {
  event_id: string | null
  session_id?: string | null
  user_id: string | null
  admission_status: string | null
  queue_id?: string | null
  category: string
  result: string
  error_reason?: string | null
}) {
  console.log('lifecycle.stripe_webhook', JSON.stringify(payload))
}

/** Non-2xx tells Stripe to retry; use only for transient / unknown DB failures (not RPC business `success: false`). */
function stripeRetryResponse(
  corsHeaders: Record<string, string>,
  message: string,
  extra?: Record<string, unknown>
) {
  return new Response(
    JSON.stringify({ success: false, received: false, error: message, ...extra }),
    { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

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

    /** When true, respond 500 so Stripe retries (transient / infra). Not used for RPC `success: false` business outcomes. */
    let requestStripeRetry = false

    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const userId = session.metadata?.supabase_user_id

        // Handle event ticket purchase
        if (session.metadata?.type === 'event_ticket') {
          const eventId = session.metadata?.event_id

          if (userId && eventId) {
            const { data: settleResult, error: settleError } = await supabase.rpc(
              'settle_event_ticket_checkout',
              {
                p_checkout_session_id: session.id,
                p_profile_id: userId,
                p_event_id: eventId,
              },
            )
            if (settleError) {
              console.error('settle_event_ticket_checkout error:', settleError)
              logLifecycle({
                event_id: eventId,
                user_id: userId,
                admission_status: null,
                category: 'stripe_event_ticket_settlement',
                result: 'rpc_error',
                error_reason: settleError.message,
              })
              requestStripeRetry = true
              break
            }
            console.log('settle_event_ticket_checkout:', JSON.stringify(settleResult))
            const settled = settleResult as { success?: boolean; idempotent?: boolean } | null
            logLifecycle({
              event_id: eventId,
              user_id: userId,
              admission_status: pickAdmissionStatus(settleResult),
              category: 'stripe_event_ticket_settlement',
              result: pickResultCode(settleResult),
              error_reason: settled?.success === false ? (settled as { code?: string }).code ?? 'business_reject' : null,
            })
            // RPC returned JSON with success: false (event closed, tier mismatch, etc.) — final; do not retry.
          } else {
            logLifecycle({
              event_id: eventId ?? null,
              user_id: userId ?? null,
              admission_status: null,
              category: 'stripe_event_ticket_settlement',
              result: 'rejected',
              error_reason: 'missing_user_or_event',
            })
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
              requestStripeRetry = true
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
              requestStripeRetry = true
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

        const { error: subUpsertErr } = await supabase.from('subscriptions').upsert({
          user_id: userId,
          provider: 'stripe',
          stripe_customer_id: session.customer as string,
          stripe_subscription_id: subscriptionId,
          status: subscription.status,
          plan: plan,
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,provider' })

        if (subUpsertErr) {
          console.error('subscriptions upsert (checkout.session.completed):', subUpsertErr)
          requestStripeRetry = true
          break
        }

        const planMeta = (plan || 'premium') as string
        const tier = planMeta.toLowerCase().includes('vip') ? 'vip' : 'premium'
        const { error: profileTierErr } = await supabase
          .from('profiles')
          .update({ subscription_tier: tier })
          .eq('id', userId)

        if (profileTierErr) {
          console.error('profiles subscription_tier update (checkout.session.completed):', profileTierErr)
          requestStripeRetry = true
          break
        }

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

        const { error: subLifecycleUpsertErr } = await supabase.from('subscriptions').upsert({
          user_id: userId,
          provider: 'stripe',
          stripe_customer_id: subscription.customer as string,
          stripe_subscription_id: subscription.id,
          status: subscription.status,
          plan: plan,
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,provider' })

        if (subLifecycleUpsertErr) {
          console.error('subscriptions upsert (customer.subscription.updated):', subLifecycleUpsertErr)
          requestStripeRetry = true
          break
        }

        if (subscription.status === 'active' || subscription.status === 'trialing') {
          const price = subscription.items.data[0]?.price as { lookup_key?: string | null } | undefined
          const tierPlanHint = (subscription.metadata?.plan || price?.lookup_key || 'premium') as string
          const tier = tierPlanHint.toLowerCase().includes('vip') ? 'vip' : 'premium'
          const { error: activeTierErr } = await supabase
            .from('profiles')
            .update({ subscription_tier: tier })
            .eq('id', userId)
          if (activeTierErr) {
            console.error('profiles subscription_tier update (customer.subscription.updated, active):', activeTierErr)
            requestStripeRetry = true
            break
          }
        } else {
          const { data: profileRow, error: profileReadErr } = await supabase
            .from('profiles')
            .select('premium_until')
            .eq('id', userId)
            .maybeSingle()
          if (profileReadErr) {
            console.error('profiles select premium_until (customer.subscription.updated):', profileReadErr)
            requestStripeRetry = true
            break
          }
          const adminActive = profileRow?.premium_until &&
            new Date(profileRow.premium_until) > new Date()
          const { error: inactiveTierErr } = await supabase
            .from('profiles')
            .update({ subscription_tier: adminActive ? 'premium' : 'free' })
            .eq('id', userId)
          if (inactiveTierErr) {
            console.error('profiles subscription_tier update (customer.subscription.updated, inactive):', inactiveTierErr)
            requestStripeRetry = true
            break
          }
        }

        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        const userId = subscription.metadata?.supabase_user_id

        if (!userId) break

        const { error: subCanceledErr } = await supabase.from('subscriptions')
          .update({
            status: 'canceled',
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId)
          .eq('provider', 'stripe')

        if (subCanceledErr) {
          console.error('subscriptions update canceled (customer.subscription.deleted):', subCanceledErr)
          requestStripeRetry = true
          break
        }

        const { data: profile, error: profileReadErr } = await supabase
          .from('profiles')
          .select('premium_until')
          .eq('id', userId)
          .maybeSingle()
        if (profileReadErr) {
          console.error('profiles select premium_until (customer.subscription.deleted):', profileReadErr)
          requestStripeRetry = true
          break
        }
        const adminActive = profile?.premium_until && new Date(profile.premium_until) > new Date()
        const { error: deletedTierErr } = await supabase
          .from('profiles')
          .update({ subscription_tier: adminActive ? 'premium' : 'free' })
          .eq('id', userId)
        if (deletedTierErr) {
          console.error('profiles subscription_tier update (customer.subscription.deleted):', deletedTierErr)
          requestStripeRetry = true
          break
        }

        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const subscriptionId = invoice.subscription as string

        if (!subscriptionId) break

        const subscription = await stripe.subscriptions.retrieve(subscriptionId)
        const userId = subscription.metadata?.supabase_user_id

        if (!userId) break

        const { error: pastDueErr } = await supabase.from('subscriptions')
          .update({
            status: 'past_due',
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId)
          .eq('provider', 'stripe')

        if (pastDueErr) {
          console.error('subscriptions update past_due (invoice.payment_failed):', pastDueErr)
          requestStripeRetry = true
          break
        }

        break
      }

      default:
        break
    }

    if (requestStripeRetry) {
      return stripeRetryResponse(
        corsHeaders,
        'checkout_processing_failed',
        { hint: 'Stripe will retry this webhook; settlement was not acknowledged as complete.' }
      )
    }

    return new Response(
      JSON.stringify({ success: true, received: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return stripeRetryResponse(
      corsHeaders,
      error instanceof Error ? error.message : 'webhook_handler_exception'
    )
  }
})
