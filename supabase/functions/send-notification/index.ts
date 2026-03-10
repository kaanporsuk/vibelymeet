import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID')!
const ONESIGNAL_REST_API_KEY = Deno.env.get('ONESIGNAL_REST_API_KEY')!
const APP_URL = Deno.env.get('APP_URL') || 'https://vibelymeet.com'

const CATEGORY_TO_COLUMN: Record<string, string> = {
  new_match: 'notify_new_match',
  messages: 'notify_messages',
  someone_vibed_you: 'notify_someone_vibed_you',
  ready_gate: 'notify_ready_gate',
  event_live: 'notify_event_live',
  event_reminder: 'notify_event_reminder',
  date_reminder: 'notify_date_reminder',
  daily_drop: 'notify_daily_drop',
  recommendations: 'notify_recommendations',
  product_updates: 'notify_product_updates',
  credits_subscription: 'notify_credits_subscription',
}

// Categories that bypass quiet hours
const BYPASS_QUIET_HOURS = ['ready_gate', 'safety_alerts']

async function logNotification(
  userId: string,
  category: string,
  title: string,
  body: string,
  data: any,
  delivered: boolean,
  suppressedReason?: string
) {
  await supabase.from('notification_log').insert({
    user_id: userId,
    category,
    title,
    body,
    data,
    delivered,
    suppressed_reason: suppressedReason || null,
  })
}

function isInQuietHours(start: string, end: string, timezone: string): boolean {
  try {
    const now = new Date()
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    const parts = formatter.formatToParts(now)
    const currentHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0')
    const currentMinute = parseInt(parts.find(p => p.type === 'minute')?.value || '0')
    const currentMinutes = currentHour * 60 + currentMinute

    const [startH, startM] = start.split(':').map(Number)
    const [endH, endM] = end.split(':').map(Number)
    const startMinutes = startH * 60 + (startM || 0)
    const endMinutes = endH * 60 + (endM || 0)

    if (startMinutes <= endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes < endMinutes
    } else {
      // Overnight range (e.g. 22:00-08:00)
      return currentMinutes >= startMinutes || currentMinutes < endMinutes
    }
  } catch {
    return false
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // Authenticate: require service role key OR valid user JWT
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const token = authHeader.replace('Bearer ', '')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const isServiceRole = token === serviceKey

    if (!isServiceRole) {
      // Validate as user JWT
      const anonClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
      )
      const { data: claims, error: claimsError } = await anonClient.auth.getClaims(token)
      if (claimsError || !claims?.claims?.sub) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    const { user_id, category, title, body, data, image_url, bypass_preferences } = await req.json()

    if (!user_id || !category) {
      return new Response(
        JSON.stringify({ success: false, error: 'user_id and category required' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Fetch preferences
    let { data: prefs } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', user_id)
      .maybeSingle()

    if (!prefs) {
      // Create defaults
      await supabase.from('notification_preferences').insert({ user_id })
      const { data: newPrefs } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', user_id)
        .maybeSingle()
      prefs = newPrefs
    }

    if (!prefs) {
      await logNotification(user_id, category, title, body, data, false, 'no_preferences')
      return new Response(JSON.stringify({ success: false, reason: 'no_preferences' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 4. Check pause
    if (category !== 'safety_alerts' && prefs.paused_until) {
      if (new Date(prefs.paused_until) > new Date()) {
        await logNotification(user_id, category, title, body, data, false, 'paused')
        return new Response(JSON.stringify({ success: false, reason: 'paused' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    // 5. Check master toggle
    if (!prefs.push_enabled && !bypass_preferences) {
      await logNotification(user_id, category, title, body, data, false, 'user_disabled')
      return new Response(JSON.stringify({ success: false, reason: 'user_disabled' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 6. Check category toggle
    if (category !== 'safety_alerts') {
      const col = CATEGORY_TO_COLUMN[category]
      if (col && prefs[col] === false) {
        await logNotification(user_id, category, title, body, data, false, 'user_disabled')
        return new Response(JSON.stringify({ success: false, reason: 'user_disabled' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    // 7. Check per-match mute (messages and new_match categories)
    if ((category === 'messages' || category === 'new_match') && data?.match_id) {
      // Check match_mutes table (written by useMuteMatch on the client)
      const { data: matchMute } = await supabase
        .from('match_mutes')
        .select('id, muted_until')
        .eq('user_id', user_id)
        .eq('match_id', data.match_id)
        .maybeSingle()

      if (matchMute) {
        if (new Date(matchMute.muted_until) > new Date()) {
          await logNotification(user_id, category, title, body, data, false, 'match_muted')
          return new Response(JSON.stringify({ success: false, reason: 'match_muted' }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        } else {
          // Expired mute — clean up
          await supabase.from('match_mutes').delete().eq('id', matchMute.id)
        }
      }

      // Also check match_notification_mutes table (legacy)
      const { data: notifMute } = await supabase
        .from('match_notification_mutes')
        .select('id, muted_until')
        .eq('user_id', user_id)
        .eq('match_id', data.match_id)
        .maybeSingle()

      if (notifMute) {
        if (!notifMute.muted_until || new Date(notifMute.muted_until) > new Date()) {
          await logNotification(user_id, category, title, body, data, false, 'match_muted')
          return new Response(JSON.stringify({ success: false, reason: 'match_muted' }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        } else {
          // Expired mute — clean up
          await supabase.from('match_notification_mutes').delete().eq('id', notifMute.id)
        }
      }
    }

    // 8. Check quiet hours
    if (prefs.quiet_hours_enabled && !BYPASS_QUIET_HOURS.includes(category)) {
      const inQuiet = isInQuietHours(
        prefs.quiet_hours_start || '22:00',
        prefs.quiet_hours_end || '08:00',
        prefs.quiet_hours_timezone || 'UTC'
      )
      if (inQuiet) {
        await logNotification(user_id, category, title, body, data, false, 'quiet_hours')
        return new Response(JSON.stringify({ success: false, reason: 'quiet_hours' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    // 9. Check throttle (messages only)
    if (category === 'messages' && prefs.message_bundle_enabled) {
      const oneMinuteAgo = new Date(Date.now() - 60000).toISOString()
      const { count } = await supabase
        .from('notification_log')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user_id)
        .eq('category', 'messages')
        .eq('delivered', true)
        .gte('created_at', oneMinuteAgo)

      if ((count || 0) >= 1) {
        await logNotification(user_id, category, title, body, data, false, 'throttled')
        return new Response(JSON.stringify({ success: false, reason: 'throttled' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    // 10. Check player ID
    if (!prefs.onesignal_player_id || !prefs.onesignal_subscribed) {
      await logNotification(user_id, category, title, body, data, false, 'no_player_id')
      return new Response(JSON.stringify({ success: false, reason: 'no_player_id' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 11. Send via OneSignal
    const osPayload: any = {
      app_id: ONESIGNAL_APP_ID,
      include_player_ids: [prefs.onesignal_player_id],
      headings: { en: title },
      contents: { en: body },
      data: data || {},
      url: data?.url ? `${APP_URL}${data.url}` : APP_URL,
    }

    if (image_url) {
      osPayload.chrome_web_image = image_url
    }

    const osResponse = await fetch('https://api.onesignal.com/notifications', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(osPayload),
    })

    const osResult = await osResponse.text()
    console.log('OneSignal response:', osResult)

    // 12. Log success
    await logNotification(user_id, category, title, body, data, true)

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('send-notification error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
