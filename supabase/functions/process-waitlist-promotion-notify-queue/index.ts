import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BATCH = 50

function logLifecycle(payload: {
  event_id: string | null
  session_id?: string | null
  user_id: string | null
  admission_status: string | null
  queue_id: string | null
  category: string
  result: string
  error_reason?: string | null
}) {
  console.log('lifecycle.waitlist_promotion_notify', JSON.stringify(payload))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization') || ''
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    const { data: rows, error: qErr } = await supabase
      .from('waitlist_promotion_notify_queue')
      .select('id, user_id, event_id')
      .is('processed_at', null)
      .order('created_at', { ascending: true })
      .limit(BATCH)

    if (qErr) throw qErr

    let sent = 0
    let failed = 0

    for (const row of rows ?? []) {
      const eventId = row.event_id as string
      const userId = row.user_id as string
      const queueId = row.id as string

      const { data: ev } = await supabase.from('events').select('title').eq('id', eventId).maybeSingle()
      const eventTitle = (ev?.title as string | undefined) ?? 'Your event'

      const notifyRes = await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          user_id: userId,
          category: 'event_waitlist_promoted',
          data: {
            event_id: eventId,
            eventTitle,
            admission_status: 'confirmed',
          },
        }),
      })

      if (!notifyRes.ok) {
        failed++
        logLifecycle({
          event_id: eventId,
          user_id: userId,
          admission_status: 'confirmed',
          queue_id: queueId,
          category: 'event_waitlist_promoted',
          result: 'delivery_error',
          error_reason: `notify_http_${notifyRes.status}`,
        })
        console.error('waitlist-promo notify http', notifyRes.status, await notifyRes.text())
        continue
      }

      let notifyOk = false
      try {
        const payload = (await notifyRes.json()) as { success?: boolean }
        notifyOk = payload.success === true
      } catch {
        notifyOk = false
      }
      if (!notifyOk) {
        failed++
        logLifecycle({
          event_id: eventId,
          user_id: userId,
          admission_status: 'confirmed',
          queue_id: queueId,
          category: 'event_waitlist_promoted',
          result: 'delivery_error',
          error_reason: 'notify_payload_not_success',
        })
        continue
      }

      const { error: upErr } = await supabase
        .from('waitlist_promotion_notify_queue')
        .update({ processed_at: new Date().toISOString() })
        .eq('id', queueId)

      if (upErr) {
        failed++
        logLifecycle({
          event_id: eventId,
          user_id: userId,
          admission_status: 'confirmed',
          queue_id: queueId,
          category: 'event_waitlist_promoted',
          result: 'queue_update_error',
          error_reason: upErr.message,
        })
        console.error('waitlist-promo mark processed', upErr)
        continue
      }
      logLifecycle({
        event_id: eventId,
        user_id: userId,
        admission_status: 'confirmed',
        queue_id: queueId,
        category: 'event_waitlist_promoted',
        result: 'sent',
        error_reason: null,
      })
      sent++
    }

    const payload = { success: true, batch: (rows ?? []).length, sent, failed }
    console.log('process-waitlist-promotion-notify-queue:', JSON.stringify(payload))
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    logLifecycle({
      event_id: null,
      user_id: null,
      admission_status: null,
      queue_id: null,
      category: 'event_waitlist_promoted',
      result: 'error',
      error_reason: e instanceof Error ? e.message : String(e),
    })
    console.error('process-waitlist-promotion-notify-queue error:', e)
    return new Response(JSON.stringify({ success: false, error: String(e) }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
