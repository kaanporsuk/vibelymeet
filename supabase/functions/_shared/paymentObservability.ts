const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type InsertBuilder = {
  insert: (row: Record<string, unknown>) => PromiseLike<{ error: { message?: string } | null }>
}

export type PaymentObservabilityClient = {
  from: (table: string) => InsertBuilder
}

export type PaymentObservabilityEvent = {
  category: string
  status: string
  result?: string | null
  error_code?: string | null
  stripe_event_id?: string | null
  event_type?: string | null
  checkout_session_id?: string | null
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
  user_id?: string | null
  paid_event_id?: string | null
  pack_id?: string | null
  plan?: string | null
  amount?: number | null
  currency?: string | null
  metadata_summary?: Record<string, unknown>
}

export function safeUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_RE.test(value) ? value : null
}

export function safeText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed.slice(0, 256) : null
}

export function safeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null
}

export async function recordPaymentObservability(
  supabase: PaymentObservabilityClient,
  event: PaymentObservabilityEvent,
) {
  const { error } = await supabase
    .from('payment_observability_events')
    .insert({
      category: event.category,
      status: event.status,
      result: safeText(event.result),
      error_code: safeText(event.error_code),
      stripe_event_id: safeText(event.stripe_event_id),
      event_type: safeText(event.event_type),
      checkout_session_id: safeText(event.checkout_session_id),
      stripe_customer_id: safeText(event.stripe_customer_id),
      stripe_subscription_id: safeText(event.stripe_subscription_id),
      user_id: safeUuid(event.user_id),
      paid_event_id: safeUuid(event.paid_event_id),
      pack_id: safeText(event.pack_id),
      plan: safeText(event.plan),
      amount: safeInteger(event.amount),
      currency: safeText(event.currency),
      metadata_summary: event.metadata_summary ?? {},
    })

  if (error) {
    console.warn('payment_observability_insert_failed', {
      category: event.category,
      status: event.status,
      result: event.result ?? null,
      error_code: error.message ?? 'unknown',
    })
  }
}
