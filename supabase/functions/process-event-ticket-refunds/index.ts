import Stripe from 'https://esm.sh/stripe@14.21.0'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
})

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

type RefundJob = {
  id: string
  checkout_session_id: string
  profile_id: string
  event_id: string
  payment_intent_id: string
  amount: number
  currency: string
  reason_code: string
  settlement_outcome: string | null
  attempts: number
  max_attempts: number
  metadata: Record<string, unknown>
}

type WorkerRequest = {
  batch_size?: number
  lease_seconds?: number
  dry_run?: boolean
  source?: string
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index)
  }
  return mismatch === 0
}

function authOk(req: Request): boolean {
  const cronSecret = Deno.env.get('CRON_SECRET')?.trim()
  if (!cronSecret) return false
  const authHeader = req.headers.get('Authorization') || ''
  const cronHeader = req.headers.get('x-cron-secret') || ''
  return safeEqual(authHeader, `Bearer ${cronSecret}`) || safeEqual(cronHeader, cronSecret)
}

async function parseBody(req: Request): Promise<WorkerRequest> {
  if (req.method === 'GET') return {}
  const text = await req.text().catch(() => '')
  if (!text.trim()) return {}
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    return {
      batch_size: typeof parsed.batch_size === 'number' ? parsed.batch_size : undefined,
      lease_seconds: typeof parsed.lease_seconds === 'number' ? parsed.lease_seconds : undefined,
      dry_run: parsed.dry_run === true,
      source: typeof parsed.source === 'string' ? parsed.source.slice(0, 80) : undefined,
    }
  } catch {
    return {}
  }
}

function boundedInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value as number)))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function stripeErrorDetails(error: unknown): {
  message: string
  code: string | null
  type: string | null
  statusCode: number | null
} {
  const record = asRecord(error) ?? {}
  const message = error instanceof Error ? error.message : String(error)
  return {
    message,
    code: typeof record.code === 'string' ? record.code : null,
    type: typeof record.type === 'string' ? record.type : null,
    statusCode: typeof record.statusCode === 'number' ? record.statusCode : null,
  }
}

function isAlreadyRefunded(error: unknown): boolean {
  const detail = stripeErrorDetails(error)
  const text = `${detail.code ?? ''} ${detail.message}`.toLowerCase()
  return text.includes('charge_already_refunded') ||
    text.includes('already been refunded') ||
    text.includes('already refunded')
}

function retryAfterSeconds(statusCode: number | null): number {
  if (statusCode === 429) return 60
  if (statusCode == null || statusCode >= 500) return 30
  return 300
}

function permanentProviderFailure(error: unknown): boolean {
  const detail = stripeErrorDetails(error)
  if (detail.statusCode === 429) return false
  if (detail.statusCode != null && detail.statusCode >= 500) return false
  return detail.type === 'StripeInvalidRequestError' || (detail.statusCode != null && detail.statusCode >= 400)
}

function stripeMetadataFor(job: RefundJob): Record<string, string> {
  return {
    source: 'process-event-ticket-refunds',
    checkout_session_id: job.checkout_session_id,
    supabase_user_id: job.profile_id,
    event_id: job.event_id,
    reason_code: job.reason_code,
    settlement_outcome: job.settlement_outcome ?? '',
  }
}

