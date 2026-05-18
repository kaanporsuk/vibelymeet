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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function priceToCents(value: unknown): number | null {
  const n = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : Number.NaN
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

function eventIsClosedBySchedule(eventDate: unknown, durationMinutes: unknown): boolean {
  if (typeof eventDate !== 'string' || !eventDate) return true
  const startsAt = new Date(eventDate).getTime()
  if (!Number.isFinite(startsAt)) return true
  const duration = typeof durationMinutes === 'number' && Number.isFinite(durationMinutes)
    ? durationMinutes
    : 60
  return Date.now() >= startsAt + duration * 60_000
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return preflightResponse(req)
  }
  if (isBrowserOriginRejected(req)) {
    return jsonResponse(req, { success: false, error: 'origin_not_allowed' }, { status: 403 })
  }

  let observedUserId: string | null = null
  let observedEventId: string | null = null
  let observedAmount: number | null = null
  let observedCurrency: string | null = null

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return jsonResponse(req, { success: false, error: 'No authorization header' }, { status: 401 })
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )

    if (authError || !user) {
      return jsonResponse(req, { success: false, error: 'Unauthorized' }, { status: 401 })
    }
    observedUserId = user.id

    const body = await req.json().catch(() => ({})) as { eventId?: unknown }
    const eventId = typeof body.eventId === 'string' ? body.eventId.trim() : ''
    observedEventId = eventId || null

    if (!eventId || !UUID_RE.test(eventId)) {
      return jsonResponse(req, { success: false, error: 'Missing or invalid eventId' }, { status: 400 })
    }

    const { data: existing, error: existingError } = await supabase
      .from('event_registrations')
      .select('id')
      .eq('event_id', eventId)
      .eq('profile_id', user.id)
      .maybeSingle()

    if (existingError) throw existingError
    if (existing) {
      return jsonResponse(req, { success: false, error: 'Already registered for this event' }, { status: 409 })
    }

    const { data: eventData, error: eventError } = await supabase
      .from('events')
      .select('id,title,visibility,status,archived_at,ended_at,is_free,price_amount,price_currency,event_date,duration_minutes')
      .eq('id', eventId)
      .maybeSingle()

    if (eventError) throw eventError
    if (!eventData) {
      return jsonResponse(req, { success: false, error: 'Event not found' }, { status: 404 })
    }

    const status = typeof eventData.status === 'string' ? eventData.status.toLowerCase() : null
    const closedByStatus = status === 'draft' || status === 'cancelled' || status === 'archived'
    if (eventData.archived_at || eventData.ended_at || closedByStatus || eventIsClosedBySchedule(eventData.event_date, eventData.duration_minutes)) {
      return jsonResponse(req, { success: false, error: 'Event is no longer available' }, { status: 409 })
    }

    const amountCents = priceToCents(eventData.price_amount)
    const currency = String(eventData.price_currency || 'EUR').trim().toLowerCase()
    observedAmount = amountCents
    observedCurrency = currency

    if (eventData.is_free || amountCents == null || amountCents <= 0) {
      return jsonResponse(req, { success: false, error: 'Use free event registration for this event' }, { status: 409 })
    }

    const { data: capabilityData, error: capabilityError } = await supabase
      .rpc('get_user_tier_capabilities', { p_user_id: user.id })

    if (capabilityError) {
      return jsonResponse(req, { success: false, error: 'Could not verify subscription capabilities' }, { status: 503 })
    }

    const capabilities = capabilityData && typeof capabilityData === 'object' && !Array.isArray(capabilityData)
      ? capabilityData as Record<string, unknown>
      : {}
    const accessibleTiers = Array.isArray(capabilities.accessibleEventTiers)
      ? capabilities.accessibleEventTiers.filter((tier): tier is string => typeof tier === 'string')
      : ['free']
    const eventVisibility = typeof eventData.visibility === 'string' && eventData.visibility.trim()
      ? eventData.visibility
      : 'all'

    if (eventVisibility !== 'all' && !accessibleTiers.includes(eventVisibility)) {
      const requiredLabel = eventVisibility === 'vip' ? 'VIP' : 'Premium'
      return jsonResponse(req, {
        success: false,
        error: `This event requires a ${requiredLabel} subscription`,
      }, { status: 403 })
    }

    const monthlyEventJoins = capabilities.monthlyEventJoins
    if (typeof monthlyEventJoins === 'number' && Number.isFinite(monthlyEventJoins)) {
      const now = new Date()
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
      const { count, error: monthlyCountError } = await supabase
        .from('event_registrations')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', user.id)
        .gte('registered_at', monthStart)
        .in('admission_status', ['confirmed', 'waitlisted'])

      if (monthlyCountError) {
        return jsonResponse(req, { success: false, error: 'Could not verify monthly event limit' }, { status: 503 })
      }

      if ((count ?? 0) >= monthlyEventJoins) {
        return jsonResponse(req, {
          success: false,
          error: 'Monthly event join limit reached',
          code: 'MONTHLY_EVENT_JOIN_LIMIT_REACHED',
          limit: monthlyEventJoins,
        }, { status: 403 })
      }
    }

    const { data: subData, error: subError } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .eq('provider', 'stripe')
      .maybeSingle()

    if (subError) throw subError
    let customerId = subData?.stripe_customer_id

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      })
      customerId = customer.id
    }

    const origin = requestOriginOrDefault(req)
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{
        price_data: {
          currency,
          product_data: {
            name: 'Vibely Event Ticket',
            description: eventData.title || 'Vibely event',
          },
          unit_amount: amountCents,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${origin}/event-payment/success?event_id=${encodeURIComponent(eventId)}`,
      cancel_url: `${origin}/events/${encodeURIComponent(eventId)}`,
      metadata: {
        type: 'event_ticket',
        supabase_user_id: user.id,
        event_id: eventId,
        expected_amount: String(amountCents),
        expected_currency: currency,
      },
    })

    const { error: intentError } = await supabase
      .from('stripe_event_ticket_checkout_intents')
      .insert({
        checkout_session_id: session.id,
        user_id: user.id,
        event_id: eventId,
        expected_amount: amountCents,
        expected_currency: currency,
        status: 'created',
        metadata: {
          source: 'create-event-checkout',
          event_title_present: Boolean(eventData.title),
        },
      })

    if (intentError) {
      console.error('stripe_event_ticket_checkout_intents insert failed:', intentError)
      try {
        await stripe.checkout.sessions.expire(session.id)
      } catch (expireError) {
        console.error('checkout session expire after intent insert failure:', expireError)
      }
      throw new Error('Could not prepare payment verification')
    }

    await recordPaymentObservability(supabase, {
      category: 'checkout_session_created',
      status: 'created',
      result: 'event_ticket_checkout_created',
      checkout_session_id: session.id,
      stripe_customer_id: customerId,
      user_id: user.id,
      paid_event_id: eventId,
      amount: amountCents,
      currency,
      metadata_summary: { mode: 'payment', type: 'event_ticket', server_priced: true },
    })

    return new Response(
      JSON.stringify({ success: true, url: session.url }),
      { status: 200, headers: { ...corsHeadersForRequest(req), 'Content-Type': 'application/json' } },
    )
  } catch (error) {
    await recordPaymentObservability(supabase, {
      category: 'checkout_session_failed',
      status: 'failed',
      result: 'event_ticket_checkout_failed',
      error_code: errorMessage(error),
      user_id: observedUserId,
      paid_event_id: observedEventId,
      amount: observedAmount,
      currency: observedCurrency,
      metadata_summary: { mode: 'payment', type: 'event_ticket' },
    })
    return jsonResponse(req, { success: false, error: errorMessage(error) }, { status: 500 })
  }
})
