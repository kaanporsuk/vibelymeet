import Stripe from 'https://esm.sh/stripe@14.21.0'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { recordPaymentObservability, safeText, safeUuid } from '../_shared/paymentObservability.ts'

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

type WebhookContext = {
  stripe_event_id: string
  event_type: string
  checkout_session_id: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  user_id: string | null
  paid_event_id: string | null
  pack_id: string | null
  plan: string | null
  amount: number | null
  currency: string | null
  metadata_summary: Record<string, unknown>
}

function stripeId(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function contextFromStripeEvent(event: Stripe.Event): WebhookContext {
  const object = event.data.object as Record<string, unknown>
  const metadata = asRecord(object.metadata) ?? {}
  const checkoutSessionId = event.type === 'checkout.session.completed' ? stripeId(object.id) : null
  const subscriptionId =
    stripeId(object.subscription) ??
    stripeId(object.id && event.type.startsWith('customer.subscription.') ? object.id : null)

  return {
    stripe_event_id: event.id,
    event_type: event.type,
    checkout_session_id: checkoutSessionId,
    stripe_customer_id: stripeId(object.customer),
    stripe_subscription_id: subscriptionId,
    user_id: safeUuid(metadata.supabase_user_id),
    paid_event_id: safeUuid(metadata.event_id),
    pack_id: safeText(metadata.pack_id),
    plan: safeText(metadata.plan),
    amount: typeof object.amount_total === 'number' ? object.amount_total : null,
    currency: safeText(object.currency),
    metadata_summary: {
      metadata_type: safeText(metadata.type),
      has_supabase_user_id: typeof metadata.supabase_user_id === 'string',
      has_event_id: typeof metadata.event_id === 'string',
      has_pack_id: typeof metadata.pack_id === 'string',
      mode: safeText(object.mode),
    },
  }
}

async function recordWebhookEvent(
  category: string,
  status: string,
  result: string,
  context: WebhookContext,
  errorCode?: string | null,
  metadataSummary?: Record<string, unknown>,
) {
  await recordPaymentObservability(supabase, {
    category,
    status,
    result,
    error_code: errorCode ?? null,
    stripe_event_id: context.stripe_event_id,
    event_type: context.event_type,
    checkout_session_id: context.checkout_session_id,
    stripe_customer_id: context.stripe_customer_id,
    stripe_subscription_id: context.stripe_subscription_id,
    user_id: context.user_id,
    paid_event_id: context.paid_event_id,
    pack_id: context.pack_id,
    plan: context.plan,
    amount: context.amount,
    currency: context.currency,
    metadata_summary: metadataSummary ?? context.metadata_summary,
  })
}

async function beginWebhookProcessing(context: WebhookContext) {
  const now = new Date().toISOString()
  const { error: insertError } = await supabase
    .from('stripe_webhook_events')
    .insert({
      stripe_event_id: context.stripe_event_id,
      event_type: context.event_type,
      status: 'processing',
      checkout_session_id: context.checkout_session_id,
      stripe_customer_id: context.stripe_customer_id,
      stripe_subscription_id: context.stripe_subscription_id,
      user_id: context.user_id,
      paid_event_id: context.paid_event_id,
      pack_id: context.pack_id,
      plan: context.plan,
      result: 'processing',
      received_at: now,
      processing_started_at: now,
      updated_at: now,
      metadata_summary: context.metadata_summary,
    })

  if (!insertError) {
    await recordWebhookEvent('webhook_received', 'processing', 'webhook_processing_started', context)
    return { shouldProcess: true, duplicate: false, retrying: false, error: null as string | null }
  }

  if (insertError.code !== '23505') {
    return { shouldProcess: false, duplicate: false, retrying: false, error: insertError.message ?? 'webhook_ledger_insert_failed' }
  }

  const { data: existing, error: readError } = await supabase
    .from('stripe_webhook_events')
    .select('status, result, error_code')
    .eq('stripe_event_id', context.stripe_event_id)
    .maybeSingle()

  if (readError) {
    return { shouldProcess: false, duplicate: true, retrying: false, error: readError.message ?? 'webhook_ledger_read_failed' }
  }

  const existingStatus = existing?.status as string | undefined
  if (existingStatus === 'failed' || existingStatus === 'received') {
    const { data: claimed, error: claimError } = await supabase
      .from('stripe_webhook_events')
      .update({
        status: 'processing',
        result: 'retrying',
        error_code: null,
        processing_started_at: now,
        updated_at: now,
      })
      .eq('stripe_event_id', context.stripe_event_id)
      .in('status', ['failed', 'received'])
      .select('stripe_event_id')
      .maybeSingle()

    if (claimError) {
      return { shouldProcess: false, duplicate: true, retrying: false, error: claimError.message ?? 'webhook_ledger_claim_failed' }
    }
    if (claimed?.stripe_event_id) {
      await recordWebhookEvent('webhook_received', 'processing', 'webhook_retry_started', context)
      return { shouldProcess: true, duplicate: true, retrying: true, error: null as string | null }
    }
  }

  await recordWebhookEvent('webhook_duplicate_replay', 'duplicate_skipped', 'duplicate_skipped', context, null, {
    ...context.metadata_summary,
    existing_status: existingStatus ?? 'unknown',
    existing_result: existing?.result ?? null,
    existing_error_code: existing?.error_code ?? null,
  })
  return { shouldProcess: false, duplicate: true, retrying: false, error: null as string | null }
}

async function completeWebhookProcessing(
  context: WebhookContext,
  status: 'processed' | 'failed' | 'ignored',
  result: string,
  errorCode?: string | null,
) {
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('stripe_webhook_events')
    .update({
      status,
      result,
      error_code: errorCode ?? null,
      processed_at: status === 'processed' || status === 'ignored' ? now : null,
      updated_at: now,
      checkout_session_id: context.checkout_session_id,
      stripe_customer_id: context.stripe_customer_id,
      stripe_subscription_id: context.stripe_subscription_id,
      user_id: context.user_id,
      paid_event_id: context.paid_event_id,
      pack_id: context.pack_id,
      plan: context.plan,
      metadata_summary: context.metadata_summary,
    })
    .eq('stripe_event_id', context.stripe_event_id)

  if (error) {
    console.error('stripe_webhook_events status update failed:', {
      stripe_event_id: context.stripe_event_id,
      event_type: context.event_type,
      status,
      result,
      error_code: error.message,
    })
  }

  await recordWebhookEvent(
    status === 'failed'
      ? 'webhook_settlement_failed'
      : status === 'ignored'
        ? 'webhook_ignored'
        : 'webhook_settlement_succeeded',
    status,
    result,
    context,
    errorCode ?? null,
  )
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

  let activeWebhookContext: WebhookContext | null = null

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
    let finalStatus: 'processed' | 'ignored' = 'processed'
    let finalResult = 'processed'
    let finalErrorCode: string | null = null
    const webhookContext = contextFromStripeEvent(event)
    activeWebhookContext = webhookContext
    const processingClaim = await beginWebhookProcessing(webhookContext)

    if (processingClaim.error) {
      return stripeRetryResponse(corsHeaders, 'stripe_webhook_idempotency_failed', {
        reason: processingClaim.error,
      })
    }

    if (!processingClaim.shouldProcess) {
      return new Response(
        JSON.stringify({
          success: true,
          received: true,
          idempotent: true,
          duplicate: true,
          result: 'duplicate_skipped',
        }),
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
              finalResult = 'event_ticket_settlement_failed'
              finalErrorCode = 'settle_event_ticket_checkout_error'
              break
            }
            console.log('settle_event_ticket_checkout:', JSON.stringify(settleResult))
            const settled = settleResult as { success?: boolean; idempotent?: boolean } | null
            finalResult = `event_ticket_${pickResultCode(settleResult)}`
            finalErrorCode = settled?.success === false ? (settled as { code?: string }).code ?? 'business_reject' : null
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
            finalStatus = 'ignored'
            finalResult = 'event_ticket_missing_metadata'
            finalErrorCode = 'missing_user_or_event'
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
              finalResult = 'credits_checkout_duplicate_grant_skipped'
              await recordWebhookEvent(
                'credits_pack_settled',
                'processed',
                'duplicate_checkout_session_skipped',
                webhookContext,
                null,
                {
                  ...webhookContext.metadata_summary,
                  checkout_session_dedupe: true,
                },
              )
              break
            }
            if (idemErr) {
              console.error('stripe_credit_checkout_grants insert error:', idemErr)
              requestStripeRetry = true
              finalResult = 'credits_grant_idempotency_failed'
              finalErrorCode = 'stripe_credit_checkout_grants_insert_failed'
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
              finalResult = 'credits_grant_failed'
              finalErrorCode = 'user_credits_write_failed'
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
              if (adjErr) {
                console.error('credit_adjustments insert failed:', adjErr)
                await recordWebhookEvent(
                  'credits_pack_settled',
                  'processed',
                  'credit_adjustments_insert_failed',
                  webhookContext,
                  'credit_adjustments_insert_failed',
                )
              }
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
              await recordWebhookEvent(
                'credit_settlement_notification_failed',
                'processed',
                'notification_failed',
                webhookContext,
                e instanceof Error ? e.message : 'notification_failed',
              )
            }
            finalResult = 'credits_pack_settled'
          } else {
            finalStatus = 'ignored'
            finalResult = 'credits_pack_missing_metadata'
            finalErrorCode = 'missing_user'
            await recordWebhookEvent(
              'webhook_metadata_invalid',
              'ignored',
              'credits_pack_missing_user',
              webhookContext,
              'missing_user',
            )
          }
          break
        }

        // Handle subscription checkout
        const plan = session.metadata?.plan

        if (!userId || session.mode !== 'subscription') {
          finalStatus = 'ignored'
          finalResult = 'subscription_checkout_missing_metadata'
          finalErrorCode = 'missing_user_or_non_subscription'
          await recordWebhookEvent(
            'webhook_metadata_invalid',
            'ignored',
            'subscription_checkout_missing_metadata',
            webhookContext,
            'missing_user_or_non_subscription',
          )
          break
        }

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
          finalResult = 'subscription_checkout_upsert_failed'
          finalErrorCode = 'subscriptions_upsert_failed'
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
          finalResult = 'subscription_checkout_profile_tier_failed'
          finalErrorCode = 'profiles_tier_update_failed'
          break
        }

        finalResult = 'subscription_checkout_settled'
        break
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        const userId = subscription.metadata?.supabase_user_id

        if (!userId) {
          finalStatus = 'ignored'
          finalResult = 'subscription_updated_missing_metadata'
          finalErrorCode = 'missing_user'
          await recordWebhookEvent(
            'webhook_metadata_invalid',
            'ignored',
            'subscription_updated_missing_user',
            webhookContext,
            'missing_user',
          )
          break
        }

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
          finalResult = 'subscription_updated_upsert_failed'
          finalErrorCode = 'subscriptions_upsert_failed'
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
            finalResult = 'subscription_updated_profile_tier_failed'
            finalErrorCode = 'profiles_tier_update_failed'
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
            finalResult = 'subscription_updated_profile_read_failed'
            finalErrorCode = 'profiles_read_failed'
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
            finalResult = 'subscription_updated_profile_tier_failed'
            finalErrorCode = 'profiles_tier_update_failed'
            break
          }
        }

        finalResult = `subscription_${subscription.status}`
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        const userId = subscription.metadata?.supabase_user_id

        if (!userId) {
          finalStatus = 'ignored'
          finalResult = 'subscription_deleted_missing_metadata'
          finalErrorCode = 'missing_user'
          await recordWebhookEvent(
            'webhook_metadata_invalid',
            'ignored',
            'subscription_deleted_missing_user',
            webhookContext,
            'missing_user',
          )
          break
        }

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
          finalResult = 'subscription_deleted_update_failed'
          finalErrorCode = 'subscriptions_update_failed'
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
          finalResult = 'subscription_deleted_profile_read_failed'
          finalErrorCode = 'profiles_read_failed'
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
          finalResult = 'subscription_deleted_profile_tier_failed'
          finalErrorCode = 'profiles_tier_update_failed'
          break
        }

        finalResult = 'subscription_canceled'
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const subscriptionId = invoice.subscription as string

        if (!subscriptionId) {
          finalStatus = 'ignored'
          finalResult = 'invoice_payment_failed_missing_subscription'
          finalErrorCode = 'missing_subscription'
          await recordWebhookEvent(
            'webhook_metadata_invalid',
            'ignored',
            'invoice_payment_failed_missing_subscription',
            webhookContext,
            'missing_subscription',
          )
          break
        }

        const subscription = await stripe.subscriptions.retrieve(subscriptionId)
        const userId = subscription.metadata?.supabase_user_id

        if (!userId) {
          finalStatus = 'ignored'
          finalResult = 'invoice_payment_failed_missing_user'
          finalErrorCode = 'missing_user'
          await recordWebhookEvent(
            'webhook_metadata_invalid',
            'ignored',
            'invoice_payment_failed_missing_user',
            webhookContext,
            'missing_user',
          )
          break
        }

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
          finalResult = 'invoice_payment_failed_update_failed'
          finalErrorCode = 'subscriptions_update_failed'
          break
        }

        finalResult = 'subscription_past_due'
        break
      }

      default:
        finalStatus = 'ignored'
        finalResult = 'unsupported_event_type'
        break
    }

    if (requestStripeRetry) {
      await completeWebhookProcessing(webhookContext, 'failed', finalResult, finalErrorCode)
      return stripeRetryResponse(
        corsHeaders,
        'stripe_webhook_persist_failed',
        {
          hint:
            'Stripe will retry this webhook; a required database write failed (checkout, subscription lifecycle, or invoice handling) and the event was not fully applied.',
        },
      )
    }

    await completeWebhookProcessing(webhookContext, finalStatus, finalResult, finalErrorCode)

    return new Response(
      JSON.stringify({ success: true, received: true, result: finalResult }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    if (activeWebhookContext) {
      await completeWebhookProcessing(
        activeWebhookContext,
        'failed',
        'webhook_handler_exception',
        error instanceof Error ? error.message : 'webhook_handler_exception',
      )
    }
    return stripeRetryResponse(
      corsHeaders,
      error instanceof Error ? error.message : 'webhook_handler_exception'
    )
  }
})