async function completeJob(
  supabase: any,
  job: RefundJob,
  workerId: string,
  args: {
    success: boolean
    providerRefundId?: string | null
    providerRefundStatus?: string | null
    error?: string | null
    retryAfter?: number | null
    permanent?: boolean
    noopAlreadyRefunded?: boolean
  },
): Promise<boolean> {
  const { data, error } = await supabase.rpc('complete_event_ticket_refund_job_v1', {
    p_job_id: job.id,
    p_worker_id: workerId,
    p_success: args.success,
    p_provider_refund_id: args.providerRefundId ?? null,
    p_provider_refund_status: args.providerRefundStatus ?? null,
    p_error: args.error ?? null,
    p_retry_after_seconds: args.retryAfter ?? null,
    p_permanent: args.permanent === true,
    p_noop_already_refunded: args.noopAlreadyRefunded === true,
  })
  if (error) {
    console.error('complete_event_ticket_refund_job_v1 error:', {
      job_id: job.id,
      checkout_session_id: job.checkout_session_id,
      message: error.message,
    })
    return false
  }
  const payload = asRecord(data) ?? {}
  return payload.ok === true
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (!authOk(req)) return json({ ok: false, error: 'Unauthorized' }, 401)

  const startedAt = Date.now()
  const body = await parseBody(req)
  const batchSize = boundedInt(body.batch_size, 25, 1, 100)
  const leaseSeconds = boundedInt(body.lease_seconds, 60, 5, 300)
  const workerId = `event-ticket-refunds-${crypto.randomUUID()}`
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim()
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim()
  if (!supabaseUrl || !serviceKey) return json({ ok: false, error: 'missing_supabase_env' }, 500)

  const supabase = createClient(supabaseUrl, serviceKey)

  if (body.dry_run) {
    const { data, error } = await supabase
      .from('stripe_event_ticket_refunds')
      .select('id,checkout_session_id,event_id,status,attempts,next_attempt_at,claim_expires_at,reason_code')
      .in('status', ['pending', 'failed_retryable', 'processing'])
      .order('next_attempt_at', { ascending: true })
      .limit(batchSize)
    if (error) return json({ ok: false, dry_run: true, error: error.message }, 500)
    return json({
      ok: true,
      dry_run: true,
      worker_id: workerId,
      preview_count: data?.length ?? 0,
      preview: data ?? [],
      latency_ms: Date.now() - startedAt,
    })
  }

  const { data: claimed, error: claimError } = await supabase.rpc('claim_event_ticket_refund_jobs_v1', {
    p_worker_id: workerId,
    p_limit: batchSize,
    p_lease_seconds: leaseSeconds,
  })
  if (claimError) return json({ ok: false, error: claimError.message }, 500)

  const rows = (claimed ?? []) as RefundJob[]
  let refunded = 0
  let retried = 0
  let permanentlyFailed = 0
  let completionFailed = 0
  const failures: Array<{ id: string; checkout_session_id: string; reason: string }> = []

  for (const job of rows) {
    try {
      const refund = await stripe.refunds.create({
        payment_intent: job.payment_intent_id,
        amount: job.amount,
        metadata: stripeMetadataFor(job),
      }, {
        idempotencyKey: `event_ticket_refund:${job.checkout_session_id}`,
      })

      const completed = await completeJob(supabase, job, workerId, {
        success: true,
        providerRefundId: refund.id,
        providerRefundStatus: refund.status ?? 'created',
      })
      if (!completed) {
        completionFailed += 1
        failures.push({ id: job.id, checkout_session_id: job.checkout_session_id, reason: 'completion_rpc_failed' })
        continue
      }
      refunded += 1
    } catch (error) {
      const detail = stripeErrorDetails(error)
      const alreadyRefunded = isAlreadyRefunded(error)
      const permanent = !alreadyRefunded && permanentProviderFailure(error)
      const completed = await completeJob(supabase, job, workerId, {
        success: alreadyRefunded,
        providerRefundStatus: alreadyRefunded ? 'already_refunded' : null,
        error: detail.message,
        retryAfter: retryAfterSeconds(detail.statusCode),
        permanent,
        noopAlreadyRefunded: alreadyRefunded,
      })
      if (!completed) {
        completionFailed += 1
        failures.push({ id: job.id, checkout_session_id: job.checkout_session_id, reason: 'completion_rpc_failed' })
        continue
      }
      if (alreadyRefunded) {
        refunded += 1
      } else if (permanent) {
        permanentlyFailed += 1
        failures.push({ id: job.id, checkout_session_id: job.checkout_session_id, reason: detail.code ?? 'permanent_provider_failure' })
      } else {
        retried += 1
        failures.push({ id: job.id, checkout_session_id: job.checkout_session_id, reason: detail.code ?? 'retryable_provider_failure' })
      }
    }
  }

  console.log(JSON.stringify({
    event: 'event_ticket_refund_worker_run',
    worker_id: workerId,
    source: body.source ?? null,
    claimed: rows.length,
    refunded,
    retried,
    permanently_failed: permanentlyFailed,
    completion_failed: completionFailed,
    latency_ms: Date.now() - startedAt,
  }))

  return json({
    ok: true,
    worker_id: workerId,
    claimed: rows.length,
    refunded,
    retried,
    permanently_failed: permanentlyFailed,
    completion_failed: completionFailed,
    failures,
    latency_ms: Date.now() - startedAt,
  })
})
