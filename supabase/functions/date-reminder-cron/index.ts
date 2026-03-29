import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

type DatePlanRow = {
  id: string
  match_id: string
  starts_at: string | null
  date_suggestion_id: string
}

async function sendNotification(payload: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`send-notification ${res.status}: ${text}`)
  }
}

async function getUserIdsForPlan(plan: DatePlanRow): Promise<string[]> {
  const { data: suggestion } = await supabase
    .from('date_suggestions')
    .select('proposer_id, recipient_id')
    .eq('id', plan.date_suggestion_id)
    .maybeSingle()

  if (!suggestion) return []
  return [suggestion.proposer_id, suggestion.recipient_id].filter(Boolean) as string[]
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

  try {
    const now = Date.now()
    // ~30 min before start (same window as event-reminders SQL)
    const from29 = new Date(now + 29 * 60 * 1000).toISOString()
    const to31 = new Date(now + 31 * 60 * 1000).toISOString()
    // ~5 min before start
    const from4 = new Date(now + 4 * 60 * 1000).toISOString()
    const to6 = new Date(now + 6 * 60 * 1000).toISOString()

    const { data: plans30, error: err30 } = await supabase
      .from('date_plans')
      .select('id, match_id, starts_at, date_suggestion_id')
      .eq('status', 'active')
      .not('starts_at', 'is', null)
      .is('reminder_push_30m_sent_at', null)
      .gte('starts_at', from29)
      .lte('starts_at', to31)

    if (err30) throw err30

    const { data: plans5, error: err5 } = await supabase
      .from('date_plans')
      .select('id, match_id, starts_at, date_suggestion_id')
      .eq('status', 'active')
      .not('starts_at', 'is', null)
      .is('reminder_push_5m_sent_at', null)
      .gte('starts_at', from4)
      .lte('starts_at', to6)

    if (err5) throw err5

    let sent = 0

    for (const plan of (plans30 ?? []) as DatePlanRow[]) {
      const users = await getUserIdsForPlan(plan)
      if (users.length === 0) continue
      try {
        for (const uid of users) {
          await sendNotification({
            user_id: uid,
            category: 'date_reminder',
            title: 'Video date in 30 minutes! 📹',
            body: 'Your video date starts soon — get ready!',
            data: { url: '/matches', match_id: plan.match_id },
          })
          sent++
        }
        await supabase
          .from('date_plans')
          .update({ reminder_push_30m_sent_at: new Date().toISOString() })
          .eq('id', plan.id)
      } catch (e) {
        console.error('date-reminder-cron 30m plan', plan.id, e)
      }
    }

    for (const plan of (plans5 ?? []) as DatePlanRow[]) {
      const users = await getUserIdsForPlan(plan)
      if (users.length === 0) continue
      try {
        for (const uid of users) {
          await sendNotification({
            user_id: uid,
            category: 'date_reminder',
            title: 'Video date starting now! 🔴',
            body: 'Tap to join your video date!',
            data: { url: '/matches', match_id: plan.match_id },
          })
          sent++
        }
        await supabase
          .from('date_plans')
          .update({ reminder_push_5m_sent_at: new Date().toISOString() })
          .eq('id', plan.id)
      } catch (e) {
        console.error('date-reminder-cron 5m plan', plan.id, e)
      }
    }

    console.log(`date-reminder-cron: sent ${sent} reminders`)
    return new Response(JSON.stringify({ success: true, sent }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('date-reminder-cron error:', e)
    return new Response(JSON.stringify({ success: false, error: String(e) }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
