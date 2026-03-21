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

// Map notification category to 8 pref groups (pref_*). If pref is false, skip push. No entry = always send (e.g. safety_alerts).
const NOTIFICATION_TYPE_TO_PREF: Record<string, string> = {
  new_message: 'pref_messages',
  voice_message: 'pref_messages',
  video_message: 'pref_messages',
  message_reaction: 'pref_messages',
  date_proposal_received: 'pref_messages',
  date_proposal_accepted: 'pref_messages',
  date_proposal_declined: 'pref_messages',
  messages: 'pref_messages',
  new_match: 'pref_matches',
  mutual_vibe: 'pref_matches',
  who_liked_you: 'pref_matches',
  event_registered: 'pref_events',
  event_reminder_30m: 'pref_events',
  event_reminder_5m: 'pref_events',
  event_live: 'pref_events',
  event_ended: 'pref_events',
  new_event_city: 'pref_events',
  event_almost_full: 'pref_events',
  event_reminder: 'pref_events',
  daily_drop: 'pref_daily_drop',
  drop_opener: 'pref_daily_drop',
  drop_reply: 'pref_daily_drop',
  drop_expiring: 'pref_daily_drop',
  partner_ready: 'pref_video_dates',
  date_starting: 'pref_video_dates',
  reconnection: 'pref_video_dates',
  ready_gate: 'pref_video_dates',
  date_reminder: 'pref_video_dates',
  vibe_received: 'pref_vibes_social',
  super_vibe: 'pref_vibes_social',
  someone_vibed_you: 'pref_vibes_social',
  premium_teaser: 'pref_marketing',
  re_engagement: 'pref_marketing',
  weekly_summary: 'pref_marketing',
  recommendations: 'pref_marketing',
  product_updates: 'pref_marketing',
}

// Categories that bypass quiet hours (time-critical / safety)
const BYPASS_QUIET_HOURS = ['ready_gate', 'safety_alerts', 'safety']

// Title/body templates for P0 notification types (used when caller omits title or body)
const NOTIFICATION_TEMPLATES: Record<string, { title: string; body: (ctx: any) => string }> = {
  new_message: { title: 'New message', body: (ctx) => `${ctx?.senderName ?? 'Someone'}: ${ctx?.preview ?? 'New message'}` },
  new_match: { title: "It's a vibe! 💜", body: (ctx) => `You matched with ${ctx?.partnerName ?? 'someone'}` },
  daily_drop: { title: 'Daily Drop is ready 💧', body: () => 'Your daily match is waiting. Tap to reveal!' },
  drop_opener: { title: 'New opener received', body: (ctx) => `${ctx?.senderName ?? 'Someone'} sent you a message` },
  drop_reply: { title: 'Reply received!', body: (ctx) => `${ctx?.senderName ?? 'Someone'} replied to your opener` },
  event_reminder_30m: { title: 'Event in 30 minutes ⏰', body: (ctx) => `${ctx?.eventTitle ?? 'Your event'} starts soon. Get ready!` },
  event_reminder_5m: { title: 'Starting in 5 minutes! 🎉', body: (ctx) => `${ctx?.eventTitle ?? 'Your event'} is about to begin` },
  event_live: { title: 'Event is LIVE 🔴', body: (ctx) => `${ctx?.eventTitle ?? 'Event'} has started. Enter the lobby now!` },
  vibe_received: { title: 'Someone vibed you! 💜', body: (ctx) => `${ctx?.senderName ?? 'Someone'} sent you a vibe at ${ctx?.eventTitle ?? 'an event'}` },
  super_vibe: { title: 'Super Vibe! ⭐', body: (ctx) => `${ctx?.senderName ?? 'Someone'} sent you a Super Vibe!` },
  mutual_vibe: { title: "It's a match! 🎉", body: (ctx) => `You and ${ctx?.partnerName ?? 'someone'} vibed each other` },
  partner_ready: { title: 'Your match is ready!', body: () => 'Tap to start your video date' },
  date_proposal_received: { title: 'Date suggestion 📅', body: (ctx) => `${ctx?.senderName ?? 'Someone'} suggested a date` },
  date_proposal_accepted: { title: 'Date accepted! 🎉', body: (ctx) => `${ctx?.partnerName ?? 'Someone'} accepted your date suggestion` },
  welcome: { title: 'Welcome to Vibely! 💜', body: () => 'Complete your profile to start matching' },
  profile_incomplete: { title: 'Almost there! 📸', body: () => 'Add photos to get 3x more matches' },
}

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

/** Parse HH:MM or HH:MM:SS from Postgres TIME / text. */
function timePartsMinutes(timeStr: string): number {
  const parts = timeStr.trim().split(':').map((p) => parseInt(p, 10))
  const h = Number.isFinite(parts[0]) ? parts[0] : 0
  const m = Number.isFinite(parts[1]) ? parts[1] : 0
  return h * 60 + m
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

    const startMinutes = timePartsMinutes(start)
    const endMinutes = timePartsMinutes(end)

    if (startMinutes <= endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes < endMinutes
    }
    // Overnight range (e.g. 22:00 → 08:00)
    return currentMinutes >= startMinutes || currentMinutes < endMinutes
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

    let { user_id, category, title, body, data, image_url, bypass_preferences } = await req.json()

    if (!user_id || !category) {
      return new Response(
        JSON.stringify({ success: false, error: 'user_id and category required' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Apply templates when title or body not provided
    const template = NOTIFICATION_TEMPLATES[category]
    if (template) {
      if (!title || typeof title !== 'string') title = template.title
      if (!body || typeof body !== 'string') body = template.body(data || {})
    }
    if (!title) title = 'Notification'
    if (!body) body = 'You have a new notification'

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

    // 4. Check account-level pause (profiles.is_paused / paused_until)
    if (category !== 'safety_alerts') {
      const { data: profileRow } = await supabase
        .from('profiles')
        .select('is_paused, paused_until')
        .eq('id', user_id)
        .maybeSingle()
      if (profileRow?.is_paused) {
        const until = profileRow.paused_until
        if (until == null || new Date(until) > new Date()) {
          await logNotification(user_id, category, title, body, data, false, 'account_paused')
          return new Response(JSON.stringify({ success: false, reason: 'account_paused' }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }
      }
    }

    // 5. Check notification-prefs pause (paused_until on notification_preferences)
    if (category !== 'safety_alerts' && prefs.paused_until) {
      if (new Date(prefs.paused_until) > new Date()) {
        await logNotification(user_id, category, title, body, data, false, 'paused')
        return new Response(JSON.stringify({ success: false, reason: 'paused' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    // 6. Check master toggle
    if (!prefs.push_enabled && !bypass_preferences) {
      await logNotification(user_id, category, title, body, data, false, 'user_disabled')
      return new Response(JSON.stringify({ success: false, reason: 'user_disabled' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 7. Check category toggle (pref_* groups first, then legacy notify_*)
    if (category !== 'safety_alerts') {
      const prefKey = NOTIFICATION_TYPE_TO_PREF[category]
      if (prefKey && prefs[prefKey] === false) {
        await logNotification(user_id, category, title, body, data, false, 'user_disabled')
        return new Response(JSON.stringify({ success: false, reason: 'user_disabled' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      const col = CATEGORY_TO_COLUMN[category]
      if (col && prefs[col] === false) {
        await logNotification(user_id, category, title, body, data, false, 'user_disabled')
        return new Response(JSON.stringify({ success: false, reason: 'user_disabled' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    // 8. Check per-match mute (messages and new_match categories)
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

    // 9. Message routing: validate fields, optional bundling + multi-message copy
    let finalTitle = title
    let finalBody = body
    let collapseId: string | undefined
    let messagesChatPath: string | null = null
    if (category === 'messages') {
      if (!data?.match_id || !data?.sender_id) {
        // Missing required fields for message notification routing.
        // Log the gap and fall through with whatever URL is in data.
        console.warn('[send-notification] message notification missing match_id or sender_id', {
          has_match_id: !!data?.match_id,
          has_sender_id: !!data?.sender_id,
          user_id,
        })
        // Do not attempt bundling or deep-link override without both fields
      } else {
        messagesChatPath = `/chat/${data.sender_id}`
        // Both fields present — safe to proceed with bundling when enabled
        if (prefs.message_bundle_enabled) {
          collapseId = `msg_${data.match_id}`
          const { count: unreadCount } = await supabase
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('match_id', data.match_id)
            .eq('sender_id', data.sender_id)
            .is('read_at', null)
          const n = unreadCount ?? 0
          if (n > 1) {
            finalTitle = `${title} · ${n} messages`
            finalBody = `${n} new messages`
          }
        }
      }
    }

    // 10. Collect all player IDs (web + mobile) for multi-device delivery
    const playerIds: string[] = []
    if (prefs.onesignal_player_id && prefs.onesignal_subscribed) {
      playerIds.push(prefs.onesignal_player_id)
    }
    if (prefs.mobile_onesignal_player_id && prefs.mobile_onesignal_subscribed) {
      playerIds.push(prefs.mobile_onesignal_player_id)
    }
    if (playerIds.length === 0) {
      await logNotification(user_id, category, title, body, data, false, 'no_player_id')
      return new Response(JSON.stringify({ success: false, reason: 'no_player_id' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 11. Send via OneSignal (all registered devices)
    // Deep link contract (web + native):
    // - /chat/:id is always the other user's profile_id (the message sender from the recipient's POV).
    // - match_id is included in data for muting, bundling, and client logic — not for the chat URL path.
    let webPath = '/'
    const osData: Record<string, unknown> = { ...(data || {}), category }
    if (messagesChatPath) {
      osData.match_id = data.match_id
      osData.other_user_id = data.sender_id
      osData.sender_id = data.sender_id
      osData.url = messagesChatPath
      osData.deep_link = messagesChatPath
      webPath = messagesChatPath
    } else {
      const deepLink =
        data && typeof data.url === 'string'
          ? data.url
          : data && typeof data.deep_link === 'string'
            ? data.deep_link
            : '/'
      osData.deep_link = deepLink
      webPath = data && typeof data.url === 'string' ? data.url : '/'
    }

    const osPayload: any = {
      app_id: ONESIGNAL_APP_ID,
      include_player_ids: playerIds,
      headings: { en: finalTitle },
      contents: { en: finalBody },
      data: osData,
      url: webPath !== '/' ? `${APP_URL}${webPath}` : APP_URL,
    }

    if (collapseId) {
      osPayload.collapse_id = collapseId
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
    await logNotification(user_id, category, finalTitle, finalBody, osData, true)

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
